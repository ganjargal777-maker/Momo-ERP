import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createSocialIntegrationHandler } from '../_shared/social-contract.mjs';

// Keep config.toml verify_jwt=true. The handler also verifies getUser(jwt),
// then active profile, organization/global grants, flags and Page RPC grants.
// No service-role client and no browser-supplied upstream URL/token are used.
Deno.serve(createSocialIntegrationHandler({
  createClient,
  env: (name: string) => Deno.env.get(name),
  fetchImpl: fetch,
}));
