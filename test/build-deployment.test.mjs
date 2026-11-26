import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDeployment, PUBLIC_FILES } from '../scripts/build-deployment.mjs';

test('deploy artifact excludes legacy catalogs/server files and replaces only owned build output', t => {
  const root = mkdtempSync(join(tmpdir(), 'momo-public-build-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir())); assert.ok(basename(root).startsWith('momo-public-build-'));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'dist/assets'), { recursive: true });
  for (const file of PUBLIC_FILES.filter(name => name !== 'runtime-config.js')) writeFileSync(join(root, 'dist', file), 'fixture-public-file');
  writeFileSync(join(root, 'dist/assets/logo.png'), 'fixture-image');
  writeFileSync(join(root, 'dist/products.json'), '{"cost":900,"stock":999}');
  writeFileSync(join(root, 'dist/private-export.json'), 'synthetic-private-record');
  const env = { VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_only_123456789' };
  buildDeployment({ rootDirectory: root, env });
  assert.equal(existsSync(join(root, 'build/products.json')), false);
  assert.equal(existsSync(join(root, 'build/private-export.json')), false);
  assert.equal(readFileSync(join(root, 'dist/products.json'), 'utf8'), '{"cost":900,"stock":999}');
  assert.ok(existsSync(join(root, 'build/assets/logo.png')));
  writeFileSync(join(root, 'build/stale.json'), 'old');
  buildDeployment({ rootDirectory: root, env });
  assert.equal(existsSync(join(root, 'build/stale.json')), false);
  assert.ok(readFileSync(join(root, 'build/runtime-config.js'), 'utf8').includes('sb_publishable_synthetic_only'));
});
