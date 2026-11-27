export const productionSetup = 'https://erp.momoshop.mn/?setup=1';
export const hostedSandboxSetup = 'https://momo-erp-social-sandbox.onrender.com/?setup=1';
export const canonicalOrigins = Object.freeze(['https://erp.momoshop.mn', 'http://localhost:4173']);

// Only a validated server-side setting selects where an emailed session goes.
// Dynamic HTTP loopback callbacks are for isolated local acceptance, never a
// request-body or Origin-header redirect override.
export function inviteRedirectUrl(configured = productionSetup) {
  if (configured === productionSetup || configured === hostedSandboxSetup) return configured;
  try {
    if (typeof configured !== 'string' || configured.length > 2048) throw new Error();
    const url = new URL(configured);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) ||
        !url.port || Number(url.port) < 1 || url.username || url.password || url.pathname !== '/' ||
        url.search !== '?setup=1' || url.hash || url.href !== configured) throw new Error();
    return url.href;
  } catch { throw new Error('Unsupported invitation callback'); }
}

export function isValidStartDate(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
