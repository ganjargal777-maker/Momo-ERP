// Offline preparation only: no SDK, network, subprocess, .env or project link.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, realpath, lstat, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOSTED_SOCIAL_MIGRATIONS = Object.freeze([
  '202609170001_core_schema.sql',
  '202609170002_auth_rbac_rls.sql',
  '202609180003_user_invitation_provisioning.sql',
  '202609180004_create_custom_role.sql',
  '202609180005_harden_user_role_visibility.sql',
  '202609250001_role_management.sql',
  '202611260001_momo_ai_social_phase2.sql',
  '202611260002_multi_page_team_management.sql',
  '202611260003_social_operations.sql',
  '202611260004_social_real_data.sql',
  '20261126111223_social_contract_alignment.sql',
  '20261126133809_core_production_readiness.sql',
  '20261126142430_invitation_tenant_and_cleanup_guards.sql',
  '20261126150430_core_product_stock.sql',
  '20261126155806_dashboard_stock_by_product.sql',
  '20261126210330_core_delivery_export.sql',
  '20261127044305_social_delivery_access_recheck.sql',
  '20261127051607_harden_public_auth_helper_execution.sql',
]);
export const EXCLUDED_HOSTED_MIGRATIONS = Object.freeze([
  '202609170003_bootstrap_momo_erp.sql',
  '202609180001_verify_admin_auth_rls.sql',
  '202609180002_set_admin_first_name.sql',
]);
export const HOSTED_FUNCTION_FILES = Object.freeze([
  'supabase/functions/invite-user/index.ts',
  'supabase/functions/invite-user/handler.mjs',
  'supabase/functions/invite-user/invitation.mjs',
  'supabase/functions/social-integration/index.ts',
  'supabase/functions/_shared/social-contract.mjs',
  'supabase/functions/social-access-recheck/index.ts',
  'supabase/functions/_shared/social-access-recheck.mjs',
]);
const DEFAULT_EVIDENCE='docs/evidence/core-pg15-validation.json';
const PUBLIC_TEMPLATES=['docs/hosted-social-sandbox.example.json','.env.hosted-sandbox.example','docs/MOMO_SANDBOX_ACCEPTANCE.md'];
const PROTECTED_PROJECT_REF='lxjkkqypiwnnrjmnpick';
const BOT_DIRECTORY='Чат шүүх чат бот үүсгэх';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(parent,child)=>{const part=relative(parent,child);return part===''||(!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep));};
const CONFIG=[
  '# Generated LOCAL rehearsal config, not a remote Auth/config push.',
  '# Hosted sandbox PostgreSQL17 must be verified independently.',
  'project_id = "momo-social-hosted-sandbox"','',
  '[api]','enabled = true','schemas = ["public", "graphql_public"]','extra_search_path = ["public", "extensions"]','',
  '[db]','major_version = 15','',
  '[db.seed]','enabled = false','',
  '[auth]','enabled = true','site_url = "http://localhost:4173"',
  'additional_redirect_urls = ["http://localhost:4173", "http://localhost:4173/?setup=1", "http://localhost:4173/?reset=1"]',
  'enable_signup = false','enable_anonymous_sign_ins = false','',
  '[functions.invite-user]','verify_jwt = true','',
  '[functions.social-integration]','verify_jwt = true','',
  '# Opaque server connector: handler authenticates its own Bearer; never public browser access.',
  '[functions.social-access-recheck]','verify_jwt = false','',
].join('\n');

async function canonicalMissingPath(target){
  let parent=target;
  while(!existsSync(parent)){const next=dirname(parent);if(next===parent)throw new Error('Output parent does not exist');parent=next;}
  if(!(await lstat(parent)).isDirectory())throw new Error('Output parent must be a directory');
  return resolve(await realpath(parent),relative(parent,target));
}
function assertSafeOutput(target,protectedRoots){
  for(const protectedRoot of protectedRoots)if(within(protectedRoot,target)||within(target,protectedRoot))throw new Error('Bundle output cannot overlap the ERP/bot tree or an ancestor');
}
function assertPublicSource(bytes,file){
  const value=bytes.toString('utf8');
  if(/-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----|\bsb_(?:secret|publishable)_[a-zA-Z0-9_-]{8,}|\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/u.test(value))throw new Error('Source contains credential-like data: '+file);
  if(file==='.env.hosted-sandbox.example')for(const line of value.split(/\r?\n/u)){
    const match=/^\s*([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|JWT|KEY)[A-Z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if(match){const setting=match[2].trim().replace(/^(['"])(.*)\1$/u,'$2');if(setting&&!/^<[^>]+>$/u.test(setting))throw new Error('Public env example must keep credential values blank/placeholders: '+file);}
  }
}
function evidenceFileName(value){
  const path=String(value).replaceAll('\\','/');
  if(!/^docs\/evidence\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.json$/u.test(path))throw new Error('Evidence file must be a contained docs/evidence JSON report');
  return path;
}
function requirePassedEvidence(evidence){
  if(evidence?.syntheticOnly!==true||evidence.remoteChanges!==false||
    evidence.testRun?.status!=='PASS'||evidence.testRun.exitCode!==0||
    evidence.postgres?.host!=='127.0.0.1'||!Number.isInteger(evidence.postgres.serverVersionNumber)||
    evidence.postgres.serverVersionNumber<150000||evidence.postgres.serverVersionNumber>=160000||
    evidence.coreProduction?.status!=='PASS'||evidence.coreBackupRestore?.status!=='PASS'||
    evidence.transactionRollback?.transactionalRollback!==true||
    evidence.cleanup?.containerRemoved!==true||evidence.cleanup.networkRemoved!==true||evidence.cleanup.persistentVolumeUsed!==false){
    throw new Error('Migration evidence must prove a completed PASS/exit0 synthetic PostgreSQL15 run, rollback, core restore and owned cleanup');
  }
  if(!Array.isArray(evidence.migrations)||evidence.migrations.length!==HOSTED_SOCIAL_MIGRATIONS.length)throw new Error('Migration evidence must contain exactly the current curated '+HOSTED_SOCIAL_MIGRATIONS.length+' migrations');
}

export async function prepareHostedSandboxBundle({sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),outputDir,evidenceFile=DEFAULT_EVIDENCE}={}){
  const requestedRoot=resolve(sourceRoot),root=await realpath(requestedRoot);
  if(!(await lstat(root)).isDirectory())throw new Error('Source root must be a directory');
  const protectedRoots=[root];
  // Worktrees can be nested two or more levels below the actual bot sibling.
  // Discover existing bot directories along both canonical/requested ancestors.
  for(const start of [root,requestedRoot]){
    let ancestor=start;
    for(;;){
      const candidate=join(ancestor,BOT_DIRECTORY);
      if(existsSync(candidate))protectedRoots.push(await realpath(candidate));
      const next=dirname(ancestor);if(next===ancestor)break;ancestor=next;
    }
  }
  const explicit=outputDir!==undefined;
  let target;
  if(explicit){target=resolve(outputDir);if(existsSync(target))throw new Error('Explicit bundle output already exists');target=await canonicalMissingPath(target);assertSafeOutput(target,protectedRoots);}
  const sourceFile=async file=>{
    const path=join(root,file),resolved=await realpath(path),info=await lstat(path);
    if(info.isSymbolicLink()||!info.isFile()||!within(root,resolved))throw new Error('Source must be a contained regular file: '+file);
    return readFile(path);
  };
  const inventory=(await readdir(join(root,'supabase','migrations'))).filter(name=>name.endsWith('.sql'));
  const known=new Set([...HOSTED_SOCIAL_MIGRATIONS,...EXCLUDED_HOSTED_MIGRATIONS]);
  if(inventory.some(name=>!known.has(name)))throw new Error('Unreviewed migration inventory; update the curated sandbox plan after review');
  const evidencePath=evidenceFileName(evidenceFile),evidenceBytes=await sourceFile(evidencePath);
  let evidence;try{evidence=JSON.parse(evidenceBytes);}catch{throw new Error('Migration evidence must be valid JSON');}
  requirePassedEvidence(evidence);
  const files=[];
  for(let i=0;i<HOSTED_SOCIAL_MIGRATIONS.length;i++){
    const expected=HOSTED_SOCIAL_MIGRATIONS[i],item=evidence.migrations[i];
    if(item?.name!==expected||typeof item.sha256!=='string'||!/\b[a-fA-F0-9]{64}\b/u.test(item.sha256)||item.sha256.length!==64)throw new Error('Migration evidence order/name/hash is invalid');
    const file='supabase/migrations/'+expected,bytes=await sourceFile(file);
    if(sha256(bytes)!==item.sha256.toLowerCase())throw new Error('Migration source changed after validation: '+expected);
    assertPublicSource(bytes,file);files.push({path:file,bytes,kind:'verified_migration'});
  }
  for(const file of HOSTED_FUNCTION_FILES){const bytes=await sourceFile(file);assertPublicSource(bytes,file);files.push({path:file,bytes,kind:'function_source'});}
  for(const file of PUBLIC_TEMPLATES)if(existsSync(join(root,file))){const bytes=await sourceFile(file);assertPublicSource(bytes,file);files.push({path:file,bytes,kind:'public_template'});}
  files.push({path:'supabase/config.toml',bytes:Buffer.from(CONFIG),kind:'generated_local_config'});
  // No explicit output is created before inventory, evidence and source validation.
  if(explicit)await mkdir(target,{recursive:false});
  else{target=await mkdtemp(join(tmpdir(),'momo-hosted-social-sandbox-'));assertSafeOutput(await realpath(target),protectedRoots);}
  const manifest={schemaVersion:2,status:'PREPARED_NOTDEPLOYED',targetProjectRef:null,protectedProjectRefs:[PROTECTED_PROJECT_REF],credentialsIncluded:false,
    sourceEvidence:{path:evidencePath,sha256:sha256(evidenceBytes),testRun:{status:'PASS',exitCode:0}},
    migrationOrder:[...HOSTED_SOCIAL_MIGRATIONS],excludedMigrations:[...EXCLUDED_HOSTED_MIGRATIONS],
    localRehearsalDatabaseMajor:15,expectedHostedDatabaseMajor:17,hostedDatabaseMajorVerified:false,hostedAcceptanceVerified:false,
    functionAcceptanceBoundByThisManifest:false,
    files:files.map(({path,bytes,kind})=>({path,kind,bytes:bytes.length,sha256:sha256(bytes)}))};
  for(const file of files){const path=join(target,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.bytes,{flag:'wx'});}
  const manifestBytes=JSON.stringify(manifest,null,2)+'\n';await writeFile(join(target,'bundle-manifest.json'),manifestBytes,{flag:'wx'});
  return {status:manifest.status,outputDir:target,migrationCount:HOSTED_SOCIAL_MIGRATIONS.length,fileCount:files.length,manifestSha256:sha256(manifestBytes)};
}

const invoked=process.argv[1]?await realpath(resolve(process.argv[1])).catch(()=>null):null;
if(invoked&&pathToFileURL(invoked).href===import.meta.url){
  try{
    const args=process.argv.slice(2),options={};
    if(args.length===1&&args[0]==='--help')console.log('Offline preparation only. Usage: node scripts/prepare-hosted-social-sandbox.mjs [--source-root <ERP directory>] [--output-dir <new directory>] [--evidence-file docs/evidence/<fresh-pg15-report>.json]');
    else{
      for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--source-root','--output-dir','--evidence-file'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Unknown option or missing path');const name=key==='--source-root'?'sourceRoot':key==='--output-dir'?'outputDir':'evidenceFile';if(Object.hasOwn(options,name))throw new Error('Duplicate option');options[name]=args[i+1];}
      console.log(JSON.stringify(await prepareHostedSandboxBundle(options),null,2));
    }
  }catch(error){console.error('Sandbox bundle preparation failed: '+error.message);process.exitCode=1;}
}
