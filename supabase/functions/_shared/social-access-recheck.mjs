// Trusted server-to-server authorization endpoint. No SDK import, automatic
// environment read, user impersonation, mail, Meta call or order write.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PERMISSION = 'social_inbox.reply_send';
const KEYS = ['requestId','subjectId','pageId','permission','organizationId','teamId'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
class AccessFailure extends Error {
  constructor(status,code) { super('Access recheck unavailable.'); this.status=status; this.code=code; }
}
const fail = (status,code) => { throw new AccessFailure(status,code); };
async function readBody(request,check) {
  const maximum=4096, declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maximum)fail(413,'body_too_large');
  const reader=request.body?.getReader(); if(!reader)fail(400,'invalid_request');
  const chunks=[];let length=0;
  try {
    for(;;){check();const{done,value}=await reader.read();check();if(done)break;
      length+=value.byteLength;if(length>maximum){await reader.cancel().catch(()=>{});fail(413,'body_too_large');}chunks.push(value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'invalid_request');}
}
function serverUrl(value) {
  try {
    const url=new URL(value),local=['127.0.0.1','localhost'].includes(url.hostname);
    if((url.protocol!=='https:'&&!(local&&url.protocol==='http:'))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error();
    return url.origin;
  }catch{fail(503,'backend_configuration');}
}

/**
 * SOCIAL_ACCESS_RECHECK_ENABLED defaults false. The opaque connector Bearer is
 * distinct from browser JWTs and service-role keys. WebCrypto HMAC verification
 * compares credentials without a JS prefix/string equality secret comparison.
 */
export function createSocialAccessRecheckHandler({createClient,env={},clock=Date.now,timeoutMs=3000}={}) {
  if(typeof createClient!=='function'||typeof clock!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>4000)throw new TypeError('Invalid access recheck dependencies.');
  const get=name=>typeof env==='function'?env(name):env[name];
  const encoder=new TextEncoder();
  const comparisonKey=crypto.subtle.importKey('raw',crypto.getRandomValues(new Uint8Array(32)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  async function authorized(configured,supplied){
    const key=await comparisonKey;
    const expected=await crypto.subtle.sign('HMAC',key,encoder.encode(configured));
    return crypto.subtle.verify('HMAC',key,expected,encoder.encode(supplied));
  }
  return async function handle(request){
    const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'}});
    // No CORS exception, cookie/admin fallback or browser JWT is accepted.
    if(request.headers.has('origin')||request.headers.has('cookie'))return json(403,{error:'server_to_server_only'});
    if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
    if(get('SOCIAL_ACCESS_RECHECK_ENABLED')!=='true')return json(503,{error:'access_recheck_disabled'});
    let timedOut=false,timer;
    const check=()=>{if(timedOut)fail(503,'access_recheck_timeout');};
    try{
      const token=get('SOCIAL_ACCESS_RECHECK_TOKEN');
      if(typeof token!=='string'||!/^[\x21-\x7e]{32,512}$/u.test(token))fail(503,'backend_configuration');
      const match=request.headers.get('authorization')?.match(/^Bearer ([\x21-\x7e]{32,512})$/u);
      if(!match||!await authorized(token,match[1]))return json(401,{error:'unauthorized'});
      if(!/^application\/json(?:;|$)/iu.test(request.headers.get('content-type')??''))return json(415,{error:'json_required'});
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(new AccessFailure(503,'access_recheck_timeout'));},timeoutMs);});
      return await Promise.race([timeout,(async()=>{
        const body=await readBody(request,check);check();
        if(!object(body)||Object.keys(body).length!==KEYS.length||Object.keys(body).some(key=>!KEYS.includes(key))||
          ![body.requestId,body.subjectId,body.organizationId,body.teamId].every(id=>typeof id==='string'&&UUID.test(id))||
          typeof body.pageId!=='string'||!/^\d{1,32}$/u.test(body.pageId)||body.permission!==PERMISSION||
          request.headers.get('x-momo-request-id')!==body.requestId)fail(400,'invalid_request');
        const serviceKey=get('SUPABASE_SERVICE_ROLE_KEY');
        if(typeof serviceKey!=='string'||serviceKey.length<8||serviceKey.length>8192||/\s/u.test(serviceKey)||serviceKey===token)fail(503,'backend_configuration');
        const client=createClient(serverUrl(get('SUPABASE_URL')),serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
        const result=await client.rpc('get_social_access_recheck',{
          target_user:body.subjectId,target_organization:body.organizationId,target_external_page:body.pageId,target_team:body.teamId,
        });check();
        // SQL/backend failure is unknown, never a verified employee denial.
        if(!result||result.error!==null||result.status!==200||!object(result.data)||
          Object.keys(result.data).length!==2||Object.keys(result.data).some(key=>!['active','allowed'].includes(key))||
          typeof result.data.active!=='boolean'||typeof result.data.allowed!=='boolean'||(!result.data.active&&result.data.allowed))fail(503,'authorization_unavailable');
        const issuedAt=clock();if(!Number.isSafeInteger(issuedAt)||issuedAt<1||!Number.isSafeInteger(issuedAt+5000))fail(503,'clock_unavailable');
        const allowed=result.data.allowed;
        return json(200,{active:result.data.active,userId:body.subjectId,organizationId:body.organizationId,
          teamIds:allowed?[body.teamId]:[],pageIds:allowed?[body.pageId]:[],permissions:allowed?[PERMISSION]:[],
          expiresAt:issuedAt+5000,requestId:body.requestId});
      })()]);
    }catch(error){return json(error instanceof AccessFailure?error.status:503,{error:error instanceof AccessFailure?error.code:'authorization_unavailable'});}
    finally{clearTimeout(timer);}
  };
}
