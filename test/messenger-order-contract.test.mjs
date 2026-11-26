import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareMessengerOrderReview } from '../supabase/functions/_shared/messenger-order-draft.mjs';

const ORG = '10000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000002';
const PAGE = '20000000-0000-4000-8000-000000000001';
const PRODUCT = '30000000-0000-4000-8000-000000000001';
const WAREHOUSE = '40000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-11-26T00:00:00Z');
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);
function payload() {
  return {
    schemaVersion: 'momo.erp.messenger-dry-run.v1', mode: 'dry-run', source: 'facebook_messenger_synthetic',
    idempotency: { sourceEventId: 'fixture.mid.1', fingerprint: fingerprint(['fixture']) },
    page: { id: '12345' }, customer: { externalId: '67890', displayName: 'Synthetic customer' },
    message: { externalId: 'fixture.mid.1', occurredAt: new Date(NOW).toISOString(), text: 'Бараа: Аяга\nТоо: 2\nУтас: 99112233\nХаяг: Зохиомол 1-р байр', attachmentTypes: [] },
    order: { intent: 'order', productReference: 'Аяга', quantity: 2, phone: '99112233', deliveryAddress: 'Зохиомол 1-р байр', needsHumanReview: false },
    validation: { eligibleForReview: true, complete: true, missingFields: [] },
    effects: { externalErpWrites: 0, metaSends: 0, productionWrites: 0 },
  };
}
function context() {
  return {
    now: NOW,
    authorization: { actorId: USER, organizationId: ORG, checkedPageId: PAGE, permissions: ['social_inbox.read', 'orders.create'], pageRead: true },
    page: { id: PAGE, organization_id: ORG, external_page_id: '12345', is_active: true },
    selection: { productId: PRODUCT, warehouseId: WAREHOUSE },
    catalogFacts: { source: 'authorized_erp_lookup', organizationId: ORG, observedAt: new Date(NOW).toISOString(),
      products: [{ id: PRODUCT, organization_id: ORG, sku: 'FIXTURE-CUP', name: 'Аяга', sale_price: 20000, discount_price: 15000, is_active: true }],
      warehouses: [{ id: WAREHOUSE, organization_id: ORG, is_active: true }],
      inventoryBalances: [{ organization_id: ORG, warehouse_id: WAREHOUSE, product_id: PRODUCT, quantity: 3 }],
    },
  };
}
const rejects = (value, options, code) => assert.rejects(prepareMessengerOrderReview(value, options), error => error.code === code);

test('actual bot v1 shape maps only to review, not core order RPC arguments or production accounting', async () => {
  const result = await prepareMessengerOrderReview(payload(), context());
  assert.equal(result.source.erpPageId, PAGE); assert.equal(result.source.externalPageId, '12345');
  assert.equal(result.source.excludedFromProductionAccounting, true); assert.equal(result.source.synthetic, true);
  assert.equal(result.reviewDraft.selectedProduct.id, PRODUCT); assert.equal(result.reviewDraft.observedUnitPrice, 15000);
  assert.equal(result.reviewDraft.observedStock, 3); assert.equal(result.readiness.fieldAlignmentComplete, true);
  assert.equal(result.readiness.humanApprovalRequired, true);
  assert.equal(result.readiness.canCreateOrder, false); assert.equal(result.readiness.canSendReply, false);
  assert.equal(result.coreContract.requestId, null); assert.equal(result.coreContract.requestPayloadPrepared, false);
  assert.equal(result.coreContract.pricesResolvedByServer, true); assert.equal(result.coreContract.paymentStatusInferred, false);
  assert.equal(result.request_id, undefined); assert.equal(result.items, undefined); assert.equal(result.total, undefined);
  assert.deepEqual(result.effects, { externalErpWrites: 0, metaSends: 0, productionWrites: 0 });
});

test('product text/code is not an authorized product UUID, price, warehouse or stock fact', async () => {
  const options = context(); options.catalogFacts = null; options.selection = {};
  const result = await prepareMessengerOrderReview(payload(), options);
  assert.equal(result.reviewDraft.selectedProduct, null); assert.equal(result.reviewDraft.selectedWarehouse, null);
  assert.equal(result.reviewDraft.observedUnitPrice, null); assert.equal(result.reviewDraft.observedStock, null);
  for (const code of ['verified_product_selection_required', 'verified_warehouse_selection_required', 'price_unknown', 'stock_unknown']) {
    assert.ok(result.readiness.blockers.includes(code));
  }
});

test('unknown, zero, insufficient and stale facts remain distinct without invented values', async () => {
  const unknown = context(); unknown.catalogFacts.products[0].sale_price = null; unknown.catalogFacts.inventoryBalances = [];
  let result = await prepareMessengerOrderReview(payload(), unknown);
  assert.equal(result.reviewDraft.observedUnitPrice, null); assert.equal(result.reviewDraft.observedStock, null);
  const zero = context(); zero.catalogFacts.products[0].sale_price = 0; zero.catalogFacts.products[0].discount_price = 0;
  zero.catalogFacts.inventoryBalances[0].quantity = 0;
  result = await prepareMessengerOrderReview(payload(), zero);
  assert.equal(result.reviewDraft.observedUnitPrice, 0); assert.equal(result.reviewDraft.observedStock, 0);
  assert.ok(result.readiness.blockers.includes('insufficient_observed_stock')); assert.ok(!result.readiness.blockers.includes('stock_unknown'));
  const stale = context(); stale.catalogFacts.observedAt = new Date(NOW - 300001).toISOString();
  assert.ok((await prepareMessengerOrderReview(payload(), stale)).readiness.blockers.includes('catalog_snapshot_stale'));
});

test('same-org active Page authorization is required and numeric Meta ID cannot replace registry UUID', async () => {
  for (const change of [value => { value.authorization.pageRead = false; }, value => { value.authorization.permissions = []; }]) {
    const options = context(); change(options); await rejects(payload(), options, 'page_permission_required');
  }
  for (const change of [value => { value.page.is_active = false; }, value => { value.page.organization_id = PRODUCT; },
    value => { value.page.id = '12345'; }, value => { value.authorization.checkedPageId = WAREHOUSE; }]) {
    const options = context(); change(options); await rejects(payload(), options, 'page_binding_invalid');
  }
  const value = payload(); value.page.id = PAGE; await rejects(value, context(), 'external_page_mismatch');
});

test('foreign organization catalog data is rejected instead of used as a lookup shortcut', async () => {
  for (const table of ['products', 'warehouses', 'inventoryBalances']) {
    const options = context(); options.catalogFacts[table][0].organization_id = PRODUCT;
    await rejects(payload(), options, 'catalog_organization_mismatch');
  }
});

test('incomplete/attachment/human cases stay review-blocked even if bot complete says true', async () => {
  const value = payload(); value.customer.displayName = null; value.order.phone = null; value.order.quantity = null;
  value.order.deliveryAddress = null; value.message.attachmentTypes = ['image'];
  const result = await prepareMessengerOrderReview(value, context());
  for (const code of ['customer_name_required', 'phone_required', 'quantity_required', 'delivery_address_required', 'source_requires_human_review']) {
    assert.ok(result.readiness.blockers.includes(code));
  }
  const request = payload(); request.order.intent = 'human';
  assert.equal((await prepareMessengerOrderReview(request, context())).readiness.eligibleForReview, false);
});

test('source event key is stable across actors and separates organization/Page/message identity', async () => {
  const first = await prepareMessengerOrderReview(payload(), context());
  const anotherActor = context(); anotherActor.authorization.actorId = PRODUCT;
  assert.equal((await prepareMessengerOrderReview(payload(), anotherActor)).source.sourceEventKey, first.source.sourceEventKey);
  const anotherPage = context(); anotherPage.page.id = PRODUCT; anotherPage.authorization.checkedPageId = PRODUCT;
  assert.notEqual((await prepareMessengerOrderReview(payload(), anotherPage)).source.sourceEventKey, first.source.sourceEventKey);
  const anotherMessage = payload(); anotherMessage.message.externalId = 'fixture.mid.2'; anotherMessage.idempotency.sourceEventId = 'fixture.mid.2';
  assert.notEqual((await prepareMessengerOrderReview(anotherMessage, context())).source.sourceEventKey, first.source.sourceEventKey);
  const changedName = payload(); changedName.customer.displayName = 'Different synthetic name';
  const changed = await prepareMessengerOrderReview(changedName, context());
  assert.equal(changed.source.sourceEventKey, first.source.sourceEventKey);
  assert.notEqual(changed.source.reviewFingerprint, first.source.reviewFingerprint, 'ERP fingerprint includes display name omitted by bot fingerprint');
});

test('unknown/unsafe schemas and nonzero side effects cannot be accepted as dry-run', async () => {
  const changed = [value => { value.mode = 'live'; }, value => { value.source = 'facebook_messenger'; },
    value => { value.schemaVersion = 'made-up'; }];
  for (const edit of changed) { const value = payload(); edit(value); await rejects(value, context(), 'unsupported_dry_run_contract'); }
  const effects = payload(); effects.effects.metaSends = 1; await rejects(effects, context(), 'dry_run_effects_invalid');
  const secret = payload(); secret.service_role = 'fixture-do-not-echo';
  await assert.rejects(prepareMessengerOrderReview(secret, context()), error => !error.message.includes('fixture-do-not-echo') && error.code === 'invalid_payload');
});

test('real local bot mapper output is accepted without changing the bot repository', async t => {
  const botRoot = process.env.MOMO_BOT_SOURCE_ROOT ?? 'C:/Users/begii/OneDrive/Documents/ChatGPT/Чат шүүх чат бот үүсгэх';
  const botModule = join(botRoot, 'src/erp-dry-run.js');
  if (!existsSync(botModule)) { t.skip('Set MOMO_BOT_SOURCE_ROOT to run actual local bot mapper interoperability. Static v1 contract tests remain active.'); return; }
  const { normalizeSyntheticMessengerEvent, mapSyntheticMessageToErp } = await import(pathToFileURL(botModule).href);
  const event = normalizeSyntheticMessengerEvent({ pageId: '12345', senderId: '67890', messageId: 'fixture.real.mapper',
    timestamp: NOW, text: payload().message.text, customer: { name: 'Synthetic customer' }, attachments: [] }, '12345');
  const actual = mapSyntheticMessageToErp(event);
  const result = await prepareMessengerOrderReview(actual, context());
  assert.equal(result.reviewDraft.productReference, 'Аяга'); assert.equal(result.reviewDraft.quantity, 2);
  assert.equal(result.source.externalMessageId, 'fixture.real.mapper'); assert.equal(result.readiness.canCreateOrder, false);
  assert.match(createHash('sha256').update(readFileSync(botModule)).digest('hex'), /^[a-f0-9]{64}$/u);
});
