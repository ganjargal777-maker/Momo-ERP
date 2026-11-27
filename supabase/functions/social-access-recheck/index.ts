import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createSocialAccessRecheckHandler } from '../_shared/social-access-recheck.mjs';

// verify_jwt=false is deliberate for this opaque bot connector credential.
// The tested handler authenticates it before using the service-only RPC.
Deno.serve(createSocialAccessRecheckHandler({
  createClient,
  env: (name: string) => Deno.env.get(name),
}));
