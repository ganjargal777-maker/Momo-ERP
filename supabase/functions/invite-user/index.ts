import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createInviteHandler } from './handler.mjs';

// verify_jwt stays true in config.toml. The factory additionally verifies the
// caller with Auth and checks active same-org users.manage before inviting.
Deno.serve(createInviteHandler({
  createClient,
  env: (name: string) => Deno.env.get(name),
  logger: (event: { stage: string }) => console.error('invite-user', event),
}));
