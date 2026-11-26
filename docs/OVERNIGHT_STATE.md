# MOMO ERP overnight state

Updated: 2026-11-26, Asia/Ulaanbaatar. Owner requests hourly independent safe
development until **2026-11-27 08:00 +08:00**; no production deployment, secret
changes, paid service, database reset or real customer test data.

## Catalog stock — 2026-11-26 23:00 run, Asia/Ulaanbaatar

Implementation and evidence commit `0c277ec` on verified merged base
`d4ed605`. Catalog cards, the product form and warehouse list now use per-product
totals across all permitted warehouses. A missing result or lost permission
leaves stock unavailable. Inventory CSV identifies the capped sample when truncated.

Local synthetic results from this commit:

- Unit and contract regression: 156 PASS / 0 FAIL / 2 SKIPPED (DB entrypoints).
- Regression with PostgreSQL 15: 222 PASS / 0 FAIL / 2 SKIPPED, including the
  500-ID boundary, true zero, cross-tenant exclusion and revoked access. The
  separate legacy entrypoint ran nested; the own-assigned-only policy stays gated.
- Chromium with GoTrue, PostgREST, PG15 and Mailpit: 17 PASS / 0 FAIL. With
  502 balance rows the 500-row sample omitted all 8 units of one SKU and 7
  units of another. Both catalog and warehouse list displayed 8 and 507.
  All 14 local migrations applied and the owned stack was removed.
- Current evidence is in `docs/evidence/browser-erp-acceptance.json`,
  `core-pg15-tests.tap`, `core-pg15-validation.json` and
  `erp-readiness-regression.tap` in the same directory.

Next: correct dashboard low/out-of-stock product counts. The existing summary
counts warehouse balance rows and misses active products without balance rows.
Test multi-warehouse stock and a true zero against the same SKU totals used in
the catalog. Full catalog pagination and full exports are still open.
Hosted acceptance and production rollout remain BLOCKED on the gates below.

## Prior integration at d4ed605 — 2026-11-26 Asia/Ulaanbaatar

Invitation commits `6791cc4`/`a973b4f` and readiness `c4c088c` are integrated on
`codex/overnight-erp-20261126`; both histories are preserved. Prior invitation
evidence is archived in `docs/history/overnight-invitations-20261126.md`.
Final database/browser results for the combined source are recorded below.
No production changes were performed.

## Accepted checkpoint

- Active development branch: `codex/overnight-erp-20261126` (this checkpoint).
- Previous readiness branch: `codex/erp-production-readiness` (`c4c088c`).
- Automation branch: `codex/overnight-erp-20261126`.
- Automation ID: `momo-erp-overnight`, ACTIVE, hourly at minute00, local execution.
- Source origin: `https://github.com/ganjargal777-maker/Momo-ERP.git`.
- Dedicated worktree: `C:/Users/begii/OneDrive/Documents/ChatGPT/.overnight-worktrees/erp-20261126`.
- Resolve the worktree's actual Git common directory and atomically acquire
  `momo-overnight-erp.lock` before writing. If a live/unknown owner holds the lock,
  report overlap SKIPPED; never delete another run's lock or reset its worktree.
- Read latest remote checkpoint and this state before coding. The original ERP
  checkout contains prior dirty work; never overwrite it. Continue from the
  reviewed overnight branch; do not repeat the already completed branch merge.

## Completed code and actual evidence at d4ed605

- Auth/recovery/session races and runtime-config safeguards; exact callback
  allowlists, public-key validation and Vercel no-store headers.
- Authenticated core service/UI replaces demo/localStorage operational state.
  Actual product/warehouse/stock/order/items/customer-number/lead/call/delivery,
  cash ledger, dashboard and report APIs are wired through11 guarded RPCs.
- Atomic stock reservation/release; actor-scoped idempotency receipts; optimistic
  timestamps; organization/FK/role/profile guards; finite monetary validation.
- Review-only Messenger dry-run mapper, actual bot schema contract tests, Phase6C
  hosted gate plan. Bot source/service unchanged.
- Real employee invitation/setup acceptance, pinned and dependency-injected Edge
  handler, exact server-selected callbacks, bounded request size/deadline and
  sanitized failures. Never delete an Auth user to compensate for a failed
  invitation: the returned ID may belong to a concurrent existing account.
  Uncertain outcomes require authorized reconciliation, with no automatic retry.
- User-management refresh revision and actor/org checks prevent stale request
  completion from replacing newer employee data or a different actor's form.
- New additive invitation migration rejects cross-org profile/role rebinding
  under a row lock and guarded upsert. Narrow trusted FK cascade cleanup keeps
  normal user/role/assigner tenant checks intact.
- Deploy build uses an explicit static allowlist into `build/`, excluding the
  legacy static `products.json` cost/stock export while preserving its source.
- Regression: **156 total /154 PASS /0 FAIL /2 SKIPPED**,
  `docs/evidence/erp-readiness-regression.tap`.
- Full regression with actual PG15.20: **220 total /218 PASS /0 FAIL /2 SKIPPED**,
  `docs/evidence/core-pg15-tests.tap` and `core-pg15-validation.json`.
- Focused PG15.20 integration: **65 total /64 PASS /0 FAIL /1 SKIPPED**,
  `docs/evidence/invitation-merged-pg15.tap` and `.json`; nested legacy6PASS.
  New invitation migration rollback, two-org concurrent binding, foreign target
  rejection, trusted FK cascade, synthetic pg_dump/restore and cleanupPASS.
  Full PG run skips the separate legacy entrypoint (executed nested) and the
  intentionally absent own-assigned-only policy. Unit-only run skips both DB
  entrypoints until an explicit isolated local target is allocated.
- Real Chromium → local GoTrue/PostgREST/PG15/Mailpit: **16 PASS /0 FAIL**,
  `docs/evidence/browser-erp-acceptance.json`. No business success mocks, external
  email or production call; icons only use a stub. All13 migrations applied;
  employee invite/setup/limited-role login included. Stack cleanupPASS. The Node
  adapter invokes the actual Edge business handler; hosted Edge gateway remains
  unverified. Earlier10s invitation response timeout was corrected to20s so the
  runner can observe the handler's bounded15s response; final run passed.
- Synthetic public-config deployment build and JavaScript syntax checksPASS.
- **9 Messenger contract tests PASS.** Shared runtime/employee queue delegation not
  implemented by this ERP checkpoint; do not claim otherwise.

## Next independent safe work

1. Add a durable invitation operation/reconciliation workflow; current Auth
   duplicate checks and per-form locking do not guarantee cross-window exactly
   once delivery. Never retry an uncertain invite or delete its Auth user blindly.
2. Review invoice/cash correction, delivery return/restock business rules and
   add meaningful negative/concurrent tests before extending those workflows.
3. Persist form request UUID/reconciliation across browser restarts, without
   retaining sensitive payloads/tokens in frontend storage; current keys survive
   in-flight retry only.
4. Add server-backed pagination/full exports; operational lists currently show
   up to500 permitted rows while server dashboard totals aggregate all rows.
5. Extend least-privilege browser personas and revoked-employee acceptance.
6. Develop the Phase6C access-check/queue delegation interface only with explicit
   versioned contract and fail-closed local tests; no production Meta action.

Do not rerun all completed checks without a new change, failure or unresolved
concern. Record changed code, test evidence, next task and commit each run.

## BLOCKED production gates

- No verified production backup/restore point or hosted synthetic acceptance
  account. Owner explicitly accepts skipping production acceptance while safe
  local implementation continues. Never deploy/migrate until gates are met.
- Public production check confirmed expected Supabase ref but old demo dashboard
  and unpinned SDK remain deployed. Signup was publicly enabled; source now
  disables global signup, but hosted configuration was not changed.
- Production migration history ends202609250001; pending Social migrations must
  not be blanket-pushed merely to roll out independent core improvements.
- Review existing demo/nonfinite/cross-tenant legacy rows before validating new
  NOT VALID monetary constraints. No existing production data was rewritten.
- Social own-assigned-only policy remains absent by earlier owner decision;
  existing primary/backup Page-wide visibility must not be called own-only.

## Reproduce safe tests

```powershell
npm ci --ignore-scripts
npm test
$env:MOMO_LOCAL_DOCKER_BIN = 'C:\Users\begii\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
npm run test:pg15
npm run test:browser -- --docker-bin 'C:\Users\begii\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe' --chromium 'C:\Users\begii\AppData\Local\ms-playwright\chromium-1248\chrome-win64\chrome.exe'
```

CLI helpers target fresh localhost instances and never load production `.env`.
Verify helper `--help` before adapting command flags. The browser runner creates
and destroys only its uniquely owned stack; never use `supabase stop --all`.
