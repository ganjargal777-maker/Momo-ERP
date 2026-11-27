# Phase7: actual hosted ERP → Bot acceptance

Date: 2026-11-27. This is synthetic sandbox API acceptance, not production or
real Messenger delivery. No production migration/deployment, paid resource,
Meta request, real customer record or outbound email was used.

## Verified targets and releases

- Supabase Management API: Momoshop `czpybiqfppixwsxtowsi` is **Pro**.
- `MOMO ERP Social Sandbox`: **mmvmvweitrhlgqtjadaz**, ACTIVE_HEALTHY,
  PostgreSQL17.12, Singapore. Production `lxjkkqypiwnnrjmnpick` is excluded.
- Existing18 migrations remain unchanged. Public tables33/33 have RLS;
  public policies95, static permission codes38.
- New sandbox function `social-integration-phase7`, JWT verification ON,
  wraps the existing reviewed contract and refuses every other Supabase URL.
  Source hash `9df699d6174fb4291242ae998eadf82bb580c477c8dcbd04dcf4d81de3de4fa7`.
- Bot FREE service `srv-dc42pjl9el5s73a2d890` at
  https://momoshop-messenger-bot-sandbox.onrender.com,
  deploy `dep-dc4njrui0phs73auecm0`, commit
  `1ba70fcdc6bce24236080c1b7d9e172e83c13fc3`, UI Live/Deploy succeeded28.2s.
  Manual specific-commit deploy preserves source branch `codex/phase6a-hosted-sandbox`.
- Existing sandbox functions retain the same source hashes/JWT settings.
  Supabase secret updates automatically incremented their revision numbers;
  this does not indicate an application-source change. Production functions
  and production service were not accessed.

## Server configuration and contract

Defaults in source remain disabled. Only the dedicated sandbox has:

```dotenv
PHASE7_ENABLED=true
PHASE7_SOCIAL_ADAPTER_MODE=live
PHASE7_SOCIAL_ALLOWED_ORIGINS_JSON=["https://momo-erp-social-sandbox.onrender.com"]
PHASE7_SOCIAL_STAFF_RECHECK_ENABLED=true
PHASE7_FACEBOOK_BOT_ALLOWED_ORIGINS_JSON=["https://momoshop-messenger-bot-sandbox.onrender.com"]
```

`PHASE7_FACEBOOK_BOT_PAGE_REGISTRY_JSON` contains the prepared manifest's
ERP Page UUID, organization UUID, external numeric Page `123456789001`,
apiVersion `1`, fixed Bot origin and tokenEnv `FACEBOOK_BOT_ERP_TOKEN_PHASE7`.
That last secret is server-side only. The wrapper never falls back to a legacy
global Bot URL/token or service-role client. Existing `social-integration`
settings and the frontend function selection are unchanged: this run validates
the separate hosted API endpoint, not a new browser-UI release.

Bot credentials are separate: reader `inbox:read`; gateway writer
`inbox:read,replies:write,replies:approve`; fixture owner `fixtures:write`.
No principal has `replies:send` or `settings:write`. The fixture route defaults
OFF and requires demo mode, explicit synthetic Page, no Meta credentials and
every send/control/catalog/automatic-send flag false. See the Bot counterpart's
`docs/MOMO_PHASE7_FIXTURES.md`. Only its owned fixed SYNTHETIC message is ingested;
the existing `/ingest/dry-run` behavior is unchanged.

HTTP: POST `/functions/v1/social-integration-phase7`, headers `apikey` with a
public project key, `Authorization: Bearer <real staff JWT>`, JSON and the exact
staging Origin. The gateway itself supplies the private Bot Bearer. Examples:

```json
{"action":"list","pageId":"<ERP Page UUID>","resource":"messenger","filters":{"limit":100}}
{"action":"suggest","pageId":"<ERP Page UUID>","resource":"messenger","id":"<conversation UUID>"}
{"action":"edit","pageId":"<ERP Page UUID>","resource":"messenger","reply":{"id":"<reply UUID>","version":1,"text":"SYNTHETIC reviewed answer"}}
{"action":"approve","pageId":"<ERP Page UUID>","resource":"messenger","reply":{"id":"<reply UUID>","version":2}}
```

Success contains `ok:true`, `data` and `meta` with live mode, ERP/external Page
identities, request ID, upstream status and `auditRecorded:true`. Draft/edit/
approve require current `social_inbox.read` and `social_inbox.reply_draft`,
Page read/reply grants, and fixture-org `social_inbox_read`/`social_inbox_ai_draft`
flags. `social_inbox_reply_send` remains false and no staff send grant exists.
Editable user_metadata cannot grant permissions. Re-read on409; do not blindly
retry mutations. Draft provider is deterministic `rules-v1`, model null; paid
LLM inference is not configured or claimed.

## Reproducible execution

Prepare offline before configuring the server Page registry:

```powershell
node scripts/check-phase7-hosted-integration.mjs --prepare --manifest <NEW_ABSOLUTE_MANIFEST>
```

Then use `--execute` with that manifest, private `--keys-file`,
`--connector-file`, `--bot-credentials-file` and a NEW absolute `--report` path.
Private Bot credential JSON has schemaVersion1, projectRef, botOrigin,
writerToken and a distinct fixtureToken. Never place values in argv, Git,
frontend or report. The runner hard-pins both sandbox origins and the Phase7
Edge path; redirects and other targets are rejected. `--cleanup` reconciles
only its matching private ownership ledger. A deleted Bot run cannot be
recreated: prepare a fresh run/registry instead of reusing a completed manifest.

## Actual results

| Check | PASS | FAIL | SKIPPED |
|---|---:|---:|---:|
| Full Bot local regression |188|0|0|
| Full ERP local regression |210|0|2|
| Actual hosted ERP/Auth/RLS/Edge/Bot review workflow |11|0|2|
| Actual local SQLite backup/restore/rollback drill |11|0|0|
| Actual hosted Phase7 disable/restore gates |2|0|0|

ERP public-only build PASS after supplying its existing sandbox public config;
the first clean-checkout build correctly rejected missing configuration. The
two ERP skips are opt-in local PostgreSQL suites without a configured loopback
DB URL, not hosted failures. Hosted skips: a fresh signed-JWT expiry run (prior
separate actual expiry evidence exists) and actual queued dispatch/revocation
while sends are forbidden. No mocked check is counted as hosted PASS.

Hosted run `404263f6-d094-440b-ac8d-e0c3170e828e` used105 native requests
(95 ERP,10 fixture). It verified real live envelopes, JWT/organization/Page/
Origin guards, RLS invisibility, user-metadata denial, list/detail/history,
same-basis suggestion dedup, edit/approve persistence, stale versions409,
repeated send403/no queue, live permission/flag/profile revocation,14 bound
audit rows and final no-send state. Both global Bot outboxes stayed0.

Owned cleanup PASS:3 synthetic Auth users,2 orgs,2 Pages,3 teams,2 roles removed;
actual post-query Auth/users/profiles/orgs/Pages/teams all0. Bot fixture business
rows/draft were deleted with idempotent cleanup/410 resurrection denial; its
audit/tombstone remain. Owned ERP audit rows were checked before synthetic-org
cleanup; platform audit logs remain. No real data was copied.

Rollback: changing only `PHASE7_ENABLED=false` returned503 `phase7_disabled`;
restoring true returned the expected401 `unauthorized` for a public anon caller.
This proves the hosted function switch and restored Auth gate, not a full
release/database/provider rollback. Existing functions' source/JWT stayed equal.

## Storage and remaining gates

Actual local committed-WAL snapshot/restore:15 tables,151552bytes, SHA256 and
integrity/FK/Page binding verified; dedup, approval, audit, simulated queue and
receipts survive; interrupted sending becomes uncertain once; false-send dequeue
cannot claim; transaction/offline-data rollback and corruption guards PASS.
Queue rows in that storage drill are explicitly direct synthetic persistence
fixtures, not hosted authorized dispatch or actual Meta sends.

Sandbox Management API inventory has one COMPLETED physical backup at
2026-11-27T02:54:58.902Z, WAL-G on/PITR off. Inventory is not restore proof and
does not establish that all18 later migrations are present in that snapshot.
A logical hosted dump attempt was stopped when the CLI created managed
`cli_login_postgres` with postgres membership instead of proving read-only.
Its owned process was cancelled, connections0, output0bytes; no second dump,
password reset, network-ban change, bulk role deletion or hosted restore ran.
The temporary role uses provider TTL; see the execution report for expiry proof.
Hosted PostgreSQL restore remains BLOCKED pending a verified safe read-only
connection. Do not turn this partial attempt into a PASS.

The Bot is still Free with ephemeral filesystem. `/var/data` is a path, not a
durable disk. Hosted durable mount/off-host backups/restore and restart/redeploy
dedup acceptance remain BLOCKED. Production send/deployment needs those gates,
explicit send approval, current user/Page/team reauthorization and bounded real
webhook acceptance. Separate approval is required for any new paid resource.
Current no-send hosted API acceptance is ready; production remains NO-GO.

Run artifacts are outside Git in `phase7-hosted-integration-20261127`:
`management-state.json`, `hosted-attempt1.json`, `rollback-disabled.json`,
`rollback-restored.json`, `bot-regression.tap`, `erp-regression.tap`,
`storage-audit.json`, `storage-hosted-restore.json` and the owned storage drill.
Credentials/dumps stay in an owner-only private Windows directory.
