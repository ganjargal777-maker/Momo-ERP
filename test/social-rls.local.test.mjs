// Opt-in real PostgreSQL tests. Never use DATABASE_URL, Supabase credentials or
// an existing cluster: initdb always creates a new loopback-only temporary DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { startDockerPostgres15 } from '../scripts/local-social-docker.mjs';
import { proveSocialMigrationRollback, runPhase4ExtraChecks, observeOwnAssignedVisibility } from './helpers/social-phase4-checks.mjs';
import { proveCoreRollback, proveInvitationRollback, runCoreProductionChecks } from './helpers/core-production-checks.mjs';

const erpRoot=resolve(process.env.MOMO_ERP_TEST_ROOT||join(dirname(fileURLToPath(import.meta.url)),'..'));
const pgBin=process.env.MOMO_LOCAL_PG_BIN;
const dockerBin=process.env.MOMO_LOCAL_DOCKER_BIN;
const alignmentSql=process.env.MOMO_ALIGNMENT_SQL;
const testTmpRoot=resolve(process.env.MOMO_LOCAL_PG_TMP||tmpdir());
const require=createRequire(join(erpRoot,'package.json'));
const {Client}=require('pg');
const uid=number=>'00000000-0000-4000-8000-'+String(number).padStart(12,'0');
const ORG=uid(1), FOREIGN_ORG=uid(2), ADMIN=uid(11), PRIMARY=uid(12), BACKUP=uid(13), BACKUP2=uid(14), OUTSIDER=uid(15), FOREIGN=uid(16), MANAGER=uid(17);

async function freePort(){const s=net.createServer();await new Promise((done,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',done);});const port=s.address().port;await new Promise(done=>s.close(done));return port;}

test('isolated PostgreSQL: RLS, primary/backup routing and concurrent assignment',{skip:!pgBin&&!dockerBin,timeout:240000},async t=>{
  if(!dockerBin)for(const executable of ['initdb','pg_ctl','postgres'])assert.ok(existsSync(join(pgBin,executable+(process.platform==='win32'?'.exe':''))),'Missing local Postgres binary');
  const directory=await mkdtemp(join(testTmpRoot,'momo-erp-rls-'));
  assert.equal(dirname(resolve(directory)),testTmpRoot);assert.ok(basename(directory).startsWith('momo-erp-rls-'));
  const data=join(directory,'cluster'),passwordFile=join(directory,'fixture-password');
  let password=randomBytes(24).toString('hex');
  await writeFile(passwordFile,password,{mode:0o600});
  let port=await freePort(),started=false,admin,dockerCluster,baselineCatalog,serverMajor;
  const evidence={syntheticOnly:true,remoteChanges:false,migrations:[],checks:{}};
  // Background postgres must not inherit Node's pipes on Windows, or pg_ctl
  // can appear to hang after the database is already ready.
  const execute=(name,args)=>{const result=spawnSync(join(pgBin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:'ignore',windowsHide:true,timeout:30000});if(result.error||result.status!==0)throw new Error(name+' failed: '+String(result.error?.message||result.status).slice(0,300));};
  const connect=async(database='postgres')=>{const c=new Client({host:'127.0.0.1',port,database,user:'momo_local',password,ssl:false,connectionTimeoutMillis:5000,statement_timeout:12000});await c.connect();return c;};
  const actor=async(user,fn)=>{const c=await connect();try{await c.query('BEGIN');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[user,JSON.stringify({sub:user,role:'authenticated'})]);await c.query('SET LOCAL ROLE authenticated');const result=await fn(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{await c.end();}};
  const rpc=(user,name,params)=>actor(user,c=>c.query('SELECT to_jsonb(public.'+name+'('+params.map((_,i)=>'$'+(i+1)).join(',')+')) AS value',params).then(r=>r.rows[0].value));
  const rejected=async action=>{await assert.rejects(action,error=>['42501','23514','P0002','22023'].includes(error.code));};
  const socialCatalog=async client=>({
    columns:(await client.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND (table_name LIKE 'social_%' OR table_name LIKE 'ai_%' OR table_name IN('feature_flags','facebook_pages')) ORDER BY table_name,ordinal_position")).rows,
    policies:(await client.query("SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows,
    functions:(await client.query("SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE '%social%' OR p.proname='provision_default_roles') ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)")).rows,
    permissions:(await client.query("SELECT code,module,description FROM public.permissions ORDER BY code")).rows,
    privateSchema:(await client.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='momo_social_private') AS present")).rows[0].present,
  });
  try{
    if(dockerBin){dockerCluster=await startDockerPostgres15({dockerBin,dockerHost:process.env.MOMO_LOCAL_DOCKER_HOST});port=dockerCluster.port;password=dockerCluster.password;}
    else{execute('initdb',['-D',data,'-U','momo_local','--auth=scram-sha-256','--pwfile='+passwordFile,'--no-locale','--encoding=UTF8']);
      started=true;execute('pg_ctl',['-D',data,'-l',join(directory,'postgres.log'),'-w','-t','20','-o','-h 127.0.0.1 -p '+port+' -F -c max_connections=30 -c log_statement=none','start']);}
    admin=await connect();
    const serverVersion=(await admin.query('SHOW server_version')).rows[0].server_version;
    const serverVersionNumber=Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num);serverMajor=Math.floor(serverVersionNumber/10000);
    if(dockerBin)assert.equal(serverMajor,15,'Docker validation must use PostgreSQL15');
    evidence.postgres={serverVersion,serverVersionNumber,host:'127.0.0.1',port,mode:dockerBin?'docker':'native',...(dockerCluster?{imageTag:dockerCluster.imageTag,imageId:dockerCluster.imageId,containerName:dockerCluster.containerName}: {})};
    t.diagnostic('Real database: PostgreSQL '+serverVersion+'; fresh '+(dockerBin?'Docker':'native')+' loopback-only cluster.');
    await admin.query('CREATE PUBLICATION supabase_realtime');
    await admin.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}'::jsonb,raw_app_meta_data jsonb DEFAULT '{}'::jsonb,email_confirmed_at timestamptz,created_at timestamptz DEFAULT now()); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated,anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;");
    const skip=new Set(['202609170003_bootstrap_momo_erp.sql','202609180001_verify_admin_auth_rls.sql','202609180002_set_admin_first_name.sql']);
    const migrationDirectory=join(erpRoot,'supabase','migrations');
    const files=(await readdir(migrationDirectory)).filter(f=>f.endsWith('.sql')&&!skip.has(f)&&!(alignmentSql&&f.endsWith('_social_contract_alignment.sql'))).sort();
    for(const file of files){
      if(file==='202611260001_momo_ai_social_phase2.sql')evidence.transactionRollback=await proveSocialMigrationRollback({t,admin,erpRoot});
      if(dockerCluster&&file.endsWith('_social_contract_alignment.sql')){baselineCatalog=await socialCatalog(admin);dockerCluster.execInContainer(['pg_dump','-h','/tmp','-U','momo_local','--format=custom','--file=/tmp/prealignment.dump','postgres']);}
      const sql=await readFile(join(migrationDirectory,file),'utf8');if(file.endsWith('_core_production_readiness.sql'))await proveCoreRollback({t,admin,sql});if(file.endsWith('_invitation_tenant_and_cleanup_guards.sql'))await proveInvitationRollback({t,admin,sql});try{await admin.query('BEGIN');await admin.query(sql);await admin.query('COMMIT');evidence.migrations.push({name:file,sha256:createHash('sha256').update(sql).digest('hex')});}catch(error){await admin.query('ROLLBACK');throw new Error('Local migration '+file+': '+error.message);}
    }
    if(alignmentSql)await admin.query(await readFile(alignmentSql,'utf8'));
    await admin.query('INSERT INTO public.organizations(id,name,slug) VALUES($1,$2,$3),($4,$5,$6)',[ORG,'Fixture A','fixture-a',FOREIGN_ORG,'Fixture B','fixture-b']);
    for(const [id,org] of [[ADMIN,ORG],[PRIMARY,ORG],[BACKUP,ORG],[BACKUP2,ORG],[OUTSIDER,ORG],[FOREIGN,FOREIGN_ORG],[MANAGER,ORG]])await admin.query('INSERT INTO auth.users(id,email,raw_app_meta_data,email_confirmed_at) VALUES($1,$2,$3,now())',[id,'fixture-'+id.slice(-4)+'@example.invalid',JSON.stringify({organization_id:org})]);
    for(const org of [ORG,FOREIGN_ORG])await admin.query('SELECT public.provision_default_roles($1)',[org]);
    for(const [user,org] of [[ADMIN,ORG],[FOREIGN,FOREIGN_ORG],[MANAGER,ORG]])await admin.query("INSERT INTO public.user_roles(user_id,role_id) SELECT $1,id FROM public.roles WHERE organization_id=$2 AND name='Admin'",[user,org]);
    const agentRole=randomUUID();await admin.query('INSERT INTO public.roles(id,organization_id,name) VALUES($1,$2,$3)',[agentRole,ORG,'Fixture social agent']);
    for(const permission of ['social_inbox.read','social_inbox.reply_draft','social_inbox.reply_send','social_inbox.resolve'])await admin.query('INSERT INTO public.role_permissions(role_id,permission_code) VALUES($1,$2)',[agentRole,permission]);
    for(const user of [PRIMARY,BACKUP,BACKUP2,OUTSIDER])await admin.query('INSERT INTO public.user_roles(user_id,role_id) VALUES($1,$2)',[user,agentRole]);

    const fixture=async()=>{
      await admin.query('TRUNCATE public.facebook_pages,public.social_teams,public.social_agent_presence CASCADE');
      const page=randomUUID(),otherPage=randomUUID(),foreignPage=randomUUID(),primaryTeam=randomUUID(),backupTeam=randomUUID(),foreignTeam=randomUUID(),unrelatedTeam=randomUUID();
      for(const [id,org,name] of [[page,ORG,'Page A'],[otherPage,ORG,'Page Other'],[foreignPage,FOREIGN_ORG,'Page Foreign']])await admin.query("INSERT INTO public.facebook_pages(id,organization_id,name,external_page_id,connection_status) VALUES($1,$2,$3,$4,'connected')",[id,org,name,String(BigInt('0x'+id.replaceAll('-','').slice(0,10)))]);
      for(const [id,org,name] of [[primaryTeam,ORG,'Primary'],[backupTeam,ORG,'Backup'],[foreignTeam,FOREIGN_ORG,'Foreign'],[unrelatedTeam,ORG,'Unrelated']])await admin.query('INSERT INTO public.social_teams(id,organization_id,name) VALUES($1,$2,$3)',[id,org,name]);
      for(const [team,user] of [[primaryTeam,PRIMARY],[backupTeam,BACKUP],[backupTeam,BACKUP2],[unrelatedTeam,OUTSIDER],[foreignTeam,FOREIGN]])await admin.query('INSERT INTO public.social_team_members(team_id,user_id) VALUES($1,$2)',[team,user]);
      for(const [p,team,type,priority] of [[page,primaryTeam,'primary',1],[page,backupTeam,'backup',1],[otherPage,unrelatedTeam,'primary',1],[foreignPage,foreignTeam,'primary',1]])await admin.query('INSERT INTO public.social_page_teams(page_id,team_id,assignment_type,priority) VALUES($1,$2,$3,$4)',[p,team,type,priority]);
      for(const [user,org,status] of [[PRIMARY,ORG,'offline'],[BACKUP,ORG,'online'],[BACKUP2,ORG,'online'],[OUTSIDER,ORG,'online'],[FOREIGN,FOREIGN_ORG,'online']])await admin.query('INSERT INTO public.social_agent_presence(user_id,organization_id,status) VALUES($1,$2,$3)',[user,org,status]);
      return {page,otherPage,foreignPage,primaryTeam,backupTeam,foreignTeam,unrelatedTeam};
    };
    await t.test('Page/context gates reject outsiders, cross-organization access and unknown actions',async()=>{const f=await fixture();assert.equal(await rpc(BACKUP,'can_access_social_page',[f.page,'reply']),true);assert.equal(await rpc(OUTSIDER,'can_access_social_page',[f.page,'read']),false);assert.equal(await rpc(FOREIGN,'can_access_social_page',[f.page,'read']),false);assert.equal(await rpc(ADMIN,'can_access_social_page',[f.page,'not-an-action']),false);await rejected(()=>rpc(OUTSIDER,'get_social_page_context',[f.page,'read']));const p=await rpc(BACKUP,'get_social_page_context',[f.page,'read']);assert.equal(p.id,f.page);assert.equal(p.organization_id,ORG);assert.equal(Object.hasOwn(p,'credential_reference'),false);});
    await t.test('explicit denies override membership, including read prerequisite for reply/assign',async()=>{const f=await fixture();await admin.query('INSERT INTO public.social_page_user_access(page_id,user_id,can_read,can_reply,can_assign) VALUES($1,$2,false,true,true)',[f.page,BACKUP]);for(const action of ['read','reply','assign'])assert.equal(await rpc(BACKUP,'can_access_social_page',[f.page,action]),false);await admin.query('UPDATE public.social_page_user_access SET can_read=true,can_reply=false WHERE page_id=$1 AND user_id=$2',[f.page,BACKUP]);assert.equal(await rpc(BACKUP,'can_access_social_page',[f.page,'read']),true);assert.equal(await rpc(BACKUP,'can_access_social_page',[f.page,'reply']),false);});
    await t.test('safe registry RPC serves inbox-only Pages without exposing raw registry columns',async()=>{const f=await fixture();const pages=await rpc(BACKUP,'list_social_page_registry',[]);assert.equal(pages.length,1);assert.equal(pages[0].id,f.page);assert.deepEqual(Object.keys(pages[0]).sort(),['id','organization_id','name','external_page_id','is_active','connection_status','created_at','updated_at'].sort());const raw=await actor(BACKUP,c=>c.query('SELECT credential_reference,settings FROM public.facebook_pages WHERE id=$1',[f.page]));assert.equal(raw.rowCount,0);const managerPages=await rpc(ADMIN,'list_social_page_registry',[]);assert.equal(managerPages.length,2);assert.ok(managerPages.every(p=>p.organization_id===ORG));});
    await t.test('Phase 4 Page/team/access CRUD RPC signatures remain usable with RLS',async()=>{const f=await fixture();const team=await rpc(ADMIN,'manage_social_team',[null,'Fixture managed team',BACKUP,8,true,[BACKUP]]);assert.ok(team.id);const page=await rpc(ADMIN,'manage_social_page',[null,'Fixture managed page','987654321',true,'connected',team.id,f.backupTeam]);assert.ok(page.id);const access=await rpc(ADMIN,'set_social_page_user_access',[page.id,BACKUP,true,true,false]);assert.equal(access.page_id,page.id);assert.equal(access.can_reply,true);assert.equal((await rpc(BACKUP,'get_social_page_context',[page.id,'reply'])).id,page.id);});
    await t.test('inactive Page and inactive team do not grant access',async()=>{const f=await fixture();await admin.query('UPDATE public.social_teams SET is_active=false WHERE id=$1',[f.backupTeam]);assert.equal(await rpc(BACKUP,'can_access_social_page',[f.page,'read']),false);await admin.query('UPDATE public.facebook_pages SET is_active=false WHERE id=$1',[f.page]);assert.equal(await rpc(ADMIN,'can_access_social_page',[f.page,'read']),false);});
    await t.test('empty/offline primary falls back to eligible backup without cross-team assignment',async()=>{const f=await fixture();const a=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-backup']);assert.equal(a.team_id,f.backupTeam);assert.ok([BACKUP,BACKUP2].includes(a.assignee_id));assert.notEqual(a.assignee_id,OUTSIDER);});
    await t.test('denied, stale, away and leave candidates are excluded',async()=>{const f=await fixture();await admin.query("UPDATE public.social_agent_presence SET status='online',updated_at=now()-interval '10 minutes' WHERE user_id=$1",[PRIMARY]);await admin.query('INSERT INTO public.social_page_user_access(page_id,user_id,can_read,can_reply,can_assign) VALUES($1,$2,true,false,false)',[f.page,BACKUP]);await admin.query("UPDATE public.social_agent_presence SET status='leave' WHERE user_id=$1",[BACKUP2]);const a=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-no-candidate']);assert.equal(a.assignee_id,null);});
    await t.test('candidate global inbox read revocation blocks automatic and manual assignment',async()=>{
      const f=await fixture(),noReadRole=randomUUID();
      await admin.query('INSERT INTO public.roles(id,organization_id,name) VALUES($1,$2,$3)',[noReadRole,ORG,'Fixture missing inbox read']);
      for(const permission of ['social_inbox.reply_draft','social_inbox.reply_send'])await admin.query('INSERT INTO public.role_permissions(role_id,permission_code) VALUES($1,$2)',[noReadRole,permission]);
      await admin.query('DELETE FROM public.user_roles WHERE user_id=$1 AND role_id=$2',[PRIMARY,agentRole]);
      await admin.query('INSERT INTO public.user_roles(user_id,role_id) VALUES($1,$2)',[PRIMARY,noReadRole]);
      try{
        await admin.query("UPDATE public.social_agent_presence SET status='online',updated_at=now() WHERE user_id=$1",[PRIMARY]);
        assert.equal(await rpc(PRIMARY,'can_access_social_page',[f.page,'read']),true,'Page membership alone remains insufficient');
        assert.equal(await rpc(PRIMARY,'has_permission',['social_inbox.read']),false);
        const assignment=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-global-read-revoked']);
        assert.equal(assignment.team_id,f.backupTeam);
        assert.ok([BACKUP,BACKUP2].includes(assignment.assignee_id));
        await rejected(()=>rpc(ADMIN,'update_social_conversation',[assignment.id,assignment.version,'transfer',f.primaryTeam,PRIMARY]));
      }finally{
        await admin.query('DELETE FROM public.user_roles WHERE user_id=$1 AND role_id=$2',[PRIMARY,noReadRole]);
        await admin.query('INSERT INTO public.user_roles(user_id,role_id) VALUES($1,$2)',[PRIMARY,agentRole]);
        await admin.query('DELETE FROM public.roles WHERE id=$1',[noReadRole]);
      }
    });
    const withPermissions=async(user,permissions,operation)=>{
      const role=randomUUID(),previous=(await admin.query('SELECT role_id FROM public.user_roles WHERE user_id=$1',[user])).rows.map(row=>row.role_id);
      await admin.query('INSERT INTO public.roles(id,organization_id,name) VALUES($1,$2,$3)',[role,ORG,'Fixture restricted caller '+role]);
      for(const permission of permissions)await admin.query('INSERT INTO public.role_permissions(role_id,permission_code) VALUES($1,$2)',[role,permission]);
      await admin.query('DELETE FROM public.user_roles WHERE user_id=$1',[user]);
      await admin.query('INSERT INTO public.user_roles(user_id,role_id) VALUES($1,$2)',[user,role]);
      try{return await operation();}finally{
        await admin.query('DELETE FROM public.user_roles WHERE user_id=$1',[user]);
        for(const oldRole of previous)await admin.query('INSERT INTO public.user_roles(user_id,role_id) VALUES($1,$2)',[user,oldRole]);
        await admin.query('DELETE FROM public.roles WHERE id=$1',[role]);
      }
    };
    await t.test('knowledge and saved-reply write grants never reveal another Page through SELECT',async()=>{
      const f=await fixture();
      for(const page of [f.page,f.otherPage]){
        await admin.query("INSERT INTO public.social_knowledge_entries(organization_id,page_id,title,answer,approved_by) VALUES($1,$2,'Fixture knowledge','Fixture answer',$3)",[ORG,page,ADMIN]);
        await admin.query("INSERT INTO public.social_saved_replies(organization_id,page_id,owner_id,title,content,is_shared) VALUES($1,$2,$3,'Fixture saved','Fixture answer',true)",[ORG,page,OUTSIDER]);
      }
      await withPermissions(OUTSIDER,['social_inbox.read','ai_assistant.use','ai_suggestions.create'],async()=>{
        for(const table of ['social_knowledge_entries','social_saved_replies']){
          const rows=await actor(OUTSIDER,c=>c.query('SELECT page_id FROM public.'+table));
          assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].page_id,f.otherPage);
          const blocked=await actor(OUTSIDER,c=>c.query('UPDATE public.'+table+" SET title='Blocked change' WHERE page_id=$1 RETURNING page_id",[f.page]));
          assert.equal(blocked.rowCount,0);
        }
        await rejected(()=>actor(OUTSIDER,c=>c.query("INSERT INTO public.social_knowledge_entries(organization_id,page_id,title,answer,approved_by) VALUES($1,$2,'Denied','Denied',$3)",[ORG,f.page,OUTSIDER])));
        await rejected(()=>actor(OUTSIDER,c=>c.query("INSERT INTO public.social_saved_replies(organization_id,page_id,owner_id,title,content) VALUES($1,$2,$3,'Denied','Denied')",[ORG,f.page,OUTSIDER])));
      });
    });
    await t.test('caller global inbox read revocation blocks every assignment RPC before mutation',async()=>{
      const f=await fixture(),assignment=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-caller-read']);
      await admin.query('INSERT INTO public.social_page_user_access(page_id,user_id,can_read,can_reply,can_assign) VALUES($1,$2,true,true,true)',[f.page,MANAGER]);
      await withPermissions(MANAGER,['social_inbox.assign','social_inbox.reassign','social_inbox.resolve','social_inbox.reply_draft','social_inbox.reply_send'],async()=>{
        await rejected(()=>rpc(MANAGER,'smart_assign_social_conversation',[f.page,'fixture-caller-read-denied']));
        await rejected(()=>rpc(MANAGER,'claim_social_conversation',[assignment.id,assignment.version]));
        for(const action of ['assign','transfer','resolve'])await rejected(()=>rpc(MANAGER,'update_social_conversation',[assignment.id,assignment.version,action,f.backupTeam,BACKUP2]));
        const row=(await admin.query('SELECT version,assignee_id,status FROM public.social_conversation_assignments WHERE id=$1',[assignment.id])).rows[0];
        assert.equal(row.version,assignment.version);assert.equal(row.assignee_id,assignment.assignee_id);assert.equal(row.status,'open');
        assert.equal((await admin.query('SELECT count(*)::int n FROM public.social_conversation_assignments WHERE page_id=$1',[f.page])).rows[0].n,1);
      });
    });
    await t.test('assign-only caller cannot bypass reassign permission by using assign on existing work',async()=>{
      const f=await fixture(),assignment=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-no-transfer-bypass']);
      await admin.query('INSERT INTO public.social_page_user_access(page_id,user_id,can_read,can_reply,can_assign) VALUES($1,$2,true,false,true)',[f.page,MANAGER]);
      const otherAgent=assignment.assignee_id===BACKUP?BACKUP2:BACKUP;
      await withPermissions(MANAGER,['social_inbox.read','social_inbox.assign'],async()=>{
        await rejected(()=>rpc(MANAGER,'update_social_conversation',[assignment.id,assignment.version,'assign',f.backupTeam,otherAgent]));
        await rejected(()=>rpc(MANAGER,'update_social_conversation',[assignment.id,assignment.version,'transfer',f.backupTeam,otherAgent]));
        const same=await rpc(MANAGER,'update_social_conversation',[assignment.id,assignment.version,'assign',assignment.team_id,assignment.assignee_id]);
        assert.equal(same.version,assignment.version);assert.equal(same.assignee_id,assignment.assignee_id);
      });
      const transferred=await rpc(ADMIN,'update_social_conversation',[assignment.id,assignment.version,'transfer',f.backupTeam,otherAgent]);
      assert.equal(transferred.assignee_id,otherAgent);
      assert.equal(transferred.version,assignment.version+1);
    });
    await t.test('concurrent duplicate assignment creates exactly one row and one workload increment',async()=>{const f=await fixture();const rows=await Promise.all(Array.from({length:8},()=>rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-concurrent-same'])));assert.equal(new Set(rows.map(x=>x.id)).size,1);const count=await admin.query('SELECT count(*)::int n FROM public.social_conversation_assignments WHERE page_id=$1',[f.page]);assert.equal(count.rows[0].n,1);const workload=await admin.query('SELECT sum(active_conversations)::int n FROM public.social_agent_presence');assert.equal(workload.rows[0].n,1);});
    await t.test('concurrent different conversations retain consistent workload and unique rows',async()=>{const f=await fixture();const rows=await Promise.all(Array.from({length:6},(_,i)=>rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-concurrent-'+i])));assert.equal(new Set(rows.map(x=>x.id)).size,6);const assigned=rows.filter(x=>x.assignee_id);const workload=await admin.query('SELECT sum(active_conversations)::int n FROM public.social_agent_presence');assert.equal(workload.rows[0].n,assigned.length);assert.ok(assigned.length>0);for(const a of assigned)assert.equal(a.team_id,f.backupTeam);});
    await t.test('same external conversation on different Pages remains separate',async()=>{const f=await fixture();const a=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-shared-id']);const b=await rpc(ADMIN,'smart_assign_social_conversation',[f.otherPage,'fixture-shared-id']);assert.notEqual(a.id,b.id);assert.equal(a.page_id,f.page);assert.equal(b.page_id,f.otherPage);});
    await t.test('foreign Page assignment rows remain invisible to unrelated users',async()=>{const f=await fixture();const a=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-rls']);for(const user of [OUTSIDER,FOREIGN]){const result=await actor(user,c=>c.query('SELECT id FROM public.social_conversation_assignments WHERE id=$1',[a.id]));assert.equal(result.rowCount,0);}});
    await t.test('direct assignment writes and workload counter tampering are rejected',async()=>{const f=await fixture();const a=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-raw-write']);await rejected(()=>actor(ADMIN,c=>c.query('UPDATE public.social_conversation_assignments SET assignee_id=$1 WHERE id=$2',[OUTSIDER,a.id])));await rejected(()=>actor(BACKUP,c=>c.query('UPDATE public.social_agent_presence SET active_conversations=999 WHERE user_id=$1',[BACKUP])));});
    await t.test('self presence heartbeat works without users.read and cannot forge freshness',async()=>{await fixture();const row=await actor(BACKUP,c=>c.query("UPDATE public.social_agent_presence SET status='online',updated_at=now()+interval '1 day' WHERE user_id=$1 RETURNING updated_at",[BACKUP]));assert.equal(row.rowCount,1);assert.ok(Math.abs(Date.now()-new Date(row.rows[0].updated_at).valueOf())<10000);const upsert=await actor(BACKUP,c=>c.query("INSERT INTO public.social_agent_presence(user_id,organization_id,status,updated_at) VALUES($1,$2,'away',now()) ON CONFLICT(user_id) DO UPDATE SET user_id=excluded.user_id,organization_id=excluded.organization_id,status=excluded.status,updated_at=excluded.updated_at RETURNING status,active_conversations",[BACKUP,ORG]));assert.equal(upsert.rows[0].status,'away');assert.equal(upsert.rows[0].active_conversations,0);});
    await t.test('cross-organization link writes are rejected for team managers',async()=>{const f=await fixture();await rejected(()=>actor(ADMIN,c=>c.query("INSERT INTO public.social_page_teams(page_id,team_id,assignment_type) VALUES($1,$2,'backup')",[f.page,f.foreignTeam])));await rejected(()=>actor(ADMIN,c=>c.query('INSERT INTO public.social_team_members(team_id,user_id) VALUES($1,$2)',[f.primaryTeam,FOREIGN])));await rejected(()=>actor(ADMIN,c=>c.query('INSERT INTO public.social_page_user_access(page_id,user_id) VALUES($1,$2)',[f.page,FOREIGN])));});
    await t.test('assignment/transfer cannot target unrelated Page teams or denied candidates',async()=>{const f=await fixture();const a=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-transfer']);await rejected(()=>rpc(ADMIN,'update_social_conversation',[a.id,a.version,'transfer',f.unrelatedTeam,OUTSIDER]));await admin.query('INSERT INTO public.social_page_user_access(page_id,user_id,can_read,can_reply,can_assign) VALUES($1,$2,true,false,false)',[f.page,PRIMARY]);await rejected(()=>rpc(ADMIN,'update_social_conversation',[a.id,a.version,'transfer',f.primaryTeam,PRIMARY]));});
    await t.test('read-only Page users cannot acquire a blocking claim lock',async()=>{const f=await fixture();const a=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-reader-claim']);await admin.query('INSERT INTO public.social_page_user_access(page_id,user_id,can_read,can_reply,can_assign) VALUES($1,$2,true,false,false)',[f.page,BACKUP]);await rejected(()=>rpc(BACKUP,'claim_social_conversation',[a.id,a.version]));});
    await t.test('simultaneous claims accept one version and reject the stale contender',async()=>{const f=await fixture();const a=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-claim']);const results=await Promise.allSettled([rpc(ADMIN,'claim_social_conversation',[a.id,a.version]),rpc(MANAGER,'claim_social_conversation',[a.id,a.version])]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'40001');});
    await t.test('resolve is a no-op on current resolved version and cannot double-decrement',async()=>{const f=await fixture();const a=await rpc(ADMIN,'smart_assign_social_conversation',[f.page,'fixture-resolve']);const resolved=await rpc(ADMIN,'update_social_conversation',[a.id,a.version,'resolve',null,null]);assert.equal(resolved.status,'resolved');const again=await rpc(ADMIN,'update_social_conversation',[a.id,resolved.version,'resolve',null,null]);assert.equal(again.version,resolved.version);const result=await admin.query('SELECT sum(active_conversations)::int n FROM public.social_agent_presence');assert.equal(result.rows[0].n,0);await assert.rejects(()=>rpc(ADMIN,'update_social_conversation',[a.id,a.version,'resolve',null,null]),e=>e.code==='40001');});
    await t.test('Page capacity applies to distinct linked Pages including concurrent inserts',async()=>{const f=await fixture();await admin.query('UPDATE public.social_teams SET page_capacity=2 WHERE id=$1',[f.backupTeam]);const third=randomUUID();await admin.query("INSERT INTO public.facebook_pages(id,organization_id,name,external_page_id) VALUES($1,$2,'Page third','fixture-third')",[third,ORG]);const results=await Promise.allSettled([actor(ADMIN,c=>c.query("INSERT INTO public.social_page_teams(page_id,team_id,assignment_type) VALUES($1,$2,'backup')",[f.otherPage,f.backupTeam])),actor(ADMIN,c=>c.query("INSERT INTO public.social_page_teams(page_id,team_id,assignment_type) VALUES($1,$2,'backup')",[third,f.backupTeam]))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const count=await admin.query('SELECT count(distinct page_id)::int n FROM public.social_page_teams WHERE team_id=$1',[f.backupTeam]);assert.equal(count.rows[0].n,2);});
    await t.test('public wrappers are invoker and private subject evaluators are not callable by authenticated',async()=>{const result=await admin.query("SELECT proname,prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('can_access_social_page','get_social_page_context','smart_assign_social_conversation','update_social_conversation','claim_social_conversation')");assert.equal(result.rowCount,5);assert.ok(result.rows.every(r=>r.prosecdef===false));await rejected(()=>actor(BACKUP,c=>c.query('SELECT momo_social_private.subject_page_access($1,$2,$3)',[randomUUID(),ADMIN,'read'])));});
    await t.test('feature flags remain off and operations have actor-scoped audit evidence',async()=>{assert.equal((await admin.query('SELECT count(*)::int n FROM public.feature_flags WHERE enabled')).rows[0].n,0);const audits=await admin.query("SELECT count(*)::int n FROM public.audit_logs WHERE action LIKE 'social.%' AND actor_id IS NOT NULL");assert.ok(audits.rows[0].n>0);});
    const ids={ORG,FOREIGN_ORG,ADMIN,PRIMARY,BACKUP,BACKUP2,OUTSIDER,FOREIGN,MANAGER};
    await runPhase4ExtraChecks({t,admin,actor,rpc,fixture,ids,appliedMigrations:evidence.migrations.map(item=>item.name)});
    const withRestoredDatabase=dockerCluster?async check=>{
      const name='momo_core_restore_'+randomUUID().replaceAll('-','');let restored;
      try{
        dockerCluster.execInContainer(['pg_dump','-h','/tmp','-U','momo_local','--format=custom','--file=/tmp/core-readiness.dump','postgres']);
        dockerCluster.execInContainer(['createdb','-h','/tmp','-U','momo_local',name]);
        dockerCluster.execInContainer(['pg_restore','-h','/tmp','-U','momo_local','--exit-on-error','--dbname',name,'/tmp/core-readiness.dump']);
        restored=await connect(name);await check(restored);evidence.coreBackupRestore={status:'PASS',freshDatabase:true,syntheticDataAndReceiptsPreserved:true};
      }finally{if(restored)await restored.end();await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');}
    }:undefined;
    await runCoreProductionChecks({t,admin,actor,rpc,withRestoredDatabase});evidence.coreProduction={status:'PASS',realPostgres:true,syntheticOnly:true};
    const observation=await observeOwnAssignedVisibility({admin,actor,rpc,fixture,ids});
    evidence.ownAssignedOnly={...observation,status:'SKIPPED',implemented:observation.status==='PASS',observedStrictPolicyStatus:observation.status,reason:'User selected validation of existing Page-wide policy; do not introduce assignee-only restrictions.'};
    await t.test('current Page-wide policy is observed without inventing assignee-only protection',()=>{assert.equal(observation.status,'FAIL');assert.equal(observation.differentAuthorizedPageMemberCanRead,true);});
    await t.test('own-assigned-only restriction is outside the existing authorized contract',{skip:'Not implemented; user requested reporting this gap without changing policy'},()=>{});
    if(dockerCluster&&baselineCatalog){
      await t.test('pre-alignment backup restores committed migration baseline into a new PostgreSQL15 database',async()=>{
        const restoreDatabase='momo_restore_'+randomUUID().replaceAll('-','');let restored;
        try{
          assert.equal((await socialCatalog(admin)).privateSchema,true,'Source alignment migration must have committed');
          dockerCluster.execInContainer(['createdb','-h','/tmp','-U','momo_local',restoreDatabase]);
          dockerCluster.execInContainer(['pg_restore','-h','/tmp','-U','momo_local','--exit-on-error','--dbname',restoreDatabase,'/tmp/prealignment.dump']);
          restored=await connect(restoreDatabase);assert.deepEqual(await socialCatalog(restored),baselineCatalog);
          evidence.backupRestore={status:'PASS',source:'pre-alignment committed phases001–004',target:'fresh database in owned synthetic container',catalogMatchesBaseline:true,inPlaceDownMigration:false};
        }finally{if(restored)await restored.end();await admin.query('DROP DATABASE IF EXISTS '+restoreDatabase+' WITH (FORCE)');}
      });
    }
    await t.test('legacy Phase4 compatibility suite runs against this newly allocated PostgreSQL15 database',{skip:serverMajor!==15},()=>{
      const target=new URL('postgresql://127.0.0.1:'+port+'/postgres');target.username='momo_local';target.password=password;
      const childEnvironment={...process.env,LOCAL_DB_URL:target.href,MOMO_PHASE4_ISOLATED_DB:'1',MOMO_ERP_TEST_ROOT:erpRoot};
      // A nested node --test process must not inherit the parent's internal
      // serialization context, otherwise successful tests produce no TAP text.
      for(const name of Object.keys(childEnvironment))if(name.startsWith('NODE_TEST_'))delete childEnvironment[name];
      const child=spawnSync(process.execPath,['--test','--test-reporter=tap',join(dirname(fileURLToPath(import.meta.url)),'social-db.integration.test.mjs')],{env:childEnvironment,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});
      assert.equal(child.error,undefined,'Legacy child process must start');assert.equal(child.status,0,String(child.stdout+'\n'+child.stderr).slice(-10000));
      assert.match(child.stdout,/pass 6/u);assert.match(child.stdout,/skipped 0/u);evidence.legacyCompatibility={status:'PASS',tests:6,skipped:0};
      t.diagnostic('Legacy Phase4 suite: 6 pass, 0 fail, 0 skip; separate synthetic organization cleaned.');
    });
  }finally{
    if(admin)await admin.end();
    if(dockerCluster){await dockerCluster.stop();evidence.cleanup={containerRemoved:true,networkRemoved:true,persistentVolumeUsed:false};}
    if(started&&existsSync(join(data,'postmaster.pid')))execute('pg_ctl',['-D',data,'-m','fast','-w','-t','20','stop']);
    assert.ok(!existsSync(join(data,'postmaster.pid')),'Local cluster must stop before deleting its fixture data');
    // Only remove this invocation's newly allocated, verified temporary folder.
    assert.equal(dirname(resolve(directory)),testTmpRoot);assert.ok(basename(directory).startsWith('momo-erp-rls-'));
    await rm(directory,{recursive:true,force:true});
    if(process.env.MOMO_PHASE4_EVIDENCE_PATH)await writeFile(process.env.MOMO_PHASE4_EVIDENCE_PATH,JSON.stringify(evidence,null,2)+'\n');
  }
});
