// Offline artifact preparation only: no SDK, network, subprocess, or .env load.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, realpath, lstat } from 'node:fs/promises';
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
]);
const EVIDENCE='docs/evidence/phase4-pg15-validation.json';
const FUNCTION_FILES=['supabase/functions/social-integration/index.ts','supabase/functions/_shared/social-contract.mjs'];
const PUBLIC_TEMPLATES=['docs/hosted-social-sandbox.example.json','.env.hosted-sandbox.example','MOMO_HOSTED_SANDBOX_READINESS.md'];
const PROTECTED_PROJECT_REF='lxjkkqypiwnnrjmnpick';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(parent,child)=>{const part=relative(parent,child);return part===''||(!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep));};
const CONFIG=`# Fresh local rehearsal config; this does not choose a hosted project or DB major.
project_id = "momo-social-hosted-sandbox"

[api]
enabled = true
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]

[db]
major_version = 15

[db.seed]
enabled = false

[auth]
enabled = true
site_url = "http://localhost:4173"
additional_redirect_urls = ["http://localhost:4173"]
enable_signup = false
enable_anonymous_sign_ins = false

[functions.social-integration]
verify_jwt = true
`;

async function canonicalMissingPath(target){
  let parent=target;
  while(!existsSync(parent)){const next=dirname(parent);if(next===parent)throw new Error('Output parent does not exist');parent=next;}
  if(!(await lstat(parent)).isDirectory())throw new Error('Output parent must be a directory');
  return resolve(await realpath(parent),relative(parent,target));
}
function assertSafeOutput(target,protectedRoots){
  for(const protectedRoot of protectedRoots)if(within(protectedRoot,target)||within(target,protectedRoot))throw new Error('Bundle output cannot overlap the ERP/bot tree or an ancestor');
}
function assertPublicTemplate(bytes,file){
  const value=bytes.toString('utf8');
  if(/-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----|\bsb_(?:secret|publishable)_[a-zA-Z0-9_-]{8,}|\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/u.test(value))throw new Error('Public example contains credential-like data: '+file);
  if(file==='.env.hosted-sandbox.example')for(const line of value.split(/\r?\n/u)){
    const match=/^\s*([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|JWT|KEY)[A-Z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if(match){const setting=match[2].trim().replace(/^(['"])(.*)\1$/u,'$2');if(setting&&!/^<[^>]+>$/u.test(setting))throw new Error('Public env example must keep credential values blank/placeholders: '+file);}
  }
}

export async function prepareHostedSandboxBundle({sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),outputDir}={}){
  const requestedRoot=resolve(sourceRoot),root=await realpath(requestedRoot);
  if(!(await lstat(root)).isDirectory())throw new Error('Source root must be a directory');
  const protectedRoots=[root];
  for(const path of [resolve(root,'..','Чат шүүх чат бот үүсгэх'),resolve(requestedRoot,'..','Чат шүүх чат бот үүсгэх')])protectedRoots.push(existsSync(path)?await realpath(path):path);
  const explicit=outputDir!==undefined;
  let target;
  if(explicit){target=resolve(outputDir);if(existsSync(target))throw new Error('Explicit bundle output already exists');target=await canonicalMissingPath(target);assertSafeOutput(target,protectedRoots);}
  const sourceFile=async file=>{
    const path=join(root,file),resolved=await realpath(path),info=await lstat(path);
    if(info.isSymbolicLink()||!info.isFile()||!within(root,resolved))throw new Error('Source must be a contained regular file: '+file);
    return readFile(path);
  };
  const evidenceBytes=await sourceFile(EVIDENCE);
  let evidence;try{evidence=JSON.parse(evidenceBytes);}catch{throw new Error('Migration evidence must be valid JSON');}
  if(!Array.isArray(evidence.migrations)||evidence.migrations.length!==HOSTED_SOCIAL_MIGRATIONS.length)throw new Error('Migration evidence must contain exactly the curated eleven migrations');
  const files=[];
  for(let i=0;i<HOSTED_SOCIAL_MIGRATIONS.length;i++){
    const expected=HOSTED_SOCIAL_MIGRATIONS[i],item=evidence.migrations[i];
    if(item?.name!==expected||typeof item.sha256!=='string'||!/^\b[a-fA-F0-9]{64}\b$/u.test(item.sha256))throw new Error('Migration evidence order/name/hash is invalid');
    const file='supabase/migrations/'+expected,bytes=await sourceFile(file);
    if(sha256(bytes)!==item.sha256.toLowerCase())throw new Error('Migration source changed after validation: '+expected);
    files.push({path:file,bytes,kind:'verified_migration'});
  }
  for(const file of FUNCTION_FILES)files.push({path:file,bytes:await sourceFile(file),kind:'function'});
  for(const file of PUBLIC_TEMPLATES)if(existsSync(join(root,file))){const bytes=await sourceFile(file);assertPublicTemplate(bytes,file);files.push({path:file,bytes,kind:'public_template'});}
  files.push({path:'supabase/config.toml',bytes:Buffer.from(CONFIG),kind:'generated_local_config'});
  // Validation finishes before any explicit output directory is created.
  if(explicit)await mkdir(target,{recursive:false});
  else{target=await mkdtemp(join(tmpdir(),'momo-hosted-social-sandbox-'));assertSafeOutput(await realpath(target),protectedRoots);}
  const manifest={status:'PREPARED_NOTDEPLOYED',targetProjectRef:null,protectedProjectRefs:[PROTECTED_PROJECT_REF],credentialsIncluded:false,
    sourceEvidence:{path:EVIDENCE,sha256:sha256(evidenceBytes)},migrationOrder:[...HOSTED_SOCIAL_MIGRATIONS],
    localRehearsalDatabaseMajor:15,hostedDatabaseMajorVerified:false,
    files:files.map(({path,bytes,kind})=>({path,kind,bytes:bytes.length,sha256:sha256(bytes)}))};
  for(const file of files){const path=join(target,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.bytes,{flag:'wx'});}
  const manifestBytes=JSON.stringify(manifest,null,2)+'\n';await writeFile(join(target,'bundle-manifest.json'),manifestBytes,{flag:'wx'});
  return {status:manifest.status,outputDir:target,migrationCount:HOSTED_SOCIAL_MIGRATIONS.length,fileCount:files.length,manifestSha256:sha256(manifestBytes)};
}

const invoked=process.argv[1]?await realpath(resolve(process.argv[1])).catch(()=>null):null;
if(invoked&&pathToFileURL(invoked).href===import.meta.url){
  try{
    const args=process.argv.slice(2),options={};
    if(args.length===1&&args[0]==='--help')console.log('Offline preparation only. Usage: node scripts/prepare-hosted-social-sandbox.mjs [--source-root <ERP directory>] [--output-dir <new directory>]');
    else{
      for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--source-root','--output-dir'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Unknown option or missing path');const name=key==='--source-root'?'sourceRoot':'outputDir';if(Object.hasOwn(options,name))throw new Error('Duplicate option');options[name]=args[i+1];}
      console.log(JSON.stringify(await prepareHostedSandboxBundle(options),null,2));
    }
  }catch(error){console.error('Sandbox bundle preparation failed: '+error.message);process.exitCode=1;}
}
