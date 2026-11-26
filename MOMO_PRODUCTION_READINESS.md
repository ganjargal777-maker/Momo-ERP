# MOMO ERP production readiness

2026-11-26, Asia/Ulaanbaatar. **Local implementation/acceptance PASS;
production rollout BLOCKED** until verified backup/rollback/hosted acceptance.
No production data, Auth settings, Edge deployment, Meta service or billing was
changed. Original ERP dirty checkout and Messenger Phase6A service are preserved.

| Acceptance | Result | Boundary |
| --- | --- | --- |
| Login/reset | PASS | Real local GoTrue, Mailpit recovery, password update, logout/session invalidation; no external email |
| Core CRUD | PASS | Browser forms and actual local PostgreSQL/REST; product, warehouse, stock, order/items/delivery, leads/calls, cash ledger |
| RBAC/RLS | PASS local | Cross-org references/role links/profile escalation denied; concurrent order/stock/idempotency tests; hosted policies not changed |
| Dashboard/reports | PASS local | Server aggregates, explicit `is_demo=false`, null/error stays unknown; cashflow distinct from accounting profit |
| Browser E2E |13/13PASS | Real Chromium/business backend; icons stub only, no production acceptance |
| Regression |123PASS/0FAIL/2SKIPPED |125 total; local DB guards defer to dedicated synthetic harness |
| Database integration |58PASS/0FAIL/1SKIPPED |59 total in PG15.20; includes Social+core; nestedlegacy6PASS, dump/restorePASS |
| ERP–Messenger mapping |9/9PASS | Actual bot schema read-only; review draft only, no order/send side effect |
| Production backup/deploy |BLOCKED | Verified backup/restore and hosted acceptance absent; owner directs safe work to continue |

Code: `dist/auth.js`, `core-service.js`, `core-ui.js`, `app.js`, `index.html`,
runtime/deployment builders, Vercel headers, recovery config, new core migration,
contract mapper and tests. Prior local Social preparation is included intact and
remains feature-gated; it was not deployed.

Core migration: `supabase/migrations/20261126133809_core_production_readiness.sql`.
It adds11 guarded atomic RPCs, cash ledger, private operation receipts, demo
flags, tenant/profile/role-link constraints and monetary validation. A production
rollout must be core-only reviewed rather than blindly applying pending Social
migrations. Canonical legacy `dist/products.json` is preserved; allowlisted
`build/` output excludes it. Runtime config accepts public keys only and can pin
`MOMO_EXPECTED_SUPABASE_PROJECT_REF=lxjkkqypiwnnrjmnpick`.

Actual public production inspection found the expected project ref and working
public Auth settings endpoint, but old hardcoded sales, unpinned SDK and enabled
signup. These deployed findings are pending, not fixed remotely by local edits.
Production security advisors also flagged callable trigger helper functions and
disabled leaked-password protection; guarded intended RPCs are not automatically
vulnerabilities merely because SECURITY DEFINER is used. Private/admin helpers
need reviewed privilege remediation and a post-rollout advisor check.

Evidence: `docs/evidence/browser-erp-acceptance.json`,
`erp-readiness-regression.tap`, `core-pg15-validation.json`,
`production-public-before.json`. Initial fixture/provider/selector/navigation
issues were fixed and final browser suite passed with owned stack cleanup.

Remaining functional limits: detailed lists/CSV cap500; finance is cashflow,
not full accounting/tax/profit; returned/failed delivery requires explicit stock
and cash reconciliation; current form idempotency keys are not persisted across
browser restart. Employee revocation after bot queueing and persisted ERP
ingestion receipts remain Phase6C implementation work. No shared multi-page bot
runtime or real Meta delivery is claimed.

See `MOMO_CORE_DATA_CONTRACT.md`, `docs/MOMO_CORE_DATABASE_CONTRACT.md`,
`docs/MOMO_PHASE6C_HOSTED_ACCEPTANCE.md` and `docs/OVERNIGHT_STATE.md` for contracts,
rollout/rollback gates and next independent development tasks. Two hourly app
automations now own separate background worktrees; no main merge/deploy occurs.
