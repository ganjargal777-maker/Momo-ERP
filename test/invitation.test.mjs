import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inviteRedirectUrl, isValidStartDate } from '../supabase/functions/invite-user/invitation.mjs';

test('invitations default to the existing hosted setup page', () => {
  assert.equal(inviteRedirectUrl(), 'https://erp.momoshop.mn/?setup=1');
});
test('the existing local setup callback remains allowed by helper and source Auth', async () => {
  const callback = 'http://localhost:4173/?setup=1';
  assert.equal(inviteRedirectUrl(callback), callback);
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const redirects = config.match(/additional_redirect_urls\s*=\s*(\[[^\]]*\])/u);
  assert.ok(JSON.parse(redirects[1]).includes(callback));
});
test('server-configured dynamic loopback ports support isolated real browser acceptance', () => {
  for (const callback of ['http://127.0.0.1:30231/?setup=1', 'http://localhost:30232/?setup=1']) {
    assert.equal(inviteRedirectUrl(callback), callback);
  }
});
test('callback validation rejects arbitrary hosts, extra query/path and noncanonical URL controls', () => {
  for (const callback of ['', 'https://example.invalid/?setup=1', 'http://localhost:4173/',
    'http://localhost:4173/?setup=1&next=elsewhere', 'http://127.0.0.1:30231/?setup=1#token',
    'http://user:password@127.0.0.1:30231/?setup=1', 'http://127.0.0.1:0/?setup=1',
    'http://127.0.0.1:99999/?setup=1', 'http://127.0.0.1/?setup=1', 'http://127.1:30231/?setup=1',
    'http://localhost.example.invalid:30231/?setup=1', 'http://localhost:30231/elsewhere?setup=1',
    'http://localhost:30231/?setup=%31', 'http://localhost:30231/?setup=1&setup=1',
    ' http://localhost:30231/?setup=1', 'https://localhost:30231/?setup=1', '*', {}, false]) {
    assert.throws(() => inviteRedirectUrl(callback), /Unsupported invitation callback/);
  }
});
test('start date accepts omitted dates and real calendar dates including leap days', () => {
  for (const date of [null, undefined, '', '2024-02-29', '2000-02-29', '2026-11-26']) assert.equal(isValidStartDate(date), true);
});
test('start date rejects impossible dates and non-string fields before sending mail', () => {
  for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '0000-01-01', '2026-00-01', '2026-11-00', '2026-1-1', 0, false, {}, ['2026-01-01']]) {
    assert.equal(isValidStartDate(date), false);
  }
});
