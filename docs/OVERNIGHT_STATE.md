# MOMO ERP overnight state

Updated: 2026-11-26, Asia/Ulaanbaatar. Owner requests hourly independent safe
development until **2026-11-27 08:00 +08:00**; no production deployment, secret
changes, paid service, database reset or real customer test data.

## Accepted checkpoint

- Development branch: `codex/erp-production-readiness` (this checkpoint).
- Automation branch: `codex/overnight-erp-20261126`.
- Automation ID: `momo-erp-overnight`, ACTIVE, hourly at minute00, local execution.
- Source origin: `https://github.com/ganjargal777-maker/Momo-ERP.git`.
- Dedicated worktree: `C:/Users/begii/OneDrive/Documents/ChatGPT/.overnight-worktrees/erp-20261126`.
- Resolve the worktree's actual Git common directory and atomically acquire
  `momo-overnight-erp.lock` before writing. If a live/unknown owner holds the lock,
  report overlap SKIPPED; never delete another run's lock or reset its worktree.
- Read latest remote checkpoint and this state before coding. The original ERP
  checkout contains prior dirty work; never overwrite it. Fast-forward the clean
  overnight worktree to this reviewed checkpoint before the first coding run.

## Completed code and actual evidence

- Auth/recovery/session races and runtime-config safeguards; exact callback
  allowlists, public-key validation and Vercel no-store headers.
- Authenticated core service/UI replaces demo/localStorage operational state.
  Actual product/warehouse/stock/order/items/customer-number/lead/call/delivery,
  cash ledger, dashboard and report APIs are wired through11 guarded RPCs.
- Atomic stock reservation/release; actor-scoped idempotency receipts; optimistic
  timestamps; organization/FK/role/profile guards; finite monetary validation.
- Review-only Messenger dry-run mapper, actual bot schema contract tests, Phase6C
  hosted gate plan. Bot source/service unchanged.
- Deploy build uses an explicit static allowlist into `build/`, excluding the
  legacy static `products.json` cost/stock export while preserving its source.
- Regression: **125 total /123 PASS /0 FAIL /2 SKIPPED**,
  `docs/evidence/erp-readiness-regression.tap`.
- Actual PG15.20 focused integration: **59 total /58 PASS /0 FAIL /1 SKIPPED**;
  nested legacy6PASS; synthetic pg_dump/restore and cleanupPASS.
- Real Chromium → local GoTrue/PostgREST/PG15/Mailpit: **13 PASS /0 FAIL**,
  `docs/evidence/browser-erp-acceptance.json`. No business success mocks, external
  email or production call; icons only use a stub. Stack cleanupPASS.
- **9 Messenger contract tests PASS.** Shared runtime/employee queue delegation not
  implemented by this ERP checkpoint; do not claim otherwise.

## Next independent safe work

1. Review invoice/cash correction, delivery return/restock business rules and
   add meaningful negative/concurrent tests before extending those workflows.
2. Persist form request UUID/reconciliation across browser restarts, without
   retaining sensitive payloads/tokens in frontend storage; current keys survive
   in-flight retry only.
3. Add server-backed pagination/full exports; operational lists currently show
   up to500 permitted rows while server dashboard totals aggregate all rows.
4. Extend least-privilege browser personas and revoked-employee acceptance.
5. Develop the Phase6C access-check/queue delegation interface only with explicit
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
