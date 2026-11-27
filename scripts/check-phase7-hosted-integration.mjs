// Opt-in, fixed-target Phase 7 hosted acceptance. Never deploys or sends Meta.
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PHASE7 = Object.freeze({ projectRef: 'mmvmvweitrhlgqtjadaz', supabaseOrigin: 'https://mmvmvweitrhlgqtjadaz.supabase.co',
  botOrigin: 'https://momoshop-messenger-bot-sandbox.onrender.com', browserOrigin: 'https://momo-erp-social-sandbox.onrender.com',
  edgePath: '/functions/v1/social-integration-phase7', pageAExternalId: '123456789001', pageBExternalId: '123456789002' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ID_KEYS = ['orgA', 'orgB', 'staff', 'foreign', 'noPermission', 'roleA', 'roleB', 'pageA', 'pageB', 'primaryA', 'backupA', 'primaryB'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
class Phase7Failure extends Error {
  constructor(stage, code = 'acceptance_failed', status) { super('Phase 7 hosted acceptance failed.'); Object.assign(this, { stage, code, status }); }
}
const ensure = (value, stage, code, status) => { if (!value) throw new Phase7Failure(stage, code, status); };
const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/u.test(value) ? value : 'acceptance_failed';
function exact(value, keys, stage = 'manifest') { ensure(object(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)), stage, 'invalid_shape'); }
function claims(token) { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { throw new Phase7Failure('credentials', 'invalid_key_shape'); } }

export function createPhase7Manifest({ runId = randomUUID(), clock = Date.now } = {}) {
  ensure(typeof runId === 'string' && UUID.test(runId), 'prepare', 'invalid_run_id');
  return { schemaVersion: 1, purpose: 'isolated-synthetic-phase7-hosted-integration', runId, createdAtUtc: new Date(clock()).toISOString(),
    ...PHASE7, ids: Object.fromEntries(ID_KEYS.map(key => [key, randomUUID()])) };
}
export function validatePhase7Manifest(value) {
  exact(value, ['schemaVersion', 'purpose', 'runId', 'createdAtUtc', ...Object.keys(PHASE7), 'ids']);
  ensure(value.schemaVersion === 1 && value.purpose === 'isolated-synthetic-phase7-hosted-integration' && UUID.test(value.runId) &&
    typeof value.createdAtUtc === 'string' && Number.isFinite(Date.parse(value.createdAtUtc)), 'manifest', 'invalid_manifest');
  for (const [key, expected] of Object.entries(PHASE7)) ensure(value[key] === expected, 'manifest', 'protected_target_mismatch');
  exact(value.ids, ID_KEYS);
  ensure(ID_KEYS.every(key => typeof value.ids[key] === 'string' && UUID.test(value.ids[key])) && new Set(Object.values(value.ids)).size === ID_KEYS.length,
    'manifest', 'invalid_or_reused_fixture_ids');
  return structuredClone(value);
}
export function phase7Registry(manifest) {
  const m = validatePhase7Manifest(manifest);
  return [{ erpPageId: m.ids.pageA, organizationId: m.ids.orgA, externalPageId: m.pageAExternalId,
    apiVersion: '1', baseUrl: m.botOrigin, tokenEnv: 'FACEBOOK_BOT_ERP_TOKEN_PHASE7' }];
}
export function parsePhase7Args(args) {
  const result = { phase: 'inert' }, seen = new Set();
  const paths = { '--manifest': 'manifestPath', '--keys-file': 'keysFile', '--connector-file': 'connectorFile', '--bot-credentials-file': 'botCredentialsFile', '--report': 'reportPath' };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]; ensure(!seen.has(arg), 'arguments', 'duplicate_argument'); seen.add(arg);
    if (['--prepare', '--execute', '--cleanup'].includes(arg)) { ensure(result.phase === 'inert', 'arguments', 'multiple_phases'); result.phase = arg.slice(2); }
    else if (arg === '--run-id') { result.runId = args[++index]; ensure(typeof result.runId === 'string' && UUID.test(result.runId), 'arguments', 'invalid_run_id'); }
    else if (Object.hasOwn(paths, arg)) { const value = args[++index]; ensure(typeof value === 'string' && isAbsolute(value), 'arguments', 'absolute_path_required'); result[paths[arg]] = value; }
    else throw new Phase7Failure('arguments', 'unsupported_argument');
  }
  ensure(result.runId === undefined || result.phase === 'prepare', 'arguments', 'run_id_prepare_only');
  return result;
}

export async function runPhase7HostedIntegration(options = {}) {
  const { phase = 'inert', manifestPath, runId, clock = Date.now } = options;
  ensure(['inert', 'prepare', 'execute', 'cleanup'].includes(phase), 'arguments', 'unsupported_phase');
  if (phase === 'inert') return { status: 'SKIPPED', reason: 'explicit_phase_required', networkRequests: 0, productionWrites: 0, metaRequests: 0 };
  ensure(typeof manifestPath === 'string' && isAbsolute(manifestPath), 'arguments', 'absolute_manifest_required');
  if (phase === 'prepare') {
    const manifest = createPhase7Manifest({ runId, clock });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { status: 'PREPARED_NOT_RUN', manifestPath, runId: manifest.runId, registry: phase7Registry(manifest), networkRequests: 0, productionWrites: 0, metaRequests: 0 };
  }
  const manifest = validatePhase7Manifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  return executePhase7(manifest, options);
}

export function phase7Fetch(fetchImpl = fetch, counters = {}) {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const api = url.origin === PHASE7.supabaseOrigin && (/^\/rest\/v1(?:\/|$)/u.test(url.pathname) || url.pathname === PHASE7.edgePath ||
      /^\/auth\/v1\/(?:admin\/users(?:\/[0-9a-f-]+)?|token|user|logout)$/iu.test(url.pathname));
    const bot = url.origin === PHASE7.botOrigin && !url.search && /^\/erp\/v1\/sandbox\/fixtures(?:\/[0-9a-f-]+)?$/iu.test(url.pathname);
    ensure((api || bot) && !url.username && !url.password && !url.hash, 'network_guard', 'non_sandbox_target');
    counters.requests = (counters.requests ?? 0) + 1;
    counters[bot ? 'botRequests' : 'erpRequests'] = (counters[bot ? 'botRequests' : 'erpRequests'] ?? 0) + 1;
    return fetchImpl(input, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(10000) });
  };
}

export function validateFixtureSnapshot(data, manifest, expectedState = 'active') {
  const m = validatePhase7Manifest(manifest);
  exact(data, ['schemaVersion', 'runId', 'pageId', 'conversationId', 'messageId', 'externalMessageId', 'state', 'replayed', 'simulationOnly', 'outbox', 'safety'], 'bot_fixture');
  ensure(data.schemaVersion === 'momo.sandbox.fixture.v1' && data.runId === m.runId && data.pageId === m.pageAExternalId &&
    UUID.test(data.conversationId) && UUID.test(data.messageId) && typeof data.externalMessageId === 'string' && data.externalMessageId.length > 0 &&
    data.state === expectedState && typeof data.replayed === 'boolean' && data.simulationOnly === true, 'bot_fixture', 'invalid_fixture_identity');
  exact(data.outbox, ['legacy', 'erp'], 'bot_fixture');
  ensure(data.outbox.legacy === 0 && data.outbox.erp === 0, 'bot_fixture', 'unsafe_outbox');
  const safetyKeys = ['autoReply', 'controlMessenger', 'send', 'comments', 'commentSend', 'catalog', 'autoSendMessenger', 'autoSendComments'];
  exact(data.safety, safetyKeys, 'bot_fixture');
  ensure(safetyKeys.every(key => data.safety[key] === false), 'bot_fixture', 'unsafe_bot_configuration');
  return data;
}

export async function phase7JsonRequest(request, url, init = {}, { timeoutMs = 15000, maxBytes = 2 * 1024 * 1024 } = {}) {
  const controller = new AbortController(); let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Phase7Failure('http', 'request_timeout')); }, timeoutMs); });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await request(url, { ...init, signal: controller.signal });
      ensure(response && !response.redirected && !(response.status >= 300 && response.status < 400) &&
        (!response.url || new URL(response.url).origin === new URL(url).origin), 'http', 'redirect_forbidden');
      ensure(/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/iu.test(response.headers.get('content-type') ?? ''), 'http', 'json_required', response.status);
      ensure(Number(response.headers.get('content-length')) <= maxBytes, 'http', 'response_too_large');
      const reader = response.body?.getReader(); ensure(reader, 'http', 'empty_response');
      const chunks = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; ensure(size <= maxBytes, 'http', 'response_too_large'); chunks.push(part.value); } }
      finally { void reader.cancel().catch(() => {}); }
      ensure(!controller.signal.aborted, 'http', 'request_timeout');
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let data; try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new Phase7Failure('http', 'invalid_json'); }
      return { status: response.status, data };
    })()]);
  } finally { clearTimeout(timer); controller.abort(); }
}

// Shared by actual hosted execution and explicitly labelled transport tests.
export async function runPhase7HttpWorkflow({ manifest, edge, fixture, dbAssert, mutateOwned, check }) {
  const m = validatePhase7Manifest(manifest);
  const envelope = (result, status = 200) => {
    ensure(result.status === status && result.data?.ok === true && result.data.meta?.mode === 'live' && result.data.meta.pageId === m.ids.pageA &&
      result.data.meta.externalPageId === m.pageAExternalId && result.data.meta.auditRecorded === true && UUID.test(result.data.meta.requestId ?? '') &&
      result.data.meta.outcomeUnknown === false && result.data.data?.mock !== true, 'live_gateway', 'invalid_live_envelope', result.status);
    return result.data.data;
  };
  const denied = (result, status = 403) => { ensure(result.status === status, 'denial', 'unexpected_denial_status', result.status); };
  let context, draft, edited, approved;
  await check('Bot-owned synthetic fixture replay and status prove no send queues', async () => {
    const replay = await fixture('POST'); ensure(replay.status === 200 && validateFixtureSnapshot(replay.data, m).replayed === true, 'bot_fixture', 'fixture_replay_not_idempotent', replay.status);
    const status = await fixture('GET'); ensure(status.status === 200, 'bot_fixture', 'fixture_status_failed', status.status); validateFixtureSnapshot(status.data, m);
  });
  await check('Live hosted capability identity and automatic sends remain disabled', async () => {
    const caps = envelope(await edge({ action: 'capabilities' }));
    ensure(caps.apiVersion === '1' && caps.pageId === m.pageAExternalId && caps.sandboxFixturesEnabled === true && caps.sending === false && caps.commentSending === false, 'capabilities', 'unsafe_capabilities');
    const settings = envelope(await edge({ action: 'settings' })); ensure(settings.autoSendMessenger === false && settings.autoSendComments === false, 'settings', 'automatic_send_enabled');
  });
  await check('Real JWT, organization, Page and origin guards reject unauthorized callers', async () => {
    denied(await edge({ action: 'list', filters: {} }, { authorization: false }), 401);
    denied(await edge({ action: 'list', filters: {} }, { jwt: 'invalid.synthetic.jwt' }), 401);
    denied(await edge({ action: 'list', filters: {} }, { actor: 'foreign' }));
    denied(await edge({ action: 'list', filters: {} }, { actor: 'noPermission' }));
    denied(await edge({ action: 'list', filters: {}, subjectId: m.ids.foreign }), 400);
    denied(await edge({ action: 'list', filters: {} }, { origin: 'https://forbidden.example.invalid' }));
    await dbAssert('foreignPageInvisible'); await dbAssert('unprivilegedMetadataCannotGrant');
  });
  await check('Live hosted list, detail and history read the owned SQLite fixture', async () => {
    const list = envelope(await edge({ action: 'list', filters: { limit: 100 } }));
    const state = validateFixtureSnapshot((await fixture('GET')).data, m);
    ensure(Array.isArray(list.items) && list.items.some(item => item.id === state.conversationId) &&
      list.items.every(item => item.pageId === m.pageAExternalId && item.channel === 'messenger'), 'list', 'inbox_not_page_bound');
    context = envelope(await edge({ action: 'detail', id: state.conversationId }));
    ensure(context.id === state.conversationId && context.pageId === m.pageAExternalId && context.channel === 'messenger' && context.paused === true &&
      context.replyAllowed === false && context.basisId === state.messageId, 'detail', 'fixture_detail_mismatch');
    const history = envelope(await edge({ action: 'history', id: context.id, filters: { limit: 100 } }));
    ensure(Array.isArray(history.items) && history.items.some(item => item.id === state.messageId && item.direction === 'in') &&
      history.items.every(item => item.pageId === m.pageAExternalId && item.conversationId === context.id && item.channel === 'messenger'), 'history', 'fixture_history_mismatch');
  });
  await check('Deterministic draft persists and repeated suggest deduplicates current basis', async () => {
    draft = envelope(await edge({ action: 'suggest', id: context.id }), 201);
    ensure(UUID.test(draft.id ?? '') && draft.conversationId === context.id && draft.pageId === m.pageAExternalId && draft.channel === 'messenger' &&
      draft.basisId === context.basisId && draft.state === 'draft' && Number.isSafeInteger(draft.version) && draft.version >= 1 &&
      draft.source === 'rules-v1' && draft.model === null && typeof draft.text === 'string' && draft.text.length > 0, 'draft', 'draft_contract_mismatch');
    const repeated = envelope(await edge({ action: 'suggest', id: context.id }), 201);
    ensure(repeated.id === draft.id && repeated.version === draft.version && repeated.text === draft.text, 'draft', 'suggest_duplicate_or_mutation');
  });
  await check('Employee edit advances version and stale edit is rejected without overwrite', async () => {
    const text = 'SYNTHETIC Phase7 staff-reviewed answer ' + m.runId;
    edited = envelope(await edge({ action: 'edit', reply: { id: draft.id, version: draft.version, text } }));
    ensure(edited.id === draft.id && edited.text === text && edited.state === 'draft' && edited.version === draft.version + 1 && edited.approvedBy === null, 'edit', 'edit_not_persisted');
    denied(await edge({ action: 'edit', reply: { id: draft.id, version: draft.version, text: 'SYNTHETIC stale overwrite forbidden' } }), 409);
  });
  await check('Employee approval and readback preserve the reviewed text and version', async () => {
    approved = envelope(await edge({ action: 'approve', reply: { id: edited.id, version: edited.version } }));
    ensure(approved.id === edited.id && approved.state === 'approved' && approved.version === edited.version + 1 && approved.text === edited.text &&
      typeof approved.approvedBy === 'string' && approved.approvedBy.length > 0, 'approve', 'approval_not_persisted');
    denied(await edge({ action: 'approve', reply: { id: edited.id, version: edited.version } }), 409);
    const stored = envelope(await edge({ action: 'reply', id: approved.id }));
    ensure(stored.id === approved.id && stored.state === 'approved' && stored.version === approved.version && stored.text === edited.text, 'readback', 'approved_readback_mismatch');
  });
  await check('Missing send grant and disabled flag reject repeated send without outbox insertion', async () => {
    await dbAssert('sendDisabled');
    const body = { action: 'send', reply: { id: approved.id, version: approved.version }, idempotencyKey: 'phase7-nosend-' + m.runId };
    denied(await edge(body)); denied(await edge(body));
    const current = validateFixtureSnapshot((await fixture('GET')).data, m);
    ensure(current.outbox.erp === 0 && current.outbox.legacy === 0, 'send_guard', 'denied_send_created_queue');
  });
  await check('Current Page, flags, global read and inactive profile override a still-valid JWT', async () => {
    for (const [field, action] of [['pageRead', 'list'], ['readFlag', 'list'], ['draftFlag', 'suggest'], ['globalRead', 'list'], ['profileActive', 'list']]) {
      try {
        await mutateOwned(field, false);
        denied(await edge(action === 'suggest' ? { action, id: context.id } : { action, filters: {} }));
      } finally { await mutateOwned(field, true); }
    }
  });
  await check('Actual ERP audit records bind the workflow to the verified staff and Page', async () => { await dbAssert('audit'); });
  await check('Final fixture remains approved with all queues and automatic sends off', async () => {
    const stored = envelope(await edge({ action: 'reply', id: approved.id })); ensure(stored.state === 'approved' && stored.version === approved.version, 'final', 'unexpected_reply_transition');
    validateFixtureSnapshot((await fixture('GET')).data, m); await dbAssert('sendDisabled');
  });
  return { conversationId: context.id, replyId: approved.id, approvedVersion: approved.version, draftSource: 'rules-v1', model: null };
}

async function executePhase7(manifest, options) {
  const { phase, keysFile, connectorFile, botCredentialsFile, reportPath, fetchImpl = fetch } = options;
  ensure([keysFile, connectorFile, botCredentialsFile, reportPath].every(value => typeof value === 'string' && isAbsolute(value)), 'arguments', 'absolute_private_and_report_paths_required');
  try { await access(reportPath); throw new Phase7Failure('arguments', 'report_already_exists'); } catch (error) { if (error instanceof Phase7Failure) throw error; ensure(error.code === 'ENOENT', 'arguments', 'report_path_unavailable'); }
  const keys = JSON.parse(await readFile(keysFile, 'utf8')), connector = JSON.parse(await readFile(connectorFile, 'utf8')), botCredentials = JSON.parse(await readFile(botCredentialsFile, 'utf8'));
  ensure(Array.isArray(keys) && connector?.sandboxRef === PHASE7.projectRef, 'credentials', 'sandbox_identity_mismatch');
  exact(botCredentials, ['schemaVersion', 'projectRef', 'botOrigin', 'writerToken', 'fixtureToken'], 'credentials');
  ensure(botCredentials.schemaVersion === 1 && botCredentials.projectRef === PHASE7.projectRef && botCredentials.botOrigin === PHASE7.botOrigin,
    'credentials', 'bot_identity_mismatch');
  const serviceKey = keys.find(item => item.name === 'service_role')?.api_key;
  const publicKey = keys.find(item => item.type === 'publishable' && item.name === 'default')?.api_key ?? keys.find(item => item.name === 'anon')?.api_key;
  ensure(typeof serviceKey === 'string' && typeof publicKey === 'string' && publicKey !== serviceKey, 'credentials', 'required_keys_missing');
  const roleClaims = claims(serviceKey); ensure(roleClaims.ref === PHASE7.projectRef && roleClaims.role === 'service_role', 'credentials', 'key_project_or_role_mismatch');
  if (publicKey.split('.').length === 3) { const c = claims(publicKey); ensure(c.ref === PHASE7.projectRef && c.role === 'anon', 'credentials', 'key_project_or_role_mismatch'); }
  else ensure(/^sb_publishable_[a-zA-Z0-9_-]{8,512}$/u.test(publicKey), 'credentials', 'invalid_public_key');
  const opaque = value => typeof value === 'string' && /^[\x21-\x7e]{32,512}$/u.test(value);
  ensure(opaque(botCredentials.writerToken) && opaque(botCredentials.fixtureToken) && new Set([serviceKey, publicKey, botCredentials.writerToken, botCredentials.fixtureToken]).size === 4,
    'credentials', 'invalid_or_reused_bot_credentials');
  const secrets = [serviceKey, publicKey, botCredentials.writerToken, botCredentials.fixtureToken, connector.recheckToken].filter(value => typeof value === 'string');
  const { ids, runId } = manifest, marker = 'synthetic-phase7-' + runId;
  const ledgerPath = join(dirname(resolve(keysFile)), 'phase7-owned-' + runId + '.json');
  const manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const actors = [['staff', ids.staff, ids.orgA], ['foreign', ids.foreign, ids.orgB], ['noPermission', ids.noPermission, ids.orgA]].map(([name, id, organizationId]) => ({ name, id, organizationId, email: 'phase7-' + name.toLowerCase() + '-' + runId + '@example.invalid' }));
  let ledger;
  if (phase === 'execute') {
    ledger = { schemaVersion: 1, projectRef: PHASE7.projectRef, runId, marker, manifestSha256, ids, actors, botFixtureAttempted: false, botFixtureConfirmed: false, cleanup: 'PENDING' };
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } else {
    ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    ensure(ledger.projectRef === PHASE7.projectRef && ledger.runId === runId && ledger.marker === marker && ledger.manifestSha256 === manifestSha256 &&
      JSON.stringify(ledger.ids) === JSON.stringify(ids) && JSON.stringify(ledger.actors) === JSON.stringify(actors), 'cleanup', 'ownership_ledger_mismatch');
  }
  const report = { schemaVersion: 1, checkedAtUtc: new Date().toISOString(), runId, projectRef: PHASE7.projectRef, edgePath: PHASE7.edgePath,
    botOrigin: PHASE7.botOrigin, scope: 'actual-hosted-ERP-Edge-to-bot-review-only', status: 'FAIL', checks: [], network: {},
    productionWrites: 0, metaRequestsInitiatedByHarness: 0, externalEmails: 0, automaticSendEnabled: false, hostedQueueDispatchTested: false,
    aiMode: 'deterministic-rules-not-LLM', localMockEvidence: options.clientFactory !== undefined || options.fetchImpl !== undefined,
    cleanup: { status: 'PENDING', counts: {}, remaining: {} }, ownedFixtureLedger: ledgerPath };
  const request = phase7Fetch(fetchImpl, report.network);
  const clientFactory = options.clientFactory ?? (await import('@supabase/supabase-js')).createClient;
  const sdkOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: request } };
  const admin = clientFactory(PHASE7.supabaseOrigin, serviceKey, sdkOptions), clients = {}, sessions = {};
  let stage = phase === 'execute' ? 'fixture_setup' : 'cleanup', botFixture;
  const deadline = Date.now() + 300000;
  const db = async (query, operation) => {
    ensure(Date.now() < deadline || stage === 'cleanup', operation, 'total_deadline');
    const result = await query; ensure(result && !result.error && result.status >= 200 && result.status < 300, operation, safeCode(result?.error?.code), result?.status); return result.data;
  };
  const insert = (table, rows) => db(admin.from(table).insert(rows).select(), 'insert_' + table);
  const update = async (table, values, match) => {
    let query = admin.from(table).update(values); for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
    const rows = await db(query.select(), 'update_' + table); ensure(rows.length === 1, 'update_' + table, 'expected_one_owned_row');
  };
  const check = async (name, action) => { stage = name; await action(); report.checks.push({ name, status: 'PASS' }); };
  const fixture = async method => phase7JsonRequest(request, PHASE7.botOrigin + '/erp/v1/sandbox/fixtures' + (method === 'POST' ? '' : '/' + runId), {
    method, headers: { Authorization: 'Bearer ' + botCredentials.fixtureToken, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify({ runId }) } : {}) });
  const edge = async (body, { actor = 'staff', jwt = sessions[actor]?.access_token, origin = PHASE7.browserOrigin, authorization = true } = {}) => phase7JsonRequest(request, PHASE7.supabaseOrigin + PHASE7.edgePath, {
    method: 'POST', headers: { apikey: publicKey, Origin: origin, 'Content-Type': 'application/json', ...(authorization ? { Authorization: 'Bearer ' + jwt } : {}) },
    body: JSON.stringify({ pageId: ids.pageA, resource: 'messenger', ...body }) });
  const mutateOwned = async (field, enabled) => {
    if (field === 'pageRead') return update('social_page_user_access', { can_read: enabled }, { page_id: ids.pageA, user_id: ids.staff });
    if (field === 'profileActive') return update('profiles', { status: enabled ? 'active' : 'disabled' }, { id: ids.staff });
    if (field === 'globalRead') return enabled ? insert('role_permissions', [{ role_id: ids.roleA, permission_code: 'social_inbox.read' }]) : db(admin.from('role_permissions').delete().eq('role_id', ids.roleA).eq('permission_code', 'social_inbox.read').select(), 'revoke_owned_read');
    if (['readFlag', 'draftFlag'].includes(field)) return update('feature_flags', { enabled }, { organization_id: ids.orgA, key: field === 'readFlag' ? 'social_inbox_read' : 'social_inbox_ai_draft' });
    throw new Phase7Failure('fixture_mutation', 'unsupported_owned_change');
  };
  const dbAssert = async kind => {
    if (kind === 'foreignPageInvisible') { const rows = await db(clients.staff.from('facebook_pages').select('id').eq('id', ids.pageB), 'foreign_page_rls'); ensure(rows.length === 0, kind, 'foreign_page_visible'); }
    else if (kind === 'unprivilegedMetadataCannotGrant') {
      const value = await db(clients.noPermission.rpc('has_permission', { required_permission: 'social_inbox.read' }), 'metadata_permission'); ensure(value === false, kind, 'editable_metadata_granted_permission');
    } else if (kind === 'sendDisabled') {
      const value = await db(clients.staff.rpc('has_permission', { required_permission: 'social_inbox.reply_send' }), 'send_permission'); ensure(value === false, kind, 'send_permission_enabled');
      const flags = await db(admin.from('feature_flags').select('enabled').eq('organization_id', ids.orgA).eq('key', 'social_inbox_reply_send'), 'send_flag'); ensure(flags.length === 1 && flags[0].enabled === false, kind, 'send_flag_enabled');
    } else if (kind === 'audit') {
      const audits = await db(admin.from('audit_logs').select('actor_id,action,after_data').eq('organization_id', ids.orgA), 'owned_audit');
      for (const action of ['social.list.result', 'social.detail.result', 'social.history.result', 'social.suggest.requested', 'social.suggest.result', 'social.edit.requested', 'social.edit.result', 'social.approve.requested', 'social.approve.result', 'social.reply.result'])
        ensure(audits.some(row => row.action === action && row.actor_id === ids.staff && row.after_data?.pageId === ids.pageA && UUID.test(row.after_data.requestId ?? '')), 'audit', 'workflow_audit_missing');
      report.auditCountVerified = audits.length;
    } else throw new Phase7Failure('db_assertion', 'unsupported_assertion');
  };
  try {
    if (phase === 'execute') {
      await insert('organizations', [{ id: ids.orgA, name: marker + '-A', slug: marker + '-a' }, { id: ids.orgB, name: marker + '-B', slug: marker + '-b' }]);
      for (const actor of actors) {
        const password = 'Synthetic!' + randomBytes(24).toString('base64url'); secrets.push(password);
        const created = await admin.auth.admin.createUser({ id: actor.id, email: actor.email, password, email_confirm: true,
          app_metadata: { organization_id: actor.organizationId, momo_acceptance_run_id: runId },
          user_metadata: { first_name: 'SYNTHETIC', last_name: 'Phase7', ...(actor.name === 'noPermission' ? { organization_id: ids.orgA, role: 'Admin', permissions: ['social_inbox.read', 'social_inbox.reply_send'] } : {}) } });
        ensure(!created.error && created.data?.user?.id === actor.id, 'create_owned_auth', safeCode(created.error?.code), created.error?.status);
        const rows = await db(admin.from('profiles').upsert({ id: actor.id, organization_id: actor.organizationId, email: actor.email, first_name: 'SYNTHETIC', last_name: 'Phase7', status: 'active' }, { onConflict: 'id' }).select(), 'bind_owned_profile');
        ensure(rows.length === 1 && rows[0].organization_id === actor.organizationId, 'bind_owned_profile', 'profile_binding_failed');
        clients[actor.name] = clientFactory(PHASE7.supabaseOrigin, publicKey, sdkOptions);
        const login = await clients[actor.name].auth.signInWithPassword({ email: actor.email, password });
        ensure(!login.error && login.data?.user?.id === actor.id && login.data?.session?.access_token, 'owned_auth_login', 'real_login_failed');
        sessions[actor.name] = login.data.session; secrets.push(login.data.session.access_token, login.data.session.refresh_token);
      }
      await insert('roles', [{ id: ids.roleA, organization_id: ids.orgA, name: marker + '-staff' }, { id: ids.roleB, organization_id: ids.orgB, name: marker + '-foreign' }]);
      await insert('role_permissions', [ids.roleA, ids.roleB].flatMap(role_id => ['social_inbox.read', 'social_inbox.reply_draft', 'social_audit.read', 'pages.read'].map(permission_code => ({ role_id, permission_code }))));
      await insert('user_roles', [{ user_id: ids.staff, role_id: ids.roleA }, { user_id: ids.foreign, role_id: ids.roleB }]);
      await insert('facebook_pages', [{ id: ids.pageA, organization_id: ids.orgA, name: marker + '-Page-A', external_page_id: manifest.pageAExternalId, is_active: true, connection_status: 'connected' },
        { id: ids.pageB, organization_id: ids.orgB, name: marker + '-Page-B', external_page_id: manifest.pageBExternalId, is_active: true, connection_status: 'connected' }]);
      await insert('social_teams', [{ id: ids.primaryA, organization_id: ids.orgA, name: marker + '-primary-A' }, { id: ids.backupA, organization_id: ids.orgA, name: marker + '-backup-A' }, { id: ids.primaryB, organization_id: ids.orgB, name: marker + '-primary-B' }]);
      await insert('social_team_members', [{ team_id: ids.primaryA, user_id: ids.staff }, { team_id: ids.backupA, user_id: ids.staff }, { team_id: ids.primaryB, user_id: ids.foreign }]);
      await insert('social_page_teams', [{ page_id: ids.pageA, team_id: ids.primaryA, assignment_type: 'primary', priority: 1 }, { page_id: ids.pageA, team_id: ids.backupA, assignment_type: 'backup', priority: 1 }, { page_id: ids.pageB, team_id: ids.primaryB, assignment_type: 'primary', priority: 1 }]);
      await insert('social_page_user_access', [{ page_id: ids.pageA, user_id: ids.staff, can_read: true, can_reply: true }, { page_id: ids.pageB, user_id: ids.foreign, can_read: true, can_reply: true }]);
      await db(admin.from('feature_flags').upsert([ids.orgA, ids.orgB].flatMap(organization_id => ['social_inbox_read', 'social_inbox_ai_draft', 'social_inbox_reply_send'].map(key => ({ organization_id, key, enabled: key !== 'social_inbox_reply_send' }))), { onConflict: 'organization_id,key' }).select(), 'owned_fixture_flags');
      stage = 'bot_fixture_create'; ledger.botFixtureAttempted = true; await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
      const created = await fixture('POST'); ensure(created.status === 201, stage, 'fresh_fixture_not_created', created.status); botFixture = validateFixtureSnapshot(created.data, manifest);
      ledger.botFixtureConfirmed = true; ledger.conversationId = botFixture.conversationId; await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
      report.workflow = await runPhase7HttpWorkflow({ manifest, edge, fixture, dbAssert, mutateOwned, check });
      report.checks.push({ name: 'Genuine signed JWT expiry in this bounded review-only run', status: 'SKIPPED', reason: 'No Auth lifetime change; separate hosted-social-access-expiry-20261127.json records actual signed expiry and TTL restoration.' });
      report.checks.push({ name: 'Hosted queued sender revocation and real Meta delivery', status: 'SKIPPED', reason: 'Every send grant/flag remains disabled; this run proves review workflow and denied send only. Local outbox revocation evidence is separate.' });
      report.status = 'PASS_WITH_SKIPS';
    } else report.status = 'CLEANUP_ONLY';
  } catch (error) {
    report.failedStage = error.stage ?? stage; report.failure = { code: safeCode(error.code ?? error.name), ...(Number.isInteger(error.status) ? { status: error.status } : {}) };
    report.checks.push({ name: stage, status: 'FAIL' }); report.status = 'FAIL';
  } finally {
    stage = 'cleanup'; const errors = [];
    const remove = async (table, column, values) => { try { const rows = await db(admin.from(table).delete().in(column, values).select(), 'cleanup_' + table); report.cleanup.counts[table] = rows.length; } catch (error) { errors.push({ resource: table, code: safeCode(error.code), status: error.status }); } };
    let botCleaned = !ledger.botFixtureAttempted;
    if (ledger.botFixtureAttempted) {
      try {
        const deleted = await fixture('DELETE'); ensure(deleted.status === 200, 'cleanup_bot', 'fixture_delete_failed', deleted.status); const tombstone = validateFixtureSnapshot(deleted.data, manifest, 'deleted');
        if (ledger.conversationId) ensure(tombstone.conversationId === ledger.conversationId, 'cleanup_bot', 'fixture_identity_changed');
        const confirmed = await fixture('GET'); ensure(confirmed.status === 200, 'cleanup_bot', 'fixture_tombstone_missing', confirmed.status); validateFixtureSnapshot(confirmed.data, manifest, 'deleted');
        const replay = await fixture('DELETE'); ensure(replay.status === 200 && validateFixtureSnapshot(replay.data, manifest, 'deleted').replayed === true, 'cleanup_bot', 'delete_not_idempotent');
        const resurrect = await fixture('POST'); ensure(resurrect.status === 410, 'cleanup_bot', 'deleted_fixture_recreated', resurrect.status);
        report.cleanup.bot = { status: 'PASS', state: 'deleted', outbox: tombstone.outbox, deleteIdempotencyVerified: true, resurrectionRejected: true, auditAndTombstoneRetained: true }; botCleaned = true;
      } catch (error) { errors.push({ resource: 'bot_fixture', code: safeCode(error.code), status: error.status }); }
    }
    let ownershipSafe = false;
    try {
      const organizations = await db(admin.from('organizations').select('id,slug').in('id', [ids.orgA, ids.orgB]), 'cleanup_ownership');
      ownershipSafe = organizations.every(row => (row.id === ids.orgA && row.slug === marker + '-a') || (row.id === ids.orgB && row.slug === marker + '-b'));
      // A public manifest's UUID alone is not deletion authority. Prove each
      // existing referenced child belongs to this run's expected tenant before
      // deleting any link row, and verify Auth ownership before role cleanup.
      const expected = [
        ['facebook_pages', [[ids.pageA, ids.orgA], [ids.pageB, ids.orgB]]],
        ['social_teams', [[ids.primaryA, ids.orgA], [ids.backupA, ids.orgA], [ids.primaryB, ids.orgB]]],
        ['roles', [[ids.roleA, ids.orgA], [ids.roleB, ids.orgB]]],
        ['profiles', actors.map(actor => [actor.id, actor.organizationId])],
      ];
      for (const [table, bindings] of expected) {
        const allowed = new Map(bindings), children = await db(admin.from(table).select('id,organization_id').in('id', bindings.map(([id]) => id)), 'cleanup_' + table + '_ownership');
        if (children.some(row => row.organization_id !== allowed.get(row.id) && !(table === 'profiles' && row.organization_id === null))) ownershipSafe = false;
      }
      for (const actor of actors) {
        const found = await admin.auth.admin.getUserById(actor.id);
        if (found.error?.status === 404) continue;
        if (found.error || found.data?.user?.id !== actor.id || found.data.user.email !== actor.email || found.data.user.app_metadata?.momo_acceptance_run_id !== runId) ownershipSafe = false;
      }
    } catch (error) { errors.push({ resource: 'ownership', code: safeCode(error.code) }); }
    if (ownershipSafe && botCleaned) {
      await remove('social_page_user_access', 'page_id', [ids.pageA, ids.pageB]); await remove('social_team_members', 'team_id', [ids.primaryA, ids.backupA, ids.primaryB]); await remove('social_page_teams', 'page_id', [ids.pageA, ids.pageB]);
      await remove('audit_logs', 'organization_id', [ids.orgA, ids.orgB]); await remove('feature_flags', 'organization_id', [ids.orgA, ids.orgB]); await remove('user_roles', 'user_id', actors.map(actor => actor.id)); await remove('role_permissions', 'role_id', [ids.roleA, ids.roleB]);
      let authCleaned = true;
      for (const actor of actors) {
        try {
          const found = await admin.auth.admin.getUserById(actor.id);
          if (found.error?.status === 404) continue;
          ensure(!found.error && found.data?.user?.id === actor.id && found.data.user.email === actor.email && found.data.user.app_metadata?.momo_acceptance_run_id === runId, 'cleanup_auth', 'auth_ownership_mismatch');
          const deleted = await admin.auth.admin.deleteUser(actor.id); ensure(!deleted.error, 'cleanup_auth', safeCode(deleted.error?.code), deleted.error?.status);
          const missing = await admin.auth.admin.getUserById(actor.id); ensure(missing.error?.status === 404, 'cleanup_auth', 'auth_deletion_not_verified'); report.cleanup.counts.authUsers = (report.cleanup.counts.authUsers ?? 0) + 1;
        } catch (error) { authCleaned = false; errors.push({ resource: 'auth', code: safeCode(error.code), status: error.status }); }
      }
      await remove('facebook_pages', 'id', [ids.pageA, ids.pageB]); await remove('social_teams', 'id', [ids.primaryA, ids.backupA, ids.primaryB]); await remove('roles', 'id', [ids.roleA, ids.roleB]);
      if (authCleaned && errors.length === 0) await remove('organizations', 'id', [ids.orgA, ids.orgB]);
      for (const [table, values] of [['profiles', actors.map(actor => actor.id)], ['facebook_pages', [ids.pageA, ids.pageB]], ['social_teams', [ids.primaryA, ids.backupA, ids.primaryB]], ['roles', [ids.roleA, ids.roleB]], ['organizations', [ids.orgA, ids.orgB]]]) {
        try { const rows = await db(admin.from(table).select('id').in('id', values), 'verify_cleanup_' + table); report.cleanup.remaining[table] = rows.length; if (rows.length) errors.push({ resource: table, code: 'owned_rows_remain' }); } catch (error) { errors.push({ resource: table, code: safeCode(error.code) }); }
      }
    } else errors.push({ resource: 'ownership', code: ownershipSafe ? 'bot_cleanup_unconfirmed_erp_retained' : 'owned_parent_not_verified' });
    report.cleanup.status = errors.length ? 'FAIL' : 'PASS'; report.cleanup.errors = errors; report.cleanup.providerAuditLogsRetained = true;
    ledger.cleanup = report.cleanup.status; await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
    if (errors.length) report.status = 'FAIL';
  }
  report.counts = { pass: report.checks.filter(item => item.status === 'PASS').length, fail: report.checks.filter(item => item.status === 'FAIL').length + (report.cleanup.status === 'FAIL' ? 1 : 0), skipped: report.checks.filter(item => item.status === 'SKIPPED').length };
  const serialized = JSON.stringify(report, null, 2) + '\n'; ensure(!secrets.filter(secret => secret?.length >= 8).some(secret => serialized.includes(secret)), 'report', 'sensitive_report_rejected');
  await writeFile(reportPath, serialized, { flag: 'wx', mode: 0o600 });
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const result = await runPhase7HostedIntegration(parsePhase7Args(process.argv.slice(2))); console.log(JSON.stringify(result, null, 2)); if (result.status === 'FAIL') process.exitCode = 1; }
  catch (error) { console.error(JSON.stringify({ status: 'FAIL', stage: error.stage ?? 'setup', code: safeCode(error.code ?? error.name) })); process.exitCode = 1; }
}
