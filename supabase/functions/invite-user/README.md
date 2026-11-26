# Employee invitation handler

`index.ts` pins Supabase JS 2.112.3 and mounts the dependency-injected
`createInviteHandler({createClient, env, logger?, timeoutMs?, maxBodyBytes?})`
factory from `handler.mjs`. Importing that module on Node does not read secrets,
load the SDK, open a server, send mail or call a database. Actual local browser
acceptance supplies a real SDK client connected exclusively to its local stack;
unit tests inject fakes. That Node adapter is not a deployed Edge gateway test.

Only server-side `ERP_INVITE_REDIRECT_URL` selects the invitation callback.
Absent configuration preserves `https://erp.momoshop.mn/?setup=1`. A configured
local callback must be an exact canonical URL such as
`http://127.0.0.1:30231/?setup=1` or `http://localhost:4173/?setup=1`.
The positive explicit port, root path and sole setup query are required. Other
hosts, userinfo, fragments, extra parameters, wildcards and URL normalization
tricks are rejected before any SDK client or email is used. Dynamic local
origins are CORS-allowed only when derived from that validated server setting;
canonical production and existing localhost:4173 origins remain allowed.
Request body and Origin cannot choose or override the emailed callback.

For an ephemeral local stack, also put that **exact** callback in that stack's
Auth redirect allowlist and use its local mail sink. The checked-in Auth source
allows the fixed localhost:4173 setup URL. Dynamic URLs are not wildcard additions
to production configuration, and this change does not push hosted Auth settings.

The factory checks the caller's Auth user, active profile, `users.manage` and
same-organization role before constructing the privileged client. It preserves
`provision_invited_user`, employment date/calendar validation, profile fields and
active flag semantics. Server-only keys and raw SDK exceptions never appear in
responses or logs. Optional logger events contain a fixed stage name only.

Requests are body-size/deadline bounded. A timeout or thrown **or returned**
provider failure after mutation starts returns `outcomeUnknown=true`; it does
not assert that email was not sent. Supabase/PostgREST may return an error
object with status 0, 503 or 504 instead of throwing; those and malformed/null
RPC results are unknown outcomes. Provisioning success requires a confirmed
void RPC response (HTTP 200/204, explicit `error:null`, expected empty data).
Only an explicit known PostgreSQL SQLSTATE paired with its expected HTTP status
is treated as a confirmed SQL rejection. It still requires reconciliation.

**There is no automatic Auth user deletion.** GoTrue can return an existing
unconfirmed user's ID, so even a confirmed SQL rejection cannot prove this
operation owns that Auth account exclusively. A second concurrent invitation
must not delete another operation's correctly provisioned employee. On any
provisioning failure the Auth invitation is retained and
`reconciliationRequired=true`; unknown outcomes additionally set
`outcomeUnknown=true`. An authorized operator must check Auth/profile/role
state before manual repair or a retry. The handler never claims cancellation
succeeded and performs no automatic resend.

There is no new cross-window persistent invitation operation receipt in this
refactor. Frontend submit locking plus Auth duplicate handling is not a durable
exactly-once invitation guarantee. Before retrying after an uncertain outcome,
an authorized operator must reconcile Auth/profile/role state. Local tests use
synthetic accounts and never send a real email or alter production data.
