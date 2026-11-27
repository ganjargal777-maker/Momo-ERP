// Opt-in hosted Chromium -> isolated sandbox Auth/PostgREST acceptance.
// This runner never deploys, changes configuration, sends email or calls Meta.
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright-core';
import { randomUUID, randomBytes } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sandboxFetch, SANDBOX_REF, SANDBOX_ORIGIN } from './check-hosted-social-access.mjs';

export const STAGING_ORIGIN = 'https://momo-erp-social-sandbox.onrender.com';
const root = resolve(import.meta.dirname, '..');
class AcceptanceFailure extends Error {
  constructor(stage, code = 'acceptance_failed', status) { super('Hosted ERP browser acceptance failed.'); Object.assign(this, { stage, code, status }); }
}
const ensure = (value, stage, code, status) => { if (!value) throw new AcceptanceFailure(stage, code, status); };
const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/u.test(value) ? value : 'acceptance_failed';
export function validateStagingOrigin(value) {
  let url; try { url = new URL(value); } catch { throw new AcceptanceFailure('arguments', 'invalid_staging_origin'); }
  ensure(value === STAGING_ORIGIN && url.origin === STAGING_ORIGIN && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password,
    'arguments', 'non_staging_target');
  return STAGING_ORIGIN;
}
export function parseHostedBrowserArgs(args) {
  const options = { execute: false }, seen = new Set();
  const paths = { '--keys-file': 'keysFile', '--chromium': 'chromiumPath', '--report': 'reportPath' };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]; ensure(!seen.has(arg), 'arguments', 'duplicate_argument'); seen.add(arg);
    if (arg === '--execute-sandbox-write') options.execute = true;
    else if (arg === '--staging-url') options.stagingOrigin = validateStagingOrigin(args[++index]);
    else if (Object.hasOwn(paths, arg)) { const value = args[++index]; ensure(typeof value === 'string' && isAbsolute(value), 'arguments', 'absolute_path_required'); options[paths[arg]] = value; }
    else throw new AcceptanceFailure('arguments', 'unsupported_argument');
  }
  return options;
}
export function hostedBrowserFetch(fetchImpl = fetch, counters = {}) {
  const api = sandboxFetch(fetchImpl, counters);
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin === SANDBOX_ORIGIN) return api(input, init);
    ensure(url.origin === STAGING_ORIGIN && !url.username && !url.password && !url.search && !url.hash &&
      ['/', '/runtime-config.js', '/products.json'].includes(url.pathname) && (init.method ?? 'GET') === 'GET', 'network_guard', 'non_staging_target');
    counters.stagingReadRequests = (counters.stagingReadRequests ?? 0) + 1;
    return fetchImpl(input, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(15000) });
  };
}
function claims(token) { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { throw new AcceptanceFailure('credentials', 'invalid_key_shape'); } }

export async function runHostedErpBrowser({ execute = false, keysFile, chromiumPath, stagingOrigin, reportPath,
  fetchImpl = fetch, clientFactory = createClient, chromiumDriver = chromium } = {}) {
  const report = { schemaVersion: 1, checkedAtUtc: new Date().toISOString(), projectRef: SANDBOX_REF,
    stagingOrigin: STAGING_ORIGIN, scope: 'real-hosted-Chromium-sandbox-Auth-PostgREST-operational-CRUD', status: 'SKIPPED',
    productionWrites: 0, metaRequests: 0, externalEmails: 0, backendMocks: false, pinnedSdkFulfilledLocally: true,
    iconsOnlyMock: true, checks: [], network: { forwardedExternalDestinations: 0, blockedExternalRequests: 0, forbiddenBackendRequests: 0 },
    cleanup: { status: 'NOT_REQUIRED', counts: {}, remaining: {} } };
  if (!execute) { report.reason = 'explicit_execute_sandbox_write_required'; return report; }
  validateStagingOrigin(stagingOrigin);
  ensure([keysFile, chromiumPath, reportPath].every(value => typeof value === 'string' && isAbsolute(value)), 'arguments', 'absolute_private_chromium_report_paths_required');
  try { await access(reportPath); throw new AcceptanceFailure('arguments', 'report_already_exists'); } catch (error) { if (error instanceof AcceptanceFailure) throw error; ensure(error.code === 'ENOENT', 'arguments', 'report_path_unavailable'); }
  const keys = JSON.parse(await readFile(keysFile, 'utf8'));
  ensure(Array.isArray(keys), 'credentials', 'invalid_key_list');
  const serviceKey = keys.find(item => item.name === 'service_role')?.api_key;
  // Hosted builds may use the modern default publishable key while the CLI
  // also returns a legacy anon JWT. Accept only exact public keys from this
  // trusted sandbox key file; never an arbitrary opaque value from the site.
  const publicKeys = [...new Set(keys.filter(item => item.name === 'anon' || (item.type === 'publishable' && item.name === 'default')).map(item => item.api_key))];
  ensure(typeof serviceKey === 'string' && publicKeys.length > 0 && publicKeys.every(key => typeof key === 'string' && key !== serviceKey), 'credentials', 'required_keys_missing');
  const privilegedClaims = claims(serviceKey);
  ensure(privilegedClaims.ref === SANDBOX_REF && privilegedClaims.role === 'service_role', 'credentials', 'key_project_or_role_mismatch');
  for (const key of publicKeys) {
    if (key.split('.').length === 3) { const publicClaims = claims(key); ensure(publicClaims.ref === SANDBOX_REF && publicClaims.role === 'anon', 'credentials', 'key_project_or_role_mismatch'); }
    else ensure(/^sb_publishable_[A-Za-z0-9_-]{8,512}$/u.test(key), 'credentials', 'invalid_public_key');
  }
  const request = hostedBrowserFetch(fetchImpl, report.network);
  const sdkOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: request } };
  const admin = clientFactory(SANDBOX_ORIGIN, serviceKey, sdkOptions);
  const runId = randomUUID(), organization = randomUUID(), actor = randomUUID(), role = randomUUID(), pageId = randomUUID();
  const marker = 'synthetic-hosted-browser-' + runId, email = 'browser-' + runId + '@example.invalid';
  const password = 'Synthetic!' + randomBytes(24).toString('base64url');
  const ledgerPath = join(dirname(resolve(keysFile)), 'hosted-browser-owned-' + runId + '.json');
  const ledger = { schemaVersion: 1, projectRef: SANDBOX_REF, runId, marker, organization, actor, role, pageId, email, cleanup: 'PENDING' };
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  report.ownedFixtureLedger = ledgerPath; report.runId = runId;
  let stage = 'public_preflight', setupStarted = false, browser, page;
  const pageErrors = [], backendErrors = [], deadline = Date.now() + 360000;
  const db = async (query, operation) => {
    ensure(Date.now() < deadline || stage === 'cleanup', operation, 'total_deadline');
    const result = await query;
    ensure(result && !result.error && result.status >= 200 && result.status < 300, operation, safeCode(result?.error?.code), result?.status);
    return result.data;
  };
  const owned = (table, columns = '*') => admin.from(table).select(columns).eq('organization_id', organization);
  const check = async (name, action) => { stage = name; await action(); report.checks.push({ name, status: 'PASS' }); };
  const submit = form => page.locator(form + ' [type=submit]').click();
  const nav = view => page.locator('.nav-item[data-view="' + view + '"]').click();
  const ready = () => page.waitForFunction(() => window.momoCoreUi?.snapshot?.status === 'ready');
  try {
    await check('Hosted public runtime is pinned to the isolated sandbox and excludes privileged credentials/catalog', async () => {
      const response = await request(STAGING_ORIGIN + '/runtime-config.js'); ensure(response.status === 200, stage, 'runtime_not_ready', response.status);
      const source = await response.text(), match = source.match(/^\s*window\.__NEXERP_CONFIG__\s*=\s*(\{[^]*\})\s*;?\s*$/u);
      ensure(match, stage, 'unexpected_runtime_script');
      let config; try { config = JSON.parse(match[1]); } catch { throw new AcceptanceFailure(stage, 'invalid_runtime_json'); }
      ensure(config.url === SANDBOX_ORIGIN && publicKeys.includes(config.publishableKey) && Object.keys(config).sort().join(',') === 'publishableKey,url' && !source.includes(serviceKey), stage, 'runtime_sandbox_pin_failed');
      const catalog = await request(STAGING_ORIGIN + '/products.json');
      if (catalog.ok) { let payload; try { payload = JSON.parse(await catalog.text()); } catch {} ensure(!Array.isArray(payload) && !payload?.products, stage, 'legacy_catalog_public'); }
    });
    stage = 'synthetic_fixture_setup'; setupStarted = true;
    await db(admin.from('organizations').insert({ id: organization, name: marker, slug: marker }).select(), 'insert_organization');
    const created = await admin.auth.admin.createUser({ id: actor, email, password, email_confirm: true,
      app_metadata: { organization_id: organization, momo_acceptance_run_id: runId }, user_metadata: { first_name: 'SYNTHETIC', last_name: 'Hosted browser' } });
    ensure(!created.error && created.data?.user?.id === actor, stage, safeCode(created.error?.code), created.error?.status);
    const bound = await db(admin.from('profiles').update({ organization_id: organization, status: 'active' }).eq('id', actor).select('id,organization_id'), 'bind_synthetic_profile');
    ensure(bound.length === 1 && bound[0].organization_id === organization, stage, 'profile_not_bound');
    await db(admin.from('roles').insert({ id: role, organization_id: organization, name: marker }).select(), 'insert_role');
    const permissions = ['dashboard.view', 'leads.read', 'leads.create', 'leads.update', 'calls.create', 'orders.read', 'orders.create', 'orders.update', 'orders.cancel',
      'products.read', 'products.manage', 'inventory.read', 'inventory.manage', 'deliveries.read', 'deliveries.manage', 'finance.view', 'finance.manage', 'reports.view', 'pages.read'];
    await db(admin.from('role_permissions').insert(permissions.map(permission_code => ({ role_id: role, permission_code }))).select(), 'insert_permissions');
    await db(admin.from('user_roles').insert({ user_id: actor, role_id: role }).select(), 'insert_user_role');
    await db(admin.from('facebook_pages').insert({ id: pageId, organization_id: organization, name: marker, external_page_id: '990000000000099' }).select(), 'insert_synthetic_page');
    browser = await chromiumDriver.launch({ executablePath: chromiumPath, headless: true,
      args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--metrics-recording-only', '--no-first-run'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block', acceptDownloads: false });
    const sdk = await readFile(join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === STAGING_ORIGIN && !url.username && !url.password) { report.network.stagingBrowserRequests = (report.network.stagingBrowserRequests ?? 0) + 1; return route.continue(); }
      if (url.origin === SANDBOX_ORIGIN && !url.username && !url.password &&
        (/^\/rest\/v1(?:\/|$)/u.test(url.pathname) || ['/auth/v1/token', '/auth/v1/user', '/auth/v1/logout'].includes(url.pathname))) {
        report.network.sandboxBrowserRequests = (report.network.sandboxBrowserRequests ?? 0) + 1; return route.continue();
      }
      if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname === '/npm/@supabase/supabase-js@2.112.3') return route.fulfill({ contentType: 'application/javascript', body: sdk });
      if (url.origin === 'https://unpkg.com' && url.pathname.includes('lucide@0.468.0')) return route.fulfill({ contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};' });
      report.network.blockedExternalRequests++;
      if (url.hostname.includes('supabase.co') || url.origin === 'https://erp.momoshop.mn' || /facebook|graph\.meta/u.test(url.hostname)) report.network.forbiddenBackendRequests++;
      return route.abort();
    });
    if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => { report.network.blockedExternalRequests++; socket.close(); });
    page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', error => pageErrors.push({ name: safeCode(error.name) }));
    page.on('response', response => { const url = new URL(response.url()); if (url.origin === SANDBOX_ORIGIN && response.status() >= 400) backendErrors.push({ path: url.pathname, status: response.status() }); });
    await page.goto(STAGING_ORIGIN, { waitUntil: 'domcontentloaded' });
    await check('Hosted real Auth rejects a wrong password and restores the submit button', async () => {
      await page.locator('#login-form [name=email]').fill(email); await page.locator('#login-form [name=password]').fill('not-the-synthetic-password'); await submit('#login-form');
      await page.locator('#auth-error').waitFor({ state: 'visible' });
      ensure(await page.locator('#login-form [type=submit]').isEnabled(), stage, 'login_button_stuck');
      ensure(await page.locator('.app-shell').getAttribute('aria-hidden') === 'true', stage, 'unauthenticated_shell_visible');
    });
    await check('Hosted login loads real profile/RBAC and an empty organization dashboard', async () => {
      await page.locator('#login-form [name=password]').fill(password); await submit('#login-form');
      await page.waitForFunction(() => document.body.classList.contains('auth-ready')); await ready();
      ensure(await page.evaluate(id => window.nexerpAuth.profile.organizationId === id, organization), stage, 'unexpected_browser_organization');
      ensure((await page.locator('#dashboard-orders').textContent()).trim() === '0' && (await page.locator('#dashboard-sales').textContent()).replace(/\D/gu, '') === '0', stage, 'nonempty_synthetic_dashboard');
      ensure(await page.evaluate(() => Object.keys(window.momoCoreUi.snapshot.errors).length === 0), stage, 'core_read_errors');
    });
    await check('Hosted warehouse/product create and product edit persist through real PostgREST RPCs', async () => {
      await nav('warehouse'); await page.locator('#core-add-warehouse').click(); await page.locator('#core-action-form [name=name]').fill('SYNTHETIC hosted warehouse'); await submit('#core-action-form');
      await page.waitForFunction(() => window.momoCoreUi.snapshot.warehouses.length === 1);
      await nav('products'); await page.locator('#add-product').click();
      for (const [name, value] of Object.entries({ name: 'SYNTHETIC hosted хайрцаг', sku: 'SYNTH-HOSTED-001', price: '12000', cost: '5000' })) await page.locator('#product-form [name=' + name + ']').fill(value);
      await submit('#product-form'); await page.waitForFunction(() => window.momoCoreUi.snapshot.products.length === 1);
      await page.locator('#product-grid [data-edit-product]').click(); await page.locator('#product-form [name=price]').fill('15000'); await submit('#product-form');
      await page.waitForFunction(() => Number(window.momoCoreUi.snapshot.products[0]?.sale_price) === 15000);
      const products = await db(owned('products', 'id,sku,sale_price'), 'verify_product');
      ensure(products.length === 1 && products[0].sku === 'SYNTH-HOSTED-001' && Number(products[0].sale_price) === 15000, stage, 'product_not_persisted');
      ensure((await db(owned('warehouses', 'id'), 'verify_warehouse')).length === 1, stage, 'warehouse_not_persisted');
    });
    await check('Hosted inventory adjustment persists stock and movement history', async () => {
      await nav('warehouse'); await page.locator('#core-adjust-inventory').click(); await page.locator('#movementProductSearch').fill('SYNTH-HOSTED-001');
      await page.locator('#movement-product-results [data-product-result]').click(); await page.locator('#core-action-form [name=quantity_delta]').fill('10');
      await page.locator('#core-action-form [name=note]').fill('Synthetic hosted stock receipt'); await submit('#core-action-form');
      await page.waitForFunction(() => window.momoCoreUi.snapshot.balances[0]?.quantity === 10);
      const stock = await db(owned('inventory_balances', 'quantity'), 'verify_stock'); ensure(stock.length === 1 && stock[0].quantity === 10, stage, 'stock_not_persisted');
      ensure((await db(owned('inventory_movements', 'id'), 'verify_movement')).length === 1, stage, 'movement_not_persisted');
    });
    await check('Hosted order form atomically persists order/items/delivery and reserves trusted-price stock', async () => {
      await nav('orders'); await page.locator('[data-open-order]:visible').first().click();
      for (const [name, value] of Object.entries({ customer: 'SYNTHETIC hosted customer', phone: '00000001', address: 'SYNTHETIC hosted test address' })) await page.locator('#order-form [name=' + name + ']').fill(value);
      await page.locator('#order-product-search').fill('SYNTH-HOSTED-001'); await page.locator('#order-product-results [data-product-result]').first().click();
      const warehouse = await page.evaluate(() => window.momoCoreUi.snapshot.warehouses[0].id);
      await page.locator('#order-form [name=warehouse_id]').selectOption(warehouse); await page.locator('#order-form [name=quantity]').fill('2'); await page.locator('#order-form [name=collectAmount]').fill('30000');
      await submit('#order-form'); await page.waitForFunction(() => window.momoCoreUi.snapshot.orders.length === 1);
      const orders = await db(owned('orders', 'id,product_total,collect_amount,is_demo,inventory_reserved'), 'verify_order');
      ensure(orders.length === 1 && Number(orders[0].product_total) === 30000 && Number(orders[0].collect_amount) === 30000 && orders[0].is_demo === false && orders[0].inventory_reserved, stage, 'order_not_persisted');
      const items = await db(owned('order_items', 'quantity,unit_price'), 'verify_items'); ensure(items.length === 1 && items[0].quantity === 2 && Number(items[0].unit_price) === 15000, stage, 'items_wrong_price');
      ensure((await db(owned('deliveries', 'id'), 'verify_delivery')).length === 1 && (await db(owned('inventory_balances', 'quantity'), 'verify_reserved_stock'))[0]?.quantity === 8, stage, 'delivery_or_stock_not_atomic');
    });
    await check('Hosted lead and call forms persist synthetic customer numbers', async () => {
      await nav('leads'); await page.locator('#open-lead').click(); await page.locator('#lead-form [name=page]').selectOption(pageId);
      await page.locator('#lead-form [name=leadCustomer]').first().fill('SYNTHETIC hosted lead'); await page.locator('#lead-form [name=leadPhone]').first().fill('00000002');
      await page.locator('#lead-product-search').fill('SYNTH-HOSTED-001'); await page.locator('#lead-product-results [data-product-result]').first().click();
      await submit('#lead-form'); await page.waitForFunction(() => window.momoCoreUi.snapshot.leads.length === 1);
      await page.locator('[data-core-call]').first().click(); await page.waitForFunction(() => window.momoCoreUi.snapshot.leads[0]?.call_attempts === 1);
      const leads = await db(owned('leads', 'phone_normalized,call_attempts,is_demo'), 'verify_leads');
      ensure(leads.length === 1 && leads[0].phone_normalized === '00000002' && leads[0].call_attempts === 1 && leads[0].is_demo === false, stage, 'lead_not_persisted');
      ensure((await db(owned('call_logs', 'id'), 'verify_call')).length === 1, stage, 'call_not_persisted');
    });
    await check('Hosted reload retains real records and ignores poisoned legacy demo localStorage', async () => {
      await page.evaluate(() => { for (const key of ['orders', 'nexerp-orders', 'momo-orders']) localStorage.setItem(key, JSON.stringify([{ id: 'DEMO-POISON', amount: 999999999 }])); });
      await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
      ensure(await page.evaluate(() => window.momoCoreUi.snapshot.orders.length === 1 && !document.body.textContent.includes('DEMO-POISON')), stage, 'demo_poison_or_reload_loss');
    });
    await check('Hosted delivery transitions and cashflow update the real dashboard', async () => {
      await nav('delivery');
      for (const status of ['in_transit', 'delivered']) {
        await page.locator('[data-core-delivery]').first().click(); await page.locator('#core-action-form [name=status]').selectOption(status); await submit('#core-action-form');
        await page.waitForFunction(value => window.momoCoreUi.snapshot.deliveries[0]?.status === value, status);
      }
      await nav('finance'); await page.locator('#core-add-finance').click(); await page.locator('#core-action-form [name=amount]').fill('30000');
      await page.locator('#core-action-form [name=description]').fill('Synthetic hosted receipt');
      await page.locator('#core-action-form [name=order_id]').selectOption(await page.evaluate(() => window.momoCoreUi.snapshot.orders[0].id)); await submit('#core-action-form');
      await page.waitForFunction(() => Number(window.momoCoreUi.snapshot.summary.finance.income) === 30000);
      await nav('dashboard'); ensure((await page.locator('#dashboard-sales').textContent()).replace(/\D/gu, '') === '30000', stage, 'dashboard_did_not_follow_receipt');
      const finance = await db(owned('finance_entries', 'amount,is_demo'), 'verify_cashflow'); ensure(finance.length === 1 && Number(finance[0].amount) === 30000 && finance[0].is_demo === false, stage, 'cashflow_not_persisted');
      ensure((await db(owned('orders', 'status'), 'verify_delivered_order'))[0]?.status === 'delivered', stage, 'order_delivery_not_synced');
    });
    await check('Hosted catalog archive persists and preserves already reserved stock', async () => {
      await nav('products'); await page.locator('#product-grid [data-archive-product]').click();
      await page.waitForFunction(() => window.momoCoreUi.snapshot.products[0]?.is_active === false);
      const products = await db(owned('products', 'is_active'), 'verify_archive'); ensure(products.length === 1 && products[0].is_active === false, stage, 'archive_not_persisted');
      ensure((await db(owned('inventory_balances', 'quantity'), 'verify_archived_stock'))[0]?.quantity === 8, stage, 'archive_changed_stock');
    });
    await check('Hosted RPC denies a revoked permission despite stale browser grants', async () => {
      await db(admin.from('role_permissions').delete().eq('role_id', role).eq('permission_code', 'products.manage').select(), 'revoke_owned_permission');
      const denied = await page.evaluate(async () => { try { await window.momoCoreUi.service.saveProduct({ sku: 'SYNTH-REVOKED-NOT-WRITTEN', name: 'SYNTHETIC denied', sale_price: 1 }); return false; } catch (error) { return error.code === '42501'; } });
      ensure(denied, stage, 'revoked_permission_not_enforced');
      ensure((await db(owned('products', 'id').eq('sku', 'SYNTH-REVOKED-NOT-WRITTEN'), 'verify_denied_write')).length === 0, stage, 'revoked_write_persisted');
    });
    await check('Hosted core mutations have organization/actor-bound audit entries', async () => {
      const audits = await db(owned('audit_logs', 'action,actor_id'), 'verify_audit');
      for (const action of ['core.product.save', 'core.warehouse.save', 'core.inventory.adjust', 'core.order.create', 'core.leads.create', 'core.lead.update', 'core.delivery.update', 'core.finance.record']) ensure(audits.some(item => item.action === action && item.actor_id === actor), stage, 'missing_core_audit');
      report.auditActionsVerified = [...new Set(audits.map(item => item.action))];
    });
    await check('Hosted logout clears the authorized shell and private client state', async () => {
      const navigation = page.waitForEvent('load'); page.once('dialog', dialog => dialog.accept()); await page.locator('#auth-profile').click(); await navigation;
      await page.locator('#login-form').waitFor({ state: 'visible' }); ensure(await page.evaluate(() => window.nexerpAuth === undefined), stage, 'logout_private_state_retained');
    });
    await check('Public staging login screenshot contains no credentials or authorized shell', async () => {
      // Logout may retain a harmless view hash. A fresh canonical load also
      // verifies that no persisted session restores the authorized shell.
      await page.goto(STAGING_ORIGIN + '/');
      await page.locator('#login-form').waitFor({ state: 'visible' });
      await page.locator('#login-form [name=email]').fill(''); await page.locator('#login-form [name=password]').fill('');
      ensure(await page.locator('.app-shell').getAttribute('aria-hidden') === 'true' && await page.locator('#login-form [name=email]').inputValue() === '' &&
        await page.locator('#login-form [name=password]').inputValue() === '' && page.url() === STAGING_ORIGIN + '/', stage, 'unsafe_login_screenshot');
      const screenshot = join(root, 'docs/evidence/hosted-erp-staging-login.png');
      await page.screenshot({ path: screenshot, fullPage: true }); report.publicLoginScreenshot = screenshot;
    });
    report.checks.push({ name: 'Hosted password recovery/invitation email', status: 'SKIPPED', reason: 'No external email is authorized; local real GoTrue/Mailpit recovery and invitation acceptance is separate evidence.' });
    await check('Hosted browser has no unhandled errors, forbidden backend destination or backend mocks', async () => {
      const unexpected = backendErrors.filter(item => !((item.path === '/auth/v1/token' && item.status === 400) || (item.path === '/rest/v1/rpc/core_save_product' && item.status === 403)));
      ensure(pageErrors.length === 0 && unexpected.length === 0 && report.network.forbiddenBackendRequests === 0, stage, 'browser_backend_or_network_errors');
    });
    report.status = 'PASS_WITH_SKIPS';
  } catch (error) {
    report.status = 'FAIL'; report.failedStage = error.stage ?? stage; report.failure = { code: safeCode(error.code ?? error.name), ...(Number.isInteger(error.status) ? { status: error.status } : {}) };
    report.checks.push({ name: stage, status: 'FAIL' }); report.browserErrorCount = pageErrors.length; report.backendErrors = backendErrors;
    if (page && !page.isClosed()) report.browserState = await page.evaluate(() => ({ authorized: !!window.nexerpAuth, coreStatus: window.momoCoreUi?.snapshot?.status ?? null,
      coreErrorKeys: Object.keys(window.momoCoreUi?.snapshot?.errors ?? {}), authErrorVisible: !document.querySelector('#auth-error')?.hidden })).catch(() => null);
  } finally {
    stage = 'cleanup'; const errors = [];
    try { await browser?.close(); } catch { errors.push({ resource: 'browser', code: 'close_failed' }); }
    const remove = async (table, column, value) => { try { const rows = await db(admin.from(table).delete().eq(column, value).select(), 'cleanup_' + table); report.cleanup.counts[table] = rows.length; } catch (error) { errors.push({ resource: table, code: safeCode(error.code), status: error.status }); } };
    if (setupStarted) {
      let safe = false;
      try { const organizations = await db(admin.from('organizations').select('id,slug').eq('id', organization), 'verify_cleanup_ownership'); safe = organizations.length === 0 || (organizations.length === 1 && organizations[0].slug === marker); } catch { errors.push({ resource: 'ownership', code: 'read_failed' }); }
      if (safe) {
        for (const table of ['finance_entries', 'call_logs', 'order_status_history', 'deliveries', 'order_items', 'orders', 'leads', 'lead_batches', 'inventory_movements', 'inventory_balances', 'products', 'warehouses', 'categories', 'facebook_pages', 'audit_logs']) await remove(table, 'organization_id', organization);
        await remove('user_roles', 'user_id', actor); await remove('role_permissions', 'role_id', role); await remove('roles', 'id', role);
        let removedUser = false;
        try {
          const found = await admin.auth.admin.getUserById(actor);
          if (found.error?.status === 404) removedUser = true;
          else {
            ensure(!found.error && found.data?.user?.email === email && found.data.user.app_metadata?.momo_acceptance_run_id === runId, stage, 'auth_ownership_mismatch');
            const deleted = await admin.auth.admin.deleteUser(actor); ensure(!deleted.error, stage, safeCode(deleted.error?.code), deleted.error?.status);
            const absent = await admin.auth.admin.getUserById(actor); ensure(absent.error?.status === 404, stage, 'auth_deletion_not_verified'); removedUser = true; report.cleanup.counts.authUsers = 1;
          }
        } catch (error) { errors.push({ resource: 'auth', code: safeCode(error.code), status: error.status }); }
        if (removedUser && errors.length === 0) await remove('organizations', 'id', organization);
        for (const [table, id] of [['profiles', actor], ['organizations', organization], ['roles', role]]) {
          try { const rows = await db(admin.from(table).select('id').eq('id', id), 'verify_cleanup_' + table); report.cleanup.remaining[table] = rows.length; if (rows.length) errors.push({ resource: table, code: 'owned_rows_remain' }); } catch (error) { errors.push({ resource: table, code: safeCode(error.code) }); }
        }
        for (const table of ['orders', 'order_items', 'deliveries', 'finance_entries', 'leads', 'call_logs', 'products', 'warehouses', 'inventory_balances', 'inventory_movements', 'audit_logs']) {
          try { const rows = await db(owned(table, table === 'inventory_balances' ? 'warehouse_id' : 'id'), 'verify_cleanup_' + table); report.cleanup.remaining[table] = rows.length; if (rows.length) errors.push({ resource: table, code: 'owned_rows_remain' }); } catch (error) { errors.push({ resource: table, code: safeCode(error.code) }); }
        }
      } else errors.push({ resource: 'ownership', code: 'owned_parent_not_verified' });
      report.cleanup.status = errors.length ? 'FAIL' : 'PASS'; report.cleanup.errors = errors; report.cleanup.providerAuditLogsRetained = true;
      ledger.cleanup = report.cleanup.status; await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
      if (errors.length) report.status = 'FAIL';
    } else if (errors.length) { report.cleanup.status = 'FAIL'; report.cleanup.errors = errors; report.status = 'FAIL'; }
  }
  report.counts = { pass: report.checks.filter(item => item.status === 'PASS').length, fail: report.checks.filter(item => item.status === 'FAIL').length + (report.cleanup.status === 'FAIL' ? 1 : 0), skipped: report.checks.filter(item => item.status === 'SKIPPED').length };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const result = await runHostedErpBrowser(parseHostedBrowserArgs(process.argv.slice(2))); console.log(JSON.stringify({ status: result.status, counts: result.counts, cleanup: result.cleanup?.status, failedStage: result.failedStage, failure: result.failure })); if (result.status === 'FAIL') process.exitCode = 1; }
  catch (error) { console.error(JSON.stringify({ status: 'FAIL', stage: error.stage ?? 'setup', code: safeCode(error.code ?? error.name) })); process.exitCode = 1; }
}
