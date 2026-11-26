-- Phase 4: atomic management and real-data inbox operations.
-- This migration is intentionally not applied to the hosted project yet.

drop policy if exists team_members_manage on public.social_team_members;
create policy team_members_manage on public.social_team_members for all to authenticated
using (public.has_permission('social_teams.manage') and exists(select 1 from public.social_teams t where t.id=team_id and t.organization_id=public.current_organization_id()))
with check (public.has_permission('social_teams.manage') and exists(select 1 from public.social_teams t where t.id=team_id and t.organization_id=public.current_organization_id()));
drop policy if exists page_teams_manage on public.social_page_teams;
create policy page_teams_manage on public.social_page_teams for all to authenticated
using (public.has_permission('social_teams.manage') and exists(select 1 from public.facebook_pages p where p.id=page_id and p.organization_id=public.current_organization_id()))
with check (public.has_permission('social_teams.manage') and exists(select 1 from public.facebook_pages p where p.id=page_id and p.organization_id=public.current_organization_id()));
drop policy if exists page_access_manage on public.social_page_user_access;
create policy page_access_manage on public.social_page_user_access for all to authenticated
using (public.has_permission('social_teams.manage') and exists(select 1 from public.facebook_pages p where p.id=page_id and p.organization_id=public.current_organization_id()))
with check (public.has_permission('social_teams.manage') and exists(select 1 from public.facebook_pages p where p.id=page_id and p.organization_id=public.current_organization_id()));

create or replace function public.manage_social_team(
 target_id uuid, target_name text, target_leader uuid, target_capacity integer,
 target_active boolean, target_members uuid[] default '{}'::uuid[])
returns public.social_teams language plpgsql security invoker set search_path='' as $$
declare org uuid:=public.current_organization_id(); result public.social_teams; member_id uuid;
begin
 if org is null or not public.has_permission('social_teams.manage') then raise exception 'permission denied' using errcode='42501'; end if;
 if nullif(btrim(target_name),'') is null or char_length(target_name)>120 or target_capacity is not null and target_capacity<1 then raise exception 'invalid team data' using errcode='22023'; end if;
 if target_leader is not null and not exists(select 1 from public.profiles p where p.id=target_leader and p.organization_id=org and p.status='active') then raise exception 'invalid team leader' using errcode='22023'; end if;
 if target_id is null then insert into public.social_teams(organization_id,name,leader_id,page_capacity,is_active) values(org,btrim(target_name),target_leader,target_capacity,target_active) returning * into result;
 else update public.social_teams set name=btrim(target_name),leader_id=target_leader,page_capacity=target_capacity,is_active=target_active,updated_at=now() where id=target_id and organization_id=org returning * into result; end if;
 if result.id is null then raise exception 'team not found' using errcode='P0002'; end if;
 if exists(select 1 from unnest(coalesce(target_members,'{}'::uuid[])) m(id) left join public.profiles p on p.id=m.id and p.organization_id=org and p.status='active' where p.id is null) then raise exception 'invalid team member' using errcode='22023'; end if;
 delete from public.social_team_members where team_id=result.id and user_id<>all(coalesce(target_members,'{}'::uuid[]));
 foreach member_id in array coalesce(target_members,'{}'::uuid[]) loop insert into public.social_team_members(team_id,user_id,is_active) values(result.id,member_id,true) on conflict(team_id,user_id) do update set is_active=true; end loop;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'social.team.save','social_team',result.id::text,to_jsonb(result));
 return result;
end $$;
revoke all on function public.manage_social_team(uuid,text,uuid,integer,boolean,uuid[]) from public,anon;
grant execute on function public.manage_social_team(uuid,text,uuid,integer,boolean,uuid[]) to authenticated;

create or replace function public.manage_social_page(
 target_id uuid, target_name text, target_external_id text, target_active boolean,
 target_connection_status text, target_primary_team uuid, target_backup_team uuid)
returns public.facebook_pages language plpgsql security invoker set search_path='' as $$
declare org uuid:=public.current_organization_id(); result public.facebook_pages; assigned_count integer; cap integer;
begin
 if org is null or not public.has_permission('pages.manage') or not public.has_permission('social_teams.manage') then raise exception 'permission denied' using errcode='42501'; end if;
 if nullif(btrim(target_name),'') is null or char_length(target_name)>160 or target_connection_status not in('disconnected','pending','connected','error') then raise exception 'invalid page data' using errcode='22023'; end if;
 if target_primary_team is not null and target_primary_team=target_backup_team then raise exception 'primary and backup teams must differ' using errcode='22023'; end if;
 if exists(select 1 from unnest(array_remove(array[target_primary_team,target_backup_team],null)) t(id) left join public.social_teams s on s.id=t.id and s.organization_id=org and s.is_active where s.id is null) then raise exception 'invalid page team' using errcode='22023'; end if;
 if target_id is null then insert into public.facebook_pages(organization_id,name,external_page_id,is_active,connection_status) values(org,btrim(target_name),nullif(btrim(target_external_id),''),target_active,target_connection_status) returning * into result;
 else update public.facebook_pages set name=btrim(target_name),external_page_id=nullif(btrim(target_external_id),''),is_active=target_active,connection_status=target_connection_status,updated_at=now() where id=target_id and organization_id=org returning * into result; end if;
 if result.id is null then raise exception 'page not found' using errcode='P0002'; end if;
 for assigned_count,cap in select count(*)::integer,t.page_capacity from public.social_page_teams pt join public.social_teams t on t.id=pt.team_id where pt.team_id in(target_primary_team,target_backup_team) and pt.page_id<>result.id group by t.id,t.page_capacity loop if cap is not null and assigned_count>=cap then raise exception 'team page capacity exceeded' using errcode='23514'; end if; end loop;
 delete from public.social_page_teams where page_id=result.id;
 if target_primary_team is not null then insert into public.social_page_teams(page_id,team_id,assignment_type,priority) values(result.id,target_primary_team,'primary',1); end if;
 if target_backup_team is not null then insert into public.social_page_teams(page_id,team_id,assignment_type,priority) values(result.id,target_backup_team,'backup',1); end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'social.page.save','facebook_page',result.id::text,jsonb_build_object('page',to_jsonb(result),'primary_team',target_primary_team,'backup_team',target_backup_team));
 return result;
end $$;
revoke all on function public.manage_social_page(uuid,text,text,boolean,text,uuid,uuid) from public,anon;
grant execute on function public.manage_social_page(uuid,text,text,boolean,text,uuid,uuid) to authenticated;

create or replace function public.set_social_page_user_access(target_page uuid,target_user uuid,target_read boolean,target_reply boolean,target_assign boolean)
returns public.social_page_user_access language plpgsql security invoker set search_path='' as $$
declare org uuid:=public.current_organization_id(); result public.social_page_user_access;
begin
 if org is null or not public.has_permission('social_teams.manage') then raise exception 'permission denied' using errcode='42501'; end if;
 if not exists(select 1 from public.facebook_pages where id=target_page and organization_id=org) or not exists(select 1 from public.profiles where id=target_user and organization_id=org and status='active') then raise exception 'page or user not found' using errcode='P0002'; end if;
 insert into public.social_page_user_access(page_id,user_id,can_read,can_reply,can_assign) values(target_page,target_user,target_read,target_reply,target_assign)
 on conflict(page_id,user_id) do update set can_read=excluded.can_read,can_reply=excluded.can_reply,can_assign=excluded.can_assign returning * into result;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'social.page_access.save','facebook_page',target_page::text,to_jsonb(result)); return result;
end $$;
revoke all on function public.set_social_page_user_access(uuid,uuid,boolean,boolean,boolean) from public,anon;
grant execute on function public.set_social_page_user_access(uuid,uuid,boolean,boolean,boolean) to authenticated;

create or replace function public.update_social_conversation(target_assignment uuid,expected_version integer,target_action text,target_team uuid default null,target_assignee uuid default null)
returns public.social_conversation_assignments language plpgsql security invoker set search_path='' as $$
declare org uuid:=public.current_organization_id(); old_row public.social_conversation_assignments; result public.social_conversation_assignments;
begin
 select * into old_row from public.social_conversation_assignments where id=target_assignment and organization_id=org for update;
 if old_row.id is null then raise exception 'conversation not found' using errcode='P0002'; end if;
 if old_row.version<>expected_version then raise exception 'conversation version changed' using errcode='40001'; end if;
 if old_row.locked_by is not null and old_row.locked_by<>auth.uid() and old_row.lock_expires_at>now() then raise exception 'conversation locked by another agent' using errcode='55P03'; end if;
 if target_action='claim' then
  if not public.has_permission('social_inbox.read') or not public.can_access_social_page(old_row.page_id,'read') then raise exception 'permission denied' using errcode='42501'; end if;
  update public.social_conversation_assignments set locked_by=auth.uid(),lock_expires_at=now()+interval '5 minutes',version=version+1 where id=target_assignment returning * into result;
 elsif target_action in('assign','transfer') then
  if not public.has_permission(case when target_action='transfer' then 'social_inbox.reassign' else 'social_inbox.assign' end) or not public.can_access_social_page(old_row.page_id,'assign') then raise exception 'permission denied' using errcode='42501'; end if;
  if not exists(select 1 from public.social_team_members tm join public.social_teams t on t.id=tm.team_id where tm.team_id=target_team and tm.user_id=target_assignee and tm.is_active and t.organization_id=org and t.is_active) then raise exception 'assignee is not an active team member' using errcode='22023'; end if;
  if old_row.assignee_id is distinct from target_assignee then update public.social_agent_presence set active_conversations=greatest(0,active_conversations-1),updated_at=now() where user_id=old_row.assignee_id; update public.social_agent_presence set active_conversations=active_conversations+1,updated_at=now() where user_id=target_assignee; end if;
  update public.social_conversation_assignments set team_id=target_team,assignee_id=target_assignee,locked_by=target_assignee,lock_expires_at=now()+interval '5 minutes',version=version+1,last_activity_at=now() where id=target_assignment returning * into result;
 elsif target_action='resolve' then
  if not public.has_permission('social_inbox.resolve') or not public.can_access_social_page(old_row.page_id,'reply') then raise exception 'permission denied' using errcode='42501'; end if;
  update public.social_conversation_assignments set status='resolved',resolved_at=now(),unread_count=0,locked_by=null,lock_expires_at=null,version=version+1,last_activity_at=now() where id=target_assignment returning * into result;
  update public.social_agent_presence set active_conversations=greatest(0,active_conversations-1),updated_at=now() where user_id=old_row.assignee_id;
 else raise exception 'invalid conversation action' using errcode='22023'; end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(org,auth.uid(),'social.conversation.'||target_action,'social_conversation',target_assignment::text,to_jsonb(old_row),to_jsonb(result)); return result;
end $$;
revoke all on function public.update_social_conversation(uuid,integer,text,uuid,uuid) from public,anon;
grant execute on function public.update_social_conversation(uuid,integer,text,uuid,uuid) to authenticated;

create policy presence_assignment_update on public.social_agent_presence for update to authenticated
using(organization_id=public.current_organization_id() and public.has_permission('social_inbox.assign'))
with check(organization_id=public.current_organization_id() and public.has_permission('social_inbox.assign'));

create or replace function public.smart_assign_social_conversation(target_page uuid,target_external_id text)
returns public.social_conversation_assignments language plpgsql security invoker set search_path='' as $$
declare org uuid:=public.current_organization_id(); chosen_team uuid; chosen_user uuid; candidate record; result public.social_conversation_assignments;
begin
 if org is null or not public.has_permission('social_inbox.assign') or not public.can_access_social_page(target_page,'assign') then raise exception 'permission denied' using errcode='42501'; end if;
 if target_external_id is null or length(target_external_id)>256 then raise exception 'invalid conversation id' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_page::text||':'||target_external_id,0));
 select * into result from public.social_conversation_assignments where page_id=target_page and external_conversation_id=target_external_id;
 if found then return result; end if;
 for candidate in select pt.team_id from public.social_page_teams pt join public.social_teams t on t.id=pt.team_id and t.is_active where pt.page_id=target_page order by case pt.assignment_type when 'primary' then 0 else 1 end,pt.priority loop
  select tm.user_id into chosen_user from public.social_team_members tm join public.profiles p on p.id=tm.user_id and p.status='active' join public.social_agent_presence ap on ap.user_id=tm.user_id and ap.status='online'
  where tm.team_id=candidate.team_id and tm.is_active order by ap.active_conversations,ap.updated_at,tm.user_id limit 1 for update of ap skip locked;
  if chosen_user is not null then chosen_team:=candidate.team_id; exit; end if;
 end loop;
 insert into public.social_conversation_assignments(organization_id,page_id,external_conversation_id,team_id,assignee_id,unread_count) values(org,target_page,target_external_id,chosen_team,chosen_user,1) returning * into result;
 if chosen_user is not null then update public.social_agent_presence set active_conversations=active_conversations+1,updated_at=now() where user_id=chosen_user; end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'social.smart_assign','social_conversation',result.id::text,jsonb_build_object('page_id',target_page,'team_id',chosen_team,'assignee_id',chosen_user));
 return result;
end $$;
