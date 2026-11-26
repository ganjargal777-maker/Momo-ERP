// Opt-in compatibility suite for a newly allocated synthetic PostgreSQL 15 DB.
// Never reads .env, DATABASE_URL, hosted credentials, or production fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const erpRoot=process.env.MOMO_ERP_TEST_ROOT||join(dirname(fileURLToPath(import.meta.url)),'..');
const {Client}=createRequire(join(erpRoot,'package.json'))('pg');
const connectionString=process.env.LOCAL_DB_URL;
let target;
try { if(connectionString) target=new URL(connectionString); } catch { /* Fail closed below. */ }
const local=Boolean(target&&['postgres:','postgresql:'].includes(target.protocol)
  &&['localhost','127.0.0.1','::1','[::1]'].includes(target.hostname)
  &&!target.search&&!target.hash);
const isolated=process.env.MOMO_PHASE4_ISOLATED_DB==='1';
const skip=!local?'LOCAL_DB_URL must be an explicit loopback PostgreSQL URL without query overrides'
  :!isolated?'MOMO_PHASE4_ISOLATED_DB=1 must confirm a newly allocated synthetic database':false;
const ids=Object.fromEntries(['org','admin','restricted','agent1','agent2','adminRole','restrictedRole'].map(name=>[name,randomUUID()]));
const users=[ids.admin,ids.restricted,ids.agent1,ids.agent2];
const fixtureSlug='phase4-'+ids.org;
const client=local&&isolated?new Client({connectionString,connectionTimeoutMillis:5000,statement_timeout:10000}):null;
const connect=async()=>{const c=new Client({connectionString,connectionTimeoutMillis:5000,statement_timeout:10000});await c.connect();return c;};
async function asUser(userId,sql,values=[]){
  const c=await connect();
  try{
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[userId,JSON.stringify({sub:userId,role:'authenticated'})]);
    await c.query('SET LOCAL ROLE authenticated');
    const result=await c.query(sql,values);
    await c.query('COMMIT');return result;
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{await c.end();}
}
async function rpc(user,name,params){
  assert.match(name,/^[a-z_]+$/u);
  const result=await asUser(user,'SELECT to_jsonb(public.'+name+'('+params.map((_,i)=>'$'+(i+1)).join(',')+')) AS value',params);
  return result.rows[0].value;
}
async function cleanup(){
  await client.query('BEGIN');
  try{
    // Knowledge can restrict deletion of its approving profile. Remove owned
    // child rows and audit before auth/profiles and the organization.
    await client.query('DELETE FROM public.social_knowledge_entries WHERE organization_id=$1',[ids.org]);
    await client.query('DELETE FROM public.ai_threads WHERE organization_id=$1',[ids.org]);
    await client.query('DELETE FROM public.social_saved_replies WHERE organization_id=$1',[ids.org]);
    await client.query('DELETE FROM public.facebook_pages WHERE organization_id=$1',[ids.org]);
    await client.query('DELETE FROM public.social_teams WHERE organization_id=$1',[ids.org]);
    await client.query('DELETE FROM public.audit_logs WHERE organization_id=$1 OR actor_id=ANY($2::uuid[])',[ids.org,users]);
    await client.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])',[users]);
    await client.query('DELETE FROM public.organizations WHERE id=$1',[ids.org]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
}

test('Phase 4 real local database RLS and concurrency',{skip,timeout:60000},async t=>{
  let connected=false;
  try{
    await client.connect();connected=true;
    const version=Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
    assert.ok(version>=150000&&version<160000,'This suite must use PostgreSQL 15');
    await client.query('INSERT INTO public.organizations(id,name,slug) VALUES($1,$2,$3)',[ids.org,'Phase 4 Synthetic',fixtureSlug]);
    for(const [name,id]of Object.entries({admin:ids.admin,restricted:ids.restricted,agent1:ids.agent1,agent2:ids.agent2})){
      // Common fields exist in both GoTrue auth.users and the isolated harness
      // bootstrap; no real password or user profile is required.
      await client.query('INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES($1,$2,now(),$3,$4)',[
        id,'phase4-'+name+'-'+ids.org+'@example.invalid',JSON.stringify({organization_id:ids.org}),'{}'
      ]);
    }
    await client.query("UPDATE public.profiles SET organization_id=$1,status='active' WHERE id=ANY($2::uuid[])",[ids.org,users]);
    await client.query("INSERT INTO public.roles(id,organization_id,name) VALUES($1,$3,'Phase4 Synthetic Admin'),($2,$3,'Phase4 Synthetic Restricted')",[ids.adminRole,ids.restrictedRole,ids.org]);
    // Team RPC validates another user's active profile through its normal RLS;
    // this synthetic admin needs users.read, matching the real Admin role.
    await client.query("INSERT INTO public.role_permissions(role_id,permission_code) SELECT $1,code FROM public.permissions WHERE code LIKE 'social_%' OR code IN('pages.manage','pages.read','users.read','ai_assistant.use','ai_suggestions.create','products.read','inventory.read')",[ids.adminRole]);
    await client.query("INSERT INTO public.role_permissions(role_id,permission_code) VALUES($1,'social_inbox.read')",[ids.restrictedRole]);
    await client.query('INSERT INTO public.user_roles(user_id,role_id) VALUES($1,$5),($2,$5),($3,$5),($4,$6)',[ids.admin,ids.agent1,ids.agent2,ids.restricted,ids.adminRole,ids.restrictedRole]);

    let primaryTeam,backupTeam,page;
    await t.test('Page and Team CRUD RPCs execute once and return persisted JSON rows',async()=>{
      primaryTeam=await rpc(ids.admin,'manage_social_team',[null,'Phase4 Primary',ids.agent1,8,true,[ids.agent1]]);
      backupTeam=await rpc(ids.admin,'manage_social_team',[null,'Phase4 Backup',ids.agent2,8,true,[ids.agent2]]);
      page=await rpc(ids.admin,'manage_social_page',[null,'Phase4 Page','987654321',true,'connected',primaryTeam.id,backupTeam.id]);
      assert.ok(primaryTeam.id);assert.ok(backupTeam.id);assert.ok(page.id);
      const registry=await rpc(ids.admin,'list_social_page_registry',[]);
      assert.equal(registry.filter(item=>item.id===page.id).length,1);
      assert.equal(registry.find(item=>item.id===page.id).organization_id,ids.org);
    });
    await t.test('four concurrent calls produce exactly one backup assignment, workload and audit',async()=>{
      assert.ok(page?.id,'Page setup must succeed');
      await client.query("INSERT INTO public.social_agent_presence(user_id,organization_id,status) VALUES($1,$3,'offline'),($2,$3,'online')",[ids.agent1,ids.agent2,ids.org]);
      const rows=await Promise.all(Array.from({length:4},()=>rpc(ids.admin,'smart_assign_social_conversation',[page.id,'phase4-concurrent'])));
      assert.equal(new Set(rows.map(row=>row.id)).size,1);
      assert.ok(rows.every(row=>row.assignee_id===ids.agent2&&row.team_id===backupTeam.id));
      assert.equal(Number((await client.query("SELECT count(*) n FROM public.social_conversation_assignments WHERE page_id=$1 AND external_conversation_id='phase4-concurrent'",[page.id])).rows[0].n),1);
      assert.equal(Number((await client.query("SELECT count(*) n FROM public.audit_logs WHERE organization_id=$1 AND action='social.smart_assign'",[ids.org])).rows[0].n),1);
      assert.equal((await client.query('SELECT active_conversations FROM public.social_agent_presence WHERE user_id=$1',[ids.agent2])).rows[0].active_conversations,1);
    });
    await t.test('restricted staff cannot manage or read unrelated teams and assignments',async()=>{
      await assert.rejects(()=>rpc(ids.restricted,'manage_social_team',[null,'Forbidden',null,8,true,[]]),error=>error.code==='42501');
      for(const table of ['social_teams','social_conversation_assignments']){
        assert.equal((await asUser(ids.restricted,'SELECT id FROM public.'+table)).rowCount,0);
      }
    });
    await t.test('AI thread, message and private saved reply persist across connections with owner RLS',async()=>{
      const thread=(await asUser(ids.admin,'INSERT INTO public.ai_threads(organization_id,owner_id,title) VALUES($1,$2,$3) RETURNING id',[ids.org,ids.admin,'Synthetic persistence'])).rows[0];
      const message=(await asUser(ids.admin,"INSERT INTO public.ai_messages(organization_id,thread_id,role,content,created_by) VALUES($1,$2,'assistant',$3,$4) RETURNING id",[ids.org,thread.id,'verified synthetic answer',ids.admin])).rows[0];
      const reply=(await asUser(ids.admin,'INSERT INTO public.social_saved_replies(organization_id,owner_id,title,content) VALUES($1,$2,$3,$4) RETURNING id',[ids.org,ids.admin,'Synthetic saved','verified synthetic answer'])).rows[0];
      assert.equal((await asUser(ids.admin,'SELECT title FROM public.ai_threads WHERE id=$1',[thread.id])).rows[0].title,'Synthetic persistence');
      assert.equal((await asUser(ids.admin,'SELECT content FROM public.ai_messages WHERE id=$1',[message.id])).rows[0].content,'verified synthetic answer');
      assert.equal((await asUser(ids.admin,'SELECT content FROM public.social_saved_replies WHERE id=$1',[reply.id])).rows[0].content,'verified synthetic answer');
      for(const [table,id]of [['ai_threads',thread.id],['ai_messages',message.id],['social_saved_replies',reply.id]]){
        assert.equal((await asUser(ids.agent1,'SELECT id FROM public.'+table+' WHERE id=$1',[id])).rowCount,0);
      }
    });
  }finally{
    if(connected){
      try{
        await cleanup();
        await t.test('synthetic data cleanup removes children, audit, profiles, auth users and organization',async()=>{
          assert.equal(Number((await client.query('SELECT count(*) n FROM public.organizations WHERE id=$1',[ids.org])).rows[0].n),0);
          assert.equal(Number((await client.query('SELECT count(*) n FROM auth.users WHERE id=ANY($1::uuid[])',[users])).rows[0].n),0);
          assert.equal(Number((await client.query('SELECT count(*) n FROM public.profiles WHERE id=ANY($1::uuid[])',[users])).rows[0].n),0);
          assert.equal(Number((await client.query('SELECT count(*) n FROM public.audit_logs WHERE organization_id=$1 OR actor_id=ANY($2::uuid[])',[ids.org,users])).rows[0].n),0);
          for(const table of ['facebook_pages','social_teams','social_conversation_assignments','ai_threads','ai_messages','social_saved_replies']){
            assert.equal(Number((await client.query('SELECT count(*) n FROM public.'+table+' WHERE organization_id=$1',[ids.org])).rows[0].n),0);
          }
        });
      }finally{await client.end();}
    }
  }
});
