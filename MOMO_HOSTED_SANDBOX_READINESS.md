# MOMO ERP — Phase 6B Hosted Sandbox Readiness

2026-11-27: the actual isolated Free project is `mmvmvweitrhlgqtjadaz`, and the
Free Render static ERP is `https://momo-erp-social-sandbox.onrender.com`.
Current deployed targets, real hosted/browser evidence and remaining Bot/backup/
Meta gates are in `docs/MOMO_STAGING_VALIDATION.md`. Older preparation counts
below are historical; no production rollout is claimed.

Огноо: 2026-11-26, Asia/Ulaanbaatar. Энэ нь **deployment бэлтгэл**; hosted migration, function deployment, secret write, flag update, Meta subscription эсвэл бодит мессеж илгээлт хийгдээгүй. Production Supabase, Vercel, ERP database болон Facebook ботын repository-г өөрчлөхгүй.

## 1. Одоогийн төлөв ба эхний blocker

Холбогдсон Supabase account-ийн зөвхөн project inventory-г уншихад “Momo ERP” гэсэн нэг project харагдсан. Түүний ref `lxjkkqypiwnnrjmnpick` нь **хамгаалагдсан production target**; sandbox гэж ашиглахгүй, түүний database/keys/functions-д энэ шалгалт хандахгүй. Хэрэглэгч тусдаа sandbox байхгүйг баталсан; шинэ isolated project шаардлагатай боловч үүсгээгүй.

**Шаардлагатай нөөц:** тусдаа Supabase project, зөвхөн sandbox-д зориулсан bot v1 runtime/шинэ DATA_DIR, endpoint/TLS, narrow backend credential, synthetic Auth users/org/Page fixtures. Хэрэглэгч Momoshop organization-д **MOMO ERP Social Sandbox** нэртэй project төлөвлөхийг сонгосон. Region-ийн санал `ap-southeast-1` (Singapore); actual hosted database major/version нь project үүсээгүй тул баталгаажаагүй.

**2026-11-26-ны account/billing read-only шалгалт:** Momoshop `plan=free`, `tier=tier_free`; `get_cost(type=project)` нь **$0/month** санал буцаасан. Account inventory-д нэг active project харагдсан. Free plan-ийн лимит нь owner/admin-ийн organization-уудыг дамнасан нийт **2 active project**; sandbox нэмэх нь харагдаж буй хүрээнд **2/2**, сүүлийн free slot-ийг ашиглана. Хэрэглээний зарим quota organization дотор нийлдэг. Free project 1 долоо хоног идэвхгүй бол pause болдог. [Billing/limit](https://supabase.com/docs/guides/platform/billing-on-supabase), [Free plan](https://supabase.com/pricing).

Хэрэглэгч Free хязгаарлалт эсвэл одоогийн project-д нөлөөлөх нөхцөл гарвал үүсгэхээс өмнө зогсохыг заасан тул **project үүсгээгүй**. Account inventory нь quota reservation биш; дараа үүсгэхээр шийдвэл үнэ/лимитийг дахин шалгана. Paid upgrade, нэмэлт compute, custom domain эсвэл external deployment захиалаагүй. Production database/Auth/env/functions, organization plan өөрчлөөгүй. Credential provision хийх шатанд хараахан ороогүй; token/password/service-role key-г чат, repo, тайланд гаргаагүй.

| Хэсэг | Төлөв | Нотлохгүй зүйл |
| --- | --- | --- |
| Local PG15.20 rehearsal | PASS — 90 test: 88 PASS, 0 FAIL, 2 SKIPPED; nested legacy suite 6 PASS | Hosted Auth, gateway, PostgREST/Deno, Meta delivery |
| Source migration дараалал, Page v1 registry adapter | PREPARED | Hosted applied/deployed байдал |
| JWT/org/Page/flag hosted probe, synthetic manifest | PREPARED; hosted NOT RUN | Offline mock PASS-ийг hosted PASS гэж тооцохгүй |
| Dedicated project/endpoint/credentials | BLOCKED — sandbox ref/URL алга; сүүлийн Free slot-ийн нөхцөлөөр creation зогссон | Production ref-ээр нөхөхгүй |
| Draft/edit/approve, send | PLAN ONLY; send OFF | Автомат эсвэл бодит илгээлтийн зөвшөөрөл биш |

Local нотолгоо: [Database validation](MOMO_PHASE4_DATABASE_VALIDATION.md), [JSON](docs/evidence/phase4-pg15-validation.json), [test log](docs/evidence/phase4-pg15-tests.txt). Өмнөх [contract alignment](MOMO_SOCIAL_CONTRACT_ALIGNMENT.md)-ийн PG15 local blocker шийдэгдсэн; hosted validation үлдсэн.

## 2. Project болон deployment checklist

- [ ] Шинэ isolated project-ийн ref/URL-г owner баталсан; хамгаалагдсан production ref-ээс өөр, production connection string/backup/customer data ашиглахгүй.
- [ ] Project-ийн бодит PostgreSQL major/minor-г тэмдэглэсэн. Local proof 15.20; hosted major өөр бол тэр major дээр тохирох rehearsal нэмж шалгана.
- [ ] Auth нь synthetic accounts only; public signup off, redirect/site URL нь sandbox UI эсвэл `http://localhost:4173`, production ERP/Vercel тохиргоо хуулж ашиглахгүй.
- [ ] API-д `public` болон шаардлагатай стандарт schema л exposed; `momo_social_private`-ийг Data API schema жагсаалтад нэмэхгүй.
- [ ] Migration, function source/SDK pin, allowlist, schema privileges/RLS болон credential scope review хийгдсэн; бүх org flags анх false.
- [ ] Bot runtime нь тусдаа Page binding/SQLite/outbox/credential-тэй; production DATA_DIR, token, callback, responder ownership-г өөрчлөхгүй.
- [ ] Sandbox migration/function deploy/secret write-ийн target болон шаардлагатай resource/cost-ийг эхлээд тайлагнасан; энэ баримт тэдгээрийг гүйцэтгэсэн тэмдэглэл биш.

## 3. Шинэ хоосон sandbox-ийн migration bundle

**Бүтэн production migration directory-г шууд push хийхгүй.** Зориулалтын deployment workspace-д дараах 11 source файлыг өөрчлөлтгүй, hash manifest-тай энэ дарааллаар бэлтгэнэ:

| Дараалал | Source migration |
| --- | --- |
| 1 — Core | `202609170001_core_schema.sql` |
| 2 — Auth/RBAC | `202609170002_auth_rbac_rls.sql` |
| 3 — Auth provisioning | `202609180003_user_invitation_provisioning.sql` |
| 4 — Custom roles | `202609180004_create_custom_role.sql` |
| 5 — Role visibility | `202609180005_harden_user_role_visibility.sql` |
| 6 — Role management | `202609250001_role_management.sql` |
| 7 — Social Phase 2 | `202611260001_momo_ai_social_phase2.sql` |
| 8 — Page/team | `202611260002_multi_page_team_management.sql` |
| 9 — Operations | `202611260003_social_operations.sql` |
| 10 — Phase 4 | `202611260004_social_real_data.sql` |
| 11 — Contract alignment | `20261126111223_social_contract_alignment.sql` |

Зориудаар оруулахгүй 3 identity-specific файл: `202609170003_bootstrap_momo_erp.sql` нь урьдчилан тогтоосон хүний UUID/бизнесийг bootstrap хийнэ; `202609180001_verify_admin_auth_rls.sql` нь тэр identity/organization-г шалгана; `202609180002_set_admin_first_name.sql` нь тэр хүний нэрийг өөрчилнө. Эдгээрийг synthetic migration гэж ажиллуулахгүй, applied мэтээр history-д хуурамчаар тэмдэглэхгүй. Existing hosted database-ийн migration history-г засахгүй.

Offline bundle exporter: `npm run prepare:hosted-social` эсвэл `node scripts/prepare-hosted-social-sandbox.mjs --output-dir <new-directory>`. Default нь шинэ Temp directory; existing/protected output directory-д бичихгүй. Тэр нь curated 11 migration-ийн SHA-г PG15 evidence JSON-той тулгаж, зөвхөн Edge entry/shared core, public example-ууд, энэ checklist-ийг хуулна; `.env`, real data, seed, linked production metadata хуулахгүй. Шинэ config нь local PG15, signup=false, localhost UI, `verify_jwt=true`, seed=false; энэ нь hosted major version баталсан гэсэн үг биш. `bundle-manifest.json` нь files SHA, `target=null`, `PREPARED_NOTDEPLOYED` төлөвтэй. Export нь network/deployment/secret write хийхгүй.

Hosted Supabase өөрийн `auth.users`, `auth.uid()`, `anon/authenticated/service_role`, Realtime publication-тай. **Local harness-ийн fake Auth schema/roles/bootstrap SQL-г hosted руу хуулж ажиллуулахгүй.** Core → RBAC → Social → alignment бүгд дууссаны дараа privileges, RLS, RPC signatures, function grants/search_path болон migration history-г sandbox дээр шалгана. CLI 3.4.0 command/target flags-ийг тухайн command-ийн `--help`-ээр дахин тулгаж, зөвхөн батлагдсан sandbox ref-д гүйцэтгэнэ; энэ ажлаар remote command ажиллуулаагүй.

CLI 3.4.0 help-ээр тулгасан **ирээдүйн, одоогоор ажиллуулаагүй** командын хэлбэрүүд:

```text
supabase db push --workdir <isolated-bundle> --remote=<APPROVED_SANDBOX_REF> --dry-run --skip-vault
supabase secrets set --workdir <isolated-bundle> --remote=<APPROVED_SANDBOX_REF> --env-file <private-secret-file>
supabase functions deploy social-integration --workdir <isolated-bundle> --remote=<APPROVED_SANDBOX_REF>
```

Dry-run review-ийн дараах schema apply нь `--dry-run`-гүй ижил explicit sandbox target хэрэглэнэ. `--include-seed`, `--include-roles`, `--no-verify-jwt`, `--prune` хэрэглэхгүй. `--yes`-ийг review/зөвшөөрлийн орлуулга болгохгүй. Linked/default target, production config/redirects эсвэл бүх migration-тай анхны workdir-оос deploy хийхгүй. Command placeholder-ийг operator бодит approved target-аар солино; энэ жишээ автоматаар ажиллах deployment script биш.

## 4. Synthetic fixture ба read-only эрх

Fixture setup нь **тусдаа баталсан server/owner ажиллагаа**, hosted read probe өөрөө data, role, flag үүсгэхгүй. GoTrue Auth Admin API/Dashboard-аар synthetic, email-confirmed хэрэглэгч үүсгэж бодит session JWT авна; invitation/magic-link/email илгээх үйлдэл хэрэглэхгүй. Password/session JWT-г зөвхөн private operator environment-д хадгална; repo/chat/report-д бичихгүй. `auth.users`-д fake JWT/GUC bootstrap хийхгүй. Organization/role/profile membership-ийг owner эсвэл баталгаажсан provisioning API-аар тохируулж, user-editable `user_metadata`-д тулгуурлан эрх олгохгүй. Historical `bootstrap_first_admin` нь real-looking default Page нэрс seed хийдэг тул fixture-д автоматаар ашиглахгүй.

| Fixture actor | Organization/profile | Global/Page нөхцөл |
| --- | --- | --- |
| `readAllowed` | Org A, active | Зөвхөн `social_inbox.read`; Page A read=true, reply=false, assign=false |
| `noPermission` | Org A, active | Page A read=true, global inbox read байхгүй |
| `inactive` | Org A, profile disabled | GoTrue JWT хүчинтэй/unbanned; profile gate 403-г тусад нь шалгана |
| `pageDenied` | Org A, active | Global inbox read=true, Page A explicit read=false |
| `otherOrg` | Org B, active | Global inbox read=true, өөрийн org read flag=true, Page B read grant-тай, Page A-д эрхгүй |
| `flagsDisabled` | Org C, active | Own Page C read grant/global read=true; Org C inbox read flag=false |

Actor-ууд Admin role, global draft/send/assign/reassign/resolve permission өвлөөгүйг серверээс шалгана. Team implicit membership байсан ч Page explicit deny override-ийг тестэлнэ. Org A/B/C болон Page A/B/C нь зөвхөн synthetic; manifest-ийн UUID/Meta numeric string нь бодит sandbox fixture-тэй таарна. Flags нь **organization түвшнийх**; нэг org-ийн хоёр Page дээр өөр flag тохируулсан гэж үзэхгүй.

Шинэ org-д `feature_flags` мөрүүдийг owner явцаар explicit false seed хийнэ; Social001 анх байгаа org-уудад л seed хийдэг. Анх бүх flags false. Дараагийн reviewed read-only шатанд Org A-д `social_inbox_ui=true`, `social_inbox_read=true`; Org B-д read=true болгож cross-org Page denial нь disabled flag-аас болоогүйг тусгаарлана. Draft/send/order/AI flags false. `flagsDisabled` Org C-д read=false хэвээр. Эдгээр нь ирээдүйн synthetic fixture-ийн шат; одоо remote flag update хийгээгүй. Page registry, profile/org, effective Page grants болон RPC safe projection-ийг user JWT-тай PostgREST дээр negative/positive тестэлнэ.

## 5. Server-only Page registry adapter ба environment

Нэг bot runtime = нэг Page хэвээр. ERP gateway нь ERP Page UUID → verified organization → Meta external ID → allowlisted v1 runtime/tokenEnv mapping сонгоно. `apiVersion="1"` ба capabilities.pageId-г хүсэлт бүрд тулгана; browser URL/token, SQL settings URL, `credential_reference`-ийг backend URL болгохгүй. V2 нэг-runtime multi-Page хэрэгжүүлээгүй.

| Байрлал | Variable / утга |
| --- | --- |
| Supabase runtime injected | `SUPABASE_URL`, modern `SUPABASE_PUBLISHABLE_KEYS["default"]`; legacy `SUPABASE_ANON_KEY` fallback |
| Edge server config | `SOCIAL_ADAPTER_MODE=mock` default; reviewed read-only adapter-д дараа нь `live` |
| Edge browser allowlist | `SOCIAL_ALLOWED_ORIGINS_JSON=["http://localhost:4173"]` эсвэл баталсан dedicated HTTPS UI origin |
| Edge backend allowlist | `FACEBOOK_BOT_ALLOWED_ORIGINS_JSON` — зөвхөн sandbox bot HTTPS origin |
| Edge mapping | `FACEBOOK_BOT_PAGE_REGISTRY_JSON` — explicit org/Page/external ID/apiVersion/baseUrl/tokenEnv |
| Edge secret | `FACEBOOK_BOT_ERP_TOKEN_SANDBOX_A` — minimum `inbox:read`, зөвхөн sandbox Meta Page allowlist |
| Frontend public config | Зөвхөн sandbox project URL + publishable key; Meta/Bearer/service-role/secret key байхгүй |
| Test operator process | Manifest-ийн `MOMO_SANDBOX_PUBLISHABLE_KEY` болон actor tokenEnv-д short-lived synthetic session JWT |

`SUPABASE_*` prefix нь runtime-ийн reserved namespace; custom secrets-аар эдгээрийг set хийхгүй. Modern public-key map буруу/дутуу байвал fail closed; service-role key-г fallback болгохгүй. Server-only жишээ: [env template](.env.hosted-sandbox.example). Filled secret file-г Git/тайлан/frontend-д хадгалахгүй; secrets manager/Dashboard-д зөвхөн батлагдсан sandbox target-д оруулна. Public project key нь server credential биш; хэрэглэгчийн browser session JWT нь ердийн Auth flow-ийн хэсэг, bot Bearer түүнээс тусдаа нууц.

Жишээ mapping-ийн schema (бүх утга зохиомол): `[{"erpPageId":"00000000-0000-4000-8000-000000000002","organizationId":"00000000-0000-4000-8000-000000000001","externalPageId":"12345","apiVersion":"1","baseUrl":"https://sandbox-bot.example.invalid","tokenEnv":"FACEBOOK_BOT_ERP_TOKEN_SANDBOX_A"}]`. Empty registry/secret нь live adapter ажиллахгүй байх зориудын default. Deployed `mock` mode-д injected fixture байхгүй бол 503 `mock_not_configured`; fake inbox success зохиохгүй.

Bot sandbox талд `AUTO_REPLY=false`, ERP send/control/comments/catalog flags false; persisted `autoSendMessenger=false`, `autoSendComments=false`-г GET settings-ээр нотолно. Runtime restart-д хуучин persisted settings үлддэг тул env false гэж таамаглахгүй. Энэ ажлаар ботын config/repository/secret өөрчлөхгүй.

## 6. Hosted authentication test — бэлэн боловч NOT RUN

`verify_jwt=true` хэвээр. Gateway `getUser(jwt)` → active profile/current org → global permission → org flags → effective Page read/action → safe Page context → pinned v1 adapter гэсэн server guard-тай. JWT payload decode нь test preflight хамгаалалт; бодит authentication шийдвэрийг Supabase/handler гаргана.

[Manifest example](docs/hosted-social-sandbox.example.json)-ийг approved synthetic UUID/ref-ээр private operator copy-д бөглөнө. Probe `scripts/validate-hosted-social-sandbox.mjs` default dry-run = SKIPPED/no network. Actual opt-in нь `--execute-read-only`, exact `MOMO_HOSTED_SANDBOX_APPROVED_REF`, `MOMO_HOSTED_SANDBOX_EXECUTE=READ_ONLY`, publishable key болон synthetic JWT env-үүдийг бүгд шаарддаг. Production ref, arbitrary URL, wrong issuer/subject/org/expired JWT, redirect, unknown unsafe config-г reject хийнэ; response body/token/PII-г log-д гаргахгүй.

Dry-run команд: `node scripts/validate-hosted-social-sandbox.mjs --manifest docs/hosted-social-sandbox.example.json`. Test operator нь modern `sb_publishable_` public key хэрэглэнэ; legacy anon JWT/service secret-ийг probe зөвшөөрөхгүй. Reserved negative context/reply UUID prefix нь `00000000-0000-4000-8000-0000009xxxxx`; manifest жишээний утгуудыг бизнесийн бодит ID-гаар орлуулахгүй. Эдгээр ID байхгүйг GET404-өөр дахин шалгаад л denied-operation probe үргэлжилнэ.

| Probe | Hosted acceptance — одоогоор бүгд NOT RUN |
| --- | --- |
| Browser OPTIONS | Credential-гүй preflight → 204, exact origin болон POST/authorization/apikey/content-type CORS headers |
| Missing/malformed JWT | 401; handler/platform error envelope ялгааг safe status-аар шалгах |
| Valid JWT + inactive/no-global/Page deny/other org | 403; provider write байхгүй |
| Separate flags-disabled Org C | 403; `feature_disabled` gate, Page scope-оор нөхөхгүй |
| Reader capabilities/list/settings | 200, correct ERP UUID/Meta Page ID/v1 binding; sending/comments sending/auto-send false |
| Direct Auth/profile/RPC preflight | Real GoTrue user + own profile/org/status, read grant ба flags, no writer permissions |
| Draft/edit/approve/send deny | Read-only actor, reserved nonexistent context/reply UUID-г GET404-өөр нотолсны дараа typed negative request; 403 |
| Audit/privacy | Safe correlation requestId; token/raw body/phone/address report-д байхгүй |

Live read probe нь **business data read-only + audit append**: ERP audit result rows үүсгэж болох ч business state/role/flag/send intent өөрчлөхгүй. Read response-ийн `auditRecorded=true`-г шалгана; “DB write огт байхгүй” гэж тайлагнахгүй. Negative write probes нь зөвшөөрөгдсөн writer-аар success mutation хийхгүй. Hosted 403 response дангаараа provider write=0 гэдгийг бие даан нотлохгүй тул bot request/outbox counters болон audit baseline-ийг operator давхар тулгана. Comments/provider E2E болон draft/send success нь энэ read-only probe-ийн хүрээнд байхгүй.

## 7. Draft/edit/approve → send-ийн дараагийн gate

Read-only evidence, JWT/RLS/Page/flags/capabilities болон operator audit review PASS болсны дараа л sandbox-specific draft stage-г шийднэ: `social_inbox_ai_draft=true`, global `social_inbox.reply_draft` + Page reply/read grant, connector `replies:write` ба `replies:approve`; read flag хэвээр. Approve нь existing draft permission-тай, тусдаа approve permission эсвэл “хоёр хүн батлах” бодлого одоогоор байхгүй. Edit approval-г хүчингүй болгоно; шинэ incoming basis хуучин approval-г supersede хийнэ.

Send тусдаа зөвшөөрөл/E2E хүртэл `social_inbox_reply_send=false`, `ERP_SEND_ENABLED=false`, persisted auto-send false. Дараа нь зөвхөн test Page-ийн нэг responder owner, fresh normal incoming, Messenger window/current basis, preview/edit/approve, stable operation key, 202 queue → reply poll → remote ID + яг нэг бодит reply гэсэн evidence шаардлагатай. Production Meta routing/AI/subscription болон хуучин bot auto responder-ийг энэ бэлтгэлээр солихгүй.

Idempotency: UI stable key → Edge verified org/Page/user namespace → bot v1 durable reservation; retry-д ижил reply version/key, unknown outcome-д шинэ key/force resend байхгүй. Gateway intent audit write амжилтгүй бол provider mutation зогсоно; known response-ийн result audit алдааг `auditRecorded=false` гэж илэрхийлнэ. PostgreSQL-д bot send outbox бий гэж тайлагнахгүй. Enqueue-ийн дараах employee revocation worker дотор delegated authorization-аар enforce хийх нь future v2 ажил.

## 8. Rollback ба үлдсэн blocker

Read-only rollout зогсоохдоо эхлээд зөвхөн sandbox org-ийн read/UI gate-г хааж, adapter request-ийг зогсоон audit/алдааг хадгална. Draft/send stage хүртэл нээгдсэн бол эхлээд тэр gates-ийг хааж queue/in-flight/uncertain outcome-г reconcile хийнэ. Хуучин authorization-сул Edge рүү автоматаар буцаахгүй; reviewed artifact/config-ийг хэрэглэнэ. Source schema/RLS/grant-ийг table drop-оор rollback хийхгүй.

Local proof нь transaction rollback болон committed alignment-ийн өмнөх snapshot-ийг **шинэ synthetic PG15 database**-д restore хийж catalog baseline-тай тулгасан. Hosted backup/restore/point-in-time recovery, in-place down migration, GoTrue session cleanup одоогоор NOT RUN. Hosted deployment-ийн өмнө sandbox snapshot/recovery test, fixture cleanup болон exact target verification-г төлөвлөж нотолно; бодит backup-г Git/public artifact болгохгүй.

Blockers: approved isolated project/ref ба бодит major version; өөрийн sandbox bot endpoint/fresh store/narrow key; real synthetic GoTrue sessions/Org A–C fixtures; actual migrations/secrets/function deployment-ийн зөвшөөрсөн target; hosted JWT/CORS/RLS/Edge probe; дараагийн draft success болон тусдаа authorized Meta E2E. Current contract Page-wide: зөвшөөрсөн primary/backup багийн гишүүд өөр ажилтанд оноосон context-ийг харж болно; user-ийн сонголтоор own-assigned-only бодлого нэмээгүй. Энэ хил read-only UI-д нуугдсан гэж амлахгүй.

Эх сурвалж: [Supabase user auth/verify_jwt](https://supabase.com/docs/guides/functions/auth), [runtime secrets/reserved names](https://supabase.com/docs/guides/functions/secrets), [CLI v3 target semantics](https://supabase.com/changelog/supabase-cli-v3). CLI command flags, quota/cost болон hosted major version-ийг бодит deployment-ийн өмнө дахин батална.

## 9. Энэ бэлтгэлийн бодит шалгалт ба файлууд

Actual ERP source дээр `npm run test:pg15` дахин ажилласан: **114 нийт, 112 PASS, 0 FAIL, 2 SKIPPED**, 7,922 ms. Үүнд Edge contract/config 27, hosted probe-ийн offline behavior 12, bundle-ийн offline behavior 7, бусад өмнөх regression болон actual PostgreSQL 15.20 RLS/rollback/concurrency орсон. Nested legacy suite 6/6 нь aggregate count дээр дахин нэмэгдэхгүй. Хоёр skip нь өмнөх тайлантай ижил: own-assigned-only бодлогыг хэрэглэгч өөрчлөхгүй сонгосон; legacy top-level URL safety guard, харин ижил legacy файл fresh сан дотор 6/6 ажилласан.

`npm run test:hosted-social -- --manifest docs/hosted-social-sandbox.example.json` default run: **SKIPPED / PREPARED_NOT_RUN, networkRequests=0, hostedVerified=false**. Offline mock-ийн PASS нь hosted PASS биш. [Dry-run JSON](docs/evidence/phase6b-hosted-dry-run.json), [нэгдсэн бэлтгэлийн нотолгоо](docs/evidence/phase6b-validation.json), [bundle manifest](docs/evidence/phase6b-bundle-manifest.json)-тай тулгана.

Шинэ/өөрчилсөн файлууд: shared Edge `social-contract.mjs`, `test/social-adapter.test.mjs`; `scripts/hosted-social-probe.mjs`, `scripts/validate-hosted-social-sandbox.mjs`, `test/hosted-social-probe.test.mjs`; `scripts/prepare-hosted-social-sandbox.mjs`, `test/hosted-social-bundle.test.mjs`; `docs/hosted-social-sandbox.example.json`, `.env.hosted-sandbox.example`, энэ тайлан, `.gitignore`, `package.json`. Public empty template-ийн ignore exception нэмсэн; filled `.env.*` файлууд ignored хэвээр. SQL migration, frontend/Vercel config, production environment болон bot repository өөрчлөөгүй. Commit/push/deploy хийгээгүй.

Энэ бэлтгэлийг ашиглах дараалал: public manifest-ийг private operator copy-д actual sandbox ref/fixture UUID-ээр бөглөх → dedicated project/endpoint/credential gate-ийг шийдэх → curated artifact dry-run review → тусдаа зөвшөөрсөн schema/secret/Edge deployment → actual hosted read-only validation. Одоогоор энэ дарааллын external үйлдлүүд хийгдээгүй; send болон draft success нь дараагийн тусдаа stage хэвээр.
