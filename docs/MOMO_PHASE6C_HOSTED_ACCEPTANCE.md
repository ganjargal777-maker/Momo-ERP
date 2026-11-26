# MOMO ERP–Messenger — Phase 6C hosted acceptance plan

Prepared 2026-11-26, Asia/Ulaanbaatar. **Plan and local contract code only. No Phase 6C deployment, hosted database mutation, real Meta test or paid resource was performed by this work.** Phase 6A and the bot repository remain unchanged.

## Entry gate: ERP before Messenger

Phase 6C starts only after the ERP release evidence covers login/password recovery, authoritative core CRUD, RBAC/RLS, real-data dashboard/finance, demo exclusion, browser E2E, local database concurrency/rollback and a reviewed deploy backup/rollback plan. Local tests cannot establish that the production domain or hosted schema has been updated. Record release commit, migration inventory, environment identity and each PASS/FAIL/SKIPPED outcome before promotion.

The production Supabase project is `lxjkkqypiwnnrjmnpick`; Phase 6C acceptance must use an explicitly approved isolated sandbox, synthetic users/data and a dedicated test Page. Do not copy production Auth users, customers, orders, financial entries, tokens or database contents into it. An unavailable free sandbox is a blocker, not permission to create a paid project or run mutations against production.

## What is implemented now

- Existing ERP gateway: `supabase/functions/_shared/social-contract.mjs`, mounted by `social-integration/index.ts`; authenticates the browser session and resolves registry Page context before the bot's v1 API.
- New pure server-side/offline review mapper: `supabase/functions/_shared/messenger-order-draft.mjs`, export `prepareMessengerOrderReview(payload, context)`. It opens no network/database, reads no environment, creates no order/customer/payment and sends no Messenger reply. It is **not a new deployed Edge Function or HTTP endpoint**.
- New `test/messenger-order-contract.test.mjs`: validates bot dry-run v1 versus the current ERP core RPC model, including actual local bot mapper interoperability where its source is available.
- Current bot remains one Page per runtime/Store. Three Page registry entries can target three isolated v1 runtimes; shared v2 dispatcher remains proposed work.

## Phase 6B dry-run versus core order contract

The bot's `POST /erp/v1/ingest/dry-run` returns a wrapper whose `payload` has `schemaVersion=momo.erp.messenger-dry-run.v1`, `mode=dry-run`, `source=facebook_messenger_synthetic`, numeric-string `page.id`, customer/message references, extracted order fields, advisory validation and zero side effects. The mapper consumes **that inner payload**, not the HTTP wrapper.

| Bot field | ERP meaning / required action |
| --- | --- |
| `page.id` | Meta numeric external ID; resolve active same-org `facebook_pages.id` UUID through authorized registry; never cast Meta ID to ERP UUID |
| `customer.externalId` | Page-scoped PSID; not an ERP customer/lead UUID |
| `customer.displayName`, order `phone/address` | Unverified message-derived contact snapshot for employee review; no automatic account/person merge |
| `order.productReference` | Name/code/link text; not a verified SKU, product UUID, price or stock assertion |
| `order.quantity` | Positive integer candidate; actual stock availability must be checked atomically by the order RPC |
| `validation.complete` | Bot extraction advisory only; cannot bypass ERP field/permission/catalog checks |
| `idempotency.sourceEventId` | Source-message identity; ERP duplicate namespace includes organization + registry Page + Meta Page + message ID |
| `idempotency.fingerprint` | Existing bot hash excludes some review fields (for example display name); mapper independently hashes complete relevant review fields |
| `effects` | Must all be zero for dry-run. Synthetic drafts are always excluded from production accounting and cannot create production orders |

The current core contract is `core_create_order({payload:{request_id,customer_name,phone,delivery_address,warehouse_id,items:[{product_id,quantity}],facebook_page_id?,lead_id?,branch_id?,collect_amount?,note?}})`. `request_id` is a stable UUID for one authorized ERP action. Page/product/warehouse IDs are ERP UUIDs. The backend derives actor/organization, checks `orders.create`, resolves trusted product price (valid discount else sale price), checks/locks/decrements warehouse stock, creates order/items/pending delivery and audit atomically. It rejects client-supplied organization, actor, demo flag, unit price and totals. Cash-ledger activity is separate; an order is not proof of payment.

The mapper returns `momo.erp.messenger-order-review.v1`, camelCase `reviewDraft`, source key/fingerprint, explicit blockers and `coreContract.requestPayloadPrepared=false`. It never returns an executable core RPC payload, generates no request UUID and always keeps `canCreateOrder=false`, `canSendReply=false`, `humanApprovalRequired=true`.

Call context must be assembled by the ERP backend from authenticated profile, Page grant/RPC and authorized catalog lookup, never accepted from frontend claims. It includes:

```js
{
  authorization: {
    actorId: '<ERP user UUID>', organizationId: '<org UUID>',
    checkedPageId: '<registry Page UUID>',
    permissions: ['social_inbox.read', 'orders.create'], pageRead: true
  },
  page: { id: '<registry Page UUID>', organization_id: '<org UUID>',
    external_page_id: '<Meta numeric string>', is_active: true },
  selection: { productId: '<explicitly selected ERP product UUID>',
    warehouseId: '<explicitly selected warehouse UUID>' },
  catalogFacts: {
    source: 'authorized_erp_lookup', organizationId: '<org UUID>', observedAt: '<ISO time>',
    products: [{ id: '<product UUID>', organization_id: '<org UUID>', sku: '<known SKU>',
      name: '<catalog name>', sale_price: 20000, discount_price: null, is_active: true }],
    warehouses: [{ id: '<warehouse UUID>', organization_id: '<org UUID>', is_active: true }],
    inventoryBalances: [{ organization_id: '<org UUID>', product_id: '<product UUID>',
      warehouse_id: '<warehouse UUID>', quantity: 3 }]
  }
}
```

Missing lookup/selection leaves product/warehouse/price/stock null with blockers. Zero stock remains zero; missing stock does not become zero. Old observations are flagged stale. Snapshots never reserve stock or promise future availability. Staff must confirm name/product/warehouse/address/quantity, then a separately authorized real workflow must re-read current facts and call core RPC. This is **not permission to convert synthetic acceptance data into a real production order**.

The deterministic source key is only a proposed persistence boundary. This module does not create an ERP receipt/unique index. Before real order ingestion, add an approved server-owned ingestion/receipt contract with a unique source key, request fingerprint comparison, stable action UUID and transactional link to the created order. Same-event retry returns prior receipt; changed content conflicts; different employees cannot duplicate the same source event. Do not confuse this future ERP-ingestion receipt with the bot's existing send idempotency or per-actor dry-run records.

## Hosted environment and configuration

Source Auth configuration now explicitly allowlists `https://erp.momoshop.mn/?reset=1` and `http://localhost:4173/?reset=1`, matching the frontend recovery callback. This changes only repository configuration; it does not push hosted Auth settings. The local browser stack supplies its own exact ephemeral loopback redirect origins.

Account signup policy and the email/password provider are separate controls. Keep global `[auth].enable_signup=false` for invitation-only ERP accounts, while leaving the email/password provider enabled. In the actual local GoTrue rehearsal, setting `[auth.email].enable_signup=false` disabled password login (422); the working fixture keeps that provider enabled and global signup disabled. Do not use provider disablement as a substitute for the global invitation-only policy. Root's read-only hosted settings check reported `signupDisabled=false`; this is a pending hosted configuration/security gate, not a remote setting fixed by this source change. Confirm effective login/recovery and blocked public signup in the approved target after a separately reviewed settings update.

Keep defaults false: ERP Social/AI UI, inbox read/draft/send/grounded-search flags; bot `AUTO_REPLY`, `ERP_CONTROL_MESSENGER`, `ERP_SEND_ENABLED`, comment send and catalog flags. Enable only the selected isolated read-only stage after a recorded check. Settings persisted in an old bot database must also be read; environment false alone does not erase saved opt-in policies.

| Configuration / secret | Owner / constraint |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | ERP public frontend config; only public publishable/anon key, explicit sandbox URL |
| `MOMO_EXPECTED_SUPABASE_PROJECT_REF` | Build-time project pin; sandbox ref for sandbox, production ref only for separately reviewed production release |
| `SUPABASE_URL`, public key set/legacy anon key | Edge runtime; public SDK client carrying caller JWT, never service-role fallback for Page authorization |
| `SOCIAL_ALLOWED_ORIGINS_JSON` | Exact sandbox browser origin; no wildcard or production-origin assumption |
| `SOCIAL_ADAPTER_MODE` | Default mock; live forwarding enabled only against isolated approved bot endpoint |
| `FACEBOOK_BOT_PAGE_REGISTRY_JSON` | Server registry mapping ERP UUID/org → Meta ID/API version/base origin/token reference |
| `FACEBOOK_BOT_ALLOWED_ORIGINS_JSON` | Exact backend HTTPS origin allowlist; browser cannot supply arbitrary base URL |
| `FACEBOOK_BOT_ERP_TOKEN_*` | Server-side per-Page connector tokens, minimum scopes; never VITE/browser/localStorage/report |
| Bot `ERP_API_KEYS_JSON` / `ADMIN_TOKEN` | Independent server-side credentials; reader scope first, mutation roles later |
| Meta Page token/App Secret/Verify Token | Only dedicated test App/Page after explicit approval; separate from ERP Bearer/JWT |
| `DATA_DIR` and backup destination | Dedicated durable mount for stateful acceptance; private off-host backup custody |

Readiness commands/templates do not provision services. Confirm plan/limits and user authorization before any new resource. Existing Render Free sandbox can remain read-only/synthetic; it cannot prove durable storage or always-on production behavior.

## Acceptance stages and required evidence

| Stage | Required positive and negative checks | Evidence / stop rule |
| --- | --- | --- |
| 0. Deployment identity | Reviewed commit, migration order, config/key project identity, flag defaults; no production connection | Mismatched ref, privileged frontend key, unavailable backup or hidden schema drift → stop |
| 1. JWT/RLS | Missing/invalid/expired JWT, anonymous user, inactive profile, wrong-org IDs, global permission and RLS deny; valid synthetic active role allowed | Hosted requests with sanitized status/code/requestId plus DB evidence; fake RPC is insufficient |
| 2. Page/team registry | Page inactive, wrong external ID/runtime/token, grant revoked, cross-Page object/cursor/key; primary offline/full → eligible backup, unauthorized team excluded | Explicit effective grant policy, versioned routing/concurrent assignment evidence; backup team never adds a second send owner |
| 3. Read-only Social Inbox | List/detail/history/comments/audit only; no drafts, mutations, provider calls or auto-send | Reader token cannot edit/approve/send/settings; all write flags false; UI retains queued/uncertain semantics |
| 4. Durable state | Dedicated mounted SQLite/DB, WAL, dedup/approval/audit/outbox receipts survive deploy/restart; consistent off-host backup and isolated restore | Hash/integrity/counts, send-state reconciliation, measured disk growth; Free ephemeral filesystem → SKIPPED/blocker |
| 5. Draft/edit/approve | Explicit sandbox flag/role change, separate editor/approver/sender capabilities; stale version/basis rejected, edits revoke approval | No send on draft/approve. New incoming supersedes old draft/approval. Provider/key/LLM disclosure reviewed separately |
| 6. Restricted real webhook | Separately approved dedicated Page/App, exact test marker/message and count, correct normal event/HMAC/Page/ownership; one manual reply only if approved | Callback challenge/synthetic event/HTTP202/health alone never equals live delivery. Correlate fresh basis, outbox, remote ID and exactly one visible Messenger reply |
| 7. Revocation/rollback | Pending-job permission revoked, Page disabled, team transfer, credential rotation, timeout/in-flight uncertain; restore/release rollback | No blind retries, no second responder, evidence preserved; revoke-after-queue limitation must be resolved or accepted by an explicit constrained policy before send rollout |

No real customer test message, recovery email or Messenger reply is authorized by this plan itself. Ask only for the concrete missing live action/asset when all preceding gates are reviewable. Keep new tests and fixtures separate from production data.

## Queued employee authorization: explicit current blocker

The current ERP gateway rechecks JWT/profile/global/Page permissions immediately before upstream mutation. Existing v1 bot jobs then run under a service credential; they do **not** revalidate an individual ERP employee/team grant at delivery time. Changing assignment metadata or rotating browser JWT does not revoke an already queued service-owned job.

A future delegated protocol must bind organization, registry Page UUID, external Page, employee, effective grant/policy version, source basis, approved reply version, operation ID, expiry and audience to a verified server authority. Immediately before send, the worker must revalidate that authorization or obtain a short-lived single-use dispatch grant. The protocol and authorization endpoint are **not implemented**. Unknown/unavailable authorization holds the job; it must not fall back to a global Page token. Revoking a grant must cancel/hold pending work; a request already in flight becomes uncertain and needs reconciliation because remote messages cannot be recalled by a local rollback.

If a limited manual pilot is considered before delegation exists, document its exact single-owner scope, queue lifetime, revocation/stop procedure and risk acceptance. Do not claim per-employee queued revocation PASS from current HTTP authorization tests.

## Backup, rollback and cleanup

Back up before migration/release using a database-consistent method, test restore into an isolated target, record ownership/encryption/retention/RPO/RTO and verify all state stores—not just ERP Postgres but the bot SQLite, audit, dedup, approvals, receipts and uncertain outbox. Free-plan backup limitations are not removed by a successful local snapshot. Never run a production reset or restore an old bot DB over newer send records.

Rollback order: disable sandbox mutation/send producers, preserve in-flight/uncertain evidence, gate one Page read-only, revert only the reviewed app release, reconcile source/receipt/remote state, then reactivate exactly one approved responder. Prefer feature/access rollback over destructive schema drops. Delete only explicitly tagged synthetic sandbox records after preserving test evidence; do not clear production rows or Auth accounts.

## Running the local contract tests

```powershell
node --test test/messenger-order-contract.test.mjs
```

The static v1 shape tests run anywhere. Actual bot mapper interoperability reads `MOMO_BOT_SOURCE_ROOT/src/erp-dry-run.js`, defaulting to the existing local bot repository. If unavailable, that one source-interoperability check is explicitly SKIPPED; it is not replaced with a fake PASS. No `.env`, token, real message, bot DB, network or deployment is needed. The current workstation completed all 9 contract tests with zero skips.
