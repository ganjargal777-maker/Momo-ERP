-- Additive local hardening; no production migration, seed, or data deletion.
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
declare existing_organization_id uuid;
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

  -- A trusted invitation may bind an unassigned profile or update the same
  -- tenant only. Lock the target before inspecting/updating it; SDK delivery
  -- does not prove this Auth identity is newly owned by the current request.
  select organization_id into existing_organization_id
  from public.profiles where id=invited_user_id for update;
  if existing_organization_id is not null and existing_organization_id<>target_organization_id then
    raise exception using errcode='42501',message='Existing profile belongs to another organization';
  end if;
  if exists(
    select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    where ur.user_id=invited_user_id and r.organization_id<>target_organization_id
  ) then
    raise exception using errcode='23514',message='Existing roles belong to another organization';
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
    updated_at = now()
  where public.profiles.organization_id is null
     or public.profiles.organization_id=excluded.organization_id;
  if not found then
    raise exception using errcode='42501',message='Existing profile belongs to another organization';
  end if;

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


create or replace function momo_core_private.guard_tenant_references() returns trigger
language plpgsql security definer set search_path='' as $$
declare data jsonb:=to_jsonb(new); old_data jsonb; tenant uuid; ref_id uuid; ref_tenant uuid; i integer; parts text[]; cascade_old jsonb;
begin
  tenant:=(data->>'organization_id')::uuid;
  if tg_table_name='user_roles' then
    select organization_id into tenant from public.profiles where id=(data->>'user_id')::uuid;
    -- A profile deletion can cascade to both membership owner and assigner
    -- within one statement. Permit only the FK-generated NULLing of assigner
    -- on an otherwise unchanged membership whose two parent rows are gone.
    -- No INSERT, new identity/role/tenant, manual top-level UPDATE, or caller
    -- carrying an employee JWT is exempted from the normal same-org checks.
    if tg_op='UPDATE' and tenant is null and pg_trigger_depth()>1 and auth.uid() is null then
      cascade_old:=to_jsonb(old);
      if cascade_old->>'assigned_by' is not null and data->>'assigned_by' is null
        and data-'assigned_by'=cascade_old-'assigned_by'
        and not exists(select 1 from public.profiles where id=(data->>'user_id')::uuid)
        and not exists(select 1 from public.profiles where id=(cascade_old->>'assigned_by')::uuid)
      then return new; end if;
    end if;
  elsif tg_table_name='role_permissions' then
    select organization_id into tenant from public.roles where id=(data->>'role_id')::uuid;
  end if;
  if tenant is null then raise exception using errcode='23514',message='Tenant is required.'; end if;
  if auth.uid() is not null and tenant is distinct from public.current_organization_id() then
    raise exception using errcode='42501',message='Tenant mismatch.';
  end if;
  if tg_op='UPDATE' and data ? 'organization_id' then
    old_data:=to_jsonb(old);
    if data->>'organization_id' is distinct from old_data->>'organization_id' then
      raise exception using errcode='23514',message='Tenant is immutable.';
    end if;
  end if;
  for i in 0..tg_nargs-1 loop
    parts:=string_to_array(tg_argv[i],':');
    -- FK SET NULL actions may update two columns in successive trigger calls.
    -- Validate changed references, not an unchanged reference being deleted by
    -- that same FK cascade. Existing legacy inconsistencies are not rewritten.
    if tg_op='UPDATE' and data->parts[1] is not distinct from old_data->parts[1] then continue; end if;
    ref_id:=nullif(data->>parts[1],'')::uuid;
    if ref_id is not null then
      execute format('select organization_id from public.%I where id=$1',parts[2]) into ref_tenant using ref_id;
      if ref_tenant is distinct from tenant then
        raise exception using errcode='23514',message='Foreign reference must belong to the same organization.';
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function momo_core_private.guard_tenant_references() from public,anon,authenticated;
