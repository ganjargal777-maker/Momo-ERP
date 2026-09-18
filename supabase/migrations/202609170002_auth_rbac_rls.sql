insert into public.permissions (code, module, description) values
  ('dashboard.view', 'dashboard', 'Дашбоард харах'),
  ('users.read', 'users', 'Хэрэглэгч харах'),
  ('users.manage', 'users', 'Хэрэглэгч болон эрх удирдах'),
  ('settings.manage', 'settings', 'Системийн тохиргоо удирдах'),
  ('pages.read', 'facebook_pages', 'Facebook page харах'),
  ('pages.manage', 'facebook_pages', 'Facebook page удирдах'),
  ('products.read', 'products', 'Бараа харах'),
  ('products.manage', 'products', 'Бараа удирдах'),
  ('inventory.read', 'inventory', 'Үлдэгдэл харах'),
  ('inventory.manage', 'inventory', 'Агуулахын хөдөлгөөн удирдах'),
  ('leads.read', 'leads', 'Дугаар харах'),
  ('leads.create', 'leads', 'Дугаар үүсгэх'),
  ('leads.update', 'leads', 'Дугаар болон төлөв шинэчлэх'),
  ('leads.assign', 'leads', 'Операторт дугаар хуваарилах'),
  ('calls.create', 'calls', 'Залгалт бүртгэх'),
  ('orders.read', 'orders', 'Захиалга харах'),
  ('orders.create', 'orders', 'Захиалга үүсгэх'),
  ('orders.update', 'orders', 'Захиалга шинэчлэх'),
  ('orders.cancel', 'orders', 'Захиалга цуцлах'),
  ('deliveries.read', 'deliveries', 'Хүргэлт харах'),
  ('deliveries.manage', 'deliveries', 'Хүргэлт удирдах'),
  ('reports.view', 'reports', 'Тайлан харах'),
  ('finance.view', 'finance', 'Санхүү харах'),
  ('finance.manage', 'finance', 'Санхүү удирдах')
on conflict (code) do update set module = excluded.module, description = excluded.description;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.has_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.role_permissions rp on rp.role_id = r.id
    where ur.user_id = auth.uid()
      and r.organization_id = public.current_organization_id()
      and rp.permission_code = required_permission
  )
$$;

revoke all on function public.current_organization_id() from public;
revoke all on function public.has_permission(text) from public;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.has_permission(text) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_org uuid;
begin
  requested_org := coalesce(
    nullif(new.raw_app_meta_data ->> 'organization_id', '')::uuid,
    nullif(new.raw_user_meta_data ->> 'organization_id', '')::uuid
  );

  insert into public.profiles (id, organization_id, email, first_name, last_name, phone, status)
  values (
    new.id,
    requested_org,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    new.raw_user_meta_data ->> 'phone',
    case when new.email_confirmed_at is null then 'invited'::public.profile_status else 'active'::public.profile_status end
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    phone = excluded.phone,
    updated_at = now();

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.provision_default_roles(target_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role uuid;
  manager_role uuid;
  operator_role uuid;
begin
  insert into public.roles (organization_id, name, description, is_system)
  values (target_org, 'Admin', 'Системийн бүх эрх', true)
  on conflict (organization_id, name) do update set description = excluded.description
  returning id into admin_role;

  insert into public.roles (organization_id, name, description, is_system)
  values (target_org, 'Manager', 'Борлуулалт, оператор болон тайлан удирдах', true)
  on conflict (organization_id, name) do update set description = excluded.description
  returning id into manager_role;

  insert into public.roles (organization_id, name, description, is_system)
  values (target_org, 'Operator', 'Дугаар руу залгаж захиалга үүсгэх', true)
  on conflict (organization_id, name) do update set description = excluded.description
  returning id into operator_role;

  insert into public.role_permissions (role_id, permission_code)
  select admin_role, code from public.permissions
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission_code)
  select manager_role, code from public.permissions
  where code in (
    'dashboard.view','users.read','pages.read','products.read','inventory.read',
    'leads.read','leads.create','leads.update','leads.assign','calls.create',
    'orders.read','orders.create','orders.update','orders.cancel',
    'deliveries.read','deliveries.manage','reports.view','finance.view'
  ) on conflict do nothing;

  insert into public.role_permissions (role_id, permission_code)
  select operator_role, code from public.permissions
  where code in (
    'dashboard.view','pages.read','products.read','leads.read','leads.create',
    'leads.update','calls.create','orders.read','orders.create','orders.update'
  ) on conflict do nothing;
end;
$$;

revoke all on function public.provision_default_roles(uuid) from public, anon, authenticated;

create or replace function public.bootstrap_first_admin(owner_user_id uuid, organization_name text, organization_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org uuid;
  admin_role uuid;
begin
  if exists (select 1 from public.organizations) then
    raise exception 'Bootstrap is only available before the first organization is created';
  end if;

  if not exists (select 1 from auth.users where id = owner_user_id) then
    raise exception 'Auth user does not exist';
  end if;

  insert into public.organizations (name, slug)
  values (organization_name, organization_slug)
  returning id into new_org;

  update public.profiles
  set organization_id = new_org, status = 'active'
  where id = owner_user_id;

  perform public.provision_default_roles(new_org);

  select id into admin_role from public.roles
  where organization_id = new_org and name = 'Admin';

  insert into public.user_roles (user_id, role_id)
  values (owner_user_id, admin_role)
  on conflict do nothing;

  insert into public.branches (organization_id, name) values (new_org, 'Төв салбар');
  insert into public.warehouses (organization_id, branch_id, name)
  select new_org, id, 'Үндсэн агуулах' from public.branches
  where organization_id = new_org and name = 'Төв салбар';

  insert into public.facebook_pages (organization_id, name) values
    (new_org, '19900 хүргэлт үнэгүй'),
    (new_org, 'Ebrand - Интернет дэлгүүр'),
    (new_org, 'MD интернет дэлгүүр'),
    (new_org, 'MOMO'),
    (new_org, 'Midnight MN'),
    (new_org, 'Momoshop.mn');

  return new_org;
end;
$$;

revoke all on function public.bootstrap_first_admin(uuid, text, text) from public, anon, authenticated;

create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    raise exception 'Profile email is managed through Supabase Authentication';
  end if;

  if auth.uid() = old.id and not public.has_permission('users.manage') then
    if new.organization_id is distinct from old.organization_id or new.status is distinct from old.status then
      raise exception 'Only an administrator can change organization or account status';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_profile_security_fields
  before update on public.profiles
  for each row execute function public.protect_profile_security_fields();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.branches enable row level security;
alter table public.facebook_pages enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.warehouses enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.lead_batches enable row level security;
alter table public.leads enable row level security;
alter table public.call_logs enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.deliveries enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using (id = public.current_organization_id());
create policy organizations_update on public.organizations for update to authenticated
  using (id = public.current_organization_id() and public.has_permission('settings.manage'))
  with check (id = public.current_organization_id() and public.has_permission('settings.manage'));

create policy profiles_select on public.profiles for select to authenticated
  using (organization_id = public.current_organization_id());
create policy profiles_update_self_or_admin on public.profiles for update to authenticated
  using (organization_id = public.current_organization_id() and (id = auth.uid() or public.has_permission('users.manage')))
  with check (organization_id = public.current_organization_id() and (id = auth.uid() or public.has_permission('users.manage')));

create policy permissions_select on public.permissions for select to authenticated using (true);
create policy roles_select on public.roles for select to authenticated
  using (organization_id = public.current_organization_id());
create policy roles_manage on public.roles for all to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('users.manage'))
  with check (organization_id = public.current_organization_id() and public.has_permission('users.manage'));
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and r.organization_id = public.current_organization_id()));
create policy role_permissions_manage on public.role_permissions for all to authenticated
  using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));
create policy user_roles_select on public.user_roles for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = user_id and p.organization_id = public.current_organization_id()));
create policy user_roles_manage on public.user_roles for all to authenticated
  using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));

do $$
declare
  target_table text;
  read_permission text;
  insert_permission text;
  update_permission text;
  delete_permission text;
begin
  for target_table, read_permission, insert_permission, update_permission, delete_permission in
    select * from (values
      ('branches','dashboard.view','settings.manage','settings.manage','settings.manage'),
      ('facebook_pages','pages.read','pages.manage','pages.manage','pages.manage'),
      ('categories','products.read','products.manage','products.manage','products.manage'),
      ('products','products.read','products.manage','products.manage','products.manage'),
      ('warehouses','inventory.read','inventory.manage','inventory.manage','inventory.manage'),
      ('inventory_balances','inventory.read','inventory.manage','inventory.manage','inventory.manage'),
      ('inventory_movements','inventory.read','inventory.manage','inventory.manage','inventory.manage'),
      ('lead_batches','leads.read','leads.create','leads.update','leads.update'),
      ('leads','leads.read','leads.create','leads.update','leads.update'),
      ('call_logs','leads.read','calls.create','calls.create','calls.create'),
      ('orders','orders.read','orders.create','orders.update','orders.cancel'),
      ('order_items','orders.read','orders.create','orders.update','orders.cancel'),
      ('order_status_history','orders.read','orders.create','orders.update','orders.cancel'),
      ('deliveries','deliveries.read','deliveries.manage','deliveries.manage','deliveries.manage')
    ) as policies(table_name, read_code, insert_code, update_code, delete_code)
  loop
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = public.current_organization_id() and public.has_permission(%L))',
      target_table, target_table, read_permission
    );
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (organization_id = public.current_organization_id() and public.has_permission(%L))',
      target_table, target_table, insert_permission
    );
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (organization_id = public.current_organization_id() and public.has_permission(%L)) with check (organization_id = public.current_organization_id() and public.has_permission(%L))',
      target_table, target_table, update_permission, update_permission
    );
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (organization_id = public.current_organization_id() and public.has_permission(%L))',
      target_table, target_table, delete_permission
    );
  end loop;
end $$;

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id = public.current_organization_id() and public.has_permission('reports.view'));
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (organization_id = public.current_organization_id() and actor_id = auth.uid());

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select on public.organizations, public.permissions to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.roles, public.role_permissions, public.user_roles to authenticated;
grant select, insert, update, delete on public.branches, public.facebook_pages, public.categories,
  public.products, public.warehouses, public.inventory_balances, public.inventory_movements,
  public.lead_batches, public.leads, public.call_logs, public.orders, public.order_items,
  public.order_status_history, public.deliveries to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;
