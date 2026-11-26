-- Page-scoped ERP social authorization, safe registry and atomic routing.
-- Source for CLI-created 20261126111223_social_contract_alignment.sql.
-- Depends on the existing core/RBAC and social migrations 001 through 004.
-- No feature flag or external connection is enabled by this migration.
-- Policy: an explicit Page/user access row overrides implicit membership for
-- each action, including a false flag. Without a row, active primary/backup
-- membership (or social_teams.manage) retains the previous implicit baseline.
-- Read is a prerequisite: effective reply=can_read AND can_reply and effective
-- assign=can_read AND can_assign, without rewriting the stored flags.
-- page_capacity counts DISTINCT linked Pages, not conversation capacity.
-- Online assignment requires a heartbeat no older than five minutes.
-- Claiming a queue lease is a mutation: it requires global inbox read+assign
-- and effective Page read+assign; read-only users cannot block working agents.
-- Assign creates ownership for unassigned work. Moving an already assigned row
-- requires the explicit transfer action and its global reassign permission.
-- Every queue RPC also requires caller global inbox read and effective Page
-- read, including rechecks after advisory/assignment/presence lock waits.

create schema if not exists momo_social_private;
revoke all on schema momo_social_private from public, anon;
grant usage on schema momo_social_private to authenticated;
alter default privileges in schema momo_social_private revoke execute on functions from public;

create or replace function momo_social_private.user_has_permission(subject_user uuid, subject_org uuid, required_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p
 join public.user_roles ur on ur.user_id=p.id
 join public.roles r on r.id=ur.role_id and r.organization_id=p.organization_id
 join public.role_permissions rp on rp.role_id=r.id and rp.permission_code=required_permission
 where p.id=subject_user and p.organization_id=subject_org and p.status='active')
$$;

-- Owner-only subject evaluator. It never takes organization identity from a
-- browser parameter; the actor must itself have an active current organization.
create or replace function momo_social_private.subject_page_access(target_page uuid, subject_user uuid, required_action text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.current_organization_id(); direct_access public.social_page_user_access;
begin
 if auth.uid() is null or org is null or required_action is null or required_action not in('read','reply','assign') then return false; end if;
 if not exists(select 1 from public.profiles u where u.id=subject_user and u.organization_id=org and u.status='active')
 or not exists(select 1 from public.facebook_pages p where p.id=target_page and p.organization_id=org and p.is_active) then return false; end if;
 select a.* into direct_access from public.social_page_user_access a where a.page_id=target_page and a.user_id=subject_user;
 if found then return case required_action when 'read' then direct_access.can_read when 'reply' then direct_access.can_read and direct_access.can_reply when 'assign' then direct_access.can_read and direct_access.can_assign else false end; end if;
 return momo_social_private.user_has_permission(subject_user,org,'social_teams.manage') or exists(
  select 1 from public.social_page_teams pt join public.social_teams t on t.id=pt.team_id and t.organization_id=org and t.is_active
  join public.social_team_members tm on tm.team_id=t.id and tm.user_id=subject_user and tm.is_active
  where pt.page_id=target_page and pt.assignment_type in('primary','backup'));
end $$;

-- Nonrecursive, boolean-only RLS predicate: callers cannot choose another user.
create or replace function momo_social_private.current_page_access(target_page uuid, required_action text)
returns boolean language sql stable security definer set search_path='' as $$
 select momo_social_private.subject_page_access(target_page,auth.uid(),required_action)
$$;

create or replace function public.can_access_social_page(target_page uuid, required_action text default 'read')
returns boolean language sql stable security invoker set search_path='' as $$
 select momo_social_private.current_page_access(target_page,required_action)
$$;

-- Leave raw Page-table RLS unchanged. Inbox discovery uses a narrow projection
-- so its users never gain SELECT on credential_reference or settings columns.
drop policy if exists facebook_pages_social_inbox_read on public.facebook_pages;
create or replace function momo_social_private.page_registry()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.current_organization_id(); all_pages boolean; inbox_pages boolean; result jsonb;
begin
 if auth.uid() is null or org is null then raise exception 'permission denied' using errcode='42501'; end if;
 all_pages:=public.has_permission('pages.read');
 inbox_pages:=public.has_permission('social_inbox.read');
 if not all_pages and not inbox_pages then raise exception 'permission denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'organization_id',p.organization_id,'name',p.name,'external_page_id',p.external_page_id,
  'is_active',p.is_active,'connection_status',p.connection_status,'created_at',p.created_at,'updated_at',p.updated_at
 ) order by p.name,p.id),'[]'::jsonb) into result
 from public.facebook_pages p where p.organization_id=org
  and (all_pages or (inbox_pages and p.is_active and momo_social_private.current_page_access(p.id,'read')));
 return result;
end $$;
create or replace function public.list_social_page_registry()
returns jsonb language sql stable security invoker set search_path='' as $$ select momo_social_private.page_registry() $$;

-- Reference integrity for RLS. Reading protected link tables inside this narrow
-- predicate would otherwise recurse through can_access_social_page policies.
create or replace function momo_social_private.links_in_current_org(target_page uuid,target_team uuid,target_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.current_organization_id() is not null
 and (target_page is not null or target_team is not null or target_user is not null)
 and (target_page is null or exists(select 1 from public.facebook_pages p where p.id=target_page and p.organization_id=public.current_organization_id()))
 and (target_team is null or exists(select 1 from public.social_teams t where t.id=target_team and t.organization_id=public.current_organization_id()))
 and (target_user is null or exists(select 1 from public.profiles p where p.id=target_user and p.organization_id=public.current_organization_id()))
$$;

drop policy if exists teams_manage on public.social_teams;
create policy teams_manage on public.social_teams for all to authenticated
 using(organization_id=public.current_organization_id() and public.has_permission('social_teams.manage'))
 with check(organization_id=public.current_organization_id() and public.has_permission('social_teams.manage')
  and (leader_id is null or momo_social_private.links_in_current_org(null,null,leader_id)));
drop policy if exists team_members_read on public.social_team_members;
create policy team_members_read on public.social_team_members for select to authenticated
 using(momo_social_private.links_in_current_org(null,team_id,user_id) and (user_id=auth.uid() or public.has_permission('social_teams.read')));
drop policy if exists team_members_manage on public.social_team_members;
create policy team_members_manage on public.social_team_members for all to authenticated
 using(public.has_permission('social_teams.manage') and momo_social_private.links_in_current_org(null,team_id,user_id))
 with check(public.has_permission('social_teams.manage') and momo_social_private.links_in_current_org(null,team_id,user_id));
drop policy if exists page_teams_read on public.social_page_teams;
create policy page_teams_read on public.social_page_teams for select to authenticated
 using(momo_social_private.links_in_current_org(page_id,team_id,null) and public.can_access_social_page(page_id,'read'));
drop policy if exists page_teams_manage on public.social_page_teams;
create policy page_teams_manage on public.social_page_teams for all to authenticated
 using(public.has_permission('social_teams.manage') and momo_social_private.links_in_current_org(page_id,team_id,null))
 with check(public.has_permission('social_teams.manage') and momo_social_private.links_in_current_org(page_id,team_id,null));
drop policy if exists page_access_self_read on public.social_page_user_access;
create policy page_access_self_read on public.social_page_user_access for select to authenticated
 using(momo_social_private.links_in_current_org(page_id,null,user_id) and (user_id=auth.uid() or public.has_permission('social_teams.manage')));
drop policy if exists page_access_manage on public.social_page_user_access;
create policy page_access_manage on public.social_page_user_access for all to authenticated
 using(public.has_permission('social_teams.manage') and momo_social_private.links_in_current_org(page_id,null,user_id))
 with check(public.has_permission('social_teams.manage') and momo_social_private.links_in_current_org(page_id,null,user_id));

drop policy if exists knowledge_read on public.social_knowledge_entries;
create policy knowledge_read on public.social_knowledge_entries for select to authenticated
 using(organization_id=public.current_organization_id() and public.has_permission('ai_assistant.use') and (page_id is null or public.can_access_social_page(page_id,'read')));
drop policy if exists knowledge_manage on public.social_knowledge_entries;
create policy knowledge_insert on public.social_knowledge_entries for insert to authenticated
 with check(organization_id=public.current_organization_id() and approved_by=auth.uid() and public.has_permission('ai_suggestions.create') and (page_id is null or (public.can_access_social_page(page_id,'read') and public.can_access_social_page(page_id,'reply'))));
create policy knowledge_update on public.social_knowledge_entries for update to authenticated
 using(organization_id=public.current_organization_id() and public.has_permission('ai_suggestions.create') and (page_id is null or (public.can_access_social_page(page_id,'read') and public.can_access_social_page(page_id,'reply'))))
 with check(organization_id=public.current_organization_id() and approved_by=auth.uid() and public.has_permission('ai_suggestions.create') and (page_id is null or (public.can_access_social_page(page_id,'read') and public.can_access_social_page(page_id,'reply'))));
create policy knowledge_delete on public.social_knowledge_entries for delete to authenticated
 using(organization_id=public.current_organization_id() and public.has_permission('ai_suggestions.create') and (page_id is null or (public.can_access_social_page(page_id,'read') and public.can_access_social_page(page_id,'reply'))));
drop policy if exists saved_replies_write on public.social_saved_replies;
create policy saved_replies_insert on public.social_saved_replies for insert to authenticated
 with check(organization_id=public.current_organization_id() and owner_id=auth.uid() and public.has_permission('ai_suggestions.create') and (page_id is null or (public.can_access_social_page(page_id,'read') and public.can_access_social_page(page_id,'reply'))));
create policy saved_replies_update on public.social_saved_replies for update to authenticated
 using(organization_id=public.current_organization_id() and owner_id=auth.uid() and public.has_permission('ai_suggestions.create') and (page_id is null or (public.can_access_social_page(page_id,'read') and public.can_access_social_page(page_id,'reply'))))
 with check(organization_id=public.current_organization_id() and owner_id=auth.uid() and public.has_permission('ai_suggestions.create') and (page_id is null or (public.can_access_social_page(page_id,'read') and public.can_access_social_page(page_id,'reply'))));
create policy saved_replies_delete on public.social_saved_replies for delete to authenticated
 using(organization_id=public.current_organization_id() and owner_id=auth.uid() and public.has_permission('ai_suggestions.create') and (page_id is null or (public.can_access_social_page(page_id,'read') and public.can_access_social_page(page_id,'reply'))));

-- Updates to assignment state and other agents' counters go through the atomic
-- router only. Existing 004 public RPC signatures remain available below.
drop policy if exists assignments_manage on public.social_conversation_assignments;
revoke insert,update,delete on public.social_conversation_assignments from authenticated;
drop policy if exists presence_assignment_update on public.social_agent_presence;
drop policy if exists presence_self_update on public.social_agent_presence;
drop policy if exists presence_self_insert on public.social_agent_presence;
create policy presence_self_insert on public.social_agent_presence for insert to authenticated
 with check(user_id=auth.uid() and organization_id=public.current_organization_id());
create policy presence_self_update on public.social_agent_presence for update to authenticated
 using(user_id=auth.uid() and organization_id=public.current_organization_id())
 with check(user_id=auth.uid() and organization_id=public.current_organization_id());
revoke insert,update,delete on public.social_agent_presence from authenticated;
grant insert(user_id,organization_id,status,updated_at), update(user_id,organization_id,status,updated_at) on public.social_agent_presence to authenticated;

-- Client presence is a heartbeat, never an authoritative workload counter.
create or replace function momo_social_private.presence_heartbeat()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user='authenticated' then new.updated_at:=statement_timestamp(); end if;
 return new;
end $$;
drop trigger if exists momo_presence_heartbeat on public.social_agent_presence;
create trigger momo_presence_heartbeat before insert or update on public.social_agent_presence for each row execute function momo_social_private.presence_heartbeat();

-- Integrity/capacity guards are trigger-only, not callable RPCs. Their definer
-- reads are needed to count all links instead of the caller's RLS-visible subset.
create or replace function momo_social_private.page_team_integrity()
returns trigger language plpgsql security definer set search_path='' as $$
declare page_org uuid; team_org uuid; cap integer; linked integer;
begin
 select organization_id into page_org from public.facebook_pages where id=new.page_id;
 select organization_id,page_capacity into team_org,cap from public.social_teams where id=new.team_id for update;
 if page_org is null or team_org is distinct from page_org then raise exception 'page/team organization mismatch' using errcode='23514'; end if;
 if tg_op='UPDATE' then
  if exists(select 1 from public.social_page_teams pt where pt.page_id=new.page_id and pt.team_id=new.team_id and pt.assignment_type<>new.assignment_type
   and not(pt.page_id=old.page_id and pt.team_id=old.team_id and pt.assignment_type=old.assignment_type)) then raise exception 'primary and backup teams must differ' using errcode='23514'; end if;
  select count(distinct pt.page_id) into linked from public.social_page_teams pt where pt.team_id=new.team_id and pt.page_id<>new.page_id
   and not(pt.page_id=old.page_id and pt.team_id=old.team_id and pt.assignment_type=old.assignment_type);
 else
  if exists(select 1 from public.social_page_teams pt where pt.page_id=new.page_id and pt.team_id=new.team_id and pt.assignment_type<>new.assignment_type) then raise exception 'primary and backup teams must differ' using errcode='23514'; end if;
  select count(distinct pt.page_id) into linked from public.social_page_teams pt where pt.team_id=new.team_id and pt.page_id<>new.page_id;
 end if;
 if cap is not null and linked>=cap then raise exception 'team page capacity exceeded' using errcode='23514'; end if;
 return new;
end $$;
drop trigger if exists momo_page_team_integrity on public.social_page_teams;
create trigger momo_page_team_integrity before insert or update on public.social_page_teams for each row execute function momo_social_private.page_team_integrity();
create or replace function momo_social_private.team_capacity_integrity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.page_capacity is not null and (select count(distinct page_id) from public.social_page_teams where team_id=new.id)>new.page_capacity then raise exception 'team page capacity below assigned Page count' using errcode='23514'; end if;
 return new;
end $$;
drop trigger if exists momo_team_capacity_integrity on public.social_teams;
create trigger momo_team_capacity_integrity before update of page_capacity on public.social_teams for each row execute function momo_social_private.team_capacity_integrity();

-- Narrow authorized registry projection, without pages.read or secret fields.
create or replace function momo_social_private.page_context(target_page uuid,required_action text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; permitted boolean;
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'permission denied' using errcode='42501'; end if;
 if required_action not in('read','reply','assign') or required_action is null then raise exception 'invalid page action' using errcode='22023'; end if;
 permitted:=case required_action when 'read' then public.has_permission('social_inbox.read')
 when 'reply' then public.has_permission('social_inbox.reply_draft') or public.has_permission('social_inbox.reply_send')
 when 'assign' then public.has_permission('social_inbox.assign') or public.has_permission('social_inbox.reassign') else false end;
 if not permitted or not momo_social_private.current_page_access(target_page,required_action) then raise exception 'permission denied' using errcode='42501'; end if;
 select jsonb_build_object('id',p.id,'organization_id',p.organization_id,'external_page_id',p.external_page_id,'is_active',p.is_active,'connection_status',p.connection_status,'updated_at',p.updated_at)
 into result from public.facebook_pages p where p.id=target_page and p.organization_id=public.current_organization_id() and p.is_active;
 if result is null then raise exception 'permission denied' using errcode='42501'; end if;
 return result;
end $$;
create or replace function public.get_social_page_context(target_page uuid,required_action text default 'read')
returns jsonb language sql stable security invoker set search_path='' as $$ select momo_social_private.page_context(target_page,required_action) $$;

-- Owner-only candidate predicate. Caller/action authorization happens again in
-- every exposed atomic helper; callers cannot substitute an arbitrary subject.
create or replace function momo_social_private.eligible_agent(target_page uuid,target_team uuid,target_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.current_organization_id() is not null and exists(
 select 1 from public.social_page_teams pt join public.social_teams t on t.id=pt.team_id and t.is_active
 join public.social_team_members tm on tm.team_id=t.id and tm.user_id=target_user and tm.is_active
 join public.profiles p on p.id=tm.user_id and p.organization_id=t.organization_id and p.status='active'
 join public.social_agent_presence ap on ap.user_id=p.id and ap.organization_id=t.organization_id and ap.status='online'
 where pt.page_id=target_page and pt.team_id=target_team and t.organization_id=public.current_organization_id()
 and ap.updated_at>=statement_timestamp()-interval '5 minutes' and ap.updated_at<=statement_timestamp()+interval '1 minute'
 and momo_social_private.subject_page_access(target_page,target_user,'read')
 and momo_social_private.subject_page_access(target_page,target_user,'reply')
 and momo_social_private.user_has_permission(target_user,t.organization_id,'social_inbox.read')
 and momo_social_private.user_has_permission(target_user,t.organization_id,'social_inbox.reply_draft')
 and momo_social_private.user_has_permission(target_user,t.organization_id,'social_inbox.reply_send'))
$$;

create or replace function momo_social_private.smart_assign(target_page uuid,target_external_id text)
returns public.social_conversation_assignments language plpgsql security definer set search_path='' as $$
declare org uuid:=public.current_organization_id(); chosen_team uuid; chosen_user uuid; candidate record; tried_users uuid[]; result public.social_conversation_assignments;
begin
 if auth.uid() is null or org is null or not public.has_permission('social_inbox.read') or not public.has_permission('social_inbox.assign') or not momo_social_private.current_page_access(target_page,'read') or not momo_social_private.current_page_access(target_page,'assign') then raise exception 'permission denied' using errcode='42501'; end if;
 if target_external_id is null or nullif(btrim(target_external_id),'') is null or char_length(target_external_id)>256 then raise exception 'invalid conversation id' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(target_page,target_external_id)::text,0));
 if org is distinct from public.current_organization_id() or not public.has_permission('social_inbox.read') or not public.has_permission('social_inbox.assign') or not momo_social_private.current_page_access(target_page,'read') or not momo_social_private.current_page_access(target_page,'assign') then raise exception 'permission changed' using errcode='42501'; end if;
 select * into result from public.social_conversation_assignments where page_id=target_page and external_conversation_id=target_external_id and organization_id=org for update;
 if org is distinct from public.current_organization_id() or not public.has_permission('social_inbox.read') or not public.has_permission('social_inbox.assign') or not momo_social_private.current_page_access(target_page,'read') or not momo_social_private.current_page_access(target_page,'assign') then raise exception 'permission changed' using errcode='42501'; end if;
 if found then return result; end if;
 for candidate in select pt.team_id from public.social_page_teams pt join public.social_teams t on t.id=pt.team_id and t.organization_id=org and t.is_active
 where pt.page_id=target_page order by case pt.assignment_type when 'primary' then 0 else 1 end,pt.priority,pt.team_id loop
  chosen_user:=null;
  tried_users:='{}'::uuid[];
  loop
   select ap.user_id into chosen_user from public.social_agent_presence ap
   where ap.organization_id=org and not(ap.user_id=any(tried_users)) and momo_social_private.eligible_agent(target_page,candidate.team_id,ap.user_id)
   order by ap.active_conversations,ap.updated_at,ap.user_id limit 1 for update of ap skip locked;
   exit when not found;
   -- Recheck using a separate command snapshot after locking the one candidate.
   if momo_social_private.eligible_agent(target_page,candidate.team_id,chosen_user) then exit; end if;
   tried_users:=array_append(tried_users,chosen_user);
   chosen_user:=null;
  end loop;
  if chosen_user is not null then chosen_team:=candidate.team_id; exit; end if;
 end loop;
 if org is distinct from public.current_organization_id() or not public.has_permission('social_inbox.read') or not public.has_permission('social_inbox.assign') or not momo_social_private.current_page_access(target_page,'read') or not momo_social_private.current_page_access(target_page,'assign') then raise exception 'permission changed' using errcode='42501'; end if;
 insert into public.social_conversation_assignments(organization_id,page_id,external_conversation_id,team_id,assignee_id,unread_count)
 values(org,target_page,target_external_id,chosen_team,chosen_user,1) returning * into result;
 if chosen_user is not null then update public.social_agent_presence ap set active_conversations=(select count(*) from public.social_conversation_assignments a where a.organization_id=org and a.assignee_id=chosen_user and a.status<>'resolved') where ap.user_id=chosen_user and ap.organization_id=org; end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'social.smart_assign','social_conversation',result.id::text,jsonb_build_object('page_id',target_page,'team_id',chosen_team,'assignee_id',chosen_user));
 return result;
end $$;
create or replace function public.smart_assign_social_conversation(target_page uuid,target_external_id text)
returns public.social_conversation_assignments language sql security invoker set search_path='' as $$ select momo_social_private.smart_assign(target_page,target_external_id) $$;

create or replace function momo_social_private.update_conversation(target_assignment uuid,expected_version integer,target_action text,target_team uuid,target_assignee uuid)
returns public.social_conversation_assignments language plpgsql security definer set search_path='' as $$
declare org uuid:=public.current_organization_id(); old_row public.social_conversation_assignments; result public.social_conversation_assignments;
begin
 if auth.uid() is null or org is null or not public.has_permission('social_inbox.read') then raise exception 'permission denied' using errcode='42501'; end if;
 if target_action is null or target_action not in('claim','assign','transfer','resolve') or expected_version is null or expected_version<1 then raise exception 'invalid conversation action/version' using errcode='22023'; end if;
 select * into old_row from public.social_conversation_assignments where id=target_assignment and organization_id=org for update;
 if old_row.id is null then raise exception 'conversation not found' using errcode='P0002'; end if;
 if org is distinct from public.current_organization_id() or not public.has_permission('social_inbox.read') or not momo_social_private.current_page_access(old_row.page_id,'read') then raise exception 'permission changed' using errcode='42501'; end if;
 if target_action='claim' then
  if not public.has_permission('social_inbox.read') or not public.has_permission('social_inbox.assign') or not momo_social_private.current_page_access(old_row.page_id,'read') or not momo_social_private.current_page_access(old_row.page_id,'assign') then raise exception 'permission denied' using errcode='42501'; end if;
 elsif target_action in('assign','transfer') then
  if not public.has_permission(case when target_action='transfer' then 'social_inbox.reassign' else 'social_inbox.assign' end) or not momo_social_private.current_page_access(old_row.page_id,'assign') then raise exception 'permission denied' using errcode='42501'; end if;
 else
  if not public.has_permission('social_inbox.resolve') or not momo_social_private.current_page_access(old_row.page_id,'reply') then raise exception 'permission denied' using errcode='42501'; end if;
 end if;
 if old_row.version<>expected_version then raise exception 'conversation version changed' using errcode='40001'; end if;
 if target_action='resolve' and old_row.status='resolved' then return old_row; end if;
 if old_row.status='resolved' then raise exception 'conversation is resolved' using errcode='22023'; end if;
 if old_row.locked_by is not null and old_row.locked_by<>auth.uid() and old_row.lock_expires_at>statement_timestamp() then raise exception 'conversation locked by another agent' using errcode='55P03'; end if;
 if target_action='claim' then
  if old_row.locked_by=auth.uid() and old_row.lock_expires_at>statement_timestamp() then return old_row; end if;
  update public.social_conversation_assignments set locked_by=auth.uid(),lock_expires_at=statement_timestamp()+interval '5 minutes',version=version+1 where id=target_assignment returning * into result;
 elsif target_action in('assign','transfer') then
  if target_action='assign' and old_row.assignee_id is not null and (old_row.team_id is distinct from target_team or old_row.assignee_id is distinct from target_assignee) then raise exception 'transfer action required for assigned conversation' using errcode='42501'; end if;
  if target_team is null or target_assignee is null or not momo_social_private.eligible_agent(old_row.page_id,target_team,target_assignee) then raise exception 'assignee is not an eligible active Page/team agent' using errcode='22023'; end if;
  if old_row.team_id is not distinct from target_team and old_row.assignee_id is not distinct from target_assignee then return old_row; end if;
  perform 1 from public.social_agent_presence where organization_id=org and user_id=any(array_remove(array[old_row.assignee_id,target_assignee],null)) order by user_id for update;
  if target_action='assign' and old_row.assignee_id is not null and (old_row.team_id is distinct from target_team or old_row.assignee_id is distinct from target_assignee) then raise exception 'transfer action required for assigned conversation' using errcode='42501'; end if;
  if org is distinct from public.current_organization_id() or not public.has_permission('social_inbox.read') or not public.has_permission(case when target_action='transfer' then 'social_inbox.reassign' else 'social_inbox.assign' end) or not momo_social_private.current_page_access(old_row.page_id,'read') or not momo_social_private.current_page_access(old_row.page_id,'assign') then raise exception 'permission changed' using errcode='42501'; end if;
  if not momo_social_private.eligible_agent(old_row.page_id,target_team,target_assignee) then raise exception 'assignee eligibility changed' using errcode='40001'; end if;
  update public.social_conversation_assignments set team_id=target_team,assignee_id=target_assignee,locked_by=target_assignee,lock_expires_at=statement_timestamp()+interval '5 minutes',version=version+1,last_activity_at=statement_timestamp() where id=target_assignment returning * into result;
  update public.social_agent_presence ap set active_conversations=(select count(*) from public.social_conversation_assignments a where a.organization_id=org and a.assignee_id=ap.user_id and a.status<>'resolved') where ap.organization_id=org and ap.user_id=any(array_remove(array[old_row.assignee_id,target_assignee],null));
 else
  perform 1 from public.social_agent_presence where organization_id=org and user_id=old_row.assignee_id for update;
  if org is distinct from public.current_organization_id() or not public.has_permission('social_inbox.read') or not public.has_permission('social_inbox.resolve') or not momo_social_private.current_page_access(old_row.page_id,'read') or not momo_social_private.current_page_access(old_row.page_id,'reply') then raise exception 'permission changed' using errcode='42501'; end if;
  update public.social_conversation_assignments set status='resolved',resolved_at=statement_timestamp(),unread_count=0,locked_by=null,lock_expires_at=null,version=version+1,last_activity_at=statement_timestamp() where id=target_assignment returning * into result;
  update public.social_agent_presence ap set active_conversations=(select count(*) from public.social_conversation_assignments a where a.organization_id=org and a.assignee_id=ap.user_id and a.status<>'resolved') where ap.organization_id=org and ap.user_id=old_row.assignee_id;
 end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(org,auth.uid(),'social.conversation.'||target_action,'social_conversation',target_assignment::text,to_jsonb(old_row),to_jsonb(result));
 return result;
end $$;
create or replace function public.update_social_conversation(target_assignment uuid,expected_version integer,target_action text,target_team uuid default null,target_assignee uuid default null)
returns public.social_conversation_assignments language sql security invoker set search_path='' as $$ select momo_social_private.update_conversation(target_assignment,expected_version,target_action,target_team,target_assignee) $$;
create or replace function public.claim_social_conversation(target_assignment uuid,expected_version integer)
returns public.social_conversation_assignments language sql security invoker set search_path='' as $$ select momo_social_private.update_conversation(target_assignment,expected_version,'claim',null,null) $$;

-- All implementation helpers start owner-only. Only narrow current-user RLS
-- predicates and authenticated, self-authorizing wrapper targets are executable.
revoke all on all functions in schema momo_social_private from public,anon,authenticated;
grant execute on function momo_social_private.current_page_access(uuid,text),momo_social_private.page_registry(),momo_social_private.links_in_current_org(uuid,uuid,uuid),momo_social_private.page_context(uuid,text),momo_social_private.smart_assign(uuid,text),momo_social_private.update_conversation(uuid,integer,text,uuid,uuid) to authenticated;
revoke all on function public.can_access_social_page(uuid,text),public.list_social_page_registry(),public.get_social_page_context(uuid,text),public.smart_assign_social_conversation(uuid,text),public.update_social_conversation(uuid,integer,text,uuid,uuid),public.claim_social_conversation(uuid,integer) from public,anon;
grant execute on function public.can_access_social_page(uuid,text),public.list_social_page_registry(),public.get_social_page_context(uuid,text),public.smart_assign_social_conversation(uuid,text),public.update_social_conversation(uuid,integer,text,uuid,uuid),public.claim_social_conversation(uuid,integer) to authenticated;
