import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dist/core-service.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const ORG = '10000000-0000-4000-8000-000000000001';
const PRODUCT = '10000000-0000-4000-8000-000000000002';
const WAREHOUSE = '10000000-0000-4000-8000-000000000003';
const REQUEST = '10000000-0000-4000-8000-000000000004';
const ORDER = '10000000-0000-4000-8000-000000000005';
const TIME = '2026-11-26T12:00:00.123456+00:00';
const plain = value => JSON.parse(JSON.stringify(value));
function fixture({ permissions = [], rows = {}, errors = {}, rpcError, productStock = [], summary = {}, orderOptions = { warehouses: [] } } = {}) {
  const calls = [], queries = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; queries.push(this); }
    select(columns, options) { this.columns = columns; this.options = options; return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    order(key) { this.sort = key; return this; }
    limit(limit) { this.limitValue = limit; return this; }
    then(resolve, reject) { return Promise.resolve({ data: rows[this.table] ?? [], count: (rows[this.table] ?? []).length, error: errors[this.table] }).then(resolve, reject); }
  }
  const client = { from: table => new Query(table), rpc: async (name, parameters) => {
    calls.push({ name, parameters: plain(parameters ?? {}) });
    if (name === 'core_product_stock' && !rpcError) return { data: productStock };
    return rpcError ? { error: rpcError } : { data: name === 'core_dashboard_summary' ? summary : name === 'core_order_options' ? orderOptions : { id: PRODUCT, saved: true } };
  } };
  const window = {};
  runInNewContext(source, { window, console });
  const auth = { client, profile: { organizationId: ORG }, can: code => permissions.includes(code) };
  return { service: new window.MomoCoreService(auth), window, auth, queries, calls };
}

test('core service requires a real organization context and never falls back to local demo state', () => {
  const { window } = fixture();
  for (const auth of [null, {}, { client: {}, profile: {} }, { client: {}, profile: { organizationId: '12345' } }]) assert.throws(() => new window.MomoCoreService(auth));
  assert.doesNotMatch(source, /localStorage\s*[.(]|products\.json|seedOrders|seedLeads/);
  assert.doesNotMatch(APP, /localStorage|products\.json|seedOrders|seedLeads|ORD-10842|Одонгэрэл/);
  assert.doesNotMatch(APP, /const comingSoon=|coming-soon-view/);
  assert.doesNotMatch(HTML, /4,280,000|86,420,000|1,248 харилцагч|12\.5%|23 идэвхтэй хүргэлт/);
});

test('permission-aware loading performs no table or summary requests without grants', async () => {
  const { service, queries, calls } = fixture();
  const snapshot = await service.loadSnapshot();
  assert.equal(snapshot.status, 'ready'); assert.equal(snapshot.source, 'supabase');
  assert.equal(snapshot.summary, null); assert.deepEqual(queries, []); assert.deepEqual(calls, []);
});

test('production reads enforce organization, explicit demo exclusion and safe Page columns', async () => {
  const { service, queries } = fixture({ permissions: ['orders.read', 'leads.read', 'finance.view', 'pages.read', 'inventory.read'] });
  await service.loadSnapshot();
  for (const query of queries) assert.deepEqual(query.filters[0], ['organization_id', ORG]);
  for (const table of ['orders', 'leads', 'finance_entries']) assert.ok(queries.find(query => query.table === table).filters.some(([key, value]) => key === 'is_demo' && value === false));
  assert.doesNotMatch(queries.find(query => query.table === 'facebook_pages').columns, /credential|token|secret|\*/i);
  assert.equal(queries.find(query => query.table === 'inventory_balances').sort, 'updated_at');
});

test('order creator can obtain safe warehouse options without reading inventory balances or costs', async () => {
  const { service, queries, calls } = fixture({ permissions: ['orders.create'], orderOptions: { source: 'supabase', warehouses: [{ id: WAREHOUSE, name: 'Synthetic warehouse' }] } });
  const snapshot = await service.loadSnapshot();
  assert.deepEqual(plain(snapshot.orderOptions.warehouses), [{ id: WAREHOUSE, name: 'Synthetic warehouse' }]);
  assert.equal(queries.length, 0); assert.equal(calls.length, 1); assert.equal(calls[0].name, 'core_order_options');
  assert.equal(snapshot.summary, null);
});

test('catalog requests stock for active products with both grants and keeps a confirmed zero', async () => {
  const rows = { products: [{ id: PRODUCT, is_active: true }, { id: ORDER, is_active: false }] };
  const permissions = ['products.read', 'inventory.read'];
  const { service, calls } = fixture({ rows, permissions, productStock: [{ product_id: PRODUCT, quantity: 0 }] });
  const snapshot = await service.loadSnapshot();
  assert.deepEqual(calls, [{ name: 'core_product_stock', parameters: { product_ids: [PRODUCT] } }]);
  assert.equal(snapshot.productStock[PRODUCT], 0);
  for (const permission of permissions) {
    const restricted = fixture({ rows, permissions: [permission] });
    assert.deepEqual(plain((await restricted.service.loadSnapshot()).productStock), {});
    assert.equal(restricted.calls.length, 0);
  }
});

test('unknown catalog stock remains unavailable even when a raw balance exists', async () => {
  const rows = { products: [{ id: PRODUCT, is_active: true }], inventory_balances: [{ product_id: PRODUCT, quantity: 9 }] };
  for (const scenario of [{ productStock: [] }, { rpcError: { code: 'PGRST202' } },
    { productStock: [{ product_id: PRODUCT, quantity: Number.MAX_SAFE_INTEGER + 1 }] }]) {
    const { service } = fixture({ rows, permissions: ['products.read', 'inventory.read'], ...scenario });
    const snapshot = await service.loadSnapshot();
    assert.equal(snapshot.productStock[PRODUCT], undefined);
    if (scenario.rpcError || scenario.productStock.length) assert.equal(snapshot.status, 'partial');
  }
});

test('all snapshot query sort fields exist in the actual SQL table schema', async () => {
  const { service, queries } = fixture({ permissions: ['products.read', 'inventory.read', 'orders.read', 'leads.read', 'deliveries.read', 'pages.read', 'finance.view'] });
  await service.loadSnapshot();
  const schema = readFileSync(new URL('../supabase/migrations/202609170001_core_schema.sql', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../supabase/migrations/20261126133809_core_production_readiness.sql', import.meta.url), 'utf8');
  for (const query of queries) {
    const table = schema.match(new RegExp(`create table (?:if not exists )?public\\.${query.table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'iu'));
    assert.ok(table, `SQL definition exists for ${query.table}`);
    assert.match(table[1], new RegExp(`^\\s*${query.sort}\\s`, 'mu'), `${query.table}.${query.sort} must exist`);
  }
  assert.equal(queries.find(query => query.table === 'call_logs').sort, 'called_at');
});

test('missing migration and failed reads remain visible rather than producing successful zero metrics', async () => {
  const { service } = fixture({ permissions: ['products.read', 'dashboard.view'], errors: { products: { code: '42501', message: 'PRIVATE DB DETAIL' } }, rpcError: { code: 'PGRST202', message: 'PRIVATE SQL DETAIL' } });
  const snapshot = await service.loadSnapshot();
  assert.equal(snapshot.status, 'partial'); assert.equal(snapshot.summary, null);
  assert.equal(snapshot.errors.products.code, '42501'); assert.equal(snapshot.errors.summary.code, 'PGRST202');
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE/);
});

test('create-order wire contract sends stable identity and verified IDs without caller totals/actor/org', async () => {
  const { service, calls } = fixture();
  const input = { request_id: REQUEST, customer_name: '  Зохиомол  ', phone: '+976 9911 2233', delivery_address: 'Тестийн хаяг', warehouse_id: WAREHOUSE,
    items: [{ product_id: PRODUCT, quantity: 2, unit_price: 1 }], product_total: 1, organization_id: 'untrusted', actor_id: 'untrusted', collect_amount: 1200 };
  await service.createOrder(input); await service.createOrder(input);
  assert.equal(calls[0].name, 'core_create_order'); assert.deepEqual(calls[0], calls[1]);
  const payload = calls[0].parameters.payload;
  assert.equal(payload.request_id, REQUEST); assert.equal(payload.customer_name, 'Зохиомол'); assert.equal(payload.phone, '99112233');
  assert.deepEqual(payload.items, [{ product_id: PRODUCT, quantity: 2 }]);
  for (const key of ['product_total', 'organization_id', 'actor_id', 'unit_price', 'is_demo']) assert.equal(Object.hasOwn(payload, key), false);
});

test('invalid order phone/UUID/quantity and missing warehouse never reach RPC', () => {
  const { service, calls } = fixture();
  const base = { request_id: REQUEST, customer_name: 'Test', phone: '99112233', delivery_address: 'Test address', warehouse_id: WAREHOUSE, items: [{ product_id: PRODUCT, quantity: 1 }] };
  for (const input of [{ ...base, phone: '9911' }, { ...base, warehouse_id: '' }, { ...base, items: [{ product_id: PRODUCT, quantity: 0 }] }, { ...base, items: [{ product_id: '12345', quantity: 1 }] }]) assert.throws(() => service.createOrder(input));
  assert.equal(calls.length, 0);
});

test('product edits retain exact server timestamp precision and cannot silently edit stock', async () => {
  const { service, calls } = fixture();
  await service.saveProduct({ id: PRODUCT, expected_updated_at: TIME, name: 'Test', sku: 'TEST', sale_price: 100, stock: 99 });
  const payload = calls[0].parameters.payload;
  assert.equal(payload.expected_updated_at, TIME); assert.equal(Object.hasOwn(payload, 'stock'), false);
  assert.throws(() => service.saveProduct({ name: 'Test', sku: 'TEST', sale_price: -1 }));
  assert.throws(() => service.saveProduct({ id: PRODUCT, name: 'Test', sku: 'TEST', sale_price: 100 }));
});

test('order update and cancellation use existing status enum and optimistic timestamp', async () => {
  const { service, calls } = fixture();
  await service.updateOrder({ id: ORDER, updated_at: TIME }, 'cancelled', 'Customer requested');
  assert.deepEqual(calls[0], { name: 'core_update_order', parameters: { target_order: ORDER, payload: { status: 'cancelled', note: 'Customer requested', expected_updated_at: TIME } } });
  assert.throws(() => service.updateOrder({ id: ORDER, updated_at: TIME }, 'deleted'));
});

test('lead batching and call updates persist via RPC; converted status requires actual order creation', async () => {
  const { service, calls } = fixture();
  await service.createLeads({ request_id: REQUEST, contacts: [{ customer_name: ' Test ', phone: '99112233', comment: ' Test ' }] });
  await service.updateLead({ id: PRODUCT, updated_at: TIME }, 'no_answer', { recordCall: true });
  assert.equal(calls[0].name, 'core_create_leads'); assert.equal(calls[0].parameters.payload.contacts[0].customer_name, 'Test');
  assert.equal(calls[1].name, 'core_update_lead'); assert.equal(calls[1].parameters.payload.record_call, true);
  assert.throws(() => service.updateLead({ id: PRODUCT, updated_at: TIME }, 'converted'));
});

test('inventory movement requires nonzero integer delta and retains operation id on retry', async () => {
  const { service, calls } = fixture();
  const payload = { request_id: REQUEST, warehouse_id: WAREHOUSE, product_id: PRODUCT, quantity_delta: -2, movement_type: 'adjustment', note: 'Synthetic test' };
  await service.adjustInventory(payload); await service.adjustInventory(payload);
  assert.deepEqual(calls[0], calls[1]);
  for (const quantity_delta of [0, 1.5, Infinity]) assert.throws(() => service.adjustInventory({ ...payload, quantity_delta }));
});

test('finance cash entries are explicit idempotent records and never inferred from an order total', async () => {
  const { service, calls } = fixture();
  await service.recordFinance({ request_id: REQUEST, entry_type: 'income', amount: 1200, description: 'Synthetic collection', order_id: ORDER });
  assert.equal(calls[0].name, 'core_record_finance'); assert.equal(calls[0].parameters.payload.request_id, REQUEST);
  for (const amount of [0, -10, '']) assert.throws(() => service.recordFinance({ request_id: REQUEST, entry_type: 'income', amount, description: 'Test' }));
});

test('backend errors are actionable and sanitized; migration absence is never represented as saved', async () => {
  const { service } = fixture({ rpcError: { code: 'PGRST202', message: 'SECRET BACKEND CONFIGURATION' } });
  await assert.rejects(service.saveWarehouse({ name: 'Test' }), error => error.code === 'PGRST202' && !error.message.includes('SECRET'));
});
