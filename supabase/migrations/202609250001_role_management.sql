create or replace function public.update_custom_role(
  target_role_id uuid,
  role_name text,
  role_description text,
  permission_codes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_organization_id uuid;
  normalized_name text := trim(role_name);
begin
  select p.organization_id into actor_organization_id
  from public.profiles p
  where p.id = auth.uid() and p.status = 'active';

  if actor_organization_id is null or not public.has_permission('users.manage') then
    raise exception 'Caller is not allowed to manage roles';
  end if;
  if normalized_name = '' or length(normalized_name) > 100 then raise exception 'Role name is invalid'; end if;
  if coalesce(array_length(permission_codes, 1), 0) = 0 then raise exception 'At least one permission is required'; end if;
  if exists (
    select 1 from unnest(permission_codes) code
    where not exists (select 1 from public.permissions p where p.code = code)
  ) then raise exception 'Unknown permission requested'; end if;

  update public.roles
  set name = normalized_name, description = coalesce(trim(role_description), ''), updated_at = now()
  where id = target_role_id and organization_id = actor_organization_id and is_system = false;
  if not found then raise exception 'Editable role was not found'; end if;

  delete from public.role_permissions where role_id = target_role_id;
  insert into public.role_permissions (role_id, permission_code)
  select target_role_id, code from (select distinct unnest(permission_codes) as code) requested;
exception
  when unique_violation then raise exception 'A role with this name already exists';
end;
$$;

revoke all on function public.update_custom_role(uuid, text, text, text[]) from public, anon;
grant execute on function public.update_custom_role(uuid, text, text, text[]) to authenticated;

create or replace function public.assign_user_role(target_user_id uuid, target_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_organization_id uuid;
begin
  select p.organization_id into actor_organization_id
  from public.profiles p
  where p.id = auth.uid() and p.status = 'active';
  if actor_organization_id is null or not public.has_permission('users.manage') then
    raise exception 'Caller is not allowed to manage users';
  end if;
  if target_user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if not exists (
    select 1 from public.profiles p where p.id = target_user_id and p.organization_id = actor_organization_id
  ) then raise exception 'User was not found in this organization'; end if;
  if not exists (
    select 1 from public.roles r where r.id = target_role_id and r.organization_id = actor_organization_id
  ) then raise exception 'Role was not found in this organization'; end if;

  delete from public.user_roles where user_id = target_user_id;
  insert into public.user_roles (user_id, role_id, assigned_by)
  values (target_user_id, target_role_id, auth.uid());
end;
$$;

revoke all on function public.assign_user_role(uuid, uuid) from public, anon;
grant execute on function public.assign_user_role(uuid, uuid) to authenticated;
