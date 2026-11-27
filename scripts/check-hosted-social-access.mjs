// Explicitly executed synthetic acceptance against one isolated hosted project.
// No production target override, deploy, migration, secret change, email or Meta.
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SANDBOX_REF = 'mmvmvweitrhlgqtjadaz';
export const SANDBOX_ORIGIN = `https://${SANDBOX_REF}.supabase.co`;
const ERP_ORIGIN = 'https://momo-erp-social-sandbox.onrender.com';
const PRODUCTION_REF = 'lxjkkqypiwnnrjmnpick';
const PERMISSION = 'social_inbox.reply_send';
class ProbeFailure extends Error {
  constructor(stage, code = 'acceptance_failed', status) { super('Hosted sandbox acceptance failed.'); Object.assign(this, { stage, code, status }); }
}
const assert = (condition, stage, code, status) => { if (!condition) throw new ProbeFailure(stage, code, status); };
const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/u.test(value) ? value : 'backend_error';
const wait = ms => new Promise(done => setTimeout(done, ms));
function jwtClaims(value) {
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')); } catch { throw new ProbeFailure('credentials', 'invalid_jwt_shape'); }
}

export function parseHostedAccessArgs(args) {
  const result = { execute: false, maxExpiryWaitMs: 90000 };
  const paths = { '--keys-file': 'keysFile', '--connector-file': 'connectorFile', '--report': 'reportPath' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]; assert(!seen.has(arg), 'arguments', 'duplicate_argument'); seen.add(arg);
    if (arg === '--execute-sandbox-write') result.execute = true;
    else if (Object.hasOwn(paths, arg)) {
      const value = args[++index]; assert(typeof value === 'string' && isAbsolute(value), 'arguments', 'absolute_path_required'); result[paths[arg]] = value;
    } else if (arg === '--max-expiry-wait-ms') {
      const value = Number(args[++index]); assert(Number.isSafeInteger(value) && value >= 0 && value <= 90000, 'arguments', 'invalid_expiry_wait'); result.maxExpiryWaitMs = value;
    } else throw new ProbeFailure('arguments', 'unsupported_argument');
  }
  return result;
}

export function sandboxFetch(fetchImpl = fetch, counters = {}) {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert(url.origin === SANDBOX_ORIGIN && !url.username && !url.password && !url.hash &&
      /^\/(?:auth|rest|functions)\/v1(?:\/|$)/u.test(url.pathname), 'network_guard', 'non_sandbox_target');
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');
    counters.requests = (counters.requests ?? 0) + 1;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) counters.nonReadRequests = (counters.nonReadRequests ?? 0) + 1;
    return fetchImpl(input, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(10000) });
  };
}

export async function runHostedSocialAccess({ execute = false, keysFile, connectorFile, reportPath,
  maxExpiryWaitMs = 90000, fetchImpl = fetch, clientFactory = createClient } = {}) {
  const report = { schemaVersion: 1, checkedAtUtc: new Date().toISOString(), projectRef: SANDBOX_REF,
    scope: 'isolated-hosted-synthetic-Auth-RLS-Edge-access-acceptance', status: 'SKIPPED',
    productionWrites: 0, metaRequests: 0, externalEmails: 0, checks: [], network: {}, cleanup: { status: 'NOT_REQUIRED', counts: {} } };
  if (!execute) { report.reason = 'explicit_execute_sandbox_write_required'; return report; }
  assert(keysFile && connectorFile && isAbsolute(keysFile) && isAbsolute(connectorFile), 'arguments', 'private_key_files_required');
  assert(Number.isSafeInteger(maxExpiryWaitMs) && maxExpiryWaitMs >= 0 && maxExpiryWaitMs <= 90000, 'arguments', 'invalid_expiry_wait');
  const keys = JSON.parse(await readFile(keysFile, 'utf8'));
  const connector = JSON.parse(await readFile(connectorFile, 'utf8'));
  assert(Array.isArray(keys) && connector?.sandboxRef === SANDBOX_REF && connector.sandboxRef !== PRODUCTION_REF, 'credentials', 'sandbox_identity_mismatch');
  const serviceKey = keys.find(item => item.name === 'service_role')?.api_key;
  const publicKey = keys.find(item => item.name === 'anon')?.api_key ?? keys.find(item => item.type === 'publishable' && item.name === 'default')?.api_key;
  assert(typeof serviceKey === 'string' && typeof publicKey === 'string' && typeof connector.recheckToken === 'string' &&
    connector.recheckToken.length >= 32 && serviceKey !== connector.recheckToken && publicKey !== connector.recheckToken, 'credentials', 'required_keys_missing');
  for (const [key, role] of [[serviceKey, 'service_role'], [publicKey, 'anon']]) if (key.split('.').length === 3) {
    const claims = jwtClaims(key); assert(claims.ref === SANDBOX_REF && claims.role === role, 'credentials', 'key_project_or_role_mismatch');
  }
  const request = sandboxFetch(fetchImpl, report.network);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: request } };
  const admin = clientFactory(SANDBOX_ORIGIN, serviceKey, options);
  const staff = clientFactory(SANDBOX_ORIGIN, publicKey, options);
  const outsider = clientFactory(SANDBOX_ORIGIN, publicKey, options);
  const runId = randomUUID(), orgA = randomUUID(), orgB = randomUUID();
  const actorA = randomUUID(), actorB = randomUUID(), roleA = randomUUID(), roleB = randomUUID();
  const pageA = randomUUID(), pageB = randomUUID(), primary = randomUUID(), backup = randomUUID(), teamB = randomUUID();
  const marker = `synthetic-access-${runId}`;
  const emailA = `access-a-${runId}@example.invalid`, emailB = `access-b-${runId}@example.invalid`;
  const passwordA = 'Synthetic!' + randomBytes(24).toString('base64url');
  const passwordB = 'Synthetic!' + randomBytes(24).toString('base64url');
  const ledgerPath = join(dirname(resolve(keysFile)), `hosted-social-owned-${runId}.json`);
  const ledger = { schemaVersion: 1, projectRef: SANDBOX_REF, runId, marker,
    organizations: [orgA, orgB], actors: [{ id: actorA, email: emailA, organizationId: orgA }, { id: actorB, email: emailB, organizationId: orgB }],
    roles: [roleA, roleB], pages: [pageA, pageB], teams: [primary, backup, teamB], cleanup: 'PENDING' };
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  report.ownedFixtureLedger = ledgerPath; report.runId = runId;
  let stage = 'fixture_setup', sessionA, sessionB, originalJwt, setupStarted = false;
  const deadline = Date.now() + 270000;
  const db = async (query, operation) => {
    assert(Date.now() < deadline || stage === 'cleanup', operation, 'total_deadline');
    const result = await query;
    if (!result || result.error || !(result.status >= 200 && result.status < 300)) throw new ProbeFailure(operation, safeCode(result?.error?.code), result?.status);
    return result.data;
  };
  const check = async (name, fn) => { stage = name; await fn(); report.checks.push({ name, status: 'PASS' }); };
  const insert = (table, rows) => db(admin.from(table).insert(rows).select(), `insert_${table}`);
  const update = async (table, values, match) => {
    let query = admin.from(table).update(values); for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
    const changed = await db(query.select(), `update_${table}`); assert(changed.length === 1, `update_${table}`, 'expected_one_owned_row');
  };
  const edge = async (body, { jwt = sessionA?.access_token, origin = ERP_ORIGIN, authorization = true } = {}) => {
    const response = await request(`${SANDBOX_ORIGIN}/functions/v1/social-integration`, { method: 'POST',
      headers: { apikey: publicKey, Origin: origin, 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${jwt}` } : {}) },
      body: JSON.stringify(body) });
    let payload; try { payload = await response.json(); } catch { payload = {}; }
    return { status: response.status, payload };
  };
  const recheck = async (expectedAllowed, overrides = {}, headers = {}) => {
    const input = { requestId: randomUUID(), subjectId: actorA, organizationId: orgA, teamId: primary, pageId: '990000000000001', permission: PERMISSION, ...overrides };
    const response = await request(`${SANDBOX_ORIGIN}/functions/v1/social-access-recheck`, { method: 'POST',
      headers: { apikey: publicKey, Authorization: `Bearer ${connector.recheckToken}`, 'Content-Type': 'application/json', 'X-Momo-Request-Id': input.requestId, ...headers }, body: JSON.stringify(input) });
    let decision; try { decision = await response.json(); } catch { decision = null; }
    assert(response.status === 200 && decision && decision.requestId === input.requestId && decision.userId === input.subjectId &&
      decision.organizationId === input.organizationId && Number.isSafeInteger(decision.expiresAt) && decision.expiresAt > Date.now() && decision.expiresAt <= Date.now() + 10000,
    stage, 'invalid_recheck_response', response.status);
    const allowed = decision.active === true && decision.teamIds?.includes(input.teamId) && decision.pageIds?.includes(input.pageId) && decision.permissions?.includes(PERMISSION);
    assert(allowed === expectedAllowed, stage, 'unexpected_access_decision');
    return decision;
  };
  const permissions = ['social_inbox.read', 'social_inbox.reply_draft', PERMISSION, 'pages.read', 'social_audit.read'];
  try {
    setupStarted = true;
    await insert('organizations', [{ id: orgA, name: marker + '-A', slug: marker + '-a' }, { id: orgB, name: marker + '-B', slug: marker + '-b' }]);
    for (const [id, email, password, organization] of [[actorA, emailA, passwordA, orgA], [actorB, emailB, passwordB, orgB]]) {
      const result = await admin.auth.admin.createUser({ id, email, password, email_confirm: true,
        app_metadata: { organization_id: organization, momo_acceptance_run_id: runId }, user_metadata: { first_name: 'SYNTHETIC', last_name: 'Hosted access' } });
      assert(!result.error && result.data?.user?.id === id, 'create_synthetic_auth', safeCode(result.error?.code), result.error?.status);
      // Explicitly bind our preselected new UUID after Auth's insert trigger;
      // app_metadata can be populated after that trigger has fired.
      await db(admin.from('profiles').upsert({ id, organization_id: organization, email, first_name: 'SYNTHETIC', last_name: 'Hosted access', status: 'active' }, { onConflict: 'id' }).select(), 'bind_owned_profile');
    }
    await insert('roles', [{ id: roleA, organization_id: orgA, name: marker + '-role-A' }, { id: roleB, organization_id: orgB, name: marker + '-role-B' }]);
    await insert('role_permissions', [roleA, roleB].flatMap(role_id => permissions.map(permission_code => ({ role_id, permission_code }))));
    await insert('user_roles', [{ user_id: actorA, role_id: roleA }, { user_id: actorB, role_id: roleB }]);
    await insert('facebook_pages', [{ id: pageA, organization_id: orgA, name: marker + '-Page-A', external_page_id: '990000000000001', is_active: true, connection_status: 'connected' },
      { id: pageB, organization_id: orgB, name: marker + '-Page-B', external_page_id: '990000000000002', is_active: true, connection_status: 'connected' }]);
    await insert('social_teams', [{ id: primary, organization_id: orgA, name: marker + '-primary' }, { id: backup, organization_id: orgA, name: marker + '-backup' }, { id: teamB, organization_id: orgB, name: marker + '-foreign' }]);
    await insert('social_team_members', [{ team_id: primary, user_id: actorA }, { team_id: backup, user_id: actorA }, { team_id: teamB, user_id: actorB }]);
    await insert('social_page_teams', [{ page_id: pageA, team_id: primary, assignment_type: 'primary', priority: 1 }, { page_id: pageA, team_id: backup, assignment_type: 'backup', priority: 1 }, { page_id: pageB, team_id: teamB, assignment_type: 'primary', priority: 1 }]);
    await insert('social_page_user_access', [{ page_id: pageA, user_id: actorA, can_read: true, can_reply: true }, { page_id: pageB, user_id: actorB, can_read: true, can_reply: true }]);
    await db(admin.from('feature_flags').upsert([orgA, orgB].flatMap(organization_id => ['social_inbox_read', 'social_inbox_reply_send'].map(key => ({ organization_id, key, enabled: true }))), { onConflict: 'organization_id,key' }).select(), 'fixture_flags');
    const loginA = await staff.auth.signInWithPassword({ email: emailA, password: passwordA });
    const loginB = await outsider.auth.signInWithPassword({ email: emailB, password: passwordB });
    assert(!loginA.error && loginA.data.session && !loginB.error && loginB.data.session, 'real_auth_login', 'synthetic_login_failed');
    sessionA = loginA.data.session; sessionB = loginB.data.session; originalJwt = sessionA.access_token;
    await check('Real hosted Auth and caller-derived primary delivery context', async () => {
      const context = await db(staff.rpc('get_social_delivery_context', { target_page: pageA }), 'staff_delivery_context');
      assert(context.subjectId === actorA && context.organizationId === orgA && context.erpPageId === pageA && context.pageId === '990000000000001' && context.teamId === primary, stage, 'delivery_context_mismatch');
    });
    await check('Hosted RLS hides foreign Page and service-only subject RPC from authenticated caller', async () => {
      const rows = await db(staff.from('facebook_pages').select('id').eq('id', pageB), 'foreign_page_rls'); assert(rows.length === 0, stage, 'foreign_page_visible');
      const denied = await staff.rpc('get_social_access_recheck', { target_user: actorA, target_organization: orgA, target_external_page: '990000000000001', target_team: primary });
      assert(denied.status === 403 && denied.error?.code === '42501', stage, 'service_rpc_not_private', denied.status);
    });
    await check('Real Edge rejects missing, wrong-principal and corrupt JWT', async () => {
      const body = { action: 'list', pageId: pageA, resource: 'messenger' };
      assert((await edge(body, { authorization: false })).status === 401, stage, 'missing_jwt_not_rejected');
      assert((await edge(body, { jwt: publicKey })).status === 401, stage, 'anon_principal_not_rejected');
      const parts = originalJwt.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
      assert((await edge(body, { jwt: parts.join('.') })).status === 401, stage, 'corrupt_jwt_not_rejected');
    });
    await check('Real Edge rejects foreign organization Page and unauthorized browser origin', async () => {
      assert((await edge({ action: 'list', pageId: pageA, resource: 'messenger' }, { jwt: sessionB.access_token })).status === 403, stage, 'foreign_org_not_rejected');
      assert((await edge({ action: 'list', pageId: pageA, resource: 'messenger' }, { origin: 'https://attacker.example.invalid' })).status === 403, stage, 'foreign_origin_not_rejected');
    });
    await check('Real Edge read flag is fail-closed before upstream registry forwarding', async () => {
      await update('feature_flags', { enabled: false }, { organization_id: orgA, key: 'social_inbox_read' });
      const result = await edge({ action: 'list', pageId: pageA, resource: 'messenger' });
      assert(result.status === 403 && result.payload?.error?.code === 'feature_disabled', stage, 'read_flag_not_enforced');
      await update('feature_flags', { enabled: true }, { organization_id: orgA, key: 'social_inbox_read' });
    });
    await check('Real hosted service Edge issues correlated allowed delivery decision', async () => { await recheck(true); });
    await check('Page explicit deny overrides active team membership', async () => {
      await update('social_page_user_access', { can_reply: false }, { page_id: pageA, user_id: actorA }); await recheck(false);
      await update('social_page_user_access', { can_reply: true }, { page_id: pageA, user_id: actorA }); await recheck(true);
    });
    await check('Revoked Page and membership hold old team while authenticated context chooses backup', async () => {
      await update('facebook_pages', { is_active: false }, { id: pageA }); await recheck(false);
      await update('facebook_pages', { is_active: true }, { id: pageA });
      await update('social_team_members', { is_active: false }, { team_id: primary, user_id: actorA }); await recheck(false);
      const context = await db(staff.rpc('get_social_delivery_context', { target_page: pageA }), 'backup_context'); assert(context.teamId === backup, stage, 'backup_context_missing');
      await update('social_team_members', { is_active: true }, { team_id: primary, user_id: actorA }); await recheck(true);
    });
    await check('Team deactivation, global permission and send flag revocation deny current dispatch', async () => {
      await update('social_teams', { is_active: false }, { id: primary }); await recheck(false); await update('social_teams', { is_active: true }, { id: primary });
      await db(admin.from('role_permissions').delete().eq('role_id', roleA).eq('permission_code', PERMISSION).select(), 'revoke_permission'); await recheck(false);
      await insert('role_permissions', [{ role_id: roleA, permission_code: PERMISSION }]);
      await update('feature_flags', { enabled: false }, { organization_id: orgA, key: 'social_inbox_reply_send' }); await recheck(false);
      await update('feature_flags', { enabled: true }, { organization_id: orgA, key: 'social_inbox_reply_send' }); await recheck(true);
    });
    await check('Inactive profile and foreign subject/org cannot reuse an allowed decision', async () => {
      await update('profiles', { status: 'disabled' }, { id: actorA }); const inactive = await recheck(false); assert(inactive.active === false, stage, 'inactive_profile_not_reported');
      await update('profiles', { status: 'active' }, { id: actorA });
      await recheck(false, { organizationId: orgB }); await recheck(false, { subjectId: actorB }); await recheck(true);
    });
    const expiresAt = jwtClaims(originalJwt).exp * 1000, remaining = expiresAt - Date.now() + 2000;
    if (Number.isFinite(expiresAt) && remaining <= maxExpiryWaitMs) {
      await check('Previously valid server-issued JWT is rejected after genuine expiry', async () => {
        if (remaining > 0) await wait(remaining);
        assert((await edge({ action: 'list', pageId: pageA, resource: 'messenger' }, { jwt: originalJwt })).status === 401, stage, 'expired_jwt_not_rejected');
      });
    } else report.checks.push({ name: 'Previously valid signed JWT expiry', status: 'SKIPPED', reason: 'Server-issued token outlives bounded expiry wait; no expired claim was forged.' });
    report.status = report.checks.some(item => item.status === 'SKIPPED') ? 'PASS_WITH_SKIPS' : 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.failedStage = error.stage ?? stage;
    report.failure = { code: safeCode(error.code), ...(Number.isInteger(error.status) ? { status: error.status } : {}) };
    report.checks.push({ name: stage, status: 'FAIL' });
  } finally {
    stage = 'cleanup'; const cleanupErrors = [];
    const remove = async (table, column, ids) => {
      try { const rows = await db(admin.from(table).delete().in(column, ids).select(), `cleanup_${table}`); report.cleanup.counts[table] = rows.length; }
      catch (error) { cleanupErrors.push({ resource: table, code: safeCode(error.code), status: error.status }); }
    };
    if (setupStarted) {
      let ownershipSafe = false;
      try {
        const organizations = await db(admin.from('organizations').select('id,slug').in('id', [orgA, orgB]), 'cleanup_ownership');
        ownershipSafe = organizations.every(row => (row.id === orgA && row.slug === marker + '-a') || (row.id === orgB && row.slug === marker + '-b'));
      } catch (error) { cleanupErrors.push({ resource: 'ownership', code: safeCode(error.code), status: error.status }); }
      if (ownershipSafe) {
        await remove('social_page_user_access', 'page_id', [pageA, pageB]);
        await remove('social_team_members', 'team_id', [primary, backup, teamB]);
        await remove('social_page_teams', 'page_id', [pageA, pageB]);
        await remove('audit_logs', 'organization_id', [orgA, orgB]);
        await remove('feature_flags', 'organization_id', [orgA, orgB]);
        await remove('user_roles', 'user_id', [actorA, actorB]);
        await remove('role_permissions', 'role_id', [roleA, roleB]);
        let usersRemaining = false;
        for (const actor of ledger.actors) {
          try {
            const found = await admin.auth.admin.getUserById(actor.id);
            if (found.error?.status === 404) continue;
            assert(!found.error && found.data?.user?.email === actor.email && found.data.user.app_metadata?.momo_acceptance_run_id === runId,
              'cleanup_auth', 'auth_ownership_mismatch', found.error?.status);
            const deleted = await admin.auth.admin.deleteUser(actor.id);
            assert(!deleted.error, 'cleanup_auth', safeCode(deleted.error?.code), deleted.error?.status);
            const absent = await admin.auth.admin.getUserById(actor.id);
            assert(absent.error?.status === 404, 'cleanup_auth', 'auth_deletion_not_verified', absent.error?.status);
            report.cleanup.counts.authUsers = (report.cleanup.counts.authUsers ?? 0) + 1;
          } catch (error) { usersRemaining = true; cleanupErrors.push({ resource: 'auth', code: safeCode(error.code), status: error.status }); }
        }
        await remove('facebook_pages', 'id', [pageA, pageB]); await remove('social_teams', 'id', [primary, backup, teamB]); await remove('roles', 'id', [roleA, roleB]);
        if (!usersRemaining && cleanupErrors.length === 0) await remove('organizations', 'id', [orgA, orgB]);
        report.cleanup.remaining = {};
        for (const [table, ids] of [['profiles', [actorA, actorB]], ['facebook_pages', [pageA, pageB]], ['social_teams', [primary, backup, teamB]], ['roles', [roleA, roleB]], ['organizations', [orgA, orgB]]]) {
          try {
            const rows = await db(admin.from(table).select('id').in('id', ids), `verify_cleanup_${table}`);
            report.cleanup.remaining[table] = rows.length;
            if (rows.length) cleanupErrors.push({ resource: table, code: 'owned_rows_remain' });
          } catch (error) { cleanupErrors.push({ resource: table, code: safeCode(error.code), status: error.status }); }
        }
      } else cleanupErrors.push({ resource: 'ownership', code: 'owned_parent_verification_failed' });
      report.cleanup.status = cleanupErrors.length ? 'FAIL' : 'PASS'; report.cleanup.errors = cleanupErrors;
      report.cleanup.providerAuditLogsRetained = true;
      if (cleanupErrors.length) report.status = 'FAIL';
      ledger.cleanup = report.cleanup.status; await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
    }
  }
  report.counts = { pass: report.checks.filter(item => item.status === 'PASS').length,
    fail: report.checks.filter(item => item.status === 'FAIL').length, skipped: report.checks.filter(item => item.status === 'SKIPPED').length };
  if (report.cleanup.status === 'FAIL') report.counts.fail++;
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runHostedSocialAccess(parseHostedAccessArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2)); if (result.status === 'FAIL') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', stage: error instanceof ProbeFailure ? error.stage : 'setup', code: safeCode(error.code) })); process.exitCode = 1;
  }
}
