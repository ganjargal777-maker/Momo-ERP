select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', 'd12c65af-eaea-46c7-a07d-9cbac8f0e057',
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

do $$
declare
  profile_count integer;
  admin_role_count integer;
  organization_count integer;
begin
  select count(*) into profile_count
  from public.profiles
  where id = auth.uid()
    and status = 'active';

  select count(*) into admin_role_count
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid()
    and r.name = 'Admin';

  select count(*) into organization_count
  from public.organizations
  where id = public.current_organization_id()
    and slug = 'momo-erp';

  if profile_count <> 1 or admin_role_count <> 1 or organization_count <> 1 then
    raise exception 'Admin Auth/RLS verification failed: profiles=%, admin_roles=%, organizations=%',
      profile_count, admin_role_count, organization_count;
  end if;
end $$;

reset role;
