import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSocialAccessRecheckHandler } from '../supabase/functions/_shared/social-access-recheck.mjs';

const TOKEN='fixture-access-connector-secret-abcdefghijklmnopqrstuvwxyz';
const SERVICE='fixture-private-service-role-key-never-return';
const now=Date.now();
const input={requestId:'10000000-0000-4000-8000-000000000001',subjectId:'20000000-0000-4000-8000-000000000001',
  organizationId:'30000000-0000-4000-8000-000000000001',teamId:'40000000-0000-4000-8000-000000000001',pageId:'12345',permission:'social_inbox.reply_send'};
function fixture(options={}){
  const calls=[],env={SOCIAL_ACCESS_RECHECK_ENABLED:'true',SOCIAL_ACCESS_RECHECK_TOKEN:TOKEN,
    SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SERVICE_ROLE_KEY:SERVICE,...options.env};
  const handler=createSocialAccessRecheckHandler({env:name=>env[name],clock:options.clock??(()=>now),timeoutMs:options.timeoutMs??1000,
    createClient:(url,key,config)=>{
      calls.push({url,key,config});return{rpc:async(name,args)=>{
        calls.push({name,args});if(options.throw)throw new Error(SERVICE+' '+TOKEN);
        if(options.pending)return options.pending;
        if(Object.hasOwn(options,'result'))return options.result;
        return{status:200,error:null,data:{active:true,allowed:true}};
      }};
    }});
  const call=(body=input,{headers={},method='POST',raw}={})=>handler(new Request('http://127.0.0.1/functions/v1/social-access-recheck',{
    method,headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json','X-Momo-Request-Id':input.requestId,...headers},
    ...(method==='POST'?{body:raw??JSON.stringify(body)}:{})}));
  const safe=async response=>{const body=await response.json();assert.ok(!JSON.stringify(body).includes(TOKEN));assert.ok(!JSON.stringify(body).includes(SERVICE));return body;};
  return{handler,call,safe,calls};
}
test('valid server credential returns exact correlated five-second decision and explicit subject RPC',async()=>{
  const f=fixture(),response=await f.call(),decision=await f.safe(response);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(decision,{active:true,userId:input.subjectId,organizationId:input.organizationId,teamIds:[input.teamId],
    pageIds:[input.pageId],permissions:[input.permission],expiresAt:now+5000,requestId:input.requestId});
  assert.deepEqual(f.calls[1],{name:'get_social_access_recheck',args:{target_user:input.subjectId,target_organization:input.organizationId,target_external_page:input.pageId,target_team:input.teamId}});
  assert.equal(f.calls[0].key,SERVICE);assert.equal(f.calls[0].config.auth.persistSession,false);assert.equal(f.calls[0].config.auth.autoRefreshToken,false);
});
test('verified revoked/inactive decisions remain HTTP200 with correlated identity and no grants',async()=>{
  for(const active of [true,false]){
    const f=fixture({result:{status:200,error:null,data:{active,allowed:false}}}),response=await f.call(),decision=await f.safe(response);
    assert.equal(response.status,200);assert.equal(decision.active,active);assert.equal(decision.userId,input.subjectId);
    assert.equal(decision.requestId,input.requestId);assert.deepEqual(decision.teamIds,[]);assert.deepEqual(decision.pageIds,[]);assert.deepEqual(decision.permissions,[]);
  }
});
test('disabled-by-default feature cannot construct a privileged client',async()=>{
  for(const value of [undefined,'false','TRUE','1']){
    const f=fixture({env:{SOCIAL_ACCESS_RECHECK_ENABLED:value}});assert.equal((await f.call()).status,503);assert.deepEqual(f.calls,[]);
  }
});
test('wrong/missing/malformed Bearer and browser Origins/cookies cannot use server-only endpoint',async()=>{
  const f=fixture();
  for(const headers of [{Authorization:''},{Authorization:'Bearer '+TOKEN+'wrong'},{Authorization:'Bearer '+TOKEN.slice(0,-1)},
    {Authorization:'Bearer x'},{Authorization:'Basic '+TOKEN},{Origin:'https://erp.example.invalid'},
    {Origin:''},{Cookie:'admin=fake'}]){
    const response=await f.call(input,{headers});assert.ok([401,403].includes(response.status));await f.safe(response);
    assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
  assert.deepEqual(f.calls,[]);assert.equal((await f.call(input,{method:'OPTIONS'})).status,405);
});
test('exact request shape, Meta namespace, permission and body/header correlation are mandatory',async()=>{
  const f=fixture();
  const invalid=[{...input,requestId:'bad'},{...input,subjectId:'not-a-UUID'},{...input,pageId:input.subjectId},
    {...input,permission:'replies:send'},{...input,teamId:null},{...input,unexpected:'ignored-would-be-unsafe'},
    {...input,requestId:'10000000-0000-4000-8000-000000000002'}];
  for(const body of invalid)assert.equal((await f.call(body)).status,400);
  assert.deepEqual(f.calls,[]);assert.equal((await f.call(input,{headers:{'Content-Type':'text/plain'}})).status,415);
});
test('body byte limit and malformed JSON are rejected without a database request',async()=>{
  const f=fixture();assert.equal((await f.call(input,{raw:'{malformed'})).status,400);
  assert.equal((await f.call({...input,padding:'x'.repeat(5000)})).status,413);
  assert.deepEqual(f.calls,[]);
});
test('bad backend configuration and re-used connector/service keys fail closed without leakage',async()=>{
  for(const env of [{SOCIAL_ACCESS_RECHECK_TOKEN:'short'},{SUPABASE_URL:'https://private.example.invalid/path'},
    {SUPABASE_SERVICE_ROLE_KEY:''},{SUPABASE_SERVICE_ROLE_KEY:TOKEN}]){
    const f=fixture({env}),response=await f.call();assert.equal(response.status,503);await f.safe(response);assert.deepEqual(f.calls,[]);
  }
});
test('returned DB/backend errors and malformed outcomes are unknown503 rather than verified denials',async()=>{
  const invalid=[null,undefined,{},
    {status:0,error:{message:SERVICE,code:''},data:null},{status:503,error:{message:TOKEN},data:null},
    {status:403,error:{code:'42501',message:SERVICE},data:null},
    {status:200,error:null,data:null},{status:200,error:null,data:{active:false,allowed:true}},
    {status:200,error:null,data:{active:true,allowed:true,token:SERVICE}},
    {status:200,data:{active:true,allowed:true}},{error:null,data:{active:true,allowed:true}}];
  for(const result of invalid){const f=fixture({result}),response=await f.call();assert.equal(response.status,503);const body=await f.safe(response);assert.equal(body.active,undefined);}
  const thrown=fixture({throw:true}),response=await thrown.call();assert.equal(response.status,503);await thrown.safe(response);
});
test('bounded RPC timeout is unknown and invalid injected clock never emits malformed allow decision',async()=>{
  const f=fixture({pending:new Promise(()=>{}),timeoutMs:10}),response=await f.call();assert.equal(response.status,503);assert.equal((await f.safe(response)).active,undefined);
  for(const clock of [()=>NaN,()=>Number.MAX_SAFE_INTEGER]){const invalid=fixture({clock});assert.equal((await invalid.call()).status,503);}
});
test('actual bot decision validator accepts allowed and recognizes verified denial',async t=>{
  const botRoot=process.env.MOMO_BOT_SOURCE_ROOT??'C:/Users/begii/OneDrive/Documents/ChatGPT/.overnight-worktrees/messenger-20261126';
  const modulePath=join(botRoot,'src/erp-access-contract.js');if(!existsSync(modulePath)){t.skip('Actual bot access contract source unavailable.');return;}
  const{validateErpAccessDecision,ErpAccessDenied}=await import(pathToFileURL(modulePath).href);
  const requirements={pageId:input.pageId,permission:input.permission,expectedOrganizationId:input.organizationId,
    requiredTeamId:input.teamId,expectedRequestId:input.requestId,expectedSubjectId:input.subjectId};
  const allowed=fixture({clock:Date.now});validateErpAccessDecision(await allowed.safe(await allowed.call()),requirements);
  const denied=fixture({clock:Date.now,result:{status:200,error:null,data:{active:true,allowed:false}}});
  const deniedResponse=await denied.call();assert.equal(deniedResponse.status,200);
  const deniedDecision=await denied.safe(deniedResponse);
  assert.throws(()=>validateErpAccessDecision(deniedDecision,requirements),ErpAccessDenied);
});
test('opaque connector gateway exception is narrow and entrypoint uses the tested pinned factory',()=>{
  const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
  assert.match(config,/\[functions\.social-access-recheck\]\s*verify_jwt\s*=\s*false/u);
  assert.match(config,/\[functions\.social-integration\]\s*verify_jwt\s*=\s*true/u);
  assert.match(config,/\[functions\.invite-user\]\s*verify_jwt\s*=\s*true/u);
  const entry=readFileSync(new URL('../supabase/functions/social-access-recheck/index.ts',import.meta.url),'utf8');
  assert.match(entry,/npm:@supabase\/supabase-js@2\.112\.3/u);assert.match(entry,/createSocialAccessRecheckHandler/u);
});
