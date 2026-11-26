import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const urlNames = ['VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const keyNames = ['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

export function parseLocalEnvironment(contents) {
  const result = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) result[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
  }
  return result;
}

function setting(names, env, localEnv) {
  // Runtime variables override the local file, but conflicting aliases in the
  // same layer must be fixed rather than silently selecting a stale project.
  for (const layer of [env, localEnv]) {
    const values = [...new Set(names.map(name => layer[name]).filter(value => value !== undefined && value !== ''))];
    if (values.length > 1) throw new Error('Conflicting public Supabase environment aliases.');
    if (values.length === 1) return values[0];
  }
  return '';
}

export function resolveRuntimeConfig(env = {}, localEnv = {}) {
  const configuredUrl = setting(urlNames, env, localEnv);
  const publishableKey = setting(keyNames, env, localEnv);
  if (!configuredUrl || !publishableKey) throw new Error('Public Supabase URL and publishable/anon key are required.');
  let url;
  try {
    url = new URL(configuredUrl);
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || configuredUrl.trim() !== configuredUrl) throw new Error();
  } catch { throw new Error('Supabase URL must be an HTTPS origin (HTTP loopback is local-only).'); }
  if (typeof publishableKey !== 'string' || publishableKey.length > 8192 || /\s/u.test(publishableKey)) {
    throw new Error('A public Supabase publishable or anon key is required; server secrets are forbidden.');
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{8,512}$/u.test(publishableKey)) {
    try {
      const parts = publishableKey.split('.');
      if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/u.test(part))) throw new Error();
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const local = ['localhost', '127.0.0.1'].includes(url.hostname);
      if (claims.role !== 'anon' || (!local && claims.ref && url.hostname !== `${claims.ref}.supabase.co`)) throw new Error();
    } catch { throw new Error('Public key is invalid, privileged, or belongs to a different project.'); }
  }
  const expected = env.MOMO_EXPECTED_SUPABASE_PROJECT_REF || localEnv.MOMO_EXPECTED_SUPABASE_PROJECT_REF;
  if (expected && (!/^[a-z0-9]{20}$/u.test(expected) || url.hostname !== `${expected}.supabase.co`)) {
    throw new Error('Supabase URL does not match the explicitly expected project.');
  }
  return { url: url.origin, publishableKey };
}

export function buildRuntimeConfig({ rootDirectory = root, env = process.env } = {}) {
  const localPath = path.join(rootDirectory, '.env.local');
  const localEnv = fs.existsSync(localPath) ? parseLocalEnvironment(fs.readFileSync(localPath, 'utf8')) : {};
  const config = resolveRuntimeConfig(env, localEnv);
  fs.writeFileSync(path.join(rootDirectory, 'dist', 'runtime-config.js'),
    `window.__NEXERP_CONFIG__ = ${JSON.stringify(config)};\n`, 'utf8');
  return config;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { buildRuntimeConfig(); console.log('Public Supabase runtime config generated.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
