import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateHostedManifest,buildReadOnlyPlan,runHostedReadOnlyProbe } from '../scripts/hosted-social-probe.mjs';
import { main } from '../scripts/validate-hosted-social-sandbox.mjs';

const manifest=JSON.parse(await readFile(new URL('../docs/hosted-social-sandbox.example.json',import.meta.url),'utf8'));
const now=1800000000000;
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt=(actor,overrides={})=>encode({alg:'HS256',typ:'JWT'})+'.'+encode({iss:'https://'+manifest.projectRef+'.supabase.co/auth/v1',sub:actor.subjectId,role:'authenticated',aud:'authenticated',exp:now/1000+3600,...overrides})+'.fake-signature';
function fixture(options={}){
 const env={MOMO_HOSTED_SANDBOX_EXECUTE:'READ_ONLY',MOMO_HOSTED_SANDBOX_APPROVED_REF:manifest.projectRef,[manifest.publishableKeyEnv]:'sb_publishable_local-fixture-key-000001'};
 for(const actor of Object.values(manifest.actors))env[actor.tokenEnv]=jwt(actor);
 const calls=[];
 const fetchImpl=async(url,init)=>{
  calls.push({url,init});const u=new URL(url),body=init.body?JSON.parse(init.body):null;
  assert.equal(u.origin,'https://'+manifest.projectRef+'.supabase.co');assert.equal(init.redirect,'error');
  const token=init.headers.Authorization?.replace(/^Bearer /u,'');const role=Object.keys(manifest.actors).find(role=>env[manifest.actors[role].tokenEnv]===token);
  const response=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Access-Control-Allow-Origin':init.headers.Origin,'X-Request-Id':'00000000-0000-4000-8000-000000000099',...headers}});
  if(options.intercept){const intercepted=await options.intercept({url:u,init,body,role,response});if(intercepted)return intercepted;}
  if(init.method==='OPTIONS'){
   assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers.apikey,undefined);assert.equal(init.headers['Access-Control-Request-Method'],'POST');assert.equal(init.headers['Access-Control-Request-Headers'],'authorization,apikey,content-type');
   return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':init.headers.Origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'}});
  }
  if(u.pathname==='/auth/v1/user')return response({id:manifest.actors[role].subjectId,is_anonymous:false,email:'private-fixture@example.invalid'});
  if(u.pathname==='/rest/v1/profiles')return response([{id:manifest.actors[role].subjectId,organization_id:manifest.actors[role].organizationId,status:role==='inactive'?'disabled':'active'}]);
  if(u.pathname==='/rest/v1/rpc/has_permission')return response(body.required_permission==='social_inbox.read'?role!=='noPermission':Boolean(options.writePermission));
  if(u.pathname==='/rest/v1/rpc/can_access_social_page')return response(role==='readAllowed'||role==='flagsDisabled');
  if(u.pathname==='/rest/v1/feature_flags')return response(u.searchParams.get('key').startsWith('eq.')?[{key:'social_inbox_read',enabled:role==='otherOrg'}]:[{key:'social_inbox_ui',enabled:true},{key:'social_inbox_read',enabled:true},{key:'social_inbox_ai_draft',enabled:false},{key:'social_inbox_reply_send',enabled:false}]);
  assert.equal(u.pathname,'/functions/v1/social-integration');
  if(!role)return response({message:'gateway denied'},401);
  if(init.headers.Origin==='https://forbidden.example.invalid'||['inactive','noPermission','otherOrg','pageDenied','flagsDisabled'].includes(role))return response({ok:false,error:{message:'do not echo this secret body'}},403);
  if(['suggest','edit','approve','send'].includes(body.action))return response({ok:false,error:{code:'permission_denied'}},403);
  if(['detail','reply'].includes(body.action))return response({ok:false,error:{code:'not_found'}},404);
  const envelope=data=>response({ok:true,data,meta:{pageId:manifest.page.erpPageId,externalPageId:manifest.page.externalPageId,mode:'live',auditRecorded:true}});
  if(body.action==='capabilities')return envelope({apiVersion:'1',pageId:manifest.page.externalPageId,sending:false,commentSending:false});
  if(body.action==='list')return envelope({items:[{pageId:manifest.page.externalPageId,channel:'messenger',text:'PRIVATE SYNTHETIC MESSAGE'}],nextCursor:null});
  if(body.action==='settings')return envelope({autoSendMessenger:false,autoSendComments:false,version:1});
  throw new Error('Unexpected fake-only probe route');
 };
 return {env,calls,fetchImpl};
}
const run=(fixture,extra={})=>runHostedReadOnlyProbe({manifest,env:fixture.env,fetchImpl:fixture.fetchImpl,execute:true,approvedProjectRef:manifest.projectRef,clock:()=>now,...extra});

test('valid manifest produces a credential-free prepared plan; default and missing authorization never fetch',async()=>{
 assert.equal(validateHostedManifest(manifest).projectRef,manifest.projectRef);assert.equal(buildReadOnlyPlan(manifest).stage,'PREPARED_NOT_RUN');
 const f=fixture();const dry=await run(f,{execute:false});assert.equal(dry.status,'SKIPPED');assert.equal(dry.networkRequests,0);assert.equal(f.calls.length,0);
 delete f.env.MOMO_HOSTED_SANDBOX_EXECUTE;const missing=await run(f);assert.equal(missing.status,'SKIPPED');assert.equal(f.calls.length,0);
 const missingManifest=await main([],{},()=>{throw new Error('No default network');});assert.equal(missingManifest.status,'SKIPPED');
});
test('protected production project, inline credentials, production browser and invalid fixture layout fail before fetch',async()=>{
 const variants=[{...manifest,projectRef:'lxjkkqypiwnnrjmnpick'},{...manifest,token:'inline-secret'},{...manifest,browserOrigin:'https://erp.momoshop.mn'},{...manifest,projectRef:'https://example.invalid'},{...manifest,page:{...manifest.page,externalPageId:'0'}},{...manifest,negativeReplyId:manifest.page.erpPageId}];
 for(const variant of variants){const f=fixture();const result=await run(f,{manifest:variant});assert.equal(result.status,'FAIL');assert.equal(f.calls.length,0);}
 const f=fixture(),m=structuredClone(manifest);m.actors.flagsDisabled.organizationId=m.page.organizationId;assert.equal((await run(f,{manifest:m})).status,'FAIL');assert.equal(f.calls.length,0);
});
test('missing/secret project key, expired, anonymous and foreign-issuer actor tokens cannot reach network',async()=>{
 for(const key of [undefined,'sb_secret_fixture-secret-000001','eyJhbGciOiJIUzI1NiJ9.service-role.payload']){const f=fixture();f.env[manifest.publishableKeyEnv]=key;const r=await run(f);assert.equal(r.status,'SKIPPED');assert.equal(f.calls.length,0);}
 for(const overrides of [{exp:now/1000-1},{iss:'https://lxjkkqypiwnnrjmnpick.supabase.co/auth/v1'},{role:'service_role'},{is_anonymous:true},{sub:manifest.actors.otherOrg.subjectId}]){const f=fixture();f.env[manifest.actors.readAllowed.tokenEnv]=jwt(manifest.actors.readAllowed,overrides);assert.equal((await run(f)).status,'FAIL');assert.equal(f.calls.length,0);}
});
test('mocked hosted sequence verifies GoTrue/profile/organization/Page/flags and only denied mutation calls',async()=>{
 const f=fixture();const r=await run(f);assert.equal(r.status,'PASS');assert.equal(r.hostedVerified,true);assert.ok(r.checks.every(c=>c.status==='PASS'));
 const actions=f.calls.filter(c=>c.url.endsWith('/functions/v1/social-integration')&&c.init.body).map(c=>JSON.parse(c.init.body).action);
 assert.deepEqual(actions.filter(a=>['suggest','edit','approve','send'].includes(a)),['suggest','edit','approve','send']);
 assert.ok(f.calls.every(c=>!c.url.includes('/erp/v1/')&&['GET','POST','OPTIONS'].includes(c.init.method)));
 const output=JSON.stringify(r);for(const value of [f.env[manifest.publishableKeyEnv],...Object.values(manifest.actors).map(actor=>f.env[actor.tokenEnv]),'PRIVATE SYNTHETIC MESSAGE','private-fixture@example.invalid','do not echo this secret body'])assert.ok(!output.includes(value));
});
test('authoritative identity mismatch, foreign Page list and automatic sending true fail closed',async()=>{
 const cases=[({url,role,response})=>url.pathname==='/auth/v1/user'?response({id:manifest.actors.otherOrg.subjectId}):null,
 ({body,response})=>body?.action==='list'?response({ok:true,data:{items:[{pageId:'99999',channel:'messenger'}]},meta:{pageId:manifest.page.erpPageId,externalPageId:manifest.page.externalPageId,mode:'live',auditRecorded:true}}):null,
 ({body,response})=>body?.action==='settings'?response({ok:true,data:{autoSendMessenger:true,autoSendComments:false},meta:{pageId:manifest.page.erpPageId,externalPageId:manifest.page.externalPageId,mode:'live',auditRecorded:true}}):null];
 for(const intercept of cases){const f=fixture({intercept});const r=await run(f);assert.equal(r.status,'FAIL');assert.equal(f.calls.filter(c=>c.init.body&&['suggest','edit','approve','send'].includes(JSON.parse(c.init.body).action)).length,0);}
});
test('unexpected mutation permission or existing reserved reply prevents all negative mutation posts',async()=>{
 for(const options of [{writePermission:true},{intercept:({body,response})=>body?.action==='reply'?response({ok:true,data:{id:manifest.negativeReplyId}},200):null}]){
  const f=fixture(options),r=await run(f);assert.equal(r.status,'FAIL');assert.equal(f.calls.filter(c=>c.init.body&&['suggest','edit','approve','send'].includes(JSON.parse(c.init.body).action)).length,0);
 }
});
test('response redirects, invalid JSON and oversized body are bounded with no raw payload in report',async()=>{
 for(const response of [new Response(null,{status:302,headers:{Location:'https://example.invalid'}}),new Response('SECRET PROVIDER CONTENT',{headers:{'Content-Type':'application/json'}}),new Response(JSON.stringify({message:'SECRET'.repeat(1000)}),{headers:{'Content-Type':'application/json'}})]){
  const f=fixture({intercept:()=>response});const r=await run(f,{maxBytes:256});assert.equal(r.status,'FAIL');assert.ok(!JSON.stringify(r).includes('SECRET'));assert.equal(f.calls.length,1);
 }
});
test('request deadline covers a hanging fetch or hanging response stream without retry',async()=>{
 for(const intercept of [()=>new Promise(()=>{}),()=>new Response(new ReadableStream({start(){}}),{headers:{'Content-Type':'application/json'}})]){
  const f=fixture({intercept});const r=await run(f,{timeoutMs:10,totalDeadlineMs:20});assert.equal(r.status,'FAIL');assert.equal(r.reason,'request_timeout');assert.equal(f.calls.length,1);
 }
});
test('changed grants during the run fail before a later denied action can be sent',async()=>{
 let guards=0;const f=fixture({intercept:({url,body,response})=>url.pathname==='/rest/v1/rpc/has_permission'&&body.required_permission==='social_inbox.reply_draft'&&++guards>1?response(true):null});
 const r=await run(f);assert.equal(r.status,'FAIL');assert.equal(f.calls.filter(c=>c.init.body&&['suggest','edit','approve','send'].includes(JSON.parse(c.init.body).action)).length,0);
});
test('missing actor token is skipped and missing audit acknowledgement fails read-only acceptance',async()=>{
 const missing=fixture();delete missing.env[manifest.actors.flagsDisabled.tokenEnv];const absent=await run(missing);assert.equal(absent.status,'SKIPPED');assert.equal(missing.calls.length,0);
 const f=fixture({intercept:({body,response,role,init})=>body?.action==='capabilities'&&role==='readAllowed'&&init.headers.Origin===manifest.browserOrigin?response({ok:true,data:{apiVersion:'1',pageId:manifest.page.externalPageId,sending:false,commentSending:false},meta:{pageId:manifest.page.erpPageId,externalPageId:manifest.page.externalPageId,mode:'live',auditRecorded:false}}):null});
 const result=await run(f);assert.equal(result.status,'FAIL');assert.equal(result.checks.find(c=>c.status==='FAIL').name,'capabilities_identity_and_send_disabled');
});
test('browser OPTIONS is credential-free and requires exact CORS methods and headers',async()=>{
 const f=fixture();const result=await run(f);assert.equal(result.status,'PASS');assert.equal(f.calls[0].init.method,'OPTIONS');assert.equal(result.checks[0].name,'browser_options_preflight');
 for(const headers of [{'Access-Control-Allow-Origin':'https://wrong.example.invalid','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'authorization,apikey,content-type'},{'Access-Control-Allow-Origin':manifest.browserOrigin,'Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'authorization,apikey,content-type'},{'Access-Control-Allow-Origin':manifest.browserOrigin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'content-type'}]){
  const broken=fixture({intercept:({init})=>init.method==='OPTIONS'?new Response(null,{status:204,headers}):null});const r=await run(broken);assert.equal(r.status,'FAIL');assert.equal(r.checks[0].name,'browser_options_preflight');assert.equal(broken.calls.length,1);
 }
});
test('other-organization isolation probe requires its own read feature flag enabled',async()=>{
 const f=fixture({intercept:({url,role,response})=>url.pathname==='/rest/v1/feature_flags'&&role==='otherOrg'?response([{key:'social_inbox_read',enabled:false}]):null});const r=await run(f);
 assert.equal(r.status,'FAIL');assert.equal(r.checks.find(c=>c.status==='FAIL').name,'fixture_other_organization_read_flag');assert.equal(f.calls.filter(c=>c.init.body&&JSON.parse(c.init.body).action==='capabilities').length,0);
});
