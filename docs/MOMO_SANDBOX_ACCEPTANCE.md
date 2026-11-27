# MOMO ERP — isolated sandbox acceptance

Огноо: **2026-11-27, Asia/Ulaanbaatar**. Энэ нь sandbox rollout/acceptance төлөвлөгөө ба source SQL audit. Review/bundle script өөрөө remote migration, deployment, secret тохиргоо эсвэл Meta request хийхгүй.

## Target boundary ба бодит preflight

- Шинэ тусгаарласан target: **MOMO ERP Social Sandbox**, ref `mmvmvweitrhlgqtjadaz`, Singapore.
- Хамгаалсан production: **`lxjkkqypiwnnrjmnpick`**. Энэ төлөвлөгөөний target/credential/DB connection түүн рүү зааж болохгүй.
- Connected read-only preflight: sandbox `ACTIVE_HEALTHY`, PostgreSQL **17.12** (`17.12.0.002`), public base table **0**, `supabase_realtime` publication байгаа, `pgcrypto` нь `extensions` schema-д байгаа.
- Энэ нь deployment-ээс өмнөх snapshot. Actual migration/hosted acceptance-ийн үр дүнг root тусдаа evidence-д бүртгэнэ. Project Free/$0 хүрээнд тусдаа үүссэн; paid service/upgrade энэ checklist-д байхгүй.
- Өмнөх readiness doc-ийн project-not-created/11-migration төлөвийг энэ шинэ төлөвлөгөөтэй андуурахгүй.

## Offline bundle-ийн gate

`npm run prepare:hosted-social` network, SDK, subprocess, .env эсвэл project link ачаалахгүй. Curated 17 SQL, transitive Edge source 7 файл, optional public templates болон generated **local** config-ийг шинэ directory-д бэлтгэнэ. Source secrets, seed, historical owner scripts, node_modules, source `.temp/project-ref`, production config хуулдаггүй.

Default evidence: `docs/evidence/core-pg15-validation.json`. Өөр report: `node scripts/prepare-hosted-social-sandbox.mjs --evidence-file docs/evidence/fresh-pg15-validation.json`.

Evidence нь exact migration order/source SHA-256, synthetic localhost PostgreSQL15, actual child exit-ийн `testRun.status=PASS`/`exitCode=0`, core checks, transactional rollback, full core backup/restore, owned cleanup PASS агуулна. Хуучин 11/13/16 migration report, unreviewed SQL, source hash drift эсвэл failed/incomplete evidence байвал output үүсгэхээс өмнө зогсоно. PASS-ийг гараар зохиохгүй; runner actual exit-ийн дараа stamp хийнэ.

Manifest `PREPARED_NOTDEPLOYED`, `targetProjectRef=null`, `hostedAcceptanceVerified=false` хэвээр. Local PostgreSQL15 evidence нь hosted PostgreSQL17 acceptance биш. Function source hashes artifact-д байна; frozen function source/contract tests-ийг release review тусад нь тулгана.

Existing output overwrite хийхгүй. ERP/bot tree болон ancestor-тай output давхцахгүй; nested worktree-ийн ancestor дахь бодит Bot directory мөн хамгаалагдана.

## Exact migration order

| # | Migration | Үүрэг |
| --- | --- | --- |
| 1 | `202609170001_core_schema.sql` | Core tables/enums/index/trigger, realtime membership |
| 2 | `202609170002_auth_rbac_rls.sql` | Auth/profile, permissions/RBAC/RLS |
| 3 | `202609180003_user_invitation_provisioning.sql` | Employment field, service-only provisioning |
| 4 | `202609180004_create_custom_role.sql` | Guarded role creation |
| 5 | `202609180005_harden_user_role_visibility.sql` | Role/profile visibility |
| 6 | `202609250001_role_management.sql` | Guarded role management |
| 7 | `202611260001_momo_ai_social_phase2.sql` | AI/social permissions/history, false flags |
| 8 | `202611260002_multi_page_team_management.sql` | Page/team/member/access/assignment schema |
| 9 | `202611260003_social_operations.sql` | Social operations |
| 10 | `202611260004_social_real_data.sql` | Social CRUD/versioned operations |
| 11 | `20261126111223_social_contract_alignment.sql` | Effective Page deny/read/team/RLS/routing |
| 12 | `20261126133809_core_production_readiness.sql` | Atomic core CRUD/stock/cash/receipts/guards |
| 13 | `20261126142430_invitation_tenant_and_cleanup_guards.sql` | Invitation tenant and narrow FK cascade guards |
| 14 | `20261126150430_core_product_stock.sql` | Permission-aware stock projection |
| 15 | `20261126155806_dashboard_stock_by_product.sql` | Source-derived stock aggregates |
| 16 | `20261126210330_core_delivery_export.sql` | Guarded delivery export |
| 17 | `20261127044305_social_delivery_access_recheck.sql` | Current server-side send authorization |

**Exclude, never copy/execute**:

- `202609170003_bootstrap_momo_erp.sql`: historical real ERP owner/Auth/organization bootstrap.
- `202609180001_verify_admin_auth_rls.sql`: historical owner-specific assertions.
- `202609180002_set_admin_first_name.sql`: fixed-user profile update.

Migration 2 нь `bootstrap_first_admin` function тодорхойлдог боловч public/anon/authenticated execute эрхийг цуцалдаг. Sandbox seed-д үүнийг дуудахгүй: defaults-д real shop Page нэрс орсон. Зөвхөн tracked synthetic IDs/rows ашиглана.

## SQL audit ба PostgreSQL17 compatibility

Curated files нь schema/function/view/RLS өөрчлөлт, **static reference** permissions/Admin-role grant болон default-false flag seeding ажиллуулна. Auth-user/customer/order/payment fixture үүсгэх top-level DML байхгүй. Guarded function доторх DML нь дараа authorized call ирэхэд л ажиллана.

Curated set-д COPY FROM PROGRAM/file, dblink, HTTP/net call, vault secret export, production connection, database reset эсвэл top-level customer/order deletion байхгүй. Historical owner scripts дээр тусдаа exclusion үйлчилнэ.

- `pgcrypto` already installed тул CREATE EXTENSION IF NOT EXISTS нь relocate хийхгүй. Reviewed bodies нь `public.digest`-д найдахгүй; native `gen_random_uuid`/`sha256`, JSONB/advisory/row locks хэрэглэнэ.
- `security_invoker`/`security_barrier` view нь PostgreSQL17-д боломжтой. Actual grants/RLS allow/deny-г hosted acceptance-аар батална.
- `ALTER PUBLICATION supabase_realtime ADD TABLE`-д publication хэрэгтэй; preflight-аар байгаа нь батлагдсан.
- Fresh sandbox schema-д зориулсан apply. Existing production дээр repeated SQL ажиллуулах ерөнхий idempotent script биш; migration history/order/hash бүртгэнэ.
- `core_finite_prices` NOT VALID нь legacy rows-ийг хадгалж review хийх зориудын нөхцөл. Fresh fixtures зөв утгатай байх ёстой; production data-г тест тааруулахын тулд өөрчлөхгүй.
- Actual sandbox DDL/Auth/RLS/API acceptance дуустал hosted compatibility PASS гэж тайлагнахгүй.

## Edge inventory ба authentication

| Function | Бүрэн source / authentication |
| --- | --- |
| invite-user | index.ts + handler.mjs + invitation.mjs; JWT, active same-org users.manage, service-only provisioning; verify_jwt=true |
| social-integration | index.ts + shared social-contract.mjs; JWT/Auth/org/Page/flags, backend bot registry; verify_jwt=true |
| social-access-recheck | index.ts + shared social-access-recheck.mjs; dedicated opaque server Bearer; no browser Origin/cookie fallback; verify_jwt=false |

SDK entrypoints **2.112.3** pin-тэй. Recheck-ийн verify_jwt=false нь opaque connector-д зориулагдсан **нэг endpoint-ийн** нөхцөл. Handler dedicated Bearer-ийг шалгасны дараа service-only SQL RPC дуудна; үүнийг бусад function-д ерөнхийлөхгүй.

Generated config нь local rehearsal config. Remote Auth/config push биш. Sandbox callback/allowed origin-ийг separately reviewed тохиргоогоор сонгоно; production Site URL/callback-ийг хуулж тохируулахгүй.

## Server-side configuration

| Setting | Хэрэглээ / эхний төлөв |
| --- | --- |
| Reserved SUPABASE_URL/public key variables | Selected sandbox runtime; production project биш |
| Reserved SUPABASE_SERVICE_ROLE_KEY | Invitation/recheck backend only; frontend/тайланд оруулахгүй |
| SOCIAL_ADAPTER_MODE | Эхлээд mock; дараа зөвхөн approved sandbox bot binding |
| SOCIAL_ALLOWED_ORIGINS_JSON | Exact sandbox UI origin, wildcard/production fallback байхгүй |
| FACEBOOK_BOT_ALLOWED_ORIGINS_JSON | Exact sandbox bot HTTPS origin |
| FACEBOOK_BOT_PAGE_REGISTRY_JSON | ERP Page UUID/org UUID/external Page string/v1 backend/token environment reference |
| FACEBOOK_BOT_ERP_TOKEN_<ref> | Dedicated backend connector; эхлээд inbox:read/audit:read |
| SOCIAL_ACCESS_RECHECK_ENABLED | Default false; manual send acceptance stage хүртэл off |
| SOCIAL_ACCESS_RECHECK_TOKEN | Bot→ERP dedicated opaque connector secret |
| Bot ERP_ACCESS_RECHECK_URL / credential | Reviewed sandbox endpoint, actual bot contract-оор pin хийнэ |
| Organization feature flags | DB rows; default false; read/draft/send тусдаа шат |

Recheck Bearer, employee JWT, bot ERP connector болон Supabase service-role key нь хоорондоо өөр credential. Real Meta token synthetic acceptance-д шаардлагагүй; fake provider хэрэглэнэ.

## Bootstrap ба acceptance sequence

1. Exact sandbox ref/health/expected schema/version-ийг давтан тулгаж production ref-ийг hard deny болгоно. Manifest/source hash болон fresh local PASS evidence-ийг root apply-аас өмнө шалгана.
2. Зөвхөн curated 17 DDL-г дарааллаар migration history-тай apply хийнэ. Unreviewed repository-wide push/seed ажиллуулахгүй. Actual sandbox advisors болон grants/RLS-ийг шалгана.
3. Synthetic org/Auth users үүсгэн trusted app_metadata/provisioning-оор холбоно. Default roles-ийг зөвхөн synthetic org-д provision хийнэ. Synthetic Page/team/member/access rows-ийн ID бүрийг track хийнэ; real data/password/chat хуулж болохгүй.
4. Default flags/auto-send false гэдгийг эхэлж нотолно. Synthetic registry connected=true нь Meta subscription/routing proof биш.
5. Read stage: genuine JWT, inactive/no-global-permission/other-org/Page-denied/forbidden-Origin tests; safe registry, inbox detail/history, no send rights. Initial bot credential read-only.
6. Draft/edit/approve stage: тусдаа reviewer, expected version/basis, audit, approval revocation; explicit send-ээс өмнө provider call 0. Current ERP approve gate нь social_inbox.reply_draft; шинэ permission байгаа мэтээр нэрлэхгүй.
7. Manual simulated send stage: send flags болон recheck-г зөвхөн synthetic org-д enable. Authenticated delivery-context RPC actor/org/Page/team-ийг session-оос derive хийнэ. Service-only recheck RPC-г anon/authenticated дуудвал deny.
8. Enqueue дараа worker эхлэхийн өмнө global permission/Page grant/team activity/membership/Page link-ийг цуцалж provider I/O-оос өмнө stop/hold болохыг шалгана. Backend timeout/error нь unknown; allow биш.
9. Recheck нь current authorization-ийг л батална. Bot өөрөө stored Page/recipient/fresh basis/reply version/approval/window болон expiry-г тусад нь дахин шалгана. Existing Page-wide inbox policy-г own-assigned-only болгож чимээгүй өөрчлөхгүй.
10. Retry/restart/restore дээр audit/idempotency болон яг нэг simulated delivery-г тулгана. Real Meta webhook/reply нь дараагийн хязгаарлагдмал, тусгай зөвшөөрсөн test Page-ийн ажил хэвээр.

## Durable storage, backup, rollback

Render Free-ийн SQLite ephemeral хэвээр. Read-only/synthetic hosted acceptance нь durable audit/outbox/idempotency-г батлахгүй. Supabase өөрөө ботын SQLite-г автоматаар өөр datastore руу шилжүүлэхгүй; production durable store хэрэгжүүлэх/зөвшөөрөх gate тусдаа.

Real delivery-ээс өмнө consistent SQLite backup, protected off-host custody, restore drill, pending/uncertain reconciliation, single responder ownership шаардана. Хуучин snapshot-ийг newer uncertain receipt дээр overwrite хийхгүй.

Local PostgreSQL dump/restore нь зөвхөн local synthetic proof. Hosted sandbox backup/restore-д approved export/connection method болон private credential шаардлагатай; боломжгүй бол BLOCKED гэж бүртгээд read-only ажлыг үргэлжлүүлнэ. Free plan өөрөө backup/restore proof биш. Шинэ disposable local database-д restore хийж schema/RLS/grants/data/audit/receipts харьцуулж болно; paid branch заавал авахгүй.

Rollback: sandbox send/recheck flags off, producer/worker stop, audit/receipts хадгалах, зөвхөн sandbox credential revoke. Production reset/delete эсвэл автомат Auth-user deletion хийхгүй. SDK response-ийн Auth identity ownership батлагдаагүй бол manual reconciliation үлдээнэ.

Root actual PASS/FAIL/SKIPPED/BLOCKED үр дүнг execution-ийн дараа бүртгэнэ. Энэ баримт болон bundle unit test нь өөрөө hosted deployment, production readiness эсвэл real delivery proof биш.
