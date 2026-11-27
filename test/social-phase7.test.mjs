import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhase7SocialHandler, phase7SocialEnvironment, PHASE7_SUPABASE_URL } from '../supabase/functions/_shared/social-phase7.mjs';

test('Phase7 defaults are isolated and disabled, regardless of existing global adapter credentials', async () => {
  let clients = 0, requests = 0;
  const source = { SUPABASE_URL: PHASE7_SUPABASE_URL, SOCIAL_ADAPTER_MODE: 'live',
    SOCIAL_ALLOWED_ORIGINS_JSON: '["https://erp.momoshop.mn"]',
    FACEBOOK_BOT_API_BASE_URL: 'https://production.invalid', FACEBOOK_BOT_ERP_TOKEN: 'existing-secret',
    SUPABASE_SERVICE_ROLE_KEY: 'privileged-secret' };
  const get = phase7SocialEnvironment(source);
  assert.equal(get('SOCIAL_ADAPTER_MODE'), 'mock');
  assert.equal(get('SOCIAL_ALLOWED_ORIGINS_JSON'), '[]');
  assert.equal(get('SOCIAL_STAFF_RECHECK_ENABLED'), 'false');
  assert.equal(get('FACEBOOK_BOT_PAGE_REGISTRY_JSON'), '[]');
  for (const key of ['FACEBOOK_BOT_API_BASE_URL', 'FACEBOOK_BOT_ERP_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'FACEBOOK_BOT_ERP_TOKEN_OTHER']) assert.equal(get(key), undefined);
  const handler = createPhase7SocialHandler({ env: source, createClient: () => { clients++; throw new Error(); }, fetchImpl: () => { requests++; throw new Error(); } });
  const response = await handler(new Request(PHASE7_SUPABASE_URL + '/functions/v1/social-integration-phase7', { method: 'POST' }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'phase7_disabled');
  assert.equal(clients, 0); assert.equal(requests, 0);
});

test('even explicitly enabled Phase7 refuses another project before Auth, database or HTTP', async () => {
  for (const url of ['https://lxjkkqypiwnnrjmnpick.supabase.co', 'https://other.invalid', PHASE7_SUPABASE_URL + '/', undefined]) {
    const handler = createPhase7SocialHandler({ env: { PHASE7_ENABLED: 'true', SUPABASE_URL: url }, createClient: () => assert.fail('must not create privileged/network client'), fetchImpl: () => assert.fail('must not perform HTTP') });
    assert.equal((await handler(new Request('https://example.invalid'))).status, 503);
  }
});

test('Phase7 maps only explicitly prefixed social configuration and one dedicated Bot credential', () => {
  const values = { SUPABASE_URL: PHASE7_SUPABASE_URL, SUPABASE_ANON_KEY: 'public-anon',
    PHASE7_SOCIAL_ADAPTER_MODE: 'live', PHASE7_SOCIAL_ALLOWED_ORIGINS_JSON: '["https://staging.invalid"]',
    PHASE7_SOCIAL_STAFF_RECHECK_ENABLED: 'true', PHASE7_FACEBOOK_BOT_ALLOWED_ORIGINS_JSON: '["https://sandbox.invalid"]',
    PHASE7_FACEBOOK_BOT_PAGE_REGISTRY_JSON: '[{"synthetic":true}]', FACEBOOK_BOT_ERP_TOKEN_PHASE7: 'test-only-bearer',
    SOCIAL_ADAPTER_MODE: 'mock', FACEBOOK_BOT_PAGE_REGISTRY_JSON: 'unrelated-global-registry' };
  const get = phase7SocialEnvironment(name => values[name]);
  for (const name of ['SOCIAL_ADAPTER_MODE', 'SOCIAL_ALLOWED_ORIGINS_JSON', 'SOCIAL_STAFF_RECHECK_ENABLED', 'FACEBOOK_BOT_ALLOWED_ORIGINS_JSON', 'FACEBOOK_BOT_PAGE_REGISTRY_JSON']) assert.equal(get(name), values['PHASE7_' + name]);
  assert.equal(get('FACEBOOK_BOT_ERP_TOKEN_PHASE7'), 'test-only-bearer');
  assert.equal(get('SUPABASE_ANON_KEY'), 'public-anon');
});

test('enabled Phase7 retains the shared gateway CORS/Auth guards without provider calls', async () => {
  let calls = 0;
  const handler = createPhase7SocialHandler({ env: { PHASE7_ENABLED: 'true', SUPABASE_URL: PHASE7_SUPABASE_URL,
    PHASE7_SOCIAL_ALLOWED_ORIGINS_JSON: '["https://momo-erp-social-sandbox.onrender.com"]' },
    createClient: () => { calls++; throw new Error('must reject before client'); }, fetchImpl: () => assert.fail('no provider') });
  const request = origin => new Request(PHASE7_SUPABASE_URL + '/functions/v1/social-integration-phase7', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await handler(request('https://unexpected.invalid'))).status, 403);
  assert.equal((await handler(request('https://momo-erp-social-sandbox.onrender.com'))).status, 401);
  assert.equal(calls, 0);
});
