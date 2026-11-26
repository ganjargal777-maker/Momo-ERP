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

const root = resolve(import.meta.dirname, '..');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

export async function runBrowserAcceptance({ dockerBin, chromiumPath, reportPath,
  existingLocalStack = null } = {}) {
  const checks = [], pageErrors = [], failedResponses = [], localSecrets = [];
  const safeMessage = value => localSecrets.reduce((text, secret) => secret ? text.replaceAll(secret, '[REDACTED]') : text, String(value)).replace(/https?:\/\/[^\s"'<>]+/gu, address => {
    try { const url = new URL(address); return url.origin + url.pathname; } catch { return '[URL]'; }
  }).slice(0, 500);
  let stack, browser, database, server, activePage, publicConfig = null, stage = 'start';
  const check = async (name, fn) => { stage = name; await fn(); checks.push({ name, status: 'PASS' }); };
  const report = { schemaVersion: 1, checkedAtUtc: new Date().toISOString(),
    scope: 'real-local-Chromium-GoTrue-PostgREST-PG15-Mailpit', checks,
    hostedProductionVerified: false, productionWrites: 0, externalEmails: 0,
    backendMocks: false, iconMockOnly: true };
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
    await database.query("INSERT INTO public.facebook_pages(organization_id,name,external_page_id) VALUES($1,'SYNTHETIC Page','12345')", [org]);
    await sleep(500);
    browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const sdk = await readFile(join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if ([uiOrigin, stack.apiUrl, stack.mailUrl].includes(url.origin)) return route.continue();
      if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@2.112.3')) return route.fulfill({ contentType: 'application/javascript', body: sdk });
      if (url.origin === 'https://unpkg.com' && url.pathname.includes('lucide@0.468.0')) return route.fulfill({ contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};' });
      // Fonts/analytics/other network cannot escape this synthetic local test.
      return route.abort();
    });
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
      let link; const deadline = Date.now() + 10000;
      while (!link && Date.now() < deadline) {
        const inbox = await (await fetch(stack.mailUrl + '/api/v1/messages', { signal: AbortSignal.timeout(5000) })).json();
        for (const item of inbox.messages ?? []) {
          const mail = await (await fetch(stack.mailUrl + '/api/v1/message/' + encodeURIComponent(item.ID), { signal: AbortSignal.timeout(5000) })).json();
          const candidates = (mail.HTML ?? '').matchAll(/href="([^"]+)"/gu);
          for (const candidate of candidates) if (candidate[1].includes('type=recovery')) link = candidate[1].replaceAll('&amp;', '&');
        }
        if (!link) await sleep(100);
      }
      assert.ok(link, 'Recovery link captured by synthetic local mail sink');
      assert.equal(new URL(link).origin, stack.apiUrl);
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
    if (activePage && !activePage.isClosed()) {
      report.dom = await activePage.evaluate(() => ({
        bodyClass: document.body.className,
        loginError: document.querySelector('#auth-error')?.textContent,
        coreStatus: document.querySelector('#core-data-status')?.textContent,
        appAuthorized: !!window.nexerpAuth,
        coreSnapshotStatus: window.momoCoreUi?.snapshot?.status ?? null,
        coreErrors: window.momoCoreUi?.snapshot?.errors ?? null,
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
