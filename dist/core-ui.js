/* Production operational UI. Empty/unavailable are visible states, never demos. */
(function () {
  'use strict';
  const h = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const labelDate = value => value ? new Date(value).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const deliveryLabels = { pending: 'Хүлээгдэж буй', assigned: 'Хуваарилсан', in_transit: 'Замд', delivered: 'Хүргэгдсэн', failed: 'Амжилтгүй', returned: 'Буцсан' };
  const q = selector => document.querySelector(selector);
  const set = (selector, value) => { const element = q(selector); if (element) element.textContent = value ?? '—'; };
  window.addEventListener('momo:core-ready', () => {
    const service = new window.MomoCoreService(window.nexerpAuth);
    const format = window.MomoCoreFormat;
    let state = null, loading = false;
    const rawOrder = id => state?.orders.find(item => item.id === id);
    const rawLead = id => state?.leads.find(item => item.id === id);
    const activeWarehouses = () => (state?.warehouses ?? []).filter(item => item.is_active);
    const orderWarehouses = () => state?.orderOptions?.warehouses ?? activeWarehouses();
    const identity = form => form.dataset.requestId ||= crypto.randomUUID();
    const option = (value, label, selected = false) => `<option value="${h(value)}"${selected ? ' selected' : ''}>${h(label)}</option>`;
    const empty = (columns, key) => `<tr><td colspan="${columns}">${state?.errors[key] ? 'Мэдээллийг уншиж чадсангүй. Дахин ачаална уу.' : 'Бүртгэл алга.'}</td></tr>`;
    const can = code => service.can(code);
    const busy = async (form, action) => {
      if (form.dataset.pending === 'true') return;
      form.dataset.pending = 'true'; const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      try { await action(); }
      catch (error) { showToast(error.message || 'Хүсэлт амжилтгүй.', 'error'); }
      finally { form.dataset.pending = 'false'; if (submit) submit.disabled = false; }
    };
    const modal = document.createElement('div');
    modal.id = 'core-action-modal'; modal.className = 'modal-backdrop'; modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2 id="core-action-title"></h2><button type="button" class="icon-btn" data-core-close aria-label="Хаах">×</button></div><form id="core-action-form"><div class="form-grid" id="core-action-fields"></div><div class="modal-actions"><button type="button" class="btn secondary" data-core-close>Болих</button><button type="submit" class="btn primary">Хадгалах</button></div></form></div>';
    document.body.appendChild(modal);
    const close = () => { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); };
    modal.querySelectorAll('[data-core-close]').forEach(button => { button.onclick = close; });
    modal.onclick = event => { if (event.target === modal) close(); };
    const openAction = (title, fields, action) => {
      const form = q('#core-action-form'); form.reset(); delete form.dataset.requestId;
      set('#core-action-title', title); q('#core-action-fields').innerHTML = fields;
      form.onsubmit = event => { event.preventDefault(); busy(form, async () => { await action(new FormData(form), identity(form)); close(); await refresh(); showToast('Мэдээлэл хадгалагдлаа.'); }); };
      modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
    };
    function exportRows(rows, filename) {
      const cell = value => { let text = String(value ?? ''); if (/^[\s]*[=+\-@]/u.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
      const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
      const csv = '\uFEFF' + [keys.map(cell).join(','), ...rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\r\n');
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
    function salePrice(item) {
      const discount = Number(item.discount_price), price = Number(item.sale_price);
      return discount > 0 && discount < price ? discount : price;
    }
    function displayProduct(item, stock, category) {
      return { ...item, price: salePrice(item),
        discountPrice: Number(item.discount_price), cost: Number(item.cost_price), stock: stock[item.id] ?? null,
        category: category ?? 'Ангилалгүй' };
    }
    function mapRows() {
      const categories = new Map(state.categories.map(item => [item.id, item.name]));
      const pages = new Map(state.pages.map(item => [item.id, item.name]));
      products = state.products.filter(item => item.is_active).map(item =>
        displayProduct(item, state.productStock, categories.get(item.category_id)));
      orders = state.orders.map(item => ({ ...item, databaseId: item.id, displayId: `ORD-${item.order_number}`, customer: item.customer_name, phone: item.phone_normalized,
        product: (item.order_items ?? []).map(line => `${line.products?.name ?? line.product_id} × ${line.quantity}`).join(', '), amount: Number(item.collect_amount),
        productAmount: Number(item.product_total), statusLabel: format.orderLabels[item.status], address: item.delivery_address, date: labelDate(item.created_at),
        dateKey: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date(item.created_at)) }));
      leads = state.leads.map(item => ({ ...item, customer: item.customer_name, phone: item.phone_normalized, page: pages.get(item.facebook_page_id) ?? 'Гараар',
        product: item.product?.name ?? item.product_id ?? 'Сонгоогүй', productId: item.product_id,
        operator: users.find(user => user.id === item.assigned_operator_id)?.firstName ?? (item.assigned_operator_id ? 'Хуваарилагдсан ажилтан' : 'Хуваарилаагүй'),
        statusLabel: format.leadLabels[item.status], created: labelDate(item.created_at), attempts: item.call_attempts, lastCall: item.last_called_at,
      }));
    }
    renderOrders = function (list = orders) {
      const row = (item, full) => `<tr>${full ? '<td></td>' : ''}<td class="order-id">${h(item.displayId)}</td><td><strong>${h(item.customer)}</strong><small>${h(item.phone)}</small></td><td>${h(full ? item.address : item.product)}</td><td>${h(money(item.amount))}</td><td><span class="status ${h(item.status)}">${h(item.statusLabel)}</span></td><td>${h(item.date)}</td><td>${can('orders.update') || can('orders.cancel') ? `<button class="btn secondary" data-core-order="${h(item.id)}">Засах</button>` : ''}</td></tr>`;
      q('#recent-orders').innerHTML = list.slice(0, 5).map(item => row(item, false)).join('') || empty(7, 'orders');
      q('#orders-table').innerHTML = list.map(item => row(item, true)).join('') || empty(8, 'orders');
      set('#all-count', state?.totals.orders ?? orders.length); set('#order-badge', state?.totals.orders ?? orders.length);
      set('#result-count', `${list.length} харагдаж байна${state?.limited.orders ? ' · сүүлийн 500 бүртгэл' : ''}`);
      q('#view-orders').querySelectorAll('[data-order-count]').forEach(node => { node.textContent = state?.summary?.statusCounts?.[node.dataset.orderCount] ?? orders.filter(item => item.status === node.dataset.orderCount).length; });
      document.querySelectorAll('[data-core-order]').forEach(button => { button.onclick = () => {
        const item = rawOrder(button.dataset.coreOrder);
        const terminal = ['delivered', 'cancelled'].includes(item.status);
        const statuses = Object.keys(format.orderLabels).filter(status => {
          if (terminal && status !== item.status) return false;
          if (status === 'cancelled') return can('orders.cancel');
          return can('orders.update') && (status === item.status || !['in_transit', 'delivered'].includes(status) || can('deliveries.manage'));
        });
        if (!statuses.length) { showToast('Энэ эцсийн төлөвийг засах эрх байхгүй.', 'error'); return; }
        openAction(`${item.order_number} — төлөв`, `<label class="full">Төлөв<select name="status">${statuses.map(status => option(status, format.orderLabels[status], status === item.status)).join('')}</select></label><label class="full">Тэмдэглэл<textarea name="note">${h(item.note)}</textarea></label>`, data => service.updateOrder(item, data.get('status'), data.get('note')));
      }; });
    };
    filter = function () {
      const search = q('#order-search').value.toLocaleLowerCase('mn'), status = q('#status-filter').value;
      renderOrders(orders.filter(item => (!status || item.statusLabel === status) && `${item.displayId} ${item.customer} ${item.phone} ${item.product} ${item.address}`.toLocaleLowerCase('mn').includes(search)));
    };
    q('#order-search').oninput = filter; q('#status-filter').onchange = filter;
    let catalogRows = [], catalogRequest = 0, editingProduct = null;
    renderProducts = async function (page = 1) {
      const request = ++catalogRequest;
      productPage = page;
      const grid = q('#product-grid');
      catalogRows = [];
      grid.textContent = 'Барааны мэдээллийг уншиж байна…';
      set('#catalog-count', '—'); set('#product-page', '—');
      q('#product-prev').disabled = q('#product-next').disabled = true;
      if (!can('products.read')) { grid.textContent = 'Бараа харах эрхгүй.'; return; }
      let result;
      try {
        result = await service.loadCatalogPage({ page, pageSize: productPageSize,
          search: q('#product-search').value.trim(), categoryId: q('#category-filter').value });
      } catch (error) {
        if (request !== catalogRequest) return;
        if (page > 1 && error.code === 'PGRST103') return renderProducts(1);
        grid.textContent = error.message || 'Барааны мэдээлэл уншихад алдаа гарлаа.';
        return;
      }
      if (request !== catalogRequest) return;
      const pages = Math.max(1, Math.ceil(result.total / productPageSize));
      if (page > pages) return renderProducts(pages);
      catalogRows = result.rows.map(item => displayProduct(item, result.productStock, item.category?.name));
      grid.innerHTML = catalogRows.map(item => `<article class="product-card"><div class="product-body"><h3>${h(item.name)}</h3><p>${h(item.sku)}</p><div class="product-meta">${h(item.category)}</div><div class="product-price"><strong>${h(money(item.price))}</strong><span>${item.stock === null ? 'Үлдэгдэл харах эрхгүй/боломжгүй' : h(item.stock) + ' ш'}</span></div>${can('products.manage') ? `<button class="btn secondary" data-edit-product="${h(item.id)}">Засах</button><button class="btn secondary" data-archive-product="${h(item.id)}">Идэвхгүй болгох</button>` : ''}</div></article>`).join('') || '<p class="empty-products">Бараа олдсонгүй.</p>';
      set('#catalog-count', `${result.total} бараа`); set('#product-page', `${productPage} / ${pages}`);
      q('#product-prev').disabled = productPage === 1; q('#product-next').disabled = productPage === pages;
      document.querySelectorAll('[data-edit-product]').forEach(button => { button.onclick = () => openProductModal(button.dataset.editProduct); });
      document.querySelectorAll('[data-archive-product]').forEach(button => { button.onclick = async () => {
        const item = catalogRows.find(product => product.id === button.dataset.archiveProduct);
        button.disabled = true; try { await service.saveProduct({ ...item, expected_updated_at: item.updated_at, is_active: false }); await refresh(); showToast('Бараа идэвхгүй боллоо.'); } catch (error) { showToast(error.message, 'error'); button.disabled = false; }
      }; });
    };
    q('#product-prev').onclick = () => renderProducts(productPage - 1);
    q('#product-next').onclick = () => renderProducts(productPage + 1);
    q('#product-search').oninput = () => renderProducts(1);
    q('#category-filter').onchange = () => renderProducts(1);

    function renderInventory() {
      const inventoryProducts = products.filter(item => item.stock !== null).sort((a, b) => a.stock - b.stock);
      q('#inventory-list').innerHTML = inventoryProducts.slice(0, 30).map(item => `<div class="inventory-item"><div><strong>${h(item.name)}</strong><small>${h(item.sku)}</small></div><b>${h(item.stock)} ш</b></div>`).join('') || '<p>Үлдэгдлийн мэдээлэл алга эсвэл унших боломжгүй.</p>';
      set('#product-count', state?.summary?.inventory?.products ?? state?.totals.products); set('#out-count', state?.summary?.inventory?.outOfStock); set('#stock-value', state?.summary?.inventory?.stockCost == null ? '—' : money(state.summary.inventory.stockCost));
    };
    let orderSelection = null;
    function updateOrderAmount() {
      setOrderAmount(orderSelection ? salePrice(orderSelection) * Number(orderForm.elements.quantity.value || 1) : '');
    }
    orderForm.elements.quantity.oninput = updateOrderAmount;
    function bindProductPicker(input, results, label, onSelection) {
      let revision = 0, timer;
      const form = input.form;
      function clear() {
        revision++;
        clearTimeout(timer);
        results.replaceChildren();
        results.classList.remove('open');
        form.elements.productId.value = '';
        input.setCustomValidity('');
        set(label, 'Бараа сонгоогүй байна.');
        onSelection(null);
      }
      function pick(item) {
        clear();
        form.elements.productId.value = item.id;
        input.value = item.name;
        set(label, `${item.name} · ${item.sku}`);
        onSelection(item);
      }
      form.addEventListener('reset', clear);
      input.oninput = () => {
        clear();
        const search = input.value.trim(), request = revision;
        if (input.value) input.setCustomValidity('Жагсаалтаас бараа сонгоно уу.');
        if (search.length < 2) return;
        timer = setTimeout(async () => {
          try {
            const rows = await service.searchProducts(search);
            if (revision !== request) return;
            results.innerHTML = rows.map(item => `<button type="button" data-product-result="${h(item.id)}"><strong>${h(item.name)} · ${h(item.sku)}</strong><span>${h(money(salePrice(item)))}</span></button>`).join('') || '<p>Бараа олдсонгүй.</p>';
            results.querySelectorAll('button').forEach((button, index) => { button.onclick = () => pick(rows[index]); });
          } catch (error) {
            if (revision !== request) return;
            results.textContent = error.message || 'Барааны хайлт амжилтгүй.';
          }
          results.classList.add('open');
        }, 180);
      };
      return pick;
    }
    const pickOrderProduct = bindProductPicker(orderProductSearch, orderProductResults, '#selected-order-product', item => {
      orderSelection = item;
      updateOrderAmount();
    });
    bindProductPicker(leadProductSearch, leadProductResults, '#selected-lead-product', () => {});
    openProductModal = function (id) {
      editingProduct = id ? catalogRows.find(item => item.id === id) : null;
      if (id && !editingProduct) return;
      const item = editingProduct;
      productForm.reset();
      const fields = productForm.elements;
      if (item?.category_id && !Array.from(fields.category_id.options).some(entry => entry.value === item.category_id)) {
        fields.category_id.add(new Option(item.category, item.category_id));
      }
      for (const [key, value] of Object.entries({ id, name: item?.name, sku: item?.sku,
        category_id: item?.category_id, stock: item ? item.stock : 0, price: item?.sale_price ?? 0,
        discountPrice: item?.discountPrice ?? 0, cost: item?.cost ?? 0 })) {
        fields.namedItem(key).value = value ?? '';
      }
      set('#product-modal-title', id ? 'Бараа засах' : 'Шинэ бараа');
      productModal.classList.add('open'); productModal.setAttribute('aria-hidden', 'false');
      fields.namedItem('name').focus();
    };
    q('#add-product').onclick = () => openProductModal();
    productForm.onsubmit = event => { event.preventDefault(); busy(productForm, async () => {
      const data = new FormData(productForm), previous = editingProduct;
      await service.saveProduct({ id: previous?.id, expected_updated_at: previous?.updated_at, name: data.get('name'), sku: data.get('sku'),
        category_id: data.get('category_id'), sale_price: data.get('price'), discount_price: data.get('discountPrice') || 0, cost_price: data.get('cost') || 0, is_active: true });
      closeProductModal(); await refresh(); showToast('Бараа Supabase-д хадгалагдлаа.');
    }); };
    const originalOpenOrder = openModal;
    // openModal is a legacy const; use click handlers and updateLead to reset identity.
    const openOrder = leadId => { originalOpenOrder(leadId); delete orderForm.dataset.requestId; };
    document.querySelectorAll('[data-open-order]').forEach(button => { button.onclick = () => openOrder(null); });
    orderForm.onsubmit = event => { event.preventDefault(); busy(orderForm, async () => {
      const data = new FormData(orderForm);
      await service.createOrder({ request_id: identity(orderForm), customer_name: data.get('customer'), phone: data.get('phone'), delivery_address: data.get('address'),
        facebook_page_id: data.get('sourcePage'), lead_id: currentOrderLeadId, warehouse_id: data.get('warehouse_id'),
        items: [{ product_id: data.get('productId'), quantity: data.get('quantity') }], collect_amount: data.get('collectAmount'), note: data.get('note') });
      closeModal(true); currentOrderLeadId = null; await refresh(); showToast('Захиалга Supabase-д хадгалагдлаа.');
    }); };
    leadForm.onsubmit = event => { event.preventDefault(); busy(leadForm, async () => {
      const data = new FormData(leadForm), names = data.getAll('leadCustomer'), phones = data.getAll('leadPhone');
      await service.createLeads({ request_id: identity(leadForm), facebook_page_id: data.get('page'), product_id: data.get('productId'),
        contacts: names.map((name, index) => ({ customer_name: name, phone: phones[index], comment: name })) });
      closeLeadModal(); delete leadForm.dataset.requestId; await refresh(); showToast('Дугаарууд Supabase-д хадгалагдлаа.');
    }); };
    updateLead = async function (id, action, value) {
      const item = rawLead(String(id)); if (!item) return;
      if (action === 'convert') {
        showView('orders'); openOrder(item.id);
        orderForm.elements.customer.value = item.customer_name; orderForm.elements.phone.value = item.phone_normalized;
        orderForm.elements.sourcePage.value = item.facebook_page_id ?? '';
        if (item.product?.is_active) pickOrderProduct(item.product);
        return;
      }
      const status = action === 'call' ? (item.call_attempts ? 'follow_up' : 'no_answer') : Object.keys(format.leadLabels).find(key => format.leadLabels[key] === value) ?? value;
      try { await service.updateLead(item, status, { recordCall: action === 'call' }); await refresh(); showToast('Дугаарын мэдээлэл шинэчлэгдлээ.'); } catch (error) { showToast(error.message, 'error'); }
    };
    document.querySelectorAll('[data-lead-outcome]').forEach(button => { button.onclick = async () => {
      const item = rawLead(currentOrderLeadId); if (!item) return;
      const status = Object.keys(format.leadLabels).find(key => format.leadLabels[key] === button.dataset.leadOutcome);
      try { await service.updateLead(item, status, { recordCall: true }); closeModal(true); currentOrderLeadId = null; await refresh(); showView('leads'); } catch (error) { showToast(error.message, 'error'); }
    }; });
    openLeadStatusModal = function (id) {
      const item = rawLead(String(id)); if (!item) return;
      leadStatusForm.elements.leadId.value = item.id; leadStatusForm.elements.status.value = format.leadLabels[item.status];
      set('#lead-status-title', item.customer_name); q('#lead-status-summary').innerHTML = `<strong>${h(item.phone_normalized)}</strong><small>${h(item.call_attempts)} залгалт · ${h(labelDate(item.last_called_at))}</small>`;
      leadStatusModal.classList.add('open'); leadStatusModal.setAttribute('aria-hidden', 'false');
    };
    leadStatusForm.onsubmit = event => { event.preventDefault(); busy(leadStatusForm, async () => {
      const item = rawLead(leadStatusForm.elements.leadId.value), status = Object.keys(format.leadLabels).find(key => format.leadLabels[key] === leadStatusForm.elements.status.value);
      await service.updateLead(item, status); closeLeadStatusModal(); await refresh(); showToast('Төлөв хадгалагдлаа.');
    }); };
    renderLeads = function () {
      const search = q('#lead-search').value.toLocaleLowerCase('mn'), page = q('#lead-page-filter').value, status = leadStatus || q('#lead-status-filter').value;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date());
      const phones = new Map(); orders.filter(item => item.dateKey === today).forEach(item => phones.set(item.phone, (phones.get(item.phone) ?? 0) + 1));
      const duplicates = new Set([...phones].filter(([, count]) => count > 1).map(([phone]) => phone));
      const list = leads.filter(item => (!page || item.page === page) && (!status || item.statusLabel === status) && (!leadDuplicateOnly || duplicates.has(item.phone)) && `${item.customer} ${item.phone} ${item.product} ${item.comment ?? ''}`.toLocaleLowerCase('mn').includes(search));
      q('#leads-table').innerHTML = list.map(item => `<tr><td>${h(item.created)}</td><td><strong>${h(item.customer)} · ${h(item.phone)}</strong><small>${h(item.comment)}</small></td><td>${h(item.page)}</td><td>${h(item.product)}</td><td>${h(item.operator)}<small>${h(item.attempts)} залгалт</small></td><td><button class="btn secondary" data-core-lead-status="${h(item.id)}"${can('leads.update') ? '' : ' disabled'}>${h(item.statusLabel)}</button></td><td>${can('calls.create') ? `<button data-core-call="${h(item.id)}">Залгалт</button>` : ''}${can('orders.create') && item.status !== 'converted' ? `<button data-core-convert="${h(item.id)}">Захиалга</button>` : ''}</td></tr>`).join('') || empty(7, 'leads');
      const count = (...statuses) => leads.filter(item => statuses.includes(item.status)).length;
      set('#lead-total', state?.totals.leads ?? leads.length); set('#lead-new', count('new', 'no_answer', 'follow_up', 'unreachable', 'call_back')); set('#lead-converted', count('converted'));
      set('#lead-failed', count('no_answer', 'unreachable', 'follow_up', 'call_back')); set('#lead-dropped', count('dropped')); set('#lead-cancelled', count('cancelled')); set('#lead-badge', count('new')); set('#lead-count', `${list.length} дугаар${state?.limited.leads ? ' · сүүлийн 500' : ''}`);
      q('#operator-grid').innerHTML = '<p>Операторын үзүүлэлтийг зөвшөөрөгдсөн бүртгэлээс тайлангаар харна.</p>';
      set('#duplicate-count', duplicates.size);
      document.querySelectorAll('[data-core-lead-status]').forEach(button => { button.onclick = () => openLeadStatusModal(button.dataset.coreLeadStatus); });
      document.querySelectorAll('[data-core-call]').forEach(button => { button.onclick = () => updateLead(button.dataset.coreCall, 'call'); });
      document.querySelectorAll('[data-core-convert]').forEach(button => { button.onclick = () => updateLead(button.dataset.coreConvert, 'convert'); });
    };
    q('#lead-search').oninput = renderLeads; q('#lead-page-filter').onchange = renderLeads;
    renderDelivery = function () {
      const list = state?.deliveries ?? [];
      q('#delivery-table').innerHTML = list.map(item => { const order = orders.find(order => order.id === item.order_id); return `<tr><td>${h(order?.displayId ?? item.order_id)}</td><td>${h(order?.customer ?? 'Захиалгыг харах эрхгүй')}</td><td>${h(order?.address ?? '—')}</td><td>${h(users.find(user => user.id === item.courier_id)?.firstName ?? item.courier_id ?? 'Хуваарилаагүй')}</td><td>${h(labelDate(item.delivered_at ?? item.assigned_at))}</td><td>${h(deliveryLabels[item.status])}${can('deliveries.manage') ? `<button class="btn secondary" data-core-delivery="${h(item.order_id)}">Засах</button>` : ''}</td></tr>`; }).join('') || empty(6, 'deliveries');
      q('#courier-list').innerHTML = `<p>${list.filter(item => ['assigned', 'in_transit'].includes(item.status)).length} идэвхтэй хүргэлт бүртгэлтэй.</p>`;
      document.querySelectorAll('[data-core-delivery]').forEach(button => { button.onclick = () => {
        const item = list.find(delivery => delivery.order_id === button.dataset.coreDelivery);
        openAction('Хүргэлтийн төлөв', `<label class="full">Төлөв<select name="status">${Object.entries(deliveryLabels).map(([value, label]) => option(value, label, value === item.status)).join('')}</select></label><label class="full">Хүргэгч<select name="courier_id">${option('', 'Хуваарилаагүй')}${users.filter(user => user.active).map(user => option(user.id, `${user.firstName} ${user.lastName}`, user.id === item.courier_id)).join('')}</select></label><label class="full">Тэмдэглэл<textarea name="note">${h(item.note)}</textarea></label>`, data => service.updateDelivery(item, data.get('status'), data.get('courier_id'), data.get('note')));
      }; });
    };
    function renderSummary() {
      const summary = state?.summary, today = summary?.today, inventory = summary?.inventory, finance = summary?.finance;
      set('#dashboard-date', new Intl.DateTimeFormat('mn-MN', { timeZone: 'Asia/Ulaanbaatar', dateStyle: 'long' }).format(new Date()));
      set('#dashboard-sales', today?.deliveredRevenue == null ? '—' : money(today.deliveredRevenue)); set('#dashboard-orders', today?.orders); set('#dashboard-delivered', today?.delivered); set('#dashboard-low-stock', inventory?.lowStock);
      set('#dashboard-summary-note', summary ? 'Supabase-д бүртгэлтэй бодит өгөгдөл. Демо бүртгэл тооцохгүй.' : 'Тооцоог уншиж чадсангүй. Бодит үзүүлэлт баталгаажаагүй.');
      const daily = summary?.dailySales ?? [];
      q('#sales-history').innerHTML = daily.length ? '<table><thead><tr><th>Өдөр</th><th>Хүргэгдсэн барааны борлуулалт</th></tr></thead><tbody>' + daily.map(day => `<tr><td>${h(day.date)}</td><td>${h(money(day.total))}</td></tr>`).join('') + '</tbody></table>' : '<p>Борлуулалтын тооцоо алга эсвэл унших боломжгүй.</p>';
      q('#core-report-summary').innerHTML = summary && daily.length ? '<h3>Сүүлийн 7 өдрийн хүргэгдсэн борлуулалт</h3><table><thead><tr><th>Өдөр</th><th>Барааны дүн</th></tr></thead><tbody>' + daily.map(day => `<tr><td>${h(day.date)}</td><td>${h(money(day.total))}</td></tr>`).join('') + '</tbody></table><h3>Бүртгэсэн захиалгын төлөв</h3><table><tbody>' + Object.entries(summary.statusCounts ?? {}).map(([status, count]) => `<tr><td>${h(format.orderLabels[status] ?? status)}</td><td>${h(count)}</td></tr>`).join('') + '</tbody></table>' : '<p>Нийлбэр тайлан алга эсвэл унших боломжгүй.</p>';
      set('#finance-income', finance?.income == null ? '—' : money(finance.income)); set('#finance-expense', finance?.expense == null ? '—' : money(finance.expense)); set('#finance-net', finance?.netCashflow == null ? '—' : money(finance.netCashflow)); set('#finance-receivable', finance?.receivable == null ? '—' : money(finance.receivable));
      q('#finance-transactions').innerHTML = state.finance.length ? state.finance.map(item => `<div><strong>${h(item.description)}</strong><small>${h(labelDate(item.occurred_at))}</small><b>${item.entry_type === 'income' ? '+' : '−'} ${h(money(item.amount))}</b></div>`).join('') : '<p>Гүйлгээ бүртгэгдээгүй эсвэл унших боломжгүй.</p>';
      const customers = new Map();
      orders.forEach(item => { const customer = customers.get(item.phone) ?? { name: item.customer, phone: item.phone, orders: 0, deliveredSales: 0 }; customer.orders++; if (item.status === 'delivered') customer.deliveredSales += item.productAmount; customers.set(item.phone, customer); });
      leads.forEach(item => { if (!customers.has(item.phone)) customers.set(item.phone, { name: item.customer, phone: item.phone, orders: 0, deliveredSales: 0 }); });
      q('#customers-table').innerHTML = [...customers.values()].map(item => `<tr><td>${h(item.name)}</td><td>${h(item.phone)}</td><td>${h(item.orders)}</td><td>${h(money(item.deliveredSales))}</td></tr>`).join('') || empty(4, 'orders');
      set('#customer-count', `${customers.size} харилцагч · зөвшөөрөгдсөн жагсаалтын хүрээнд`);
      q('#warehouse-list').innerHTML = state.warehouses.map(item => `<div class="inventory-item"><strong>${h(item.name)}</strong><span>${item.is_active ? 'Идэвхтэй' : 'Идэвхгүй'}</span>${can('inventory.manage') ? `<button data-core-warehouse="${h(item.id)}">Засах</button>` : ''}</div>`).join('') || '<p>Агуулах бүртгэгдээгүй эсвэл унших боломжгүй.</p>';
      document.querySelectorAll('[data-core-warehouse]').forEach(button => { button.onclick = () => editWarehouse(state.warehouses.find(item => item.id === button.dataset.coreWarehouse)); });
    }
    renderMenus = function () {
      q('#report-grid').innerHTML = '<button data-core-report="orders">Захиалгын CSV</button><button data-core-report="deliveries">Хүргэлтийн CSV</button><button data-core-report="inventory">Үлдэгдлийн CSV</button><button data-core-report="finance">Мөнгөн урсгалын CSV</button>';
      const inventoryExport = q('[data-core-report="inventory"]');
      if (state?.limited.balances) inventoryExport.textContent = `Үлдэгдлийн CSV (сүүлийн ${state.balances.length} мөр)`;
      inventoryExport.disabled = !can('inventory.read') || Boolean(state?.errors.balances);
      document.querySelectorAll('[data-core-report]').forEach(button => { button.onclick = () => {
        const type = button.dataset.coreReport;
        const permission = { orders: 'orders.read', deliveries: 'deliveries.read', inventory: 'inventory.read', finance: 'finance.view' }[type];
        if (!can(permission)) { showToast('Энэ мэдээллийг унших эрхгүй.', 'error'); return; }
        const rows = { orders: orders.map(item => ({ order: item.displayId, customer: item.customer, phone: item.phone, status: item.statusLabel, total: item.productAmount, collect: item.amount, createdAt: item.created_at })),
          deliveries: state.deliveries.map(item => ({ orderId: item.order_id, status: deliveryLabels[item.status], courierId: item.courier_id, deliveredAt: item.delivered_at })),
          inventory: state.balances.map(item => ({ warehouseId: item.warehouse_id, productId: item.product_id, quantity: item.quantity })),
          finance: state.finance.map(item => ({ type: item.entry_type, amount: item.amount, description: item.description, occurredAt: item.occurred_at })) }[type];
        exportRows(rows, `momo-${type}-${new Date().toISOString().slice(0, 10)}.csv`);
      }; });
    };
    function editWarehouse(item) {
      openAction(item ? 'Агуулах засах' : 'Агуулах нэмэх', `<label class="full">Нэр<input name="name" required maxlength="200" value="${h(item?.name)}"></label><label class="full"><input type="checkbox" name="is_active" ${item?.is_active !== false ? 'checked' : ''}> Идэвхтэй</label>`, data => service.saveWarehouse({ id: item?.id, expected_updated_at: item?.updated_at, name: data.get('name'), branch_id: item?.branch_id, is_active: data.get('is_active') === 'on' }));
    }
    q('#core-add-warehouse').onclick = () => editWarehouse();
    q('#core-adjust-inventory').onclick = () => openAction('Нөөцийн хөдөлгөөн', `<label>Агуулах<select name="warehouse_id" required>${activeWarehouses().map(item => option(item.id, item.name)).join('')}</select></label><label>Бараа<select name="product_id" required>${products.map(item => option(item.id, item.name)).join('')}</select></label><label>Төрөл<select name="movement_type">${option('income', 'Орлого')}${option('adjustment', 'Тохируулга')}${option('return', 'Буцаалт')}</select></label><label>Өөрчлөх тоо<input type="number" name="quantity_delta" required step="1"></label><label class="full">Тэмдэглэл<textarea name="note" required></textarea></label>`, (data, requestId) => service.adjustInventory({ request_id: requestId, warehouse_id: data.get('warehouse_id'), product_id: data.get('product_id'), movement_type: data.get('movement_type'), quantity_delta: data.get('quantity_delta'), note: data.get('note') }));
    q('#core-add-finance').onclick = () => openAction('Мөнгөн урсгал бүртгэх', `<label>Төрөл<select name="entry_type">${option('income', 'Орлого')}${option('expense', 'Зарлага')}</select></label><label>Дүн<input name="amount" type="number" min="0.01" step="0.01" required></label><label class="full">Захиалга (шаардлагагүй)<select name="order_id">${option('', 'Захиалгатай холбохгүй')}${orders.map(item => option(item.id, `${item.displayId} · ${item.customer}`)).join('')}</select></label><label class="full">Тайлбар<textarea name="description" required maxlength="1000"></textarea></label>`, (data, requestId) => service.recordFinance({ request_id: requestId, entry_type: data.get('entry_type'), amount: data.get('amount'), order_id: data.get('order_id'), description: data.get('description') }));
    q('#core-export-finance').onclick = () => q('[data-core-report="finance"]').click();
    q('#core-add-warehouse').hidden = !can('inventory.manage'); q('#core-adjust-inventory').hidden = !can('inventory.manage'); q('#core-add-finance').hidden = !can('finance.manage'); q('#add-product').hidden = !can('products.manage'); q('#open-lead').hidden = !can('leads.create');
    // User/role management remains backed by its existing RPCs. Escape stored
    // profile/role labels before HTML interpolation, including option labels.
    refreshRoleOptions = function () {
      q('#new-user-role').innerHTML = roles.map(role => option(role.id, role.name)).join('');
      q('#user-role-filter').innerHTML = option('', 'Бүх хандах эрх') + roles.map(role => option(role.name, role.name)).join('');
    };
    renderSettings = function () {
      const search = q('#user-search').value.toLocaleLowerCase('mn'), role = q('#user-role-filter').value, manage = can('users.manage');
      const list = users.filter(user => (!role || user.role === role) && `${user.firstName} ${user.lastName} ${user.email} ${user.phone}`.toLocaleLowerCase('mn').includes(search));
      q('#users-table').innerHTML = list.map(user => {
        const own = user.id === window.nexerpAuth?.profile?.id;
        return `<tr><td><strong>${h(user.lastName)} ${h(user.firstName)}</strong><small>${h(user.email)}</small></td><td>${h(user.phone)}</td><td>${h(user.department)}<small>${h(user.position)}</small></td><td>${manage && !own ? `<select data-safe-role="${h(user.id)}">${roles.map(role => option(role.id, role.name, role.id === user.roleId)).join('')}</select>` : h(user.role)}</td><td>${user.active ? 'Идэвхтэй' : 'Идэвхгүй'}</td><td>${manage && !own ? `<button data-safe-toggle="${h(user.id)}">Төлөв солих</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="6">Хэрэглэгчийн мэдээлэл алга эсвэл уншигдаагүй.</td></tr>';
      set('#user-count', `${list.length} хэрэглэгч`);
      q('#role-grid').innerHTML = roles.map(role => `<article class="role-card"><h3>${h(role.name)}</h3><p>${h(role.description)}</p><small>${h(role.permissions.length)} зөвшөөрөл</small>${manage && !role.locked ? `<button class="btn secondary" data-safe-edit-role="${h(role.id)}">Засах</button>` : ''}</article>`).join('');
      document.querySelectorAll('[data-safe-role]').forEach(select => { select.onchange = async () => {
        const previous = users.find(user => user.id === select.dataset.safeRole)?.roleId; select.disabled = true;
        try { const { error } = await service.client.rpc('assign_user_role', { target_user_id: select.dataset.safeRole, target_role_id: select.value }); if (error) throw new Error('Хандах эрх хадгалагдсангүй.'); await loadUserManagementData(); showToast('Хандах эрх шинэчлэгдлээ.'); }
        catch (error) { select.value = previous ?? ''; select.disabled = false; showToast(error.message, 'error'); }
      }; });
      document.querySelectorAll('[data-safe-toggle]').forEach(button => { button.onclick = async () => { button.disabled = true; await toggleSupabaseUser(users.find(user => user.id === button.dataset.safeToggle)); button.disabled = false; }; });
      document.querySelectorAll('[data-safe-edit-role]').forEach(button => { button.onclick = () => openRoleModal(roles.find(role => role.id === button.dataset.safeEditRole)); });
    };
    refreshRoleOptions(); renderSettings();
    async function refresh() {
      if (loading) return;
      loading = true; set('#core-data-status', 'Supabase мэдээллийг уншиж байна…'); q('#core-refresh').disabled = true;
      try {
        state = await service.loadSnapshot(); window.momoCoreUi.snapshot = state;
        mapRows();
        const categoryFilter = q('#category-filter'), selectedCategory = categoryFilter.value;
        categoryFilter.innerHTML = option('', 'Бүх ангилал') + option('uncategorized', 'Ангилалгүй')
          + state.categories.map(item => option(item.id, item.name)).join('');
        categoryFilter.value = selectedCategory;
        if (categoryFilter.selectedIndex < 0) categoryFilter.value = '';
        productForm.elements.category_id.innerHTML = option('', 'Ангилалгүй') + state.categories.map(item => option(item.id, item.name)).join('');
        const pageOptions = option('', 'Гараар / Page сонгоогүй') + state.pages.filter(item => item.is_active).map(item => option(item.id, item.name)).join('');
        orderForm.elements.sourcePage.innerHTML = pageOptions; leadForm.elements.page.innerHTML = pageOptions;
        orderForm.elements.warehouse_id.innerHTML = option('', 'Агуулах сонгох') + orderWarehouses().map(item => option(item.id, item.name)).join('');
        q('#lead-page-filter').innerHTML = option('', 'Бүх Facebook Page') + state.pages.map(item => option(item.name, item.name)).join('');
        renderOrders(); renderInventory(); renderLeads(); renderDelivery(); renderSummary(); renderMenus(); icons();
        renderProducts(productPage);
        const errors = Object.entries(state.errors);
        set('#core-data-status', errors.length ? `Зарим мэдээлэл уншигдсангүй: ${errors.map(([key]) => key).join(', ')}. ${errors[0][1].message}` : 'Supabase · бодит өгөгдөл · ' + labelDate(state.loadedAt));
        q('#core-data-status').setAttribute('role', errors.length ? 'alert' : 'status');
      } catch (error) { set('#core-data-status', error.message || 'Мэдээлэл уншиж чадсангүй.'); }
      finally { loading = false; q('#core-refresh').disabled = false; }
    }
    window.momoCoreUi = { refresh, snapshot: null, service };
    q('#core-refresh').onclick = refresh;
    refresh();
  }, { once: true });
})();
