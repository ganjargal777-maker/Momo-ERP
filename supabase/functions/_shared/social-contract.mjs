// Browser -> authenticated ERP gateway -> one explicitly bound /erp/v1 runtime.
// This module imports no SDK, reads no process/Deno environment, and opens no
// network itself unless fetchImpl/createClient are explicitly supplied.
export const SOCIAL_ACTIONS = Object.freeze({
  capabilities:['social_inbox.read','read'], list:['social_inbox.read','read'],
  detail:['social_inbox.read','read'], history:['social_inbox.read','read'],
  reply:['social_inbox.read','read'], settings:['social_inbox.read','read'],
  suggest:['social_inbox.reply_draft','reply'], edit:['social_inbox.reply_draft','reply'],
  approve:['social_inbox.reply_draft','reply'], send:['social_inbox.reply_send','reply'],
  update:['social_inbox.assign','assign'], audit:['social_audit.read','read'],
  assistant:['ai_assistant.use',null],
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXTERNAL = /^[1-9]\d{0,31}$/u;
const IDEMPOTENCY = /^[a-zA-Z0-9._:-]{8,128}$/u;
const MAX_BODY = 65536;
// Inbox gateway responses can contain many long UTF-8 messages/comments.
// This decoded-body cap is 8 MiB, with the same streaming/deadline safeguards.
// It does not change the separate bot catalog adapter's 256 KiB provider cap.
const MAX_RESPONSE = 8 * 1024 * 1024;
const DEFAULT_ORIGINS = ['https://erp.momoshop.mn','http://localhost:4173'];
const copy = value => structuredClone(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
class ContractError extends Error {
  constructor(status,code,message,extra={}) { super(message); Object.assign(this,{status,code,...extra}); }
}
const fail = (status,code,message,extra) => { throw new ContractError(status,code,message,extra); };
const invalid = () => fail(400,'invalid_request','Хүсэлтийн бүтэц эсвэл утга буруу.');
function exact(value,keys) { if (!isObject(value) || Object.keys(value).some(key=>!keys.includes(key))) invalid(); return value; }
function uuid(value) { if (typeof value!=='string' || !UUID.test(value)) invalid(); return value.toLowerCase(); }
function version(value) { if (!Number.isSafeInteger(value) || value<1) invalid(); return value; }
function text(value,max=2000) { if (typeof value!=='string' || !value.trim() || value.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) invalid(); return value.trim(); }
function jsonConfig(value) { try { return JSON.parse(value); } catch { fail(503,'adapter_configuration','Adapter тохиргоо буруу.'); } }
function external(value) { return typeof value==='string' && EXTERNAL.test(value); }
function positive(value,max,fallback) {
  if (value===undefined) return fallback;
  if (!Number.isSafeInteger(value) || value<1 || value>max) invalid(); return value;
}
function safeRequestId(value) { return typeof value==='string' && /^[a-zA-Z0-9._:-]{1,128}$/u.test(value) ? value : null; }
function safeRetryAfter(value) { return /^\d{1,5}$/u.test(value??'') && Number(value)<=86400 ? Number(value) : undefined; }
function scrub(value,secrets) {
  if (typeof value==='string') { let result=value; for (const secret of secrets) if (secret.length>=8) result=result.split(secret).join('[REDACTED]'); return result; }
  if (Array.isArray(value)) return value.map(item=>scrub(item,secrets));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:token|secret|authorization|cookie|credential|apikey)/iu.test(key)).map(([key,v])=>[key,scrub(v,secrets)]));
  return value;
}
function originUrl(value) {
  try {
    const result = new URL(value);
    if (result.protocol!=='https:' || result.username || result.password || result.search || result.hash || result.pathname!=='/' ||
      /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/iu.test(result.hostname)) throw new Error();
    return result.origin;
  } catch { fail(503,'adapter_configuration','Adapter HTTPS allowlist тохиргоо буруу.'); }
}
// CORS is server configuration, separate from the bot runtime HTTPS allowlist.
// A malformed explicit sandbox list must never fall back to production CORS.
function browserOrigins(configured,fallback) {
  if(configured!==undefined&&(typeof configured!=='string'||configured.length>65536))fail(503,'adapter_configuration','Origin тохиргоо буруу.');
  const values=configured===undefined?fallback:jsonConfig(configured);
  if(!Array.isArray(values)||!values.length||values.length>100)fail(503,'adapter_configuration','Origin тохиргоо буруу.');
  const result=new Set();
  for(const value of values){
    if(typeof value!=='string'||value.length>2048)fail(503,'adapter_configuration','Origin тохиргоо буруу.');
    const origin=value==='http://localhost:4173'?value:originUrl(value);
    if(value!=='http://localhost:4173'){
      const host=new URL(origin).hostname;
      if(!host.includes('.')||/\.(?:localhost|local|internal)$/iu.test(host))fail(503,'adapter_configuration','Origin тохиргоо буруу.');
    }
    // Require an exact canonical origin: no wildcard, path, trailing slash,
    // userinfo, query, fragment, whitespace or opaque/null origin values.
    if(origin!==value||result.has(origin)||origin.includes('*'))fail(503,'adapter_configuration','Origin тохиргоо буруу.');
    result.add(origin);
  }
  return result;
}
function publicProjectKey(get) {
  const configured=get('SUPABASE_PUBLISHABLE_KEYS');
  if(configured!==undefined){
    if(typeof configured!=='string'||configured.length>65536)fail(503,'adapter_configuration','ERP public key тохиргоо буруу.');
    const keys=jsonConfig(configured);
    if(!isObject(keys)||Object.keys(keys).length>256||!Object.hasOwn(keys,'default')||
      Object.values(keys).some(value=>typeof value!=='string'||!/^sb_publishable_[a-zA-Z0-9_-]{8,512}$/u.test(value)))
      fail(503,'adapter_configuration','ERP public key тохиргоо буруу.');
    return keys.default;
  }
  // Legacy projects still inject their public anon key. Never use service-role
  // or new secret keys, even if an operator puts one in this variable by error.
  const legacy=get('SUPABASE_ANON_KEY');
  if(typeof legacy!=='string'||!legacy||legacy.length>8192||/\s/u.test(legacy)||/^sb_secret_/iu.test(legacy))fail(503,'adapter_configuration','ERP public key тохиргоо буруу.');
  const parts=legacy.split('.');
  if(parts.length===3){
    try{
      const claims=JSON.parse(atob(parts[1].replaceAll('-','+').replaceAll('_','/')));
      if(isObject(claims)&&claims.role!==undefined&&claims.role!=='anon')fail(503,'adapter_configuration','ERP public key тохиргоо буруу.');
    }catch(error){if(error instanceof ContractError)throw error;}
  }
  return legacy;
}
function requestContract(body) {
  if (!isObject(body) || !Object.hasOwn(SOCIAL_ACTIONS,body.action)) invalid();
  if (body.action==='assistant') { exact(body,['action','query']); return {...body,query:text(body.query,500)}; }
  const common=['action','pageId','resource'];
  const extras={capabilities:[],list:['filters'],detail:['id'],history:['id','filters'],reply:['id','reply'],
    settings:[],suggest:['id'],edit:['reply'],approve:['reply'],send:['reply','idempotencyKey'],
    update:['id','patch'],audit:['filters']}[body.action];
  exact(body,[...common,...extras]);
  const result={...body,pageId:uuid(body.pageId),resource:body.resource??'messenger'};
  if (!['messenger','comment'].includes(result.resource)) invalid();
  if (['detail','history','suggest','update'].includes(result.action)) result.id=uuid(body.id);
  if (['edit','approve','send'].includes(result.action)) {
    exact(body.reply,result.action==='edit'?['id','version','text']:['id','version']);
    result.reply={id:uuid(body.reply.id),version:version(body.reply.version),...(result.action==='edit'?{text:text(body.reply.text)}:{})};
  }
  if (result.action==='reply') {
    if (body.id!==undefined && body.reply!==undefined) invalid();
    if (body.reply!==undefined) exact(body.reply,['id']);
    result.id=uuid(body.id??body.reply?.id);
  }
  if (result.action==='send' && (typeof body.idempotencyKey!=='string'||!IDEMPOTENCY.test(body.idempotencyKey))) invalid();
  if (result.action==='history' && result.resource!=='messenger') invalid();
  if (result.action==='update') {
    exact(body.patch,['expectedVersion','status','paused','assignedTo']);
    // Bot assignedTo is display metadata, not the ERP's team/agent assignment.
    // Only the authoritative, versioned ERP RPC validates assignee eligibility.
    if(Object.hasOwn(body.patch,'assignedTo'))fail(400,'assignment_managed_by_erp','Ажилтны хуваарилалтыг ERP update_social_conversation RPC-ээр удирдана.');
    result.patch={...body.patch,expectedVersion:version(body.patch.expectedVersion)};
    if (Object.keys(body.patch).length<2) invalid();
    if (body.patch.status!==undefined&&!['collecting','ready','review','done'].includes(body.patch.status)) invalid();
    if (body.patch.paused!==undefined&&(typeof body.patch.paused!=='boolean'||result.resource==='comment')) invalid();
  }
  const filters=body.filters??{};
  if (result.action==='list') {
    exact(filters,['limit','cursor','status','assignedTo']);
    if (filters.status!==undefined&&!['collecting','ready','review','done'].includes(filters.status)) invalid();
    for (const [key,max] of [['cursor',512],['assignedTo',128]]) if (filters[key]!==undefined&&(typeof filters[key]!=='string'||filters[key].length>max)) invalid();
    result.filters={...filters,limit:positive(filters.limit,100,25)};
  }
  if (['history','audit'].includes(result.action)) {
    exact(filters,['limit','after']);
    const after=filters.after??0;
    if (!Number.isSafeInteger(after)||after<0||after>999999999999999) invalid();
    result.filters={limit:positive(filters.limit,100,25),after};
  }
  return result;
}

async function boundedJson(source,max,signal) {
  const length=Number(source.headers.get('content-length'));
  if (Number.isFinite(length)&&length>max) fail(502,'response_too_large','Adapter хариу хэт том байна.');
  const reader=source.body?.getReader();
  if (!reader) fail(502,'invalid_upstream_response','Adapter хариу буруу.');
  const chunks=[];let size=0;
  const read=()=>new Promise((resolve,reject)=>{
    const abort=()=>reject(new ContractError(504,'adapter_timeout','Adapter хугацаа хэтэрсэн.'));
    if(signal.aborted) return abort();
    signal.addEventListener('abort',abort,{once:true});
    reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
  try {
    while(true) { const {done,value}=await read();if(done)break;size+=value.byteLength;if(size>max)fail(502,'response_too_large','Adapter хариу хэт том байна.');chunks.push(value); }
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
    catch { fail(502,'invalid_upstream_response','Adapter JSON хариу буруу.'); }
  } finally { reader.cancel().catch(()=>{}); }
}

function runtimeFor(page,get) {
  const origins=jsonConfig(get('FACEBOOK_BOT_ALLOWED_ORIGINS_JSON')??'[]');
  if(!Array.isArray(origins)||!origins.length||origins.length>100)fail(503,'adapter_configuration','Adapter allowlist дутуу.');
  const allowlist=new Set(origins.map(originUrl));
  const registryText=get('FACEBOOK_BOT_PAGE_REGISTRY_JSON');let found;
  if(registryText!==undefined&&registryText!=='') {
    const registry=jsonConfig(registryText);
    if(!Array.isArray(registry)||!registry.length||registry.length>256)fail(503,'adapter_configuration','Page adapter registry буруу.');
    const seen=new Set();
    for(const item of registry) {
      if(!isObject(item)||Object.keys(item).some(k=>!['erpPageId','organizationId','externalPageId','apiVersion','baseUrl','tokenEnv'].includes(k))||
        !UUID.test(item.erpPageId??'')||!UUID.test(item.organizationId??'')||!external(item.externalPageId)||typeof item.apiVersion!=='string'||
        typeof item.tokenEnv!=='string'||!/^FACEBOOK_BOT_ERP_TOKEN_[A-Z0-9_]{1,64}$/u.test(item.tokenEnv))fail(503,'adapter_configuration','Page adapter registry буруу.');
      const key=item.erpPageId.toLowerCase();if(seen.has(key))fail(503,'adapter_configuration','Page adapter registry давхардсан.');seen.add(key);
      if(key===page.id) found={...item,erpPageId:key,organizationId:item.organizationId.toLowerCase(),token:get(item.tokenEnv)};
    }
  } else {
    found={erpPageId:get('FACEBOOK_BOT_EXPECTED_ERP_PAGE_ID'),organizationId:get('FACEBOOK_BOT_EXPECTED_ORGANIZATION_ID'),
      externalPageId:get('FACEBOOK_BOT_EXPECTED_PAGE_ID'),apiVersion:'1',baseUrl:get('FACEBOOK_BOT_API_BASE_URL'),token:get('FACEBOOK_BOT_ERP_TOKEN')};
  }
  if(!found||found.erpPageId!==page.id||found.organizationId!==page.organization_id||found.externalPageId!==page.external_page_id)
    fail(503,'page_adapter_unconfigured','Энэ Page-ийн adapter identity тохироогүй.');
  if(found.apiVersion!=='1')fail(503,'unsupported_adapter_version','Олон Page v2 adapter хэрэгжээгүй.');
  const baseUrl=originUrl(found.baseUrl);
  if(!allowlist.has(baseUrl)||typeof found.token!=='string'||found.token.length<32||found.token.length>512||!/^\S+$/u.test(found.token))fail(503,'adapter_configuration','Page adapter тохиргоо буруу.');
  return {...found,baseUrl};
}

export function createSocialIntegrationHandler({createClient,fetchImpl,env={},mockAdapter,clock=Date.now,timeoutMs=10000,maxResponseBytes=MAX_RESPONSE,allowedOrigins=DEFAULT_ORIGINS}={}) {
  if(typeof createClient!=='function')throw new TypeError('createClient dependency required');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>30000||!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<256||maxResponseBytes>MAX_RESPONSE)throw new TypeError('Invalid bounds');
  const get=name=>typeof env==='function'?env(name):env[name];
  return async function handle(request) {
    const origin=request.headers.get('origin')??'';
    const requestId=crypto.randomUUID(),secrets=[];
    let origins,originConfigurationValid=true;
    try{origins=browserOrigins(get('SOCIAL_ALLOWED_ORIGINS_JSON'),allowedOrigins);}catch{origins=new Set();originConfigurationValid=false;}
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-retry-count, traceparent, tracestate, baggage',
      'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Expose-Headers':'x-request-id,retry-after','X-Request-Id':requestId,
      ...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};
    const respond=(status,value,extra={})=>new Response(JSON.stringify(scrub(value,secrets)),{status,headers:{...headers,...extra}});
    if(!originConfigurationValid)return respond(503,{ok:false,error:{code:'adapter_configuration',message:'Origin тохиргоо буруу.',requestId}});
    if(!origins.has(origin))return respond(403,{ok:false,error:{code:'origin_forbidden',message:'Origin зөвшөөрөгдөөгүй.',requestId}});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return respond(405,{ok:false,error:{code:'method_not_allowed',message:'POST шаардлагатай.',requestId}},{Allow:'POST, OPTIONS'});
    const controller=new AbortController();
    let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ContractError(504,'adapter_timeout','Хугацаа хэтэрсэн. Илгээлтийг давтахгүйгээр төлөв шалгана уу.'));},timeoutMs);});
    const check=()=>{if(controller.signal.aborted)throw new ContractError(504,'adapter_timeout','Adapter хугацаа хэтэрсэн.');};
    const db=async promise=>{
      let result;
      try{result=await promise;}catch{check();fail(503,'authorization_unavailable','ERP эрх эсвэл өгөгдлийн шалгалт боломжгүй.');}
      check();
      if(result?.error){
        const codes={
          '42501':[403,'permission_denied'],P0002:[404,'not_found'],'40001':[409,'version_conflict'],
          '55P03':[409,'conversation_locked'],'22023':[400,'invalid_request'],'23514':[400,'constraint_violation'],'23505':[409,'conflict'],
        };
        const mapped=Object.hasOwn(codes,result.error.code)?codes[result.error.code]:null;
        if(mapped)fail(mapped[0],mapped[1],'ERP хүсэлт эрх, төлөв эсвэл version-ийн шалгалтад нийцсэнгүй.');
        fail(503,'authorization_unavailable','ERP эрх эсвэл өгөгдлийн шалгалт боломжгүй.');
      }
      return result?.data;
    };
    let mutationAttempted=false,operationId;
    try {
      return await Promise.race([timeout,(async()=>{
        const authorization=request.headers.get('authorization');
        if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9._~-]{1,4096}$/u.test(authorization))fail(401,'unauthorized','Нэвтрэх шаардлагатай.');
        const jwt=authorization.slice(7);secrets.push(jwt);
        const supabaseUrl=get('SUPABASE_URL'),anon=publicProjectKey(get);
        if(!supabaseUrl||!anon)fail(503,'adapter_configuration','ERP adapter тохируулагдаагүй.');
        secrets.push(anon);
        const client=createClient(supabaseUrl,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
        const auth=await client.auth.getUser(jwt);check();
        const user=auth?.data?.user;
        if(auth?.error||!user||!UUID.test(user.id??'')||user.is_anonymous===true)fail(401,'unauthorized','Нэвтрэх шаардлагатай.');
        const profile=await db(client.from('profiles').select('id,organization_id,status').eq('id',user.id).single());
        if(!profile||profile.id!==user.id||profile.status!=='active'||!UUID.test(profile.organization_id??''))fail(403,'inactive_profile','Идэвхтэй байгууллагын profile шаардлагатай.');
        if(!(request.headers.get('content-type')??'').toLowerCase().startsWith('application/json'))fail(415,'json_required','JSON шаардлагатай.');
        const input=await boundedJson(request,MAX_BODY,controller.signal).catch(error=>{if(error.code==='response_too_large')fail(413,'body_too_large','Хүсэлт 64 KiB-аас хэтэрсэн.');if(error.code==='invalid_upstream_response')invalid();throw error;});
        const body=requestContract(input),[required,pageAction]=SOCIAL_ACTIONS[body.action];
        const permission=async name=>(await db(client.rpc('has_permission',{required_permission:name})))===true;
        if(!await permission(required))fail(403,'permission_denied','Энэ үйлдлийн эрх байхгүй.');
        const requireFlag=async name=>{const value=await db(client.from('feature_flags').select('enabled').eq('organization_id',profile.organization_id).eq('key',name).maybeSingle());if(value?.enabled!==true)fail(403,'feature_disabled','Энэ боломж идэвхгүй байна.');};
        const audit=async (page,phase,status,extra={})=>{
          try{return await db(client.from('audit_logs').insert({organization_id:profile.organization_id,actor_id:user.id,
            action:`social.${body.action}.${phase}`,entity_type:'social_integration',entity_id:body.id??body.reply?.id??page?.id??null,
            after_data:{requestId,pageId:page?.id??null,externalPageId:page?.external_page_id??null,status,...extra}}));}
          catch(error){if(controller.signal.aborted)throw error;fail(503,'audit_unavailable','Audit хадгалалт боломжгүй.');}
        };
        if(body.action==='assistant') {
          await requireFlag('momo_ai_grounded_search');
          if(!await permission('ai_assistant.erp_read')||!await permission('products.read'))fail(403,'erp_read_denied','ERP барааны мэдээлэл унших эрх шаардлагатай.');
          const products=await db(client.from('products').select('id,organization_id,sku,name,sale_price,updated_at').eq('organization_id',profile.organization_id).eq('is_active',true).limit(100));
          const needle=body.query.toLocaleLowerCase('mn');
          const matched=(Array.isArray(products)?products:[]).filter(p=>p.organization_id===profile.organization_id&&typeof p.name==='string'&&(p.name.toLocaleLowerCase('mn').includes(needle)||String(p.sku??'').toLocaleLowerCase('mn').includes(needle))).slice(0,5);
          let balances=null;
          if(matched.length&&await permission('inventory.read'))balances=await db(client.from('inventory_balances').select('organization_id,product_id,quantity').eq('organization_id',profile.organization_id).in('product_id',matched.map(p=>p.id)));
          const number=value=>value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
          const facts=matched.map(p=>{const rows=Array.isArray(balances)?balances.filter(b=>b.organization_id===profile.organization_id&&b.product_id===p.id):[];
            const quantities=rows.map(b=>number(b.quantity));
            return {id:p.id,sku:p.sku,name:p.name,price:number(p.sale_price),stock:quantities.length&&quantities.every(n=>n!==null)?quantities.reduce((a,b)=>a+b,0):null,updatedAt:p.updated_at??null,source:'erp'};});
          await audit(null,'result',200,{sourceCount:facts.length});
          return respond(200,{ok:true,data:{answer:facts.length?facts.map(p=>`${p.name}: үнэ ${p.price===null?'тодорхойгүй':p.price+'₮'}, үлдэгдэл ${p.stock===null?'тодорхойгүй':p.stock}`).join('\n'):'Баталгаатай барааны мэдээлэл олдсонгүй. Үнэ эсвэл үлдэгдэл зохиож хариулахгүй.',sources:facts,llmConfigured:false},meta:{requestId}});
        }
        await requireFlag('social_inbox_read');
        if(pageAction!=='read'&&!await permission('social_inbox.read'))fail(403,'permission_denied','Inbox унших эрх шаардлагатай.');
        if(['suggest','edit','approve'].includes(body.action))await requireFlag('social_inbox_ai_draft');
        if(body.action==='send')await requireFlag('social_inbox_reply_send');
        if(body.action==='update'&&body.patch.status==='done'&&!await permission('social_inbox.resolve'))fail(403,'permission_denied','Шийдвэрлэх эрх шаардлагатай.');
        if(pageAction!=='read'&&(await db(client.rpc('can_access_social_page',{target_page:body.pageId,required_action:'read'})))!==true)
          fail(403,'page_read_required','Энэ Page-ийн мэдээлэл унших эрх шаардлагатай.');
        // Closing or reopening bot context is a reply workflow decision, not
        // merely assignment metadata. Match the SQL resolve Page reply guard.
        if(body.action==='update'&&body.patch.status!==undefined&&
          (await db(client.rpc('can_access_social_page',{target_page:body.pageId,required_action:'reply'})))!==true)
          fail(403,'page_reply_required','Төлөв солиход энэ Page-ийн хариулах эрх шаардлагатай.');
        const pageAllowed=await db(client.rpc('can_access_social_page',{target_page:body.pageId,required_action:pageAction}));
        if(pageAllowed!==true)fail(403,'page_forbidden','Энэ Page-ийн үйлдлийн эрх байхгүй.');
        const page=await db(client.rpc('get_social_page_context',{target_page:body.pageId,required_action:pageAction}));
        if(!isObject(page)||page.id!==body.pageId||page.organization_id!==profile.organization_id||page.is_active!==true||!external(page.external_page_id))fail(403,'page_forbidden','Page байгууллага эсвэл идэвхтэй төлөв тохироогүй.');
        // Recheck after preflight/audit waits immediately before a mutation.
        // This is a gateway request guard only. v1 queued bot jobs still use a
        // service credential; employee revocation of queued jobs needs a future
        // delegated authorization protocol and is not implemented here.
        const reauthorizeMutation=async()=>{
          if(!await permission(required)||!await permission('social_inbox.read'))fail(403,'permission_denied','Үйлдлийн эрх өөрчлөгдсөн.');
          await requireFlag('social_inbox_read');
          if(['suggest','edit','approve'].includes(body.action))await requireFlag('social_inbox_ai_draft');
          if(body.action==='send')await requireFlag('social_inbox_reply_send');
          if(body.action==='update'&&body.patch.status==='done'&&!await permission('social_inbox.resolve'))fail(403,'permission_denied','Шийдвэрлэх эрх өөрчлөгдсөн.');
          const read=await db(client.rpc('can_access_social_page',{target_page:body.pageId,required_action:'read'}));
          if(read!==true)fail(403,'page_read_required','Page унших эрх өөрчлөгдсөн.');
          if(body.action==='update'&&body.patch.status!==undefined&&
            (await db(client.rpc('can_access_social_page',{target_page:body.pageId,required_action:'reply'})))!==true)
            fail(403,'page_reply_required','Page хариулах эрх өөрчлөгдсөн.');
          if((await db(client.rpc('can_access_social_page',{target_page:body.pageId,required_action:pageAction})))!==true)
            fail(403,'page_forbidden','Page үйлдлийн эрх өөрчлөгдсөн.');
          const current=await db(client.rpc('get_social_page_context',{target_page:body.pageId,required_action:pageAction}));
          if(!isObject(current)||current.id!==page.id||current.organization_id!==profile.organization_id||current.is_active!==true)
            fail(403,'page_forbidden','Page байгууллага эсвэл идэвхтэй төлөв өөрчлөгдсөн.');
          if(current.external_page_id!==page.external_page_id)fail(409,'page_binding_changed','Page холболт өөрчлөгдсөн. Шинэ төлөв уншина уу.');
          if(mode==='live'&&current.connection_status!=='connected')fail(503,'page_not_connected','Page холболт өөрчлөгдсөн.');
        };
        const mode=get('SOCIAL_ADAPTER_MODE')??'mock';
        if(!['mock','live'].includes(mode))fail(503,'adapter_configuration','Adapter mode буруу.');
        let runtime;
        if(mode==='live') {
          if(page.connection_status!=='connected')fail(503,'page_not_connected','Page холболт баталгаажаагүй.');
          runtime=runtimeFor(page,get);secrets.push(runtime.token);
          if(typeof fetchImpl!=='function')fail(503,'adapter_configuration','HTTP adapter байхгүй.');
        } else if(!mockAdapter||typeof mockAdapter.request!=='function')fail(503,'mock_not_configured','Тусдаа stateful mock fixture тохируулаагүй.');
        const upstream=async(method,path,payload,key,staffContext)=>{
          check();let response;
          if(method!=='GET')await reauthorizeMutation();
          try {
            if(method!=='GET')mutationAttempted=true;
            if(mode==='mock')response=await mockAdapter.request({page,method,path,body:payload,idempotencyKey:key,signal:controller.signal,...(staffContext?{staffContext}:{} )});
            else {
              const url=new URL(path,runtime.baseUrl);url.searchParams.set('pageId',page.external_page_id);
              response=await fetchImpl(url.toString(),{method,redirect:'error',signal:controller.signal,
                headers:{Authorization:`Bearer ${runtime.token}`,Accept:'application/json',...(payload===undefined?{}:{'Content-Type':'application/json'}),...(key?{'Idempotency-Key':key}:{}),
                  ...(staffContext?{'X-Momo-Erp-Actor':staffContext.subjectId,'X-Momo-Erp-Organization':staffContext.organizationId,'X-Momo-Erp-Team':staffContext.teamId}:{})},
                ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
            }
          } catch {check();fail(502,'adapter_network','Adapter холболт амжилтгүй. Илгээлтийг шинэ key-ээр давтахгүй.');}
          check();
          if(!/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/iu.test(response.headers.get('content-type')??''))fail(502,'invalid_upstream_response','Adapter JSON хариу шаардлагатай.');
          const data=await boundedJson(response,maxResponseBytes,controller.signal);
          const remoteRequestId=safeRequestId(data?.requestId)||safeRequestId(response.headers.get('x-request-id'));
          const retryAfter=safeRetryAfter(response.headers.get('retry-after'));
          if(!response.ok)fail(response.status>=400&&response.status<=599?response.status:502,
            typeof data?.error?.code==='string'&&/^[a-zA-Z0-9_.:-]{1,80}$/u.test(data.error.code)?data.error.code:'upstream_error',
            'Bot хүсэлтийг зөвшөөрсөнгүй. Төлөв, эрх эсвэл version-ийг шалгана уу.',{upstreamStatus:response.status,upstreamRequestId:remoteRequestId,retryAfter});
          if(!isObject(data))fail(502,'invalid_upstream_response','Adapter response бүтэц буруу.');
          return {data,status:response.status,remoteRequestId};
        };
        const caps=await upstream('GET','/erp/v1/capabilities');
        if(caps.data.apiVersion!=='1'||caps.data.pageId!==page.external_page_id)fail(503,'runtime_identity_mismatch','Runtime Page identity тохирохгүй.');
        const staffRecheck=get('SOCIAL_STAFF_RECHECK_ENABLED');
        if(staffRecheck!==undefined&&!['true','false'].includes(staffRecheck))fail(503,'adapter_configuration','Ажилтны эрх дахин шалгах тохиргоо буруу.');
        if(body.action==='send'&&caps.data.actorRecheckRequired===true&&staffRecheck!=='true')
          fail(503,'staff_recheck_required','Bot ажилтны баталгаажсан context шаардсан боловч ERP холболт идэвхгүй байна.');
        const kind=body.resource==='comment'?'comments':'conversations';
        const matches=(data,id,channel=body.resource)=>{
          if(!isObject(data)||data.pageId!==page.external_page_id||(id&&data.id!==id)||(channel&&data.channel!==channel))fail(502,'resource_page_mismatch','Bot resource Page эсвэл төрөл тохирохгүй.');return data;
        };
        const context=async id=>matches((await upstream('GET',`/erp/v1/${kind}/${id}`)).data,id);
        let result=caps;
        if(body.action==='list') {
          const query=new URLSearchParams();for(const [key,value]of Object.entries(body.filters))if(value!==undefined)query.set(key,String(value));
          result=await upstream('GET',`/erp/v1/${kind}?${query}`);
          if(!Array.isArray(result.data.items))fail(502,'invalid_upstream_response','Inbox response буруу.');result.data.items.forEach(item=>matches(item));
        } else if(body.action==='detail') result={data:await context(body.id),status:200};
        else if(body.action==='history') {
          await context(body.id);result=await upstream('GET',`/erp/v1/conversations/${body.id}/messages?${new URLSearchParams(body.filters)}`);
          if(!Array.isArray(result.data.items))fail(502,'invalid_upstream_response','History response буруу.');result.data.items.forEach(item=>{matches(item,undefined,'messenger');if(item.conversationId!==body.id)fail(502,'resource_page_mismatch','History context тохирохгүй.');});
        } else if(['suggest','update'].includes(body.action)) {
          await context(body.id);await audit(page,'requested',0);
          result=await upstream(body.action==='suggest'?'POST':'PATCH',`/erp/v1/${kind}/${body.id}${body.action==='suggest'?'/suggestions':''}`,body.action==='suggest'?{}:body.patch);
          if(body.action==='suggest') {matches(result.data);if(result.data.conversationId!==body.id)fail(502,'resource_page_mismatch','Reply context тохирохгүй.');}
          else matches(result.data,body.id);
        } else if(['reply','edit','approve','send'].includes(body.action)) {
          const id=body.action==='reply'?body.id:body.reply.id;
          const stored=await upstream('GET',`/erp/v1/replies/${id}`);matches(stored.data,id);
          await context(uuid(stored.data.conversationId));
          if(body.action==='reply')result=stored;
          else {
            // For send, do not reject a stale version locally: the bot must be
            // allowed to replay an already accepted identical idempotent request.
            if(body.action!=='send'&&stored.data.version!==body.reply.version)fail(409,'version_conflict','Хариу өөрчлөгдсөн. Шинэ төлөв уншина уу.');
            // A shared v1 service credential is one upstream actor. Namespace
            // client keys by verified org/Page/user so two ERP users cannot
            // collide or retrieve each other's cached operation response.
            const key=body.action==='send'?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([
              profile.organization_id,page.id,user.id,body.idempotencyKey,
            ]))))).map(byte=>byte.toString(16).padStart(2,'0')).join(''):undefined;
            operationId=key;
            let staffContext;
            if(body.action==='send'&&staffRecheck==='true') {
              staffContext=await db(client.rpc('get_social_delivery_context',{target_page:page.id}));
              if(!isObject(staffContext)||staffContext.subjectId!==user.id||staffContext.organizationId!==profile.organization_id||
                staffContext.erpPageId!==page.id||staffContext.pageId!==page.external_page_id||!UUID.test(staffContext.teamId??''))
                fail(403,'staff_context_denied','Ажилтан, Page болон багийн хүчинтэй илгээх эрх олдсонгүй.');
            }
            await audit(page,'requested',0,{replyVersion:body.reply.version,operationId:key,...(staffContext?{teamId:staffContext.teamId}:{})});
            result=await upstream(body.action==='edit'?'PATCH':'POST',`/erp/v1/replies/${id}${body.action==='edit'?'':'/'+body.action}`,
              {expectedVersion:body.reply.version,...(body.action==='edit'?{text:body.reply.text}:{})},key,staffContext);
            if(body.action==='send'){if(result.data.replyId!==id)fail(502,'resource_page_mismatch','Queued reply тохирохгүй.');}
            else matches(result.data,id);
          }
        } else if(body.action==='settings')result=await upstream('GET','/erp/v1/settings');
        else if(body.action==='audit')result=await upstream('GET',`/erp/v1/audit?${new URLSearchParams(body.filters)}`);
        let auditRecorded=true;
        try{await audit(page,'result',result.status,{upstreamRequestId:result.remoteRequestId??null,mode});}catch{auditRecorded=false;}
        return respond(result.status,{ok:true,data:{...result.data,...(body.action==='capabilities'?{mode,erpPageId:page.id}:{}),...(mode==='mock'?{mock:true}:{})},
          meta:{mode,pageId:page.id,externalPageId:page.external_page_id,upstreamStatus:result.status,requestId,upstreamRequestId:result.remoteRequestId??null,auditRecorded,
            outcomeUnknown:false,...(operationId?{operationId}:{})}});
      })()]);
    } catch(error) {
      const known=error instanceof ContractError;
      const status=known?error.status:500;
      const data={code:known?error.code:'internal_error',message:known?error.message:'Интеграцын дотоод алдаа.',requestId,
        outcomeUnknown:mutationAttempted&&status>=500,...(operationId?{operationId}:{}),
        ...(known&&error.upstreamStatus?{upstreamStatus:error.upstreamStatus}:{}),...(known&&error.upstreamRequestId?{upstreamRequestId:error.upstreamRequestId}:{}),
        ...(known&&error.retryAfter!==undefined?{retryAfter:error.retryAfter}:{})};
      return respond(status,{ok:false,error:data},data.retryAfter===undefined?{}:{'Retry-After':String(data.retryAfter)});
    } finally {clearTimeout(timer);controller.abort();}
  };
}

/** Explicit fixture dependency only: never constructed by the deployed entry. */
export function createStatefulMockAdapter({pages=[],clock=Date.now,uuid:makeId=()=>crypto.randomUUID()}={}) {
  const state=new Map(),operations=[];
  const error=(status,code)=>Response.json({error:{code,message:'Mock contract rejected request.'}},{status});
  const output=(data,status=200)=>Response.json({...copy(data),mock:true},{status});
  for(const page of pages) {
    state.set(page.erpPageId,{externalPageId:page.externalPageId,contexts:new Map((page.contexts??[]).map(c=>[c.id,{...copy(c),pageId:page.externalPageId,version:c.version??1,replies:[]}])) ,replies:new Map(),keys:new Map(),settings:{version:1,autoSendMessenger:false,autoSendComments:false}});
  }
  const getPage=id=>{const page=state.get(id);if(!page)throw new Error('Unknown mock Page');return page;};
  const contextView=(p,c)=>({...copy(c),replies:[...p.replies.values()].filter(r=>r.conversationId===c.id).map(copy)});
  return {
    operations,
    changeContext(pageId,id,patch) {
      const p=getPage(pageId),c=p.contexts.get(id);if(!c)throw new Error('Unknown mock context');Object.assign(c,copy(patch),{version:c.version+1,basisId:makeId(),updatedAt:clock()});
      for(const r of p.replies.values())if(r.conversationId===id&&['draft','approved','queued'].includes(r.state)){r.state='superseded';r.version++;}
    },
    async request({page,method,path,body,idempotencyKey}) {
      const p=state.get(page.id);if(!p||p.externalPageId!==page.external_page_id)return error(404,'not_found');
      const url=new URL(path,'https://mock.invalid'),parts=url.pathname.split('/').slice(3);
      operations.push({pageId:page.id,method,path:url.pathname});
      if(url.pathname==='/erp/v1/capabilities')return output({apiVersion:'1',pageId:p.externalPageId,sending:false,messengerControlledByErp:true,commentsIngestion:true,commentSending:false,llmConfigured:false,suggestionProvider:'mock-rules-v1'});
      if(url.pathname==='/erp/v1/settings')return output(p.settings);
      if(url.pathname==='/erp/v1/audit')return output({items:[],nextAfter:null});
      if(['conversations','comments'].includes(parts[0])) {
        const channel=parts[0]==='comments'?'comment':'messenger';
        if(parts.length===1&&method==='GET')return output({items:[...p.contexts.values()].filter(c=>c.channel===channel).map(c=>contextView(p,c)),nextCursor:null});
        const c=p.contexts.get(parts[1]);if(!c||c.channel!==channel)return error(404,'not_found');
        if(parts[2]==='messages')return output({items:(c.messages??[]).map(m=>({...m,pageId:p.externalPageId,channel:'messenger',conversationId:c.id})),nextAfter:null});
        if(parts[2]==='suggestions'&&method==='POST') {
          if(c.deleted)return error(409,'stale_context');
          const existing=[...p.replies.values()].find(r=>r.conversationId===c.id&&r.basisId===c.basisId&&!['superseded','skipped'].includes(r.state));if(existing)return output(existing,201);
          const r={id:makeId(),conversationId:c.id,pageId:p.externalPageId,channel,basisId:c.basisId,text:'Сайн байна уу. Мэдээллийг ажилтан шалгаж хариулна.',source:'mock-rules-v1',model:null,state:'draft',version:1,approvedBy:null,approvedAt:null,createdAt:clock(),updatedAt:clock()};p.replies.set(r.id,r);return output(r,201);
        }
        if(method==='PATCH'){if(body.expectedVersion!==c.version)return error(409,'version_conflict');Object.assign(c,copy(body),{version:c.version+1});delete c.expectedVersion;return output(contextView(p,c));}
        return output(contextView(p,c));
      }
      if(parts[0]==='replies') {
        const r=p.replies.get(parts[1]);if(!r)return error(404,'not_found');
        const c=p.contexts.get(r.conversationId);
        if(method==='GET'){if(r.state==='queued'){r.state='sent';r.remoteId='mock-delivery-'+r.id;r.version++;}return output(r);}
        const key=idempotencyKey;
        if(parts[2]==='send'&&p.keys.has(key)){const old=p.keys.get(key);return old.hash===JSON.stringify([r.id,body.expectedVersion])?output({...old.result,replayed:true},202):error(409,'idempotency_conflict');}
        if(body.expectedVersion!==r.version)return error(409,'version_conflict');
        if(c.basisId!==r.basisId||c.deleted)return error(409,'stale_context');
        if(method==='PATCH'){if(!['draft','approved'].includes(r.state))return error(409,'reply_locked');Object.assign(r,{text:body.text,state:'draft',approvedBy:null,approvedAt:null,version:r.version+1});return output(r);}
        if(parts[2]==='approve'){if(r.state!=='draft')return error(409,'reply_locked');Object.assign(r,{state:'approved',approvedBy:'mock-reviewer',approvedAt:clock(),version:r.version+1});return output(r);}
        if(parts[2]==='send') {
          if(!IDEMPOTENCY.test(key??''))return error(400,'invalid_request');if(r.state!=='approved')return error(409,'approval_required');
          if(c.channel==='messenger'&&(c.replyAllowed!==true||c.paused||c.status==='done'))return error(409,'conversation_read_only');
          r.state='queued';r.version++;const result={replyId:r.id,state:r.state,version:r.version,replayed:false};p.keys.set(key,{hash:JSON.stringify([r.id,body.expectedVersion]),result});return output(result,202);
        }
      }
      return error(404,'not_found');
    },
  };
}
