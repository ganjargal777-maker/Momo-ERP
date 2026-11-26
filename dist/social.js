(() => {
  const auth = window.nexerpAuth;
  if (!auth || !window.MomoSocialService || !window.MomoSocialInboxSession) return;
  const aiView = document.querySelector('#view-ai-assistant'), socialView = document.querySelector('#view-ai-inbox');
  if (!aiView || !socialView) return;
  const mockMode = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('socialMock') === '1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const mockPage = '11111111-1111-4111-8111-111111111111';
  const mockPage2 = '22222222-2222-4222-8222-222222222222';
  const mockState = {
    pages: [{id:mockPage,name:'Зохиомол Page A',external_page_id:'12345',connection_status:'pending',is_active:true,primary:'t1',backup:null,access:[]},
      {id:mockPage2,name:'Зохиомол Page B',external_page_id:'67890',connection_status:'pending',is_active:true,primary:null,backup:null,access:[]}],
    teams:[{id:'t1',name:'Зохиомол баг',leader_id:'u1',leader:'Тест ажилтан',page_capacity:8,members:['u1'],is_active:true}],
    profiles:[{id:'u1',first_name:'Тест ажилтан',email:'agent@example.invalid',status:'active'}],
    agents:[{id:'u1',name:'Тест ажилтан',status:'online',load:0}],conversations:[],saved:[],knowledge:[],
    flags:{momo_ai_ui:true,social_inbox_ui:true}
  };
  class MockService {
    constructor(){ this.contexts=new Map(); this.replies=new Map(); this.operations=new Map(); }
    async loadWorkspace(){return mockState;}
    async savePage(input){const existing=mockState.pages.find(p=>p.id===input.id),value={...(existing||{}),id:input.id||crypto.randomUUID(),name:input.name,external_page_id:input.externalPageId,is_active:input.isActive,connection_status:input.connectionStatus,primary:input.primaryTeam,backup:input.backupTeam,access:existing?.access||[]};existing?Object.assign(existing,value):mockState.pages.push(value);return value;}
    async saveTeam(input){const existing=mockState.teams.find(t=>t.id===input.id),value={...(existing||{}),id:input.id||crypto.randomUUID(),name:input.name,leader_id:input.leaderId,page_capacity:input.capacity,is_active:input.isActive,members:input.memberIds};existing?Object.assign(existing,value):mockState.teams.push(value);return value;}
    async savePageAccess(pageId,userId,permissions){const page=mockState.pages.find(p=>p.id===pageId);page.access=page.access.filter(x=>x.user_id!==userId);page.access.push({page_id:pageId,user_id:userId,can_read:permissions.read,can_reply:permissions.reply,can_assign:permissions.assign});}
    async smartAssign(pageId,id){
      const existing=mockState.conversations.find(item=>item.page_id===pageId&&item.external_conversation_id===id);
      if(existing)return existing;
      const page=mockState.pages.find(item=>item.id===pageId&&item.is_active);
      if(!page)throw new Error('Идэвхтэй mock Page олдсонгүй.');
      const linkedIds=[...new Set([page.primary,...(page.teamIds||[]),page.backup].filter(Boolean))];
      let chosenTeam=null,chosenAgent=null;
      for(const teamId of linkedIds){
        const team=mockState.teams.find(item=>item.id===teamId&&item.is_active);
        if(!team)continue;
        const eligible=mockState.agents.filter(agent=>{
          const access=page.access?.find(item=>item.user_id===agent.id);
          return agent.status==='online'&&team.members.includes(agent.id)&&mockState.profiles.some(profile=>profile.id===agent.id&&profile.status==='active')&&(!access||(access.can_read===true&&access.can_reply===true));
        }).sort((left,right)=>left.load-right.load||left.id.localeCompare(right.id));
        if(eligible.length){chosenTeam=team;chosenAgent=eligible[0];break;}
      }
      const item={id:crypto.randomUUID(),page_id:pageId,external_conversation_id:id,team_id:chosenTeam?.id||null,assignee_id:chosenAgent?.id||null,status:'open',version:1};
      mockState.conversations.push(item);return item;
    }
    async updateConversation(item,action,teamId,assigneeId){if(action==='resolve')item.status='resolved';if(['assign','transfer'].includes(action)){item.team_id=teamId;item.assignee_id=assigneeId;}item.version++;return item;}
    async createThread(title){return{id:crypto.randomUUID(),title};}
    async appendMessage(thread_id,role,content,sources=[]){return{id:crypto.randomUUID(),thread_id,role,content,sources};}
    async searchCatalog(){return[];}
    async saveReply(input){const value={...input,id:input.id||crypto.randomUUID()};mockState.saved.push(value);return value;}
    async addKnowledge(input){const value={...input,id:crypto.randomUUID()};mockState.knowledge.push(value);return value;}
    async invokeSocial(body){
      const page=mockState.pages.find(p=>p.id===body.pageId);
      if(!page)throw new Error('Mock Page олдсонгүй.');
      const key=body.pageId+':'+body.resource;
      if(!this.contexts.has(key)){this.contexts.set(key,{id:'mock-context-1',pageId:page.external_page_id,channel:body.resource,participant:{id:'fake-customer'},author:{id:'fake-customer',name:'Зохиомол хэрэглэгч'},text:'Зохиомол асуулт',status:'review',paused:false,replyAllowed:true,version:1,basisId:'mock-basis-1',messages:[{id:'mock-message-1',seq:1,direction:'in',text:'Зөвхөн mock fixture',createdAt:Date.now()}],replies:[],mock:true});}
      const context=this.contexts.get(key),replyKey=id=>key+':'+id;let data;
      if(body.action==='capabilities')data={mode:'mock',pageId:page.external_page_id,erpPageId:page.id,sending:false,commentSending:false,llmConfigured:false,mock:true};
      else if(body.action==='list')data={items:[context],nextCursor:null,mock:true};
      else if(body.action==='detail')data=context;
      else if(body.action==='history')data={items:context.messages,nextAfter:null,mock:true};
      else if(body.action==='suggest'){data={id:'mock-reply-'+crypto.randomUUID(),conversationId:context.id,pageId:page.external_page_id,channel:body.resource,basisId:context.basisId,text:'Зохиомол хариу: ажилтан шалгана.',state:'draft',version:1,source:'mock-rules-v1',model:null,mock:true};context.replies.push(data);this.replies.set(replyKey(data.id),data);}
      else if(body.action==='reply'){data=this.replies.get(replyKey(body.id));if(data?.state==='queued'){data.state='sent';data.remoteId='mock-remote-only';data.version++;}}
      else if(body.action==='update'){Object.assign(context,body.patch);context.version++;delete context.expectedVersion;data=context;}
      else if(['edit','approve','send'].includes(body.action)){
        data=this.replies.get(replyKey(body.reply.id));if(!data)throw new Error('Mock reply олдсонгүй.');
        const operation=key+':'+body.idempotencyKey,prior=this.operations.get(operation);
        if(body.action==='send'&&prior)return{ok:true,data:{...prior,replayed:true},meta:{mode:'mock',pageId:page.id,externalPageId:page.external_page_id}};
        if(data.version!==body.reply.version)throw Object.assign(new Error('Mock version conflict'),{code:'version_conflict',status:409});
        if(body.action==='edit'){data.text=body.reply.text;data.state='draft';}
        if(body.action==='approve'){if(data.state!=='draft')throw new Error('Mock draft шаардлагатай.');data.state='approved';}
        if(body.action==='send'){if(data.state!=='approved')throw new Error('Mock approval шаардлагатай.');data.state='queued';}
        data.version++;
        if(body.action==='send'){const result={replyId:data.id,state:'queued',version:data.version,replayed:false,mock:true};this.operations.set(operation,result);data=result;}
      }else throw new Error('Mock action дэмжигдээгүй.');
      return{ok:true,data:structuredClone(data),meta:{mode:'mock',pageId:page.id,externalPageId:page.external_page_id}};
    }
  }
  const service=mockMode?new MockService():new window.MomoSocialService(auth);
  let storage;try{storage=window.sessionStorage;}catch{storage=null;}
  const inbox=new window.MomoSocialInboxSession({invoke:body=>service.invokeSocial(body),storage,storageKey:'momo-social-send-v1:'+auth.profile.organizationId+':'+auth.profile.id});
  let state={pages:[],teams:[],profiles:[],agents:[],conversations:[],saved:[],knowledge:[],flags:{}};
  let activeTab='inbox',activeThread=null,lastAiAnswer=null,selectedPageId=null,selectedResource='messenger';
  let inboxItems=[],inboxCapabilities=null,nextCursor=null,activeContextId=null,threadGeneration=0,inboxStatus='';
  const canManage=auth.can('social_teams.manage')&&auth.can('pages.manage');
  const pane=()=>document.querySelector('#social-pane');
  const profileName=id=>{const profile=state.profiles.find(p=>p.id===id);return profile?([profile.last_name,profile.first_name].filter(Boolean).join(' ')||profile.email):'-';};
  const showError=error=>{if(error.code==='selection_changed')return;const message=(error.message||String(error))+(error.code?' ['+error.code+']':'')+(error.requestId?' · ID: '+error.requestId:'')+(error.retryAfter?' · '+error.retryAfter+' секундийн дараа шалгана уу.':'');window.showToast?window.showToast(message,'error'):alert(message);};
  aiView.innerHTML='<div class="page-heading"><div><p class="eyebrow">MOMO AI</p><h1>Ажилтны туслах</h1><p>ERP-ийн баталгаатай мэдээлэлд тулгуурлана.</p></div><span class="integration-status pending" id="ai-mode">Ачаалж байна</span></div><div class="ai-workspace"><section class="panel ai-chat"><div class="ai-chat-head"><span class="ai-avatar">AI</span><div><strong>MOMO AI</strong><small>Баталгаатай source байхгүй бол зохиохгүй</small></div></div><div class="ai-chat-body" id="ai-log"></div><form class="ai-composer" id="ai-form"><input name="query" maxlength="500" placeholder="Барааны нэр эсвэл SKU"><button class="icon-btn">➤</button></form></section><aside class="panel ai-side"><h3>Хадгалсан хариулт</h3><div id="saved-replies"><p>Хариулт алга.</p></div><button id="save-ai" disabled>Сүүлийн хариултыг хадгалах</button></aside></div>';
  socialView.innerHTML='<div class="page-heading"><div><p class="eyebrow">MULTI-PAGE</p><h1>Сошиал харилцаа</h1><p>Page, баг, ажилтан болон SLA хяналт.</p></div><span class="integration-status pending" id="social-mode">Page сонгоно уу</span></div><div class="social-ops-tabs"><button class="active" data-tab="inbox">Inbox</button><button data-tab="pages">Page</button><button data-tab="teams">Баг</button><button data-tab="analytics">Үзүүлэлт</button></div><div id="social-pane"></div>';
  async function reload(renderAfter=true){state=await service.loadWorkspace();if(selectedPageId&&!state.pages.some(p=>p.id===selectedPageId&&p.is_active)){selectedPageId=null;inbox.selectPage(null,selectedResource);inboxItems=[];inboxCapabilities=null;}if(renderAfter)render();renderSavedReplies();}
  const assignmentExternalId=id=>selectedResource==='comment'?'comment:'+id:id;
  function assignmentFor(id){return state.conversations.find(c=>c.page_id===selectedPageId&&c.external_conversation_id===assignmentExternalId(id));}
  function renderInbox(){
    activeContextId=null;threadGeneration++;
    pane().innerHTML='<div class="social-filters"><select id="fp"><option value="">Page сонгоно уу</option>'+state.pages.filter(p=>p.is_active).map(p=>'<option value="'+esc(p.id)+'" '+(p.id===selectedPageId?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select><select id="fr"><option value="messenger">Messenger</option><option value="comment">Сэтгэгдэл</option></select><select id="ft"><option value="">Бүх баг</option>'+state.teams.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select><select id="fa"><option value="">Бүх ажилтан</option>'+state.agents.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join('')+'</select><select id="fs"><option value="">Бүх төлөв</option><option value="collecting">Мэдээлэл цуглуулж буй</option><option value="ready">Бүрэн хүсэлт</option><option value="review">Шалгах</option><option value="done">Шийдвэрлэсэн</option></select><button id="inbox-refresh" class="btn secondary">Шинэчлэх</button></div><p id="inbox-status"></p><div class="social-grid panel"><aside class="social-list"><div id="items"></div><button id="inbox-more" class="btn secondary" hidden>Дараагийн хуудас</button></aside><section class="social-thread" id="thread"><div class="inbox-empty"><h2>'+(selectedPageId?'Харилцаа сонгоно уу':'Эхлээд Page сонгоно уу')+'</h2></div></section><aside class="social-customer" id="customer"><h3>Харилцагч</h3></aside></div>';
    document.querySelector('#fr').value=selectedResource;
    document.querySelector('#fp').onchange=event=>selectInbox(event.target.value||null,selectedResource);
    document.querySelector('#fr').onchange=event=>selectInbox(selectedPageId,event.target.value);
    document.querySelector('#inbox-refresh').onclick=()=>loadInbox(false);
    document.querySelector('#inbox-more').onclick=()=>loadInbox(true);
    ['ft','fa','fs'].forEach(id=>document.querySelector('#'+id).onchange=drawInbox);
    drawInbox();
  }
  async function selectInbox(pageId,resource){selectedPageId=pageId;selectedResource=resource;inbox.selectPage(pageId,resource);inboxItems=[];inboxCapabilities=null;nextCursor=null;inboxStatus='';renderInbox();if(pageId)await loadInbox(false);}
  function drawInbox(){
    if(!document.querySelector('#items'))return;
    const team=document.querySelector('#ft').value,agent=document.querySelector('#fa').value,status=document.querySelector('#fs').value;
    const rows=inboxItems.filter(item=>{const assignment=assignmentFor(item.id);return(!team||assignment?.team_id===team)&&(!agent||assignment?.assignee_id===agent)&&(!status||item.status===status);});
    document.querySelector('#items').innerHTML=rows.map(item=>'<button class="social-item" data-context-id="'+esc(item.id)+'"><b>'+esc(item.participant?.name||item.author?.name||item.participant?.id||item.id)+'</b><span>'+esc(item.text||item.details?.product||'Харилцаа')+'</span><small>'+esc(item.status)+' · v'+esc(item.version)+'</small></button>').join('')||'<p class="social-empty">'+(selectedPageId?'Ачаалсан илэрц алга.':'Page сонгоно уу.')+'</p>';
    document.querySelector('#inbox-status').textContent=inboxStatus;
    document.querySelector('#inbox-more').hidden=!nextCursor;
    document.querySelectorAll('[data-context-id]').forEach(button=>button.onclick=()=>openConversation(rows.find(item=>item.id===button.dataset.contextId)));
  }
  async function loadInbox(append=false){
    if(!selectedPageId)return;
    try{
      const capabilities=await inbox.request('capabilities');inboxCapabilities=capabilities.data;
      const result=await inbox.request('list',{filters:{limit:25,...(append&&nextCursor?{cursor:nextCursor}:{})}});
      inboxItems=append?[...new Map([...inboxItems,...result.data.items].map(item=>[item.id,item])).values()]:result.data.items;
      nextCursor=result.data.nextCursor;const mode=result.meta?.mode||inboxCapabilities.mode||'unknown';
      inboxStatus=(mode==='mock'?'Mock fixture · бодит илгээлт биш':'Bot API · '+selectedResource)+' · '+inboxItems.length+' ачаалсан';
      document.querySelector('#social-mode').textContent=mode==='mock'?'Mock fixture':'Page холболт';drawInbox();
    }catch(error){if(error.code==='selection_changed')return;inboxStatus=error.message;showError(error);drawInbox();}
  }
  async function openConversation(summary){
    const token=++threadGeneration;activeContextId=summary.id;
    try{const response=await inbox.request('detail',{id:summary.id});if(token!==threadGeneration)return;renderConversation(response.data,response.meta||{},token);}
    catch(error){if(token===threadGeneration)showError(error);}
  }
  function renderConversation(context,meta,token){
    const page=state.pages.find(p=>p.id===selectedPageId),assignment=assignmentFor(context.id),isMock=mockMode||meta.mode==='mock'||context.mock===true;
    const externalAssignmentId=assignmentExternalId(context.id);
    const pageTeamIds=new Set(page?.teamIds||[page?.primary,page?.backup].filter(Boolean));
    const pageTeams=state.teams.filter(team=>team.is_active&&pageTeamIds.has(team.id));
    const ownPageAccess=page?.access?.find(access=>access.user_id===auth.profile.id);
    const pageAllows=action=>!ownPageAccess||(ownPageAccess.can_read===true&&ownPageAccess['can_'+action]===true);
    const mayAssign=auth.can('social_inbox.read')&&auth.can('social_inbox.assign')&&pageAllows('assign');
    const targets=pageTeams.flatMap(team=>state.agents.filter(agent=>{
      const access=page?.access?.find(row=>row.user_id===agent.id);
      return agent.status==='online'&&team.members.includes(agent.id)&&state.profiles.some(profile=>profile.id===agent.id&&profile.status==='active')&&(!access||(access.can_read===true&&access.can_reply===true));
    }).map(agent=>({key:team.id+':'+agent.id,team,agent})));
    const thread=document.querySelector('#thread'),current=()=>token===threadGeneration&&activeContextId===context.id&&thread===document.querySelector('#thread');
    let draft=(context.replies||[]).filter(reply=>!reply.basisId||reply.basisId===context.basisId).at(-1)||null,busy=false,awaitingCheck=false,historyAfter=0,historyComplete=false;
    const messages=new Map((context.messages||[]).map(message=>[message.id,message]));
    document.querySelector('#customer').innerHTML='<h3>'+esc(context.participant?.name||context.author?.name||context.participant?.id||context.id)+'</h3><p>Page: '+esc(page?.name)+'</p><p>Төрөл: '+esc(selectedResource)+'</p><p>ERP баг: '+esc(state.teams.find(t=>t.id===assignment?.team_id)?.name||'-')+'</p><p>ERP ажилтан: '+esc(profileName(assignment?.assignee_id))+'</p>';
    thread.innerHTML='<div class="thread-messages"></div><button id="history-more" class="btn secondary" '+(context.historyTruncated?'':'hidden')+'>Өмнөх history ачаалах</button><div class="reply-editor"><p>'+(isMock?'MOCK — зохиомол fixture; бодит илгээлт биш.':'Ажилтан хянаж баталсны дараа илгээнэ.')+'</p><select id="agent"><option value="">Page багийн ажилтан сонгох</option>'+targets.map(target=>'<option value="'+esc(target.key)+'">'+esc(target.team.name)+' · '+esc(target.agent.name)+' · '+target.agent.load+'</option>').join('')+'</select><button id="smart-assign" class="btn secondary">Smart хуваарилалт үүсгэх</button><button id="assign" class="btn secondary">ERP оноох/шилжүүлэх</button><small>'+(assignment?'Сонгосон Page-ийн баг/ажилтан; эрхийг сервер дахин шалгана.':'Гар оноолтын өмнө Smart хуваарилалт үүсгэнэ. Smart сонгосон ажилтныг шилжүүлэхэд тусдаа эрх шаардлагатай.')+'</small><button id="claim" class="btn secondary">ERP харилцааг авах</button><button id="resolve" class="btn secondary">ERP хуваарилалт шийдвэрлэх</button><button id="close-context" class="btn secondary">Ботын харилцааг хаах</button><textarea maxlength="2000" placeholder="Хариултын draft"></textarea><div><button id="suggest" class="btn secondary">Хариуны санал</button><button id="approve" class="btn secondary">Засварыг хадгалж батлах</button><button id="knowledge" class="btn secondary">Knowledge-д хадгалах</button><button id="send" class="btn primary">'+(isMock?'Mock queue турших':'Илгээх')+'</button><button id="reply-refresh" class="btn secondary">Илгээлтийн төлөв шалгах</button></div><small id="rstate"></small></div>';
    const textarea=thread.querySelector('textarea'),status=thread.querySelector('#rstate');
    textarea.value=draft?.text||'';
    function renderMessages(){thread.querySelector('.thread-messages').innerHTML=selectedResource==='comment'?'<div class="thread-message">'+esc(context.text)+'</div>':[...messages.values()].sort((a,b)=>(a.seq||0)-(b.seq||0)).map(message=>'<div class="thread-message"><small>'+esc(message.direction)+' · '+esc(message.delivery||'')+'</small><p>'+esc(message.text)+'</p></div>').join('');}
    function controls(){
      const dirty=Boolean(draft&&textarea.value!==draft.text),editable=draft&&['draft','approved'].includes(draft.state);
      textarea.disabled=busy||awaitingCheck||Boolean(draft&&!editable);
      thread.querySelector('#suggest').disabled=busy||awaitingCheck||!auth.can('social_inbox.reply_draft');
      thread.querySelector('#approve').disabled=busy||awaitingCheck||!auth.can('social_inbox.reply_draft')||!editable||(!dirty&&draft.state==='approved');
      thread.querySelector('#send').disabled=busy||awaitingCheck||!auth.can('social_inbox.reply_send')||draft?.state!=='approved'||dirty||(!isMock&&(!inboxCapabilities?.sending||(selectedResource==='comment'&&!inboxCapabilities?.commentSending)))||context.paused||context.deleted||context.status==='done'||(selectedResource==='messenger'&&context.replyAllowed===false);
      thread.querySelector('#knowledge').disabled=busy||!auth.can('ai_suggestions.create')||!draft||!['approved','sent'].includes(draft.state)||dirty;
      thread.querySelector('#reply-refresh').disabled=busy||!draft?.id;
      const target=targets.find(item=>item.key===thread.querySelector('#agent').value);
      const same=Boolean(target&&assignment?.assignee_id===target.agent.id&&assignment?.team_id===target.team.id);
      thread.querySelector('#assign').disabled=busy||!assignment||!mayAssign||!target||same||Boolean(assignment.assignee_id&&!auth.can('social_inbox.reassign'));
      thread.querySelector('#smart-assign').disabled=busy||Boolean(assignment)||!mayAssign;
      thread.querySelector('#claim').disabled=busy||!assignment||!mayAssign;
      thread.querySelector('#resolve').disabled=busy||!assignment||!auth.can('social_inbox.read')||!auth.can('social_inbox.resolve')||!pageAllows('reply');
      status.textContent=(isMock?'Mock · ':'')+(awaitingCheck?'Илгээгдсэн эсэх тодорхойгүй. Ижил operation хадгалагдсан; эхлээд төлөв шалгана уу.':draft?'Төлөв: '+draft.state+' · v'+draft.version+(draft.state==='sent'&&!isMock?(draft.remoteId?' · Meta баталгаажуулсан':' · remote ID-г шалгана уу.'):''):'Draft үүсээгүй.');
    }
    async function run(operation){if(busy)return;busy=true;controls();try{await operation();}catch(error){if(current())showError(error);}finally{busy=false;if(current())controls();}}
    async function poll(){if(!draft)return;await inbox.pollReply(draft.id,{onUpdate:(reply)=>{if(!current())return;draft=reply;textarea.value=reply.text||textarea.value;awaitingCheck=false;controls();}});}
    textarea.oninput=controls;
    thread.querySelector('#suggest').onclick=()=>run(async()=>{const response=await inbox.request('suggest',{id:context.id});if(!current())return;draft=response.data;textarea.value=draft.text;});
    thread.querySelector('#approve').onclick=()=>run(async()=>{if(!draft)return;if(textarea.value!==draft.text){const edited=await inbox.request('edit',{reply:{id:draft.id,version:draft.version,text:textarea.value}});if(!current())return;draft=edited.data;}const approved=await inbox.request('approve',{reply:{id:draft.id,version:draft.version}});if(current())draft=approved.data;});
    thread.querySelector('#send').onclick=()=>run(async()=>{if(!draft)return;try{const response=await inbox.sendReply(draft);if(!current())return;draft={...draft,state:response.data.state,version:response.data.version};await poll();}catch(error){if(current())awaitingCheck=true;throw error;}});
    thread.querySelector('#reply-refresh').onclick=()=>run(poll);
    thread.querySelector('#knowledge').onclick=()=>run(async()=>{await service.addKnowledge({pageId:selectedPageId,title:'Шалгасан хариу · '+context.id,answer:draft.text,sourceReplyId:draft.id});});
    thread.querySelector('#history-more').onclick=()=>run(async()=>{if(historyComplete)return;const response=await inbox.request('history',{id:context.id,filters:{after:historyAfter,limit:100}});if(!current())return;response.data.items.forEach(message=>messages.set(message.id,message));historyAfter=response.data.nextAfter;historyComplete=historyAfter===null;thread.querySelector('#history-more').hidden=historyComplete;renderMessages();});
    thread.querySelector('#agent').onchange=controls;
    thread.querySelector('#close-context').disabled=!mayAssign||!auth.can('social_inbox.resolve')||!pageAllows('reply');
    thread.querySelector('#assign').onclick=()=>run(async()=>{
      if(!assignment)throw new Error('Гар оноолтын өмнө Smart хуваарилалт үүсгэнэ үү.');
      if(!mayAssign)throw new Error('Энэ Page-д оноох эрх байхгүй.');
      const target=targets.find(item=>item.key===thread.querySelector('#agent').value);
      if(!target)throw new Error('Сонгосон Page-ийн идэвхтэй багийн онлайн ажилтан сонгоно уу.');
      if(assignment.assignee_id===target.agent.id&&assignment.team_id===target.team.id)return;
      const action=assignment.assignee_id?'transfer':'assign';
      if(action==='transfer'&&!auth.can('social_inbox.reassign'))throw new Error('Оноосон харилцааг шилжүүлэх тусдаа эрх шаардлагатай.');
      await service.updateConversation(assignment,action,target.team.id,target.agent.id);
      await reload(false);if(current())await openConversation(context);
    });
    thread.querySelector('#smart-assign').onclick=()=>run(async()=>{
      if(assignment||!mayAssign)throw new Error('Smart хуваарилалт үүсгэх нөхцөл хангагдсангүй.');
      await service.smartAssign(page.id,externalAssignmentId);
      await reload(false);if(current())await openConversation(context);
    });
    thread.querySelector('#claim').onclick=()=>run(async()=>{await service.updateConversation(assignment,'claim');await reload(false);if(current())await openConversation(context);});
    thread.querySelector('#resolve').onclick=()=>run(async()=>{await service.updateConversation(assignment,'resolve');await reload(false);if(current())await openConversation(context);});
    thread.querySelector('#close-context').onclick=()=>run(async()=>{await inbox.request('update',{id:context.id,patch:{expectedVersion:context.version,status:'done'}});if(current())await openConversation(context);});
    renderMessages();controls();
  }

  // Existing Page/team management and grounded assistant code is retained below.
function teamOptions(selected){return`<option value="">Сонгоогүй</option>${state.teams.map(t=>`<option value="${t.id}" ${selected===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}`}
function renderPages(){pane().innerHTML=`<div class="management-head"><h2>Page Management</h2>${canManage?'<button class="btn primary" id="add-page">Page нэмэх</button>':''}</div><div class="management-grid">${state.pages.map(p=>`<article class="management-card"><b>${esc(p.name)}</b><span>${esc(p.external_page_id||'External ID байхгүй')}</span><i>${esc(p.connection_status||'disconnected')}</i><label>Primary team<select data-primary="${p.id}" ${canManage?'':'disabled'}>${teamOptions(p.primary)}</select></label><label>Backup team<select data-backup="${p.id}" ${canManage?'':'disabled'}>${teamOptions(p.backup)}</select></label><span>${p.access?.length||0} тусгай Page эрх</span>${canManage?`<div><button class="btn secondary" data-save-page="${p.id}">Хадгалах</button><button class="btn secondary" data-access="${p.id}">Page эрх</button></div>`:''}</article>`).join('')}</div>`;document.querySelector('#add-page')?.addEventListener('click',async()=>{const name=prompt('Page нэр');if(!name)return;try{await service.savePage({name,externalPageId:prompt('Facebook Page ID (хоосон байж болно)')||'',isActive:true,connectionStatus:'disconnected'});await reload()}catch(e){showError(e)}});document.querySelectorAll('[data-save-page]').forEach(b=>b.onclick=async()=>{const p=state.pages.find(x=>x.id===b.dataset.savePage);try{await service.savePage({id:p.id,name:p.name,externalPageId:p.external_page_id,isActive:p.is_active,connectionStatus:p.connection_status,primaryTeam:document.querySelector(`[data-primary="${p.id}"]`).value||null,backupTeam:document.querySelector(`[data-backup="${p.id}"]`).value||null});await reload()}catch(e){showError(e)}});document.querySelectorAll('[data-access]').forEach(b=>b.onclick=async()=>{const p=state.pages.find(x=>x.id===b.dataset.access),email=prompt('Эрх тохируулах ажилтны email'),u=state.profiles.find(x=>x.email.toLowerCase()===String(email||'').toLowerCase());if(!u)return showError(new Error('Ажилтан олдсонгүй.'));try{await service.savePageAccess(p.id,u.id,{read:confirm('Унших эрх өгөх үү?'),reply:confirm('Хариулах эрх өгөх үү?'),assign:confirm('Хуваарилах эрх өгөх үү?')});await reload()}catch(e){showError(e)}})}
function renderTeams(){pane().innerHTML=`<div class="management-head"><h2>Team Management</h2>${canManage?'<button class="btn primary" id="add-team">Баг нэмэх</button>':''}</div><div class="management-grid">${state.teams.map(t=>`<article class="management-card"><b>${esc(t.name)}</b><span>Ахлагч: ${esc(t.leader||profileName(t.leader_id))}</span><span>${t.members.length} ажилтан · ${state.pages.filter(p=>p.primary===t.id||p.backup===t.id).length}/${t.page_capacity||'∞'} Page</span><span>Идэвхтэй ачаалал: ${state.agents.filter(a=>t.members.includes(a.id)).reduce((s,a)=>s+a.load,0)}</span>${canManage?`<button class="btn secondary" data-edit-team="${t.id}">Засах</button>`:''}</article>`).join('')}</div>`;document.querySelector('#add-team')?.addEventListener('click',()=>editTeam());document.querySelectorAll('[data-edit-team]').forEach(b=>b.onclick=()=>editTeam(state.teams.find(x=>x.id===b.dataset.editTeam)))}
async function editTeam(team=null){const name=prompt('Багийн нэр',team?.name||'');if(!name)return;const capacity=Number(prompt('Page capacity',team?.page_capacity||8));if(!Number.isInteger(capacity)||capacity<1)return showError(new Error('Capacity нь 1-ээс их бүхэл тоо байна.'));const leaderEmail=prompt('Ахлагчийн email',state.profiles.find(x=>x.id===team?.leader_id)?.email||''),leader=state.profiles.find(x=>x.email.toLowerCase()===String(leaderEmail||'').toLowerCase()),memberEmails=prompt('Гишүүдийн email-ийг таслалаар тусгаарлана',(team?.members||[]).map(id=>state.profiles.find(x=>x.id===id)?.email).filter(Boolean).join(', '))||'',members=memberEmails.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).map(email=>state.profiles.find(x=>x.email.toLowerCase()===email)).filter(Boolean);try{await service.saveTeam({id:team?.id,name,leaderId:leader?.id||null,capacity,isActive:true,memberIds:[...new Set(members.map(x=>x.id))]});await reload()}catch(e){showError(e)}}

function aiMessage(role,text){const d=document.createElement('div');d.className=`ai-message ${role}`;d.textContent=text;document.querySelector('#ai-log').appendChild(d)}function renderSavedReplies(){const t=document.querySelector('#saved-replies');if(t)t.innerHTML=state.saved.length?state.saved.map(r=>`<article><b>${esc(r.title||'Хадгалсан хариулт')}</b><p>${esc(r.content||r.answer)}</p></article>`).join(''):'<p>Хариулт алга.</p>'}
document.querySelector('#ai-form').onsubmit=async e=>{e.preventDefault();const query=e.currentTarget.elements.query.value.trim();if(!query)return;aiMessage('user',query);e.currentTarget.reset();try{if(!activeThread)activeThread=await service.createThread(query.slice(0,80));await service.appendMessage(activeThread.id,'user',query);const products=await service.searchCatalog(query),answer=products.length?products.map(p=>`${p.name} (${p.sku}) — үнэ: ${Number(p.discount_price||p.sale_price).toLocaleString('mn-MN')}₮, баталгаатай үлдэгдэл: ${p.verifiedQuantity} ш`).join('\n'):'Баталгаатай барааны мэдээлэл олдсонгүй. Үнэ, үлдэгдэл зохиож хариулахгүй.';lastAiAnswer=await service.appendMessage(activeThread.id,'assistant',answer,products.map(p=>({type:'product',id:p.id,sku:p.sku})));aiMessage('assistant',answer);document.querySelector('#save-ai').disabled=false}catch(x){aiMessage('assistant error',x.message)}};document.querySelector('#save-ai').onclick=async()=>{if(!lastAiAnswer)return;const title=prompt('Хадгалсан хариултын нэр','Бэлэн хариулт');if(!title)return;try{await service.saveReply({title,content:lastAiAnswer.content,shared:false});await reload(false)}catch(e){showError(e)}};


  function renderAnalytics(){const assignments=state.conversations;pane().innerHTML='<div class="analytics-grid"><article><span>ERP хуваарилалтын бүртгэл</span><strong>'+assignments.length+'</strong></article><article><span>Уншаагүй бүртгэл</span><strong>'+assignments.filter(c=>c.unread_count>0).length+'</strong></article><article><span>Шийдвэрлээгүй бүртгэл</span><strong>'+assignments.filter(c=>c.status!=='resolved').length+'</strong></article><article><span>AI-assisted тэмдэглэгээ</span><strong>'+assignments.filter(c=>c.ai_assisted).length+'</strong></article></div>';}
  function render(){if(!mockMode&&!state.flags?.social_inbox_ui){pane().innerHTML='<div class="panel social-disabled"><h2>Social Inbox feature flag идэвхгүй.</h2></div>';return;}({inbox:renderInbox,pages:renderPages,teams:renderTeams,analytics:renderAnalytics}[activeTab])();}
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{activeTab=button.dataset.tab;threadGeneration++;activeContextId=null;document.querySelectorAll('[data-tab]').forEach(item=>item.classList.toggle('active',item===button));render();});
  let presenceTimer=null,presenceBusy=false,presenceStopped=false;
  async function heartbeat(status='online'){if(presenceBusy||mockMode||presenceStopped)return;presenceBusy=true;try{await service.updatePresence(status);return true;}catch(error){showError(error);return false;}finally{presenceBusy=false;}}
  function schedulePresence(status){if(presenceTimer)clearInterval(presenceTimer);presenceTimer=null;if(status==='online'&&!mockMode&&!presenceStopped)presenceTimer=setInterval(()=>heartbeat('online'),60000);}
  function renderPresence(){if(mockMode||!auth.can('social_inbox.read'))return;const heading=socialView.querySelector('.page-heading');let selector=document.querySelector('#social-presence');if(!selector){selector=document.createElement('select');selector.id='social-presence';selector.setAttribute('aria-label','Миний ажиллах төлөв');selector.innerHTML='<option value="offline">Offline</option><option value="online">Online</option><option value="away">Away</option><option value="leave">Чөлөөтэй</option>';heading.appendChild(selector);selector.onchange=async()=>{selector.disabled=true;try{const updated=await heartbeat(selector.value);if(!updated){selector.value=state.agents.find(agent=>agent.id===auth.profile.id)?.status||'offline';return;}const own=state.agents.find(agent=>agent.id===auth.profile.id);if(own)own.status=selector.value;schedulePresence(selector.value);}finally{selector.disabled=false;}};}const status=state.agents.find(agent=>agent.id===auth.profile.id)?.status||'offline';selector.value=status;schedulePresence(status);if(status==='online')heartbeat(status);}
  window.addEventListener('pagehide',()=>{presenceStopped=true;if(presenceTimer)clearInterval(presenceTimer);presenceTimer=null;});
  window.addEventListener('pageshow',()=>{presenceStopped=false;const status=state.agents.find(agent=>agent.id===auth.profile.id)?.status||'offline';schedulePresence(status);if(status==='online')heartbeat(status);});
  async function boot(){try{await reload(false);document.querySelector('#social-mode').textContent=mockMode?'MOCK · бодит холболт биш':'Page сонгоно уу';const aiEnabled=mockMode||state.flags?.momo_ai_ui;document.querySelector('#ai-mode').textContent=mockMode?'MOCK fixture':aiEnabled?'Grounded ERP data · LLM биш':'Feature flag идэвхгүй';document.querySelector('#ai-form').querySelectorAll('input,button').forEach(element=>element.disabled=!aiEnabled);render();renderSavedReplies();renderPresence();}catch(error){document.querySelector('#social-mode').textContent='Schema/эрхийн алдаа';pane().innerHTML='<div class="panel social-disabled"><h2>Өгөгдөл ачаалсангүй</h2><p>'+esc(error.message)+'</p></div>';}}
  boot();window.lucide?.createIcons();
})();
