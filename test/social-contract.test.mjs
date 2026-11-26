import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../dist/social-service.js', import.meta.url), 'utf8');
const PAGE_A = '11111111-1111-4111-8111-111111111111';
const PAGE_B = '22222222-2222-4222-8222-222222222222';
function exportsFor() {
  const window = {};
  runInNewContext(script, { window, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' }, setTimeout });
  return window;
}
const plain = value => JSON.parse(JSON.stringify(value));
function storage() { const records = new Map(); return { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), records }; }
function session(invoke, options = {}) {
  let sequence = 0;
  return new (exportsFor().MomoSocialInboxSession)({ invoke, storage: storage(), randomUUID: () => '00000000-0000-4000-8000-'+String(++sequence).padStart(12,'0'), ...options });
}
const envelope = (pageId, data = {}) => ({ ok: true, data, meta: { pageId, mode: 'mock' } });

test('requires ERP registry Page UUID and pins every social request to selected Page/resource', async () => {
  const calls = [], inbox = session(async body => { calls.push(body); return envelope(body.pageId); });
  await assert.rejects(inbox.request('list'), error => error.code === 'page_required');
  assert.throws(() => inbox.selectPage('12345'), /UUID/);
  inbox.selectPage(PAGE_A,'comment');
  await inbox.request('list', { pageId: PAGE_B, resource: 'messenger', filters: { limit: 25 } });
  assert.equal(calls.length,1); assert.equal(calls[0].pageId,PAGE_A); assert.equal(calls[0].resource,'comment');
  assert.deepEqual(plain(calls[0].filters),{limit:25});
});

test('late old-Page response is rejected after switching; mismatched response Page is rejected', async () => {
  let resolve;
  const inbox=session(() => new Promise(done => {resolve=done;}));
  inbox.selectPage(PAGE_A);
  const pending=inbox.request('detail',{id:'same-id'});
  inbox.selectPage(PAGE_B);
  resolve(envelope(PAGE_A,{id:'same-id',text:'old private data'}));
  await assert.rejects(pending,error=>error.code==='selection_changed');
  const mismatch=session(async()=>envelope(PAGE_B));
  mismatch.selectPage(PAGE_A);
  await assert.rejects(mismatch.request('list'),error=>error.code==='page_mapping_mismatch');
});

test('send double-click shares one in-flight operation and never promotes queued to sent', async () => {
  const calls=[];let finish;
  const inbox=session(body=>{calls.push(body);return new Promise(resolve=>{finish=resolve;});});
  inbox.selectPage(PAGE_A);
  const first=inbox.sendReply({id:'reply-1',version:3}),second=inbox.sendReply({id:'reply-1',version:3});
  assert.equal(first,second);assert.equal(calls.length,1);
  assert.equal(calls[0].action,'send');assert.ok(calls[0].idempotencyKey);
  assert.deepEqual(plain(calls[0].reply),{id:'reply-1',version:3});
  finish(envelope(PAGE_A,{replyId:'reply-1',state:'queued',version:4}));
  assert.equal((await first).data.state,'queued');
});

test('stable send key survives timeout/recreated session and separates Page/resource/version', async () => {
  const persisted=storage(),calls=[];
  const invoke=async body=>{calls.push(body);if(calls.length===1)throw Object.assign(new Error('timeout'),{code:'network_timeout'});return envelope(body.pageId,{state:'queued',version:body.reply.version+1});};
  const first=session(invoke,{storage:persisted});first.selectPage(PAGE_A);
  await assert.rejects(first.sendReply({id:'same-reply',version:3}),/timeout/);
  let freshKeys=20;
  const second=session(invoke,{storage:persisted,randomUUID:()=> '00000000-0000-4000-8000-'+String(++freshKeys).padStart(12,'0')});
  second.selectPage(PAGE_A);await second.sendReply({id:'same-reply',version:3});
  assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);
  second.selectPage(PAGE_B);await second.sendReply({id:'same-reply',version:3});
  second.selectPage(PAGE_A,'comment');await second.sendReply({id:'same-reply',version:3});
  second.selectPage(PAGE_A);await second.sendReply({id:'same-reply',version:4});
  assert.equal(new Set(calls.slice(1).map(call=>call.idempotencyKey)).size,4);
});

test('unavailable or corrupted operation storage fails closed before send', async () => {
  let calls=0;
  for(const persisted of [null,{getItem:()=>'{broken',setItem(){}},{getItem:()=>null,setItem(){throw new Error('denied');}}]){
    const inbox=session(async()=>{calls++;},{storage:persisted});inbox.selectPage(PAGE_A);
    await assert.rejects(inbox.sendReply({id:'r1',version:1}),error=>error.code==='send_storage_unavailable');
  }
  assert.equal(calls,0);
});

test('polling waits for actual reply states and stops on Page switch', async () => {
  const states=['queued','sending','sent'],seen=[],calls=[];
  const inbox=session(async body=>{calls.push(body);return envelope(body.pageId,{id:'reply-1',state:states.shift(),remoteId:states.length?null:'mock-remote'});});
  inbox.selectPage(PAGE_A);
  const last=await inbox.pollReply('reply-1',{wait:async()=>{},onUpdate:reply=>seen.push(reply.state)});
  assert.deepEqual(seen,['queued','sending','sent']);assert.equal(last.state,'sent');
  assert.ok(calls.every(call=>call.action==='reply'&&call.pageId===PAGE_A));
  const changing=session(async body=>envelope(body.pageId,{state:'queued'}));changing.selectPage(PAGE_A);
  await assert.rejects(changing.pollReply('r',{wait:async()=>changing.selectPage(PAGE_B)}),error=>error.code==='selection_changed');
});

test('SDK transport retains structured upstream error status/code/requestId/retryAfter', async () => {
  const {MomoSocialService}=exportsFor();
  const response=new Response(JSON.stringify({ok:false,error:{code:'version_conflict',message:'Шинэ хувилбарыг авна уу.',requestId:'fake-request-1',retryAfter:12,upstreamStatus:409,outcomeUnknown:true,operationId:'fake-operation-1'}}),{status:409});
  const auth={profile:{id:'user-a',organizationId:'org-a'},client:{functions:{invoke:async()=>({data:null,error:{context:response}})}}};
  const service=new MomoSocialService(auth);
  await assert.rejects(service.invokeSocial({action:'send'}),error=>{
    assert.equal(error.code,'version_conflict');assert.equal(error.status,409);assert.equal(error.requestId,'fake-request-1');assert.equal(error.retryAfter,12);assert.equal(error.upstreamStatus,409);assert.equal(error.outcomeUnknown,true);assert.equal(error.operationId,'fake-operation-1');assert.doesNotMatch(error.message,/object Object/);return true;
  });
});

test('SDK success preserves envelope without using browser-side bot credentials', async () => {
  const {MomoSocialService}=exportsFor();let invocation;
  const auth={profile:{id:'u',organizationId:'o'},client:{functions:{invoke:async(name,options)=>{invocation={name,options};return{data:envelope(PAGE_A,{state:'queued'}),error:null};}}}};
  const result=await new MomoSocialService(auth).invokeSocial({action:'send',pageId:PAGE_A,resource:'messenger',reply:{id:'r',version:2},idempotencyKey:'operation-1'});
  assert.equal(invocation.name,'social-integration');assert.equal(invocation.options.body.pageId,PAGE_A);assert.equal(result.data.state,'queued');
  assert.doesNotMatch(script,/FACEBOOK_BOT_ERP_TOKEN|META_PAGE_ACCESS_TOKEN|service_role/i);
});

test('existing Page/team/access/assignment CRUD RPC mapping remains distinct from bot context', async () => {
  const {MomoSocialService}=exportsFor(),calls=[];
  const service=new MomoSocialService({profile:{id:'u1',organizationId:'org1'},client:{rpc:async(name,args)=>{calls.push({name,args});return{data:{id:'assignment-local',version:2},error:null};}}});
  await service.savePage({id:PAGE_A,name:'Page A',externalPageId:'12345',primaryTeam:'team-a',backupTeam:'team-b'});
  await service.saveTeam({id:'team-a',name:'Team A',memberIds:['u1'],capacity:8});
  await service.savePageAccess(PAGE_A,'u1',{read:true,reply:false,assign:true});
  await service.smartAssign(PAGE_A,'bot-context-123');
  await service.updateConversation({id:'assignment-local',version:2},'transfer','team-b','u2');
  assert.deepEqual(calls.map(call=>call.name),['manage_social_page','manage_social_team','set_social_page_user_access','smart_assign_social_conversation','update_social_conversation']);
  assert.equal(calls[3].args.target_page,PAGE_A);assert.equal(calls[3].args.target_external_id,'bot-context-123');
  assert.equal(calls[4].args.target_assignment,'assignment-local');assert.equal(calls[4].args.expected_version,2);
});

test('presence heartbeat writes own status/timestamp and never writes workload counter', async () => {
  const {MomoSocialService}=exportsFor();let captured;
  const query={select(){return this;},async single(){return{data:{status:captured.status},error:null};}};
  const service=new MomoSocialService({profile:{id:'u1',organizationId:'o1'},client:{from(table){assert.equal(table,'social_agent_presence');return{upsert(payload,options){captured=payload;assert.equal(options.onConflict,'user_id');return query;}};}}});
  await service.updatePresence('online');
  assert.deepEqual(Object.keys(captured).sort(),['organization_id','status','updated_at','user_id']);
  assert.equal(captured.user_id,'u1');assert.equal(captured.organization_id,'o1');assert.equal(captured.status,'online');assert.ok(Number.isFinite(Date.parse(captured.updated_at)));
  await assert.rejects(service.updatePresence('untrusted'),/төлөв буруу/);
});

test('workspace uses safe Page registry RPC and never selects raw Page rows', async () => {
  const {MomoSocialService}=exportsFor(),queries=[],rpcs=[];
  const page={id:PAGE_A,organization_id:'org1',name:'Page A',external_page_id:'12345',is_active:true,connection_status:'pending',created_at:'2026-11-26T00:00:00Z',updated_at:'2026-11-26T00:00:00Z'};
  const rows={social_page_teams:[
    {page_id:PAGE_A,team_id:'primary',assignment_type:'primary',priority:1},
    {page_id:PAGE_A,team_id:'backup-a',assignment_type:'backup',priority:1},
    {page_id:PAGE_A,team_id:'backup-b',assignment_type:'backup',priority:2},
    {page_id:PAGE_B,team_id:'other-page-team',assignment_type:'backup',priority:1}
  ]};
  const client={async rpc(name,args){rpcs.push({name,args});assert.equal(name,'list_social_page_registry');return{data:[page],error:null};},from(table){const query={table,columns:null};queries.push(query);const builder={
    select(columns){query.columns=columns;return this;},order(){return this;},eq(){return this;},in(){return this;},
    then(resolve,reject){return Promise.resolve({data:rows[table]||[],error:null}).then(resolve,reject);}
  };return builder;}};
  const workspace=await new MomoSocialService({profile:{id:'u1',organizationId:'org1'},can:permission=>permission==='social_inbox.read',client}).loadWorkspace();
  assert.deepEqual(rpcs,[{name:'list_social_page_registry',args:undefined}]);
  assert.equal(queries.some(query=>query.table==='facebook_pages'),false);
  assert.equal(workspace.pages[0].id,PAGE_A);assert.equal(workspace.pages[0].name,'Page A');
  assert.deepEqual(plain(workspace.pages[0].teamIds),['primary','backup-a','backup-b']);
  assert.equal(workspace.pages[0].primary,'primary');assert.equal(workspace.pages[0].backup,'backup-a');
  assert.deepEqual(plain(workspace.pages[0].teamLinks.at(-1)),{team_id:'backup-b',assignment_type:'backup',priority:2});
  assert.equal(Object.hasOwn(workspace.pages[0],'credential_reference'),false);assert.equal(Object.hasOwn(workspace.pages[0],'settings'),false);
  assert.ok(queries.some(query=>query.table==='social_teams'));assert.ok(queries.some(query=>query.table==='social_conversation_assignments'));
});

test('AI-only staff skip Page registry RPC while saved replies, AI history and catalog remain usable', async () => {
  const {MomoSocialService}=exportsFor(),queries=[];
  const fixtures={
    social_saved_replies:[{id:'saved-1',page_id:null,title:'Personal reply',content:'Saved fake text'}],
    ai_threads:[{id:'thread-1',title:'Fake AI history'}],
    products:[{id:'product-1',sku:'FAKE-1',name:'Зохиомол хайрцаг',sale_price:10,is_active:true}],
    inventory_balances:[{product_id:'product-1',quantity:2}]
  };
  const client={rpc(){throw new Error('AI-only staff must not call Page registry RPC');},from(table){queries.push(table);return{
    select(){return this;},order(){return this;},eq(){return this;},in(){return this;},or(){return this;},limit(){return this;},
    then(resolve,reject){return Promise.resolve({data:fixtures[table]||[],error:null}).then(resolve,reject);}
  };}};
  const service=new MomoSocialService({profile:{id:'u1',organizationId:'org1'},can:permission=>['ai_assistant.use','ai_assistant.erp_read'].includes(permission),client});
  const workspace=await service.loadWorkspace();
  assert.equal(workspace.pages.length,0);assert.equal(workspace.saved[0].id,'saved-1');
  assert.equal((await service.listThreads())[0].id,'thread-1');
  assert.equal((await service.searchCatalog('хайрцаг'))[0].verifiedQuantity,2);
  for(const table of ['social_saved_replies','ai_threads','products','inventory_balances'])assert.ok(queries.includes(table),table);
});

test('authorized Page registry errors remain visible instead of becoming an empty Page list', async () => {
  const {MomoSocialService}=exportsFor();
  const client={rpc:async()=>({data:null,error:{message:'registry permission changed'}}),from(){return{
    select(){return this;},order(){return this;},eq(){return this;},in(){return this;},
    then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}
  };}};
  const service=new MomoSocialService({profile:{id:'u1',organizationId:'org1'},can:permission=>permission==='pages.read',client});
  await assert.rejects(service.loadWorkspace(),/registry permission changed/);
});
