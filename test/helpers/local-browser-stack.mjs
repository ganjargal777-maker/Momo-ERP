import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import net from 'node:net';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const pause = ms => new Promise(done => setTimeout(done, ms));

async function checkPort(port) {
  const server = net.createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  await new Promise(done => server.close(done));
}

/** Real local GoTrue/PostgREST/Mailpit; no linked metadata or production env. */
export async function startBrowserStack({ dockerBin, uiOrigin }) {
  const ui = new URL(uiOrigin);
  if (ui.protocol !== 'http:' || ui.hostname !== '127.0.0.1' || ui.pathname !== '/') throw new Error('Loopback UI origin required.');
  const runId = randomUUID();
  const projectId = 'momo-browser-' + runId.slice(0, 12);
  const directory = await mkdtemp(join(tmpdir(), 'momo-browser-stack-'));
  const cli = join(root, 'node_modules/supabase/dist/supabase.js');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(?:SystemRoot|windir|PATH|PATHEXT|TEMP|TMP|LOCALAPPDATA|APPDATA|USERPROFILE|HOMEDRIVE|HOMEPATH|PROGRAMFILES)$/iu.test(key)));
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  environment[pathKey] = dirname(dockerBin) + ';' + (environment[pathKey] ?? '');
  environment.DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine';
  const run = async (args, timeout = 180000) => {
    try { return await execute(process.execPath, [cli, '--workdir', directory, ...args], {
      env: environment, windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024,
    }); } catch (error) {
      // CLI start/status may output service-role or JWT secrets. Never attach
      // stdout/stderr to errors, reports, screenshots or the shared log.
      throw Object.assign(new Error('Local Supabase CLI stage failed: ' + args[0]), {
        stage: args[0], exitCode: error.code,
      });
    }
  };
  let initialized = false, stopped = false;
  const stop = async () => {
    if (stopped) return;
    if (initialized) {
      const marker = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8'));
      if (marker.runId !== runId || marker.projectId !== projectId ||
          dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('momo-browser-stack-')) {
        throw new Error('Refusing to clean unowned browser test stack.');
      }
      // --all is deliberately never accepted. Only this unique local project.
      await run(['stop', '--project-id', projectId, '--no-backup']);
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    stopped = true;
  };
  try {
    await run(['init']);
    const basePort = 20000 + Math.floor(Math.random() * 20000);
    for (let offset = 0; offset < 6; offset++) await checkPort(basePort + offset);
    const config = {
      project_id: projectId,
      api: { enabled: true, port: basePort, schemas: ['public'], extra_search_path: ['public', 'extensions'], max_rows: 1000 },
      db: { port: basePort + 1, shadow_port: basePort + 2, major_version: 15, seed: { enabled: false, sql_paths: [] } },
      auth: { enabled: true, site_url: uiOrigin,
        additional_redirect_urls: [uiOrigin, uiOrigin + '/?reset=1', uiOrigin + '/?setup=1'],
        enable_signup: false, email: { enable_signup: true, enable_confirmations: false, max_frequency: '1s' } },
      local_smtp: { enabled: true, port: basePort + 3 },
      studio: { enabled: false }, realtime: { enabled: false }, storage: { enabled: false },
      analytics: { enabled: false }, edge_runtime: { enabled: false },
    };
    await writeFile(join(directory, 'supabase/config.jsonc'), JSON.stringify(config, null, 2));
    await writeFile(join(directory, 'owner.json'), JSON.stringify({ runId, projectId }));
    initialized = true;
    await run(['start', '--exclude', 'realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
    const status = await run(['status', '--output-format', 'json']);
    let parsed;
    try { parsed = JSON.parse(status.stdout); } catch { throw new Error('Local stack status must be JSON.'); }
    // CLI versions may wrap status in data; only these exact local fields are used.
    const values = parsed.data ?? parsed;
    const apiUrl = values.API_URL ?? values.api_url;
    const dbUrl = values.DB_URL ?? values.db_url;
    const publicKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY ?? values.publishable_key ?? values.anon_key;
    const serviceKey = values.SECRET_KEY ?? values.SERVICE_ROLE_KEY ?? values.secret_key ?? values.service_role_key;
    const mailUrl = values.MAILPIT_URL ?? values.INBUCKET_URL ?? values.mailpit_url ?? `http://127.0.0.1:${basePort + 3}`;
    for (const address of [apiUrl, dbUrl, mailUrl]) {
      const url = new URL(address);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Non-local test stack address rejected.');
    }
    if (!publicKey || !serviceKey) throw new Error('Local stack keys missing.');
    return { apiUrl, dbUrl, publicKey, serviceKey, mailUrl, projectId, stop,
      publicSummary: { projectId, host: '127.0.0.1', postgresMajor: 15, auth: 'real-local-GoTrue', rest: 'real-local-PostgREST', mail: 'local-Mailpit-no-external-email' } };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}
