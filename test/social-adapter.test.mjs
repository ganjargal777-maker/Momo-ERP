import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialIntegrationHandler,createStatefulMockAdapter } from '../supabase/functions/_shared/social-contract.mjs';

const ORG='00000000-0000-4000-8000-000000000001';
const PAGE_A='00000000-0000-4000-8000-000000000002';
const PAGE_B='00000000-0000-4000-8000-000000000003';
const USER='00000000-0000-4000-8000-000000000004';
const CONTEXT='00000000-0000-4000-8000-000000000010';
const COMMENT='00000000-0000-4000-8000-000000000011';
const EXTERNAL_A='12345',EXTERNAL_B='67890';
const TOKEN_A='synthetic-page-a-backend-token-abcdefghijklmnopqrstuvwxyz';
const TOKEN_B='synthetic-page-b-backend-token-abcdefghijklmnopqrstuvwxyz';
const ORIGIN='https://erp.momoshop.mn';
const pages=[
  {id:PAGE_A,organization_id:ORG,external_page_id:EXTERNAL_A,is_active:true,connection_status:'connected'},
  {id:PAGE_B,organization_id:ORG,external_page_id:EXTERNAL_B,is_active:true,connection_status:'connected'},
];
const flagKeys=['social_inbox_read','social_inbox_ai_draft','social_inbox_reply_send','momo_ai_grounded_search'];

function fixture(options={}) {
  const trace=[],fetches=[],audit=[],profile={id:USER,organization_id:ORG,status:'active',...options.profile};
  const registry=structuredClone(pages);
  if(options.pagePatch)Object.assign(registry[0],options.pagePatch);
  const flags=Object.fromEntries(flagKeys.map(k=>[k,true]));Object.assign(flags,options.flags);
  const permissions=new Set(options.permissions??[
    'social_inbox.read','social_inbox.reply_draft','social_inbox.reply_send','social_inbox.assign','social_inbox.resolve','social_audit.read',
    'ai_assistant.use','ai_assistant.erp_read','products.read','inventory.read',
  ]);
  const grants=new Map(registry.map(p=>[p.id,new Set(['read','reply','assign'])]));
  if(options.grants)for(const [id,value]of Object.entries(options.grants))grants.set(id,new Set(value));
  const products=options.products??[];
  const balances=options.balances??[];
  class Query {
    constructor(table){this.table=table;this.filters=[];this.operation='read';}
    select(fields){this.fields=fields;return this;}
    eq(key,value){this.filters.push([key,value]);return this;}
    in(key,value){this.filters.push([key,value]);return this;}
    limit(value){this.limitValue=value;return this;}
    single(){return this.execute();}
    maybeSingle(){return this.execute();}
    insert(value){this.operation='insert';this.value=value;return this;}
    then(resolve,reject){return this.execute().then(resolve,reject);}
    async execute(){
      trace.push({type:'query',table:this.table,filters:this.filters,fields:this.fields,operation:this.operation});
      const eq=key=>this.filters.find(f=>f[0]===key)?.[1];
      if(this.table==='profiles')return {data:profile,error:null};
      if(this.table==='feature_flags')return {data:{enabled:flags[eq('key')]===true},error:null};
      if(this.table==='audit_logs'){if(options.auditFailure===true||(options.auditFailure==='result'&&this.value.action.endsWith('.result')))return {error:{code:options.auditCode,message:'private-database-error'}};audit.push(this.value);await options.onAudit?.(this.value,{permissions,grants,flags,registry});return {data:null,error:null};}
      if(this.table==='products')return {data:products,error:null};
      if(this.table==='inventory_balances')return {data:balances,error:null};
      throw new Error('Unexpected fake table '+this.table);
    }
  }
  const client={
    auth:{getUser:async jwt=>{trace.push({type:'auth',jwt});return options.authError?{error:{message:'private-auth-error'},data:{user:null}}:{error:null,data:{user:{id:USER}}};}},
    from:table=>new Query(table),
    rpc:async(name,args)=>{
      trace.push({type:'rpc',name,args});
      if(options.rpcError&&(!options.rpcErrorAt||options.rpcErrorAt===name))return {data:null,error:{code:options.rpcCode,message:'private-rpc-error '+TOKEN_A}};
      if(name==='has_permission')return {data:permissions.has(args.required_permission),error:null};
      const allowed=grants.get(args.target_page)?.has(args.required_action)===true;
      if(name==='can_access_social_page')return {data:allowed,error:null};
      if(name==='get_social_page_context')return {data:allowed?registry.find(p=>p.id===args.target_page)??null:null,error:null};
      throw new Error('Unexpected RPC '+name);
    },
  };
  let sequence=100;
  const mock=createStatefulMockAdapter({uuid:()=>`00000000-0000-4000-8000-${String(sequence++).padStart(12,'0')}`,pages:registry.map(p=>({
    erpPageId:p.id,externalPageId:p.external_page_id,contexts:[
      {id:CONTEXT,channel:'messenger',basisId:'mock-message-1',status:'review',replyAllowed:true,paused:false,version:1,text:'Synthetic inbox question',messages:[{id:'mock-message-1',direction:'in',text:'Synthetic inbox question'}]},
      {id:COMMENT,channel:'comment',basisId:'mock-comment:1',status:'review',version:1,text:'Synthetic public question',messages:[]},
    ],
  }))});
  const env={SUPABASE_URL:'https://synthetic-supabase.invalid',SUPABASE_ANON_KEY:'synthetic-public-key-not-production',SOCIAL_ADAPTER_MODE:options.mode??'mock',
    FACEBOOK_BOT_ALLOWED_ORIGINS_JSON:JSON.stringify(['https://page-a.example.invalid','https://page-b.example.invalid']),
    FACEBOOK_BOT_PAGE_REGISTRY_JSON:JSON.stringify([
      {erpPageId:PAGE_A,organizationId:ORG,externalPageId:EXTERNAL_A,apiVersion:'1',baseUrl:'https://page-a.example.invalid',tokenEnv:'FACEBOOK_BOT_ERP_TOKEN_A'},
      {erpPageId:PAGE_B,organizationId:ORG,externalPageId:EXTERNAL_B,apiVersion:'1',baseUrl:'https://page-b.example.invalid',tokenEnv:'FACEBOOK_BOT_ERP_TOKEN_B'},
    ]),FACEBOOK_BOT_ERP_TOKEN_A:TOKEN_A,FACEBOOK_BOT_ERP_TOKEN_B:TOKEN_B,...options.env};
  const bridge=async(url,init)=>{
    fetches.push({url,init});
    if(options.fetchImpl)return options.fetchImpl(url,init);
    const parsed=new URL(url),page=parsed.hostname==='page-a.example.invalid'?registry[0]:registry[1];
    assert.equal(init.headers.Authorization,`Bearer ${page.id===PAGE_A?TOKEN_A:TOKEN_B}`);
    assert.equal(parsed.searchParams.get('pageId'),page.external_page_id);
    assert.equal(init.headers.Origin,undefined);assert.equal(init.redirect,'error');
    return mock.request({page,method:init.method,path:parsed.pathname+parsed.search,body:init.body?JSON.parse(init.body):undefined,idempotencyKey:init.headers['Idempotency-Key']});
  };
  const handler=createSocialIntegrationHandler({createClient:(url,key,config)=>{assert.equal(url,env.SUPABASE_URL);assert.equal(key,options.expectedClientKey??env.SUPABASE_ANON_KEY);assert.equal(config.auth.persistSession,false);assert.equal(config.global.headers.Authorization,'Bearer synthetic.user.jwt');return client;},
    env,fetchImpl:bridge,...(options.noMock?{}:{mockAdapter:mock}),timeoutMs:options.timeoutMs??1000,
    ...(options.maxResponseBytes===undefined?{}:{maxResponseBytes:options.maxResponseBytes})});
  const call=async(action,body={},requestOptions={})=>{
    const input={action,...(action==='assistant'?{}:{pageId:PAGE_A,resource:'messenger'}),...body};
    const req=new Request('https://synthetic-edge.invalid/social-integration',{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer synthetic.user.jwt','Content-Type':'application/json',...requestOptions.headers},body:JSON.stringify(input)});
    const response=await handler(req);return {status:response.status,data:await response.json(),headers:response.headers};
  };
  const draft=async(pageId=PAGE_A,resource='messenger',id=resource==='comment'?COMMENT:CONTEXT)=>{
    const r=await call('suggest',{pageId,resource,id});assert.equal(r.status,201);return r.data.data;
  };
  const approve=async(r,pageId=PAGE_A)=>{const response=await call('approve',{pageId,resource:r.channel,reply:{id:r.id,version:r.version}});assert.equal(response.status,200);return response.data.data;};
  return {handler,call,draft,approve,trace,fetches,audit,profile,registry,flags,permissions,grants,mock,env};
}

test('authentication, active org, explicit Page and disabled flags fail closed before provider',async()=>{
  for(const [options,body,status,code]of [
    [{authError:true},{},401,'unauthorized'],[{profile:{status:'disabled'}},{},403,'inactive_profile'],
    [{profile:{organization_id:null}},{},403,'inactive_profile'],[{permissions:[]},{},403,'permission_denied'],
    [{flags:{social_inbox_read:false}},{},403,'feature_disabled'],[{}, {pageId:undefined},400,'invalid_request'],
    [{grants:{[PAGE_A]:[]}},{},403,'page_forbidden'],[{pagePatch:{is_active:false}},{},403,'page_forbidden'],
    [{pagePatch:{organization_id:'00000000-0000-4000-8000-000000000099'}},{},403,'page_forbidden'],
  ]){
    const f=fixture(options),result=await f.call('list',body);assert.equal(result.status,status);assert.equal(result.data.error.code,code);assert.equal(f.fetches.length,0);assert.equal(f.mock.operations.length,0);
  }
  const f=fixture();
  assert.equal((await f.call('list',{}, {headers:{Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await f.call('list',{}, {headers:{Authorization:'Bearer invalid with spaces'}})).status,401);
  assert.equal(f.mock.operations.length,0);
});

test('each social action has both global and Page-action authorization; no pages.read dependency',async()=>{
  const f=fixture({grants:{[PAGE_A]:['read']}});
  assert.equal((await f.call('list')).status,200);
  assert.equal((await f.call('suggest',{id:CONTEXT})).data.error.code,'page_forbidden');
  assert.equal((await f.call('update',{id:CONTEXT,patch:{expectedVersion:1,paused:true}})).data.error.code,'page_forbidden');
  const calls=f.trace.filter(x=>x.name==='can_access_social_page');assert.deepEqual(calls.map(x=>x.args.required_action),['read','read','reply','read','assign']);
  assert.ok(!f.trace.some(x=>x.type==='query'&&x.table==='facebook_pages'));
  assert.ok(!f.trace.some(x=>x.name==='has_permission'&&x.args.required_permission==='pages.read'));
});

test('reply and assign grants without Page read never fetch private context or perform mutations',async()=>{
  const f=fixture({grants:{[PAGE_A]:['reply','assign']}});
  assert.equal((await f.call('suggest',{id:CONTEXT})).data.error.code,'page_read_required');
  assert.equal((await f.call('update',{id:CONTEXT,patch:{expectedVersion:1,paused:true}})).data.error.code,'page_read_required');
  assert.equal(f.mock.operations.length,0);assert.equal(f.fetches.length,0);
});

test('closing/reopening needs effective Page reply and bot metadata cannot assign ERP agents',async()=>{
  const f=fixture({grants:{[PAGE_A]:['read','assign']}});
  for(const status of ['done','review']){
    const response=await f.call('update',{id:CONTEXT,patch:{expectedVersion:1,status}});
    assert.equal(response.status,403);assert.equal(response.data.error.code,'page_reply_required');
  }
  for(const assignedTo of [USER,null,'foreign-agent']){
    const response=await f.call('update',{id:CONTEXT,patch:{expectedVersion:1,assignedTo}});
    assert.equal(response.status,400);assert.equal(response.data.error.code,'assignment_managed_by_erp');
  }
  assert.equal(f.mock.operations.length,0);
  assert.equal((await f.call('update',{id:CONTEXT,patch:{expectedVersion:1,paused:true}})).status,200);
});

test('safe SQL authorization and concurrency codes retain status without reflecting SQL details',async()=>{
  for(const [sqlCode,status,code]of [
    ['42501',403,'permission_denied'],['P0002',404,'not_found'],['40001',409,'version_conflict'],['55P03',409,'conversation_locked'],
    ['22023',400,'invalid_request'],['23514',400,'constraint_violation'],['23505',409,'conflict'],['unknown',503,'authorization_unavailable'],['constructor',503,'authorization_unavailable'],
  ]){
    const f=fixture({rpcError:true,rpcErrorAt:'get_social_page_context',rpcCode:sqlCode});
    const response=await f.call('list');assert.equal(response.status,status);assert.equal(response.data.error.code,code);
    assert.ok(!JSON.stringify(response.data).includes(TOKEN_A));assert.ok(!JSON.stringify(response.data).includes('private-rpc-error'));assert.equal(f.mock.operations.length,0);
  }
  const audit=fixture({auditFailure:true,auditCode:'42501'});
  const response=await audit.call('suggest',{id:CONTEXT});assert.equal(response.status,503);assert.equal(response.data.error.code,'audit_unavailable');
  assert.ok(audit.mock.operations.every(x=>x.method==='GET'));
});

test('stateful mock workflow stores edits/approval, queues then polls sent and replays one stable key',async()=>{
  const f=fixture(),draft=await f.draft();
  const noApproval=await f.call('send',{reply:{id:draft.id,version:draft.version},idempotencyKey:'stable-key-0001'});
  assert.equal(noApproval.status,409);assert.equal(noApproval.data.error.code,'approval_required');
  let approved=await f.approve(draft);
  const edited=await f.call('edit',{reply:{id:draft.id,version:approved.version,text:'Reviewed synthetic reply'}});
  assert.equal(edited.data.data.state,'draft');assert.equal(edited.data.data.approvedBy,null);
  assert.equal(edited.data.data.text,'Reviewed synthetic reply');approved=await f.approve(edited.data.data);
  const body={reply:{id:approved.id,version:approved.version},idempotencyKey:'stable-key-0002'};
  const queued=await f.call('send',body);assert.equal(queued.status,202);assert.equal(queued.data.data.state,'queued');assert.equal(queued.data.data.mock,true);
  const sent=await f.call('reply',{id:approved.id});assert.equal(sent.status,200);assert.equal(sent.data.data.state,'sent');assert.equal(sent.data.data.text,'Reviewed synthetic reply');
  const replay=await f.call('send',body);assert.equal(replay.status,202);assert.equal(replay.data.data.replayed,true);
  assert.equal((await f.call('send',{...body,reply:{id:approved.id,version:approved.version+1}})).data.error.code,'idempotency_conflict');
  assert.equal(f.fetches.length,0);
  const caps=await f.call('capabilities');assert.equal(caps.data.data.sending,false);assert.equal(caps.data.data.llmConfigured,false);assert.equal(caps.data.data.mode,'mock');
  assert.ok(f.audit.some(x=>x.after_data.pageId===PAGE_A&&x.actor_id===USER&&x.organization_id===ORG));
  assert.ok(!JSON.stringify(f.audit).includes('Reviewed synthetic reply'));
});

test('two Page runtimes isolate identical local IDs and equal idempotency keys',async()=>{
  const f=fixture({mode:'live'});
  const a=await f.approve(await f.draft(PAGE_A),PAGE_A),b=await f.approve(await f.draft(PAGE_B),PAGE_B);
  for(const [pageId,reply]of [[PAGE_A,a],[PAGE_B,b]]) {
    const response=await f.call('send',{pageId,reply:{id:reply.id,version:reply.version},idempotencyKey:'equal-operation-key'});assert.equal(response.status,202);
  }
  assert.equal((await f.call('reply',{pageId:PAGE_B,id:a.id})).status,404);
  assert.ok(f.fetches.some(x=>x.url.startsWith('https://page-a.example.invalid/erp/v1/')));
  assert.ok(f.fetches.some(x=>x.url.startsWith('https://page-b.example.invalid/erp/v1/')));
  assert.ok(f.trace.filter(x=>x.name==='get_social_page_context').every(x=>x.args.target_page===PAGE_A||x.args.target_page===PAGE_B));
});

test('comments, Messenger history, reply polling and filters map to existing v1 routes',async()=>{
  const f=fixture({mode:'live'});
  assert.equal((await f.call('list',{resource:'comment',filters:{limit:5,status:'review',assignedTo:'employee-1'}})).status,200);
  assert.equal((await f.call('detail',{resource:'comment',id:COMMENT})).data.data.channel,'comment');
  const d=await f.draft(PAGE_A,'comment');const a=await f.approve(d);assert.equal(a.channel,'comment');
  assert.equal((await f.call('history',{id:CONTEXT,filters:{after:0,limit:10}})).data.data.items.length,1);
  assert.equal((await f.call('history',{resource:'comment',id:COMMENT})).status,400);
  const listUrl=f.fetches.map(x=>new URL(x.url)).find(x=>x.pathname==='/erp/v1/comments');
  assert.equal(listUrl.searchParams.get('status'),'review');assert.equal(listUrl.searchParams.get('limit'),'5');
  assert.equal((await f.call('settings')).data.data.autoSendMessenger,false);
  assert.equal((await f.call('audit',{filters:{after:0,limit:10}})).status,200);
});

test('required versions/stable send key/strict body reject injection and client-authored reply state',async()=>{
  const f=fixture(),d=await f.draft(),a=await f.approve(d);
  for(const body of [
    {reply:{id:a.id,version:a.version}},
    {reply:{id:a.id,version:a.version},idempotencyKey:'short'},
    {reply:{id:a.id,version:a.version,state:'approved'},idempotencyKey:'injected-state'},
    {reply:{id:a.id},idempotencyKey:'missing-version'},
    {reply:{id:a.id,version:a.version},idempotencyKey:'safe-key-0001',baseUrl:'https://attacker.invalid'},
  ])assert.equal((await f.call('send',body)).status,400);
  assert.equal((await f.call('approve',{reply:{id:a.id,version:0}})).status,400);
  assert.equal((await f.call('edit',{reply:{id:a.id,version:1,text:'stale edit'}})).data.error.code,'version_conflict');
  assert.equal((await f.call('detail',{id:'../../admin'})).status,400);
  assert.equal((await f.call('list',{filters:{url:'https://attacker.invalid'}})).status,400);
});

test('source changes supersede stored approvals and never trust submitted reply text',async()=>{
  const f=fixture(),a=await f.approve(await f.draft());
  f.mock.changeContext(PAGE_A,CONTEXT,{text:'new customer question'});
  const result=await f.call('send',{reply:{id:a.id,version:a.version},idempotencyKey:'stale-source-001'});
  assert.equal(result.status,409);
  const current=await f.call('reply',{id:a.id});assert.equal(current.data.data.state,'superseded');
  const next=await f.draft();assert.notEqual(next.id,a.id);assert.notEqual(next.basisId,a.basisId);
});

test('revoked Page grants and feature flags deny retries before cached send results can replay',async()=>{
  const f=fixture({mode:'live'}),a=await f.approve(await f.draft());
  const body={reply:{id:a.id,version:a.version},idempotencyKey:'revocation-stable-key'};
  assert.equal((await f.call('send',body)).status,202);
  const before=f.fetches.length;
  f.grants.get(PAGE_A).delete('reply');
  assert.equal((await f.call('send',body)).data.error.code,'page_forbidden');
  assert.equal(f.fetches.length,before);
  f.grants.get(PAGE_A).add('reply');f.flags.social_inbox_reply_send=false;
  assert.equal((await f.call('send',body)).data.error.code,'feature_disabled');assert.equal(f.fetches.length,before);
  const sends=f.fetches.filter(x=>new URL(x.url).pathname.endsWith('/send'));
  assert.equal(sends.length,1);assert.match(sends[0].init.headers['Idempotency-Key'],/^[a-f0-9]{64}$/u);
  assert.notEqual(sends[0].init.headers['Idempotency-Key'],body.idempotencyKey);
});

test('registry is trusted env only: no fallback for foreign Page/org, v2, unlisted origin or missing binding',async()=>{
  for(const env of [
    {FACEBOOK_BOT_PAGE_REGISTRY_JSON:'[]'},
    {FACEBOOK_BOT_PAGE_REGISTRY_JSON:JSON.stringify([{erpPageId:PAGE_A,organizationId:ORG,externalPageId:'99999',apiVersion:'1',baseUrl:'https://page-a.example.invalid',tokenEnv:'FACEBOOK_BOT_ERP_TOKEN_A'}])},
    {FACEBOOK_BOT_PAGE_REGISTRY_JSON:JSON.stringify([{erpPageId:PAGE_A,organizationId:ORG,externalPageId:EXTERNAL_A,apiVersion:'2',baseUrl:'https://page-a.example.invalid',tokenEnv:'FACEBOOK_BOT_ERP_TOKEN_A'}])},
    {FACEBOOK_BOT_ALLOWED_ORIGINS_JSON:'["https://other.example.invalid"]'},
    {FACEBOOK_BOT_ALLOWED_ORIGINS_JSON:'["https://127.0.0.1"]'},
    {FACEBOOK_BOT_PAGE_REGISTRY_JSON:'',FACEBOOK_BOT_API_BASE_URL:'https://page-a.example.invalid',FACEBOOK_BOT_ERP_TOKEN:TOKEN_A},
  ]){const f=fixture({mode:'live',env});assert.equal((await f.call('capabilities')).status,503);assert.equal(f.fetches.length,0);}
  const disconnected=fixture({mode:'live',pagePatch:{connection_status:'pending'}});assert.equal((await disconnected.call('list')).data.error.code,'page_not_connected');
  const noMock=fixture({noMock:true});assert.equal((await noMock.call('list')).data.error.code,'mock_not_configured');
});

test('legacy single-runtime config requires three explicit identity pins and matching capabilities',async()=>{
  const f=fixture({mode:'live',env:{FACEBOOK_BOT_PAGE_REGISTRY_JSON:'',FACEBOOK_BOT_API_BASE_URL:'https://page-a.example.invalid',FACEBOOK_BOT_ERP_TOKEN:TOKEN_A,
    FACEBOOK_BOT_EXPECTED_PAGE_ID:EXTERNAL_A,FACEBOOK_BOT_EXPECTED_ERP_PAGE_ID:PAGE_A,FACEBOOK_BOT_EXPECTED_ORGANIZATION_ID:ORG}});
  assert.equal((await f.call('capabilities')).status,200);
  assert.equal((await f.call('capabilities',{pageId:PAGE_B})).status,503);
  const bad=fixture({mode:'live',fetchImpl:async()=>Response.json({apiVersion:'1',pageId:EXTERNAL_B})});
  assert.equal((await bad.call('suggest',{id:CONTEXT})).data.error.code,'runtime_identity_mismatch');
  assert.equal(bad.fetches.length,1);
});

test('a foreign-page resource is blocked before mutation even if a runtime replies 200',async()=>{
  const f=fixture({mode:'live',fetchImpl:async url=>new URL(url).pathname.endsWith('capabilities')?Response.json({apiVersion:'1',pageId:EXTERNAL_A}):Response.json({id:CONTEXT,pageId:EXTERNAL_B,channel:'messenger'})});
  const result=await f.call('suggest',{id:CONTEXT});assert.equal(result.status,502);assert.equal(result.data.error.code,'resource_page_mismatch');
  assert.ok(f.fetches.every(x=>x.init.method==='GET'));
});

test('upstream status/code/requestId and retry-after survive while messages and credentials are masked',async()=>{
  for(const status of [401,403,409,429,503]) {
    const f=fixture({mode:'live',fetchImpl:async url=>new URL(url).pathname.endsWith('capabilities')?Response.json({apiVersion:'1',pageId:EXTERNAL_A}):Response.json({error:{code:status===409?'stale_context':'ERP_ERROR',message:TOKEN_A},requestId:'upstream-safe-id'},{status,headers:{'Retry-After':'17'}})});
    const result=await f.call('detail',{id:CONTEXT});assert.equal(result.status,status);assert.equal(result.data.error.upstreamStatus,status);assert.equal(result.data.error.upstreamRequestId,'upstream-safe-id');assert.equal(result.data.error.retryAfter,17);assert.equal(result.headers.get('retry-after'),'17');assert.ok(!JSON.stringify(result).includes(TOKEN_A));
  }
  const f=fixture({mode:'live',fetchImpl:async()=>Response.json({apiVersion:'1',pageId:EXTERNAL_A,token:TOKEN_A,notes:TOKEN_A})});
  const result=await f.call('capabilities');assert.equal(result.status,200);assert.equal(result.data.data.token,undefined);assert.equal(result.data.data.notes,'[REDACTED]');
});

test('redirect, invalid JSON, oversized/chunked response and total request deadline are bounded',async()=>{
  const cases=[
    [async()=>{throw new Error('redirect '+TOKEN_A);},502,'adapter_network'],
    [async()=>new Response('{bad-json',{headers:{'content-type':'application/json'}}),502,'invalid_upstream_response'],
    [async()=>Response.json({payload:'x'.repeat(1000)}),502,'response_too_large'],
    [async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(1000)));c.close();}}),{headers:{'content-type':'application/json'}}),502,'response_too_large'],
    [async()=>new Promise(()=>{}),504,'adapter_timeout'],
    [async()=>new Response(new ReadableStream({start(){},cancel(){}}),{headers:{'content-type':'application/json'}}),504,'adapter_timeout'],
  ];
  for(const [fetchImpl,status,code]of cases){const f=fixture({mode:'live',fetchImpl,timeoutMs:30,maxResponseBytes:256});const result=await f.call('capabilities');assert.equal(result.status,status);assert.equal(result.data.error.code,code);assert.ok(!JSON.stringify(result.data).includes(TOKEN_A));}
});

test('default 8 MiB gateway cap accepts a legitimate UTF-8 thread larger than 300 KiB',async()=>{
  const payload={id:CONTEXT,pageId:EXTERNAL_A,channel:'messenger',version:1,replies:[],messages:Array.from({length:40},(_,index)=>({
    id:`00000000-0000-4000-8000-${String(index+20).padStart(12,'0')}`,conversationId:CONTEXT,pageId:EXTERNAL_A,
    channel:'messenger',direction:'in',text:'Ө'.repeat(4000),
  }))};
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).byteLength>300*1024);
  const f=fixture({mode:'live',fetchImpl:async url=>new URL(url).pathname.endsWith('capabilities')?Response.json({apiVersion:'1',pageId:EXTERNAL_A}):Response.json(payload)});
  const response=await f.call('detail',{id:CONTEXT});assert.equal(response.status,200);assert.equal(response.data.data.messages.length,40);assert.equal(response.data.data.messages[0].text.length,4000);
  assert.throws(()=>createSocialIntegrationHandler({createClient:()=>{},maxResponseBytes:8*1024*1024+1}),/Invalid bounds/u);
});

test('grant or flag revoked during audit wait blocks the external mutation after preflight',async()=>{
  for(const revoke of [state=>state.permissions.delete('social_inbox.reply_draft'),state=>state.grants.get(PAGE_A).delete('reply'),state=>{state.flags.social_inbox_ai_draft=false;}]){
    const f=fixture({mode:'live',onAudit:async(row,state)=>{if(row.action==='social.suggest.requested')revoke(state);}});
    const response=await f.call('suggest',{id:CONTEXT});assert.equal(response.status,403);assert.equal(response.data.error.outcomeUnknown,false);
    assert.ok(f.fetches.every(x=>x.init.method==='GET'));assert.ok(f.audit.some(row=>row.action==='social.suggest.requested'));
  }
});

test('mandatory mutation audit failure blocks provider write and audit never carries body/token',async()=>{
  const f=fixture({auditFailure:true});
  const result=await f.call('suggest',{id:CONTEXT});assert.equal(result.status,503);
  assert.ok(f.mock.operations.every(x=>x.method==='GET'));
  assert.ok(!JSON.stringify(result.data).includes('private-database-error'));
});

test('a send timeout after upstream acceptance exposes unknown outcome and keeps the same replay operation',async()=>{
  const f=fixture({mode:'live',timeoutMs:40});
  const a=await f.approve(await f.draft());
  const original=f.mock.request.bind(f.mock);let held=true;
  f.mock.request=async args=>{const response=await original(args);if(args.path.includes('/send')&&held){held=false;return new Promise(()=>{});}return response;};
  const body={reply:{id:a.id,version:a.version},idempotencyKey:'timeout-stable-001'};
  const first=await f.call('send',body);assert.equal(first.status,504);assert.equal(first.data.error.outcomeUnknown,true);assert.match(first.data.error.operationId,/^[a-f0-9]{64}$/u);
  const replay=await f.call('send',body);assert.equal(replay.status,202);assert.equal(replay.data.data.replayed,true);assert.equal(replay.data.meta.operationId,first.data.error.operationId);
  assert.equal((await f.call('reply',{id:a.id})).data.data.state,'sent');
});

test('failure to audit a known bot response preserves queue acknowledgement and idempotent replay',async()=>{
  const f=fixture({auditFailure:'result'}),a=await f.approve(await f.draft());
  const body={reply:{id:a.id,version:a.version},idempotencyKey:'audit-result-stable'};
  const queued=await f.call('send',body);assert.equal(queued.status,202);assert.equal(queued.data.data.state,'queued');assert.equal(queued.data.meta.auditRecorded,false);assert.equal(queued.data.meta.outcomeUnknown,false);
  assert.ok(f.audit.some(row=>row.action==='social.send.requested'));
  const replay=await f.call('send',body);assert.equal(replay.status,202);assert.equal(replay.data.data.replayed,true);assert.equal(replay.data.meta.operationId,queued.data.meta.operationId);
});

test('assistant requires ERP read grant, organization-scopes facts and leaves missing stock unknown',async()=>{
  const product={id:CONTEXT,organization_id:ORG,sku:'BOX-1',name:'Хайрцаг',sale_price:'12000',updated_at:'2026-11-26T00:00:00Z'};
  const f=fixture({products:[product,{...product,id:COMMENT,organization_id:'00000000-0000-4000-8000-000000000099',name:'Хайрцаг foreign'}]});
  const answer=await f.call('assistant',{query:'Хайрцаг'});assert.equal(answer.status,200);assert.equal(answer.data.data.sources.length,1);assert.equal(answer.data.data.sources[0].price,12000);assert.equal(answer.data.data.sources[0].stock,null);assert.equal(answer.data.data.llmConfigured,false);
  const reads=f.trace.filter(x=>x.type==='query'&&['products','inventory_balances'].includes(x.table));assert.ok(reads.every(x=>x.filters.some(([key,value])=>key==='organization_id'&&value===ORG)));
  const denied=fixture({permissions:['ai_assistant.use','products.read','inventory.read']});assert.equal((await denied.call('assistant',{query:'Хайрцаг'})).data.error.code,'erp_read_denied');
  const zero=fixture({products:[{...product,sale_price:0}],balances:[{organization_id:ORG,product_id:CONTEXT,quantity:0}]});const facts=(await zero.call('assistant',{query:'Хайрцаг'})).data.data.sources[0];assert.equal(facts.price,0);assert.equal(facts.stock,0);
  const noInventory=fixture({products:[product],permissions:['ai_assistant.use','ai_assistant.erp_read','products.read']});assert.equal((await noInventory.call('assistant',{query:'Хайрцаг'})).data.data.sources[0].stock,null);assert.ok(!noInventory.trace.some(x=>x.table==='inventory_balances'));
});

test('hosted runtime publishable map supplies the default public key without a legacy key',async()=>{
  const publicKey='sb_publishable_synthetic_hosted_default_key_0001';
  for(const legacy of [undefined,'sb_secret_do_not_use_this_legacy_value']){
    const f=fixture({env:{SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:publicKey,automation:'sb_publishable_synthetic_named_key_0002'}),SUPABASE_ANON_KEY:legacy},expectedClientKey:publicKey});
    const response=await f.call('list');assert.equal(response.status,200);assert.equal(response.data.data.items.length,1);
    assert.ok(f.trace.some(item=>item.type==='auth'&&item.jwt==='synthetic.user.jwt'));
    assert.ok(!JSON.stringify(response.data).includes(publicKey));
  }
  const denied=fixture({authError:true,env:{SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:publicKey}),SUPABASE_ANON_KEY:undefined},expectedClientKey:publicKey});
  const response=await denied.call('list');assert.equal(response.status,401);assert.ok(!JSON.stringify(response.data).includes(publicKey));
});

test('an invalid present modern public key map never falls back to the valid legacy anon key',async()=>{
  const secret='sb_secret_synthetic_must_never_reach_client_0001';
  for(const value of ['', 'not-json', 'null', '[]', '{}', JSON.stringify({default:secret}), JSON.stringify({default:3}),
    JSON.stringify({default:'sb_publishable_ok_fixture_0001',other:secret}), JSON.stringify({default:'unknown-public-key'})]){
    const f=fixture({env:{SUPABASE_PUBLISHABLE_KEYS:value}}),response=await f.call('list');
    assert.equal(response.status,503);assert.equal(response.data.error.code,'adapter_configuration');
    assert.equal(f.trace.length,0);assert.equal(f.fetches.length,0);assert.equal(f.mock.operations.length,0);
    assert.ok(!JSON.stringify(response.data).includes(secret));
  }
});

test('legacy public anon compatibility rejects privileged keys rather than creating a privileged client',async()=>{
  const encoded=role=>'synthetic-header.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.synthetic-signature';
  for(const key of ['sb_secret_synthetic_privileged_key_0001',encoded('service_role'),encoded('supabase_admin'),encoded('authenticated')]){
    const f=fixture({env:{SUPABASE_ANON_KEY:key}}),response=await f.call('list');
    assert.equal(response.status,503);assert.equal(response.data.error.code,'adapter_configuration');
    assert.equal(f.trace.length,0);assert.equal(f.fetches.length,0);assert.ok(!JSON.stringify(response.data).includes(key));
  }
  assert.equal((await fixture({env:{SUPABASE_ANON_KEY:encoded('anon')}}).call('list')).status,200);
});

test('sandbox CORS exact origins replace production defaults and update between requests',async()=>{
  const sandbox='https://momo-sandbox.example.invalid';
  const f=fixture({env:{SOCIAL_ALLOWED_ORIGINS_JSON:JSON.stringify([sandbox])}});
  assert.equal((await f.call('list')).status,403);assert.equal(f.trace.length,0);
  const allowed=await f.call('list',{}, {headers:{Origin:sandbox}});
  assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),sandbox);
  const preflight=await f.handler(new Request('https://synthetic-edge.invalid/social-integration',{method:'OPTIONS',headers:{Origin:sandbox}}));
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),sandbox);
  f.env.SOCIAL_ALLOWED_ORIGINS_JSON=JSON.stringify(['http://localhost:4173']);
  assert.equal((await f.call('list',{}, {headers:{Origin:sandbox}})).status,403);
  assert.equal((await f.call('list',{}, {headers:{Origin:'http://localhost:4173'}})).status,200);
  assert.equal((await f.call('list')).status,403);
});

test('malformed CORS configuration fails closed before authentication without production-origin fallback',async()=>{
  const malformed=['', 'null', '{}', '[]', '[', '[null]', '[3]', JSON.stringify(['*']), JSON.stringify(['null']),
    JSON.stringify(['https://*.example.invalid']),JSON.stringify(['https://user:synthetic-password@example.invalid']),
    JSON.stringify(['https://sandbox.example.invalid/path']),JSON.stringify(['https://sandbox.example.invalid/']),
    JSON.stringify(['https://sandbox.example.invalid?key=synthetic-secret']),JSON.stringify(['https://sandbox.example.invalid#fragment']),
    JSON.stringify(['https://127.0.0.1']),JSON.stringify(['https://sandbox']),JSON.stringify(['https://foo.localhost']),
    JSON.stringify(['https://foo.local']),JSON.stringify(['https://foo.internal']),JSON.stringify(['http://sandbox.example.invalid']),JSON.stringify(['http://localhost:5000']),
    JSON.stringify(['http://127.0.0.1:4173']),JSON.stringify(['https://sandbox.example.invalid','https://sandbox.example.invalid'])];
  for(const value of malformed){
    const f=fixture({env:{SOCIAL_ALLOWED_ORIGINS_JSON:value}}),response=await f.call('list');
    assert.equal(response.status,503);assert.equal(response.data.error.code,'adapter_configuration');
    assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(f.trace.length,0);
    assert.equal(f.fetches.length,0);assert.equal(f.mock.operations.length,0);
    assert.ok(!JSON.stringify(response.data).includes('synthetic-password'));assert.ok(!JSON.stringify(response.data).includes('synthetic-secret'));
  }
});
