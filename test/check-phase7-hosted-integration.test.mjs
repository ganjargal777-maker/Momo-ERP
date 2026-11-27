// Local injected transport/configuration tests. These are not hosted evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { PHASE7, createPhase7Manifest, validatePhase7Manifest, phase7Registry, parsePhase7Args, phase7Fetch,
  validateFixtureSnapshot, phase7JsonRequest, runPhase7HttpWorkflow, runPhase7HostedIntegration } from '../scripts/check-phase7-hosted-integration.mjs';

const json = (data, status = 200) => Response.json(data, { status });
const jwt = (ref, role) => Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ ref, role })).toString('base64url') + '.unsigned_fixture';
const keyFixture = () => [{ name: 'service_role', type: 'legacy', api_key: jwt(PHASE7.projectRef, 'service_role') },
  { name: 'anon', type: 'legacy', api_key: jwt(PHASE7.projectRef, 'anon') }, { name: 'default', type: 'publishable', api_key: 'sb_publishable_phase7_fixture_123456789' }];
async function directory(t) { const path = await mkdtemp(join(tmpdir(), 'momo-phase7-test-')); t.after(async () => {
  assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith('momo-phase7-test-')); await rm(path, { recursive: true, force: true });
}); return path; }
function fixture(m, extra = {}) { return { schemaVersion: 'momo.sandbox.fixture.v1', runId: m.runId, pageId: m.pageAExternalId,
  conversationId: randomUUID(), messageId: randomUUID(), externalMessageId: 'synthetic-phase7-' + m.runId, state: 'active', replayed: false, simulationOnly: true,
  outbox: { legacy: 0, erp: 0 }, safety: { autoReply: false, controlMessenger: false, send: false, comments: false, commentSend: false, catalog: false, autoSendMessenger: false, autoSendComments: false }, ...extra }; }

test('inert default reads no private file, loads no SDK and opens no network', async () => {
  let calls = 0; const result = await runPhase7HostedIntegration({ keysFile: 'missing', clientFactory() { calls++; }, fetchImpl() { calls++; } });
  assert.equal(result.status, 'SKIPPED'); assert.equal(result.networkRequests, 0); assert.equal(calls, 0);
});
test('prepare freezes all public identities before network and never overwrites an existing manifest', async t => {
  const dir = await directory(t), path = join(dir, 'manifest.json'); let calls = 0;
  const result = await runPhase7HostedIntegration({ phase: 'prepare', manifestPath: path, fetchImpl() { calls++; }, clientFactory() { calls++; } });
  assert.equal(result.status, 'PREPARED_NOT_RUN'); assert.equal(result.networkRequests, 0); assert.equal(calls, 0);
  const manifest = validatePhase7Manifest(JSON.parse(await readFile(path, 'utf8')));
  assert.equal(new Set(Object.values(manifest.ids)).size, 12); assert.equal(phase7Registry(manifest)[0].erpPageId, manifest.ids.pageA);
  assert.equal(phase7Registry(manifest)[0].tokenEnv, 'FACEBOOK_BOT_ERP_TOKEN_PHASE7');
  await assert.rejects(runPhase7HostedIntegration({ phase: 'prepare', manifestPath: path }));
});
test('manifest rejects production, alternate endpoint/origin, unknown fields and reused fixture IDs', () => {
  const manifest = createPhase7Manifest();
  for (const [field, value] of [['projectRef', 'lxjkkqypiwnnrjmnpick'], ['supabaseOrigin', 'https://lxjkkqypiwnnrjmnpick.supabase.co'],
    ['botOrigin', 'https://momoshop-messenger-bot.onrender.com'], ['browserOrigin', 'https://erp.momoshop.mn'], ['edgePath', '/functions/v1/social-integration']])
    assert.throws(() => validatePhase7Manifest({ ...manifest, [field]: value }));
  assert.throws(() => validatePhase7Manifest({ ...manifest, secret: 'fixture' }));
  assert.throws(() => validatePhase7Manifest({ ...manifest, ids: { ...manifest.ids, foreign: manifest.ids.staff } }));
  assert.throws(() => validatePhase7Manifest({ ...manifest, ids: { ...manifest.ids, staff: 123 } }));
});
test('CLI admits one explicit phase with absolute files and forbids arbitrary targets', () => {
  assert.equal(parsePhase7Args([]).phase, 'inert'); assert.equal(parsePhase7Args(['--execute', '--manifest', resolve('fixture.json')]).phase, 'execute');
  for (const args of [['--execute', '--prepare'], ['--target', PHASE7.supabaseOrigin], ['--manifest', 'relative.json'], ['--execute', '--execute'], ['--execute', '--run-id', randomUUID()]]) assert.throws(() => parsePhase7Args(args));
});
test('network fence permits only sandbox API/new Edge/fixture and forbids send/email/production routes', async () => {
  const observed = [], counts = {}, guarded = phase7Fetch(async (input, init) => { observed.push(String(input)); assert.equal(init.redirect, 'error'); return json({}); }, counts);
  await guarded(PHASE7.supabaseOrigin + PHASE7.edgePath, { method: 'POST', redirect: 'follow' });
  await guarded(PHASE7.supabaseOrigin + '/auth/v1/admin/users', { method: 'POST' });
  await guarded(PHASE7.botOrigin + '/erp/v1/sandbox/fixtures', { method: 'POST' });
  for (const address of ['https://lxjkkqypiwnnrjmnpick.supabase.co/rest/v1/profiles', PHASE7.supabaseOrigin + '/functions/v1/social-integration',
    PHASE7.supabaseOrigin + '/auth/v1/recover', PHASE7.supabaseOrigin + '/auth/v1/invite', PHASE7.botOrigin + '/erp/v1/replies/' + randomUUID() + '/send',
    PHASE7.botOrigin + '/erp/v1/sandbox/fixtures?token=forbidden', 'https://graph.facebook.com/v27.0/me/messages']) await assert.rejects(guarded(address));
  assert.equal(observed.length, 3); assert.equal(counts.requests, 3);
});
test('fixture guard requires exact run/Page ownership and globally empty outboxes/all safety flags false', () => {
  const m = createPhase7Manifest(), good = fixture(m); assert.equal(validateFixtureSnapshot(good, m), good);
  for (const altered of [{ ...good, runId: randomUUID() }, { ...good, pageId: m.pageBExternalId }, { ...good, simulationOnly: false },
    { ...good, outbox: { legacy: 1, erp: 0 } }, { ...good, outbox: { legacy: 0, erp: 1 } }, { ...good, safety: { ...good.safety, send: true } },
    { ...good, unexpected: true }, { ...good, state: 'deleted' }]) assert.throws(() => validateFixtureSnapshot(altered, m));
});
test('bounded JSON transport rejects redirects, non-JSON, malformed and oversized responses', async () => {
  for (const response of [new Response('', { status: 302, headers: { Location: 'https://erp.momoshop.mn' } }),
    new Response('<html>'), new Response('{', { headers: { 'Content-Type': 'application/json' } }), json({ text: 'x'.repeat(1000) })])
    await assert.rejects(phase7JsonRequest(async () => response, PHASE7.supabaseOrigin + PHASE7.edgePath, {}, { timeoutMs: 100, maxBytes: 256 }));
});
test('bounded JSON deadline independently bounds a fetch or response stream that ignores abort', async () => {
  await assert.rejects(phase7JsonRequest(() => new Promise(() => {}), PHASE7.supabaseOrigin + PHASE7.edgePath, {}, { timeoutMs: 15 }), e => e.code === 'request_timeout');
  const body = new ReadableStream({ start() {} });
  await assert.rejects(phase7JsonRequest(async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }), PHASE7.supabaseOrigin + PHASE7.edgePath, {}, { timeoutMs: 15 }), e => e.code === 'request_timeout');
});

function mockedWorkflow(change = {}) {
  const manifest = createPhase7Manifest(), owned = fixture(manifest), checks = [], calls = [], assertions = [], mutations = [];
  const active = { pageRead: true, readFlag: true, draftFlag: true, globalRead: true, profileActive: true }; let reply;
  const success = (data, status = 200) => ({ status, data: { ok: true, data, meta: { mode: change.mode ?? 'live', pageId: change.pageId ?? manifest.ids.pageA,
    externalPageId: manifest.pageAExternalId, auditRecorded: change.auditRecorded ?? true, requestId: randomUUID(), outcomeUnknown: false } } });
  const deny = status => ({ status, data: { ok: false, error: { code: 'fixture_denial' } } });
  const edge = async (body, options = {}) => {
    calls.push({ body: structuredClone(body), options });
    if (options.authorization === false || options.jwt) return deny(401);
    if (options.actor || options.origin) return deny(403);
    if (body.subjectId) return deny(400);
    if (!active.pageRead || !active.readFlag || !active.globalRead || (!active.profileActive && !change.ignoreProfileRevocation) || (!active.draftFlag && body.action === 'suggest')) return deny(403);
    if (body.action === 'send') return deny(change.sendStatus ?? 403);
    if (body.action === 'capabilities') return success({ apiVersion: '1', pageId: manifest.pageAExternalId, sandboxFixturesEnabled: true, sending: false, commentSending: false });
    if (body.action === 'settings') return success({ autoSendMessenger: false, autoSendComments: false });
    const context = { id: owned.conversationId, pageId: manifest.pageAExternalId, channel: 'messenger', paused: true, replyAllowed: false, basisId: owned.messageId };
    if (body.action === 'list') return success({ items: [context] });
    if (body.action === 'detail') return success(context);
    if (body.action === 'history') return success({ items: [{ id: owned.messageId, conversationId: owned.conversationId, pageId: manifest.pageAExternalId, channel: 'messenger', direction: 'in' }] });
    if (body.action === 'suggest') {
      const existed = !!reply;
      reply ??= { id: randomUUID(), conversationId: owned.conversationId, pageId: manifest.pageAExternalId, channel: 'messenger', basisId: owned.messageId,
        state: 'draft', version: 1, text: 'Synthetic deterministic draft', source: change.source ?? 'rules-v1', model: change.model ?? null, approvedBy: null };
      return success({ ...reply, ...(existed && change.duplicateSuggest ? { id: randomUUID() } : {}) }, 201);
    }
    if (body.action === 'edit') {
      if (body.reply.version !== reply.version) return change.staleAccepted ? success(reply) : deny(409);
      reply = { ...reply, version: reply.version + 1, text: body.reply.text, state: 'draft', approvedBy: null }; return success(reply);
    }
    if (body.action === 'approve') {
      if (body.reply.version !== reply.version) return deny(409);
      reply = { ...reply, version: reply.version + 1, state: 'approved', approvedBy: 'fixture-shared-gateway-principal' }; return success(reply);
    }
    if (body.action === 'reply') return success(reply);
    throw Error('Unsupported test action');
  };
  const fixtureCall = async method => ({ status: 200, data: { ...owned, replayed: method === 'POST' } });
  const dbAssert = async name => { assertions.push(name); };
  const mutateOwned = async (name, enabled) => { mutations.push({ name, enabled }); active[name] = enabled; };
  const check = async (name, action) => { await action(); checks.push({ name, status: 'PASS' }); };
  return { manifest, calls, checks, assertions, mutations, active, run: () => runPhase7HttpWorkflow({ manifest, edge, fixture: fixtureCall, dbAssert, mutateOwned, check }) };
}
test('LOCAL MOCKED TRANSPORT checks review versions/dedup/live identity/audit and sends only denied probes', async () => {
  const harness = mockedWorkflow(), result = await harness.run();
  assert.equal(result.draftSource, 'rules-v1'); assert.equal(result.model, null); assert.equal(result.approvedVersion, 3);
  assert.equal(harness.checks.length, 11); assert.equal(harness.calls.filter(call => call.body.action === 'send').length, 2);
  assert.deepEqual(harness.assertions, ['foreignPageInvisible', 'unprivilegedMetadataCannotGrant', 'sendDisabled', 'audit', 'sendDisabled']);
  assert.ok(Object.values(harness.active).every(Boolean)); assert.equal(harness.mutations.length, 10);
});
for (const [name, change, code] of [['mock mode', { mode: 'mock' }, 'invalid_live_envelope'], ['wrong registry Page', { pageId: randomUUID() }, 'invalid_live_envelope'],
  ['missing durable audit acknowledgement', { auditRecorded: false }, 'invalid_live_envelope'], ['duplicate suggest', { duplicateSuggest: true }, 'suggest_duplicate_or_mutation'],
  ['fabricated LLM claim', { source: 'openai', model: 'fixture-model' }, 'draft_contract_mismatch'], ['accepted stale version', { staleAccepted: true }, 'unexpected_denial_status'],
  ['send accidentally accepted', { sendStatus: 202 }, 'unexpected_denial_status']]) {
  test('LOCAL MOCKED TRANSPORT rejects ' + name, async () => { await assert.rejects(mockedWorkflow(change).run(), error => error.code === code); });
}
test('revocation probe restores its owned profile even when the endpoint incorrectly accepts it', async () => {
  const harness = mockedWorkflow({ ignoreProfileRevocation: true }); await assert.rejects(harness.run(), error => error.code === 'unexpected_denial_status');
  assert.ok(Object.values(harness.active).every(Boolean)); assert.deepEqual(harness.mutations.at(-1), { name: 'profileActive', enabled: true });
});

async function executionFiles(t, amend = {}) {
  const dir = await directory(t), manifest = createPhase7Manifest(), manifestPath = join(dir, 'manifest.json'), keysFile = join(dir, 'keys.json'), connectorFile = join(dir, 'connector.json'), botCredentialsFile = join(dir, 'bot.json'), reportPath = join(dir, 'report.json');
  await writeFile(manifestPath, JSON.stringify(manifest)); await writeFile(keysFile, JSON.stringify(amend.keys ?? keyFixture()));
  await writeFile(connectorFile, JSON.stringify({ sandboxRef: PHASE7.projectRef }));
  const botCredentials = { schemaVersion: 1, projectRef: PHASE7.projectRef, botOrigin: PHASE7.botOrigin, writerToken: 'fixture-writer-abcdefghijklmnopqrstuvwxyz012345', fixtureToken: 'fixture-fixtures-abcdefghijklmnopqrstuvwxyz012345', ...amend.bot };
  await writeFile(botCredentialsFile, JSON.stringify(botCredentials));
  return { dir, manifest, options: { phase: 'execute', manifestPath, keysFile, connectorFile, botCredentialsFile, reportPath } };
}
test('production-bound key or production bot credential fails before SDK construction/network', async t => {
  for (const amend of [{ keys: [{ name: 'service_role', api_key: jwt('lxjkkqypiwnnrjmnpick', 'service_role') }, { name: 'anon', api_key: jwt(PHASE7.projectRef, 'anon') }] },
    { bot: { botOrigin: 'https://momoshop-messenger-bot.onrender.com' } }]) {
    const data = await executionFiles(t, amend); let calls = 0;
    await assert.rejects(runPhase7HostedIntegration({ ...data.options, clientFactory() { calls++; }, fetchImpl() { calls++; } })); assert.equal(calls, 0);
  }
});

function partialSdk({ alterOwnership = false } = {}) {
  const tables = new Map(), users = new Map(), deletedUsers = [], actions = [];
  const rows = table => { if (!tables.has(table)) tables.set(table, []); return tables.get(table); };
  const makeQuery = table => {
    let kind = 'select', values, filters = [];
    const query = { insert(data) { kind = 'insert'; values = Array.isArray(data) ? data : [data]; return query; }, upsert(data) { kind = 'upsert'; values = Array.isArray(data) ? data : [data]; return query; },
      select() { return query; }, delete() { kind = 'delete'; return query; }, eq(column, value) { filters.push(row => row[column] === value); return query; }, in(column, values) { filters.push(row => values.includes(row[column])); return query; },
      then(resolveResult, reject) { return Promise.resolve().then(() => {
        actions.push({ table, kind });
        if (table === 'roles' && kind === 'insert') {
          if (alterOwnership) rows('organizations')[0].slug = 'foreign-marker';
          return { status: 503, error: { code: 'fixture_setup_failure' }, data: null };
        }
        let data;
        if (kind === 'insert') { rows(table).push(...structuredClone(values)); data = values; }
        else if (kind === 'upsert') { for (const value of values) { const index = rows(table).findIndex(row => row.id === value.id); if (index >= 0) rows(table)[index] = structuredClone(value); else rows(table).push(structuredClone(value)); } data = values; }
        else { data = rows(table).filter(row => filters.every(filter => filter(row))); if (kind === 'delete') tables.set(table, rows(table).filter(row => !data.includes(row))); }
        return { status: kind === 'insert' ? 201 : 200, error: null, data: structuredClone(data) };
      }).then(resolveResult, reject); } };
    return query;
  };
  const admin = { createUser: async input => { users.set(input.id, structuredClone(input)); return { data: { user: { id: input.id } }, error: null }; },
    getUserById: async id => users.has(id) ? { data: { user: users.get(id) }, error: null } : { data: {}, error: { status: 404 } },
    deleteUser: async id => { deletedUsers.push(id); users.delete(id); tables.set('profiles', rows('profiles').filter(row => row.id !== id)); return { data: {}, error: null }; } };
  const clientFactory = () => ({ from: makeQuery, auth: { admin, signInWithPassword: async input => { const user = [...users.values()].find(row => row.email === input.email && row.password === input.password); return { error: null, data: { user: { id: user.id }, session: { access_token: 'fixture-access-token-' + user.id, refresh_token: 'fixture-refresh-token-' + user.id } } }; } } });
  return { tables, users, deletedUsers, actions, clientFactory };
}
test('partial setup failure still cleans only tagged owned Auth/DB rows; mocked evidence stays labelled', async t => {
  const data = await executionFiles(t), sdk = partialSdk(); let network = 0;
  const result = await runPhase7HostedIntegration({ ...data.options, clientFactory: sdk.clientFactory, fetchImpl() { network++; throw Error(); } });
  assert.equal(result.status, 'FAIL'); assert.equal(result.failure.code, 'fixture_setup_failure'); assert.equal(result.cleanup.status, 'PASS'); assert.equal(result.localMockEvidence, true);
  assert.equal(sdk.deletedUsers.length, 3); assert.equal(sdk.users.size, 0); assert.equal(network, 0);
  assert.ok(Object.values(result.cleanup.remaining).every(count => count === 0));
  const output = await readFile(data.options.reportPath, 'utf8'); assert.equal(output.includes(keyFixture()[0].api_key), false);
  const ledger = JSON.parse(await readFile(result.ownedFixtureLedger, 'utf8')); assert.equal(ledger.cleanup, 'PASS'); assert.equal(JSON.stringify(ledger).includes('password'), false);
});
test('ownership mismatch prevents all Auth and tenant deletes and leaves a reconciliation ledger', async t => {
  const data = await executionFiles(t), sdk = partialSdk({ alterOwnership: true });
  const result = await runPhase7HostedIntegration({ ...data.options, clientFactory: sdk.clientFactory, fetchImpl() { throw Error(); } });
  assert.equal(result.status, 'FAIL'); assert.equal(result.cleanup.status, 'FAIL'); assert.equal(sdk.deletedUsers.length, 0); assert.equal(sdk.users.size, 3);
  assert.equal(sdk.actions.some(action => action.kind === 'delete'), false);
});
test('a colliding foreign Page UUID in a public manifest is never deletion authority', async t => {
  const data = await executionFiles(t), sdk = partialSdk();
  sdk.tables.set('facebook_pages', [{ id: data.manifest.ids.pageA, organization_id: randomUUID(), name: 'Foreign fixture not owned by this run' }]);
  const result = await runPhase7HostedIntegration({ ...data.options, clientFactory: sdk.clientFactory, fetchImpl() { throw Error(); } });
  assert.equal(result.status, 'FAIL'); assert.equal(result.cleanup.status, 'FAIL'); assert.equal(sdk.deletedUsers.length, 0);
  assert.equal(sdk.actions.some(action => action.kind === 'delete'), false); assert.equal(sdk.tables.get('facebook_pages').length, 1);
});
test('cleanup mode requires the exact prior private ownership ledger before client/network', async t => {
  const data = await executionFiles(t); let calls = 0;
  await assert.rejects(runPhase7HostedIntegration({ ...data.options, phase: 'cleanup', clientFactory() { calls++; }, fetchImpl() { calls++; } })); assert.equal(calls, 0);
});
