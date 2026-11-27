// Fail-closed entry for the complete synthetic-only PostgreSQL15 regression.
// Does not load .env files, select existing databases, or use remote Docker.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
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
// The harness always writes a fresh unique path. A caller's requested report
// is published only after this run, so an old PASS cannot be reused on a skip.
const evidencePath=join(tmpdir(),'momo-social-pg15-evidence-'+randomUUID()+'.json');
const publishedEvidence=process.env.MOMO_PHASE4_EVIDENCE_PATH;
const environment={...process.env,MOMO_LOCAL_DOCKER_BIN:dockerBin,MOMO_LOCAL_DOCKER_HOST:dockerHost,MOMO_PHASE4_EVIDENCE_PATH:evidencePath,MOMO_ERP_TEST_ROOT:root};
for(const name of ['LOCAL_DB_URL','DATABASE_URL','MOMO_PHASE4_ISOLATED_DB','MOMO_ALIGNMENT_SQL','MOMO_LOCAL_PG_BIN'])delete environment[name];
console.log('Running all ERP tests with a newly allocated loopback-only PostgreSQL15 Docker database.');
const startedAt=Date.now();
const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-reporter-destination=docs/evidence/core-pg15-tests.tap','test/*.test.mjs'],{cwd:root,env:environment,stdio:'inherit',windowsHide:true});
let evidence, fresh=false;
try { evidence=JSON.parse(readFileSync(evidencePath,'utf8'));fresh=statSync(evidencePath).mtimeMs>=startedAt-1500; }
catch { evidence={syntheticOnly:true,remoteChanges:false}; }
const exitCode=result.error?1:result.status??1;
const verified=exitCode===0&&fresh&&evidence.coreProduction?.status==='PASS'&&evidence.cleanup?.containerRemoved===true&&evidence.cleanup?.networkRemoved===true;
evidence.testRun={status:verified?'PASS':'FAIL',exitCode:verified?0:exitCode||1,startedAtUtc:new Date(startedAt).toISOString(),finishedAtUtc:new Date().toISOString(),freshEvidence:fresh};
writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
if(publishedEvidence)writeFileSync(publishedEvidence,JSON.stringify(evidence,null,2)+'\n');
console.log('Synthetic PostgreSQL evidence file: '+evidencePath);
process.exitCode=evidence.testRun.exitCode;
