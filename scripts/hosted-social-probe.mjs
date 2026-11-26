// Prepared hosted checks only. No module-load IO, SDK, default fetch, or secrets.
// JWT decoding below is a local accident-prevention guard, NEVER authentication.
export const PROTECTED_PROJECT_REFS=Object.freeze(['lxjkkqypiwnnrjmnpick']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REF=/^[a-z]{20}$/u,ENV=/^MOMO_SANDBOX_[A-Z0-9_]{1,80}$/u;
const ROLES=['readAllowed','noPermission','inactive','otherOrg','pageDenied','flagsDisabled'];
const WRITE_PERMISSIONS=['social_inbox.reply_draft','social_inbox.reply_send','social_inbox.assign','social_inbox.reassign','social_inbox.resolve'];
const WRITE_FLAGS=['social_inbox_ai_draft','social_inbox_reply_send'];
const READ_FLAGS=['social_inbox_ui','social_inbox_read'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
class ProbeError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ProbeError(code);};
function exact(v,keys){if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('invalid_manifest');}
function id(v){if(typeof v!=='string'||!UUID.test(v))fail('invalid_manifest');return v;}
function origin(v){try{const u=new URL(v);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.origin!==v)fail('invalid_manifest');
 if(v!=='http://localhost:4173'&&(u.protocol!=='https:'||u.hostname==='erp.momoshop.mn'||/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/u.test(u.hostname)))fail('invalid_manifest');return v;}catch{fail('invalid_manifest');}}
export function validateHostedManifest(input){
 exact(input,['schemaVersion','purpose','projectRef','browserOrigin','page','flagsDisabledPageId','negativeContextId','negativeReplyId','publishableKeyEnv','actors']);
 if(input.schemaVersion!==1||input.purpose!=='isolated-synthetic-social-sandbox'||typeof input.projectRef!=='string'||!REF.test(input.projectRef))fail('invalid_manifest');
 if(PROTECTED_PROJECT_REFS.includes(input.projectRef))fail('protected_project');
 exact(input.page,['erpPageId','organizationId','externalPageId']);id(input.page.erpPageId);id(input.page.organizationId);
 if(typeof input.page.externalPageId!=='string'||! /^[1-9]\d{0,31}$/u.test(input.page.externalPageId))fail('invalid_manifest');
 origin(input.browserOrigin);id(input.flagsDisabledPageId);id(input.negativeContextId);id(input.negativeReplyId);
 if(!/^00000000-0000-4000-8000-0000009[0-9]{5}$/u.test(input.negativeContextId)||!/^00000000-0000-4000-8000-0000009[0-9]{5}$/u.test(input.negativeReplyId))fail('invalid_reserved_fixture_id');
 if(input.flagsDisabledPageId===input.page.erpPageId||input.negativeContextId===input.negativeReplyId||!ENV.test(input.publishableKeyEnv??''))fail('invalid_manifest');
 exact(input.actors,ROLES);const subjects=new Set(),envs=new Set([input.publishableKeyEnv]);
 for(const role of ROLES){const actor=input.actors[role];exact(actor,['subjectId','organizationId','tokenEnv']);id(actor.subjectId);id(actor.organizationId);
  if(!ENV.test(actor.tokenEnv??'')||subjects.has(actor.subjectId)||envs.has(actor.tokenEnv))fail('invalid_manifest');subjects.add(actor.subjectId);envs.add(actor.tokenEnv);}
 for(const role of ['readAllowed','noPermission','inactive','pageDenied'])if(input.actors[role].organizationId!==input.page.organizationId)fail('invalid_fixture_organizations');
 if(input.actors.otherOrg.organizationId===input.page.organizationId||input.actors.flagsDisabled.organizationId===input.page.organizationId||input.actors.flagsDisabled.organizationId===input.actors.otherOrg.organizationId)fail('invalid_fixture_organizations');
 return structuredClone(input);
}
function tokenGuard(token,actor,base,now){
 try{if(typeof token!=='string'||token.length>4096||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/u.test(token))fail('invalid_actor_token');
  const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  if(!object(payload)||payload.iss!==base+'/auth/v1'||payload.sub!==actor.subjectId||payload.role!=='authenticated'||payload.is_anonymous===true||!Number.isFinite(payload.exp)||payload.exp*1000<=now+30000)fail('invalid_actor_token');
 }catch{fail('invalid_actor_token');}
}
export function buildReadOnlyPlan(raw){const m=validateHostedManifest(raw);return {
 projectRef:m.projectRef,mode:'READ_ONLY',stage:'PREPARED_NOT_RUN',
 checks:['browser_options_preflight','synthetic_actor_auth_and_profiles','read_actor_write_permissions_disabled','organization_draft_send_flags_disabled','other_organization_read_flag_enabled','missing_jwt_401','malformed_jwt_401','inactive_profile_403','no_global_read_403','other_organization_page_403','page_permission_403','organization_read_flag_disabled_403','origin_forbidden_403','capabilities_identity_and_send_disabled','messenger_list_page_isolation','settings_automatic_send_disabled','reserved_context_absent','reserved_reply_absent','draft_denied','edit_denied','approve_denied','send_denied'],
 notCovered:['comments_or_real_Meta_delivery','durable_bot_outbox_idempotency','draft_edit_approve_success','send_success','permission_revocation_of_queued_v1_jobs'],
};}

async function boundedResponse(response,maxBytes,signal){
 if(Number(response.headers.get('content-length'))>maxBytes)fail('response_too_large');
 if(!/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/iu.test(response.headers.get('content-type')??''))fail('invalid_response');
 const reader=response.body?.getReader();if(!reader)fail('invalid_response');const chunks=[];let length=0;
 const read=()=>new Promise((resolve,reject)=>{const abort=()=>reject(new ProbeError('request_timeout'));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
 try{while(true){if(signal.aborted)fail('request_timeout');const part=await read();if(part.done)break;length+=part.value.byteLength;if(length>maxBytes)fail('response_too_large');chunks.push(part.value);}
  const all=new Uint8Array(length);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}catch{fail('invalid_response');}
 }finally{reader.cancel().catch(()=>{});}
}

export async function runHostedReadOnlyProbe({manifest,env={},fetchImpl,execute=false,approvedProjectRef,clock=Date.now,timeoutMs=10000,totalDeadlineMs=60000,maxBytes=512*1024}={}){
 const checks=[];let networkRequests=0,m;const report=(status,reason)=>({status,reason,stage:execute?'HOSTED_READ_ONLY':'PREPARED_NOT_RUN',networkRequests,checks,hostedVerified:status==='PASS'});
 const get=name=>typeof env==='function'?env(name):env[name];
 try{
  m=validateHostedManifest(manifest);const plan=buildReadOnlyPlan(m);
  if(!execute)return {...report('SKIPPED','explicit_execution_not_requested'),plan};
  if(get('MOMO_HOSTED_SANDBOX_EXECUTE')!=='READ_ONLY'||approvedProjectRef!==m.projectRef||get('MOMO_HOSTED_SANDBOX_APPROVED_REF')!==m.projectRef)return report('SKIPPED','sandbox_execution_authorization_missing');
  if(typeof fetchImpl!=='function')return report('SKIPPED','explicit_fetch_dependency_missing');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>10000||!Number.isSafeInteger(totalDeadlineMs)||totalDeadlineMs<timeoutMs||totalDeadlineMs>120000||!Number.isSafeInteger(maxBytes)||maxBytes<256||maxBytes>8*1024*1024)fail('invalid_probe_bounds');
  const base='https://'+m.projectRef+'.supabase.co',started=clock(),key=get(m.publishableKeyEnv),tokens={};
  if(typeof key!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{10,480}$/u.test(key))return report('SKIPPED','sandbox_publishable_key_missing_or_invalid');
  for(const role of ROLES){const token=get(m.actors[role].tokenEnv);if(!token)return report('SKIPPED','synthetic_actor_tokens_missing');tokenGuard(token,m.actors[role],base,clock());tokens[role]=token;}
  const request=async(name,path,{actor='readAllowed',body,method=body===undefined?'GET':'POST',expectedStatus=200,predicate,originOverride,authorization,preflight=false}={})=>{
   if(!path.startsWith('/')||path.startsWith('//')||path.includes('://'))fail('invalid_probe_route');
   const remaining=totalDeadlineMs-(clock()-started);if(remaining<=0)fail('total_deadline');const controller=new AbortController();let timer;
   const headers=preflight?{Origin:m.browserOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type'}:{apikey:key,Origin:originOverride??m.browserOrigin,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})};
   if(!preflight&&authorization!==null)headers.Authorization=authorization??'Bearer '+tokens[actor];
   let response,data;
   try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ProbeError('request_timeout'));},Math.min(timeoutMs,remaining));});
    networkRequests++;
    ({response,data}=await Promise.race([timeout,(async()=>{const r=await fetchImpl(base+path,{method,headers,redirect:'error',signal:controller.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(r.status>=300&&r.status<400||r.redirected||r.url&&new URL(r.url).origin!==base)fail('redirect_forbidden');return {response:r,data:preflight&&method==='OPTIONS'&&r.status===204?null:await boundedResponse(r,maxBytes,controller.signal)};})()]));
   }catch(error){const code=error instanceof ProbeError?error.code:'request_failed';checks.push({name,status:'FAIL',expectedStatus,reason:code});fail(code);}finally{clearTimeout(timer);controller.abort();}
   const valid=response.status===expectedStatus&&(!predicate||predicate(data,response));
   const candidate=response.headers.get('x-request-id')??data?.meta?.requestId??data?.error?.requestId;
   checks.push({name,status:valid?'PASS':'FAIL',expectedStatus,actualStatus:response.status,...(typeof candidate==='string'&&UUID.test(candidate)?{requestId:candidate}:{})});
   if(!valid)fail('check_failed');return data;
  };
  const edge=(name,action,extra={},options={})=>request(name,'/functions/v1/social-integration',{body:{action,pageId:m.page.erpPageId,resource:'messenger',...extra},...options});
  const allowed=(response,name,value)=>(response.headers.get(name)??'').toLowerCase().split(',').map(part=>part.trim()).includes(value.toLowerCase());
  await request('browser_options_preflight','/functions/v1/social-integration',{method:'OPTIONS',preflight:true,expectedStatus:204,predicate:(_data,response)=>response.headers.get('access-control-allow-origin')===m.browserOrigin&&allowed(response,'access-control-allow-methods','POST')&&['authorization','apikey','content-type'].every(header=>allowed(response,'access-control-allow-headers',header))});
  // Verify each valid fixture actor against GoTrue and the self-profile RLS,
  // without trusting decoded JWT metadata as organization/role authority.
  for(const role of ROLES){const actor=m.actors[role];
   await request('auth_'+role,'/auth/v1/user',{actor:role,predicate:data=>data?.id===actor.subjectId&&data?.is_anonymous!==true});
   await request('profile_'+role,'/rest/v1/profiles?select=id,organization_id,status&id=eq.'+actor.subjectId,{actor:role,predicate:data=>Array.isArray(data)&&data.length===1&&data[0].id===actor.subjectId&&data[0].organization_id===actor.organizationId&&data[0].status===(role==='inactive'?'disabled':'active')});
  }
  for(const role of ['readAllowed','noPermission','otherOrg','pageDenied','flagsDisabled'])await request('fixture_global_read_'+role,'/rest/v1/rpc/has_permission',{actor:role,body:{required_permission:'social_inbox.read'},predicate:data=>data===(role!=='noPermission')});
  for(const role of ['readAllowed','otherOrg','pageDenied','flagsDisabled'])await request('fixture_page_read_'+role,'/rest/v1/rpc/can_access_social_page',{actor:role,body:{target_page:role==='flagsDisabled'?m.flagsDisabledPageId:m.page.erpPageId,required_action:'read'},predicate:data=>data===(role==='readAllowed'||role==='flagsDisabled')});
  await request('fixture_disabled_organization_flag','/rest/v1/feature_flags?select=key,enabled&organization_id=eq.'+m.actors.flagsDisabled.organizationId+'&key=eq.social_inbox_read',{actor:'flagsDisabled',predicate:data=>Array.isArray(data)&&data.length===1&&data[0].key==='social_inbox_read'&&data[0].enabled===false});
  await request('fixture_other_organization_read_flag','/rest/v1/feature_flags?select=key,enabled&organization_id=eq.'+m.actors.otherOrg.organizationId+'&key=eq.social_inbox_read',{actor:'otherOrg',predicate:data=>Array.isArray(data)&&data.length===1&&data[0].key==='social_inbox_read'&&data[0].enabled===true});
  const guard=async()=>{
   for(const permission of WRITE_PERMISSIONS)await request('guard_'+permission,'/rest/v1/rpc/has_permission',{body:{required_permission:permission},predicate:data=>data===false});
   await request('guard_organization_flags','/rest/v1/feature_flags?select=key,enabled&organization_id=eq.'+m.page.organizationId+'&key=in.('+[...READ_FLAGS,...WRITE_FLAGS].join(',')+')',{predicate:data=>Array.isArray(data)&&[...READ_FLAGS,...WRITE_FLAGS].every(key=>data.filter(row=>row.key===key).length===1&&data.find(row=>row.key===key).enabled===READ_FLAGS.includes(key))});
  };
  await guard();
  await edge('missing_jwt','capabilities',{}, {authorization:null,expectedStatus:401});
  await edge('malformed_jwt','capabilities',{}, {authorization:'Bearer invalid-synthetic-jwt',expectedStatus:401});
  for(const [role,name]of [['inactive','inactive_profile'],['noPermission','no_global_read'],['otherOrg','other_organization_page'],['pageDenied','page_permission']])await edge(name,'capabilities',{}, {actor:role,expectedStatus:403});
  await edge('organization_read_flag_disabled','capabilities',{pageId:m.flagsDisabledPageId},{actor:'flagsDisabled',expectedStatus:403});
  await edge('origin_forbidden','capabilities',{}, {originOverride:'https://forbidden.example.invalid',expectedStatus:403});
  const envelope=(data,response)=>data?.ok===true&&data?.meta?.pageId===m.page.erpPageId&&data?.meta?.externalPageId===m.page.externalPageId&&data?.meta?.mode==='live'&&data?.meta?.auditRecorded===true&&response.headers.get('access-control-allow-origin')===m.browserOrigin;
  await edge('capabilities_identity_and_send_disabled','capabilities',{}, {predicate:(data,response)=>envelope(data,response)&&data.data?.apiVersion==='1'&&data.data?.pageId===m.page.externalPageId&&data.data?.sending===false&&data.data?.commentSending===false});
  await edge('messenger_list_page_isolation','list',{filters:{limit:1}},{predicate:(data,response)=>envelope(data,response)&&Array.isArray(data.data?.items)&&data.data.items.every(item=>item?.pageId===m.page.externalPageId&&item?.channel==='messenger')});
  await edge('settings_automatic_send_disabled','settings',{}, {predicate:(data,response)=>envelope(data,response)&&data.data?.autoSendMessenger===false&&data.data?.autoSendComments===false});
  // Reserved absent fixture IDs plus fresh denial guards make these authorization
  // probes unable to target an existing approved reply. Fixture grants/flags must
  // remain frozen during the run; this never creates or edits fixture records.
  const absent=async()=>{
   await edge('reserved_context_absent','detail',{id:m.negativeContextId},{expectedStatus:404});
   await edge('reserved_reply_absent','reply',{id:m.negativeReplyId},{expectedStatus:404});
  };
  await absent();
  const negatives=[['draft_denied','suggest',{id:m.negativeContextId}],['edit_denied','edit',{reply:{id:m.negativeReplyId,version:1,text:'SYNTHETIC DENIAL CHECK - do not send'}}],['approve_denied','approve',{reply:{id:m.negativeReplyId,version:1}}],['send_denied','send',{reply:{id:m.negativeReplyId,version:1},idempotencyKey:'sandbox-denial-operation-v1'}]];
  for(const[name,action,body]of negatives){await guard();await absent();await edge(name,action,body,{expectedStatus:403});}
  return {...report('PASS','hosted_read_only_checks_passed'),projectRef:m.projectRef,notCovered:plan.notCovered};
 }catch(error){return report('FAIL',error instanceof ProbeError?error.code:'probe_failed');}
}
