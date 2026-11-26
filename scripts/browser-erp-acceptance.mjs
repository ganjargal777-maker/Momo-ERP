// Real Chromium -> real local GoTrue/PostgREST/Postgres. Synthetic data only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import { startBrowserStack } from '../test/helpers/local-browser-stack.mjs';
import { createInviteHandler } from '../supabase/functions/invite-user/handler.mjs';

const root = resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

export async function runBrowserAcceptance({ dockerBin, chromiumPath, reportPath,
  existingLocalStack = null } = {}) {
  const checks = [], pageErrors = [], failedResponses = [], localSecrets = [], invitationTrace = [];
  const safeMessage = value => localSecrets.reduce((text, secret) => secret ? text.replaceAll(secret, '[REDACTED]') : text, String(value)).replace(/https?:\/\/[^\s"'<>]+/gu, address => {
    try { const url = new URL(address); return url.origin + url.pathname; } catch { return '[URL]'; }
  }).slice(0, 500);
  let stack, browser, database, server, activePage, publicConfig = null, stage = 'start';
  const check = async (name, fn) => { stage = name; await fn(); checks.push({ name, status: 'PASS' }); };
  const report = { schemaVersion: 1, checkedAtUtc: new Date().toISOString(),
    scope: 'real-local-Chromium-GoTrue-PostgREST-PG15-Mailpit', checks,
    hostedProductionVerified: false, productionWrites: 0, externalEmails: 0,
    backendMocks: false, iconMockOnly: true, localInviteHandlerAdapter: true,
    hostedEdgeGatewayVerified: false };
  try {
    server = http.createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        if (pathname === '/runtime-config.js') {
          response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
          response.end(`window.__NEXERP_CONFIG__=${JSON.stringify(publicConfig)};`); return;
        }
        if (pathname === '/products.json') { response.writeHead(404); response.end(); return; }
        const file = resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
        if (!file.startsWith(join(root, 'dist') + sep)) throw new Error();
        const content = await readFile(file);
        response.writeHead(200, { 'Content-Type': (TYPES[extname(file)] ?? 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(content);
      } catch { response.writeHead(404); response.end(); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const uiOrigin = `http://127.0.0.1:${server.address().port}`;
    if (existingLocalStack) {
      for (const key of ['apiUrl', 'dbUrl', 'mailUrl']) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(existingLocalStack[key]).hostname));
      assert.ok(existingLocalStack.projectId.startsWith('momo-browser-'));
      stack = { ...existingLocalStack, stop: async () => {}, publicSummary: { existingSyntheticStack: true } };
    } else stack = await startBrowserStack({ dockerBin, uiOrigin });
    localSecrets.push(stack.publicKey, stack.serviceKey);
    publicConfig = { url: stack.apiUrl, publishableKey: stack.publicKey };
    report.stack = stack.publicSummary;
    database = new pg.Client({ connectionString: stack.dbUrl }); await database.connect();
    await check('Dependency-ordered local migrations compile without production bootstrap data', async () => {
      const files = (await readdir(join(root, 'supabase/migrations'))).filter(name => name.endsWith('.sql') &&
        !['202609170003_bootstrap_momo_erp.sql', '202609180001_verify_admin_auth_rls.sql', '202609180002_set_admin_first_name.sql'].includes(name)).sort();
      for (const file of files) {
        await database.query('BEGIN');
        try { await database.query(await readFile(join(root, 'supabase/migrations', file), 'utf8')); await database.query('COMMIT'); }
        catch (error) { await database.query('ROLLBACK'); throw Object.assign(new Error('Local migration failed: ' + file), { code: error.code }); }
      }
      await database.query("NOTIFY pgrst, 'reload schema'");
      report.appliedMigrationCount = files.length;
    });
    stage = 'Provision isolated synthetic Auth user and organization roles';
    const org = randomUUID(), userPassword = 'Synthetic!' + randomBytes(12).toString('hex');
    const nextPassword = 'SyntheticReset!' + randomBytes(12).toString('hex');
    localSecrets.push(userPassword, nextPassword);
    const email = 'browser-owner@example.invalid';
    await database.query('INSERT INTO public.organizations(id,name,slug) VALUES($1,$2,$3)', [org, 'SYNTHETIC browser organization', 'synthetic-browser-' + randomUUID()]);
    const admin = createClient(stack.apiUrl, stack.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const created = await admin.auth.admin.createUser({ email, password: userPassword, email_confirm: true,
      app_metadata: { organization_id: org }, user_metadata: { first_name: 'SYNTHETIC', last_name: 'E2E' } });
    assert.equal(created.error, null, 'Local Auth synthetic user created');
    const role = randomUUID(), user = created.data.user.id;
    // GoTrue can persist app_metadata after its initial auth.users INSERT. An
    // invitation uses the guarded provisioning RPC; this test uses its isolated
    // administrative SQL fixture to bind the just-created synthetic profile.
    await database.query("UPDATE public.profiles SET organization_id=$1,status='active' WHERE id=$2", [org, user]);
    await database.query("INSERT INTO public.roles(id,organization_id,name) VALUES($1,$2,'Synthetic browser operator')", [role, org]);
    await database.query('INSERT INTO public.role_permissions(role_id,permission_code) SELECT $1,code FROM public.permissions', [role]);
    await database.query('INSERT INTO public.user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
    const employeeRole = randomUUID();
    await database.query("INSERT INTO public.roles(id,organization_id,name) VALUES($1,$2,'Synthetic limited employee')", [employeeRole, org]);
    await database.query("INSERT INTO public.role_permissions(role_id,permission_code) VALUES($1,'dashboard.view'),($1,'products.read')", [employeeRole]);
    await database.query("INSERT INTO public.facebook_pages(organization_id,name,external_page_id) VALUES($1,'SYNTHETIC Page','12345')", [org]);
    await sleep(500);
    browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const sdk = await readFile(join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
    const invitationEnvironment = { SUPABASE_URL: stack.apiUrl, SUPABASE_ANON_KEY: stack.publicKey,
      SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey, ERP_INVITE_REDIRECT_URL: uiOrigin + '/?setup=1' };
    const inviteHandler = createInviteHandler({ createClient, env: name => invitationEnvironment[name],
      logger(event) { invitationTrace.push({ stage: event.stage }); } });
    const bindLocalRoutes = browserContext => browserContext.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === stack.apiUrl && url.pathname === '/functions/v1/invite-user') {
        // Execute the actual Edge business handler, with real local SDK/DB/Auth.
        // This adapter does not simulate a deployed gateway's JWT validation.
        const request = route.request(), headers = await request.allHeaders();
        invitationTrace.push({ method: request.method(), state: 'started' });
        const response = await inviteHandler(new Request(request.url(), { method: request.method(), headers,
          ...(request.postData() === null ? {} : { body: request.postData() }) }));
        invitationTrace.push({ method: request.method(), status: response.status });
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      }
      if ([uiOrigin, stack.apiUrl, stack.mailUrl].includes(url.origin)) return route.continue();
      if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@2.112.3')) return route.fulfill({ contentType: 'application/javascript', body: sdk });
      if (url.origin === 'https://unpkg.com' && url.pathname.includes('lucide@0.468.0')) return route.fulfill({ contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};' });
      // Fonts/analytics/other network cannot escape this synthetic local test.
      return route.abort();
    });
    await bindLocalRoutes(context);
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => pageErrors.push(safeMessage(error.message)));
    page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === stack.apiUrl) failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    await page.goto(uiOrigin);
    await check('Wrong password is rejected and submit recovers', async () => {
      await page.locator('#login-form [name=email]').fill(email);
      await page.locator('#login-form [name=password]').fill('not-the-synthetic-password');
      await page.locator('#login-form [type=submit]').click();
      await page.locator('#auth-error').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#login-form [type=submit]').isEnabled(), true);
      assert.equal(await page.locator('.app-shell').getAttribute('aria-hidden'), 'true');
    });
    await check('Real Auth login and PostgREST profile/RBAC load show empty real dashboard', async () => {
      await page.locator('#login-form [name=password]').fill(userPassword);
      await page.locator('#login-form [type=submit]').click();
      await page.waitForFunction(() => document.body.classList.contains('auth-ready'));
      await page.waitForFunction(() => window.momoCoreUi?.snapshot?.status === 'ready');
      assert.equal(await page.locator('#dashboard-orders').textContent(), '0');
      assert.equal(await page.locator('#dashboard-sales').textContent(), '0₮');
      assert.equal(await page.locator('body').textContent().then(text => text.includes('4,280,000')), false);
    });
    const nav = view => page.locator(`.nav-item[data-view="${view}"]`).click();
    const readMailLink = async type => {
      let link; const deadline = Date.now() + 10000;
      while (!link && Date.now() < deadline) {
        const inbox = await (await fetch(stack.mailUrl + '/api/v1/messages', { signal: AbortSignal.timeout(5000) })).json();
        for (const item of inbox.messages ?? []) {
          const mail = await (await fetch(stack.mailUrl + '/api/v1/message/' + encodeURIComponent(item.ID), { signal: AbortSignal.timeout(5000) })).json();
          for (const candidate of (mail.HTML ?? '').matchAll(/href="([^"]+)"/gu)) {
            if (candidate[1].includes('type=' + type)) link = candidate[1].replaceAll('&amp;', '&');
          }
        }
        if (!link) await sleep(100);
      }
      assert.ok(link, 'Expected synthetic local email link');
      assert.equal(new URL(link).origin, stack.apiUrl);
      localSecrets.push(link);
      return link;
    };
    await check('Invalid invitation date is rejected by actual local handler before email', async () => {
      const countMail = async () => (await (await fetch(stack.mailUrl + '/api/v1/messages')).json()).total;
      const before = await countMail();
      assert.ok(Number.isSafeInteger(before));
      const denied = await page.evaluate(async selectedRole => {
        try {
          await window.nexerpAuth.invokeAuthenticated('invite-user', { email: 'bad-date@example.invalid',
            firstName: 'SYNTHETIC', lastName: 'E2E', department: 'Test', position: 'Test', phone: '00000003', roleId: selectedRole, startDate: '2026-02-30' });
          return false;
        } catch { return true; }
      }, employeeRole);
      assert.equal(denied, true); assert.equal(await countMail(), before);
      assert.equal((await database.query("SELECT count(*)::int n FROM auth.users WHERE email='bad-date@example.invalid'")).rows[0].n, 0);
    });
    const employeeEmail = 'browser-invited@example.invalid';
    await check('Employee form sends a local invitation and provisions exact organization and role', async () => {
      await nav('settings'); await page.locator('#add-user').click();
      await page.locator('#user-modal').waitFor({ state: 'visible' });
      for (const [name, value] of Object.entries({ firstName: 'SYNTHETIC', lastName: 'Employee',
        email: employeeEmail, phone: '00000004', position: 'Local test', startDate: '2024-02-29' })) {
        await page.locator(`#user-form [name="${name}"]`).fill(value);
      }
      await page.locator('#user-form [name=role]').selectOption(employeeRole);
      assert.deepEqual(await page.locator('#user-form :invalid').evaluateAll(fields => fields.map(field => field.name)), [], 'Synthetic invitation form must be valid before submit');
      // The handler has a 15s deadline. Wait long enough to observe its actual
      // bounded response instead of masking it with a shorter browser timeout.
      const accepted = page.waitForResponse(response => response.url() === stack.apiUrl + '/functions/v1/invite-user' && response.request().method() === 'POST', { timeout: 20000 });
      await page.locator('#user-form [type=submit]').click();
      const response = await accepted; assert.equal(response.status(), 200);
      const result = await response.json(); assert.equal(result.ok, true);
      await page.locator('#user-modal').waitFor({ state: 'hidden' });
      await page.locator('#users-table').getByText(employeeEmail, { exact: true }).waitFor();
      const row = (await database.query('SELECT organization_id,status,employment_start_date::text start_date FROM public.profiles WHERE id=$1', [result.userId])).rows[0];
      assert.deepEqual(row, { organization_id: org, status: 'active', start_date: '2024-02-29' });
      const memberships = (await database.query('SELECT role_id FROM public.user_roles WHERE user_id=$1', [result.userId])).rows;
      assert.deepEqual(memberships, [{ role_id: employeeRole }]);
    });
    await check('Invited employee sets a password and receives only the permitted ERP capabilities', async () => {
      const employeeContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
      await bindLocalRoutes(employeeContext);
      const employeePage = await employeeContext.newPage(); activePage = employeePage;
      employeePage.setDefaultTimeout(10000);
      employeePage.on('pageerror', error => pageErrors.push(safeMessage(error.message)));
      const link = await readMailLink('invite');
      await employeePage.goto(link); await employeePage.locator('#setup-password-form').waitFor({ state: 'visible' });
      const password = 'InvitedSynthetic!' + randomBytes(12).toString('hex'); localSecrets.push(password);
      await employeePage.locator('#setup-password-form [name=password]').fill(password);
      await employeePage.locator('#setup-password-form [name=confirmPassword]').fill(password);
      await employeePage.locator('#setup-password-form [type=submit]').click();
      await employeePage.waitForFunction(() => window.momoCoreUi?.snapshot?.status === 'ready');
      assert.equal(await employeePage.locator('.nav-item[data-view=settings]').isHidden(), true);
      assert.equal(await employeePage.evaluate(() => window.nexerpAuth.can('users.manage')), false);
      assert.equal(await employeePage.evaluate(() => window.momoCoreUi.snapshot.summary.finance), null);
      const login = await createClient(stack.apiUrl, stack.publicKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.signInWithPassword({ email: employeeEmail, password });
      assert.equal(login.error, null);
      await employeeContext.close(); activePage = page;
    });
    await check('Warehouse and product forms persist to actual PostgreSQL', async () => {
      await nav('warehouse'); await page.locator('#core-add-warehouse').click();
      await page.locator('#core-action-form [name=name]').fill('SYNTHETIC warehouse');
      await page.locator('#core-action-form [type=submit]').click();
      await page.waitForFunction(() => window.momoCoreUi.snapshot.warehouses.length === 1);
      await nav('products'); await page.locator('#add-product').click();
      await page.locator('#product-form [name=name]').fill('SYNTHETIC хайрцаг');
      await page.locator('#product-form [name=sku]').fill('SYNTH-E2E-001');
      await page.locator('#product-form [name=price]').fill('12000');
      await page.locator('#product-form [name=cost]').fill('5000');
      await page.locator('#product-form [type=submit]').click();
      await page.waitForFunction(() => window.momoCoreUi.snapshot.products.length === 1);
      assert.equal((await database.query('SELECT count(*)::int n FROM public.products WHERE organization_id=$1', [org])).rows[0].n, 1);
    });
    await check('Inventory form changes durable stock, not a local counter', async () => {
      await nav('warehouse'); await page.locator('#core-adjust-inventory').click();
      await page.locator('#movementProductSearch').fill('SYNTH-E2E-001');
      await page.locator('#core-action-form [data-product-result]').click();
      await page.locator('#core-action-form [name=quantity_delta]').fill('10');
      await page.locator('#core-action-form [name=note]').fill('Synthetic stock receipt');
      await page.locator('#core-action-form [type=submit]').click();
      await page.waitForFunction(() => window.momoCoreUi.snapshot.balances[0]?.quantity === 10);
      assert.equal(Number((await database.query('SELECT quantity FROM public.inventory_balances WHERE organization_id=$1', [org])).rows[0].quantity), 10);
    });
    await check('Order form atomically writes order/items/delivery and reserves stock', async () => {
      await nav('orders'); await page.locator('[data-open-order]:visible').first().click();
      await page.locator('#order-form [name=customer]').fill('SYNTHETIC customer');
      await page.locator('#order-form [name=phone]').fill('00000001');
      await page.locator('#order-form [name=address]').fill('Зохиомол хаяг, local test');
      await page.locator('#order-product-search').fill('SYNTH');
      await page.locator('#order-product-results [data-product-result]').first().click();
      const warehouse = await page.evaluate(() => window.momoCoreUi.snapshot.warehouses[0].id);
      await page.locator('#order-form [name=warehouse_id]').selectOption(warehouse);
      await page.locator('#order-form [name=quantity]').fill('2');
      await page.locator('#order-form [name=collectAmount]').fill('24000');
      await page.locator('#order-form [type=submit]').click();
      await page.waitForFunction(() => window.momoCoreUi.snapshot.orders.length === 1);
      const result = (await database.query('SELECT (SELECT count(*) FROM public.orders)::int orders,(SELECT count(*) FROM public.order_items)::int items,(SELECT count(*) FROM public.deliveries)::int deliveries,(SELECT quantity FROM public.inventory_balances LIMIT 1) stock')).rows[0];
      assert.deepEqual(result, { orders: 1, items: 1, deliveries: 1, stock: 8 });
    });
    await check('Lead creation and call outcome forms persist actual customer numbers', async () => {
      await nav('leads'); await page.locator('#open-lead').click();
      const pageId = await page.evaluate(() => window.momoCoreUi.snapshot.pages[0].id);
      await page.locator('#lead-form [name=page]').selectOption(pageId);
      await page.locator('#lead-form [name=leadCustomer]').first().fill('SYNTHETIC lead');
      await page.locator('#lead-form [name=leadPhone]').first().fill('00000002');
      await page.locator('#lead-product-search').fill('SYNTH');
      await page.locator('#lead-product-results [data-product-result]').first().click();
      await page.locator('#lead-form [type=submit]').click();
      await page.waitForFunction(() => window.momoCoreUi.snapshot.leads.length === 1);
      await page.locator('[data-core-call]').first().click();
      await page.waitForFunction(() => window.momoCoreUi.snapshot.leads[0]?.call_attempts === 1);
      assert.equal((await database.query('SELECT count(*)::int n FROM public.call_logs WHERE organization_id=$1', [org])).rows[0].n, 1);
    });
    await check('Reload preserves actual records and ignores legacy demo localStorage', async () => {
      await page.evaluate(() => {
        for (const key of ['orders', 'nexerp-orders', 'momo-orders']) localStorage.setItem(key, JSON.stringify([{ id: 'DEMO-POISON', amount: 999999999 }]));
      });
      await page.reload(); await page.waitForFunction(() => window.momoCoreUi?.snapshot?.status === 'ready');
      assert.equal(await page.evaluate(() => window.momoCoreUi.snapshot.orders.length), 1);
      assert.equal(await page.locator('body').textContent().then(text => text.includes('DEMO-POISON')), false);
    });
    await check('Delivery and cashflow forms update server-calculated dashboard', async () => {
      await nav('delivery'); await page.locator('[data-core-delivery]').first().click();
      await page.locator('#core-action-form [name=status]').selectOption('in_transit');
      await page.locator('#core-action-form [type=submit]').click();
      await page.waitForFunction(() => window.momoCoreUi.snapshot.deliveries[0]?.status === 'in_transit');
      await page.locator('[data-core-delivery]').first().click();
      await page.locator('#core-action-form [name=status]').selectOption('delivered');
      await page.locator('#core-action-form [type=submit]').click();
      await page.waitForFunction(() => window.momoCoreUi.snapshot.orders[0]?.status === 'delivered');
      await nav('finance'); await page.locator('#core-add-finance').click();
      await page.locator('#core-action-form [name=amount]').fill('24000');
      await page.locator('#core-action-form [name=description]').fill('Synthetic receipt');
      const order = await page.evaluate(() => window.momoCoreUi.snapshot.orders[0].id);
      await page.locator('#core-action-form [name=order_id]').selectOption(order);
      await page.locator('#core-action-form [type=submit]').click();
      await page.waitForFunction(() => Number(window.momoCoreUi.snapshot.summary.finance.income) === 24000);
      await nav('dashboard'); assert.equal((await page.locator('#dashboard-sales').textContent()).replace(/\D/gu, ''), '24000');
    });
    await check('Catalog stock includes balances outside the latest 500 inventory rows', async () => {
      // The original SKU's 8 units and a second SKU's 7 older units are both
      // outside the first inventory page. Only the second SKU has recent rows.
      const second = randomUUID();
      await database.query(`INSERT INTO public.products(id, organization_id, sku, name)
        VALUES ($1, $2, 'SYNTH-STOCK-LIMIT', 'SYNTHETIC stock limit')`, [second, org]);
      await database.query(`INSERT INTO public.inventory_balances(organization_id, warehouse_id, product_id, quantity)
        SELECT $1, id, $2, 7 FROM public.warehouses WHERE organization_id = $1`, [org, second]);
      await database.query(`WITH extra AS (
        INSERT INTO public.warehouses(organization_id, name)
        SELECT $1, 'SYNTHETIC stock location ' || n FROM generate_series(1, 500) AS n
        RETURNING id
      ) INSERT INTO public.inventory_balances(organization_id, warehouse_id, product_id, quantity)
        SELECT $1, id, $2, 1 FROM extra`, [org, second]);
      await page.reload();
      await page.waitForFunction(() => window.momoCoreUi?.snapshot?.status === 'ready');
      await nav('products');
      const sample = await page.evaluate(() => {
        const { limited, balances } = window.momoCoreUi.snapshot;
        return { limited: limited.balances, rows: balances.length, products: [...new Set(balances.map(row => row.product_id))] };
      });
      assert.deepEqual(sample, { limited: true, rows: 500, products: [second] });
      for (const [sku, expected] of [['SYNTH-E2E-001', '8 ш'], ['SYNTH-STOCK-LIMIT', '507 ш']]) {
        const card = page.locator('#product-grid .product-card').filter({ hasText: sku });
        assert.equal(await card.locator('.product-price span').innerText(), expected);
        const inventoryRow = page.locator('#inventory-list .inventory-item').filter({ hasText: sku });
        assert.equal(await inventoryRow.locator('b').textContent(), expected);
      }
      assert.match(await page.locator('[data-core-report="inventory"]').textContent(), /500 мөр/u);
    });
    await check('Dashboard and warehouse count active SKUs across all stock locations, including missing balances', async () => {
      await database.query(`INSERT INTO public.products(organization_id, sku, name, is_active)
        VALUES ($1, 'SYNTH-LOW', 'SYNTHETIC low', true),
               ($1, 'SYNTH-EMPTY', 'SYNTHETIC empty', true),
               ($1, 'SYNTH-ARCHIVED', 'SYNTHETIC archived', false)`, [org]);
      await database.query(`INSERT INTO public.inventory_balances(organization_id, warehouse_id, product_id, quantity)
        SELECT p.organization_id, w.id, p.id, 2
        FROM public.products p CROSS JOIN (
          SELECT id FROM public.warehouses WHERE organization_id = $1 ORDER BY id LIMIT 2
        ) w
        WHERE p.organization_id = $1 AND p.sku IN ('SYNTH-LOW', 'SYNTH-ARCHIVED')`, [org]);
      await page.reload();
      await page.waitForFunction(() => window.momoCoreUi?.snapshot?.status === 'ready');
      await nav('dashboard');
      // 8 and 507 units are healthy, 2 + 2 is low, and the empty SKU has zero.
      assert.equal(await page.locator('#dashboard-low-stock').innerText(), '1');
      await nav('warehouse');
      assert.equal(await page.locator('#product-count').innerText(), '4');
      assert.equal(await page.locator('#out-count').innerText(), '1');
    });
    await check('Catalog pages and searches all 506 equal-name active SKUs with stable order and stock', async () => {
      const name = 'SYNTHETIC paging fixture';
      const category = (await database.query('INSERT INTO public.categories(organization_id, name) VALUES ($1, $2) RETURNING id',
        [org, 'SYNTHETIC paging category'])).rows[0].id;
      await database.query(`INSERT INTO public.products(organization_id, sku, name, sale_price, discount_price)
        SELECT $1, 'SYNTH-PAGE-' || lpad(n::text, 4, '0'), $2, 9200, 8700 FROM generate_series(1, 506) AS n`, [org, name]);
      const renamed = 'MiXeD%_*,("Q\\Z")';
      await database.query('INSERT INTO public.products(organization_id, sku, name) VALUES ($1, $2, $3)',
        [org, 'SYNTH-PAGE-NEAR-MATCH', renamed.replace('%_*', 'ABC')]);
      const expected = (await database.query(`SELECT id, sku FROM public.products
        WHERE organization_id = $1 AND name = $2 ORDER BY name, id`, [org, name])).rows;
      const last = expected.at(-1);
      await database.query(`INSERT INTO public.inventory_balances(organization_id, warehouse_id, product_id, quantity)
        SELECT $1, id, $2, 3 FROM public.warehouses WHERE organization_id = $1 ORDER BY id LIMIT 2`, [org, last.id]);
      await page.reload();
      await page.waitForFunction(() => window.momoCoreUi?.snapshot?.status === 'ready');
      await nav('products');
      const search = page.locator('#product-search');
      const cards = page.locator('#product-grid .product-body > p');
      const next = page.locator('#product-next'), previous = page.locator('#product-prev');
      const assertPage = async rows => {
        await page.waitForFunction(firstSku =>
          document.querySelector('#product-grid .product-body > p')?.textContent === firstSku, rows[0].sku);
        assert.deepEqual(await cards.allTextContents(), rows.map(row => row.sku));
      };
      await search.fill(name);
      const size = 24;
      for (let offset = 0; offset < expected.length; offset += size) {
        if (offset > 0) await next.click();
        await assertPage(expected.slice(offset, offset + size));
        if (offset === 0) assert.equal(await previous.isDisabled(), true);
      }
      assert.equal(await next.isDisabled(), true);
      const lastCard = page.locator('#product-grid .product-card').filter({ hasText: last.sku });
      assert.equal(await lastCard.locator('.product-price span').innerText(), '6 ш');
      await previous.click();
      await assertPage(expected.slice(480, 504));
      await next.click();
      await lastCard.locator('[data-edit-product]').click();
      const form = page.locator('#product-form');
      assert.equal(await form.locator('[name=id]').inputValue(), last.id);
      assert.equal(Number(await form.locator('[name=price]').inputValue()), 9200);
      assert.equal(Number(await form.locator('[name=discountPrice]').inputValue()), 8700);
      assert.equal(Number(await form.locator('[name=stock]').inputValue()), 6);
      await form.locator('[name=category_id]').selectOption(category);
      await form.locator('[name=name]').fill(renamed);
      await form.locator('[type=submit]').click();
      await form.waitFor({ state: 'hidden' });
      const saved = await database.query('SELECT id, sku, name, category_id FROM public.products WHERE organization_id=$1 AND (sku=$2 OR name=$3)',
        [org, last.sku, renamed]);
      assert.deepEqual(saved.rows, [{ ...last, name: renamed, category_id: category }]);
      await search.fill(last.sku);
      await assertPage([last]);
      assert.equal(await previous.isDisabled(), true);
      assert.equal(await next.isDisabled(), true);
      await search.fill('SYNTH-PAGE-NEAR-MATCH');
      await assertPage([{ sku: 'SYNTH-PAGE-NEAR-MATCH' }]);
      await search.fill(renamed.toLowerCase());
      await assertPage([last]);
      await search.fill('');
      await page.waitForFunction(() => document.querySelectorAll('#product-grid .product-card').length === 24);
      await page.locator('#category-filter').selectOption(category);
      await assertPage([last]);
    });
    await check('Order and lead pickers find an older SKU and retain its discounted price through conversion', async () => {
      const sku = 'SYNTH-E2E-001', unitPrice = 9500;
      const product = (await database.query(`UPDATE public.products SET discount_price=$3
        WHERE organization_id=$1 AND sku=$2 RETURNING id, name`, [org, sku, unitPrice])).rows[0];
      const warehouse = (await database.query(`SELECT warehouse_id FROM public.inventory_balances
        WHERE organization_id=$1 AND product_id=$2`, [org, product.id])).rows[0].warehouse_id;
      const outsideSnapshot = await page.evaluate(id => {
        const { products, limited } = window.momoCoreUi.snapshot;
        return limited.products && products.length === 500 && !products.some(item => item.id === id);
      }, product.id);
      assert.equal(outsideSnapshot, true);

      async function pickProduct(kind) {
        await page.locator(`#${kind}-product-search`).fill(sku.toLowerCase());
        await page.locator(`#${kind}-product-results [data-product-result="${product.id}"]`).click();
        assert.equal(await page.locator(`#${kind}-form [name=productId]`).inputValue(), product.id);
      }
      const order = page.locator('#order-form');
      async function submitOrder(quantity, phone, leadId) {
        assert.equal(await order.locator('[name=productId]').inputValue(), product.id);
        assert.equal(Number(await order.locator('[name=amount]').inputValue()), unitPrice);
        await order.locator('[name=address]').fill('SYNTHETIC picker test address');
        await order.locator('[name=warehouse_id]').selectOption(warehouse);
        await order.locator('[name=quantity]').fill(String(quantity));
        const total = quantity * unitPrice;
        assert.equal(Number(await order.locator('[name=amount]').inputValue()), total);
        assert.equal(Number(await order.locator('[name=collectAmount]').inputValue()), total);
        await order.locator('[type=submit]').click();
        await order.waitFor({ state: 'hidden' });
        const saved = await database.query(`SELECT o.lead_id, i.product_id, i.quantity, i.unit_price::int,
          o.product_total::int, o.collect_amount::int FROM public.orders o
          JOIN public.order_items i ON i.order_id=o.id WHERE o.organization_id=$1 AND o.phone_normalized=$2`, [org, phone]);
        assert.deepEqual(saved.rows, [{ lead_id: leadId, product_id: product.id, quantity,
          unit_price: unitPrice, product_total: total, collect_amount: total }]);
      }

      await nav('orders');
      await page.locator('[data-open-order]:visible').first().click();
      await order.locator('[name=customer]').fill('SYNTHETIC direct picker order');
      await order.locator('[name=phone]').fill('00000003');
      await pickProduct('order');
      await submitOrder(2, '00000003', null);
      await page.waitForFunction(() => window.momoCoreUi.snapshot.orders.length === 2);
      await nav('leads');
      await page.locator('#open-lead').click();
      const lead = page.locator('#lead-form'), leadPhone = '00000004';
      const pageId = await page.evaluate(() => window.momoCoreUi.snapshot.pages[0].id);
      await lead.locator('[name=page]').selectOption(pageId);
      await lead.locator('[name=leadCustomer]').first().fill('SYNTHETIC converted picker order');
      await lead.locator('[name=leadPhone]').first().fill(leadPhone);
      await pickProduct('lead');
      await lead.locator('[type=submit]').click();
      await lead.waitFor({ state: 'hidden' });
      const savedLead = (await database.query(`SELECT id, product_id FROM public.leads
        WHERE organization_id=$1 AND phone_normalized=$2`, [org, leadPhone])).rows[0];
      assert.equal(savedLead.product_id, product.id);
      await page.locator(`[data-core-convert="${savedLead.id}"]`).click();
      await page.waitForFunction(name => document.querySelector('#order-product-search').value === name, product.name);
      await submitOrder(3, leadPhone, savedLead.id);
      await page.waitForFunction(() => window.momoCoreUi.snapshot.orders.length === 3);
    });
    await check('Inventory picker posts an older SKU to the selected warehouse and preserves stock elsewhere', async () => {
      const sku = 'SYNTH-E2E-001';
      const productId = (await database.query('SELECT id FROM public.products WHERE organization_id=$1 AND sku=$2', [org, sku])).rows[0].id;
      assert.equal(await page.evaluate(id => {
        const { products, limited } = window.momoCoreUi.snapshot;
        return limited.products && products.length === 500 && !products.some(product => product.id === id);
      }, productId), true);
      const balances = async () => (await database.query(`SELECT warehouse_id, quantity::int FROM public.inventory_balances
        WHERE organization_id=$1 AND product_id=$2 ORDER BY warehouse_id`, [org, productId])).rows;
      const before = await balances();
      await nav('warehouse');
      await page.locator('#core-adjust-inventory').click();
      const form = page.locator('#core-action-form');
      const warehouses = form.locator('[name=warehouse_id]');
      const defaultWarehouse = await warehouses.inputValue();
      const warehouseId = (await warehouses.locator('option').evaluateAll(options => options.map(option => option.value)))
        .find(id => id && id !== defaultWarehouse && !before.some(balance => balance.warehouse_id === id));
      assert.ok(warehouseId, 'A second synthetic warehouse should have no stock for this SKU');
      await warehouses.selectOption(warehouseId);
      const search = form.locator('#movementProductSearch');
      const result = form.locator(`[data-product-result="${productId}"]`);
      const selection = form.locator('[name=product_id]');
      await search.fill(sku.toLowerCase());
      await result.click();
      assert.equal(await selection.inputValue(), productId);
      const note = 'Synthetic receipt beyond the 500-product snapshot';
      await form.locator('[name=quantity_delta]').fill('4');
      await form.locator('[name=note]').fill(note);
      await search.fill('SYNTHETIC-MISSING-SKU');
      assert.equal(await selection.inputValue(), '');
      await form.evaluate(element => element.requestSubmit());
      assert.equal(await form.isVisible(), true);
      await search.fill(sku);
      await result.click();
      await form.locator('[type=submit]').click();
      await form.waitFor({ state: 'hidden' });
      const movements = await database.query(`SELECT product_id, warehouse_id, quantity_delta::int, movement_type
        FROM public.inventory_movements WHERE organization_id=$1 AND note=$2`, [org, note]);
      assert.deepEqual(movements.rows, [{ product_id: productId, warehouse_id: warehouseId, quantity_delta: 4, movement_type: 'income' }]);
      const after = await balances();
      assert.deepEqual(after.filter(row => row.warehouse_id === warehouseId), [{ warehouse_id: warehouseId, quantity: 4 }]);
      assert.deepEqual(after.filter(row => row.warehouse_id !== warehouseId), before);
    });
    await check('Permission revocation is enforced by PostgREST/RPC despite stale UI grants', async () => {
      await database.query("DELETE FROM public.role_permissions WHERE role_id=$1 AND permission_code='products.manage'", [role]);
      const denial = await page.evaluate(async () => {
        try { await window.momoCoreUi.service.saveProduct({ sku: 'REVOKED-E2E', name: 'Not written', sale_price: 1 }); return false; }
        catch (error) { return error.code === '42501'; }
      });
      assert.equal(denial, true);
      assert.equal((await database.query("SELECT count(*)::int n FROM public.products WHERE sku='REVOKED-E2E'")).rows[0].n, 0);
    });
    await check('Logout removes authorized shell and private client state', async () => {
      const navigation = page.waitForEvent('load');
      page.once('dialog', dialog => dialog.accept()); await page.locator('#auth-profile').click();
      await navigation;
      await page.locator('#login-form').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => window.nexerpAuth === undefined), true);
    });
    await check('Password recovery email stays in Mailpit and reset completes through real Auth', async () => {
      await page.locator('#login-form [name=email]').fill(email); await page.locator('#show-reset-password').click();
      await page.locator('#reset-password-form [type=submit]').click();
      await page.locator('#reset-success').waitFor({ state: 'visible' });
      const link = await readMailLink('recovery');
      await page.goto(link); await page.locator('#setup-password-form').waitFor({ state: 'visible' });
      await page.locator('#setup-password-form [name=password]').fill(nextPassword);
      await page.locator('#setup-password-form [name=confirmPassword]').fill(nextPassword);
      await page.locator('#setup-password-form [type=submit]').click();
      await page.waitForFunction(() => document.body.classList.contains('auth-ready'));
      const oldLogin = await createClient(stack.apiUrl, stack.publicKey, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password: userPassword });
      assert.ok(oldLogin.error);
      const newLogin = await createClient(stack.apiUrl, stack.publicKey, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password: nextPassword });
      assert.equal(newLogin.error, null);
    });
    await check('No unhandled browser error or backend mutation mock', async () => {
      assert.deepEqual(pageErrors, []);
      const unexpected = failedResponses.filter(item => !(
        (item.path === '/auth/v1/token' && item.status === 400) ||
        (item.path === '/functions/v1/invite-user' && item.status === 400) ||
        (item.path === '/rest/v1/rpc/core_save_product' && item.status === 403)));
      assert.deepEqual(unexpected, []);
    });
    await mkdir(join(root, 'docs/evidence'), { recursive: true });
    await page.screenshot({ path: join(root, 'docs/evidence/local-browser-dashboard.png'), fullPage: true });
    report.status = 'PASS'; report.counts = { pass: checks.length, fail: 0 };
  } catch (error) {
    report.status = 'FAIL'; report.failedStage = stage;
    report.failure = { code: error.code ?? error.name, message: safeMessage(error.message) };
    report.browserErrors = pageErrors;
    report.failedResponses = failedResponses;
    report.invitationTrace = invitationTrace;
    if (activePage && !activePage.isClosed()) {
      report.dom = await activePage.evaluate(() => ({
        bodyClass: document.body.className,
        loginError: document.querySelector('#auth-error')?.textContent,
        coreStatus: document.querySelector('#core-data-status')?.textContent,
        appAuthorized: !!window.nexerpAuth,
        coreSnapshotStatus: window.momoCoreUi?.snapshot?.status ?? null,
        coreErrors: window.momoCoreUi?.snapshot?.errors ?? null,
        invitationModalOpen: document.querySelector('#user-modal')?.classList.contains('open'),
        invitationSubmitDisabled: document.querySelector('#user-form [type=submit]')?.disabled,
        invalidInvitationFields: [...document.querySelectorAll('#user-form :invalid')].map(field => field.name),
      })).catch(() => null);
    }
    report.counts = { pass: checks.length, fail: 1 };
  } finally {
    const cleanupFailures = [];
    const clean = async (name, action) => { try { await action(); } catch { cleanupFailures.push(name); } };
    await clean('browser', async () => browser?.close());
    await clean('database', async () => database?.end());
    await clean('http-server', async () => {
      if (server?.listening) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    });
    if (stack) await clean('owned-stack', async () => { await stack.stop(); report.ownedStackCleaned = !existingLocalStack; });
    report.cleanupFailures = cleanupFailures;
    if (cleanupFailures.length) { report.status = 'FAIL'; report.failedStage ??= 'cleanup'; }
  }
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--docker-bin' || args[2] !== '--chromium') {
    console.error('Usage: node scripts/browser-erp-acceptance.mjs --docker-bin <local docker> --chromium <installed Chromium>'); process.exitCode = 2;
  } else {
    const result = await runBrowserAcceptance({ dockerBin: args[1], chromiumPath: args[3], reportPath: join(root, 'docs/evidence/browser-erp-acceptance.json') });
    console.log(JSON.stringify(result, null, 2)); if (result.status !== 'PASS') process.exitCode = 1;
  }
}
