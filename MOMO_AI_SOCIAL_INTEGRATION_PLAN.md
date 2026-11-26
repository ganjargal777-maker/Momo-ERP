# MOMO AI ба Social Inbox интеграцын төлөвлөгөө

## 1. Баримт бичгийн зорилго

Энэ баримт бичиг нь MomoERP-д ажилтны `MOMO AI` туслах болон Facebook Messenger/сэтгэгдлийг нэгтгэсэн `Сошиал харилцаа` модулийг одоогийн ERP-ийн ажиллагааг эвдэхгүйгээр нэвтрүүлэх техникийн төлөвлөгөө юм.

Одоогоор Facebook ботын бодит endpoint, webhook payload, authentication contract баталгаажаагүй. Иймээс энэ үе шатанд:

- баталгаажаагүй Facebook API endpoint зохиохгүй;
- Meta/Facebook access token болон AI API key-г frontend-д оруулахгүй;
- production webhook болон автомат хариулт идэвхжүүлэхгүй;
- өөр Codex session-оос ирэх `MOMO_ERP_INTEGRATION.md`-г бодит интеграцын contract-ын үндсэн эх сурвалж болгоно.

## 2. Одоогийн системийн аудит

### 2.1 Frontend ба deployment

- Frontend нь static Vanilla HTML/CSS/JavaScript бүтэцтэй.
- UI-ийн үндсэн файлууд `dist/index.html`, `dist/app.js`, `dist/auth.js`, `dist/styles.css` дотор байна.
- Vercel нь static frontend-ийг түгээж, browser нь Supabase publishable key ашиглан Supabase client-тэй холбогддог.
- `MOMO AI` болон `Facebook Inbox`-ийн UI shell хөгжүүлэлтийн branch дээр бэлтгэгдсэн. Эдгээрийг бодит интеграцын contract батлагдтал mock/coming-soon төлөвт байлгана.

### 2.2 Authentication ба authorization

- Supabase Auth email/password session ашигладаг.
- `public.profiles` нь Auth UUID-г хэрэглэгчийн үндсэн ID болгон ашигладаг.
- Хандах эрхийн холбоос: `profiles -> user_roles -> roles -> role_permissions -> permissions`.
- Frontend `dist/auth.js` нь authenticated profile болон role permission-уудыг нэг эх сурвалжаас ачаалдаг.
- Одоогийн permission catalog-д `dashboard`, `users`, `settings`, `facebook_pages`, `products`, `inventory`, `leads`, `calls`, `orders`, `deliveries`, `reports`, `finance` модулиуд байна.
- Menu нуух нь зөвхөн UX хамгаалалт; өгөгдөл болон write үйлдлийг RLS, RPC эсвэл Edge Function дээр дахин шалгах ёстой.

### 2.3 Одоогийн өгөгдлийн холбоос

- `organizations` нь tenant тусгаарлалтын үндэс.
- `profiles`, `roles`, `branches`, `warehouses`, `facebook_pages`, `products`, `leads`, `orders`, `deliveries` нь organization-той холбоотой.
- `facebook_pages` хүснэгт нь page-ийн дотоод ID, нэр, external page ID, active төлөвийг хадгалах суурьтай.
- `leads` болон `orders` нь `facebook_page_id` холбоостой тул Social Inbox-оос lead/order үүсгэх үед одоогийн domain model-ийг дахин ашиглаж болно.
- `invite-user` Edge Function нь JWT-тай caller-ийг шалгаж, server-side secret ашигладаг одоогийн аюулгүй server action-ийн жишиг болно.

## 3. Хамрах хүрээ ба хамаарал

### Энэ төлөвлөгөөнд багтана

- MOMO AI ажилтны туслахын UI, permission, grounding ба audit архитектур;
- Social Inbox-ийн гурван хэсэгтэй UI ба canonical data model;
- Facebook бот болон ERP-ийн хоорондох тусгаарлагдсан adapter/service;
- human-in-the-loop хариултын урсгал;
- feature flag, RLS, retry, idempotency, audit, тест ба rollout.

### Энэ үе шатанд багтахгүй

- баталгаажаагүй Facebook endpoint руу production request илгээх;
- Facebook token эсвэл AI secret-г browser-д өгөх;
- AI-аар автоматаар хариулт илгээх;
- одоогийн бараа, агуулах, захиалга, хүргэлт, санхүүгийн өгөгдлийг өөрчлөх;
- contract батлагдахаас өмнө database migration deploy хийх.

## 4. Зорилтот архитектур

```text
MomoERP browser
  | Supabase Auth JWT
  v
ERP server actions / Supabase Edge Functions
  |-- Permission + organization шалгалт
  |-- MOMO AI orchestrator
  |-- Social Inbox application service
  |-- Audit writer
  v
Integration adapter (тусдаа boundary)
  | service-to-service authentication
  v
Facebook bot API / webhook service

Supabase Postgres
  |-- canonical social data
  |-- AI thread/suggestion data
  |-- outbox/inbox idempotency
  |-- audit log
  `-- RLS tenant + permission enforcement
```

Үндсэн зарчим:

1. Browser Facebook эсвэл AI provider-тэй шууд холбогдохгүй.
2. Facebook-specific payload-ыг ERP domain model дотор тараахгүй; adapter canonical model руу хөрвүүлнэ.
3. Write бүр authenticated employee, organization, permission, idempotency key-тэй байна.
4. AI анхдагчаар зөвхөн draft санал болгоно. Илгээх ажиллагааг эрхтэй ажилтан баталгаажуулна.
5. External service түр доголдсон үед ERP-ийн үндсэн модуль хэвийн ажиллана.

## 5. Integration adapter-ийн contract

`MOMO_ERP_INTEGRATION.md` ирсний дараа adapter-ийн бодит contract-ыг баталгаажуулна. Тэр хүртэл доорх нь ERP-ийн дотоод шаардлага бөгөөд Facebook ботын бодит API гэж үзэхгүй.

### 5.1 Adapter-ийн үүрэг

- webhook/event signature шалгах;
- external page, conversation, message ID-г canonical ID-тай map хийх;
- inbound event-ийг idempotent байдлаар бүртгэх;
- reply command-ыг bot service рүү дамжуулах;
- retryable болон permanent error-ыг ялгах;
- rate-limit, cursor pagination, delivery receipt-ийг нэг хэлбэрт оруулах;
- raw provider payload-ын хадгалалтыг хамгийн бага хэмжээнд барих.

### 5.2 Contract-д заавал баталгаажуулах зүйлс

- sandbox ба production base URL;
- service-to-service authentication арга;
- webhook verification болон signature algorithm;
- page/channel mapping;
- event type ба payload schema;
- message, comment, conversation, customer-ийн тогтвортой external ID;
- timestamp/timezone ба ordering guarantee;
- pagination/cursor;
- send reply, edit/unsend боломж ба хязгаар;
- attachment metadata ба download security;
- rate limit, retry-after, timeout;
- error schema;
- idempotency key дэмжлэг;
- delivery/read receipt;
- webhook replay ба dead-letter ажиллагаа;
- retention/delete/privacy шаардлага;
- бодит sample payload болон contract test fixture.

### 5.3 Canonical event envelope-ийн дотоод санал

Энэ нь external API contract биш. Adapter-аас ERP application service рүү дамжуулах дотоод загвар:

```json
{
  "event_id": "provider-stable-id",
  "event_type": "message.received",
  "occurred_at": "ISO-8601",
  "channel": "facebook_messenger",
  "external_page_id": "...",
  "external_conversation_id": "...",
  "external_message_id": "...",
  "sender": { "external_id": "...", "display_name": "..." },
  "content": { "text": "...", "attachments": [] },
  "schema_version": 1
}
```

## 6. UI бүтэц

### 6.1 MOMO AI — ажилтны туслах

ChatGPT-тэй төстэй боловч ERP permission болон data grounding-д захирагдана.

- Шинэ чат / өмнөх ярианы жагсаалт;
- prompt ба хариултын үндсэн хэсэг;
- бараа, үнэ, үлдэгдэл, хүргэлтийн нөхцөлийн source indicator;
- Facebook comment/Messenger reply draft горим;
- “Найруулж засах”, “Борлуулалтын хариулт”, “FAQ ашиглах” quick action;
- хадгалсан хариултын сан;
- хариулт хуулах, засах, Social Inbox руу draft болгон шилжүүлэх;
- source олдоогүй үед тодорхой “Мэдээлэл олдсонгүй” төлөв;
- loading, timeout, permission denied, provider unavailable төлөв.

AI output дээр хэрэглэсэн structured ERP source-ийн төрөл, ID, шалгасан огноог UI-д харуулж болно. Нууц болон permission-гүй өгөгдлийг prompt context-д оруулахгүй.

### 6.2 Сошиал харилцаа — гурван хэсэгтэй layout

1. **Зүүн хэсэг — жагсаалт**
   - Messenger/сэтгэгдэл filter;
   - page, төлөв, ажилтан, хугацааны filter;
   - хариулаагүй, хуваарилагдсан, шийдвэрлэсэн badge;
   - unread count ба хамгийн сүүлийн message.
2. **Төв хэсэг — харилцаа**
   - message/comment timeline;
   - AI санал болгосон draft;
   - ажилтны засвар;
   - send баталгаажуулалт;
   - assign, resolve/reopen, order create action.
3. **Баруун хэсэг — харилцагч**
   - нэр ба channel identity;
   - өмнөх харилцаа;
   - lead/order history;
   - холбогдсон page;
   - эрхтэй бол захиалга үүсгэх товч.

Responsive үед гурван хэсгийг tabs/drawer хэлбэрээр харуулна. Одоогийн MomoERP layout, sidebar, branding-ийг хадгална.

## 7. Өгөгдлийн загварын санал

Доорх хүснэгтүүд нь contract батлагдсаны дараах migration-ийн санал. Одоогоор үүсгэхгүй.

| Хүснэгт | Зорилго | Гол хамгаалалт |
|---|---|---|
| `feature_flags` | Organization бүрийн module/capability toggle | Admin/settings permission |
| `social_channels` | `facebook_pages`-ийг integration channel/config-тэй холбох | Secret хадгалахгүй; org RLS |
| `social_customers` | Channel identity-г ERP customer/lead-тэй map хийх | PII, org RLS |
| `social_conversations` | Нэгдсэн conversation төлөв, assignment | org + inbox read permission |
| `social_messages` | Inbound/outbound message/comment | immutable provider IDs |
| `social_assignments` | Хэнд, хэзээ хуваарилсны түүх | assign permission |
| `ai_threads` | MOMO AI conversation metadata | owner/profile + org RLS |
| `ai_messages` | Prompt/response, model metadata | prompt PII policy |
| `ai_suggestions` | AI draft, source, confidence, approval status | draft/send permissions |
| `saved_replies` | Organization болон ажилтны бэлэн хариулт | owner/scope RLS |
| `integration_inbox` | Хүлээн авсан event, dedupe, processing state | server-only write |
| `integration_outbox` | Илгээх command, retry, delivery state | server-only write |
| `integration_failures` | Dead-letter ба operator resolution | integration admin only |
| `audit_logs` | AI suggest/edit/approve/send/assign/order action | append-only, scoped read |

Бүх tenant хүснэгт `organization_id`-тай байна. External provider ID дээр organization/channel хамтарсан unique constraint тавина. `event_id` болон client-generated `idempotency_key` нь давхар message, давхар order үүсэхээс хамгаална.

Raw payload хадгалах шаардлагатай бол encrypted/private storage, богино retention, redaction хэрэглэнэ. Access token-ыг эдгээр хүснэгтэд plaintext-аар хадгалахгүй.

## 8. Permission ба RLS загвар

Одоогийн `permissions`, `role_permissions`, `user_roles` системийг өргөтгөнө. Хоёр дахь authorization систем үүсгэхгүй.

Санал болгож буй permission code:

- `ai_assistant.use`
- `ai_assistant.erp_read`
- `ai_suggestions.create`
- `ai_saved_replies.read`
- `ai_saved_replies.manage`
- `social_inbox.read`
- `social_inbox.assign`
- `social_inbox.reply_draft`
- `social_inbox.reply_send`
- `social_inbox.resolve`
- `social_inbox.order_create`
- `social_channels.manage`
- `social_audit.read`

### Enforcement давхарга

1. **Frontend:** зөвшөөрөлгүй menu/action харагдахгүй.
2. **RLS:** organization match болон permission predicate-гүй SELECT/UPDATE/INSERT/DЕLETE зөвшөөрөхгүй.
3. **RPC/Edge Function:** send, assign, resolve, order create, AI ERP retrieval бүр дээр `auth.uid()`, active profile, organization, permission-ийг server-side шалгана.
4. **Adapter:** зөвхөн server identity-аас command хүлээн авна; browser JWT-г Facebook bot руу дамжуулахгүй.

Admin бүх шаардлагатай permission-тэй байна. Manager/Operator-д role-оор зөвхөн шаардлагатай capability-г сонгон олгоно. “Menu харагдах” нь send/order permission гэсэн үг биш.

## 9. MOMO AI grounding ба hallucination хамгаалалт

- AI нь үнэ, үлдэгдэл, хүргэлтийн нөхцөлийг ерөнхий prompt memory-оос гаргахгүй.
- Product/stock/delivery мэдээллийг permission-aware structured tool/RPC-ээр тухайн үед уншина.
- Tool query нь хэрэглэгчийн organization ба permitted warehouse/page хүрээнд ажиллана.
- Хариулт бүр source record ID, retrieved timestamp, data version/updated_at metadata-тай холбоотой байна.
- Мэдээлэл олдохгүй, зөрүүтэй, хуучирсан бол AI “баталгаатай мэдээлэл алга” гэж хэлж, зохиохгүй.
- Customer text доторх prompt injection-ийг system instruction гэж үзэхгүй.
- Write action, order creation, reply send-ийг AI өөрөө шууд хийхгүй; тусдаа эрхтэй employee confirmation шаардана.
- Sensitive fields-ийг model provider руу явуулахын өмнө allowlist/redaction хийнэ.

## 10. Feature flag төлөвлөгөө

Feature flag нь organization түвшинд, server-side enforcement-тэй байна.

- `momo_ai_ui`
- `momo_ai_grounded_search`
- `social_inbox_ui`
- `social_inbox_read`
- `social_inbox_ai_draft`
- `social_inbox_reply_send`
- `social_inbox_order_create`

Анхны production default бүгд `false`. Rollout дараалал: internal admin -> сонгосон operator -> organization-wide. `AI auto send` capability-г эхний хувилбарт огт үүсгэхгүй. Flag унтарсан үед route/action server талаас мөн хаалттай байна.

## 11. Өгөгдлийн урсгал

### 11.1 Inbound message/comment

1. Facebook bot webhook event хүлээн авна.
2. Bot signature шалгаад ERP adapter endpoint руу service authentication-тай дамжуулна.
3. Adapter schema/version шалгаж `integration_inbox`-д event ID-аар idempotent insert хийнэ.
4. Worker canonical conversation/message-г upsert хийнэ.
5. Realtime эсвэл controlled polling UI-г шинэчилнэ.
6. Audit log-д receive/process outcome бүртгэнэ.

### 11.2 AI draft -> ажилтан -> send

1. Эрхтэй ажилтан conversation сонгоно.
2. Server зөвшөөрөгдсөн conversation context, product FAQ болон ERP source-г цуглуулна.
3. AI suggestion `draft` төлөвтэй хадгалагдана.
4. Ажилтан засварлаж approve хийнэ; original AI text болон employee edit тусдаа audit-тай.
5. `reply_send` permission дахин шалгаад outbox command үүсгэнэ.
6. Adapter bot API руу idempotency key-тай илгээнэ.
7. Provider acceptance/delivery state-г message болон audit дээр шинэчилнэ.

### 11.3 MOMO AI ERP асуулт

1. Employee JWT ба permission шалгана.
2. Intent-ээс зөвхөн allowlisted read tool сонгоно.
3. RLS/RPC permitted record буцаана.
4. AI source-д тулгуурлан хариулж, source metadata хадгална.
5. Үнэ/үлдэгдэл олдоогүй бол хариулт зохиохгүй.

### 11.4 Social Inbox-оос захиалга үүсгэх

1. `social_inbox.order_create` болон одоогийн `orders.create` хоёрыг шалгана.
2. Customer, page, selected product, quantity, address-ийг employee баталгаажуулна.
3. Existing order RPC/domain logic-г дахин ашиглана.
4. `conversation_id + approved action id` idempotency key хэрэглэнэ.
5. Order ID-г conversation-т холбоод audit бүртгэнэ.

## 12. Security ба operational шаардлага

- Facebook access token, webhook secret, AI provider key-г Supabase Edge Function secrets эсвэл тусдаа backend secret store-д хадгална.
- VITE/runtime config/browser bundle-д secret оруулахгүй.
- Service-to-service key rotation, least privilege, expiry төлөвлөгөөтэй байна.
- Webhook signature ба timestamp replay window шалгана.
- Outbound command дээр rate limit, timeout, retry with exponential backoff хэрэглэнэ.
- Permanent failure dead-letter-д орж, authorized admin-аас retry/resolve хийнэ.
- UI-д provider text render хийхдээ HTML escape/sanitize хийнэ.
- Attachment URL-г шууд итгэхгүй; allowlist, content-type, size, expiry шалгана.
- Audit log нь append-only: actor, organization, action, target, before/after hash, timestamp, correlation ID хадгална.
- PII retention, export/delete дүрмийг Facebook болон байгууллагын бодлоготой уялдуулна.
- Logs-д token, full prompt, customer sensitive data-г хэвлэхгүй.

## 13. API/server action-ын дотоод шаардлага

Contract батлагдсаны дараа нэршлийг эцэслэнэ. ERP талаас дараах capability хэрэгтэй:

- conversation list/detail унших;
- message history унших;
- assign/unassign;
- resolve/reopen;
- AI draft үүсгэх;
- draft хадгалах/засах;
- approved reply send queue-д оруулах;
- send status унших;
- conversation-оос order үүсгэх;
- saved reply CRUD;
- audit log унших;
- webhook/event ingest ба replay.

Browser нь privileged database table руу шууд write хийхийн оронд permission-aware RPC/Edge Function ашиглана. Read query-г RLS бүрэн хамгаалсан тохиолдолд Supabase client-аар хийж болно.

## 14. Тестийн төлөвлөгөө

### Unit тест

- provider payload -> canonical event mapping;
- permission predicate;
- feature flag evaluation;
- AI grounding/source validation;
- idempotency ба retry classification;
- PII redaction.

### Database/RLS тест

- өөр organization-ийн conversation/message-г SELECT хийх боломжгүй;
- permission-гүй хэрэглэгч assign/send/resolve/order RPC дуудахад deny;
- inactive profile бүх action дээр deny;
- service-only inbox/outbox table-д browser insert deny;
- duplicate external event нэг л message үүсгэнэ;
- duplicate order command нэг л order үүсгэнэ.

### Contract тест

- `MOMO_ERP_INTEGRATION.md`-ийн fixture бүр schema-д нийцэх;
- webhook signature valid/invalid/replay;
- authentication expiry/rotation;
- pagination, rate limit, retry-after;
- bot 4xx/5xx/timeout response mapping;
- message send acceptance ба delivery callback.

### E2E тест

- Admin, Manager, Operator permission matrix;
- menu hide болон direct navigation deny;
- inbound comment/Messenger event UI-д нэг удаа харагдах;
- AI draft -> edit -> approve -> send;
- error үед draft алдагдахгүй, success гэж буруу мэдээлэхгүй;
- assignment ба resolve/reopen;
- conversation-оос order үүсэх, duplicate click хамгаалалт;
- audit trail бүрэн;
- mobile/responsive layout.

### Regression тест

- Admin login/profile;
- invitation flow;
- role/permission management;
- products, inventory, leads, orders, deliveries;
- existing localStorage fallback/business data;
- production build ба JS syntax;
- feature flag off үед одоогийн ERP-т ямар ч өөрчлөлтгүй байх.

### Load/operation тест

- event burst ба ordering;
- slow provider ба retry queue;
- Realtime reconnect;
- dead-letter replay;
- observability: correlation ID-аар webhook -> DB -> send status мөрдөх.

## 15. Хэрэгжүүлэх үе шат

### Үе 0 — Contract баталгаажуулалт

- `MOMO_ERP_INTEGRATION.md` хүлээн авах;
- sample payload, sandbox, authentication, signature-г шалгах;
- threat model ба data retention батлах;
- contract test fixture freeze хийх.

### Үе 1 — Суурь schema, permission, feature flag

- migration-ийг development project дээр бэлтгэх;
- permission/RLS/RPC deny tests;
- audit, inbox/outbox, idempotency суурь;
- production migration-аас өмнө backup ба зөвшөөрөл.

### Үе 2 — Read-only Social Inbox

- adapter sandbox ingest;
- жагсаалт/detail/customer history;
- send болон order action идэвхгүй;
- internal admin pilot.

### Үе 3 — MOMO AI ба AI draft

- grounded ERP read tools;
- saved replies;
- comment/Messenger draft;
- employee edit ба audit;
- send feature flag унтраалттай.

### Үе 4 — Human-approved reply send

- server-side permission;
- outbox/retry/delivery receipt;
- selected operators pilot;
- monitoring ба rollback drill.

### Үе 5 — Social order creation

- existing order domain/RPC reuse;
- explicit confirmation;
- duplicate protection;
- audit ба reconciliation.

### Үе 6 — Хяналттай өргөтгөл

- page/role rollout;
- SLA dashboards;
- FAQ quality loop;
- автомат илгээлтийг тусдаа security/product approval-гүй нээхгүй.

## 16. Rollout ба rollback

- Schema additive байна; existing table/column устгахгүй.
- Шинэ module бүхэлдээ feature flag-аар унтардаг байна.
- Adapter доголдвол outbox pause хийж, ERP-ийн бусад хэсэг хэвийн үлдэнэ.
- Read-only mode руу нэг flag-аар буцаана.
- Send rollback нь queued unsent command-ыг цуцалж, accepted provider message-г давхар илгээхгүй.
- Migration бүр forward-fix/rollback note, backup verification, dry-run тайлантай байна.

## 17. Facebook ботын session-оос шаардлагатай материал

Бодит холболт эхлэхийн өмнө дор хаяж дараах зүйлс шаардлагатай:

1. `MOMO_ERP_INTEGRATION.md`;
2. sandbox base URL ба test credential олгох арга;
3. webhook verification/signature заавар;
4. page/channel mapping;
5. event болон error sample payload;
6. send reply command ба idempotency behavior;
7. rate limit/retry дүрэм;
8. delivery/read receipt contract;
9. data retention/delete requirement;
10. provider-side correlation/log lookup арга.

Эдгээр нь байхгүй үед production endpoint, token, webhook migration эсвэл send functionality хийхгүй.

## 18. Definition of Done

Интеграц бэлэн гэж үзэхийн тулд:

- contract test бүгд pass;
- RLS/RPC negative permission test pass;
- tenant data leakage байхгүй;
- secrets frontend bundle болон Git-д байхгүй;
- AI үнэ/үлдэгдэл/хүргэлтийн мэдээллийг source-гүй зохиохгүй;
- employee approval-гүй reply send/order create хийхгүй;
- inbound event, AI draft, edit, approval, send, assignment, order audit бүрэн;
- duplicate webhook/send/order хамгаалалттай;
- feature flag off үед одоогийн ERP regression pass;
- monitoring, dead-letter, retry, rollback ажиллагааг туршсан;
- production rollout нь сонгосон page ба role-оос үе шаттай эхэлсэн байна.

## 19. Multi-Page ба багийн удирдлага

Одоогийн Facebook bot runtime нь `META_PAGE_ID` болон нэг `DATA_DIR`-д хатуу холбогдсон. Иймээс нэг runtime-ийг олон Page руу query-гаар шилжүүлэхгүй. Олон Page-ийн эхний аюулгүй загвар нь Page бүрт тусдаа bot runtime/credential, ERP талд нэгдсэн registry ба Inbox байна. Bot contract multi-page runtime дэмжих хүртэл энэ тусгаарлалтыг хадгална.

### Өгөгдлийн загвар

- `facebook_pages`: external Page ID, credential reference (secret биш), connection status, Page-specific settings;
- `social_teams`: баг, ахлагч, идэвхтэй төлөв, optional Page capacity;
- `social_team_members`: ажилтан–багийн many-to-many холбоос;
- `social_page_teams`: Page бүрийн нэг primary, олон backup team;
- `social_page_user_access`: Page-level read/reply/assign capability;
- `social_agent_presence`: online/offline/away/leave ба active workload;
- `social_conversation_assignments`: external conversation, Page, team, assignee, SLA timestamp, order conversion;
- `social_knowledge_entries`: Page-specific баталгаажсан хариулт.

Хатуу 4–8 Page limit database constraint болохгүй. `page_capacity` нь organization/bag-ын тохируулга; provider/API quota-г тусдаа operational limit болгон харуулна.

### Routing

1. External Page ID-аар ERP `facebook_pages` record олно.
2. Primary team идэвхтэй бол сонгоно; байхгүй/ачаалал дүүрсэн үед priority-тай backup team ашиглана.
3. `online` ажилтнуудаас Page access, team membership, хамгийн бага `active_conversations`-ээр сонгоно.
4. Unique `(page_id, external_conversation_id)` нь давхар assignment/order-оос хамгаална.
5. Reassign хийхэд ахлагч эсвэл `social_inbox.reassign` permission шаардана.
6. First-response SLA-г `first_received_at`, `first_replied_at`, `last_activity_at`-аар тооцно.

### UI

Social Inbox жагсаалтын дээр Page, баг, ажилтан, төлөвийн filter байрлана. Page management дэлгэцээс Page нэмэх/идэвхгүй болгох, primary/backup team сонгох, connection status харах боломжтой байна. Team management дэлгэц багийн ахлагч, гишүүд, capacity, assigned Page-үүдийг харуулна. Secret credential-г UI/DB-д хадгалахгүй; зөвхөн server secret store дахь reference харуулна.

### Analytics

Page/team/employee хэмжээсээр conversation count, first-response time, unanswered/unresolved count, order conversion, баталгаажсан борлуулалтын дүн, AI-assisted ба human-only reply ratio гаргана. Analytics нь bot event ба ERP order ID холбоос дээр тулгуурлаж, provider payload-аас борлуулалтын дүн таахгүй.

### Multi-page тест

- өөр Page-ийн эрхгүй ажилтан list/detail/reply/assign хийхэд RLS deny;
- нэг Page-д зөвхөн нэг primary team;
- backup routing ба offline/leave exclusion;
- concurrent assignment үед нэг assignee/нэг conversation record;
- ижил external conversation ID өөр Page дээр тусдаа байх;
- Page-specific knowledge/catalog setting холилдохгүй;
- token/reference log болон frontend bundle-д гарахгүй;
- нэг bot runtime/Page доголдсон үед бусад Page болон ERP үндсэн модуль хэвийн байх.

---

Энэ төлөвлөгөө нь баталгаажаагүй Facebook API-г production-д таамгаар холбохгүйгээр ERP талын boundary, security, UI, data model, testing ба rollout-ыг урьдчилан тодорхойлж байна. Дараагийн техникийн gate нь `MOMO_ERP_INTEGRATION.md` болон sandbox contract юм.
