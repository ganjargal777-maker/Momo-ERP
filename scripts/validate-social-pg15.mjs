// Fail-closed entry for the complete synthetic-only PostgreSQL15 regression.
// Does not load .env files, select existing databases, or use remote Docker.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const root=resolve(process.env.MOMO_ERP_TEST_ROOT||join(dirname(fileURLToPath(import.meta.url)),'..'));
const dockerBin=process.env.MOMO_LOCAL_DOCKER_BIN;
if(!dockerBin||!isAbsolute(dockerBin)||!existsSync(dockerBin)){
  throw new Error('Set MOMO_LOCAL_DOCKER_BIN to the installed local Docker executable before running test:pg15; database validation cannot silently skip.');
}
const dockerHost=process.env.MOMO_LOCAL_DOCKER_HOST||(process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock');
if(dockerHost!=='npipe:////./pipe/dockerDesktopLinuxEngine'&&!/^unix:\/\/\/[^\u0000\r\n]+$/u.test(dockerHost))throw new Error('A local Docker named pipe/unix socket is required.');
const evidencePath=process.env.MOMO_PHASE4_EVIDENCE_PATH||join(tmpdir(),'momo-social-pg15-evidence-'+randomUUID()+'.json');
const environment={...process.env,MOMO_LOCAL_DOCKER_BIN:dockerBin,MOMO_LOCAL_DOCKER_HOST:dockerHost,MOMO_PHASE4_EVIDENCE_PATH:evidencePath,MOMO_ERP_TEST_ROOT:root};
for(const name of ['LOCAL_DB_URL','DATABASE_URL','MOMO_PHASE4_ISOLATED_DB','MOMO_ALIGNMENT_SQL','MOMO_LOCAL_PG_BIN'])delete environment[name];
console.log('Running all ERP tests with a newly allocated loopback-only PostgreSQL15 Docker database.');
const result=spawnSync(process.execPath,['--test','test/*.test.mjs'],{cwd:root,env:environment,stdio:'inherit',windowsHide:true});
if(result.error)throw new Error('Could not start the ERP regression process.');
console.log('Synthetic PostgreSQL evidence file: '+evidencePath);
process.exitCode=result.status??1;
