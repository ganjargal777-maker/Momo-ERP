alter table public.profiles
  add column if not exists employment_start_date date;

create or replace function public.provision_invited_user(
  invited_user_id uuid,
  actor_user_id uuid,
  target_organization_id uuid,
  target_role_id uuid,
  profile_first_name text,
  profile_last_name text,
  profile_email text,
  profile_phone text,
  profile_department text,
  profile_position text,
  profile_start_date date,
  profile_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles actor
    join public.user_roles ur on ur.user_id = actor.id
    join public.roles r on r.id = ur.role_id
    join public.role_permissions rp on rp.role_id = r.id
    where actor.id = actor_user_id
      and actor.organization_id = target_organization_id
      and actor.status = 'active'
      and r.organization_id = target_organization_id
      and rp.permission_code = 'users.manage'
  ) then
    raise exception 'Caller is not allowed to manage users';
  end if;

  if not exists (
    select 1 from public.roles
    where id = target_role_id and organization_id = target_organization_id
  ) then
    raise exception 'Selected role does not belong to this organization';
  end if;

  if not exists (
    select 1 from auth.users
    where id = invited_user_id and lower(email) = lower(profile_email)
  ) then
    raise exception 'Invited Auth user does not match the requested profile';
  end if;

  insert into public.profiles (
    id, organization_id, email, first_name, last_name, phone,
    department, position, employment_start_date, status
  ) values (
    invited_user_id,
    target_organization_id,
    lower(profile_email),
    profile_first_name,
    profile_last_name,
    profile_phone,
    profile_department,
    profile_position,
    profile_start_date,
    case when profile_is_active then 'active'::public.profile_status else 'disabled'::public.profile_status end
  )
  on conflict (id) do update set
    organization_id = excluded.organization_id,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    phone = excluded.phone,
    department = excluded.department,
    position = excluded.position,
    employment_start_date = excluded.employment_start_date,
    status = excluded.status,
    updated_at = now();

  insert into public.user_roles (user_id, role_id, assigned_by)
  values (invited_user_id, target_role_id, actor_user_id)
  on conflict (user_id, role_id) do update set assigned_by = excluded.assigned_by;
end;
$$;

revoke all on function public.provision_invited_user(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, date, boolean
) from public, anon, authenticated;
grant execute on function public.provision_invited_user(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, date, boolean
) to service_role;
