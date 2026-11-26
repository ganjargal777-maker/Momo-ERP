# MOMO ERP — core database contract and local validation

Checked: **2026-11-26, Asia/Ulaanbaatar**. Implemented in the isolated checkout only. Production project, Auth users, data and deployed functions were not changed by this work.

Migration: `supabase/migrations/20261126133809_core_production_readiness.sql`, created with the installed Supabase CLI. It is additive; no seed data, reset, destructive table replacement or remote migration is included. SQL SHA-256: `49D39BB8C34A661138EF6924F58ADD8DCDA343E647F4D022BFFCF604F2319356`.

## Delivery export

The `core_delivery_export` view applies the caller's delivery RLS policies. Its
private order-key projection checks the active organization, `deliveries.read`
and the parent order's demo flag. Joining on both organization and order ID
excludes inconsistent tenant links. The public projection contains organization
ID, order ID, delivery status, courier ID and delivery timestamp. Delivery-only
roles can export these fields while customer and financial fields retain their
existing access controls. Each export page reads current committed data.

## RPC surface

The browser calls Supabase `client.rpc(name, arguments)` with its own authenticated JWT. These are local implemented SQL functions, not claims that production already exposes them. Tenant and actor come from `auth.uid()`, active profile and `current_organization_id()`, never from a caller-supplied organization/actor. No service-role key belongs in the frontend.

| Function | Arguments | Permission / behavior |
| --- | --- | --- |
| `core_save_product` | `{payload:{id?,sku,name,category_id?,sale_price?,discount_price?,cost_price?,is_active?,expected_updated_at?}}` | `products.manage`; create/update product; update requires exact version |
| `core_save_warehouse` | `{payload:{id?,name,branch_id?,is_active?,expected_updated_at?}}` | `inventory.manage`; create/update warehouse |
| `core_order_options` | `{}` | `orders.create`; active same-org warehouse `{id,name}` only; does not grant stock/cost read |
| `core_product_stock` | `{product_ids:uuid[]}` | Requires both `products.read` and `inventory.read`. Returns one `{product_id,quantity}` per requested active, visible product, summed across all visible warehouse balances. Products without balances return zero. Missing, inactive and foreign products are omitted. Accepts up to 500 IDs. |
| `core_adjust_inventory` | `{payload:{request_id,warehouse_id,product_id,quantity_delta,movement_type,note?}}` | `inventory.manage`; atomic balance + movement + audit; allowed type income/adjustment/return |
| `core_create_order` | `{payload:{request_id,customer_name,phone,delivery_address,warehouse_id,items,facebook_page_id?,lead_id?,branch_id?,collect_amount?,note?}}` | `orders.create`; trusted prices, stock reservation, items, pending delivery, status history, optional lead conversion, audit and receipt in one transaction |
| `core_update_order` | `{target_order,payload:{status,expected_updated_at,note?}}` | `orders.update`; cancellation also `orders.cancel`; transition to in_transit/delivered also `deliveries.manage`; final order cannot reopen |
| `core_create_leads` | `{payload:{request_id,contacts,facebook_page_id?,product_id?}}` | `leads.create`; 1–500 normalized contacts; assigns created leads to caller |
| `core_update_lead` | `{target_lead,payload:{status,record_call?,expected_updated_at,note?}}` | `leads.update`; call log also `calls.create`; converted lead cannot reopen |
| `core_update_delivery` | `{target_order,payload:{status,expected_updated_at,courier_id?,note?}}` | `deliveries.manage`; active same-org courier, locked order/delivery, delivered timestamp and synchronized order status/history |
| `core_record_finance` | `{payload:{request_id,entry_type,amount,description,order_id?,occurred_at?}}` | `finance.manage`; append cash ledger entry + audit + receipt |
| `core_dashboard_summary` | `{}` | Any of dashboard.view/reports.view/finance.view; sections individually redacted |

Product `discount_price` is an alternative sale price when positive and lower than `sale_price`, not an amount subtracted. `items` is `[{product_id:uuid,quantity:positive integer}]`, no client unit price/total. `contacts` is `[{customer_name?,phone,comment?}]`. Product/warehouse mutation returns a row, order mutation returns an order row, lead batch returns rows, inventory returns its balance, delivery returns its row and finance returns the appended ledger row. Decimal money is authoritative server data.

`expected_updated_at` must preserve the exact Supabase timestamp string including microseconds. Passing through `new Date(...).toISOString()` loses precision and causes a legitimate version conflict.

Example order request:

```json
{
  "payload": {
    "request_id": "11111111-1111-4111-8111-111111111111",
    "customer_name": "Synthetic customer",
    "phone": "99112233",
    "delivery_address": "Synthetic test address",
    "warehouse_id": "22222222-2222-4222-8222-222222222222",
    "items": [{"product_id":"33333333-3333-4333-8333-333333333333","quantity":2}]
  }
}
```

All UUIDs above are illustrative. A bot product name, URL, SKU-like text or proposed quantity must become a reviewed draft first. It cannot be used as a verified product UUID, warehouse, price, customer permission, payment confirmation or delivery instruction without authorized ERP resolution.

## Atomicity, idempotency and versions

Inventory/order/lead-batch/finance creation requires `request_id`. The private receipt key is organization + authenticated actor + operation + request UUID. Identical retries return the stored creation receipt; changed payload under the same key fails. A replay rechecks the caller's current permission before reading the receipt. The caller must preserve the key across retry/timeout, then query current state rather than interpret a historical receipt as the latest delivery/payment state.

Orders lock product/stock rows in deterministic product UUID order, reject duplicate lines/inactive products/insufficient stock, derive prices and totals, and commit every side effect together. A cancellation releases an explicitly reserved warehouse stock only once. Old orders have `inventory_reserved=false` by default, so cancelling an old order does not invent inventory to return. No blind restocking occurs for data whose reservation was never recorded.

Ledger cash income/expense is separate from delivered-order revenue. An order becoming delivered does not automatically create cash income; an explicit authorized cash entry is required. Returned/failed delivery states remain operational states; they do not silently reverse a cash transaction or synthesize a stock correction. A reviewed cancellation/adjustment and separate ledger correction remain explicit decisions.

SQL errors: `42501` authorization; `22023` invalid payload; `23514` invalid references/stock/constraint; `23505` idempotency conflict or converted lead; `40001` stale version; `P0002` unavailable object. Frontend must retain stable operation keys after unknown network outcomes. Unknown/client-supplied fields including organization/actor/is_demo/product totals are rejected.

## Database security changes

- `handle_new_auth_user` trusts only `raw_app_meta_data.organization_id`. Editable signup metadata can populate display fields but cannot choose a tenant. A user without an active organization cannot enter core RPCs.
- Profile identity and organization cannot be changed through an authenticated update. Non-managers cannot change status, email or employment/department/position privilege fields. Disabled callers lose normal read/mutation access and cannot self-reactivate.
- Role permission reads/writes and user-role memberships now explicitly restrict both ends to the current organization. Private tenant-reference triggers prevent known foreign UUID references in products, warehouses, inventory, leads, orders/items/history, deliveries, finance and role links.
- Private constraint triggers validate new/changed references; they do not automatically repair preexisting cross-tenant rows. Unchanged references are preserved during FK SET NULL cascades so deleting a synthetic profile does not corrupt cascade order.
- Core order/stock/lead/delivery writes use the guarded atomic RPCs; raw authenticated mutations on those tables are revoked. Finance is append-only through its RPC; only finance.view can read ledger rows. Product/warehouse existing RLS remains in effect.
- Public trigger helpers have their unnecessary API execution grants revoked. Atomic public `core_*` RPCs deliberately use guarded SECURITY DEFINER to authorize a cross-module transaction (for example an operator order reserves stock without inventory.manage). They validate the actor, named permission and every tenant reference. The private schema/helpers/receipts are inaccessible to anon/authenticated, and public core RPC execution is denied to anon.

## Real aggregates and demo boundary

New orders/leads/ledger rows have `is_demo=false`; no browser/demo/localStorage/product JSON seed is imported. Staff mutation payloads cannot set this marker. Summary queries exclude marked demo orders/finance rows. Existing unknown legacy rows are not mass-labelled or deleted: before production acceptance, an owner must classify any preexisting synthetic rows using a reviewed process.

Summary source is `supabase`, currency MNT and organization timezone. `today.date`, created order count and delivered revenue use the organization calendar. Current new/delivered/in-transit/pending status counters represent the current backlog, so UI must label them as current statuses rather than claim they are daily changes. `dailySales` covers seven calendar days. Stock cost is only returned with finance.view; inventory section requires inventory.read and products.read. Finance-only roles get finance data with today=null/statusCounts={}/dailySales=[], and report-only roles get sales aggregates with finance=null. Neither aggregate permission grants raw order detail.

Dashboard inventory counts each active product once across all warehouses in its organization. A combined quantity of 1–5 is low stock. A zero total or no balance rows means out of stock. Stock cost includes inventory held for inactive products and requires finance.view.

The finite-price constraint is NOT VALID for existing products: new/changed rows reject NaN/nonfinite money while preexisting rows remain untouched for review. Validation of that constraint and classification of legacy rows are production preflight items, not operations performed here.

## Actual local evidence

Run uses the existing fresh-loopback PostgreSQL15 Docker harness, not a hosted database. Latest focused result: **59 tests, 58 PASS, 0 FAIL, 1 SKIPPED**. The skip is the previously documented assignee-only Social policy, explicitly outside the current Page-wide contract. The nested legacy compatibility suite additionally passes all six checks; do not double-count it as six independent top-level tests.

Evidence: `docs/evidence/core-pg15-tests.tap`, `docs/evidence/core-pg15-validation.json`. The JSON records the migration hashes, actual PostgreSQL15.20 image, core backup/restore status and owned-container/network cleanup. The root agent runs the complete regression/browser suites separately.

Core checks cover:

- Transactional rollback restores finance/private receipts/additive columns, RLS policies, grants and the Auth-trigger definition.
- User-metadata tenant injection, self-privilege mutation, cross-org role links and foreign references are denied.
- Product/warehouse CRUD/versioning, minimal operator warehouse capability, raw write/private helper denial.
- Four concurrent inventory retries create one movement; four concurrent order retries create one order/items/delivery/audit; two independent competing orders cannot oversell.
- Whole-order rollback on insufficient stock, cancellation with single restock, no delivery-permission bypass through order updates, lead call logging/conversion and delivery version/courier checks.
- Four concurrent cash retries create one entry; money NaN is rejected; dashboard excludes marked demo rows and respects finance/report section permissions.
- Real `pg_dump` → `pg_restore` into a new database preserves synthetic orders, items, balances/movements, finance, audit, private operation receipts, function definition and write restrictions.
- All owned synthetic fixture rows/auth users/organizations/receipts are cleaned; no real data or credentials are used.

## Production gates and rollback

Do not equate these tests with hosted deployment or actual employee login evidence. Production remains on its previously deployed schema until a separate rollout passes backup/restore, migration review, actual runtime configuration, authentication and browser acceptance gates.

This core migration has no dependency on pending Social001–004/alignment. A blanket push of every pending migration could activate unrelated Messenger database changes; choose the reviewed rollout set explicitly and preserve feature flags off. No remote migration, deployment, paid resource or bot modification is part of this change.

Rollback of uncommitted DDL is proven locally. There is no destructive down migration for a deployed system with new orders/cash data. After a committed rollout, freeze mutations, retain current/new records and receipts, take a consistent backup and prefer a reviewed forward correction. Restoring an older snapshot over newer financial transactions is not an acceptable automatic rollback.
