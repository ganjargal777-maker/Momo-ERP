// Preparation by default; no .env loader and no credential values in output.
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runHostedReadOnlyProbe } from './hosted-social-probe.mjs';

export async function main(args=process.argv.slice(2),env=process.env,fetchImpl=globalThis.fetch){
 const allowed=new Set(['--manifest','--execute-read-only']);let manifestPath,execute=false;
 for(let i=0;i<args.length;i++){const item=args[i];if(!allowed.has(item))return {status:'FAIL',reason:'invalid_arguments',networkRequests:0,checks:[],hostedVerified:false};if(item==='--manifest'){if(manifestPath||!args[i+1]||args[i+1].startsWith('--'))return {status:'FAIL',reason:'invalid_arguments',networkRequests:0,checks:[],hostedVerified:false};manifestPath=args[++i];}else{if(execute)return {status:'FAIL',reason:'invalid_arguments',networkRequests:0,checks:[],hostedVerified:false};execute=true;}}
 if(!manifestPath)return {status:'SKIPPED',reason:'manifest_file_required',networkRequests:0,checks:[],hostedVerified:false};
 let manifest;try{const text=await readFile(manifestPath,'utf8');if(Buffer.byteLength(text)>65536)throw new Error();manifest=JSON.parse(text);}catch{return {status:'FAIL',reason:'manifest_unreadable_or_invalid',networkRequests:0,checks:[],hostedVerified:false};}
 return runHostedReadOnlyProbe({manifest,env,fetchImpl,execute,approvedProjectRef:env.MOMO_HOSTED_SANDBOX_APPROVED_REF});
}
const executedPath=process.argv[1]?await realpath(process.argv[1]).catch(()=>null):null;
if(executedPath&&executedPath===fileURLToPath(import.meta.url)){
 const report=await main();console.log(JSON.stringify(report,null,2));
 process.exitCode=report.status==='FAIL'?1:process.argv.includes('--execute-read-only')&&report.status==='SKIPPED'?2:0;
}
