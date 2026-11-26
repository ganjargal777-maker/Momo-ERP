/* Authenticated ERP data access. This module never reads operational localStorage
 * or bundled catalogs. Client permissions control UI only; RPC/RLS authorize. */
(function (global) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const phone = value => String(value ?? '').replace(/\D/gu, '').replace(/^976(?=\d{8}$)/u, '');
  const text = value => String(value ?? '').trim();
  const orderLabels = { new: 'Шинэ', preparing: 'Бэлтгэж буй', in_transit: 'Замд', delivered: 'Хүргэгдсэн', cancelled: 'Цуцалсан' };
  const leadLabels = { new: 'Шинэ', no_answer: 'Утас аваагүй', unreachable: 'Холбогдох боломжгүй', follow_up: 'Дахин холбогдох', call_back: 'Эргээд залгах', converted: 'Захиалга болсон', dropped: 'Авахаа больсон', cancelled: 'Цуцалсан', other: 'Бусад' };
  function fail(message) { throw new Error(message); }
  function uuid(value, nullable = false) {
    if (nullable && (value === '' || value == null)) return null;
    if (typeof value !== 'string' || !UUID.test(value)) fail('Бүртгэлийн дугаар буруу. Мэдээллээ шинэчилнэ үү.');
    return value;
  }
  function number(value, { integer = false, min = 0, max = 999999999999 } = {}) {
    if (value === '' || value === null || value === undefined) fail('Тоон утга шаардлагатай.');
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isSafeInteger(parsed))) fail('Тоон утга зөвшөөрөгдөх хязгаарт нийцээгүй.');
    return parsed;
  }
  function required(value, max = 500) {
    const parsed = text(value);
    if (!parsed || parsed.length > max) fail('Шаардлагатай мэдээллийг бүрэн, зөв оруулна уу.');
    return parsed;
  }
  const friendly = error => {
    const code = error?.code ?? 'request_failed';
    const messages = {
      PGRST202: 'Backend-ийн шаардлагатай шинэчлэлт хараахан нэвтрээгүй байна.',
      PGRST205: 'Backend-ийн шаардлагатай хүснэгт хараахан нэвтрээгүй байна.',
      '42501': 'Энэ үйлдлийг хийх эрх байхгүй эсвэл эрх өөрчлөгдсөн байна.',
      '23505': 'Ижил бүртгэл байна. Хадгалсан мэдээллээ шалгана уу.',
      '23514': 'Мэдээлэл бизнесийн шалгалтад нийцээгүй байна.',
      '40001': 'Бүртгэл өөрчлөгдсөн байна. Шинэ төлөв уншаад дахин шалгана уу.',
      'P0002': 'Бүртгэл олдсонгүй эсвэл танд хандах эрх байхгүй.',
    };
    return Object.assign(new Error(messages[code] ?? 'Хүсэлт амжилтгүй. Холболт, эрх болон шинэ төлөвийг шалгана уу. Хадгалах үйлдлийг шинэ дугаараар бүү давтаарай.'), { code });
  };
  function filterProductSearch(query, search) {
    const term = text(search);
    if (!term) return query;
    // PostgreSQL literal regex mode and separate PostgREST value quoting.
    const literal = '"(?q)' + term.replace(/["\\]/gu, '\\$&') + '"';
    return query.or('name.imatch.' + literal + ',sku.imatch.' + literal);
  }
  const pickerColumns = 'id,name,sku,sale_price,discount_price,is_active';
  class MomoCoreService {
    constructor(auth) {
      if (!auth?.client || !UUID.test(auth.profile?.organizationId ?? auth.profile?.organization_id ?? '')) fail('Идэвхтэй байгууллагын Supabase холболт шаардлагатай.');
      this.auth = auth;
      this.client = auth.client;
      this.organizationId = auth.profile.organizationId ?? auth.profile.organization_id;
    }
    can(permission) { return this.auth.can?.(permission) === true; }
    async rpc(name, parameters) {
      let result;
      try { result = await this.client.rpc(name, parameters); } catch (error) { throw friendly(error); }
      if (result?.error) throw friendly(result.error);
      if (result?.data === undefined || result?.data === null) throw friendly({ code: 'empty_response' });
      return result.data;
    }
    async read(table, columns = '*', { production = false, limit = 500 } = {}) {
      let query = this.client.from(table).select(columns, { count: 'exact' }).eq('organization_id', this.organizationId);
      if (production) query = query.eq('is_demo', false);
      const timestampColumn = { inventory_balances: 'updated_at', call_logs: 'called_at' }[table] ?? 'created_at';
      const { data, error, count } = await query.order(timestampColumn, { ascending: false }).limit(limit);
      if (error) throw friendly(error);
      if (!Array.isArray(data)) throw friendly({ code: 'invalid_response' });
      return { rows: data, total: Number.isSafeInteger(count) ? count : null, limited: count !== null && count > data.length };
    }
    loadOrderExport() {
      return this.#readExport('orders.read', 'orders', 'order_number',
        'order_number::text,customer_name,phone_normalized,status,product_total,collect_amount,created_at');
    }
    loadDeliveryExport() {
      return this.#readExport('deliveries.read', 'core_delivery_export', 'order_id',
        'order_id,status,courier_id,delivered_at');
    }
    async #readExport(permission, table, cursor, columns) {
      const rows = [];
      let before = null, total;
      do {
        if (!this.can(permission)) throw friendly({ code: '42501' });
        let query = this.client.from(table).select(columns, before === null ? { count: 'exact' } : {})
          .eq('organization_id', this.organizationId);
        if (table === 'orders') query = query.eq('is_demo', false);
        if (before !== null) query = query.lt(cursor, before);
        const { data, error, count } = await query.order(cursor, { ascending: false }).limit(500);
        if (error) throw friendly(error);
        if (before === null) total = count;
        if (!Array.isArray(data) || !Number.isSafeInteger(total) || total < 0) throw friendly({ code: 'invalid_response' });
        if ((!data.length && rows.length < total) || rows.length + data.length > total) throw friendly({ code: '40001' });
        rows.push(...data);
        if (data.length) before = data[data.length - 1][cursor];
      } while (rows.length < total);
      return rows;
    }
    async loadProductStock(products) {
      const ids = products.filter(product => product.is_active).map(product => product.id);
      if (!ids.length || !this.can('inventory.read') || !this.can('products.read')) return {};
      const rows = await this.rpc('core_product_stock', { product_ids: ids });
      if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row?.quantity) || row.quantity < 0 || !UUID.test(row.product_id))) {
        throw friendly({ code: 'invalid_response' });
      }
      return Object.fromEntries(rows.map(row => [row.product_id, row.quantity]));
    }
    async searchProducts(search) {
      if (!this.can('products.read')) throw friendly({ code: '42501' });
      if (text(search).length < 2) return [];
      const query = this.client.from('products').select(pickerColumns)
        .eq('organization_id', this.organizationId).eq('is_active', true);
      const { data, error } = await filterProductSearch(query, search)
        .order('name', { ascending: true }).order('id', { ascending: true }).limit(30);
      if (error) throw friendly(error);
      if (!Array.isArray(data)) throw friendly({ code: 'invalid_response' });
      return data;
    }
    async loadCatalogPage({ page = 1, pageSize = 24, search = '', categoryId = '' } = {}) {
      if (!this.can('products.read')) throw friendly({ code: '42501' });
      const offset = (page - 1) * pageSize;
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500 || !Number.isSafeInteger(offset + pageSize)) {
        fail('Хуудасны дугаар эсвэл хэмжээ буруу байна.');
      }
      let query = this.client.from('products').select('*,category:categories(name)', { count: 'exact' })
        .eq('organization_id', this.organizationId).eq('is_active', true);
      if (categoryId === 'uncategorized') query = query.is('category_id', null);
      else if (categoryId) query = query.eq('category_id', uuid(categoryId));
      query = filterProductSearch(query, search);
      const { data, count, error } = await query.order('name', { ascending: true })
        .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
      if (error) throw friendly(error);
      if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) throw friendly({ code: 'invalid_response' });
      const result = { rows: data, total: count, productStock: {}, stockError: null };
      try { result.productStock = await this.loadProductStock(data); }
      catch (stockError) { result.stockError = { code: stockError.code, message: stockError.message }; }
      return result;
    }
    async loadSnapshot() {
      const definitions = [
        ['products', 'products.read', 'products', '*'],
        ['categories', 'products.read', 'categories', 'id,name,organization_id,created_at'],
        ['warehouses', 'inventory.read', 'warehouses', '*'],
        ['balances', 'inventory.read', 'inventory_balances', '*'],
        ['movements', 'inventory.read', 'inventory_movements', '*'],
        ['orders', 'orders.read', 'orders', '*,order_items(id,product_id,quantity,unit_price,line_total,products(name,sku))', true],
        ['leads', 'leads.read', 'leads', this.can('products.read') ? `*,product:products(${pickerColumns})` : '*', true],
        ['calls', 'leads.read', 'call_logs', '*'],
        ['deliveries', 'deliveries.read', 'deliveries', '*'],
        // Never select Page token/credential-reference columns.
        ['pages', 'pages.read', 'facebook_pages', 'id,name,is_active,organization_id,created_at'],
        ['finance', 'finance.view', 'finance_entries', '*', true],
      ];
      const snapshot = { source: 'supabase', loadedAt: new Date().toISOString(), errors: {}, totals: {}, limited: {}, summary: null, orderOptions: { warehouses: [] } };
      await Promise.all(definitions.map(async ([key, permission, table, columns, production]) => {
        snapshot[key] = [];
        if (!this.can(permission)) return;
        try {
          const result = await this.read(table, columns, { production });
          snapshot[key] = result.rows;
          snapshot.totals[key] = result.total;
          snapshot.limited[key] = result.limited;
        } catch (error) { snapshot.errors[key] = { code: error.code, message: error.message }; }
      }));
      snapshot.productStock = {};
      try { snapshot.productStock = await this.loadProductStock(snapshot.products); }
      catch (error) { snapshot.errors.productStock = { code: error.code, message: error.message }; }
      if (['dashboard.view', 'reports.view', 'finance.view'].some(permission => this.can(permission))) {
        try { snapshot.summary = await this.rpc('core_dashboard_summary'); }
        catch (error) { snapshot.errors.summary = { code: error.code, message: error.message }; }
      }
      if (this.can('orders.create')) {
        try { snapshot.orderOptions = await this.rpc('core_order_options'); }
        catch (error) { snapshot.errors.orderOptions = { code: error.code, message: error.message }; }
      }
      snapshot.status = Object.keys(snapshot.errors).length ? 'partial' : 'ready';
      return snapshot;
    }
    saveProduct(input) {
      const payload = {
        sku: required(input.sku, 128), name: required(input.name, 300),
        category_id: uuid(input.category_id, true), sale_price: number(input.sale_price),
        discount_price: number(input.discount_price ?? 0), cost_price: number(input.cost_price ?? 0), is_active: input.is_active !== false,
      };
      if (input.id) { payload.id = uuid(input.id); payload.expected_updated_at = required(input.expected_updated_at, 64); }
      return this.rpc('core_save_product', { payload });
    }
    saveWarehouse(input) {
      const payload = { name: required(input.name, 200), branch_id: uuid(input.branch_id, true), is_active: input.is_active !== false };
      if (input.id) { payload.id = uuid(input.id); payload.expected_updated_at = required(input.expected_updated_at, 64); }
      return this.rpc('core_save_warehouse', { payload });
    }
    adjustInventory(input) {
      const quantity = number(input.quantity_delta, { integer: true, min: -1000000, max: 1000000 });
      if (quantity === 0 || !['income', 'adjustment', 'return'].includes(input.movement_type)) fail('Нөөцийн хөдөлгөөн болон тоо буруу.');
      return this.rpc('core_adjust_inventory', { payload: {
        request_id: uuid(input.request_id), warehouse_id: uuid(input.warehouse_id), product_id: uuid(input.product_id),
        quantity_delta: quantity, movement_type: input.movement_type, note: text(input.note).slice(0, 1000),
      } });
    }
    createOrder(input) {
      const normalizedPhone = phone(input.phone);
      if (!/^\d{8}$/u.test(normalizedPhone)) fail('Утасны дугаар 8 оронтой байна.');
      if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) fail('Захиалгын бараа шаардлагатай.');
      return this.rpc('core_create_order', { payload: {
        request_id: uuid(input.request_id), customer_name: required(input.customer_name, 200), phone: normalizedPhone,
        delivery_address: required(input.delivery_address, 1000), facebook_page_id: uuid(input.facebook_page_id, true),
        lead_id: uuid(input.lead_id, true), branch_id: uuid(input.branch_id, true), warehouse_id: uuid(input.warehouse_id),
        items: input.items.map(item => ({ product_id: uuid(item.product_id), quantity: number(item.quantity, { integer: true, min: 1, max: 1000000 }) })),
        ...(input.collect_amount === undefined ? {} : { collect_amount: number(input.collect_amount) }), note: text(input.note).slice(0, 1000),
      } });
    }
    updateOrder(order, status, note = '') {
      if (!Object.hasOwn(orderLabels, status)) fail('Захиалгын төлөв буруу.');
      return this.rpc('core_update_order', { target_order: uuid(order.id), payload: { status, note: text(note).slice(0, 1000), expected_updated_at: required(order.updated_at, 64) } });
    }
    createLeads(input) {
      if (!Array.isArray(input.contacts) || !input.contacts.length || input.contacts.length > 100) fail('1–100 утасны дугаар оруулна уу.');
      const contacts = input.contacts.map(item => {
        const normalized = phone(item.phone);
        if (!/^\d{8}$/u.test(normalized)) fail('Утасны дугаар 8 оронтой байна.');
        return { customer_name: required(item.customer_name || 'Нэргүй', 200), phone: normalized, comment: text(item.comment).slice(0, 1000) };
      });
      return this.rpc('core_create_leads', { payload: { request_id: uuid(input.request_id), facebook_page_id: uuid(input.facebook_page_id, true), product_id: uuid(input.product_id, true), contacts } });
    }
    updateLead(lead, status, { recordCall = false, note = '' } = {}) {
      if (!Object.hasOwn(leadLabels, status) || status === 'converted') fail('Захиалга болсон төлөвийг захиалга үүсгэх үйлдлээр бүртгэнэ.');
      return this.rpc('core_update_lead', { target_lead: uuid(lead.id), payload: { status, record_call: recordCall, note: text(note).slice(0, 1000), expected_updated_at: required(lead.updated_at, 64) } });
    }
    updateDelivery(delivery, status, courierId = null, note = '') {
      if (!['pending', 'assigned', 'in_transit', 'delivered', 'failed', 'returned'].includes(status)) fail('Хүргэлтийн төлөв буруу.');
      return this.rpc('core_update_delivery', { target_order: uuid(delivery.order_id), payload: { status, courier_id: uuid(courierId, true), note: text(note).slice(0, 1000), expected_updated_at: required(delivery.updated_at, 64) } });
    }
    recordFinance(input) {
      if (!['income', 'expense'].includes(input.entry_type)) fail('Гүйлгээний төрөл буруу.');
      return this.rpc('core_record_finance', { payload: { request_id: uuid(input.request_id), entry_type: input.entry_type,
        amount: number(input.amount, { min: 0.01 }), description: required(input.description, 1000), order_id: uuid(input.order_id, true),
        ...(input.occurred_at ? { occurred_at: required(input.occurred_at, 64) } : {}),
      } });
    }
  }
  global.MomoCoreService = MomoCoreService;
  global.MomoCoreFormat = Object.freeze({ phone, orderLabels: Object.freeze(orderLabels), leadLabels: Object.freeze(leadLabels) });
})(window);
