// Offline/server-side review mapper. No database, SDK, env, fetch, send or order
// writer. Authorization and catalog facts must come from the ERP backend.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REMOTE = /^[A-Za-z0-9._:-]{1,128}$/u;
const META_PAGE = /^\d{1,32}$/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class MessengerDraftError extends Error {
  constructor(code, status = 400) { super('Messenger review contract rejected.'); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new MessengerDraftError(code, status); };
function exact(value, keys) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail('invalid_payload');
  return value;
}
function text(value, maximum, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('invalid_payload');
  return value.normalize('NFKC').trim();
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function numberOrUnknown(value) {
  // JSON numbers only. Null/missing facts stay unknown, never become zero.
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * authorization: backend-resolved {actorId,organizationId,checkedPageId,
 *   permissions:string[],pageRead:boolean}. Not browser-provided claims.
 * page: get_social_page_context result (ERP UUID != Meta numeric external ID).
 * catalogFacts: optional authorized same-org snapshot; selection is explicit.
 * All output remains synthetic review-only, even if every field is complete.
 */
export async function prepareMessengerOrderReview(payload, { authorization, page, catalogFacts = null,
  selection = {}, now = Date.now(), maxCatalogAgeMs = 300000 } = {}) {
  if (!object(authorization) || !UUID.test(authorization.actorId ?? '') || !UUID.test(authorization.organizationId ?? '') ||
      !Array.isArray(authorization.permissions) || !authorization.permissions.includes('social_inbox.read') ||
      authorization.pageRead !== true) fail('page_permission_required', 403);
  if (!object(page) || !UUID.test(page.id ?? '') || page.id !== authorization.checkedPageId ||
      page.organization_id !== authorization.organizationId || page.is_active !== true || !META_PAGE.test(page.external_page_id ?? '')) {
    fail('page_binding_invalid', 403);
  }
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(maxCatalogAgeMs) || maxCatalogAgeMs < 1) fail('invalid_clock');
  exact(payload, ['schemaVersion', 'mode', 'source', 'idempotency', 'page', 'customer', 'message', 'order', 'validation', 'effects']);
  if (payload.schemaVersion !== 'momo.erp.messenger-dry-run.v1' || payload.mode !== 'dry-run' || payload.source !== 'facebook_messenger_synthetic') {
    fail('unsupported_dry_run_contract');
  }
  exact(payload.page, ['id']);
  if (payload.page.id !== page.external_page_id) fail('external_page_mismatch', 403);
  exact(payload.idempotency, ['sourceEventId', 'fingerprint']);
  exact(payload.customer, ['externalId', 'displayName']);
  exact(payload.message, ['externalId', 'occurredAt', 'text', 'attachmentTypes']);
  if (!REMOTE.test(payload.message.externalId ?? '') || !REMOTE.test(payload.customer.externalId ?? '') ||
      payload.idempotency.sourceEventId !== payload.message.externalId || !/^[a-f0-9]{64}$/u.test(payload.idempotency.fingerprint ?? '')) fail('source_identity_invalid');
  const occurredAt = Date.parse(payload.message.occurredAt);
  if (!Number.isFinite(occurredAt) || occurredAt < 1 || occurredAt > now + 300000) fail('source_timestamp_invalid');
  const messageText = text(payload.message.text, 8000);
  const customerName = text(payload.customer.displayName, 160, true);
  const attachments = payload.message.attachmentTypes;
  if (!Array.isArray(attachments) || attachments.length > 10 || attachments.some(value => typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/u.test(value))) fail('invalid_payload');
  exact(payload.order, ['intent', 'productReference', 'quantity', 'phone', 'deliveryAddress', 'needsHumanReview']);
  const order = payload.order;
  if (!['order', 'inquiry', 'human', 'cancel', 'other'].includes(order.intent) || typeof order.needsHumanReview !== 'boolean' ||
      (order.quantity !== null && (!Number.isSafeInteger(order.quantity) || order.quantity < 1 || order.quantity > 1000000))) fail('invalid_payload');
  const productReference = text(order.productReference, 2000, true);
  const phone = text(order.phone, 32, true);
  const normalizedPhone = phone?.replace(/\D/gu, '').replace(/^976(?=\d{8}$)/u, '') ?? null;
  const address = text(order.deliveryAddress, 1000, true);
  exact(payload.effects, ['externalErpWrites', 'metaSends', 'productionWrites']);
  if (Object.values(payload.effects).length !== 3 || Object.values(payload.effects).some(value => value !== 0)) fail('dry_run_effects_invalid');
  // The bot's complete/eligible/missingFields are advisory, not authorization or
  // proof of a UUID, stock, price, payment or a complete ERP order.
  exact(payload.validation, ['eligibleForReview', 'complete', 'missingFields']);
  if (typeof payload.validation.eligibleForReview !== 'boolean' || typeof payload.validation.complete !== 'boolean' ||
      !Array.isArray(payload.validation.missingFields) || payload.validation.missingFields.some(value => typeof value !== 'string')) fail('invalid_payload');
  exact(selection, ['productId', 'warehouseId']);
  for (const id of [selection.productId, selection.warehouseId]) if (id !== undefined && !UUID.test(id)) fail('selection_invalid');
  const blockers = [];
  const add = code => { if (!blockers.includes(code)) blockers.push(code); };
  if (order.intent !== 'order') add('not_an_order_request');
  if (!customerName) add('customer_name_required');
  if (!productReference) add('product_reference_required');
  if (!order.quantity) add('quantity_required');
  if (!/^\d{8}$/u.test(normalizedPhone ?? '')) add('phone_required');
  if (!address) add('delivery_address_required');
  if (order.needsHumanReview || attachments.length) add('source_requires_human_review');
  if (!authorization.permissions.includes('orders.create')) add('order_create_permission_required');
  let product = null, warehouse = null, stock = null, observedPrice = null, catalogObservedAt = null;
  if (catalogFacts !== null) {
    exact(catalogFacts, ['source', 'organizationId', 'observedAt', 'products', 'warehouses', 'inventoryBalances']);
    if (catalogFacts.source !== 'authorized_erp_lookup' || catalogFacts.organizationId !== authorization.organizationId ||
        !Array.isArray(catalogFacts.products) || !Array.isArray(catalogFacts.warehouses) || !Array.isArray(catalogFacts.inventoryBalances)) fail('catalog_facts_invalid', 403);
    for (const row of [...catalogFacts.products, ...catalogFacts.warehouses, ...catalogFacts.inventoryBalances]) {
      if (!object(row) || row.organization_id !== authorization.organizationId) fail('catalog_organization_mismatch', 403);
    }
    const timestamp = Date.parse(catalogFacts.observedAt);
    if (!Number.isFinite(timestamp) || timestamp > now + 300000) fail('catalog_timestamp_invalid');
    catalogObservedAt = new Date(timestamp).toISOString();
    if (now - timestamp > maxCatalogAgeMs) add('catalog_snapshot_stale');
    const selectedProducts = catalogFacts.products.filter(row => row.id === selection.productId && row.is_active === true);
    const selectedWarehouses = catalogFacts.warehouses.filter(row => row.id === selection.warehouseId && row.is_active === true);
    if (selectedProducts.length === 1) {
      const row = selectedProducts[0], salePrice = numberOrUnknown(row.sale_price), discountPrice = numberOrUnknown(row.discount_price);
      observedPrice = salePrice === null ? null : discountPrice > 0 && discountPrice < salePrice ? discountPrice : salePrice;
      product = { id: row.id, sku: typeof row.sku === 'string' ? row.sku : null, name: text(row.name, 500) };
    }
    if (selectedWarehouses.length === 1) warehouse = { id: selectedWarehouses[0].id };
    if (product && warehouse) {
      const balances = catalogFacts.inventoryBalances.filter(row => row.product_id === product.id && row.warehouse_id === warehouse.id);
      if (balances.length === 1) stock = numberOrUnknown(balances[0].quantity);
    }
  }
  if (!product) add('verified_product_selection_required');
  if (!warehouse) add('verified_warehouse_selection_required');
  if (observedPrice === null) add('price_unknown');
  if (stock === null) add('stock_unknown');
  else if (order.quantity && stock < order.quantity) add('insufficient_observed_stock');
  const sourceEventKey = 'messenger-review-v1:' + await digest([
    authorization.organizationId, page.id, page.external_page_id, payload.message.externalId,
  ]);
  const reviewFingerprint = await digest([page.external_page_id, payload.customer.externalId, customerName,
    payload.message.externalId, occurredAt, messageText, attachments, order.intent, productReference,
    order.quantity, normalizedPhone, address, order.needsHumanReview]);
  return {
    schemaVersion: 'momo.erp.messenger-order-review.v1', mode: 'dry-run',
    source: { synthetic: true, excludedFromProductionAccounting: true, organizationId: authorization.organizationId,
      erpPageId: page.id, externalPageId: page.external_page_id, externalCustomerId: payload.customer.externalId,
      externalMessageId: payload.message.externalId, occurredAt: new Date(occurredAt).toISOString(), sourceEventKey, reviewFingerprint },
    reviewDraft: { customerDisplayName: customerName, phone: normalizedPhone, deliveryAddress: address,
      productReference, quantity: order.quantity, selectedProduct: product, selectedWarehouse: warehouse,
      observedUnitPrice: observedPrice, observedStock: stock, catalogObservedAt },
    readiness: { eligibleForReview: order.intent === 'order', fieldAlignmentComplete: blockers.length === 0,
      blockers, humanApprovalRequired: true, canCreateOrder: false, canSendReply: false },
    coreContract: { rpc: 'core_create_order', requestId: null, requestPayloadPrepared: false,
      pricesResolvedByServer: true, stockRecheckedByServer: true, paymentStatusInferred: false,
      next: 'Authorized human review must create a separate stable request_id and explicit product/warehouse selection; synthetic data must not create a production order.' },
    effects: { externalErpWrites: 0, metaSends: 0, productionWrites: 0 },
  };
}
