import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseHostedAccessArgs, runHostedSocialAccess, sandboxFetch, SANDBOX_REF, SANDBOX_ORIGIN } from '../scripts/check-hosted-social-access.mjs';

test('hosted write probe is inert by default without private-file read, SDK construction or network', async () => {
  let calls = 0;
  const result = await runHostedSocialAccess({ keysFile: 'missing-private-file', connectorFile: 'missing-connector',
    fetchImpl: async () => { calls++; throw new Error(); }, clientFactory: () => { calls++; throw new Error(); } });
  assert.equal(result.status, 'SKIPPED'); assert.equal(result.projectRef, SANDBOX_REF);
  assert.equal(result.reason, 'explicit_execute_sandbox_write_required'); assert.equal(calls, 0);
  assert.equal(result.productionWrites, 0); assert.equal(result.metaRequests, 0);
});
test('CLI requires explicit execution and absolute private paths, never accepts target overrides', () => {
  assert.equal(parseHostedAccessArgs([]).execute, false);
  const root = resolve(tmpdir());
  const valid = parseHostedAccessArgs(['--execute-sandbox-write', '--keys-file', join(root, 'keys.json'), '--connector-file', join(root, 'connector.json'), '--max-expiry-wait-ms', '0']);
  assert.equal(valid.execute, true); assert.equal(valid.maxExpiryWaitMs, 0);
  for (const args of [['--target', 'https://lxjkkqypiwnnrjmnpick.supabase.co'], ['--keys-file', 'relative.json'],
    ['--execute-sandbox-write', '--execute-sandbox-write'], ['--max-expiry-wait-ms', '90001'], ['--max-expiry-wait-ms', 'NaN']]) {
    assert.throws(() => parseHostedAccessArgs(args));
  }
});
test('network fence permits only exact sandbox API origin and forces redirects to error', async () => {
  const observed = [], counters = {};
  const guarded = sandboxFetch(async (input, options) => { observed.push({ input: String(input), options }); return new Response('{}'); }, counters);
  await guarded(SANDBOX_ORIGIN + '/rest/v1/organizations', { method: 'POST', redirect: 'follow' });
  assert.equal(observed.length, 1); assert.equal(observed[0].options.redirect, 'error'); assert.equal(counters.nonReadRequests, 1);
  for (const address of ['https://lxjkkqypiwnnrjmnpick.supabase.co/rest/v1/organizations',
    'http://mmvmvweitrhlgqtjadaz.supabase.co/rest/v1/organizations', SANDBOX_ORIGIN + '/not-an-api',
    'https://attacker.example.invalid/rest/v1/organizations', 'https://user:password@mmvmvweitrhlgqtjadaz.supabase.co/auth/v1/admin/users']) {
    await assert.rejects(guarded(address, { method: 'DELETE' }), error => error.code === 'non_sandbox_target');
  }
  assert.equal(observed.length, 1);
});
test('missing private files on explicit execution fail before SDK or network', async () => {
  let calls = 0;
  await assert.rejects(runHostedSocialAccess({ execute: true, clientFactory: () => { calls++; } }), error => error.code === 'private_key_files_required');
  assert.equal(calls, 0);
});
test('wrong connector project or production-bound key cannot construct a privileged client', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'momo-hosted-probe-guard-'));
  t.after(() => { assert.equal(dirname(directory), resolve(tmpdir())); assert.ok(basename(directory).startsWith('momo-hosted-probe-guard-')); rmSync(directory, { recursive: true, force: true }); });
  const keysFile = join(directory, 'keys.json'), connectorFile = join(directory, 'connector.json');
  const jwt = (ref, role) => Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ ref, role })).toString('base64url') + '.fixture_not_a_signature';
  let calls = 0;
  writeFileSync(keysFile, JSON.stringify([{ name: 'service_role', api_key: jwt(SANDBOX_REF, 'service_role') }, { name: 'anon', api_key: jwt(SANDBOX_REF, 'anon') }]));
  writeFileSync(connectorFile, JSON.stringify({ sandboxRef: 'lxjkkqypiwnnrjmnpick', recheckToken: 'fixture-connector-token-abcdefghijklmnopqrstuvwxyz' }));
  await assert.rejects(runHostedSocialAccess({ execute: true, keysFile, connectorFile, clientFactory: () => { calls++; } }), error => error.code === 'sandbox_identity_mismatch');
  writeFileSync(connectorFile, JSON.stringify({ sandboxRef: SANDBOX_REF, recheckToken: 'fixture-connector-token-abcdefghijklmnopqrstuvwxyz' }));
  writeFileSync(keysFile, JSON.stringify([{ name: 'service_role', api_key: jwt('lxjkkqypiwnnrjmnpick', 'service_role') }, { name: 'anon', api_key: jwt(SANDBOX_REF, 'anon') }]));
  await assert.rejects(runHostedSocialAccess({ execute: true, keysFile, connectorFile, clientFactory: () => { calls++; } }), error => error.code === 'key_project_or_role_mismatch');
  assert.equal(calls, 0);
});
