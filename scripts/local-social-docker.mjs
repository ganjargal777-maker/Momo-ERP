import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { isIP } from 'node:net';

export const LOCAL_PG_IMAGE_TAG = 'public.ecr.aws/supabase/postgres:15.20.0.004';
const LABEL = 'momo.local-validation.run-id';
const ID = /^[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const startup = [
  'set -eu', 'umask 077',
  'printf "%s\\n" "$MOMO_LOCAL_DB_PASSWORD" > /tmp/momo-fixture-password',
  'initdb -D /tmp/momo-pg-data -U momo_local --auth-host=scram-sha-256 --auth-local=trust --pwfile=/tmp/momo-fixture-password --encoding=UTF8 --no-locale >/tmp/momo-initdb.log 2>&1',
  'printf "\\nhost all momo_local %s scram-sha-256\\n" "$MOMO_LOCAL_DB_GATEWAY_CIDR" >> /tmp/momo-pg-data/pg_hba.conf',
  'rm /tmp/momo-fixture-password', 'unset MOMO_LOCAL_DB_PASSWORD',
  'unset MOMO_LOCAL_DB_GATEWAY_CIDR',
  'exec postgres -D /tmp/momo-pg-data -h 0.0.0.0 -p 5432 -c max_connections=40 -c log_statement=none -c fsync=off -c unix_socket_directories=/tmp -c logging_collector=off'
].join('\n');

// Every database is new and disposable. No existing Supabase container, host
// volume, default Docker context, remote daemon, project .env, or registry pull.
export async function startDockerPostgres15({
  dockerBin, dockerHost = 'npipe:////./pipe/dockerDesktopLinuxEngine',
  runner = spawnSync, sleep = pause, readinessAttempts = 60,
} = {}) {
  if (typeof dockerBin !== 'string' || !isAbsolute(dockerBin)) throw new Error('Absolute local Docker executable required');
  if (dockerHost !== 'npipe:////./pipe/dockerDesktopLinuxEngine' &&
      !(typeof dockerHost === 'string' && /^unix:\/\/\/[^\u0000\r\n]+$/u.test(dockerHost))) {
    throw new Error('Only the local Docker Desktop Linux pipe or a local unix socket is allowed');
  }
  if (typeof runner !== 'function' || typeof sleep !== 'function' ||
      !Number.isInteger(readinessAttempts) || readinessAttempts < 1 || readinessAttempts > 120) {
    throw new Error('Invalid Docker test lifecycle dependencies');
  }
  const runId = randomUUID(), containerName = 'momo-phase4-pg15-' + runId.slice(0, 12);
  const networkName = containerName + '-network', password = randomBytes(24).toString('hex');
  const childEnv = { ...process.env, MOMO_LOCAL_DB_PASSWORD: password };
  for (const key of ['DOCKER_CONTEXT', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete childEnv[key];
  let containerId, networkId, imageId, gateway, stopped = false;

  const command = (args, { optional = false } = {}) => {
    let result;
    try {
      result = runner(dockerBin, ['--host', dockerHost, ...args], {
        encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, env: childEnv,
      });
    } catch { throw new Error('Local Docker command could not execute: ' + args[0]); }
    if (result?.error || result?.status !== 0) {
      if (optional) return null;
      // Raw Docker output can include env/config; keep the error a safe stage.
      throw new Error('Local Docker command failed: ' + args.slice(0, 2).join(' ') +
        ' (exit ' + String(result?.status ?? 'unknown') + ')');
    }
    return String(result.stdout ?? '').trim();
  };

  function execInContainer(args) {
    if (stopped || !containerId) throw new Error('Owned test container is not running');
    const allowed = new Set(['pg_dump', 'pg_restore', 'createdb', 'dropdb', 'psql', 'postgres', 'pg_isready']);
    if (!Array.isArray(args) || !allowed.has(args[0]) || args.length > 100 ||
        args.some(value => typeof value !== 'string' || value.length > 4096 || /[\u0000\r\n]/u.test(value) || value.includes('://'))) {
      throw new Error('Invalid local database utility invocation');
    }
    for (let i = 1; i < args.length; i++) {
      const value = args[i];
      const host = value === '-h' || value === '--host' ? args[++i] : value.startsWith('--host=') ? value.slice(7) : null;
      if (host !== null && !['127.0.0.1', 'localhost', '/tmp'].includes(host)) throw new Error('Only local database hosts are allowed');
      if (value.startsWith('-h') && value !== '-h' && !['-h127.0.0.1', '-hlocalhost', '-h/tmp'].includes(value)) throw new Error('Only local database hosts are allowed');
      if (!value.startsWith('--host=') && /\b(?:host|hostaddr|service|password|passfile)\s*=/iu.test(value)) throw new Error('Database connection strings are not accepted by this local helper');
    }
    if (args[0] === 'pg_dump') {
      const index = args.findIndex(value => value === '-f' || value === '--file');
      const file = index >= 0 ? args[index + 1] : args.find(value => value.startsWith('--file='))?.slice(7);
      if (typeof file !== 'string' || !/^\/tmp\/[a-zA-Z0-9_.-]+$/u.test(file) || file.includes('..')) throw new Error('Backup output must stay inside the owned container temporary directory');
    }
    const identity = command(['container', 'inspect', '--format', '{{.Id}}|{{index .Config.Labels "' + LABEL + '"}}', containerId]);
    if (identity !== containerId + '|' + runId) throw new Error('Refusing utility execution without this test run ownership');
    return command(['exec', '--env', 'PGPASSWORD=' + password, containerId, ...args]);
  }

  async function stop() {
    if (stopped) return;
    // Inspect only IDs and our unique label, never runtime Config.Env.
    const inspectTarget = containerId || containerName;
    const inspected = command(['container', 'inspect', '--format',
      '{{.Id}}|{{index .Config.Labels "' + LABEL + '"}}', inspectTarget], { optional: true });
    if (inspected !== null) {
      const [actualId, actualLabel] = inspected.split('|');
      if (!ID.test(actualId) || actualLabel !== runId || (containerId && actualId !== containerId)) {
        throw new Error('Refusing to remove a container without this test run ownership');
      }
      containerId = actualId;
      command(['container', 'rm', '--force', '--volumes', containerId]);
    } else if (containerId) {
      // A --rm container may have exited. A successful existence listing
      // distinguishes absence from a Docker-daemon failure.
      const matches = command(['container', 'ls', '--all', '--quiet', '--no-trunc',
        '--filter', 'id=' + containerId]);
      if (matches) throw new Error('Cannot verify owned test container cleanup');
    }
    if (networkId) {
      const label = command(['network', 'inspect', '--format',
        '{{index .Labels "' + LABEL + '"}}', networkId]);
      if (label !== runId) throw new Error('Refusing to remove a network without this test run ownership');
      command(['network', 'rm', networkId]);
    }
    stopped = true;
  }

  try {
    imageId = command(['image', 'inspect', '--format', '{{.Id}}', LOCAL_PG_IMAGE_TAG]);
    if (!IMAGE_ID.test(imageId)) throw new Error('Cached PostgreSQL image identity is invalid');
    // Docker 29 does not publish host ports on an internal-only bridge. A fresh
    // dedicated bridge plus explicit verified 127.0.0.1 publishing keeps the
    // database host-local; the test programs make no external connections.
    networkId = command(['network', 'create', '--driver', 'bridge', '--label', LABEL + '=' + runId,
      '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', networkName]);
    if (!ID.test(networkId)) throw new Error('Created test network identity is invalid');
    gateway = command(['network', 'inspect', '--format', '{{(index .IPAM.Config 0).Gateway}}', networkId]);
    if (isIP(gateway) !== 4) throw new Error('Dedicated local bridge must have one valid IPv4 gateway');
    childEnv.MOMO_LOCAL_DB_GATEWAY_CIDR = gateway + '/32';
    containerId = command(['run', '--detach', '--rm', '--pull=never', '--name', containerName,
      '--label', LABEL + '=' + runId, '--network', networkId,
      '--publish', '127.0.0.1::5432', '--user', 'postgres',
      '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true',
      '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777',
      '--env', 'MOMO_LOCAL_DB_PASSWORD', '--env', 'MOMO_LOCAL_DB_GATEWAY_CIDR', '--entrypoint', '/bin/sh', imageId, '-c', startup]);
    if (!ID.test(containerId)) throw new Error('Created test container identity is invalid');
    const version = command(['exec', containerId, 'postgres', '--version']);
    if (!/^postgres \(PostgreSQL\) 15\.\d+(?:\s.*)?$/u.test(version)) throw new Error('The test database image must be PostgreSQL 15');
    const published = command(['port', containerId, '5432/tcp']);
    const match = /^127\.0\.0\.1:(\d{1,5})$/u.exec(published);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw new Error('Test PostgreSQL must publish only on IPv4 loopback');
    let ready = false;
    for (let attempt = 0; attempt < readinessAttempts; attempt++) {
      if (command(['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'momo_local', '-d', 'postgres'], { optional: true }) !== null) {
        ready = true; break;
      }
      await sleep(500);
    }
    if (!ready) throw new Error('Fresh PostgreSQL 15 did not become ready');
    return { port: Number(match[1]), user: 'momo_local', password, imageId,
      imageTag: LOCAL_PG_IMAGE_TAG, version, containerName, containerId, networkId, gateway, stop, execInContainer };
  } catch (error) {
    try { await stop(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Local PostgreSQL start failed and owned cleanup needs attention');
    }
    throw error;
  }
}
