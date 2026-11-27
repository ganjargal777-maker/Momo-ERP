// Isolated actual Auth/PostgREST/PG + bot HTTP/SQLite acceptance. No .env load.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { startBrowserStack } from '../test/helpers/local-browser-stack.mjs';
import { createSocialIntegrationHandler } from '../supabase/functions/_shared/social-contract.mjs';
import { createSocialAccessRecheckHandler } from '../supabase/functions/_shared/social-access-recheck.mjs';

const root=resolve(import.meta.dirname,'..');
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const excluded=new Set(['202609170003_bootstrap_momo_erp.sql','202609180001_verify_admin_auth_rls.sql','202609180002_set_admin_first_name.sql']);

export async function rehearseSocialDelivery({dockerBin,botRoot,reportPath=join(root,'docs/evidence/social-delivery-local.json')}={}) {
  const report={schemaVersion:1,scope:'actual-local-Auth-PostgREST-PostgreSQL-bot-HTTP-SQLite',checkedAtUtc:new Date().toISOString(),checks:[],
    productionWrites:0,realMetaSends:0,externalEmails:0,hostedVerified:false,hostedTlsVerified:false,provider:'injected-no-network',backendAuthorizationMocks:false};
  let stack,db,server,bot,dataDir,stage='start',botOrigin,gate;
  const secrets=[],deliveries=[],accessRequests=[];
  const check=async(name,fn)=>{stage=name;await fn();report.checks.push({name,status:'PASS'});};
  const safe=value=>secrets.reduce((s,v)=>v?s.replaceAll(v,'[REDACTED]'):s,String(value)).replace(/https?:\/\/[^\s"'<>]+/gu,'[URL]').slice(0,240);
  try {
    const {createApplication}=await import(pathToFileURL(join(resolve(botRoot),'src/server.js')).href);
    const {ERP_SCOPES}=await import(pathToFileURL(join(resolve(botRoot),'src/erp-auth.js')).href);
    let gateway,recheck;
    server=http.createServer(async(req,res)=>{
      try {
        const parts=[];let size=0;
        for await(const part of req){size+=part.length;if(size>65536)throw new Error('Fixture request too large');parts.push(part);}
        const fn=req.url==='/social'?gateway:req.url==='/recheck'?recheck:null;
        if(!fn){res.writeHead(404);res.end();return;}
        const r=await fn(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(parts.length?{body:Buffer.concat(parts)}:{})}));
        res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
      }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"isolated_fixture_failure"}');}
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const bridgeOrigin=`http://127.0.0.1:${server.address().port}`;
    stack=await startBrowserStack({dockerBin,uiOrigin:bridgeOrigin});report.stack=stack.publicSummary;
    secrets.push(stack.serviceKey,stack.publicKey);
    db=new pg.Client({connectionString:stack.dbUrl,connectionTimeoutMillis:5000,statement_timeout:10000});await db.connect();
    await check('Curated migrations compile in a new loopback-only database',async()=>{
      const files=(await readdir(join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')&&!excluded.has(f)).sort();
      for(const file of files){await db.query('BEGIN');try{await db.query(await readFile(join(root,'supabase/migrations',file),'utf8'));await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw Object.assign(new Error('Local migration '+file),{code:error.code});}}
      await db.query("NOTIFY pgrst, 'reload schema'");report.migrationCount=files.length;
    });
    stage='Provision synthetic organizations and real local Auth users';
    const org=randomUUID(),foreignOrg=randomUUID(),team=randomUUID(),page=randomUUID(),role=randomUUID(),externalPage='123456789001';
    await db.query("INSERT INTO public.organizations(id,name,slug) VALUES($1,'SYNTHETIC delivery A',$2),($3,'SYNTHETIC delivery B',$4)",[org,'local-delivery-'+org,foreignOrg,'local-delivery-'+foreignOrg]);
    const sdk=(url,key,options={})=>createClient(url,key,{...options,global:{...options.global,fetch:async(target,init)=>{
      assert.equal(new URL(target).origin,stack.apiUrl,'SDK is confined to the owned local API');return fetch(target,init);
    }}});
    const admin=sdk(stack.apiUrl,stack.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const createStaff=async(email,organization)=>{
      const password='Synthetic!'+randomBytes(16).toString('hex');secrets.push(password);
      const result=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{organization_id:organization}});assert.equal(result.error,null);
      // GoTrue writes app_metadata after INSERT. Bind only this just-created
      // synthetic fixture explicitly; real invitations use the provisioning RPC.
      await db.query("UPDATE public.profiles SET organization_id=$1,status='active' WHERE id=$2",[organization,result.data.user.id]);
      const client=sdk(stack.apiUrl,stack.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
      const login=await client.auth.signInWithPassword({email,password});assert.equal(login.error,null);const jwt=login.data.session.access_token;secrets.push(jwt);return{id:result.data.user.id,jwt};
    };
    const staff=await createStaff('synthetic-social-staff@example.invalid',org),outsider=await createStaff('synthetic-other-org@example.invalid',foreignOrg);
    assert.equal((await db.query('SELECT organization_id FROM public.profiles WHERE id=$1',[staff.id])).rows[0]?.organization_id,org,'Synthetic Auth profile must be bound to fixture organization');
    stage='Provision synthetic role and permissions';
    await db.query("INSERT INTO public.roles(id,organization_id,name) VALUES($1,$2,'Synthetic delivery staff')",[role,org]);
    await db.query("INSERT INTO public.role_permissions(role_id,permission_code) SELECT $1,code FROM public.permissions WHERE code IN ('social_inbox.read','social_inbox.reply_draft','social_inbox.reply_send','social_audit.read')",[role]);
    stage='Assign synthetic staff role';
    await db.query('INSERT INTO public.user_roles(user_id,role_id) VALUES($1,$2)',[staff.id,role]);
    stage='Provision synthetic team and Page binding';
    await db.query("INSERT INTO public.social_teams(id,organization_id,name) VALUES($1,$2,'Synthetic primary')",[team,org]);
    await db.query('INSERT INTO public.social_team_members(team_id,user_id,is_active) VALUES($1,$2,true)',[team,staff.id]);
    await db.query("INSERT INTO public.facebook_pages(id,organization_id,name,external_page_id,is_active,connection_status) VALUES($1,$2,'Synthetic Page',$3,true,'connected')",[page,org,externalPage]);
    await db.query("INSERT INTO public.social_page_teams(page_id,team_id,assignment_type) VALUES($1,$2,'primary')",[page,team]);
    for(const key of ['social_inbox_read','social_inbox_ai_draft','social_inbox_reply_send'])await db.query('INSERT INTO public.feature_flags(organization_id,key,enabled) VALUES($1,$2,true) ON CONFLICT(organization_id,key) DO UPDATE SET enabled=true',[org,key]);
    const token=randomBytes(40).toString('hex'),recheckToken=randomBytes(40).toString('hex');secrets.push(token,recheckToken);
    const environment={SUPABASE_URL:stack.apiUrl,SUPABASE_ANON_KEY:stack.publicKey,SUPABASE_SERVICE_ROLE_KEY:stack.serviceKey,
      SOCIAL_ADAPTER_MODE:'live',SOCIAL_ALLOWED_ORIGINS_JSON:'["http://localhost:4173"]',SOCIAL_STAFF_RECHECK_ENABLED:'true',
      SOCIAL_ACCESS_RECHECK_ENABLED:'true',SOCIAL_ACCESS_RECHECK_TOKEN:recheckToken,
      FACEBOOK_BOT_ALLOWED_ORIGINS_JSON:'["https://synthetic-bot.example.invalid"]',FACEBOOK_BOT_ERP_TOKEN_LOCAL:token,
      FACEBOOK_BOT_PAGE_REGISTRY_JSON:JSON.stringify([{erpPageId:page,organizationId:org,externalPageId:externalPage,apiVersion:'1',baseUrl:'https://synthetic-bot.example.invalid',tokenEnv:'FACEBOOK_BOT_ERP_TOKEN_LOCAL'}])};
    recheck=createSocialAccessRecheckHandler({createClient:sdk,env:name=>environment[name]});
    gateway=createSocialIntegrationHandler({createClient:sdk,env:name=>environment[name],fetchImpl:async(url,init)=>{
      const target=new URL(url);assert.equal(target.origin,'https://synthetic-bot.example.invalid');return fetch(botOrigin+target.pathname+target.search,init);
    }});
    const config={mode:'live',pageId:externalPage,pageToken:'synthetic-not-a-meta-token',graphVersion:'v27.0',appSecret:randomBytes(32).toString('hex'),verifyToken:'synthetic-verify',adminToken:randomBytes(40).toString('hex'),
      autoReply:false,erpEnabled:true,erpControlMessenger:true,erpSendEnabled:true,erpCommentsEnabled:false,commentsSendEnabled:false,
      erpActorRecheckRequired:true,erpAccessRecheckUrl:'https://synthetic-erp.example.invalid/recheck',erpAccessRecheckToken:recheckToken,
      erpApiKeysJson:JSON.stringify([{id:'synthetic-connector',token,scopes:ERP_SCOPES,pageIds:[externalPage]}])};
    dataDir=await mkdtemp(join(tmpdir(),'momo-social-joint-'));config.dataDir=dataDir;
    const openBot=async()=>{
      bot=createApplication(config,{suggestionProvider:()=>({text:'Synthetic draft for staff review.',source:'synthetic',model:null}),
        fetchFn:async(url,init)=>{assert.equal(String(url),`https://graph.facebook.com/v27.0/${externalPage}/messages`);deliveries.push(JSON.parse(init.body));return Response.json({message_id:'synthetic-local-'+deliveries.length});},
        accessFetchFn:async(url,init)=>{assert.equal(String(url),config.erpAccessRecheckUrl);accessRequests.push(JSON.parse(init.body));if(gate)await gate.promise;return fetch(bridgeOrigin+'/recheck',init);}});
      bot.server.listen(0,'127.0.0.1');await once(bot.server,'listening');botOrigin=`http://127.0.0.1:${bot.server.address().port}`;
    };await openBot();await pause(400);
    const call=async(body,jwt=staff.jwt)=>{const response=await fetch(bridgeOrigin+'/social',{method:'POST',headers:{Origin:'http://localhost:4173',Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({pageId:page,resource:'messenger',...body})});return{status:response.status,body:await response.json()};};
    const webhook=async(mid)=>{const body=JSON.stringify({object:'page',entry:[{id:externalPage,messaging:[{sender:{id:'678900001'},recipient:{id:externalPage},timestamp:Date.now(),message:{mid,text:'SYNTHETIC TEST ONLY — Бараа: Туршилтын хайрцаг\nТоо: 2'}}]}]});const r=await fetch(botOrigin+'/webhook',{method:'POST',headers:{'X-Hub-Signature-256':'sha256='+createHmac('sha256',config.appSecret).update(body).digest('hex')},body});assert.equal(r.status,200);await r.text();};
    const settle=async(id,state)=>{const end=Date.now()+12000;while(bot.erp.store.reply(id)?.state!==state){assert.ok(Date.now()<end,'Queue did not reach '+state);await pause(20);}};
    await check('Actual Auth JWT, foreign organization and frontend actor injection fail closed',async()=>{
      assert.equal((await call({action:'list',filters:{}},'invalid.jwt.token')).status,401);
      assert.equal((await call({action:'list',filters:{}},outsider.jwt)).status,403);
      assert.equal((await call({action:'list',filters:{},subjectId:outsider.id})).status,400);
      assert.equal(deliveries.length,0);
    });
    await webhook('synthetic-local-event-1');await webhook('synthetic-local-event-1');
    let conversation,draft;
    await check('Signed webhook deduplicates and a real authorized ERP inbox reads local SQLite',async()=>{
      const result=await call({action:'list',filters:{}});assert.equal(result.status,200,'Inbox response code: '+(result.body.error?.code??'none'));assert.equal(result.body.data.items.length,1);conversation=result.body.data.items[0];assert.equal(conversation.pageId,externalPage);assert.equal(deliveries.length,0);
    });
    await check('Draft then edit then approve persists each version without an automatic send',async()=>{
      let r=await call({action:'suggest',id:conversation.id});assert.equal(r.status,201);draft=r.body.data;
      r=await call({action:'edit',reply:{id:draft.id,version:draft.version,text:'SYNTHETIC staff-reviewed answer.'}});assert.equal(r.status,200);draft=r.body.data;
      r=await call({action:'approve',reply:{id:draft.id,version:draft.version}});assert.equal(r.status,200);draft=r.body.data;assert.equal(draft.state,'approved');assert.equal(deliveries.length,0);
    });
    const sentRequest={action:'send',reply:{id:draft.id,version:draft.version},idempotencyKey:'synthetic-send-once-001'};
    await check('Gateway derives staff/team from SQL; queue calls real authorization and sends once to mock provider',async()=>{
      const r=await call(sentRequest);assert.equal(r.status,202);await settle(draft.id,'sent');assert.equal(deliveries.length,1);assert.equal(accessRequests.length,1);
      assert.equal(accessRequests[0].subjectId,staff.id);assert.equal(accessRequests[0].organizationId,org);assert.equal(accessRequests[0].teamId,team);
      const replay=await call(sentRequest);assert.equal(replay.status,202);assert.equal(replay.body.data.replayed,true);assert.equal(deliveries.length,1);
    });
    await webhook('synthetic-local-event-2');
    let held;
    await check('Revocation after enqueue is read from PostgreSQL before provider I/O',async()=>{
      let r=await call({action:'suggest',id:conversation.id});assert.equal(r.status,201);held=r.body.data;
      r=await call({action:'approve',reply:{id:held.id,version:held.version}});assert.equal(r.status,200);held=r.body.data;
      gate=deferred();
      try{
        r=await call({action:'send',reply:{id:held.id,version:held.version},idempotencyKey:'synthetic-held-0001'});assert.equal(r.status,202);
        await db.query('UPDATE public.social_team_members SET is_active=false WHERE team_id=$1 AND user_id=$2',[team,staff.id]);
      }finally{gate.resolve();gate=null;}
      await settle(held.id,'revoked');assert.equal(deliveries.length,1);
      assert.equal((await call({action:'list',filters:{}})).status,403);
    });
    await check('Revoked queue and single-send receipt survive actual bot restart',async()=>{
      await bot.close();bot=null;await openBot();assert.equal(await bot.erp.nextAuthorizedJob(),null);assert.equal(bot.erp.store.reply(held.id).state,'revoked');assert.equal(bot.erp.store.reply(draft.id).state,'sent');assert.equal(deliveries.length,1);
      const logs=bot.erp.store.db.prepare('SELECT metadata FROM erp_audit').all();assert.ok(!JSON.stringify(logs).includes(recheckToken));
    });
    await check('Global permission removal defeats active JWT and service decision; database failure is unknown',async()=>{
      await db.query('UPDATE public.social_team_members SET is_active=true WHERE team_id=$1 AND user_id=$2',[team,staff.id]);
      await db.query("DELETE FROM public.role_permissions WHERE role_id=$1 AND permission_code='social_inbox.reply_send'",[role]);
      const requestId=randomUUID(),body={requestId,subjectId:staff.id,organizationId:org,teamId:team,pageId:externalPage,permission:'social_inbox.reply_send'};
      const r=await fetch(bridgeOrigin+'/recheck',{method:'POST',headers:{Authorization:'Bearer '+recheckToken,'Content-Type':'application/json','X-Momo-Request-Id':requestId},body:JSON.stringify(body)});assert.equal(r.status,200);const decision=await r.json();assert.ok(!decision.permissions.includes('social_inbox.reply_send'));assert.equal(deliveries.length,1);
      const anon=await fetch(bridgeOrigin+'/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(anon.status,401);
      await db.query('REVOKE EXECUTE ON FUNCTION public.get_social_access_recheck(uuid,uuid,text,uuid) FROM service_role');
      const unavailable=await fetch(bridgeOrigin+'/recheck',{method:'POST',headers:{Authorization:'Bearer '+recheckToken,'Content-Type':'application/json','X-Momo-Request-Id':requestId},body:JSON.stringify(body)});assert.equal(unavailable.status,503);
    });
    report.status='PASS';report.counts={pass:report.checks.length,fail:0};report.mockProviderCalls=deliveries.length;
  }catch(error){report.status='FAIL';report.failedStage=stage;report.failure={code:error.code??error.name,message:safe(error.message)};report.counts={pass:report.checks.length,fail:1};}
  finally{
    const failures=[];const clean=async(name,fn)=>{try{await fn();}catch{failures.push(name);}};
    if(gate)gate.resolve();await clean('bot',async()=>bot?.close());await clean('db',async()=>db?.end());
    await clean('bridge',async()=>{if(server?.listening){server.closeAllConnections();await new Promise((yes,no)=>server.close(e=>e?no(e):yes()));}});
    await clean('ownedStack',async()=>stack?.stop());
    await clean('syntheticSQLite',async()=>{if(dataDir&&resolve(dataDir).startsWith(resolve(tmpdir())+'\\momo-social-joint-'))await rm(dataDir,{recursive:true,force:true});else if(dataDir)throw new Error('Unsafe cleanup path');});
    report.cleanup={ownedStackStopped:!!stack&&!failures.includes('ownedStack'),failures};if(failures.length)report.status='FAIL';
    await mkdir(resolve(reportPath,'..'),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  }
  return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--docker-bin','--bot-root'].includes(args[i])||!args[i+1])throw new Error('Use --docker-bin <local Docker> --bot-root <dedicated bot checkout>');options[args[i]==='--docker-bin'?'dockerBin':'botRoot']=args[i+1];}
  const report=await rehearseSocialDelivery(options);console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;
}
