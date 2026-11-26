import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const serviceScript=readFileSync(new URL('../dist/social-service.js',import.meta.url),'utf8');
const uiScript=readFileSync(new URL('../dist/social.js',import.meta.url),'utf8');
const PAGE_A='11111111-1111-4111-8111-111111111111',PAGE_B='22222222-2222-4222-8222-222222222222';

// Minimal deterministic DOM implementing the browser interactions this test
// drives. No network, database, external package, browser account or secret.
class Element {
  constructor(document,tag='div',attributes={}){this.document=document;this.tagName=tag;this.attributes=attributes;this.id=attributes.id||'';this.dataset={};for(const[key,value]of Object.entries(attributes))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;this.children=[];this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.classList={toggle(){}};}
  set innerHTML(value){for(const child of this.children)this.document.remove(child);this.children=[];this.html=value;for(const match of value.matchAll(/<([a-z][a-z0-9-]*)([^>]*)>/gi)){const attributes={};for(const attribute of match[2].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/gi))attributes[attribute[1]]=attribute[2]??'';const child=new Element(this.document,match[1],attributes);this.children.push(child);this.document.register(child);}}
  get innerHTML(){return this.html||'';}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){return this.document.match(this.children.flatMap(child=>[child,...child.descendants()]),selector);}
  descendants(){return this.children.flatMap(child=>[child,...child.descendants()]);}
  appendChild(child){this.children.push(child);this.document.register(child);return child;}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,handler){this['on'+type]=handler;}
}
class Document {
  constructor(){this.all=new Set();this.ids=new Map();this.ai=new Element(this,'div',{id:'view-ai-assistant'});this.social=new Element(this,'div',{id:'view-ai-inbox'});this.register(this.ai);this.register(this.social);}
  register(element){this.all.add(element);if(element.id)this.ids.set(element.id,element);}
  remove(element){for(const child of element.children)this.remove(child);this.all.delete(element);if(element.id&&this.ids.get(element.id)===element)this.ids.delete(element.id);}
  match(elements,selector){const selectors=selector.split(',');return elements.filter(element=>selectors.some(part=>{part=part.trim();if(part.startsWith('#'))return element.id===part.slice(1);if(part.startsWith('.'))return(element.attributes.class||'').split(' ').includes(part.slice(1));if(part.startsWith('['))return Object.hasOwn(element.attributes,part.slice(1,-1));return element.tagName===part;}));}
  querySelector(selector){if(selector.startsWith('#'))return this.ids.get(selector.slice(1))||null;return this.match([...this.all],selector)[0]||null;}
  querySelectorAll(selector){return this.match([...this.all],selector);}
  createElement(tag){return new Element(this,tag);}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function app({feature=true,online=false,assignment=false,permissions=null,configure=()=>{},localMock=false}={}){
  const document=new Document(),calls=[],errors=[],records=new Map(),events={},contexts=new Map(),intervals=new Map(),presenceCalls=[],routingCalls=[];let sequence=0,timerSequence=0;
  const workspace={pages:[{id:PAGE_A,name:'Fake A',external_page_id:'12345',is_active:true,access:[]},{id:PAGE_B,name:'Fake B',external_page_id:'67890',is_active:true,access:[]}],teams:[],profiles:[],agents:online?[{id:'u1',status:'online',name:'Fake user',load:0}]:[],conversations:assignment?[{id:'erp-assignment',page_id:PAGE_A,external_conversation_id:'same-context',version:1,...(typeof assignment==='object'?assignment:{})}]:[],saved:[],knowledge:[],flags:{social_inbox_ui:feature,momo_ai_ui:true}};
  configure(workspace);
  class Service {
    async loadWorkspace(){return workspace;}
    async updatePresence(status){presenceCalls.push(status);return{status};}
    async smartAssign(pageId,id){routingCalls.push({operation:'smart',pageId,id});const row={id:'new-assignment',page_id:pageId,external_conversation_id:id,team_id:'primary',assignee_id:'auto-agent',version:1};workspace.conversations.push(row);return row;}
    async updateConversation(row,action,teamId,userId){routingCalls.push({operation:'update',id:row.id,action,teamId,userId});if(['assign','transfer'].includes(action)){row.team_id=teamId;row.assignee_id=userId;}row.version++;return row;}
    async invokeSocial(body){
      calls.push(structuredClone(body));const key=body.pageId+':'+body.resource;
      if(!contexts.has(key))contexts.set(key,{id:'same-context',pageId:body.pageId===PAGE_A?'12345':'67890',channel:body.resource,participant:{id:'fake-customer'},author:{name:'Fake author'},text:'Fake comment',status:'review',paused:false,replyAllowed:true,version:1,basisId:'basis-1',messages:[{id:'m-1',seq:1,direction:'in',text:body.pageId===PAGE_A?'Page A fixture':'Page B fixture'}],replies:[]});
      const context=contexts.get(key);let data;
      if(body.action==='capabilities')data={mode:'mock',sending:false,commentSending:false,llmConfigured:false};
      else if(body.action==='list')data={items:[context],nextCursor:null};
      else if(body.action==='detail')data=structuredClone(context);
      else if(body.action==='suggest'){data={id:'reply-1',conversationId:context.id,basisId:context.basisId,text:'Fake draft',state:'draft',version:1,source:'mock-rules-v1',mock:true};context.replies.push(data);}
      else if(body.action==='edit'){data=context.replies.at(-1);assert.equal(body.reply.version,data.version);data.text=body.reply.text;data.state='draft';data.version++;}
      else if(body.action==='approve'){data=context.replies.at(-1);assert.equal(body.reply.version,data.version);data.state='approved';data.version++;}
      else if(body.action==='send'){data=context.replies.at(-1);assert.equal(body.reply.version,data.version);data.state='queued';data.version++;data={replyId:data.id,version:data.version,state:'queued'};}
      else if(body.action==='reply'){data=context.replies.at(-1);data.state='sent';data.remoteId='mock-remote';data.version++;}
      else throw new Error('Unexpected fixture action '+body.action);
      return{ok:true,data:structuredClone(data),meta:{mode:'mock',pageId:body.pageId,externalPageId:context.pageId}};
    }
  }
  const window={sessionStorage:{getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value)},addEventListener:(name,handler)=>{events[name]=handler;},showToast:message=>errors.push(message),nexerpAuth:{profile:{id:'u1',organizationId:'org1'},can:permission=>permissions===null||permissions.includes(permission)}};
  const sandbox={window,document,location:{hostname:localMock?'localhost':'erp.example.invalid',search:localMock?'?socialMock=1':''},URLSearchParams,crypto:{randomUUID:()=> '00000000-0000-4000-8000-'+String(++sequence).padStart(12,'0')},setTimeout,setInterval:(callback,ms)=>{const id=++timerSequence;intervals.set(id,{callback,ms});return id;},clearInterval:id=>intervals.delete(id),structuredClone,alert:message=>errors.push(message),prompt:()=>null,confirm:()=>false};
  runInNewContext(serviceScript,sandbox);
  const Session=window.MomoSocialInboxSession;
  window.MomoSocialInboxSession=class extends Session {pollReply(id,options){return super.pollReply(id,{...options,delayMs:0});}};
  window.MomoSocialService=Service;
  runInNewContext(uiScript,sandbox);await flush();
  return{document,calls,errors,events,contexts,records,workspace,intervals,presenceCalls,routingCalls};
}

test('UI never calls social Edge until an explicit ERP Page is selected, then scopes list/detail and clears old thread',async()=>{
  const fixture=await app();const {document,calls}=fixture;
  assert.equal(calls.length,0);assert.equal(document.querySelector('#fp').value,'');
  await document.querySelector('#fp').onchange({target:{value:PAGE_A}});
  assert.deepEqual(calls.map(call=>call.action),['capabilities','list']);
  assert.ok(calls.every(call=>call.pageId===PAGE_A&&call.resource==='messenger'));
  await document.querySelectorAll('[data-context-id]')[0].onclick();
  assert.match(document.querySelector('#thread').querySelector('.thread-messages').innerHTML,/Page A fixture/);
  await document.querySelector('#fp').onchange({target:{value:PAGE_B}});
  assert.doesNotMatch(document.querySelector('#thread').innerHTML,/Page A fixture/);
  await document.querySelectorAll('[data-context-id]')[0].onclick();
  assert.match(document.querySelector('#thread').querySelector('.thread-messages').innerHTML,/Page B fixture/);
  assert.equal(calls.at(-1).pageId,PAGE_B);
  await document.querySelector('#fr').onchange({target:{value:'comment'}});
  assert.equal(calls.at(-1).resource,'comment');assert.equal(calls.at(-1).pageId,PAGE_B);
  assert.equal(fixture.errors.length,0);
});

test('UI human edit invalidates approval, sends stable operation once, and polls server-held mock state',async()=>{
  const {document,calls,errors}=await app();
  await document.querySelector('#fp').onchange({target:{value:PAGE_A}});
  await document.querySelectorAll('[data-context-id]')[0].onclick();
  await document.querySelector('#suggest').onclick();
  await document.querySelector('#approve').onclick();
  assert.equal(document.querySelector('#send').disabled,false);
  const textarea=document.querySelector('#thread').querySelector('textarea');textarea.value='Human reviewed text';textarea.oninput();
  assert.equal(document.querySelector('#send').disabled,true);
  await document.querySelector('#approve').onclick();
  const edit=calls.find(call=>call.action==='edit');assert.equal(edit.reply.text,'Human reviewed text');assert.equal(edit.pageId,PAGE_A);assert.equal(edit.resource,'messenger');
  const send=document.querySelector('#send');const first=send.onclick(),second=send.onclick();await Promise.all([first,second]);
  assert.equal(calls.filter(call=>call.action==='send').length,1);assert.equal(calls.filter(call=>call.action==='reply').length,1);
  assert.ok(calls.find(call=>call.action==='send').idempotencyKey);
  assert.match(document.querySelector('#rstate').textContent,/Mock.*sent/);
  assert.doesNotMatch(document.querySelector('#rstate').textContent,/Meta баталгаажуулсан/);
  assert.equal(errors.length,0);
});

test('feature-off UI does not fetch inbox and leaves grounded assistant shell intact',async()=>{
  const {document,calls}=await app({feature:false});
  assert.equal(calls.length,0);assert.match(document.querySelector('#social-pane').innerHTML,/feature flag идэвхгүй/);
  assert.ok(document.querySelector('#ai-form'));assert.match(document.querySelector('#ai-mode').textContent,/Grounded ERP/);
});

test('online presence heartbeats every minute and cleans up across pagehide/pageshow',async()=>{
  const fixture=await app({online:true});
  assert.deepEqual(fixture.presenceCalls,['online']);
  assert.equal(fixture.intervals.size,1);
  const timer=[...fixture.intervals.values()][0];assert.equal(timer.ms,60000);
  await timer.callback();await flush();assert.deepEqual(fixture.presenceCalls,['online','online']);
  fixture.events.pagehide();assert.equal(fixture.intervals.size,0);
  fixture.events.pageshow();await flush();assert.equal(fixture.intervals.size,1);assert.equal(fixture.presenceCalls.at(-1),'online');
  fixture.events.pagehide();assert.equal(fixture.errors.length,0);
});

test('read-only staff cannot claim a five-minute lock even when an assignment exists',async()=>{
  const reader=await app({assignment:true,permissions:['social_inbox.read']});
  await reader.document.querySelector('#fp').onchange({target:{value:PAGE_A}});
  await reader.document.querySelectorAll('[data-context-id]')[0].onclick();
  assert.equal(reader.document.querySelector('#claim').disabled,true);
  assert.equal(reader.document.querySelector('#assign').disabled,true);
  const assigner=await app({assignment:true,permissions:['social_inbox.read','social_inbox.assign']});
  await assigner.document.querySelector('#fp').onchange({target:{value:PAGE_A}});
  await assigner.document.querySelectorAll('[data-context-id]')[0].onclick();
  assert.equal(assigner.document.querySelector('#claim').disabled,false);
  const noRead=await app({assignment:true,permissions:['social_inbox.assign']});
  await noRead.document.querySelector('#fp').onchange({target:{value:PAGE_A}});
  await noRead.document.querySelectorAll('[data-context-id]')[0].onclick();
  assert.equal(noRead.document.querySelector('#claim').disabled,true);
});

function routingWorkspace(workspace){
  Object.assign(workspace.pages[0],{primary:'primary',backup:'backup-a',teamIds:['primary','backup-a','backup-b']});
  workspace.teams=[
    {id:'unrelated',name:'Other Page team',is_active:true,members:['target','other-page-agent']},
    {id:'primary',name:'Primary',is_active:true,members:[]},
    {id:'backup-a',name:'Inactive backup',is_active:false,members:['inactive-team-agent']},
    {id:'backup-b',name:'Second backup',is_active:true,members:['target','offline-agent','denied-agent']}
  ];
  workspace.profiles=['target','other-page-agent','inactive-team-agent','offline-agent','denied-agent'].map(id=>({id,status:'active'}));
  workspace.agents=workspace.profiles.map(profile=>({id:profile.id,name:profile.id,status:profile.id==='offline-agent'?'offline':'online',load:0}));
  workspace.pages[0].access.push({user_id:'denied-agent',can_read:true,can_reply:false,can_assign:false});
}
async function openFirst(fixture){await fixture.document.querySelector('#fp').onchange({target:{value:PAGE_A}});await fixture.document.querySelectorAll('[data-context-id]')[0].onclick();}

test('manual assign never creates a hidden smart assignment; explicit Smart button performs only that operation',async()=>{
  const fixture=await app({permissions:['social_inbox.read','social_inbox.assign'],configure:routingWorkspace});await openFirst(fixture);
  assert.equal(fixture.document.querySelector('#assign').disabled,true);
  await fixture.document.querySelector('#assign').onclick();
  assert.equal(fixture.routingCalls.length,0);
  assert.match(fixture.errors.at(-1),/Smart/);
  assert.equal(fixture.document.querySelector('#smart-assign').disabled,false);
  await fixture.document.querySelector('#smart-assign').onclick();
  assert.deepEqual(fixture.routingCalls,[{operation:'smart',pageId:PAGE_A,id:'same-context'}]);
});

test('assign-only user can assign an existing unassigned row using exact selected Page backup team',async()=>{
  const fixture=await app({assignment:{assignee_id:null,team_id:null},permissions:['social_inbox.read','social_inbox.assign'],configure:routingWorkspace});await openFirst(fixture);
  const selector=fixture.document.querySelector('#agent');
  assert.match(fixture.document.querySelector('#thread').innerHTML,/backup-b:target/);
  assert.doesNotMatch(fixture.document.querySelector('#thread').innerHTML,/unrelated|other-page-agent|inactive-team-agent|offline-agent|denied-agent/);
  selector.value='backup-b:target';selector.onchange();
  assert.equal(fixture.document.querySelector('#assign').disabled,false);
  await fixture.document.querySelector('#assign').onclick();
  assert.deepEqual(fixture.routingCalls,[{operation:'update',id:'erp-assignment',action:'assign',teamId:'backup-b',userId:'target'}]);
  assert.equal(fixture.errors.length,0);
});

test('reassignment needs separate permission and never falls back to assign or a hidden smart operation',async()=>{
  const restricted=await app({assignment:{assignee_id:'current-agent',team_id:'primary'},permissions:['social_inbox.read','social_inbox.assign'],configure:routingWorkspace});await openFirst(restricted);
  restricted.document.querySelector('#agent').value='backup-b:target';restricted.document.querySelector('#agent').onchange();
  assert.equal(restricted.document.querySelector('#assign').disabled,true);
  await restricted.document.querySelector('#assign').onclick();
  assert.equal(restricted.routingCalls.length,0);assert.match(restricted.errors.at(-1),/шилжүүлэх.*эрх/);
  const allowed=await app({assignment:{assignee_id:'current-agent',team_id:'primary'},permissions:['social_inbox.read','social_inbox.assign','social_inbox.reassign'],configure:routingWorkspace});await openFirst(allowed);
  allowed.document.querySelector('#agent').value='backup-b:target';allowed.document.querySelector('#agent').onchange();
  assert.equal(allowed.document.querySelector('#assign').disabled,false);
  await allowed.document.querySelector('#assign').onclick();
  assert.deepEqual(allowed.routingCalls,[{operation:'update',id:'erp-assignment',action:'transfer',teamId:'backup-b',userId:'target'}]);
});

test('explicit caller Page assign deny blocks routing despite global assign permission',async()=>{
  const fixture=await app({assignment:true,permissions:['social_inbox.read','social_inbox.assign','social_inbox.reassign'],configure:workspace=>{routingWorkspace(workspace);workspace.pages[0].access.push({user_id:'u1',can_read:true,can_reply:true,can_assign:false});}});await openFirst(fixture);
  fixture.document.querySelector('#agent').value='backup-b:target';fixture.document.querySelector('#agent').onchange();
  assert.equal(fixture.document.querySelector('#assign').disabled,true);assert.equal(fixture.document.querySelector('#smart-assign').disabled,true);
  await fixture.document.querySelector('#assign').onclick();assert.equal(fixture.routingCalls.length,0);
});

test('explicit local mock Smart assignment never borrows a different Page team when no team is mapped',async()=>{
  const fixture=await app({localMock:true});
  await fixture.document.querySelector('#fp').onchange({target:{value:PAGE_A}});
  await fixture.document.querySelectorAll('[data-context-id]')[0].onclick();
  await fixture.document.querySelector('#smart-assign').onclick();
  assert.match(fixture.document.querySelector('#customer').innerHTML,/Зохиомол баг/);
  assert.match(fixture.document.querySelector('#customer').innerHTML,/Тест ажилтан/);
  await fixture.document.querySelector('#fp').onchange({target:{value:PAGE_B}});
  await fixture.document.querySelectorAll('[data-context-id]')[0].onclick();
  await fixture.document.querySelector('#smart-assign').onclick();
  const sidebar=fixture.document.querySelector('#customer').innerHTML;
  assert.match(sidebar,/ERP баг: -/);assert.match(sidebar,/ERP ажилтан: -/);
  assert.doesNotMatch(sidebar,/Зохиомол баг|Тест ажилтан/);
  assert.equal(fixture.document.querySelector('#smart-assign').disabled,true);
  assert.equal(fixture.errors.length,0);
  assert.equal(fixture.calls.length,0,'Local mock must not call the authenticated Edge adapter');
});
