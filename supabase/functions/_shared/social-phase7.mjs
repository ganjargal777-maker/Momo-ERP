import { createSocialIntegrationHandler } from './social-contract.mjs';

// This acceptance entrypoint is intentionally bound to a dedicated test project.
// It cannot be enabled on production by copying environment variables.
export const PHASE7_SUPABASE_URL = 'https://mmvmvweitrhlgqtjadaz.supabase.co';
const PUBLIC_KEYS = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS']);
const ISOLATED_KEYS = new Set([
  'SOCIAL_ADAPTER_MODE', 'SOCIAL_ALLOWED_ORIGINS_JSON',
  'SOCIAL_STAFF_RECHECK_ENABLED', 'FACEBOOK_BOT_ALLOWED_ORIGINS_JSON',
  'FACEBOOK_BOT_PAGE_REGISTRY_JSON',
]);

export function phase7SocialEnvironment(source) {
  const read = typeof source === 'function' ? source : name => source?.[name];
  return name => {
    if (PUBLIC_KEYS.has(name)) return read(name);
    if (name === 'FACEBOOK_BOT_ERP_TOKEN_PHASE7') return read(name);
    if (ISOLATED_KEYS.has(name)) {
      const value = read(`PHASE7_${name}`);
      if (value !== undefined) return value;
      if (name === 'SOCIAL_ADAPTER_MODE') return 'mock';
      if (name === 'SOCIAL_STAFF_RECHECK_ENABLED') return 'false';
      if (name.endsWith('_JSON')) return '[]';
    }
    return undefined;
  };
}

export function createPhase7SocialHandler({ env = {}, ...dependencies } = {}) {
  const read = typeof env === 'function' ? env : name => env?.[name];
  const handler = createSocialIntegrationHandler({ ...dependencies, env: phase7SocialEnvironment(read) });
  return request => {
    if (read('PHASE7_ENABLED') !== 'true' || read('SUPABASE_URL') !== PHASE7_SUPABASE_URL) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'phase7_disabled' } }), {
        status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    return handler(request);
  };
}
