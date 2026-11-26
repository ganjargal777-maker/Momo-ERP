// Read-only public deployment metadata. No login, email, SQL or mutation.
import { writeFile } from 'node:fs/promises';

const origin = 'https://erp.momoshop.mn';
const expectedRef = 'lxjkkqypiwnnrjmnpick';
const report = { checkedAtUtc: new Date().toISOString(), origin, expectedRef,
  scope: 'public-read-only-GET-no-authentication-or-database-writes', checks: {} };
async function read(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('Public metadata response exceeds bound.');
  return { response, body };
}
try {
  const index = await read(origin + '/');
  report.checks.html = { status: index.response.status, server: index.response.headers.get('server'),
    containsHardcodedSales: index.body.includes('4,280,000'),
    sdkPinned: /@supabase\/supabase-js@\d+\.\d+\.\d+/u.test(index.body) };
  const runtime = await read(origin + '/runtime-config.js');
  const match = runtime.body.match(/^\s*window\.__NEXERP_CONFIG__\s*=\s*(\{[^]*\})\s*;?\s*$/u);
  if (!match) throw new Error('Public runtime config format invalid.');
  const config = JSON.parse(match[1]);
  const url = new URL(config.url);
  const matchesProject = url.origin === `https://${expectedRef}.supabase.co` && url.pathname === '/';
  const key = config.publishableKey;
  let keyType = 'invalid';
  if (typeof key === 'string' && /^sb_publishable_[a-zA-Z0-9_-]{8,512}$/u.test(key)) keyType = 'publishable';
  else if (typeof key === 'string' && key.split('.').length === 3) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url'));
    keyType = claims.role === 'anon' ? 'legacy-anon' : 'forbidden-role';
  }
  report.checks.runtime = { status: runtime.response.status, matchesProject, keyType,
    cacheControl: runtime.response.headers.get('cache-control') };
  if (matchesProject && ['publishable', 'legacy-anon'].includes(keyType)) {
    const settings = await read(url.origin + '/auth/v1/settings', { apikey: key });
    const data = JSON.parse(settings.body);
    report.checks.publicAuthSettings = { status: settings.response.status,
      emailEnabled: data.external?.email === true, signupDisabled: data.disable_signup === true };
  }
  report.mutations = 0;
  report.stillRequired = ['Private Vercel env/build binding and deployment history', 'Hosted Auth redirect/SMTP configuration and approved synthetic-user acceptance', 'Verified backup/restore point before production rollout'];
  if (process.argv.length > 2) {
    if (process.argv.length !== 4 || process.argv[2] !== '--report') throw new Error('Expected --report new-file.json');
    await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error('Public readiness inspection failed; raw config/key/response withheld.');
  process.exitCode = 1;
}
