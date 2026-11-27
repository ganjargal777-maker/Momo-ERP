import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createPhase7SocialHandler } from '../_shared/social-phase7.mjs';

// Dedicated synthetic acceptance endpoint. JWT verification stays enabled.
// Existing social-integration settings and production functions are unaffected.
Deno.serve(createPhase7SocialHandler({
  createClient,
  env: (name: string) => Deno.env.get(name),
  fetchImpl: fetch,
}));
