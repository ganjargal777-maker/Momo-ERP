import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareHostedSandboxBundle, HOSTED_SOCIAL_MIGRATIONS } from '../scripts/prepare-hosted-social-sandbox.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const modulePath=fileURLToPath(new URL('../scripts/prepare-hosted-social-sandbox.mjs',import.meta.url));
async function removeOwned(path,prefix){const canonical=await realpath(path);assert.equal(dirname(canonical),await realpath(tmpdir()));assert.ok(basename(canonical).startsWith(prefix));await rm(canonical,{recursive:true,force:true});}
async function fixture(t,{templates=true}={}){
  const base=await mkdtemp(join(tmpdir(),'momo-hosted-bundle-test-')),sourceRoot=join(base,'erp'),target=join(base,'bundle');
  t.after(()=>removeOwned(base,'momo-hosted-bundle-test-'));
  const put=async(file,body)=>{const path=join(sourceRoot,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,body);};
  const migrations=[];
  for(const name of HOSTED_SOCIAL_MIGRATIONS){const text='-- Synthetic schema fixture '+name+'\n';await put('supabase/migrations/'+name,text);migrations.push({name,sha256:hash(text)});}
  const evidence={migrations,syntheticOnly:true,remoteChanges:false};
  await put('docs/evidence/phase4-pg15-validation.json',JSON.stringify(evidence));
  await put('supabase/functions/social-integration/index.ts','export const syntheticEntry = true;\n');
  await put('supabase/functions/_shared/social-contract.mjs','export const syntheticCore = true;\n');
  await put('supabase/config.toml','project_id="PROTECTED_SOURCE_CONFIG"\n');
  for(const name of ['202609170003_bootstrap_momo_erp.sql','202609180001_verify_admin_auth_rls.sql','202609180002_set_admin_first_name.sql'])await put('supabase/migrations/'+name,'PERSONAL_DATA_MUST_NOT_COPY');
  for(const file of ['.env','.env.local','supabase/.env','supabase/.temp/project-ref','supabase/seed.sql','package.json','node_modules/private-fixture'])await put(file,'CREDENTIAL_OR_LINK_MUST_NOT_COPY');
  if(templates){await put('docs/hosted-social-sandbox.example.json',JSON.stringify({environment:'sandbox',jwtEnv:'MOMO_SANDBOX_READ_JWT'}));await put('.env.hosted-sandbox.example','SOCIAL_ADAPTER_MODE=mock\nFACEBOOK_BOT_ERP_TOKEN_SANDBOX=\n');await put('MOMO_HOSTED_SANDBOX_READINESS.md','# Synthetic readiness\nNot deployed.\n');}
  const botRoot=join(base,'Чат шүүх чат бот үүсгэх');await mkdir(botRoot);
  return {base,sourceRoot,target,botRoot,evidence,put};
}

test('offline bundle copies exactly curated verified sources, generated config and public examples',async t=>{
  const f=await fixture(t),bundle=await prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target});
  assert.equal(bundle.status,'PREPARED_NOTDEPLOYED');assert.equal(bundle.migrationCount,11);assert.equal(bundle.fileCount,17);
  const bytes=await readFile(join(bundle.outputDir,'bundle-manifest.json')),manifest=JSON.parse(bytes);
  assert.equal(bundle.manifestSha256,hash(bytes));assert.equal(manifest.targetProjectRef,null);assert.deepEqual(manifest.protectedProjectRefs,['lxjkkqypiwnnrjmnpick']);assert.equal(manifest.credentialsIncluded,false);
  assert.deepEqual(manifest.migrationOrder,[...HOSTED_SOCIAL_MIGRATIONS]);assert.equal(manifest.files.length,17);
  for(const file of manifest.files){const value=await readFile(join(bundle.outputDir,file.path));assert.equal(value.length,file.bytes);assert.equal(hash(value),file.sha256);assert.ok(!value.toString().includes('PERSONAL_DATA_MUST_NOT_COPY'));assert.ok(!value.toString().includes('CREDENTIAL_OR_LINK_MUST_NOT_COPY'));}
  for(const file of ['.env','.env.local','supabase/.env','supabase/.temp/project-ref','supabase/seed.sql','package.json','node_modules/private-fixture'])assert.equal(existsSync(join(bundle.outputDir,file)),false,file);
  const config=await readFile(join(bundle.outputDir,'supabase/config.toml'),'utf8');assert.match(config,/project_id = "momo-social-hosted-sandbox"/u);assert.match(config,/major_version = 15/u);assert.match(config,/enable_signup = false/u);assert.match(config,/verify_jwt = true/u);assert.match(config,/\[db.seed\]\nenabled = false/u);assert.ok(!config.includes('PROTECTED_SOURCE_CONFIG'));assert.ok(!config.includes('momoshop.mn'));assert.ok(!config.includes('lxjkkqypiwnnrjmnpick'));
});

test('migration hash drift and missing required files fail before an output directory is created',async t=>{
  const f=await fixture(t);await f.put('supabase/migrations/'+HOSTED_SOCIAL_MIGRATIONS[0],'-- Changed after validated evidence');
  await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target}),/changed after validation/u);assert.equal(existsSync(f.target),false);
  const g=await fixture(t);await rm(join(g.sourceRoot,'supabase/functions/social-integration/index.ts'));
  await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:g.sourceRoot,outputDir:g.target}));assert.equal(existsSync(g.target),false);
});

test('evidence cannot introduce arbitrary, reordered or missing migration entries',async t=>{
  const f=await fixture(t),original=structuredClone(f.evidence);
  for(const changed of [
    {...original,migrations:original.migrations.slice(1)},
    {...original,migrations:[...original.migrations,{name:'../../.env',sha256:'a'.repeat(64)}]},
    {...original,migrations:[original.migrations[1],original.migrations[0],...original.migrations.slice(2)]},
    {...original,migrations:[{name:'../../.env',sha256:'a'.repeat(64)},...original.migrations.slice(1)]},
  ]){await f.put('docs/evidence/phase4-pg15-validation.json',JSON.stringify(changed));await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target}),/evidence/u);assert.equal(existsSync(f.target),false);}
});

test('optional public templates may be absent without copying any unlisted substitute',async t=>{
  const f=await fixture(t,{templates:false}),bundle=await prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target});assert.equal(bundle.fileCount,14);assert.equal(existsSync(join(f.target,'.env.hosted-sandbox.example')),false);
});

test('existing output, source/bot descendants and ancestors are refused without overwriting data',async t=>{
  const f=await fixture(t);await mkdir(f.target);await writeFile(join(f.target,'keep.txt'),'Untouched');
  await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target}),/already exists/u);assert.equal(await readFile(join(f.target,'keep.txt'),'utf8'),'Untouched');
  for(const outputDir of [join(f.sourceRoot,'bundle'),join(f.botRoot,'bundle'),f.sourceRoot,f.botRoot,f.base])await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir}),/overlap|already exists/u);
  assert.equal(existsSync(join(f.sourceRoot,'bundle')),false);assert.equal(existsSync(join(f.botRoot,'bundle')),false);
});

test('public examples with credential-like values fail rather than publishing them',async t=>{
  const f=await fixture(t);
  for(const content of ['FACEBOOK_BOT_ERP_TOKEN_SANDBOX=opaque-synthetic-value\n','SUPABASE_KEY=sb_secret_synthetic_must_not_copy_001\n']){
    await f.put('.env.hosted-sandbox.example',content);await assert.rejects(()=>prepareHostedSandboxBundle({sourceRoot:f.sourceRoot,outputDir:f.target}),/credential/u);assert.equal(existsSync(f.target),false);
  }
});

test('CLI produces a fresh offline Temp artifact and rejects target/deployment options',async t=>{
  const f=await fixture(t),result=spawnSync(process.execPath,[modulePath,'--source-root',f.sourceRoot],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr);const bundle=JSON.parse(result.stdout);t.after(()=>removeOwned(bundle.outputDir,'momo-hosted-social-sandbox-'));assert.equal(bundle.status,'PREPARED_NOTDEPLOYED');assert.notEqual(bundle.outputDir,f.target);assert.ok(existsSync(join(bundle.outputDir,'bundle-manifest.json')));
  const denied=spawnSync(process.execPath,[modulePath,'--project-ref','lxjkkqypiwnnrjmnpick'],{encoding:'utf8',windowsHide:true,timeout:15000});assert.notEqual(denied.status,0);assert.match(denied.stderr,/Unknown option/u);
});
