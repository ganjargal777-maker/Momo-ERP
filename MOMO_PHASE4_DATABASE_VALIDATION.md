# MOMO ERP — Phase 4 PostgreSQL 15 баталгаажуулалт

Огноо: **2026-11-26, Asia/Ulaanbaatar**. Энэ тайлан нь actual ERP эх код дээр ажилласан local PostgreSQL 15 regression-ийн үр дүн юм. Production Supabase, hosted deployment, Meta болон GitHub-д өөрчлөлт хийгээгүй; ботын repository-г өөрчлөөгүй. Зөвхөн шинээр үүсгэсэн синтетик хэрэглэгч, байгууллага, Page, баг, AI текст ашигласан.

**Дүн: `npm run test:pg15` — 90 тест, 88 PASS, 0 FAIL, 2 SKIPPED, 8,067 ms.** Өмнөх 71 амжилттай ассертыг дахин ажиллуулсан. Хуучин Phase 4 compatibility файл мөн owned PostgreSQL 15 сан дотор child process-оор **6 PASS, 0 FAIL, 0 SKIPPED** болсон; энэ child-ийн тоог үндсэн 90 дээр дахин нэмж тооцохгүй. Build тусдаа PASS.

Нотолгоо: [машин унших JSON](docs/evidence/phase4-pg15-validation.json), [тестийн raw log](docs/evidence/phase4-pg15-tests.txt). Мigrations-ийн нэр/SHA-256, server version, image identity, rollback, cleanup болон бодлогын ажиглалтыг JSON-тай тулгана.

## 1. Бодитоор ашигласан орчин

| Хэсэг | Төлөв | Нотолгоо / хүрээ |
| --- | --- | --- |
| Docker Engine | PASS | Local Engine **29.9.3**, local Docker Desktop Linux named pipe; remote daemon/context ашиглаагүй |
| Supabase CLI | PASS | Installed CLI **3.4.0**; version/help only, no remote DB command |
| PostgreSQL | PASS | Actual `SHOW server_version` — **15.20**; major 15 гэдгийг harness ассертаар шалгасан |
| Cached image | PASS | `public.ecr.aws/supabase/postgres:15.20.0.004`; шинэ registry pull шаардлагагүй |
| Image ID | Recorded | `sha256:49653bf383f8e932839ae2b4723c5d7b367b00b5f507a24267eee39352030e58` |
| Test lifecycle | PASS | Run-specific container/network, ephemeral password, random **127.0.0.1** host port; existing database/volume сонгоогүй |
| Supabase local schema | PASS, хязгаартай | Actual ERP migrations/RLS/RPC; fake `auth.users`, `auth.uid()` ба authenticated role/claim GUC ашигласан |
| Full Supabase Auth/HTTP stack | SKIPPED | GoTrue-issued JWT, PostgREST, Edge/Deno, hosted CORS/transport-ийг энэ SQL run батлахгүй |

`test:pg15` нь Docker executable/Engine/PG15 байхгүй үед database тестийг амжилттай мэт алгасахгүй, шууд алдаагаар зогсоно. Runner `LOCAL_DB_URL`, `DATABASE_URL`, legacy opt-in болон native-PG override-ийг child environment-ээс хасаж, зөвхөн шинэ local cluster сонгоно. Нууц `.env`, production credential эсвэл бодит бизнесийн өгөгдөл fixture болоогүй.

## 2. Хүссэн арван шалгалтын матриц

| № | Шалгалт | Төлөв | Бодит үр дүн, хязгаар |
| --- | --- | --- | --- |
| 1 | Migration 001–004 дараалал | **PASS** | Core/RBAC-ийн дараа social 001→002→003→004, дараа existing alignment migration; файл бүрийн hash ба apply order JSON-д |
| 2 | Page/Team CRUD, RPC | **PASS** | Create/update/read/delete, membership/access RPC, tenant reference ба cascade; composite function нэг удаа гүйцэтгэгдэнэ |
| 3 | Organization, Page-level RLS | **PASS** | Cross-org болон зөвшөөрөлгүй Page нуугдана; inactive Page/team, explicit deny, read prerequisite; raw write/counter tampering deny |
| 4 | Primary/backup зөвшөөрөл, routing | **PASS** | Active linked membership; offline/empty primary→eligible backup; stale/away/leave/denied/unrelated agent сонгогдохгүй |
| 5 | Зөвхөн өөрт оноосон яриа харах | **SKIPPED** | Хэрэглэгч одоогийн Page-wide бодлогыг өөрчлөхгүй баталгаажуулахыг сонгосон. Strict own-assigned policy **хэрэгжээгүй**; тусдаа хамгаалалт гэж PASS өгөөгүй |
| 6 | Дөрвөн зэрэгцээ assignment | **PASS** | Ижил Page/context-д дөрвөн тусдаа connection→нэг assignment, нэг workload increment, нэг smart-assign audit; өмнөх 8-call ба өөр context-ийн зэрэгцээ тестүүд мөн PASS |
| 7 | Lock, optimistic version | **PASS** | Зэрэгцээ claim-ийн нэг нь амжилттай, stale contender 40001; өөрийн бус хүчинтэй lease, read-only claim deny; resolve replay counter давтан хасахгүй |
| 8 | Send idempotency, audit | **PASS — давхаргаар** | Edge/mock contract: тогтвортой key, replay, queued/poll, stale/unknown outcome; PostgreSQL: actor/org/Page-тэй audit commit/readback. Бодит bot/Meta delivery ба PG durable send outbox-ийг батлаагүй |
| 9 | AI thread/message/saved reply persistence | **PASS** | Commit→шинэ connection-оор readback/update; owner болон cross-org RLS; private saved reply нуугдана; thread delete→message cascade |
| 10 | Rollback, synthetic cleanup | **PASS — заасан хүрээнд** | Actual DDL-ийн successful/failed transaction rollback; committed pre-alignment backup→шинэ DB restore, catalog equality; synthetic FK dependents/audit/users/org болон owned container/network cleanup |

Strict policy-ийн бодит ажиглалт: тухайн Page-ийн эрхтэй өөр ажилтан өөрт нь оноогдоогүй assignment-ийг уншиж чадсан. Existing contract-ийн энэ үйлдлийг шалгасан тест **PASS**, харин “зөвхөн өөрт оноосныг л харна” гэсэн property-ийн observation **FAIL / implemented=false**. Шинэ restriction оруулах тестийг хэрэглэгчийн сонголтоор **SKIPPED** гэж тусад нь тэмдэглэсэн. SQL, UI эсвэл Edge policy-г далдуур өөрчлөөгүй.

## 3. Migration ба rollback-ийн нотолгоо

| Migration | Энэ run-ийн төлөв |
| --- | --- |
| `202611260001_momo_ai_social_phase2.sql` | Applied, PASS |
| `202611260002_multi_page_team_management.sql` | Applied, PASS |
| `202611260003_social_operations.sql` | Applied, PASS |
| `202611260004_social_real_data.sql` | Applied, PASS |
| `20261126111223_social_contract_alignment.sql` | Applied, PASS; source өөрчлөөгүй |

Fresh сан дээр prerequisites-ийг хэрэглэсэн. Хувь хүний/bootstrap production өгөгдөлтэй `202609170003_bootstrap_momo_erp.sql`, `202609180001_verify_admin_auth_rls.sql`, `202609180002_set_admin_first_name.sql`-ийг зориуд ажиллуулаагүй. Энэ нь social migration-уудыг алгассан гэсэн үг биш. Existing migration source-уудын эцсийн SHA-256 өөрчлөгдөөгүй.

Rollback хоёр өөр аргаар батлагдсан:

- Actual social 001–004 + alignment DDL-г transaction дотор ажиллуулаад `ROLLBACK`; хүснэгт, function, private schema, permission catalog анхны төлөвтөө буцсан. Зориуд 22012 алдаа үүсгэсэн transaction ч residue үлдээгээгүй.
- 001–004 **committed**, alignment-ээс өмнөх checkpoint-ийг custom-format `pg_dump`-аар хадгалсан. Source DB-д alignment commit хийсний дараа backup-ийг **шинэ, owned local database** руу сэргээж, baseline columns/policies/functions/permission catalog-тай ижил гэдгийг шалгасан.

Энэ нь ажиллаж байгаа санд in-place down migration хийсэн гэсэн үг биш. In-place down SQL хэрэгжүүлээгүй; production rollback хийж туршаагүй. Persistence нь commit болон connection хоорондын readback; crash/power-loss durability, disaster recovery SLA-ийн баталгаа биш.

## 4. Илэрсэн алдаа ба local засвар

| Асуудал | Засвар / баталгаа |
| --- | --- |
| Legacy fixture Admin-д `users.read` дутсан тул invoker CRUD profile lookup RLS-д хаагдсан | Синтетик role-д шаардлагатай бодит grant нэмсэн; production permission/policy-г сулруулаагүй |
| `(volatile_function(...)).*` composite expansion нь RPC-г олон удаа дуудах эрсдэлтэй | `SELECT to_jsonb(public.fn(...)) AS value`; яг нэг row/audit assertion |
| Fixed IDs, өмнөх fixture residue ба FK cleanup order | Unique synthetic IDs; approved knowledge/audit→auth user/profile→organization дараалал, residue assertion |
| Node test child environment parent test context-ийг өвлөсөн | Child test context-ийг тусгаарласан; legacy suite үнэхээр 6/6 ажилласныг log-оор шалгасан |
| Disposable Docker cluster host gateway HBA таараагүй | Зөвхөн owned network gateway CIDR-д synthetic `momo_local` SCRAM access; host port loopback хэвээр |
| PostgreSQL validation default-skip болох эрсдэл | `test:pg15` тусгай runner; Engine/image/major шаардлага хангагдахгүй бол fail closed |

Энэ шатанд **SQL migration, ERP UI, Page/team permission эсвэл Facebook ботын код өөрчлөөгүй**. Зөвхөн test/harness/package tooling зассан.

## 5. Regression, build ба skip тайлбар

- `npm run test:pg15`: **88 PASS / 0 FAIL / 2 SKIPPED**, нийт 90; өмнөх 71 passing assertion орсон.
- Nested legacy Phase 4: **6 PASS / 0 FAIL / 0 SKIPPED**, шинэ PG15 сан дотор ажиллаж, өөрийн synthetic organization-ийг цэвэрлэсэн.
- Skip 1: new own-assigned-only policy нь existing contract-д байхгүй, хэрэглэгч өөрчлөхгүйг сонгосон.
- Skip 2: top-level legacy test-д зориуд URL өгөөгүй safety guard. Ижил файл parent harness-ийн шинээр үүсгэсэн сан дотор explicit isolated marker-тай ажилласан тул DB validation алгассан гэж ойлгохгүй.
- `npm run build`: **PASS**, exact current package/script-ийг isolated Temp copy-д fake loopback URL/publishable config-оор ажиллуулсан. Actual frontend `runtime-config.js`-д бичээгүй; synthetic build output-ийн SHA-256 JSON-д. Production `.env` output-д ороогүй.

Өөрчилсөн source/tooling долоон файл:

- `package.json`
- `scripts/local-social-docker.mjs`
- `scripts/validate-social-pg15.mjs`
- `test/local-social-docker.test.mjs`
- `test/helpers/social-phase4-checks.mjs`
- `test/social-db.integration.test.mjs`
- `test/social-rls.local.test.mjs`

Тайлан болон JSON/log нь нэмэлт баримт; дээрх долоон source файлтай хольж тооцохгүй. Commit/push хийгээгүй.

## 6. Давтах арга ба hosted sandbox-ийн дараагийн gate

Local Docker Desktop Engine ажиллаж, cached PG15 image байгаа шинэ shell-д `MOMO_LOCAL_DOCKER_BIN`-ийг суусан `docker.exe`-ийн **absolute path**-аар өгөөд ERP root-оос `npm run test:pg15` ажиллуулна. Optional `MOMO_PHASE4_EVIDENCE_PATH` нь шинэ synthetic JSON report-ийн зам. Production env/DB URL өгөхгүй; existing Supabase stack/volume-г сонгохгүй.

Зөвшөөрсөн existing contract-ийн local ассертууд PASS, skip-үүд дээрх хүрээгээр тайлбарлагдсан. Дараагийн hosted sandbox validation-д техникийн хувьд шилжиж болно; энэ тайлан deploy хийх эсвэл production-д хүрэх зөвшөөрөл биш.

1. Тусдаа staging Supabase project, synthetic users/data, тусдаа Page runtime/credential mapping-ийг review хийж зөвшөөрнө. Feature flags болон auto-send default false хэвээр байна.
2. Migration/hash-ийг тулгаад staging-д тусад нь apply хийж, GoTrue-issued JWT, PostgREST/RLS, Edge/Deno, CORS болон active/revoked Page/global grants-ийн transport тест ажиллуулна.
3. Эхлээд read/draft; дараа нь засах→батлах→explicit manual send урсгал. Supabase user JWT-г bot Bearer, Meta token эсвэл service-role key болгож ашиглахгүй.
4. Тусгай зөвшөөрсөн sandbox Page/message дээр normal incoming webhook→processing→reply polling→ганц бодит reply-г батална. Mock sent, health, queued-г бодит Meta E2E гэж тооцохгүй.
5. Own-assigned-only шинэ бодлого хэрэгтэй бол SQL assignment rows төдийгүй Edge list/detail/history/reply/send-ийг хамтад нь шинэ contract/test-ээр шийднэ. Future v2 worker delegation/revocation, LLM, production recovery болон real provider delivery нь энэ PG15 run-ийн баталгаа биш.

ERP PostgreSQL-д send outbox/idempotency table зохиож нэмээгүй. Ботын durable SQLite send reservation/outbox, enqueue-ийн дараах ажилтны эрх цуцлалт болон Meta delivery-г дараагийн зохих integration/E2E шатанд тусад нь батална. Production deploy хийхгүй.
