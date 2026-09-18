create extension if not exists pgcrypto;

create type public.profile_status as enum ('invited', 'active', 'disabled');
create type public.lead_status as enum ('new', 'no_answer', 'unreachable', 'follow_up', 'call_back', 'converted', 'dropped', 'cancelled', 'other');
create type public.order_status as enum ('new', 'preparing', 'in_transit', 'delivered', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Asia/Ulaanbaatar',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete restrict,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  phone text,
  department text,
  position text,
  status public.profile_status not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.permissions (
  code text primary key,
  module text not null,
  description text not null
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_code)
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.facebook_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  external_page_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  legacy_id text,
  sku text not null,
  name text not null,
  department text,
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  discount_price numeric(14,2) not null default 0 check (discount_price >= 0),
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.inventory_balances (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (warehouse_id, product_id)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening', 'income', 'sale', 'return', 'adjustment', 'transfer')),
  quantity_delta integer not null check (quantity_delta <> 0),
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.lead_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facebook_page_id uuid references public.facebook_pages(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  source_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid references public.lead_batches(id) on delete set null,
  facebook_page_id uuid references public.facebook_pages(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  customer_name text not null default 'Нэргүй',
  phone text not null,
  phone_normalized text not null check (phone_normalized ~ '^[0-9]{8}$'),
  comment text,
  assigned_operator_id uuid references public.profiles(id) on delete set null,
  status public.lead_status not null default 'new',
  call_attempts integer not null default 0 check (call_attempts >= 0),
  last_called_at timestamptz,
  converted_order_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.call_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  operator_id uuid references public.profiles(id) on delete set null,
  result public.lead_status not null,
  note text,
  called_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_number bigint generated always as identity,
  lead_id uuid references public.leads(id) on delete set null,
  facebook_page_id uuid references public.facebook_pages(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  customer_name text not null,
  phone text not null,
  phone_normalized text not null check (phone_normalized ~ '^[0-9]{8}$'),
  delivery_address text not null,
  product_total numeric(14,2) not null default 0 check (product_total >= 0),
  collect_amount numeric(14,2) not null default 0 check (collect_amount >= 0),
  status public.order_status not null default 'new',
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, order_number)
);

alter table public.leads
  add constraint leads_converted_order_fk foreign key (converted_order_id) references public.orders(id) on delete set null;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now()
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  courier_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'assigned', 'in_transit', 'delivered', 'failed', 'returned')),
  assigned_at timestamptz,
  delivered_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index leads_org_status_idx on public.leads (organization_id, status, created_at desc);
create index leads_phone_idx on public.leads (organization_id, phone_normalized, created_at desc);
create index orders_org_status_idx on public.orders (organization_id, status, created_at desc);
create index orders_daily_phone_idx on public.orders (organization_id, phone_normalized, created_at desc);
create index call_logs_lead_idx on public.call_logs (lead_id, called_at desc);
create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['organizations','profiles','roles','branches','facebook_pages','categories','products','warehouses','leads','orders','deliveries']
  loop
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.call_logs;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.inventory_balances;
