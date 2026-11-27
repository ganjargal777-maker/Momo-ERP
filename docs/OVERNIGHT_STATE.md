# MOMO ERP overnight state

## Interactive isolated-server continuation — 2026-11-27

New owner authorization continues beyond the expired08:00 overnight schedule.
Base99809e7; existing worktrees/history and the original dirty checkout preserved.
The standalone Free Supabase sandbox mmvmvweitrhlgqtjadaz is now real/healthy:
18 curated migrations,3 deployed Edge Functions, signup disabled and exact
staging callbacks. No production migration/deploy/Auth/billing change occurred.
Free Render static staging is https://momo-erp-social-sandbox.onrender.com;
its initial frontend source is99809e7. This is not the production ERP domain.

- Added real ERP staff delivery-context/recheck RPCs and own-auth server Edge
  endpoint, plus trusted gateway identity headers. Default flags remain false.
- Actual local Auth/RLS/gateway→Bot HTTP/SQLite drill8PASS with1 mocked provider
  call; real Meta sends0. Hosted JWT/RLS/Edge11PASS, including real expiry;
  sandbox TTL restored3600, owned synthetic cleanup0 remaining. Final staging
  origin rerun10PASS; repeat expiry skipped because its separate proof passed.
- Fresh local browser27PASS with17migrations and actual CRUD/exports/revocation.
  Actual public Render staging browser15PASS/0FAIL/1emailSKIP, ownedcleanupPASS.
  Hosted JWT expiry11PASS/0FAIL/0SKIP separately. Runtime no-store verified.
  Current TAP/evidence files contain exact unit/fullPG counts and skip reasons.
  The PG wrapper uses unique actual evidence paths and records child exit status.
- Final unit regression184PASS/0FAIL/2SKIP; full actualPG regression253PASS/
  0FAIL/2SKIP. New anonymous-helper ACL hardening preserves authenticated RLS,
  invitations and profile trigger. Actual hosted anonymous RPC denials PASS;
  advisor anon SECURITY DEFINER findings4→0. Guarded authenticated RPC warnings
  remain intentional, not a missing-RLS finding. Post-hardening hosted browser
  repeats15PASS/1emailSKIP and service access repeats10PASS.
- Sandbox artifact preparation now requires17 exact migration/source hashes and
  fresh successful PG/rollback/restore/cleanup evidence; old bundles fail closed.
- Production backup inventory0/PITRfalse; existing PG credential unavailable.
  Read-only production dump/PG17 restore remains BLOCKED. Never create a
  temporary production CLI login implicitly to bypass that gate.
- Private Bot repository is unavailable to Render's current GitHub app. Scoped
  Bearer/no-send env generated in private ACL storage outside Git, NOT installed
  on a new Bot Render service. Do not publish/mirror the private repository.
- Meta UI observed Khoroolol messages subscription and current callback, then
  developer-account confirmation blocked further checks. Local Page token is
  bound to a different Page; no Graph/test/send used it. Current AI status unknown.

Read docs/MOMO_STAGING_VALIDATION.md and newest hosted browser/HTTP evidence
before the next run. Complete Bot hosted acceptance after repository-scoped
access; production deployment/send/paid actions require explicit owner approval.
Do not repeat completed local drills without a new change or unresolved concern.

Updated: 2026-11-27, Asia/Ulaanbaatar. Owner requests hourly independent safe
development until **2026-11-27 08:00 +08:00**; no production deployment, secret
changes, paid service, database reset or real customer test data.

## Агуулахын үлдэгдлийн бүрэн CSV · 2026-11-27 07:04, Улаанбаатар

Суурь `7650575`, хэрэгжүүлэлт ба браузерын шалгалт `3b92119`.
Агуулах болон тайлангийн дэлгэцээс тухайн байгууллагын зөвшөөрөгдсөн бүх
үлдэгдлийг CSV-ээр татна. Багананууд нь агуулахын ID, барааны ID, тоо хэмжээ.
Агуулах ба барааны ID хосоор хуудаслахад ижил агуулахын бүртгэл хэд хэдэн
хуудсанд хуваагдсан ч дараалал хадгалагдана. Тоо хэмжээ нь мөрийг унших
үеийн утга.

- Локал Chromium / GoTrue / PostgREST / PG15 — 27 PASS, 0 FAIL, 0 SKIPPED.
  Дэлгэцийн өгөгдөл 500 мөртэй байхад хоёр товчноос татсан 1,020 мөрийг
  PostgreSQL-тэй утга ба дарааллаар нь тулгав. Өөр байгууллагын мөр хасагдсан.
- Зөвхөн `inventory.read` эрхтэй ажилтан агуулахын дэлгэцээс татаж чадсан.
  Эрхийг цуцалсны дараа идэвхтэй сессийн шууд REST уншилтад 0 мөр харагдсан.
- Үндсэн regression — 158 PASS, 0 FAIL, 2 SKIPPED. Өгөгдлийн сангийн
  схемд өөрчлөлт ороогүй. Production бичилт 0. Backup/restore, rollback,
  hosted acceptance баталгаажаагүй тул production нэвтрүүлэлт BLOCKED.
- Дараагийн зөвшөөрөгдсөн хөгжүүлэлтээр захиалгын жагсаалтын хайлт болон
  хуудаслалтыг серверт шилжүүлж, 500-аас өмнөх захиалга олдохыг шалгана.
  08:00-д энэ хуваарь дуусаж, automation PAUSED болно.

## Мөнгөн урсгалын бүрэн CSV · 2026-11-27 06:05, Улаанбаатар

Суурь `18e0434`, хэрэгжүүлэлт ба browser evidence `8d20ee9`.
Тайлан болон санхүүгийн дэлгэцээс татахад тухайн байгууллагын демо бус
гүйлгээг болсон хугацаа, ижил хугацаанд ID буурах дарааллаар уншина.
Хуудас бүр уншсан үеийн утгатай. Санхүү унших эрх хангалттай.

- Локал Chromium / GoTrue / PostgREST / PG15 шалгалт 26 PASS, 0 FAIL,
  0 SKIPPED. Дэлгэц 500 мөртэй үед CSV-ийн 1,006 гүйлгээний төрөл, дүн,
  тайлбар, хугацаа болон дарааллыг PostgreSQL-тэй тулгав. Демо ба өөр
  байгууллагын мөр хасагдсан. Ижил хугацаатай мөр хуудасны заагт бүрэн орсон.
- Эрхгүй ажилтны экспорт хаалттай. Идэвхтэй хэрэглэгчийн `finance.view`
  эрхийг цуцлахад байгууллагын шүүлтгүй шууд REST уншилт 0 мөр буцаав.
- Үндсэн regression 158 PASS, 0 FAIL, 2 SKIPPED. Өгөгдлийн сангийн схемд
  өөрчлөлт ороогүй. Тусдаа бүтэн PG15 regression-ийн сүүлийн үр дүн өмнөх
  гүйлтийнх. Энэ удаагийн browser шалгалт бодит локал PG15 ашигласан.
- Production бичилт 0. Backup/restore, rollback болон hosted acceptance
  баталгаажаагүй тул production нэвтрүүлэлт BLOCKED.
- Дараагийн ажил нь үлдэгдлийн CSV-г 500 мөрөөс давуулж, агуулах, бараа,
  тоо хэмжээ, байгууллагын тусгаарлалт ба `inventory.read` эрхийг шалгах.

## Хүргэлтийн бүрэн CSV · 2026-11-27 05:06, Улаанбаатар

Суурь `a4da8e0`, хэрэгжүүлэлт ба нотолгоо `82f3eec`.
Хүргэлтийн тайлан байгууллагын демо бус захиалгад хамаарах хүргэлтийг
500 хүртэл мөрөөр үргэлжлүүлэн уншина. Хуудас бүр тухайн үед хадгалагдсан
утгыг агуулна. Хүргэлт унших эрх хангалттай.

- Локал Chromium / GoTrue / PostgREST / PG15 шалгалт 24 PASS, 0 FAIL,
  0 SKIPPED. Дэлгэцийн жагсаалт 500 мөртэй байхад CSV-ийн 1,008 хүргэлт
  PG-ийн хүлээгдэж буй дараалал болон дөрвөн талбартай таарсан. Демо
  болон өөр байгууллагын мөр хасагдсан. Хүргэлтийн эрхийг цуцлахад
  байгууллагын шүүлтгүй шууд REST хүсэлт 0 мөр буцаасан.
- Үндсэн regression 158 PASS, 0 FAIL, 2 SKIPPED. Тусгаарласан PG15 бүхий
  regression 225 PASS, 0 FAIL, 2 SKIPPED. Browser ба PG evidence шинэчлэгдсэн.
- Production бичилт 0. Backup/restore, rollback болон hosted acceptance
  баталгаажаагүй тул production нэвтрүүлэлт BLOCKED.
- Дараагийн ажил нь мөнгөн урсгалын CSV-г 500 мөрөөс давуулж,
  `finance.view` эрх, дүн, орлого/зарлагын төрөл, демо болон байгууллагын
  шүүлтийг локал PostgreSQL-тэй тулгах.

## Захиалгын бүрэн CSV · 2026-11-27 04:08, Улаанбаатар

Суурь `774f823`, хэрэгжүүлэлт ба нотолгоо `4e5b83d`.
Тайлангаас татахад захиалгын дугаараар буурахаар эрэмбэлж, байгууллагын
унших эрхтэй, демо тэмдэглэгээгүй бүх захиалгыг 500 хүртэл мөрөөр уншина.
Хуудас бүрийг тусдаа хүсэлтээр уншдаг тул төлөв, дүн нь тухайн хуудсыг
унших үеийн утга байна. Дутуу уншвал файлыг үүсгэхгүй.

- Локал Chromium / GoTrue / PostgREST / PG15 22 PASS, 0 FAIL, 0 SKIPPED.
  Дэлгэцэд 500 захиалга ачаалсан үед татсан CSV-ийн 1,008 захиалгын дугаар
  PostgreSQL-ийн жагсаалттай дарааллаараа таарсан. Демо болон өөр байгууллагын
  мөр хасагдсан. Эрхгүй ажилтны экспорт хаалттай. Туршилтын орчин цэвэрлэгдсэн.
- Үндсэн regression 158 PASS, 0 FAIL, 2 SKIPPED. Тусдаа бүрэн PG regression
  ажиллуулаагүй. Production бичилт 0. Нөөц хуулбар, сэргээх туршилт, rollback
  болон hosted acceptance баталгаажаагүй тул нэвтрүүлэлт BLOCKED.
- Дараагийн ажил нь хүргэлтийн CSV-г 500 мөрөөс давуулж, байгууллага болон
  демо захиалгын шүүлт, хүргэлт унших эрхийг локал өгөгдлөөр шалгах.

## Агуулахын хөдөлгөөний бараа сонголт · 2026-11-27 03:00, Улаанбаатар

Суурь `d4ed026`, хэрэгжүүлэлт ба нотолгоо `0537214`. Агуулахын хөдөлгөөн
бүртгэхдээ байгууллагын идэвхтэй каталогоос нэр эсвэл SKU-гаар хайна.
Хайлтын текст өөрчлөгдвөл өмнөх барааны сонголт цэвэрлэгдэнэ.

- Локал Chromium / GoTrue / PostgREST / PG15 шалгалт 21 PASS, 0 FAIL,
  0 SKIPPED. Сүүлийн 500 бараанд багтаагүй SKU-г сонгож, шинэ агуулахад
  4 ширхэг орлогодов. PostgreSQL-д нэг хөдөлгөөн, 4 ширхэг үлдэгдэл үүсэж,
  бусад агуулахын үлдэгдэл хэвээр байгааг шалгав. Туршилтын орчин цэвэрлэгдсэн.
- Эхний браузерын гүйлт захиалгын бараа хайх үед хугацаа хэтэрсэн.
  Захиалга, дугаарын маягтын эхний талбарт фокусыг нээх мөчид өгдөг
  болгосны дараах бүрэн гүйлт тэнцэв. Үндсэн regression 158 PASS, 0 FAIL,
  2 SKIPPED (тусдаа DB шаарддаг). Тусдаа бүрэн PG regression ажиллуулаагүй.
- Дараагийн ажил нь захиалгын CSV-г 500 мөрөөс давуулан бүрэн экспортлох,
  мөрийн тоо, давхардал, унших эрхийг локал өгөгдлөөр шалгах.
- Production нөөц хуулбар, сэргээх туршилт, rollback болон hosted acceptance
  баталгаажаагүй тул нэвтрүүлэлт BLOCKED. Production бичилт 0.

## Захиалга, дугаарын барааны хайлт · 2026-11-27 02:00, Улаанбаатар

Суурь `93cd727`, хэрэгжүүлэлт ба браузерын нотолгоо `5334de7`.
Захиалга, дугаарын маягт тухайн байгууллагын идэвхтэй барааг нэр эсвэл
SKU-гаар хайна. Дугаарыг захиалга болгоход сонгосон бараа, хөнгөлөлттэй
үнэ дамжиж, тоо ширхэг өөрчлөхөд төлбөр авах дүн шинэчлэгдэнэ.

- Локал Chromium / GoTrue / PostgREST / PG15 шалгалт 20 PASS, 0 FAIL,
  0 SKIPPED. Сүүлийн 500 мөрд ороогүй SKU-г хоёр маягтаас сонгож,
  шууд болон дугаараас үүсгэсэн захиалгын UUID, ширхэг, нэгж үнэ,
  нийт дүнг PostgreSQL-ээс шалгав. Локал орчны цэвэрлэгээ амжилттай.
- Үндсэн regression 158 PASS, 0 FAIL, 2 SKIPPED. Хоёр шалгалт тусдаа
  өгөгдлийн сан шаарддаг. Энэ гүйлтээр тусдаа бүрэн PG regression ажиллуулаагүй.
- Дараагийн ажил нь нөөцийн хөдөлгөөний маягтад бүх идэвхтэй бараанаас
  хайж сонгох боломж нэмэх. Сүүлийн 500 мөрөөс гадуурх барааг сонгож,
  сонгосон агуулах дахь үлдэгдэл болон хөдөлгөөний бичилтийг шалгана.
- Production нөөц хуулбар, сэргээх баталгаа, rollback, hosted acceptance
  баталгаажаагүй тул нэвтрүүлэлт BLOCKED. Production бичилт 0.

## Catalog pagination, 2026-11-27 01:03 run, Asia/Ulaanbaatar

Implementation and browser evidence in `7c15cd5` on verified overnight base
`d291fec`. The readiness checkpoint `c4c088c` is already an ancestor.
The catalog requests 24 active products per page, filtered by organization,
name/SKU and optional category before counting. Equal names sort by UUID.
Stock uses the page's product IDs. Edits and archives use the displayed row's
version, including products outside the 500-row operational snapshot.

- Local Chromium with real GoTrue, PostgREST, PG15 and Mailpit finished with
  19 PASS / 0 FAIL / 0 SKIPPED. All 506 equal-name fixtures matched the database
  across 22 pages. A last-page product showed six units across two warehouses.
  Editing its name and category updated the original UUID. Literal punctuation,
  case-insensitive search, category selection and previous-page navigation passed.
  Evidence is in `docs/evidence/browser-erp-acceptance.json`.
- Local default regression finished with 158 PASS / 0 FAIL / 2 SKIPPED. The
  two database entrypoints require their own isolated targets. The browser
  suite applied 15 migrations on its own PG15 instance and cleaned it up.
  The separate full PG15 regression was last run for the dashboard change below.
- Next run should extend server-side product lookup to the order and lead forms.
  These selectors still search the latest 500 products. Verify choosing a SKU
  outside that snapshot, quantity/price updates and the saved product UUID.
- Hosted acceptance and deployment remain BLOCKED pending verified backup,
  restore, rollback and hosted acceptance access. Production writes were zero.

## Dashboard SKU totals, run started 2026-11-26 23:56 +08:00

Implementation and evidence commit `1e046ff` on `6f28334`. Readiness
and invitation history were already merged at `d4ed605`. Dashboard and
warehouse summary count each active product once across its organization's
warehouses. Products with no balance rows count as out of stock. Finance
valuation includes stock still held for archived products.

- Local PostgreSQL 15 regression: 223 PASS / 0 FAIL / 2 SKIPPED.
  Covers quantities 0/1/5/6, archived stock valuation and tenant isolation.
  The standalone legacy entrypoint skipped and all six legacy checks ran in
  the isolated suite. The own-assigned-only policy remains gated.
- Local Chromium with real GoTrue, PostgREST, PG15 and Mailpit: 18 PASS /
  0 FAIL / 0 SKIPPED. Four active SKUs displayed one low and one out of stock.
  All 15 applicable migrations applied and the owned stack was removed.
- Evidence: `docs/evidence/core-pg15-tests.tap`, `core-pg15-validation.json`
  and `browser-erp-acceptance.json` in the same directory.

Next: add server-backed catalog pagination with deterministic ordering and
verify the next page of a synthetic catalog larger than 500 active products.
Hosted acceptance and production rollout remain BLOCKED pending verified
backup/restore, rollback and hosted acceptance access. Production writes: zero.

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
