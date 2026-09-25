create or replace function public.create_custom_role(
  role_name text,
  role_description text,
  permission_codes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_organization_id uuid;
  new_role_id uuid;
  normalized_name text := trim(role_name);
begin
  select p.organization_id into actor_organization_id
  from public.profiles p
  where p.id = auth.uid() and p.status = 'active';

  if actor_organization_id is null or not public.has_permission('users.manage') then
    raise exception 'Caller is not allowed to manage roles';
  end if;

  if normalized_name = '' or length(normalized_name) > 100 then
    raise exception 'Role name is invalid';
  end if;

  if coalesce(array_length(permission_codes, 1), 0) = 0 then
    raise exception 'At least one permission is required';
  end if;

  if exists (
    select 1 from unnest(permission_codes) code
    where not exists (select 1 from public.permissions p where p.code = code)
  ) then
    raise exception 'Unknown permission requested';
  end if;

  insert into public.roles (organization_id, name, description, is_system)
  values (actor_organization_id, normalized_name, coalesce(trim(role_description), ''), false)
  returning id into new_role_id;

  insert into public.role_permissions (role_id, permission_code)
  select new_role_id, code
  from (select distinct unnest(permission_codes) as code) requested;

  return new_role_id;
exception
  when unique_violation then
    raise exception 'A role with this name already exists';
end;
$$;

revoke all on function public.create_custom_role(text, text, text[]) from public, anon;
grant execute on function public.create_custom_role(text, text, text[]) to authenticated;
