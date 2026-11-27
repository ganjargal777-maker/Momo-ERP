import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareHostedSandboxBundle, HOSTED_SOCIAL_MIGRATIONS, HOSTED_FUNCTION_FILES, EXCLUDED_HOSTED_MIGRATIONS } from '../scripts/prepare-hosted-social-sandbox.mjs';

const EVIDENCE='docs/evidence/core-pg15-validation.json';
const hash=value=>createHash('sha256').update(value).digest('hex');
const modulePath=fileURLToPath(new URL('../scripts/prepare-hosted-social-sandbox.mjs',import.meta.url));
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(?:SystemRoot|windir|PATH|TEMP|TMP|PATHEXT)$/iu.test(key)));
async function removeOwned(path,prefix){const canonical=await realpath(path);assert.equal(dirname(canonical),await realpath(tmpdir()));assert.ok(basename(canonical).startsWith(prefix));await rm(canonical,{recursive:true,force:true});}
async function fixture(t,{templates=true,nested=false}={}){
  const base=await mkdtemp(join(tmpdir(),'momo-hosted-bundle-test-')),sourceRoot=join(base,...(nested?['worktrees','erp']:['erp'])),target=join(base,'bundle');
  t.after(()=>removeOwned(base,'momo-hosted-bundle-test-'));
  const put=async(file,body)=>{const path=join(sourceRoot,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,body);};
  const migrations=[];
  for(const name of HOSTED_SOCIAL_MIGRATIONS){const text='-- Synthetic schema fixture '+name+'\n';await put('supabase/migrations/'+name,text);migrations.push({name,sha256:hash(text)});}
  const evidence={migrations,syntheticOnly:true,remoteChanges:false,testRun:{status:'PASS',exitCode:0},
    postgres:{host:'127.0.0.1',serverVersionNumber:150020},coreProduction:{status:'PASS'},coreBackupRestore:{status:'PASS'},
    transactionRollback:{transactionalRollback:true},cleanup:{containerRemoved:true,networkRemoved:true,persistentVolumeUsed:false}};
  await put(EVIDENCE,JSON.stringify(evidence));
  for(const file of HOSTED_FUNCTION_FILES)await put(file,'export const syntheticFixture = true;\n');
  await put('supabase/config.toml','project_id="PROTECTED_SOURCE_CONFIG"\n');
  for(const name of EXCLUDED_HOSTED_MIGRATIONS)await put('supabase/migrations/'+name,'PERSONAL_DATA_MUST_NOT_COPY');
  for(const file of ['.env','.env.local','supabase/.env','supabase/.temp/project-ref','supabase/seed.sql','package.json','node_modules/private-fixture'])await put(file,'CREDENTIAL_OR_LINK_MUST_NOT_COPY');
  if(templates){await put('docs/hosted-social-sandbox.example.json',JSON.stringify({environment:'sandbox',jwtEnv:'MOMO_SANDBOX_READ_JWT'}));await put('.env.hosted-sandbox.example','SOCIAL_ADAPTER_MODE=mock\nFACEBOOK_BOT_ERP_TOKEN_SANDBOX=\n');await put('docs/MOMO_SANDBOX_ACCEPTANCE.md','# Synthetic acceptance\nNot deployed.\n');}
  const botRoot=join(base,'Чат шүүх чат бот үүсгэх');await mkdir(botRoot);
  return {base,sourceRoot,target,botRoot,evidence,put};
}

test('offline bundle copies all current curated migrations and transitive Edge sources without seeds, links or credentials',async t=>{
  const f=await fixture(t),bundle=await prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target});
  assert.equal(bundle.status,'PREPARED_NOTDEPLOYED');assert.equal(bundle.migrationCount,18);assert.equal(bundle.fileCount,29);
  const bytes=await readFile(join(bundle.outputDir,'bundle-manifest.json')),manifest=JSON.parse(bytes);
  assert.equal(bundle.manifestSha256,hash(bytes));assert.equal(manifest.targetProjectRef,null);assert.deepEqual(manifest.protectedProjectRefs,['lxjkkqypiwnnrjmnpick']);assert.equal(manifest.credentialsIncluded,false);
  assert.deepEqual(manifest.migrationOrder,[...HOSTED_SOCIAL_MIGRATIONS]);assert.deepEqual(manifest.excludedMigrations,[...EXCLUDED_HOSTED_MIGRATIONS]);
  assert.deepEqual(manifest.sourceEvidence.testRun,{status:'PASS',exitCode:0});assert.equal(manifest.files.length,29);
  assert.equal(manifest.hostedAcceptanceVerified,false);assert.equal(manifest.hostedDatabaseMajorVerified,false);assert.equal(manifest.expectedHostedDatabaseMajor,17);assert.equal(manifest.localRehearsalDatabaseMajor,15);
  for(const file of manifest.files){const value=await readFile(join(bundle.outputDir,file.path));assert.equal(value.length,file.bytes);assert.equal(hash(value),file.sha256);assert.ok(!value.toString().includes('PERSONAL_DATA_MUST_NOT_COPY'));assert.ok(!value.toString().includes('CREDENTIAL_OR_LINK_MUST_NOT_COPY'));}
  for(const file of ['.env','.env.local','supabase/.env','supabase/.temp/project-ref','supabase/seed.sql','package.json','node_modules/private-fixture'])assert.equal(existsSync(join(bundle.outputDir,file)),false,file);
  for(const file of HOSTED_FUNCTION_FILES)assert.equal(existsSync(join(bundle.outputDir,file)),true,file);
  const config=await readFile(join(bundle.outputDir,'supabase/config.toml'),'utf8');
  assert.match(config,/major_version = 15/u);assert.match(config,/enable_signup = false/u);assert.match(config,/\[db.seed\]\nenabled = false/u);
  assert.match(config,/\[functions.invite-user\]\nverify_jwt = true/u);
  assert.match(config,/\[functions.social-integration\]\nverify_jwt = true/u);
  assert.match(config,/\[functions.social-access-recheck\]\nverify_jwt = false/u);
  assert.ok(!config.includes('PROTECTED_SOURCE_CONFIG'));assert.ok(!config.includes('momoshop.mn'));assert.ok(!config.includes('lxjkkqypiwnnrjmnpick'));
});

test('migration source hash drift and a missing transitive Edge file fail before output creation',async t=>{
  const f=await fixture(t);await f.put('supabase/migrations/'+HOSTED_SOCIAL_MIGRATIONS[0],'-- Changed after validated evidence');
  await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target}),/changed after validation/u);assert.equal(existsSync(f.target),false);
  const g=await fixture(t);await rm(join(g.sourceRoot,'supabase/functions/invite-user/invitation.mjs'));
  await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:g.sourceRoot,outputDir:g.target}));assert.equal(existsSync(g.target),false);
});

test('stale eleven/seventeen-migration, reordered, injected or incomplete evidence cannot produce a release bundle',async t=>{
  const f=await fixture(t),original=structuredClone(f.evidence);
  for(const changed of [
    {...original,migrations:original.migrations.slice(0,11)},
    {...original,migrations:original.migrations.slice(0,17)},
    {...original,migrations:original.migrations.slice(1)},
    {...original,migrations:[...original.migrations,{name:'../../.env',sha256:'a'.repeat(64)}]},
    {...original,migrations:[original.migrations[1],original.migrations[0],...original.migrations.slice(2)]},
    {...original,migrations:[{name:'../../.env',sha256:'a'.repeat(64)},...original.migrations.slice(1)]},
  ]){await f.put(EVIDENCE,JSON.stringify(changed));await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target}),/evidence/u);assert.equal(existsSync(f.target),false);}
});

test('missing final exit proof, a failed run, remote evidence or missing restore/cleanup is rejected',async t=>{
  const f=await fixture(t),e=f.evidence;
  for(const changed of [
    {...e,testRun:undefined},{...e,testRun:{status:'FAIL',exitCode:1}},{...e,testRun:{status:'PASS',exitCode:1}},
    {...e,syntheticOnly:false},{...e,remoteChanges:true},{...e,postgres:{host:'db.example.invalid',serverVersionNumber:150020}},
    {...e,postgres:{host:'127.0.0.1',serverVersionNumber:170012}},{...e,coreProduction:{status:'FAIL'}},
    {...e,coreBackupRestore:{status:'SKIPPED'}},{...e,transactionRollback:{transactionalRollback:false}},
    {...e,cleanup:{containerRemoved:false,networkRemoved:true,persistentVolumeUsed:false}},
  ]){await f.put(EVIDENCE,JSON.stringify(changed));await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target}),/evidence/u);assert.equal(existsSync(f.target),false);}
});

test('a new unreviewed migration is blocked even when earlier evidence is green',async t=>{
  const f=await fixture(t);await f.put('supabase/migrations/20990101000000_unreviewed.sql','-- Not in the curated release');
  await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target}),/Unreviewed migration inventory/u);assert.equal(existsSync(f.target),false);
});

test('explicit fresh evidence report stays contained under docs/evidence',async t=>{
  const f=await fixture(t);await f.put('docs/evidence/fresh-validation.json',JSON.stringify(f.evidence));await rm(join(f.sourceRoot,EVIDENCE));
  const bundle=await prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target,evidenceFile:'docs/evidence/fresh-validation.json'});
  const manifest=JSON.parse(await readFile(join(bundle.outputDir,'bundle-manifest.json'),'utf8'));assert.equal(manifest.sourceEvidence.path,'docs/evidence/fresh-validation.json');
  for(const evidenceFile of ['../outside.json','C:/secrets.json','.env','docs/evidence/../private.json'])await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,evidenceFile}),/Evidence file/u);
});

test('optional public templates may be absent without copying any substitute',async t=>{
  const f=await fixture(t,{templates:false}),bundle=await prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target});
  assert.equal(bundle.fileCount,26);assert.equal(existsSync(join(f.target,'.env.hosted-sandbox.example')),false);
});

test('existing output and ERP/bot descendants or ancestors are refused without overwrite',async t=>{
  const f=await fixture(t);await mkdir(f.target);await writeFile(join(f.target,'keep.txt'),'Untouched');
  await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target}),/already exists/u);assert.equal(await readFile(join(f.target,'keep.txt'),'utf8'),'Untouched');
  for(const outputDir of [join(f.sourceRoot,'bundle'),join(f.botRoot,'bundle'),f.sourceRoot,f.botRoot,f.base])await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir}),/overlap|already exists/u);
  assert.equal(existsSync(join(f.sourceRoot,'bundle')),false);assert.equal(existsSync(join(f.botRoot,'bundle')),false);
});

test('a nested worktree still protects the real bot directory at a higher ancestor',async t=>{
  const f=await fixture(t,{nested:true});
  await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:join(f.botRoot,'nested-bundle')}),/overlap/u);
  assert.equal(existsSync(join(f.botRoot,'nested-bundle')),false);
});

test('credential-like public examples or source files cannot be packaged',async t=>{
  const f=await fixture(t);
  for(const content of ['FACEBOOK_BOT_ERP_TOKEN_SANDBOX=opaque-synthetic-value\n','SUPABASE_KEY=sb_secret_synthetic_must_not_copy_001\n']){
    await f.put('.env.hosted-sandbox.example',content);await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target}),/credential/u);assert.equal(existsSync(f.target),false);
  }
  const g=await fixture(t);await g.put('supabase/functions/_shared/social-access-recheck.mjs',"const key='sb_secret_fixture_do_not_copy_0001';\n");
  await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:g.sourceRoot,outputDir:g.target}),/credential/u);assert.equal(existsSync(g.target),false);
});

test('CLI creates a fresh offline Temp artifact and rejects project/deploy arguments',async t=>{
  const f=await fixture(t),result=spawnSync(process.execPath,[modulePath,'--source-root',f.sourceRoot],{env:cleanEnv,encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr);const bundle=JSON.parse(result.stdout);t.after(()=>removeOwned(bundle.outputDir,'momo-hosted-social-sandbox-'));assert.equal(bundle.status,'PREPARED_NOTDEPLOYED');assert.notEqual(bundle.outputDir,f.target);
  const denied=spawnSync(process.execPath,[modulePath,'--project-ref','lxjkkqypiwnnrjmnpick'],{env:cleanEnv,encoding:'utf8',windowsHide:true,timeout:15000});assert.notEqual(denied.status,0);assert.match(denied.stderr,/Unknown option/u);
});
