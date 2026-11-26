// Supplemental synthetic checks for the EXISTING isolated ERP PostgreSQL harness.
// This module never chooses a connection string or opens any network connection.
// Caller supplies already-created localhost-only clients and role-scoped helpers.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SOCIAL_PHASES = [
  '202611260001_momo_ai_social_phase2.sql',
  '202611260002_multi_page_team_management.sql',
  '202611260003_social_operations.sql',
  '202611260004_social_real_data.sql',
];
const SOCIAL_TABLES = [
  'feature_flags', 'ai_threads', 'ai_messages', 'social_teams',
  'social_team_members', 'social_page_teams', 'social_page_user_access',
  'social_agent_presence', 'social_conversation_assignments',
  'social_knowledge_entries', 'social_saved_replies',
];

function localClient(admin) {
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(admin.connectionParameters?.host),
    'These checks only accept a client whose configured host is loopback.');
}
async function existingSocialTables(admin) {
  return (await admin.query(
    "SELECT item,to_regclass('public.'||item)::text AS relation FROM unnest($1::text[]) AS x(item) ORDER BY item",
    [SOCIAL_TABLES],
  )).rows;
}
async function socialPermissionSnapshot(admin) {
  return (await admin.query("SELECT code,module,description FROM public.permissions WHERE code LIKE 'social_%' OR code LIKE 'ai_%' ORDER BY code")).rows;
}

/** Call after the core/RBAC migrations, immediately BEFORE social phase001. */
export async function proveSocialMigrationRollback({ t, admin, erpRoot }) {
  localClient(admin);
  const directory = join(erpRoot, 'supabase', 'migrations');
  const alignments = (await readdir(directory)).filter(name => name.endsWith('_social_contract_alignment.sql')).sort();
  const files = [...SOCIAL_PHASES, ...alignments];
  const statements = await Promise.all(files.map(name => readFile(join(directory, name), 'utf8')));
  const tablesBefore = await existingSocialTables(admin);
  assert.ok(tablesBefore.every(row => row.relation === null), 'Rollback probe requires a fresh pre-social database.');
  const permissionsBefore = await socialPermissionSnapshot(admin);
  const assertRestored = async () => {
    assert.deepEqual(await existingSocialTables(admin), tablesBefore);
    assert.deepEqual(await socialPermissionSnapshot(admin), permissionsBefore);
    assert.equal((await admin.query("SELECT to_regclass('public.momo_phase4_rollback_marker')::text AS relation")).rows[0].relation, null);
    assert.equal((await admin.query("SELECT to_regprocedure('public.manage_social_team(uuid,text,uuid,integer,boolean,uuid[])')::text AS function")).rows[0].function, null);
    assert.equal((await admin.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='momo_social_private') AS present")).rows[0].present, false);
  };
  await t.test('actual social001–004 and alignment DDL roll back atomically before commit', async () => {
    await admin.query('BEGIN');
    try {
      for (const sql of statements) await admin.query(sql);
      assert.ok((await existingSocialTables(admin)).every(row => row.relation !== null));
      await admin.query('CREATE TABLE public.momo_phase4_rollback_marker(id integer)');
    } finally { await admin.query('ROLLBACK'); }
    await assertRestored();
  });
  await t.test('deliberate failed migration transaction leaves no social DDL or permission residue', async () => {
    await admin.query('BEGIN');
    try {
      for (const sql of statements) await admin.query(sql);
      await admin.query('CREATE TABLE public.momo_phase4_rollback_marker(id integer)');
      await assert.rejects(() => admin.query('SELECT 1/0'), error => error.code === '22012');
    } finally { await admin.query('ROLLBACK'); }
    await assertRestored();
  });
  return { files, transactionalRollback: true, downMigrationImplemented: false };
}

export async function runPhase4ExtraChecks({ t, admin, actor, rpc, fixture, ids, appliedMigrations }) {
  localClient(admin);
  const { ORG, FOREIGN_ORG, ADMIN, PRIMARY, BACKUP, BACKUP2, OUTSIDER, FOREIGN, MANAGER } = ids;
  if (appliedMigrations) {
    await t.test('social migrations001–004 were applied once in dependency order', async () => {
      const indices = SOCIAL_PHASES.map(name => appliedMigrations.indexOf(name));
      assert.ok(indices.every(index => index >= 0));
      assert.ok(indices.every((index, i) => i === 0 || index > indices[i - 1]));
      for (const name of SOCIAL_PHASES) assert.equal(appliedMigrations.filter(value => value === name).length, 1);
      assert.ok((await existingSocialTables(admin)).every(row => row.relation !== null));
    });
  }

  await t.test('four concurrent assignment calls commit exactly one row, one audit and one workload increment', async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 4 }, () => rpc(ADMIN, 'smart_assign_social_conversation', [f.page, 'phase4-four-concurrent'])));
    const assignment = results[0];
    assert.equal(new Set(results.map(row => row.id)).size, 1);
    assert.equal(assignment.team_id, f.backupTeam);
    assert.ok([BACKUP, BACKUP2].includes(assignment.assignee_id));
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.social_conversation_assignments WHERE page_id=$1 AND external_conversation_id=$2', [f.page, 'phase4-four-concurrent'])).rows[0].n, 1);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.audit_logs WHERE organization_id=$1 AND action='social.smart_assign' AND entity_id=$2", [ORG, assignment.id])).rows[0].n, 1);
    assert.equal((await admin.query('SELECT sum(active_conversations)::int AS n FROM public.social_agent_presence WHERE organization_id=$1', [ORG])).rows[0].n, 1);
    const audit = (await admin.query("SELECT actor_id,organization_id,after_data FROM public.audit_logs WHERE action='social.smart_assign' AND entity_id=$1", [assignment.id])).rows[0];
    assert.equal(audit.actor_id, ADMIN);
    assert.equal(audit.organization_id, ORG);
    assert.equal(audit.after_data.page_id, f.page);
    assert.equal(audit.after_data.assignee_id, assignment.assignee_id);
    // Read after all committing clients close: data/audit survived connection boundaries.
    const reread = await actor(ADMIN, client => client.query('SELECT id FROM public.social_conversation_assignments WHERE id=$1', [assignment.id]));
    assert.equal(reread.rowCount, 1);
  });

  await t.test('Page and team CRUD updates/deletes preserve tenant references and authorized RPC behavior', async () => {
    const f = await fixture();
    const team = await rpc(ADMIN, 'manage_social_team', [null, 'Phase4 extra CRUD', BACKUP, 5, true, [BACKUP]]);
    const updatedTeam = await rpc(ADMIN, 'manage_social_team', [team.id, 'Phase4 extra CRUD updated', BACKUP2, 6, true, [BACKUP, BACKUP2]]);
    assert.equal(updatedTeam.name, 'Phase4 extra CRUD updated');
    assert.equal(updatedTeam.leader_id, BACKUP2);
    assert.equal(updatedTeam.page_capacity, 6);
    const page = await rpc(ADMIN, 'manage_social_page', [null, 'Phase4 extra Page', '9753108642', true, 'pending', team.id, f.backupTeam]);
    const updatedPage = await rpc(ADMIN, 'manage_social_page', [page.id, 'Phase4 extra Page updated', '9753108642', true, 'connected', team.id, f.backupTeam]);
    assert.equal(updatedPage.name, 'Phase4 extra Page updated');
    const before = (await admin.query('SELECT count(*)::int AS n FROM public.social_page_teams WHERE page_id=$1', [page.id])).rows[0].n;
    assert.equal(before, 2);
    const hidden = await actor(FOREIGN, client => client.query('SELECT id FROM public.facebook_pages WHERE id=$1', [page.id]));
    assert.equal(hidden.rowCount, 0);
    await actor(ADMIN, client => client.query('DELETE FROM public.facebook_pages WHERE id=$1', [page.id]));
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.social_page_teams WHERE page_id=$1', [page.id])).rows[0].n, 0);
    await actor(ADMIN, client => client.query('DELETE FROM public.social_teams WHERE id=$1', [team.id]));
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.social_team_members WHERE team_id=$1', [team.id])).rows[0].n, 0);
  });

  await t.test('AI thread, messages and private saved reply persist across connections with owner/org RLS', async () => {
    const f = await fixture();
    let threadId, savedId;
    try {
      const thread = await actor(ADMIN, client => client.query("INSERT INTO public.ai_threads(organization_id,owner_id,title) VALUES($1,$2,'Phase4 persisted AI') RETURNING id", [ORG, ADMIN]));
      threadId = thread.rows[0].id;
      for (const role of ['user', 'assistant']) await actor(ADMIN, client => client.query('INSERT INTO public.ai_messages(organization_id,thread_id,role,content,created_by,sources) VALUES($1,$2,$3,$4,$5,$6)', [ORG, threadId, role, 'Synthetic '+role+' content', ADMIN, JSON.stringify([{ type: 'fixture', verified: true }])]));
      const saved = await actor(ADMIN, client => client.query("INSERT INTO public.social_saved_replies(organization_id,page_id,owner_id,title,content,is_shared) VALUES($1,$2,$3,'Phase4 saved','Synthetic approved content',false) RETURNING id", [ORG, f.page, ADMIN]));
      savedId = saved.rows[0].id;
      await actor(ADMIN, client => client.query("UPDATE public.ai_threads SET title='Phase4 persisted AI updated' WHERE id=$1", [threadId]));
      const reread = await actor(ADMIN, async client => ({
        thread: (await client.query('SELECT title FROM public.ai_threads WHERE id=$1', [threadId])).rows,
        messages: (await client.query('SELECT role,content,sources FROM public.ai_messages WHERE thread_id=$1 ORDER BY created_at,id', [threadId])).rows,
        saved: (await client.query('SELECT title,content,is_shared FROM public.social_saved_replies WHERE id=$1', [savedId])).rows,
      }));
      assert.equal(reread.thread[0].title, 'Phase4 persisted AI updated');
      assert.equal(reread.messages.length, 2);
      assert.deepEqual(new Set(reread.messages.map(row => row.role)), new Set(['user', 'assistant']));
      assert.ok(reread.messages.every(row => row.content.startsWith('Synthetic ') && row.sources[0].verified === true));
      assert.equal(reread.saved[0].content, 'Synthetic approved content');
      assert.equal(reread.saved[0].is_shared, false);
      for (const user of [MANAGER, FOREIGN, OUTSIDER]) {
        const hidden = await actor(user, async client => ({
          threads: (await client.query('SELECT id FROM public.ai_threads WHERE id=$1', [threadId])).rowCount,
          messages: (await client.query('SELECT id FROM public.ai_messages WHERE thread_id=$1', [threadId])).rowCount,
          saved: (await client.query('SELECT id FROM public.social_saved_replies WHERE id=$1', [savedId])).rowCount,
        }));
        assert.deepEqual(hidden, { threads: 0, messages: 0, saved: 0 });
      }
      await assert.rejects(() => actor(MANAGER, client => client.query("INSERT INTO public.ai_messages(organization_id,thread_id,role,content,created_by) VALUES($1,$2,'assistant','Forbidden cross-owner',$3)", [ORG, threadId, MANAGER])), error => error.code === '42501');
      await assert.rejects(() => actor(ADMIN, client => client.query("INSERT INTO public.ai_threads(organization_id,owner_id,title) VALUES($1,$2,'Forbidden cross-org')", [FOREIGN_ORG, ADMIN])), error => error.code === '42501');
    } finally {
      if (savedId) await actor(ADMIN, client => client.query('DELETE FROM public.social_saved_replies WHERE id=$1', [savedId]));
      if (threadId) await actor(ADMIN, client => client.query('DELETE FROM public.ai_threads WHERE id=$1', [threadId]));
    }
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.ai_messages WHERE thread_id=$1', [threadId])).rows[0].n, 0);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.ai_threads WHERE id=$1', [threadId])).rows[0].n, 0);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.social_saved_replies WHERE id=$1', [savedId])).rows[0].n, 0);
  });

  await t.test('synthetic fixture cleanup removes FK dependents, audit, profiles and organization without residue', async () => {
    const org = randomUUID(), user = randomUUID(), team = randomUUID(), page = randomUUID();
    let thread;
    try {
      await admin.query("INSERT INTO public.organizations(id,name,slug) VALUES($1,'Phase4 cleanup fixture',$2)", [org, 'phase4-cleanup-'+org]);
      await admin.query('INSERT INTO auth.users(id,email,raw_app_meta_data,email_confirmed_at) VALUES($1,$2,$3,now())', [user, 'cleanup-'+user+'@example.invalid', JSON.stringify({ organization_id: org })]);
      await admin.query("INSERT INTO public.social_teams(id,organization_id,name,leader_id) VALUES($1,$2,'Cleanup team',$3)", [team, org, user]);
      await admin.query("INSERT INTO public.facebook_pages(id,organization_id,name,external_page_id) VALUES($1,$2,'Cleanup Page','2468013579')", [page, org]);
      await admin.query("INSERT INTO public.social_page_teams(page_id,team_id,assignment_type) VALUES($1,$2,'primary')", [page, team]);
      await admin.query('INSERT INTO public.social_team_members(team_id,user_id) VALUES($1,$2)', [team, user]);
      await admin.query("INSERT INTO public.social_knowledge_entries(organization_id,page_id,title,answer,approved_by) VALUES($1,$2,'Cleanup knowledge','Synthetic',$3)", [org, page, user]);
      await admin.query("INSERT INTO public.social_saved_replies(organization_id,page_id,owner_id,title,content) VALUES($1,$2,$3,'Cleanup saved','Synthetic')", [org, page, user]);
      thread = (await admin.query("INSERT INTO public.ai_threads(organization_id,owner_id,title) VALUES($1,$2,'Cleanup AI') RETURNING id", [org, user])).rows[0].id;
      await admin.query("INSERT INTO public.ai_messages(organization_id,thread_id,role,content,created_by) VALUES($1,$2,'user','Synthetic',$3)", [org, thread, user]);
      await admin.query("INSERT INTO public.audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'social.cleanup.fixture','fixture',$3)", [org, user, org]);
    } finally {
      // approved_by has DELETE RESTRICT; audit org/actor uses SET NULL, not CASCADE.
      await admin.query('DELETE FROM public.social_knowledge_entries WHERE organization_id=$1', [org]);
      await admin.query('DELETE FROM public.audit_logs WHERE organization_id=$1 OR actor_id=$2', [org, user]);
      await admin.query('DELETE FROM auth.users WHERE id=$1', [user]);
      await admin.query('DELETE FROM public.organizations WHERE id=$1', [org]);
    }
    for (const table of ['profiles', 'social_teams', 'facebook_pages', 'social_knowledge_entries', 'social_saved_replies', 'ai_threads', 'ai_messages']) {
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.'+table+' WHERE organization_id=$1', [org])).rows[0].n, 0, table+' cleanup residue');
    }
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM auth.users WHERE id=$1', [user])).rows[0].n, 0);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.organizations WHERE id=$1', [org])).rows[0].n, 0);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.audit_logs WHERE entity_id=$1', [org])).rows[0].n, 0);
  });
}

/** A business-policy observation, deliberately not a fabricated PASS. */
export async function observeOwnAssignedVisibility({ admin, actor, rpc, fixture, ids }) {
  localClient(admin);
  const f = await fixture();
  const assignment = await rpc(ids.ADMIN, 'smart_assign_social_conversation', [f.page, 'phase4-own-assigned-policy']);
  assert.ok([ids.BACKUP, ids.BACKUP2].includes(assignment.assignee_id));
  const nonAssignee = assignment.assignee_id === ids.BACKUP ? ids.BACKUP2 : ids.BACKUP;
  const own = await actor(assignment.assignee_id, client => client.query('SELECT id FROM public.social_conversation_assignments WHERE id=$1', [assignment.id]));
  const other = await actor(nonAssignee, client => client.query('SELECT id FROM public.social_conversation_assignments WHERE id=$1', [assignment.id]));
  assert.equal(own.rowCount, 1);
  return {
    requestedPolicy: 'only_own_assigned_conversations',
    status: other.rowCount === 0 ? 'PASS' : 'FAIL',
    assignedUserCanRead: true,
    differentAuthorizedPageMemberCanRead: other.rowCount > 0,
    explanation: other.rowCount === 0 ? 'Another agent cannot read this assignment.' : 'Current assignments_read is Page-wide; there is no assignee-only predicate.',
    // Synthetic metadata only; never include message text or credentials here.
    assignmentId: assignment.id, assigneeId: assignment.assignee_id, observingUserId: nonAssignee,
  };
}
