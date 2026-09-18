do $$
declare
  new_organization_id uuid;
  expected_user_id constant uuid := 'd12c65af-eaea-46c7-a07d-9cbac8f0e057'::uuid;
  auth_user_count integer;
  expected_user_exists boolean;
  observed_user_ids text;
begin
  select count(*),
         bool_or(id = expected_user_id),
         string_agg(id::text, ', ' order by created_at)
  into auth_user_count, expected_user_exists, observed_user_ids
  from auth.users;

  if not coalesce(expected_user_exists, false) then
    raise exception 'Bootstrap diagnostic: database=%, current_user=%, auth_user_count=%, expected_uid=%, observed_uids=%',
      current_database(), current_user, auth_user_count, expected_user_id, coalesce(observed_user_ids, '(none)');
  end if;

  select public.bootstrap_first_admin(
    expected_user_id,
    'Momo ERP',
    'momo-erp'
  ) into new_organization_id;

  if new_organization_id is null then
    raise exception 'Momo ERP bootstrap did not create an organization';
  end if;

  if not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = expected_user_id
      and r.organization_id = new_organization_id
      and r.name = 'Admin'
  ) then
    raise exception 'Momo ERP bootstrap did not assign the Admin role';
  end if;

  if not exists (
    select 1 from public.branches b
    where b.organization_id = new_organization_id and b.name = 'Төв салбар'
  ) then
    raise exception 'Momo ERP bootstrap did not create the default branch';
  end if;

  if not exists (
    select 1 from public.warehouses w
    where w.organization_id = new_organization_id and w.name = 'Үндсэн агуулах'
  ) then
    raise exception 'Momo ERP bootstrap did not create the default warehouse';
  end if;
end $$;
