import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createInviteHandler } from '../supabase/functions/invite-user/handler.mjs';

const roleId = '00000000-0000-4000-8000-000000000001';
const input = { email: 'staff@example.invalid', firstName: 'Test', lastName: 'Staff',
  department: 'Test', position: 'Staff', phone: '99000000', roleId };
const localSetup = 'http://localhost:4173/?setup=1';
const secret = 'synthetic-private-server-key-never-print';
const jwt = 'synthetic.private.jwt';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(options = {}) {
  const invites = [], provisions = [], deleted = [], logs = [], clients = [];
  function lookup(table, privileged) {
    const query = {
      select: () => query, eq: () => query, ilike: () => query,
      single: async () => options.profileThrow ? Promise.reject(new Error(secret)) : ({ data: {
        organization_id: options.organization ?? 'tenant', status: options.inactive ? 'disabled' : 'active' }, error: options.profileError ? { message: secret } : null }),
      maybeSingle: async () => privileged ? { data: options.duplicate ? { id: 'existing' } : null,
        error: options.duplicateError ? { message: secret } : null }
        : { data: options.missingRole ? null : { id: roleId, organization_id: options.foreignRole ? 'other-tenant' : (options.organization ?? 'tenant') },
          error: options.roleError ? { message: secret } : null },
    };
    return query;
  }
  const createClient = (_url, key, config) => {
    const privileged = key === secret; clients.push({ privileged, config });
    return {
      from: table => lookup(table, privileged),
      auth: {
        getUser: async token => {
          assert.equal(token, jwt);
          if (options.userPromise) return options.userPromise;
          return { data: { user: options.badJwt ? null : { id: 'actor', is_anonymous: options.anonymous === true } }, error: options.badJwt ? { message: secret } : null };
        },
        admin: {
          inviteUserByEmail: async (email, invitationOptions) => {
            invites.push({ email, options: invitationOptions });
            if (options.inviteThrow) throw new Error(secret + ' ' + jwt);
            if (options.invitePromise) return options.invitePromise;
            if (Object.hasOwn(options, 'inviteResult')) return options.inviteResult;
            return { data: options.inviteError ? null : { user: { id: options.sharedAuth?.id ?? 'invited' } },
              error: options.inviteError ? { message: options.inviteError + ' ' + secret, status: options.inviteStatus ?? 422 } : null };
          },
          deleteUser: async id => { deleted.push(id); if (options.sharedAuth) options.sharedAuth.exists = false; if (options.cleanupThrow) throw new Error(secret); return { error: options.cleanupError ? { message: secret } : null }; },
        },
      },
      rpc: async (name, payload) => {
        if (name === 'has_permission') { assert.equal(payload.required_permission, 'users.manage'); return { data: options.denied !== true, error: options.permissionError ? { message: secret } : null }; }
        assert.equal(privileged, true); assert.equal(name, 'provision_invited_user'); provisions.push(payload);
        if (options.provisionThrow) throw new Error(secret + ' ' + jwt);
        if (Object.hasOwn(options, 'provisionResult')) return options.provisionResult;
        return { data: null, error: options.provisionError ? { code: 'P0001', message: secret } : null,
          status: options.provisionError ? 400 : 204, statusText: options.provisionError ? 'Bad Request' : 'No Content' };
      },
    };
  };
  const env = { SUPABASE_URL: 'http://localhost', SUPABASE_ANON_KEY: 'synthetic-public',
    SUPABASE_SERVICE_ROLE_KEY: secret, ERP_INVITE_REDIRECT_URL: options.callback === undefined ? localSetup : options.callback };
  if (options.defaultCallback) delete env.ERP_INVITE_REDIRECT_URL;
  const handler = createInviteHandler({ createClient, env: name => env[name], logger: event => logs.push(event),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
  const submit = (body = input, { origin = 'http://localhost:4173', authorization = `Bearer ${jwt}`, method = 'POST', raw } = {}) => {
    const headers = { Origin: origin, Authorization: authorization, 'Content-Type': 'application/json' };
    return handler(new Request('http://localhost/functions/v1/invite-user', { method, headers,
      ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {}) }));
  };
  const safe = async response => {
    const result = await response.json();
    assert.ok(!JSON.stringify({ result, logs }).includes(secret));
    assert.ok(!JSON.stringify({ result, logs }).includes(jwt));
    assert.equal(result.requestId, response.headers.get('x-request-id'));
    return result;
  };
  return { submit, safe, invites, provisions, deleted, logs, clients };
}

test('malformed bodies and impossible dates stop before invite or provision', async () => {
  const f = fixture();
  for (const body of [null, [], false, { ...input, startDate: '2026-02-30' }, { ...input, startDate: false }]) {
    assert.equal((await f.submit(body)).status, 400);
  }
  assert.deepEqual(f.invites, []); assert.deepEqual(f.provisions, []);
});
test('unknown/malformed server callback fails closed before SDK clients or email', async () => {
  for (const callback of ['https://example.invalid', '', 'http://localhost:4173/?setup=1&next=elsewhere', 'http://127.0.0.1:0/?setup=1']) {
    const f = fixture({ callback }); const response = await f.submit(); assert.equal(response.status, 500); await f.safe(response);
    assert.deepEqual(f.clients, []); assert.deepEqual(f.invites, []);
  }
});
test('dynamic loopback callback origin is allowed only when it is server-configured', async () => {
  const origin = 'http://127.0.0.1:30231';
  const f = fixture({ callback: origin + '/?setup=1' });
  const preflight = await f.submit(undefined, { method: 'OPTIONS', origin });
  assert.equal(preflight.status, 200); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  const response = await f.submit(input, { origin }); assert.equal(response.status, 200); await f.safe(response);
  assert.equal(f.invites[0].options.redirectTo, origin + '/?setup=1');
  const denied = fixture(); assert.equal((await denied.submit(input, { origin })).status, 403); assert.deepEqual(denied.invites, []);
});
test('unknown origins and preflight are denied without CORS fallback or SDK calls', async () => {
  const f = fixture();
  for (const method of ['POST', 'OPTIONS']) {
    const response = await f.submit(input, { method, origin: 'https://attacker.example.invalid' });
    assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null); await f.safe(response);
  }
  assert.deepEqual(f.clients, []);
});
test('missing/bad/anonymous sessions, inactive profiles and missing permissions cannot invite', async () => {
  const missing = fixture(); assert.equal((await missing.submit(input, { authorization: '' })).status, 401);
  for (const [options, expected] of [[{ badJwt: true }, 401], [{ anonymous: true }, 401], [{ inactive: true }, 403],
    [{ denied: true }, 403], [{ permissionError: true }, 403], [{ profileError: true }, 403]]) {
    const f = fixture(options), response = await f.submit(); assert.equal(response.status, expected); await f.safe(response);
    assert.deepEqual(f.invites, []); assert.ok(f.clients.every(client => !client.privileged));
  }
});
test('role stays same-organization and lookup failures cannot bypass preconditions', async () => {
  for (const [options, expected] of [[{ foreignRole: true }, 400], [{ missingRole: true }, 400], [{ roleError: true }, 500], [{ duplicateError: true }, 500]]) {
    const f = fixture(options), response = await f.submit(); assert.equal(response.status, expected); await f.safe(response); assert.deepEqual(f.invites, []);
  }
});
test('valid invite ignores body callback/org overrides and provisions exact date and active flag', async () => {
  const f = fixture(); const response = await f.submit({ ...input, email: ' STAFF@EXAMPLE.INVALID ', startDate: '2024-02-29', active: false,
    redirectTo: 'https://attacker.example.invalid', organization_id: 'other-tenant', actor_user_id: 'other-actor' });
  assert.equal(response.status, 200); const result = await f.safe(response); assert.equal(result.userId, 'invited');
  assert.equal(f.invites.length, 1); assert.equal(f.invites[0].email, 'staff@example.invalid');
  assert.equal(f.invites[0].options.redirectTo, localSetup);
  assert.equal(f.provisions[0].profile_start_date, '2024-02-29'); assert.equal(f.provisions[0].profile_is_active, false);
  assert.equal(f.provisions[0].target_organization_id, 'tenant'); assert.equal(f.provisions[0].actor_user_id, 'actor');
});
test('missing callback preserves canonical hosted default while Origin never chooses destination', async () => {
  const f = fixture({ defaultCallback: true }); assert.equal((await f.submit()).status, 200);
  assert.equal(f.invites[0].options.redirectTo, 'https://erp.momoshop.mn/?setup=1');
});
test('duplicate accounts and provider rate/rejection messages remain bounded and sanitized', async () => {
  const duplicate = fixture({ duplicate: true }); assert.equal((await duplicate.submit()).status, 409); assert.deepEqual(duplicate.invites, []);
  for (const [inviteError, inviteStatus, expected] of [['already registered', 422, 409], ['rate limit exceeded', 429, 502], ['private provider rejection', 400, 502]]) {
    const f = fixture({ inviteError, inviteStatus }), response = await f.submit(); assert.equal(response.status, expected);
    assert.equal((await f.safe(response)).outcomeUnknown, false);
    assert.deepEqual(f.provisions, []);
  }
});
test('confirmed SQL rejection retains Auth invitation for reconciliation without claiming cancellation', async () => {
  for (const [code, status] of [['P0001', 400], ['42501', 403], ['23505', 409]]) {
    const f = fixture({ provisionResult: { data: null, error: { code, message: secret }, status } });
    const response = await f.submit(); assert.equal(response.status, 500);
    const result = await f.safe(response); assert.deepEqual(f.deleted, []);
    assert.equal(result.outcomeUnknown, false); assert.equal(result.reconciliationRequired, true);
    assert.equal(result.code, 'profile_provisioning_failed'); assert.ok(!result.error.includes('цуцаллаа'));
  }
});
test('returned RPC transport/gateway/malformed results remain unknown and never delete Auth user', async () => {
  const failures = [
    { data: null, error: { code: '', message: 'TypeError: fetch failed ' + secret }, status: 0 },
    { data: null, error: { code: '', message: secret }, status: 503 },
    { data: null, error: { code: '', message: secret }, status: 504 },
    { data: null, error: { code: 'P0001', message: secret }, status: 503 },
    { data: null, error: { code: '23505', message: secret }, status: 400 },
    { data: null, error: { code: 'PGRST000', message: secret }, status: 503 },
    { data: null, error: { code: 'XX000', message: secret }, status: 500 },
    null, undefined, {}, { error: null, status: 204 }, { error: null, data: undefined, status: 200 },
    { error: null, data: null, status: 503 }, { error: undefined, data: null, status: 200 },
    { error: null, data: { unexpected: 'RPC is void' }, status: 200 },
  ];
  for (const provisionResult of failures) {
    const f = fixture({ provisionResult }), response = await f.submit(); assert.equal(response.status, 502);
    const result = await f.safe(response); assert.equal(result.code, 'provision_outcome_unknown');
    assert.equal(result.outcomeUnknown, true); assert.equal(result.reconciliationRequired, true);
    assert.deepEqual(f.deleted, []); assert.equal(f.provisions.length, 1);
  }
});
test('success requires confirmed void RPC response rather than absence of an error property', async () => {
  for (const provisionResult of [{ data: null, error: null, status: 204 }, { data: null, error: null, status: 200 }, { data: '', error: null, status: 200 }]) {
    const f = fixture({ provisionResult }), response = await f.submit(); assert.equal(response.status, 200);
    assert.equal((await f.safe(response)).ok, true); assert.deepEqual(f.deleted, []);
  }
});
test('returned Auth network/gateway errors and missing user cannot claim email was not sent', async () => {
  const results = [
    { data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'TypeError: fetch failed ' + secret } },
    { data: { user: null }, error: { status: 503, message: secret } },
    { data: { user: null }, error: { status: 504, message: 'already exists ' + secret } },
    { data: { user: null }, error: { message: secret } },
    { data: { user: null }, error: null },
  ];
  for (const inviteResult of results) {
    const f = fixture({ inviteResult }), response = await f.submit(); assert.equal(response.status, 502);
    const result = await f.safe(response); assert.equal(result.code, 'invitation_outcome_unknown');
    assert.equal(result.outcomeUnknown, true); assert.equal(result.reconciliationRequired, true);
    assert.deepEqual(f.provisions, []); assert.deepEqual(f.deleted, []);
  }
});
test('concurrent cross-org attempts reusing an unconfirmed Auth ID cannot delete the first employee', async () => {
  const sharedAuth = { id: 'reused-unconfirmed-user', exists: true };
  const first = fixture({ sharedAuth, organization: 'tenant-A' });
  const second = fixture({ sharedAuth, organization: 'tenant-B', provisionError: true });
  const [success, rejected] = await Promise.all([first.submit(), second.submit()]);
  assert.equal(success.status, 200); assert.equal(rejected.status, 500);
  assert.equal((await first.safe(success)).userId, sharedAuth.id);
  assert.equal((await second.safe(rejected)).reconciliationRequired, true);
  assert.equal(first.provisions[0].invited_user_id, second.provisions[0].invited_user_id);
  assert.deepEqual(first.deleted, []); assert.deepEqual(second.deleted, []); assert.equal(sharedAuth.exists, true);
});
test('thrown SDK failures never leak credentials; uncertain provision does not delete possibly committed user', async () => {
  for (const options of [{ profileThrow: true }, { inviteThrow: true }, { provisionThrow: true }]) {
    const f = fixture(options), response = await f.submit(); assert.equal(response.status, 502); const result = await f.safe(response);
    assert.equal(result.outcomeUnknown, !options.profileThrow); assert.deepEqual(f.deleted, []);
  }
});
test('oversized and malformed JSON bodies do not send an invitation', async () => {
  const f = fixture(); assert.equal((await f.submit(undefined, { raw: '{malformed' })).status, 400);
  assert.equal((await f.submit({ ...input, firstName: 'x'.repeat(70000) })).status, 413); assert.deepEqual(f.invites, []);
});
test('bounded read timeout prevents later invite; in-flight invitation timeout remains explicitly uncertain', async () => {
  const user = deferred(), before = fixture({ userPromise: user.promise, timeoutMs: 10 });
  let response = await before.submit(); assert.equal(response.status, 504); assert.equal((await before.safe(response)).outcomeUnknown, false);
  user.resolve({ data: { user: { id: 'actor' } } }); await new Promise(done => setImmediate(done)); assert.deepEqual(before.invites, []);
  const invite = deferred(), after = fixture({ invitePromise: invite.promise, timeoutMs: 10 });
  response = await after.submit(); assert.equal(response.status, 504); assert.equal((await after.safe(response)).outcomeUnknown, true);
  invite.resolve({ data: { user: { id: 'invited' } } }); await new Promise(done => setImmediate(done)); assert.deepEqual(after.provisions, []);
});
test('Edge entrypoint pins SDK and delegates to the tested factory without logging raw SDK objects', async () => {
  const source = await readFile(new URL('../supabase/functions/invite-user/index.ts', import.meta.url), 'utf8');
  assert.match(source, /npm:@supabase\/supabase-js@2\.112\.3/u); assert.match(source, /createInviteHandler/u);
  assert.ok(!source.includes('inviteError')); assert.ok(!source.includes('roleError'));
});
