-- Explicit-subject delivery authorization for the trusted bot connector.
-- No flags, external connections, memberships or production data are changed.
-- Inbox policy remains Page-wide. This is not an own-assigned-only policy.

create function momo_social_private.subject_delivery_access(
  subject_user uuid, subject_org uuid, target_page uuid, target_team uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select subject_user is not null and subject_org is not null
    and target_page is not null and target_team is not null
    and momo_social_private.user_has_permission(subject_user,subject_org,'social_inbox.read')
    and momo_social_private.user_has_permission(subject_user,subject_org,'social_inbox.reply_send')
    and exists(select 1 from public.feature_flags f where f.organization_id=subject_org and f.key='social_inbox_read' and f.enabled)
    and exists(select 1 from public.feature_flags f where f.organization_id=subject_org and f.key='social_inbox_reply_send' and f.enabled)
    and exists(select 1 from public.facebook_pages p where p.id=target_page and p.organization_id=subject_org
      and p.is_active and p.connection_status='connected' and p.external_page_id ~ '^[0-9]{1,32}$')
    and exists(select 1 from public.social_teams t
      join public.social_team_members tm on tm.team_id=t.id and tm.user_id=subject_user and tm.is_active
      join public.social_page_teams pt on pt.team_id=t.id and pt.page_id=target_page and pt.assignment_type in('primary','backup')
      where t.id=target_team and t.organization_id=subject_org and t.is_active)
    -- Preserve the current explicit-row override. Without a direct row the
    -- required active linked-team membership above supplies implicit access.
    and case when exists(select 1 from public.social_page_user_access a where a.page_id=target_page and a.user_id=subject_user)
      then exists(select 1 from public.social_page_user_access a where a.page_id=target_page and a.user_id=subject_user and a.can_read and a.can_reply)
      else true end
$$;
revoke all on function momo_social_private.subject_delivery_access(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.get_social_access_recheck(
  target_user uuid, target_organization uuid, target_external_page text, target_team uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_page uuid; user_active boolean;
begin
  if target_user is null or target_organization is null or target_team is null
    or target_external_page is null or target_external_page !~ '^[0-9]{1,32}$' then
    raise exception 'invalid access recheck arguments' using errcode='22023';
  end if;
  select exists(select 1 from public.profiles p where p.id=target_user and p.organization_id=target_organization and p.status='active') into user_active;
  select p.id into target_page from public.facebook_pages p
    where p.organization_id=target_organization and p.external_page_id=target_external_page;
  return jsonb_build_object('active',user_active,'allowed',
    user_active and momo_social_private.subject_delivery_access(target_user,target_organization,target_page,target_team));
end $$;
-- ACL is the service boundary. Do not impersonate a subject with set_config or
-- reuse subject_page_access(), which derives the current browser organization.
revoke all on function public.get_social_access_recheck(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.get_social_access_recheck(uuid,uuid,text,uuid) to service_role;

create function public.get_social_delivery_context(target_page uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid:=public.current_organization_id(); selected_team uuid; external_page text;
begin
  if actor is null or tenant is null then raise exception 'permission denied' using errcode='42501'; end if;
  select pt.team_id into selected_team from public.social_page_teams pt
    where pt.page_id=target_page and pt.assignment_type in('primary','backup')
      and momo_social_private.subject_delivery_access(actor,tenant,target_page,pt.team_id)
    order by case pt.assignment_type when 'primary' then 0 else 1 end,pt.priority,pt.team_id limit 1;
  if selected_team is null then raise exception 'delivery permission denied' using errcode='42501'; end if;
  select p.external_page_id into external_page from public.facebook_pages p where p.id=target_page and p.organization_id=tenant;
  return jsonb_build_object('organizationId',tenant,'teamId',selected_team,'subjectId',actor,
    'pageId',external_page,'erpPageId',target_page);
end $$;
revoke all on function public.get_social_delivery_context(uuid) from public,anon,service_role;
grant execute on function public.get_social_delivery_context(uuid) to authenticated;

comment on function public.get_social_access_recheck(uuid,uuid,text,uuid) is
  'Trusted service-only current subject/org/Page/team delivery check; no employee JWT impersonation and no conversation assignment restriction.';
comment on function public.get_social_delivery_context(uuid) is
  'Authenticated caller-derived delivery context, active eligible primary team before backup; browser cannot choose an employee or team.';
