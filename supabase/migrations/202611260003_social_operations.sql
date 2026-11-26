alter table public.social_conversation_assignments
 add column if not exists unread_count integer not null default 0 check(unread_count>=0),
 add column if not exists version integer not null default 1 check(version>0),
 add column if not exists locked_by uuid references public.profiles(id) on delete set null,
 add column if not exists lock_expires_at timestamptz,
 add column if not exists last_message_at timestamptz not null default now();

create table public.social_saved_replies(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 page_id uuid references public.facebook_pages(id) on delete cascade,owner_id uuid references public.profiles(id) on delete cascade,
 title text not null,content text not null check(char_length(content) between 1 and 4000),is_shared boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
alter table public.social_saved_replies enable row level security;
create policy saved_replies_read on public.social_saved_replies for select to authenticated using(organization_id=public.current_organization_id() and public.has_permission('ai_assistant.use') and (is_shared or owner_id=auth.uid()) and (page_id is null or public.can_access_social_page(page_id,'read')));
create policy saved_replies_write on public.social_saved_replies for all to authenticated using(organization_id=public.current_organization_id() and owner_id=auth.uid() and public.has_permission('ai_suggestions.create')) with check(organization_id=public.current_organization_id() and owner_id=auth.uid() and public.has_permission('ai_suggestions.create'));
grant select,insert,update,delete on public.social_saved_replies to authenticated;

create or replace function public.smart_assign_social_conversation(target_page uuid,target_external_id text)
returns public.social_conversation_assignments language plpgsql security invoker set search_path='' as $$
declare org uuid; chosen_team uuid; chosen_user uuid; result public.social_conversation_assignments;
begin
 org:=public.current_organization_id();
 if org is null or not public.has_permission('social_inbox.assign') or not public.can_access_social_page(target_page,'assign') then raise exception 'permission denied' using errcode='42501'; end if;
 if target_external_id is null or length(target_external_id)>256 then raise exception 'invalid conversation id' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_page::text||':'||target_external_id,0));
 select a.* into result from public.social_conversation_assignments a where a.page_id=target_page and a.external_conversation_id=target_external_id;
 if found then return result; end if;
 select pt.team_id into chosen_team from public.social_page_teams pt join public.social_teams t on t.id=pt.team_id and t.is_active
 where pt.page_id=target_page order by case pt.assignment_type when 'primary' then 0 else 1 end,pt.priority limit 1;
 select tm.user_id into chosen_user from public.social_team_members tm join public.profiles p on p.id=tm.user_id and p.status='active'
 join public.social_agent_presence ap on ap.user_id=tm.user_id and ap.status='online'
 where tm.team_id=chosen_team and tm.is_active and public.can_access_social_page(target_page,'read') order by ap.active_conversations,ap.updated_at,tm.user_id limit 1 for update of ap skip locked;
 insert into public.social_conversation_assignments(organization_id,page_id,external_conversation_id,team_id,assignee_id,unread_count)
 values(org,target_page,target_external_id,chosen_team,chosen_user,1) returning * into result;
 if chosen_user is not null then update public.social_agent_presence set active_conversations=active_conversations+1,updated_at=now() where user_id=chosen_user; end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'social.smart_assign','social_conversation',result.id::text,jsonb_build_object('page_id',target_page,'team_id',chosen_team,'assignee_id',chosen_user));
 return result;
end $$;
revoke all on function public.smart_assign_social_conversation(uuid,text) from public,anon;grant execute on function public.smart_assign_social_conversation(uuid,text) to authenticated;

create or replace function public.claim_social_conversation(target_assignment uuid,expected_version integer)
returns public.social_conversation_assignments language plpgsql security invoker set search_path='' as $$
declare row public.social_conversation_assignments;
begin
 update public.social_conversation_assignments set locked_by=auth.uid(),lock_expires_at=now()+interval '5 minutes',version=version+1
 where id=target_assignment and version=expected_version and (locked_by is null or locked_by=auth.uid() or lock_expires_at<now())
 and organization_id=public.current_organization_id() and public.has_permission('social_inbox.read') and public.can_access_social_page(page_id,'read') returning * into row;
 if row.id is null then raise exception 'conversation already claimed or version changed' using errcode='40001'; end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(row.organization_id,auth.uid(),'social.claim','social_conversation',row.id::text,jsonb_build_object('version',row.version));return row;
end $$;
revoke all on function public.claim_social_conversation(uuid,integer) from public,anon;grant execute on function public.claim_social_conversation(uuid,integer) to authenticated;

create or replace view public.social_performance_summary with(security_invoker=true) as
select organization_id,page_id,team_id,assignee_id,count(*) conversation_count,
 count(*) filter(where status<>'resolved') unresolved_count,count(*) filter(where unread_count>0) unanswered_count,
 avg(extract(epoch from(first_replied_at-first_received_at))) filter(where first_replied_at is not null) avg_first_response_seconds,
 count(*) filter(where order_id is not null) converted_count,count(*) filter(where ai_assisted) ai_assisted_count
from public.social_conversation_assignments group by organization_id,page_id,team_id,assignee_id;
grant select on public.social_performance_summary to authenticated;
