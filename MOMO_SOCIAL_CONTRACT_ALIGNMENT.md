# MOMO Social: ERP ↔ Messenger гэрээний тохируулга

Огноо: 2026-11-26, Asia/Ulaanbaatar. Энэ тайлан ERP Codex-д зориулсан локал эх код, migration болон тестийн handoff юм. **Production deploy, remote Supabase migration/function deployment, Meta subscription/routing, production secret өөрчлөлт хийгдээгүй. Бодит хэрэглэгч рүү тест мессеж/comment илгээгээгүй.**

Эцсийн **actual ERP `npm test`: 72 нийт, 71 pass, 0 fail, 1 intentional skip**, 18,857 ms. Edge 22, service 13, UI 10, isolated PostgreSQL 26 (parent + 25 SQL subtest); existing `LOCAL_DB_URL` opt-in suite 1 skip. Latest SQL/UI/service болон browser mock-ийн Page/team routing засварууд actual source-д орсон; энэ дүн тэдгээр файл дээр ажилласан. JS/shared core/TS entry-ийн syntax шалгалтууд мөн амжилттай. Ботын 91 тест нь өмнөх handoff-ийн нотолгоо; энэ ERP ажлаар ботын suite-г дахин ажиллуулаагүй.

## 1. Хүрээ ба эх сурвалж

ERP root: `C:/Users/begii/OneDrive/Documents/ChatGPT/Хүргэлтийн вэб сайт хийхн`.

Уншсан ботын root: `C:/Users/begii/OneDrive/Documents/ChatGPT/Чат шүүх чат бот үүсгэх`. Тэнд дараах таван баримтыг зөвхөн уншиж тулгасан; энэ тохируулгаар ботын эх код/сан/нууцыг өөрчлөөгүй.

| Ботын баримт | ERP Phase 2–4 эх кодын зөрүү | Энэ тохируулгын шийдэл / үлдсэн хил |
| --- | --- | --- |
| `MOMO_INTEGRATION_READINESS.md` | Edge global permission шалгадаг ч Page resolver, idempotency, structured error дутуу | Page-scoped gateway, trusted env resolver, safe error/status, тогтвортой operation key |
| `docs/MOMO_MULTI_PAGE_CONTRACT.md` | ERP-д Page/team schema байгаа боловч нэг global bot URL/token бүх Page-д хэрэглэгддэг | Registry UUID → org/external ID → Page бүрийн тусдаа **v1** runtime; нэг runtime multi-Page/v2 хэрэгжүүлээгүй |
| `docs/MOMO_MESSENGER_E2E.md` | Synthetic sample/mock pass нь real KH incoming/reply батлахгүй | Локал rehearsal, local SQL, real Meta acceptance-ийг тусад нь тайлагнана; бодит KH E2E unverified |
| `docs/MOMO_SANDBOX_DEPLOYMENT.md` | Edge `mock` нь Supabase Auth/DB-г ашигладаг байсан; offline fake-тай андуурагддаг | Dependency-injected stateful fixtures; deployed entry mock өгөгдөл өөрөө зохиохгүй; sandbox rollout тусдаа gate |
| `MOMO_ERP_INTEGRATION.md` | Bot v1 comment/history/reply poll, optimistic version, scopes, 202 semantics-ийг UI бүрэн дагадаггүй | Доорх action mapping, Page/resource ownership preflight, version/approval/send/poll урсгал |

ERP-ийн эх суурь: core schema/RBAC; `202611260001_momo_ai_social_phase2.sql`; `202611260002_multi_page_team_management.sql`; `202611260003_social_operations.sql`; `202611260004_social_real_data.sql`; `MOMO_AI_SOCIAL_INTEGRATION_PLAN.md`. Шинэ hardening migration: [20261126111223_social_contract_alignment.sql](supabase/migrations/20261126111223_social_contract_alignment.sql).

## 2. ID ба өгөгдлийн тусгаарлалт

`facebook_pages` нь authoritative ERP registry хэвээр; шинэ registry table үүсгээгүй. `facebook_pages.id` нь ERP **UUID**; `external_page_id` нь Meta-ийн тоон **string**; bot context/reply/message UUID нь тэдгээрээс тусдаа. Public profile URL-ийн ID-г Graph API Page ID болгож орлуулахгүй.

Одоогийн бот нэг runtime/SQLite сан/credential/Page-тэй. Gateway Page бүрт тусдаа v1 runtime сонгоно. Query/body-ийн URL/token, registry `settings` доторх URL, `credential_reference`-ийг backend сонгоход ашиглахгүй. Browser өөрөө org, external Meta ID, upstream host эсвэл secret сонгох эрхгүй.

Registry унших хоёр safe RPC:

- `list_social_page_registry()` нь зөвхөн `id,organization_id,name,external_page_id,is_active,connection_status,created_at,updated_at` projection өгнө. `pages.read` хэрэглэгчид өөрийн org-ийн Page-үүд; inbox-only хэрэглэгчид зөвшөөрсөн идэвхтэй Page-үүд харагдана. `credential_reference/settings` өгөхгүй; raw Page SELECT policy-г өргөжүүлээгүй.
- `get_social_page_context(target_page uuid, required_action text)` нь **зөвхөн** `{id,organization_id,external_page_id,is_active,connection_status,updated_at}` JSON өгнө. Active profile/current org, global action permission болон effective Page action шаарддаг.

`can_access_social_page(...)=true` нь global action permission, feature flag, runtime capabilities эсвэл send window хангагдсан гэсэн үг биш. Эдгээр guard тусдаа.

## 3. Edge authentication ба request гэрээ

[Entry](supabase/functions/social-integration/index.ts) нь `npm:@supabase/supabase-js@2.112.3` exact pin ашиглана; тухайн version public npm registry-д байгааг metadata-аар шалгасан. SDK package install эсвэл project secret унших шаардлагагүй байсан. [Shared core](supabase/functions/_shared/social-contract.mjs) нь SDK/env/network dependency-гаа injection-ээр авдаг.

`config.toml`-ийн `verify_jwt=true`-г хэвээр хадгална. Handler `getUser(jwt)`-ээр caller-ийг шалгаад `profiles.status='active'`, organization, `has_permission`, org feature flags, Page action болон safe context RPC-г шалгана. User-editable metadata-г authorization-д ашиглахгүй. User JWT-тай RLS-scoped client хэрэглэнэ; service-role client үүсгэхгүй. [Supabase Edge auth](https://supabase.com/docs/guides/functions/auth), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser).

Зөвшөөрсөн Origin нь яг `https://erp.momoshop.mn`, `http://localhost:4173`; POST/OPTIONS. JSON body ≤64 KiB; unknown action/key, буруу UUID/resource/version/key-г reject хийнэ. JWT browser → Edge-д очно; bot ERP Bearer browser-д ирэхгүй, browser Origin/JWT bot руу forward хийхгүй.

CORS-ийн эдгээр утга entry/core-ийн fixed default allowlist. Шинэ hosted staging UI origin нэмэхдээ code allowlist-ийн тусдаа review шаардлагатай; wildcard эсвэл browser-ийн өгсөн origin-ийг автоматаар зөвшөөрөхгүй.

Assistant-аас бусад action бүр `pageId:<ERP Page UUID>` шаарддаг. `resource:'messenger'|'comment'`; legacy compatibility-ийн default messenger боловч шинэ UI explicit дамжуулна. `reply.version` нь **bot reply version**, ERP assignment version биш.

| Action | Payload-ийн нэмэлт талбар | Global permission | Effective Page action | Org flag | v1 target |
| --- | --- | --- | --- | --- | --- |
| `capabilities` | байхгүй | `social_inbox.read` | read | `social_inbox_read` | GET capabilities |
| `list` | `filters?:{limit,cursor,status,assignedTo}` | `social_inbox.read` | read | read flag | GET conversations эсвэл comments |
| `detail` | `id` | `social_inbox.read` | read | read flag | GET context/:id |
| `history` | `id,filters?:{after,limit}` | `social_inbox.read` | read | read flag | GET conversations/:id/messages; Messenger only |
| `reply` | `id` **эсвэл** `reply:{id}` | `social_inbox.read` | read | read flag | GET replies/:id |
| `settings` | байхгүй | `social_inbox.read` | read | read flag | GET settings; mutation expose хийгээгүй |
| `suggest` | `id` | `social_inbox.reply_draft` | read + reply | read + `social_inbox_ai_draft` | POST context/:id/suggestions `{}` |
| `edit` | `reply:{id,version,text}` | `social_inbox.reply_draft` | read + reply | read + draft flag | PATCH replies/:id `{expectedVersion,text}` |
| `approve` | `reply:{id,version}` | `social_inbox.reply_draft` | read + reply | read + draft flag | POST replies/:id/approve `{expectedVersion}` |
| `send` | `reply:{id,version},idempotencyKey` | `social_inbox.reply_send` | read + reply | read + `social_inbox_reply_send` | POST replies/:id/send `{expectedVersion}` |
| `update` | `id,patch:{expectedVersion,status?,paused?}` | `social_inbox.assign`; `status=done` бол нэмэлт `social_inbox.resolve` | read + assign; **status өөрчлөх бүрд reply** | read flag | PATCH context/:id |
| `audit` | `filters?:{after,limit}` | `social_audit.read`, inbox read prerequisite | read | read flag | GET audit |
| `assistant` | `query` | `ai_assistant.use`, `ai_assistant.erp_read`, `products.read`; stock-д `inventory.read` | Page шаардлагагүй | `momo_ai_grounded_search` | ERP products/inventory; bot proxy биш |

Бүх social mutation нь global inbox read prerequisite-тай. `approve`-д тусдаа зохиомол permission үүсгээгүй: existing `social_inbox.reply_draft` mapping хэвээр; тусдаа approver role хэрэгтэй бол дараагийн бодлогын өөрчлөлт байна.

`update.patch.assignedTo` байгаа л бол 400 `assignment_managed_by_erp`, null ч адил. Bot metadata нь ажилтан/багийн authority биш; assignment-ийг `update_social_conversation` RPC-ээр хийнэ. Comment-д paused байхгүй. Bot status болон ERP assignment `open/waiting/resolved` хоёр тусдаа; нэгийг нөгөөгөөр чимээгүй overwrite хийхгүй.

Доорх нь ирээдүйн staging request-ийн **зохиомол** жишээ; hosted endpoint-д бодитоор дуудлага хийгээгүй. Browser SDK-ийн `functions.invoke('social-integration', {body})` нь user session JWT болон project publishable/anon key-г ашиглана. HTTP хэлбэр нь `POST <SUPABASE_URL>/functions/v1/social-integration`; bot target-уудын нийтлэг prefix `/erp/v1`.

```json
{"action":"send","pageId":"00000000-0000-4000-8000-000000000002","resource":"messenger","reply":{"id":"00000000-0000-4000-8000-000000000003","version":3},"idempotencyKey":"ui-example-operation-0001"}
```

202 response-ийн хэсэгчилсэн жишээ:

```json
{"ok":true,"data":{"replyId":"00000000-0000-4000-8000-000000000003","state":"queued","version":4,"replayed":false},"meta":{"pageId":"00000000-0000-4000-8000-000000000002","externalPageId":"12345","mode":"live","upstreamStatus":202,"requestId":"example-request-id","auditRecorded":true,"outcomeUnknown":false,"operationId":"example-derived-operation-id"}}
```

Client дараа нь `{"action":"reply","pageId":"<same ERP UUID>","resource":"messenger","id":"<same bot reply UUID>"}` гэж poll хийнэ. `meta.operationId` нь бодит response-д 64 тэмдэгтийн SHA-256 hex; дээрх утга зөвхөн placeholder. 409 stale version дээр шинэ төлөв уншина; 429-д Retry-After-ийг дагана; unknown outcome дээр ижил version/key-г хадгална.

## 4. Server-only runtime mapping

**Зөвхөн зохиомол config schema**; бодит token/hostname биш:

```json
[
  {
    "erpPageId":"00000000-0000-4000-8000-000000000002",
    "organizationId":"00000000-0000-4000-8000-000000000001",
    "externalPageId":"12345",
    "apiVersion":"1",
    "baseUrl":"https://page-a.example.invalid",
    "tokenEnv":"FACEBOOK_BOT_ERP_TOKEN_BRANCH_A"
  }
]
```

JSON-ийг `FACEBOOK_BOT_PAGE_REGISTRY_JSON` server env-д хадгална. Token нь тусдаа `FACEBOOK_BOT_ERP_TOKEN_BRANCH_A` secret. `FACEBOOK_BOT_ALLOWED_ORIGINS_JSON` нь exact HTTPS origins-ийн тусдаа allowlist. URL userinfo/query/hash/path, loopback/private IP хэлбэр болон allowlist-гүй origin-ийг reject хийнэ. Inline token, arbitrary secret reference, body URL, registry settings URL зөвшөөрөхгүй.

| Edge server environment | Үүрэг / хамгаалалт |
| --- | --- |
| `SUPABASE_URL` | Тухайн ERP/staging Supabase project; browser input-оос сонгохгүй |
| `SUPABASE_ANON_KEY` | User JWT-тай RLS-scoped client-ийн project key; service-role key биш |
| `SOCIAL_ADAPTER_MODE` | `mock` default; `live` нь зөвхөн reviewed mapping/flag/зөвшөөрлийн дараа |
| `FACEBOOK_BOT_PAGE_REGISTRY_JSON` | Trusted ERP UUID + org UUID + external ID + v1 origin + tokenEnv mapping |
| `FACEBOOK_BOT_ALLOWED_ORIGINS_JSON` | Backend bot origin-уудын exact HTTPS allowlist; browser CORS allowlist-ээс тусдаа |
| `FACEBOOK_BOT_ERP_TOKEN_<NAME>` | Registry `tokenEnv`-ээр нэрлэсэн dedicated backend credential; browser/source/URL-д өгөхгүй |
| `FACEBOOK_BOT_API_BASE_URL`, `FACEBOOK_BOT_ERP_TOKEN` | Зөвхөн registry байхгүй legacy нэг-runtime branch; доорх гурван pin заавал |
| `FACEBOOK_BOT_EXPECTED_ERP_PAGE_ID`, `FACEBOOK_BOT_EXPECTED_ORGANIZATION_ID`, `FACEBOOK_BOT_EXPECTED_PAGE_ID` | Legacy ERP UUID / org UUID / Meta external ID-ийн гурван explicit pin |

Legacy ганц backend compatibility нь registry **байхгүй/хоосон үед л** existing `FACEBOOK_BOT_API_BASE_URL` + `FACEBOOK_BOT_ERP_TOKEN`-ийг ашиглана. Дээрээс нь дараах **гурван pin бүгд** safe RPC-тай таарах ёстой:

- `FACEBOOK_BOT_EXPECTED_ERP_PAGE_ID` — ERP UUID.
- `FACEBOOK_BOT_EXPECTED_ORGANIZATION_ID` — verified org UUID.
- `FACEBOOK_BOT_EXPECTED_PAGE_ID` — Meta external numeric string.

Live mode-д Page active/connected, config-ийн org/Page/external identity таарах бөгөөд **хүсэлт бүрд** `/erp/v1/capabilities`-ийн `apiVersion='1'`, `pageId=external_page_id`-г тулгана. Proposed v2 mapping/version fail closed; `/erp/v2` proxy хэрэгжүүлээгүй. Detail/reply/context preflight нь stored resource ID, Page болон channel-ийг шалгана; message history-ийн мөрүүд ч context/Page-дээ таарна. Mutation-ийн яг өмнө audit/preflight wait-ийн дараа global permission, flags, Page read/action/context-ийг шинээр шалгана.

`SOCIAL_ADAPTER_MODE` default mock. Deployed entry stateful fixture үүсгэхгүй: fixture injection байхгүй mock social action 503 `mock_not_configured`. `mock` гэж тохируулсан төдий бодит Supabase Auth/DB fixture тусгаарлагдсан гэсэн үг биш. Бодит hosted test нь зориулалтын staging project шаардана.

Одоогийн token selection нь **Page бүрд нэг service credential**, ажилтан/action бүрд өөр token сонгодог систем биш. Read-only шатанд `inbox:read`; draft/edit-д нэмэлт `replies:write`; approve-д `replies:approve`; manual send-д `replies:send`; bot context update-д `conversations:write`; audit-д `audit:read` scope хэрэгтэй. Settings write, catalog scope-ийг энэ gateway-д шаардлагагүйгээр өгөхгүй. Credential-ийн `pageIds` нь зөвхөн тухайн sandbox Meta Page-г заана; ажилтны Page/action эрхийг Edge тусад нь enforce хийнэ.

Org-ийн `social_inbox_ui`, `social_inbox_read`, `social_inbox_ai_draft`, `social_inbox_reply_send`, `momo_ai_ui`, `momo_ai_grounded_search` default false хэвээр. Зөвшөөрсөн тусдаа sandbox-ийн read тестэд bot `ERP_API_ENABLED=true`, `AUTO_REPLY=false`, анхны `ERP_SEND_ENABLED=false`, comments/send/control/catalog flags false; persisted `autoSendMessenger=false`, `autoSendComments=false` гэдгийг GET settings-ээр шалгана. Existing санг дахин ашиглахад persisted settings env-ээс хамааралгүй хадгалагддаг. Reviewed manual тестэд шаардлагатай control/send gates-ийг тусад нь нээх хүртэл илгээхгүй; automatic settings false хэвээр. Gateway нь auto-send settings PATCH action expose хийгээгүй.

## 5. Reply state, idempotency, error ба audit

Default workflow: **draft → засвар → approve → explicit send → reply poll**. Edit нь approval-г хүчингүй болгож шинэ version өгнө; incoming source өөрчлөгдвөл old draft/approval/queue superseded болно. 202=`queued`; `sent` гэж шууд харуулахгүй. Messenger window, standby read-only, pause/done, deleted comment болон current basis guard-ийг bot v1 дахин enforce хийнэ.

UI key-г org/user/Page/resource/reply/approved-version-ийн хүрээнд sessionStorage-д тогтвортой хадгалж, double-click/in-flight request-ийг нэгтгэнэ. Edge `idempotencyKey` 8–128 allowlisted тэмдэгт шаарддаг; random fallback байхгүй. Upstream key нь `SHA256([verifiedOrg,ERPPageUUID,verifiedUser,clientKey])`. Timeout/retry-д **ижил reply version + ижил key** хадгална. Нэвтрэлт/flags/Page grant цуцлагдвал cached operation replay ч deny болно.

Gateway request/body/response нь bounded: body 64 KiB, decoded response **8 MiB**, default нийт deadline 10 секунд; caps/preflight/DB wait/body уншилт энэ deadline-г хуваалцана. Redirect хоригтой, automatic retry байхгүй. 8 MiB нь олон урт Mongolian inbox message/comment-д зориулсан gateway cap; ботын тусдаа catalog adapter-ийн 256 KiB provider cap-ийг өөрчлөхгүй.

Success: upstream HTTP status-ийг, 201/202-г оролцуулан хадгалсан `{ok:true,data,meta}`. Meta нь verified ERP Page UUID, external ID, mode, requestId/upstreamRequestId, upstreamStatus, auditRecorded, outcomeUnknown болон optional operationId өгнө. Error: `{ok:false,error:{code,message,requestId,...}}`; upstream safe code/status/requestId/Retry-After хадгалж, raw SQL/provider message, query, token, cookie эсвэл backend authorization-ийг буцаахгүй.

SQL error mapping: 42501→403 permission, P0002→404, 40001/55P03→409, 22023/23514→400, 23505→409; unknown→503 sanitized. Mutation intent audit хадгалах боломжгүй бол **503, provider write 0**. Bot response мэдэгдсэний дараах audit алдаа нь known queue/sent response болон idempotency-г алдуулахгүй; `auditRecorded=false` гэж илэрхийлнэ. Mutation хийсэн байж болох timeout/5xx нь `outcomeUnknown=true`, stable operationId-тай; шинэ key-ээр blind retry хийхгүй, reply poll/ижил operation replay хэрэглэнэ.

Audit-д verified actor UUID, org, ERP Page UUID/external ID, operation/request correlation, action/version/outcome metadata байна; message text/token хадгалахгүй. Bot v1-ийн actor нь service credential хэвээр. **Edge ажилтны authorization-ийг bot queue дотор delegation хийж enforce хийдэггүй.** Enqueue болсны дараах employee revocation, policy epoch, signed delegated actor/team, per-job reauthorization нь future v2 release blocker; энэ ажлаар шийдсэн гэж тайлагнахгүй.

## 6. SQL Page/team/routing хамгаалалт

Latest alignment migration-ийн public wrappers нь SECURITY INVOKER; narrow private helpers нь schema-qualified, empty search_path, self-authorizing SECURITY DEFINER хүрээнд байна. Arbitrary subject permission helpers owner-only; authenticated-д зөвхөн current-user predicates болон эрхээ дотроо дахин шалгадаг wrapper targets өгнө. PUBLIC/anon execute эрхийг цуцалсан. Trigger helper-үүд RPC болохгүй. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

- **Explicit deny:** Page/user access row байвал тэр row team/manager implicit grant-ийг action бүрээр override хийнэ. `can_read=false` бол raw reply/assign true байсан ч effective read/reply/assign false. Row байхгүй бол active primary/backup membership эсвэл manager baseline үйлчилнэ.
- Page, team, member/profile нь active/current org-д байх ёстой. Cross-org Page/team/user link write-ийг policy/reference guards хаана. Knowledge/saved-reply-ийн INSERT/UPDATE эрхийг SELECT policy-той хольсон `FOR ALL` grant болгон ашиглахгүй; Page SELECT RLS-ийг write policy-гаар тойрохгүй.
- **Capacity** нь `count(distinct linked Page)`, conversation workload биш. Team-row lock ба triggers нь parallel link/capacity өөрчлөлт, primary=backup зөрчил, cap-аас доош бууруулалтыг шалгана.
- Assignment болон workload counter-ийн direct table write-ийг authenticated-аас цуцалсан. Browser өөрийн presence `status/updated_at`-ийг л өөрчилнө; counter өгч чадахгүй. DB heartbeat server timestamp-аар freshness тогтооно; future timestamp spoof хийхгүй.
- `smart_assign` нь `(Page,externalConversationId)` advisory transaction lock, нэг мөрийн unique identity, primary → backup priority loop, eligible agent-ийн presence-row lock/SKIP LOCKED ашиглана. Candidate нь same-org active team/member/profile, online fresh heartbeat, effective Page read/reply болон global inbox read/draft/send эрхтэй байна. Offline/away/leave/stale/denied/unrelated candidate сонгохгүй.
- Eligible primary байхгүй бол backup-уудыг дарааллаар шалгана; candidate байхгүй бол unassigned мөр үүсгэнэ. Ижил incoming identity-ийн concurrent call нэг assignment/audit/workload outcome-той байна; өөр Page-ийн ижил external ID тусдаа.
- `claim` нь global read+assign болон Page read+assign шаарддаг; read-only хүн blocking lease авч чадахгүй. Same-owner valid claim, unchanged assignment, resolved-row retry нь version/state guard-тай, workload-ийг давтан нэмэх/хасахгүй.
- Actual source-д орсон **reassign guard**: already-assigned мөрийн баг/ажилтныг `assign` гэж өөрчилж болохгүй; explicit `transfer` + `social_inbox.reassign` шаарддаг. `assign` нь unassigned ажлыг онооно. Page assign/read prerequisite, target eligibility, expected assignment version, existing lease, deterministic agent-row locks, permission/eligibility recheck болон audit үйлчилнэ.

Backup membership нь тусдаа “идэвхжүүлэх” approval/status биш: explicit row байхгүй active linked backup member-д Page grant шууд үүсдэг baseline хэвээр. Primary online боловч conversation workload “дүүрсэн” гэдэг threshold/config байхгүй; Page capacity-г тийм утгаар хэрэглэхгүй. Нэг Page-ийн team member нь өөр team-д assigned context-ийг Page-level read grant-аар харж болно. **Strict own-team/own-assignment inbox isolation хэрэгжүүлээгүй.** Хэрэв тийм бизнесийн бодлого хэрэгтэй бол тусдаа row-level assignment/team access contract болон migration/test шаардлагатай.

Authenticated Supabase RPC contract:

| RPC | Parameters | Result |
| --- | --- | --- |
| `list_social_page_registry` | байхгүй | Safe Page JSON array |
| `can_access_social_page` | `target_page` ERP UUID, `required_action=read/reply/assign` | boolean; global grant/feature flag-ийн орлуулга биш |
| `get_social_page_context` | `target_page` ERP UUID, `required_action` | Safe Page JSON; denied үед 42501 |
| `smart_assign_social_conversation` | `target_page`, `target_external_id` | Existing эсвэл newly routed `social_conversation_assignments` row |
| `update_social_conversation` | `target_assignment` ERP assignment UUID, `expected_version`, `target_action=claim/assign/transfer/resolve`, optional `target_team`, `target_assignee` | Versioned assignment row; stale 40001, locked 55P03 |
| `claim_social_conversation` | `target_assignment`, `expected_version` | Ижил claim guard-тай compatibility wrapper |

Messenger assignment external reference нь bot context UUID; comment-д `comment:<bot context UUID>` prefix хэрэглэж хоёр channel-ийн ижил ID-г холихгүй. Raw assignment DML ашиглахгүй. User JWT-тай `client.rpc(name, params)` дуудна; RPC-д browser-ийн organization/actor override параметр байхгүй. Page/team/access CRUD-ийн existing Phase 4 signature-уудыг хадгалж, бодит local RLS-тэй тестэлсэн.

## 7. Frontend-ийн өөрчлөлт

Explicit Page сонголтгүй inbox request/send хийхгүй. Page/resource солиход өмнөх asynchronous response, context, reply, cursor-ийг хэрэглэхгүй. Response meta Page сонголттой зөрвөл deny. Comments, paginated history, reply polling, versioned edit/approve/send, structured error болон uncertain outcome-г UI илэрхийлнэ.

Assignment UI нь existing authoritative SQL CRUD/`update_social_conversation` RPC-г ашиглана; bot `assignedTo` metadata-гаар багийн эрх үүсгэхгүй. Presence opt-in online heartbeat нь 60 секунд тутам шинэчлэгдэж, page lifecycle дээр зогсоно; offline/away/leave сонголтыг хадгална. `socialMock=1` local UI fixture нь explicit mock label/stateful state machine-тай; энэ нь normal Edge live send биш. Mock queue→sent, rules-v1, grounded ERP lookup-ийг LLM эсвэл real Messenger delivery гэж нэрлэхгүй.

UI-ийн **Smart assign** нь explicit үйлдэл; detail/read нээхэд далдаар ажиллуулахгүй. Гар assign/transfer нь existing assignment байгаа эсэхэд тохирсон explicit RPC action хэрэглэж, Page-ийн primary болон **бүх backup team ID**-д хязгаарласан сонголт өгнө; санамсаргүй өөр Page-ийн баг сонгохгүй. Page-workspace projection нэг backup мөрийн `.find()`-ээр бус бүх backup link-ийг хадгална. Browser-only mock нь selected Page-ийн active mapped team/member эсвэл unassigned fixture ашиглана; hardcoded өөр Page-ийн баг руу fallback хийхгүй. Unmapped Page B нь Page A-ийн баг/ажилтанд оноогдохгүйг explicit `socialMock=1` regression-ээр баталсан.

**Зөвхөн Edge `assistant` action** нь org-scoped active products/stock permissions-тай баталгаатай ERP facts хэрэглэнэ: missing price/stock = unknown/null; бодит 0-г хадгална. Inventory read grant байхгүй бол stock query хийхгүй; байхгүй balance-г 0 болгон зохиохгүй. Existing frontend `service.searchCatalog` нь тусдаа хуучин зам бөгөөд энэ өөрчлөлтөөр шинэчлээгүй; Edge-ийн null/unknown handling бүх frontend catalog path-д хэрэгжсэн гэж үзэхгүй. Гадаад LLM, chat data export, model/key тохируулаагүй.

## 8. Өөрчлөгдсөн файл ба шалгалт

Өөрчлөлтийн хүрээ: **11 эх код/config/test файл + энэ тайлан = 12 файл**. Final apply-д тулгах файлууд:

- `supabase/migrations/20261126111223_social_contract_alignment.sql` — policy/projection/atomic routing hardening.
- `supabase/functions/social-integration/index.ts`, `supabase/functions/_shared/social-contract.mjs` — pinned entry ба testable Edge core.
- `dist/social.js`, `dist/social-service.js` — Page-bound inbox/manual workflow, safe error/idempotency, authoritative assignment, presence.
- `test/social-adapter.test.mjs`, `test/social-ui-contract.test.mjs`, `test/social-contract.test.mjs`, `test/social-rls.local.test.mjs` — behavioral/contract/actual local SQL coverage.
- `scripts/prepare-local-social.mjs` — local preparation-д шинэ hardening migration-ийг оруулна; `package.json`-д `test:rls:local` command.
- `MOMO_SOCIAL_CONTRACT_ALIGNMENT.md` — энэ handoff тайлан.

Шалгалтын нотолгоог хооронд нь орлуулахгүй:

| Шалгалт | Бодит хүрээ | Батлахгүй зүйл |
| --- | --- | --- |
| Node Edge tests | Injected auth/DB/Meta dependencies, stateful хоёр Page mock, auth deny, version/idempotency, stale/unknown send, error/deadline/8 MiB bound | Deployed Deno, hosted JWT transport, remote RLS, Meta send |
| UI behavioral tests | Browser service/session fake transport/storage; Page-switch race, queued poll, storage failure, stable retry, RPC payload | Бодит browser login/hosted Edge эсвэл real chatbot |
| Isolated local PostgreSQL tests | PostgreSQL **17.12** шинэ temporary cluster, actual migrations/RLS/RPC, synthetic auth roles/JWT claim GUC, cross-org/deny, backup, concurrent assignment/counters/version/claim/capacity, knowledge/saved-reply SELECT boundary | Supabase Auth-issued JWT/gateway, production schema/data, hosted PostgREST, applied remote migration |
| Legacy opt-in DB suite | Зөвхөн explicit local fixture орчинд тусдаа ажиллуулна; default skip-ийг pass гэж тооцохгүй | Existing/production DB дээр ажиллуулах зөвшөөрөл биш |

Local PostgreSQL harness нь `initdb`-ээр шинэ сан үүсгэж, loopback random port, fixture password/roles/data ашигладаг. `DATABASE_URL`, Supabase service secret эсвэл existing cluster ашиглахгүй; эцэст нь process/temporary cluster-ээ цэвэрлэнэ. Дээрх actual-source run-д parent + 25 SQL subtest pass болсон; temporary test clusters үлдээгүйг root шалгасан. Remote SQL ажиллуулаагүй. Энэ local SQL нотолгоог hosted Auth/JWT/Edge/remote RLS-ийн баталгаа болгож болохгүй.

Version-ийн хязгаар: бодит isolated run нь **PostgreSQL 17.12**, харин project-ийн Supabase config-д заасан database major нь **15**. Target major 15 дээр энэ final migration/RLS suite-г ажиллуулаагүй; major-specific нийцлийг staging release gate дээр шалгана. PG17 pass-ийг PG15 verification гэж нэрлэхгүй.

Давтах командууд — production `.env` хуулж ачаалахгүй:

```powershell
node --test test/social-adapter.test.mjs test/social-ui-contract.test.mjs test/social-contract.test.mjs
# Dedicated local PostgreSQL binaries-ийн bin замыг тусад нь өгсний дараа:
$env:MOMO_LOCAL_PG_BIN='<local PostgreSQL bin directory>'
$env:MOMO_LOCAL_PG_TMP='<existing short temporary directory>'
$env:MOMO_ERP_TEST_ROOT=$null
$env:MOMO_ALIGNMENT_SQL=$null
npm run test:rls:local
# Ижил local env-тай нийт suite:
npm test
```

`MOMO_LOCAL_PG_BIN` нь зориулалтын local binaries; harness шинэ temporary cluster үүсгэнэ. Одоогийн `LOCAL_DB_URL` opt-in хуучин suite-г production/existing өгөгдөл рүү зааж ажиллуулахгүй. Missing binary/skip, syntax check, mock pass, actual SQL pass болон deployed E2E-г тусдаа тэмдэглэнэ.

## 9. Sandbox rollout, rollback ба үлдсэн gate

Одоогийн ажил зөвхөн local source preparation. Нэвтрүүлэх дараалал:

1. Энэ handoff-ийн local source/test verification дууссан. Sandbox нэвтрүүлэхээс өмнө migration/Edge/UI diff, зөв database major, package scripts болон энэ тайлангийн credential mapping-ийг тусдаа review хийнэ.
2. Шинэ isolated staging Supabase/бот runtime/сан сонгоно. Existing production env, token, customer history/backup-г fixture болгохгүй. Local SQL bootstrap Auth schema нь hosted Supabase-ийн баталгааг орлохгүй.
3. Staging migration болон deployed Edge-ийн JWT/CORS/RLS transport-ийг зориулалтын synthetic users-аар negative тест хийнэ. SDK/env scopes болон Page registry allowlist/pins-ийг шалгана. Шинэ default feature flags false; migration өөрөө асаахгүй.
4. Эхлээд read-only Page/runtime capabilities, дараа нь mock manual draft/edit/approve. `SOCIAL_ADAPTER_MODE=live` нь реальный provider path тул зөвшөөрөлгүй асаахгүй. ERP болон legacy bot хоёр зэрэг send owner болохгүй.
5. Зөвшөөрсөн staging Page-ийн шинэ normal incoming-ийг тусад нь баталсны дараа л яг Page/текст/тоо нь зөвшөөрөгдсөн нэг manual reply тест хийнэ. Synthetic webhook, health, capability, queued, mock sent нь real E2E pass биш. Хороолол production-ийн real intake/reply асуудал **unverified** хэвээр.

Rollback хийх бол эхлээд org send/draft/control feature gate болон шинэ request-үүдийг зөвшөөрсөн ажиллагаагаар зогсоож, in-flight/queued outcome-г шалгана. Unknown/sent ажлыг pending болгож blind replay хийхгүй. Old Edge/UI руу шууд буцаах нь Page authorization/idempotency хамгаалалтыг алдаж болох тул reviewed rollback version хэрэглэнэ. Migration нь RPC/RLS/grant өөрчилсөн; table drop/сан устгалын rollback хэрэглэхгүй. Шинэ Page санг main Page-ийн түүхтэй холихгүй. Secret rotation, callback/routing/deploy эсвэл remote migration rollback нь тусдаа эрхтэй ажиллагаа; энэ тайлан автоматаар гүйцэтгэх зөвшөөрөл биш.

Үлдсэн release gates: configured PostgreSQL 15 дээрх шалгалт; hosted Supabase JWT/PostgREST/Deno transport; staging migration applied эсэх; authorized Page бүрийн live runtime identity/scopes болон Meta incoming/reply. Бизнесийн нэмэлт шийдвэрүүд: strict own-team policy шаардлагатай эсэх, backup activation policy/workload limits, тусдаа approver role. Future v2-д delegated worker authorization болон enqueue-ийн дараах revocation хэрэгтэй. **Нэг runtime multi-Page, LLM, remote deploy эсвэл real Messenger E2E-г энэ локал тохируулгаар бүрэн болсон гэж тайлагнахгүй.**

## 10. Read-only source баталгаа

Ботын дараах таван баримтын SHA-256 нь ажлын эхэн болон төгсгөлд ижил байсан. Энэ ажил ботын repository-д бичээгүй; commit, push, production deploy болон remote migration хийгээгүй.

| Баримт | SHA-256 |
| --- | --- |
| `MOMO_INTEGRATION_READINESS.md` | `7FD1B37BFDF72CB6CF70CC877C0E6992E470C40873A4C5C3005EAA1FFFF8D61C` |
| `docs/MOMO_MULTI_PAGE_CONTRACT.md` | `0F23CA25E4304A4F7C121B9FB9C06BE318980E16020CE9FA53578444E4AC91CF` |
| `docs/MOMO_MESSENGER_E2E.md` | `23DEDFC30B0E08868C45E0A3B974EAC1B35CE768EACA148CA94DA219A6A16236` |
| `docs/MOMO_SANDBOX_DEPLOYMENT.md` | `25B359DCB9692E1EA3F878135372F746AABF846F4D33EB6F1A9D909DF1E9B3FC` |
| `MOMO_ERP_INTEGRATION.md` | `71BD1CB5090F95DBF15CE57E864DB83378CF8EE7744B9183C42B9ADF7FA6B228` |
