import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dist/auth.js', import.meta.url), 'utf8');
const SESSION = { user: { id: 'fixture-user', email: 'fixture@example.invalid' }, access_token: 'fixture.jwt.not-a-real-token' };
const flush = async () => { await new Promise(done => setImmediate(done)); await new Promise(done => setTimeout(done, 2)); };
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

class Element {
  constructor() { this.hidden = true; this.disabled = false; this.textContent = ''; this.value = ''; this.elements = {}; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.nodes = new Map(); }
  querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Element()); return this.nodes.get(selector); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  appendChild(child) { this.children.push(child); return child; }
  focus() {}
  async emit(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
}

function fixture(options = {}) {
  const elements = new Map();
  const document = { body: new Element(), title: 'Synthetic ERP', querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector);
  }, createElement() { return new Element(); } };
  for (const selector of ['#login-form', '#reset-password-form', '#setup-password-form']) {
    const element = document.querySelector(selector);
    for (const key of ['email', 'password', 'confirmPassword']) element.elements[key] = new Element();
    element.elements.email.value = 'fixture@example.invalid';
    element.elements.password.value = 'synthetic-valid-password';
    element.elements.confirmPassword.value = 'synthetic-valid-password';
  }
  let authCallback;
  const calls = { create: [], signIn: [], reset: [], update: [], signOut: [], queries: [], fetch: [], reload: 0, history: [] };
  const resultFor = async table => {
    calls.queries.push(table);
    if (table === 'profiles') return options.profileResult ?? { data: { organization_id: 'fixture-org', first_name: 'Synthetic', last_name: 'Person', email: SESSION.user.email, status: options.inactive ? 'inactive' : 'active' } };
    if (table === 'user_roles') return { data: options.noRoles ? [] : [{ roles: { name: 'Synthetic role', role_permissions: [{ permission_code: 'orders.read' }] } }] };
    if (table === 'organizations') return { data: { name: 'Synthetic organization' } };
    throw new Error('Unexpected fixture query.');
  };
  const session = () => options.session === undefined ? null : options.session;
  const client = {
    from(table) { const query = {
      select() { return query; }, eq() { return query; }, single() { return resultFor(table); }, maybeSingle() { return resultFor(table); },
      then(yes, no) { return resultFor(table).then(yes, no); },
    }; return query; },
    auth: {
      async getSession() { if (options.getSession) return options.getSession(); return { data: { session: session() } }; },
      async signInWithPassword(value) { calls.signIn.push(value); if (options.signIn) return options.signIn(value); return { data: { session: SESSION } }; },
      async resetPasswordForEmail(...args) { calls.reset.push(args); if (options.reset) return options.reset(...args); return {}; },
      async updateUser(value) { calls.update.push(value); if (options.update) return options.update(value); return {}; },
      async signOut(value) { calls.signOut.push(value); if (options.signOutEmitsEvent) authCallback?.('SIGNED_OUT', null); return {}; },
      onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
  const location = { origin: 'https://synthetic-erp.example.invalid', pathname: '/', search: options.search ?? '', hash: options.hash ?? '', reload() { calls.reload++; } };
  const window = { __NEXERP_CONFIG__: options.config ?? { url: 'https://synthetic-supabase.example.invalid', publishableKey: 'sb_publishable_fixture_only_12345678' },
    supabase: { createClient(...args) { calls.create.push(args); return client; } } };
  const sandbox = { document, window, location, history: { replaceState(...args) { calls.history.push(args); } },
    URL, URLSearchParams, atob, AbortSignal, setTimeout, clearTimeout, confirm: () => true,
    FormData: class { constructor(form) { this.form = form; } get(key) { return this.form.elements[key]?.value; } },
    fetch: async (...args) => { calls.fetch.push(args); return options.fetch ? options.fetch(...args) : new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }); },
  };
  runInNewContext(source, sandbox);
  return { window, document, calls, options, client, node: selector => document.querySelector(selector),
    emitAuth: (event, data = SESSION) => authCallback?.(event, data) };
}

test('active authenticated profile loads app once and exposes only assigned permissions', async () => {
  const f = fixture({ session: SESSION }); await flush();
  assert.equal(f.node('#auth-gate').hidden, true);
  assert.equal(f.document.body.className, 'auth-ready');
  assert.equal(f.window.nexerpAuth.profile.organizationId, 'fixture-org');
  assert.equal(f.window.nexerpAuth.can('orders.read'), true);
  assert.equal(f.window.nexerpAuth.can('users.manage'), false);
  assert.deepEqual(f.document.body.children.map(node => node.src), ['app.js']);
});

test('invalid login and thrown network errors show safe errors and release submit button', async () => {
  for (const signIn of [async () => ({ error: { message: 'private-provider-error' } }), async () => { throw new Error('private-provider-secret'); }]) {
    const f = fixture({ signIn }); await flush(); await f.node('#login-form').emit('submit');
    assert.equal(f.node('#login-form').querySelector('button[type="submit"]').disabled, false);
    assert.equal(f.node('#auth-error').hidden, false);
    assert.ok(!f.node('#auth-error').textContent.includes('private-provider'));
    assert.equal(f.window.nexerpAuth, undefined);
  }
});

test('concurrent login submit is deduplicated while the first request is pending', async () => {
  const wait = deferred(), f = fixture({ signIn: () => wait.promise }); await flush();
  const first = f.node('#login-form').emit('submit');
  await f.node('#login-form').emit('submit'); assert.equal(f.calls.signIn.length, 1);
  wait.resolve({ data: { session: SESSION } }); await first;
  assert.equal(f.node('#auth-gate').hidden, true);
});

test('reset request uses same-origin explicit recovery marker and non-enumerating success', async () => {
  const f = fixture(); await flush(); await f.node('#show-reset-password').emit('click');
  await f.node('#reset-password-form').emit('submit');
  assert.deepEqual(plain(f.calls.reset), [[SESSION.user.email, { redirectTo: 'https://synthetic-erp.example.invalid/?reset=1' }]]);
  assert.equal(f.node('#reset-success').hidden, false);
  assert.ok(f.node('#reset-success').textContent.includes('Хэрэв'));
  assert.equal(f.node('#reset-password-form').querySelector('button[type="submit"]').disabled, false);
});

test('reset/update network failures recover their form without printing provider secrets', async () => {
  const f = fixture({ session: SESSION, search: '?reset=1',
    reset: async () => { throw new Error('private-mail-provider-secret'); },
    update: async () => { throw new Error('private-password-provider-secret'); } });
  await flush(); await f.node('#reset-password-form').emit('submit'); await f.node('#setup-password-form').emit('submit');
  assert.equal(f.node('#reset-password-form').querySelector('button[type="submit"]').disabled, false);
  assert.equal(f.node('#setup-password-form').querySelector('button[type="submit"]').disabled, false);
  assert.ok(!f.node('#reset-error').textContent.includes('private-'));
  assert.ok(!f.node('#setup-error').textContent.includes('private-'));
});

test('recovery event cancels a pending ordinary authorization before any app is shown', async () => {
  const wait = deferred(), f = fixture({ session: SESSION, profileResult: wait.promise });
  await flush(); f.emitAuth('PASSWORD_RECOVERY');
  wait.resolve({ data: { organization_id: 'fixture-org', status: 'active' } }); await flush();
  assert.equal(f.node('#setup-password-form').hidden, false);
  assert.equal(f.window.nexerpAuth, undefined);
  assert.equal(f.document.body.children.length, 0);
  assert.equal(f.document.body.className, 'auth-pending');
});

test('explicit reset marker waits for password update before loading app; mismatch never calls update', async () => {
  const f = fixture({ session: SESSION, search: '?reset=1' }); await flush();
  assert.equal(f.node('#setup-password-form').hidden, false); assert.equal(f.calls.queries.length, 0);
  const form = f.node('#setup-password-form'); form.elements.confirmPassword.value = 'wrong-password';
  await form.emit('submit'); assert.equal(f.calls.update.length, 0);
  form.elements.confirmPassword.value = form.elements.password.value;
  await form.emit('submit');
  assert.equal(f.calls.update.length, 1); assert.equal(f.node('#auth-gate').hidden, true);
  assert.equal(f.calls.history[0][2], '/');
});

test('expired recovery link shows login and a bounded error without loading app', async () => {
  const f = fixture({ search: '?reset=1' }); await flush();
  assert.equal(f.node('#login-form').hidden, false);
  assert.ok(f.node('#auth-error').textContent.includes('хүчингүй'));
  assert.equal(f.document.body.children.length, 0);
});

test('SIGNED_OUT clears authorization and reloads private app state', async () => {
  const f = fixture({ session: SESSION }); await flush(); f.emitAuth('SIGNED_OUT', null);
  assert.equal(f.window.nexerpAuth, undefined); assert.equal(f.node('#auth-gate').hidden, false);
  assert.equal(f.node('.app-shell').attributes.get('aria-hidden'), 'true'); assert.equal(f.calls.reload, 1);
});

test('late getSession or deferred SIGNED_IN cannot restore a signed-out user', async () => {
  const wait = deferred(), f = fixture({ getSession: () => wait.promise });
  f.emitAuth('SIGNED_IN'); f.emitAuth('SIGNED_OUT', null);
  wait.resolve({ data: { session: SESSION } }); await flush();
  assert.equal(f.window.nexerpAuth, undefined); assert.equal(f.calls.queries.length, 0);
  assert.equal(f.document.body.children.length, 0);
});

test('late initial session failure cannot hide a subsequent successful login', async () => {
  const wait = deferred(), f = fixture({ getSession: () => wait.promise });
  await f.node('#login-form').emit('submit');
  assert.equal(f.node('#auth-gate').hidden, true);
  wait.reject(new Error('private-stale-bootstrap-error')); await flush();
  assert.equal(f.document.body.className, 'auth-ready');
  assert.equal(f.node('#auth-gate').hidden, true);
  assert.equal(f.node('#auth-error').hidden, true);
  assert.equal(f.window.nexerpAuth.profile.id, SESSION.user.id);
});

test('manual logout plus SIGNED_OUT event schedules one reload and cannot reauthorize before navigation', async () => {
  const f = fixture({ session: SESSION, signOutEmitsEvent: true }); await flush();
  await f.node('#auth-profile').emit('click');
  f.emitAuth('SIGNED_OUT', null); f.emitAuth('SIGNED_IN'); await flush();
  assert.equal(f.calls.signOut.length, 1);
  assert.equal(f.calls.reload, 1);
  assert.equal(f.window.nexerpAuth, undefined);
  assert.equal(f.node('#auth-gate').hidden, false);
  assert.equal(f.document.body.className, 'auth-pending');
});

test('inactive or role-less users remain denied with no private application', async () => {
  for (const options of [{ inactive: true }, { noRoles: true }]) {
    const f = fixture({ session: SESSION, ...options }); await flush();
    assert.equal(f.window.nexerpAuth, undefined); assert.equal(f.document.body.children.length, 0);
    assert.equal(f.calls.signOut.length, 1); assert.equal(f.node('#auth-error').hidden, false);
  }
});

test('missing/privileged frontend config fails closed before SDK construction', async () => {
  for (const config of [{}, { url: 'http://unsafe.example.invalid', publishableKey: 'sb_publishable_fixture12345678' },
    { url: 'https://synthetic.example.invalid', publishableKey: 'sb_secret_private_12345678' }]) {
    const f = fixture({ config }); await flush();
    assert.equal(f.calls.create.length, 0); assert.equal(f.node('#login-form').querySelector('button[type="submit"]').disabled, true);
    assert.equal(f.document.body.children.length, 0);
  }
});

test('authenticated function transport retains structured safe errors and does not accept a path', async () => {
  const f = fixture({ session: SESSION, fetch: async () => new Response(JSON.stringify({ ok: false,
    error: { code: 'permission_denied', message: 'Synthetic denied', requestId: 'fixture-request-1' } }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }) }); await flush();
  await assert.rejects(f.window.nexerpAuth.invokeAuthenticated('../admin', {}), /нэр буруу/);
  assert.equal(f.calls.fetch.length, 0);
  await assert.rejects(f.window.nexerpAuth.invokeAuthenticated('invite-user', {}), /Synthetic denied \(ID: fixture-request-1\)/);
  assert.equal(f.calls.fetch[0][1].redirect, 'error');
  assert.equal(f.calls.fetch[0][1].headers.Authorization, `Bearer ${SESSION.access_token}`);
});
