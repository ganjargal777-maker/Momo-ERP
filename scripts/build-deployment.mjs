import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRuntimeConfig } from './build-runtime-config.mjs';

// dist/ is authored source and contains a legacy catalog export. Never publish
// the whole directory: static cost/stock data cannot be protected by RLS.
export const PUBLIC_FILES = Object.freeze(['index.html', 'styles.css', 'app.js', 'auth.js',
  'core-service.js', 'core-ui.js', 'social-service.js', 'social.js', 'favicon.svg', 'runtime-config.js']);
export function buildDeployment({ rootDirectory = resolve(import.meta.dirname, '..'), env = process.env } = {}) {
  const root = resolve(rootDirectory), output = join(root, 'build');
  buildRuntimeConfig({ rootDirectory: root, env });
  const stage = mkdtempSync(join(root, '.build-stage-'));
  try {
    for (const file of PUBLIC_FILES) cpSync(join(root, 'dist', file), join(stage, file), { errorOnExist: true });
    cpSync(join(root, 'dist/assets'), join(stage, 'assets'), { recursive: true, errorOnExist: true });
    // Only this fixed output directory is replaced; authored source and legacy
    // catalog are preserved. Build never accesses a database or Auth endpoint.
    if (dirname(output) !== root) throw new Error('Build output escaped project.');
    if (existsSync(output)) rmSync(output, { recursive: true, force: true });
    renameSync(stage, output);
    return { outputDirectory: 'build', publicFiles: [...PUBLIC_FILES], legacyCatalogPublished: false };
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const result = buildDeployment(); console.log(JSON.stringify(result)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
