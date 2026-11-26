import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildRuntimeConfig, parseLocalEnvironment, resolveRuntimeConfig } from '../scripts/build-runtime-config.mjs';

const REF = 'abcdefghijklmnopqrst';
const URL = `https://${REF}.supabase.co`;
const KEY = 'sb_publishable_public_fixture_only_123456789';
const legacy = (claims = {}) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role: 'anon', ref: REF, ...claims })).toString('base64url'),
  'fixture_not_a_signature',
].join('.');
const settings = extra => ({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: KEY, ...extra });

test('runtime configuration accepts public publishable/anon keys and canonical HTTPS origins', () => {
  assert.deepEqual(resolveRuntimeConfig(settings()), { url: URL, publishableKey: KEY });
  assert.equal(resolveRuntimeConfig(settings({ VITE_SUPABASE_URL: URL + '/', VITE_SUPABASE_PUBLISHABLE_KEY: legacy() })).url, URL);
  assert.equal(resolveRuntimeConfig(settings({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: legacy() })).url, 'http://127.0.0.1:54321');
});

test('Vercel public aliases work and runtime values override local configuration', () => {
  const alternate = { NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: legacy() };
  assert.equal(resolveRuntimeConfig(alternate).publishableKey, legacy());
  assert.deepEqual(resolveRuntimeConfig(settings(), { VITE_SUPABASE_URL: 'https://other.example.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'stale-local-value' }), { url: URL, publishableKey: KEY });
  assert.throws(() => resolveRuntimeConfig(settings({ NEXT_PUBLIC_SUPABASE_URL: 'https://stale.example.invalid' })), /Conflicting/);
  assert.throws(() => resolveRuntimeConfig(settings({ NEXT_PUBLIC_SUPABASE_ANON_KEY: legacy() })), /Conflicting/);
});

test('runtime configuration rejects missing, malformed, redirected or insecure URL configuration', () => {
  assert.throws(() => resolveRuntimeConfig({}), /required/);
  for (const value of ['http://erp.example.invalid', URL + '/rest/v1', URL + '?key=unsafe', URL + '#fragment',
    'https://user:password@example.invalid', ' ' + URL, 'javascript:alert(1)', 'not-a-url']) {
    assert.throws(() => resolveRuntimeConfig(settings({ VITE_SUPABASE_URL: value })), /HTTPS origin/);
  }
});

test('server-side secrets and foreign-project legacy keys cannot be emitted to the browser', () => {
  for (const value of ['sb_secret_fixture_do_not_expose', legacy({ role: 'service_role' }), legacy({ role: 'authenticated' }),
    legacy({ ref: 'differentprojectrefxx' }), 'placeholder', KEY + '\n']) {
    assert.throws(() => resolveRuntimeConfig(settings({ VITE_SUPABASE_PUBLISHABLE_KEY: value })), /key|secrets|project/);
  }
});

test('explicit expected project binding prevents deploying a valid public key to the wrong project', () => {
  assert.equal(resolveRuntimeConfig(settings({ MOMO_EXPECTED_SUPABASE_PROJECT_REF: REF })).url, URL);
  assert.throws(() => resolveRuntimeConfig(settings({ MOMO_EXPECTED_SUPABASE_PROJECT_REF: 'differentprojectrefxx' })), /expected project/);
  assert.throws(() => resolveRuntimeConfig(settings({ MOMO_EXPECTED_SUPABASE_PROJECT_REF: 'not a ref' })), /expected project/);
});

test('dotenv parser strips paired quotes and ignores comments without reading server configuration', () => {
  assert.deepEqual(parseLocalEnvironment('# comment\nVITE_SUPABASE_URL="https://sample.example.invalid"\nVITE_SUPABASE_ANON_KEY=\'public\'\nINVALID LINE'),
    { VITE_SUPABASE_URL: 'https://sample.example.invalid', VITE_SUPABASE_ANON_KEY: 'public' });
});

test('build emits only validated public fields from an isolated synthetic local file', t => {
  const directory = mkdtempSync(join(tmpdir(), 'momo-runtime-config-'));
  t.after(() => {
    assert.equal(dirname(directory), resolve(tmpdir())); assert.ok(basename(directory).startsWith('momo-runtime-config-'));
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(join(directory, 'dist'));
  writeFileSync(join(directory, '.env.local'), `NEXT_PUBLIC_SUPABASE_URL=${URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${legacy()}\nSUPABASE_SERVICE_ROLE_KEY=fixture_private_do_not_expose`);
  const config = buildRuntimeConfig({ rootDirectory: directory, env: {} });
  const output = readFileSync(join(directory, 'dist/runtime-config.js'), 'utf8');
  assert.ok(!output.includes('fixture_private_do_not_expose'));
  const sandbox = { window: {} }; runInNewContext(output, sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.__NEXERP_CONFIG__)), config);
});

test('source Auth redirect allowlist admits the exact frontend recovery URL while global signup stays disabled', () => {
  const config = readFileSync(new globalThis.URL('../supabase/config.toml', import.meta.url), 'utf8');
  const auth = config.match(/^\[auth\]\s*([\s\S]*?)(?=^\[|$(?![\s\S]))/mu)?.[1];
  assert.ok(auth, 'source auth configuration exists');
  const siteUrl = auth.match(/^site_url\s*=\s*"([^"]+)"/mu)?.[1];
  const redirectArray = auth.match(/^additional_redirect_urls\s*=\s*(\[[\s\S]*?\])/mu)?.[1];
  const allowed = JSON.parse(redirectArray);
  for (const origin of [siteUrl, 'http://localhost:4173']) {
    const target = new globalThis.URL('/', origin); target.searchParams.set('reset', '1');
    assert.ok(allowed.includes(target.href), 'auth.js recovery target must be explicitly allowlisted');
  }
  assert.match(auth, /^enable_signup\s*=\s*false\s*$/mu);
  for (const value of allowed) {
    const target = new globalThis.URL(value);
    assert.ok(!value.includes('*') && !target.username && !target.password);
    assert.ok(target.origin === siteUrl || target.origin === 'http://localhost:4173');
  }
});
