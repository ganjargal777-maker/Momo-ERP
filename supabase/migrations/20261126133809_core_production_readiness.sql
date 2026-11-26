-- Additive, reviewed local preparation. No seed data or automatic production run.
create schema if not exists momo_core_private;
revoke all on schema momo_core_private from public, anon, authenticated;

alter table public.orders add column if not exists warehouse_id uuid references public.warehouses(id) on delete restrict;
alter table public.orders add column if not exists inventory_reserved boolean not null default false;
alter table public.orders add column if not exists reservation_released boolean not null default false;
alter table public.orders add column if not exists delivered_at timestamptz;
alter table public.orders add column if not exists is_demo boolean not null default false;
alter table public.leads add column if not exists is_demo boolean not null default false;
-- NOT VALID preserves legacy rows for review; all new/changed rows must be finite.
alter table public.products add constraint core_finite_prices check(sale_price<1000000000000 and discount_price<1000000000000 and cost_price<1000000000000) not valid;

create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  entry_type text not null check(entry_type in ('income','expense')),
  amount numeric(14,2) not null check(amount > 0 and amount<1000000000000),
  description text not null check(length(trim(description)) between 1 and 1000),
  order_id uuid references public.orders(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  is_demo boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.finance_entries enable row level security;
create policy finance_entries_select on public.finance_entries for select to authenticated
using(organization_id=public.current_organization_id() and public.has_permission('finance.view'));
revoke all on public.finance_entries from anon, authenticated;
grant select on public.finance_entries to authenticated;
create index finance_entries_org_date_idx on public.finance_entries(organization_id,occurred_at desc);
create index finance_entries_order_idx on public.finance_entries(order_id) where order_id is not null;

create table momo_core_private.operation_receipts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null, request_id uuid not null, request_hash text not null,
  response jsonb not null, created_at timestamptz not null default now(),
  primary key(organization_id,actor_id,operation,request_id)
);
revoke all on momo_core_private.operation_receipts from public,anon,authenticated;

-- Authorization uses app-owned metadata only. A signup cannot choose a tenant.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare requested_org uuid;
begin
  requested_org := nullif(new.raw_app_meta_data->>'organization_id','')::uuid;
  insert into public.profiles(id,organization_id,email,first_name,last_name,phone,status)
  values(new.id,requested_org,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'first_name',''),
    coalesce(new.raw_user_meta_data->>'last_name',''),new.raw_user_meta_data->>'phone',
    case when new.email_confirmed_at is null then 'invited'::public.profile_status else 'active'::public.profile_status end)
  on conflict(id) do update set email=excluded.email,first_name=excluded.first_name,last_name=excluded.last_name,
    phone=excluded.phone,updated_at=now();
  return new;
end $$;
revoke all on function public.handle_new_auth_user() from public,anon,authenticated;
revoke all on function public.set_updated_at() from public,anon,authenticated;

create function momo_core_private.guard_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null then
    if new.organization_id is distinct from old.organization_id or new.id<>old.id then
      raise exception using errcode='42501',message='Profile tenant and identity are immutable.';
    end if;
    if not public.has_permission('users.manage') and
      (new.status is distinct from old.status or new.email is distinct from old.email
       or new.department is distinct from old.department or new.position is distinct from old.position
       or new.employment_start_date is distinct from old.employment_start_date) then
      raise exception using errcode='42501',message='Profile privilege fields require users.manage.';
    end if;
  end if;
  return new;
end $$;
create trigger core_guard_profile before update on public.profiles
for each row execute function momo_core_private.guard_profile();

-- Same-org foreign references are checked even when a writer knows a foreign UUID.
-- This private trigger only validates constraints; it never returns foreign data.
create function momo_core_private.guard_tenant_references() returns trigger
language plpgsql security definer set search_path='' as $$
declare data jsonb:=to_jsonb(new); old_data jsonb; tenant uuid; ref_id uuid; ref_tenant uuid; i integer; parts text[];
begin
  tenant:=(data->>'organization_id')::uuid;
  if tg_table_name='user_roles' then
    select organization_id into tenant from public.profiles where id=(data->>'user_id')::uuid;
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
create trigger core_refs_products before insert or update on public.products for each row execute function momo_core_private.guard_tenant_references('category_id:categories','created_by:profiles','updated_by:profiles');
create trigger core_refs_warehouses before insert or update on public.warehouses for each row execute function momo_core_private.guard_tenant_references('branch_id:branches');
create trigger core_refs_balances before insert or update on public.inventory_balances for each row execute function momo_core_private.guard_tenant_references('warehouse_id:warehouses','product_id:products');
create trigger core_refs_movements before insert or update on public.inventory_movements for each row execute function momo_core_private.guard_tenant_references('warehouse_id:warehouses','product_id:products','created_by:profiles');
create trigger core_refs_batches before insert or update on public.lead_batches for each row execute function momo_core_private.guard_tenant_references('facebook_page_id:facebook_pages','product_id:products','created_by:profiles');
create trigger core_refs_leads before insert or update on public.leads for each row execute function momo_core_private.guard_tenant_references('batch_id:lead_batches','facebook_page_id:facebook_pages','product_id:products','assigned_operator_id:profiles','converted_order_id:orders','created_by:profiles','updated_by:profiles');
create trigger core_refs_calls before insert or update on public.call_logs for each row execute function momo_core_private.guard_tenant_references('lead_id:leads','operator_id:profiles');
create trigger core_refs_orders before insert or update on public.orders for each row execute function momo_core_private.guard_tenant_references('lead_id:leads','facebook_page_id:facebook_pages','branch_id:branches','warehouse_id:warehouses','created_by:profiles','updated_by:profiles');
create trigger core_refs_items before insert or update on public.order_items for each row execute function momo_core_private.guard_tenant_references('order_id:orders','product_id:products');
create trigger core_refs_history before insert or update on public.order_status_history for each row execute function momo_core_private.guard_tenant_references('order_id:orders','changed_by:profiles');
create trigger core_refs_deliveries before insert or update on public.deliveries for each row execute function momo_core_private.guard_tenant_references('order_id:orders','courier_id:profiles');
create trigger core_refs_finance before insert or update on public.finance_entries for each row execute function momo_core_private.guard_tenant_references('order_id:orders','created_by:profiles');
create trigger core_refs_user_roles before insert or update on public.user_roles for each row execute function momo_core_private.guard_tenant_references('user_id:profiles','role_id:roles','assigned_by:profiles');
create trigger core_refs_role_permissions before insert or update on public.role_permissions for each row execute function momo_core_private.guard_tenant_references('role_id:roles');

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select to authenticated using(
  exists(select 1 from public.roles r where r.id=role_id and r.organization_id=public.current_organization_id())
  and (public.has_assigned_role(role_id) or public.has_permission('users.read') or public.has_permission('users.manage')));
drop policy if exists role_permissions_manage on public.role_permissions;
create policy role_permissions_manage on public.role_permissions for all to authenticated
using(public.has_permission('users.manage') and exists(select 1 from public.roles r where r.id=role_id and r.organization_id=public.current_organization_id()))
with check(public.has_permission('users.manage') and exists(select 1 from public.roles r where r.id=role_id and r.organization_id=public.current_organization_id()));
drop policy if exists user_roles_manage on public.user_roles;
create policy user_roles_manage on public.user_roles for all to authenticated
using(public.has_permission('users.manage') and exists(select 1 from public.profiles p where p.id=user_id and p.organization_id=public.current_organization_id()) and exists(select 1 from public.roles r where r.id=role_id and r.organization_id=public.current_organization_id()))
with check(public.has_permission('users.manage') and exists(select 1 from public.profiles p where p.id=user_id and p.organization_id=public.current_organization_id()) and exists(select 1 from public.roles r where r.id=role_id and r.organization_id=public.current_organization_id()));

create function momo_core_private.require_permission(permission text) returns uuid
language plpgsql stable set search_path='' as $$
declare tenant uuid:=public.current_organization_id();
begin
  if auth.uid() is null or tenant is null or not public.has_permission(permission) then
    raise exception using errcode='42501',message='Active organization and permission required.';
  end if;
  return tenant;
end $$;
create function momo_core_private.check_payload(payload jsonb,keys text[]) returns void
language plpgsql immutable set search_path='' as $$
begin
  if payload is null or jsonb_typeof(payload)<>'object' or exists(select 1 from jsonb_object_keys(payload) k where not k=any(keys)) then
    raise exception using errcode='22023',message='Invalid payload fields.';
  end if;
end $$;
create function momo_core_private.required_text(value text,maximum integer) returns text
language plpgsql immutable set search_path='' as $$
begin
  if value is null or length(trim(value))<1 or length(value)>maximum then raise exception using errcode='22023',message='Required text is invalid.'; end if;
  return trim(value);
end $$;
create function momo_core_private.phone(value text) returns text language plpgsql immutable set search_path='' as $$
declare result text:=regexp_replace(coalesce(value,''),'[^0-9]','','g');
begin
  if length(result)=11 and left(result,3)='976' then result:=substring(result from 4); end if;
  if result !~ '^[0-9]{8}$' then raise exception using errcode='22023',message='Eight-digit phone required.'; end if;
  return result;
end $$;
create function momo_core_private.assert_ref(table_name text,reference_id uuid,tenant uuid) returns void
language plpgsql set search_path='' as $$
declare found_org uuid;
begin
  if reference_id is null then return; end if;
  if not table_name=any(array['products','warehouses','branches','facebook_pages','leads','orders','profiles','categories']) then raise exception 'Invalid internal reference table'; end if;
  execute format('select organization_id from public.%I where id=$1',table_name) into found_org using reference_id;
  if found_org is distinct from tenant then raise exception using errcode='23514',message='Reference does not belong to organization.'; end if;
end $$;
create function momo_core_private.receipt(operation_name text,payload jsonb,tenant uuid) returns jsonb
language plpgsql set search_path='' as $$
declare request uuid:=(payload->>'request_id')::uuid; previous momo_core_private.operation_receipts;
begin
  if request is null then raise exception using errcode='22023',message='request_id is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(tenant,auth.uid(),operation_name,request)::text,0));
  select * into previous from momo_core_private.operation_receipts where organization_id=tenant and actor_id=auth.uid() and operation=operation_name and request_id=request;
  if found then
    if previous.request_hash<>encode(sha256(convert_to(payload::text,'UTF8')),'hex') then raise exception using errcode='23505',message='Idempotency key conflicts with previous payload.'; end if;
    return previous.response;
  end if;
  return null;
end $$;
create function momo_core_private.save_receipt(operation_name text,payload jsonb,tenant uuid,result jsonb) returns void
language sql set search_path='' as $$
  insert into momo_core_private.operation_receipts(organization_id,actor_id,operation,request_id,request_hash,response)
  values(tenant,auth.uid(),operation_name,(payload->>'request_id')::uuid,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),result)
$$;
create function momo_core_private.audit(action_name text,kind text,target text,data jsonb default '{}'::jsonb) returns void
language sql set search_path='' as $$
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(public.current_organization_id(),auth.uid(),action_name,kind,target,data)
$$;

-- Privileged atomic workflows derive tenant/actor from the verified JWT, check
-- named permissions, validate every reference and never accept caller totals.
create function public.core_save_product(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=momo_core_private.require_permission('products.manage'); row public.products; target uuid:=nullif(payload->>'id','')::uuid;
begin
  perform momo_core_private.check_payload(payload,array['id','sku','name','category_id','sale_price','discount_price','cost_price','is_active','expected_updated_at']);
  perform momo_core_private.assert_ref('categories',nullif(payload->>'category_id','')::uuid,tenant);
  if target is null then
    insert into public.products(organization_id,sku,name,category_id,sale_price,discount_price,cost_price,is_active,created_by,updated_by)
    values(tenant,momo_core_private.required_text(payload->>'sku',100),momo_core_private.required_text(payload->>'name',500),nullif(payload->>'category_id','')::uuid,
      coalesce((payload->>'sale_price')::numeric,0),coalesce((payload->>'discount_price')::numeric,0),coalesce((payload->>'cost_price')::numeric,0),coalesce((payload->>'is_active')::boolean,true),auth.uid(),auth.uid()) returning * into row;
  else
    update public.products set sku=momo_core_private.required_text(payload->>'sku',100),name=momo_core_private.required_text(payload->>'name',500),category_id=nullif(payload->>'category_id','')::uuid,
      sale_price=coalesce((payload->>'sale_price')::numeric,0),discount_price=coalesce((payload->>'discount_price')::numeric,0),cost_price=coalesce((payload->>'cost_price')::numeric,0),
      is_active=coalesce((payload->>'is_active')::boolean,true),updated_by=auth.uid()
    where id=target and organization_id=tenant and updated_at=(payload->>'expected_updated_at')::timestamptz returning * into row;
    if not found then raise exception using errcode='40001',message='Product version changed or unavailable.'; end if;
  end if;
  perform momo_core_private.audit('core.product.save','product',row.id::text);
  return to_jsonb(row);
end $$;
create function public.core_save_warehouse(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=momo_core_private.require_permission('inventory.manage'); row public.warehouses; target uuid:=nullif(payload->>'id','')::uuid;
begin
  perform momo_core_private.check_payload(payload,array['id','name','branch_id','is_active','expected_updated_at']);
  perform momo_core_private.assert_ref('branches',nullif(payload->>'branch_id','')::uuid,tenant);
  if target is null then insert into public.warehouses(organization_id,name,branch_id,is_active)
    values(tenant,momo_core_private.required_text(payload->>'name',200),nullif(payload->>'branch_id','')::uuid,coalesce((payload->>'is_active')::boolean,true)) returning * into row;
  else
    update public.warehouses set name=momo_core_private.required_text(payload->>'name',200),branch_id=nullif(payload->>'branch_id','')::uuid,is_active=coalesce((payload->>'is_active')::boolean,true)
    where id=target and organization_id=tenant and updated_at=(payload->>'expected_updated_at')::timestamptz returning * into row;
    if not found then raise exception using errcode='40001',message='Warehouse version changed or unavailable.'; end if;
  end if;
  perform momo_core_private.audit('core.warehouse.save','warehouse',row.id::text); return to_jsonb(row);
end $$;
create function public.core_adjust_inventory(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=momo_core_private.require_permission('inventory.manage'); previous jsonb; row public.inventory_balances; delta integer; warehouse uuid; product uuid; kind text;
begin
  perform momo_core_private.check_payload(payload,array['request_id','warehouse_id','product_id','quantity_delta','movement_type','note']);
  previous:=momo_core_private.receipt('inventory.adjust',payload,tenant); if previous is not null then return previous; end if;
  warehouse:=(payload->>'warehouse_id')::uuid; product:=(payload->>'product_id')::uuid; delta:=(payload->>'quantity_delta')::integer; kind:=payload->>'movement_type';
  if warehouse is null or product is null or delta is null or delta=0 or kind is null or kind not in ('income','adjustment','return') or (kind in ('income','return') and delta<1) then raise exception using errcode='22023',message='Invalid stock adjustment.'; end if;
  perform momo_core_private.assert_ref('warehouses',warehouse,tenant); perform momo_core_private.assert_ref('products',product,tenant);
  insert into public.inventory_balances(organization_id,warehouse_id,product_id,quantity) values(tenant,warehouse,product,0) on conflict do nothing;
  update public.inventory_balances set quantity=quantity+delta,updated_at=clock_timestamp() where warehouse_id=warehouse and product_id=product and organization_id=tenant returning * into row;
  insert into public.inventory_movements(organization_id,warehouse_id,product_id,movement_type,quantity_delta,note,created_by) values(tenant,warehouse,product,kind,delta,left(payload->>'note',1000),auth.uid());
  perform momo_core_private.audit('core.inventory.adjust','inventory',product::text,jsonb_build_object('warehouseId',warehouse,'delta',delta));
  perform momo_core_private.save_receipt('inventory.adjust',payload,tenant,to_jsonb(row)); return to_jsonb(row);
end $$;

create function public.core_create_order(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<order_mutation>>
declare tenant uuid:=momo_core_private.require_permission('orders.create'); previous jsonb; row public.orders; item jsonb; product public.products;
  warehouse uuid:=(payload->>'warehouse_id')::uuid; stock integer; quantity integer; total numeric:=0; price numeric; order_id uuid:=gen_random_uuid(); phone text; lead public.leads;
begin
  perform momo_core_private.check_payload(payload,array['request_id','customer_name','phone','delivery_address','facebook_page_id','lead_id','branch_id','warehouse_id','items','collect_amount','note']);
  previous:=momo_core_private.receipt('order.create',payload,tenant); if previous is not null then return previous; end if;
  phone:=momo_core_private.phone(payload->>'phone');
  if warehouse is null or jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 100 then raise exception using errcode='22023',message='Warehouse and 1-100 items required.'; end if;
  perform momo_core_private.assert_ref('warehouses',warehouse,tenant);
  if not exists(select 1 from public.warehouses where id=warehouse and is_active) then raise exception using errcode='22023',message='Warehouse inactive.'; end if;
  perform momo_core_private.assert_ref('facebook_pages',nullif(payload->>'facebook_page_id','')::uuid,tenant);
  perform momo_core_private.assert_ref('branches',nullif(payload->>'branch_id','')::uuid,tenant);
  perform momo_core_private.assert_ref('leads',nullif(payload->>'lead_id','')::uuid,tenant);
  if payload->>'lead_id' is not null then
    select * into lead from public.leads where id=(payload->>'lead_id')::uuid for update;
    if lead.converted_order_id is not null or lead.is_demo then raise exception using errcode='23505',message='Lead already converted or demo.'; end if;
  end if;
  if (select count(*)<>count(distinct value->>'product_id') from jsonb_array_elements(payload->'items')) then raise exception using errcode='22023',message='Duplicate product lines are not allowed.'; end if;
  -- All stock locks are acquired in product UUID order to avoid item-order deadlocks.
  for item in select value from jsonb_array_elements(payload->'items') order by value->>'product_id' loop
    perform momo_core_private.check_payload(item,array['product_id','quantity']); quantity:=(item->>'quantity')::integer;
    if quantity is null or quantity<1 or quantity>100000 then raise exception using errcode='22023',message='Invalid item quantity.'; end if;
    select * into product from public.products where id=(item->>'product_id')::uuid and organization_id=tenant and is_active for share;
    if not found then raise exception using errcode='23514',message='Product unavailable.'; end if;
    select b.quantity into stock from public.inventory_balances b where b.organization_id=tenant and b.warehouse_id=warehouse and b.product_id=product.id for update;
    if stock is null or stock<quantity then raise exception using errcode='23514',message='Insufficient inventory.'; end if;
    price:=case when product.discount_price>0 and product.discount_price<product.sale_price then product.discount_price else product.sale_price end;
    total:=total+quantity*price;
  end loop;
  if payload ? 'collect_amount' and ((payload->>'collect_amount')::numeric<0 or (payload->>'collect_amount')::numeric>total) then raise exception using errcode='22023',message='Collect amount must be between zero and product total.'; end if;
  insert into public.orders(id,organization_id,customer_name,phone,phone_normalized,delivery_address,facebook_page_id,lead_id,branch_id,warehouse_id,inventory_reserved,product_total,collect_amount,note,created_by,updated_by)
  values(order_id,tenant,momo_core_private.required_text(payload->>'customer_name',200),phone,phone,momo_core_private.required_text(payload->>'delivery_address',2000),nullif(payload->>'facebook_page_id','')::uuid,
    nullif(payload->>'lead_id','')::uuid,nullif(payload->>'branch_id','')::uuid,warehouse,true,total,coalesce((payload->>'collect_amount')::numeric,total),left(payload->>'note',2000),auth.uid(),auth.uid()) returning * into row;
  for item in select value from jsonb_array_elements(payload->'items') order by value->>'product_id' loop
    select * into product from public.products where id=(item->>'product_id')::uuid;
    quantity:=(item->>'quantity')::integer; price:=case when product.discount_price>0 and product.discount_price<product.sale_price then product.discount_price else product.sale_price end;
    insert into public.order_items(organization_id,order_id,product_id,quantity,unit_price) values(tenant,order_id,product.id,quantity,price);
    update public.inventory_balances set quantity=inventory_balances.quantity-order_mutation.quantity,updated_at=clock_timestamp() where warehouse_id=warehouse and product_id=product.id;
    insert into public.inventory_movements(organization_id,warehouse_id,product_id,movement_type,quantity_delta,reference_type,reference_id,created_by)
      values(tenant,warehouse,product.id,'sale',-quantity,'order',order_id,auth.uid());
  end loop;
  insert into public.deliveries(organization_id,order_id) values(tenant,order_id);
  insert into public.order_status_history(organization_id,order_id,to_status,changed_by) values(tenant,order_id,'new',auth.uid());
  if row.lead_id is not null then update public.leads set status='converted',converted_order_id=row.id,updated_by=auth.uid() where id=row.lead_id; end if;
  perform momo_core_private.audit('core.order.create','order',row.id::text,jsonb_build_object('productTotal',total));
  perform momo_core_private.save_receipt('order.create',payload,tenant,to_jsonb(row)); return to_jsonb(row);
end $$;

create function public.core_update_order(target_order uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=momo_core_private.require_permission('orders.update'); row public.orders; old_status public.order_status; target_status public.order_status; line record;
begin
  perform momo_core_private.check_payload(payload,array['status','note','expected_updated_at']);
  select * into row from public.orders where id=target_order and organization_id=tenant and not is_demo for update;
  if not found then raise exception using errcode='P0002',message='Order unavailable.'; end if;
  if row.updated_at is distinct from (payload->>'expected_updated_at')::timestamptz then raise exception using errcode='40001',message='Order changed.'; end if;
  target_status:=(payload->>'status')::public.order_status;
  if target_status is null then raise exception using errcode='22023',message='Status required.'; end if;
  old_status:=row.status;
  if target_status<>old_status and target_status in ('in_transit','delivered') then
    perform momo_core_private.require_permission('deliveries.manage');
  end if;
  if old_status in ('delivered','cancelled') and target_status<>old_status then raise exception using errcode='23514',message='Final order cannot be reopened.'; end if;
  if target_status='cancelled' then
    perform momo_core_private.require_permission('orders.cancel');
    if row.inventory_reserved and not row.reservation_released then
      for line in select product_id,quantity from public.order_items where order_id=target_order order by product_id loop
        update public.inventory_balances set quantity=inventory_balances.quantity+line.quantity,updated_at=clock_timestamp() where warehouse_id=row.warehouse_id and product_id=line.product_id;
        insert into public.inventory_movements(organization_id,warehouse_id,product_id,movement_type,quantity_delta,reference_type,reference_id,created_by)
          values(tenant,row.warehouse_id,line.product_id,'return',line.quantity,'order',row.id,auth.uid());
      end loop;
      row.reservation_released:=true;
    end if;
  end if;
  update public.orders set status=target_status,note=case when payload ? 'note' then left(payload->>'note',2000) else note end,
    reservation_released=row.reservation_released,delivered_at=case when target_status='delivered' then coalesce(delivered_at,clock_timestamp()) else delivered_at end,updated_by=auth.uid()
  where id=target_order returning * into row;
  if old_status<>target_status then
    insert into public.order_status_history(organization_id,order_id,from_status,to_status,changed_by) values(tenant,row.id,old_status,target_status,auth.uid());
    if target_status in ('delivered','in_transit') then update public.deliveries set status=target_status::text,delivered_at=case when target_status='delivered' then coalesce(delivered_at,clock_timestamp()) else delivered_at end where order_id=row.id; end if;
  end if;
  perform momo_core_private.audit('core.order.update','order',row.id::text,jsonb_build_object('from',old_status,'to',target_status)); return to_jsonb(row);
end $$;

create function public.core_create_leads(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=momo_core_private.require_permission('leads.create'); previous jsonb; contact jsonb; row public.leads; result jsonb:='[]'::jsonb; phone text;
begin
  perform momo_core_private.check_payload(payload,array['request_id','facebook_page_id','product_id','contacts']);
  previous:=momo_core_private.receipt('leads.create',payload,tenant); if previous is not null then return previous; end if;
  if jsonb_typeof(payload->'contacts') is distinct from 'array' or jsonb_array_length(payload->'contacts') not between 1 and 500 then raise exception using errcode='22023',message='1-500 contacts required.'; end if;
  perform momo_core_private.assert_ref('facebook_pages',nullif(payload->>'facebook_page_id','')::uuid,tenant); perform momo_core_private.assert_ref('products',nullif(payload->>'product_id','')::uuid,tenant);
  for contact in select value from jsonb_array_elements(payload->'contacts') loop
    perform momo_core_private.check_payload(contact,array['customer_name','phone','comment']); phone:=momo_core_private.phone(contact->>'phone');
    insert into public.leads(organization_id,facebook_page_id,product_id,customer_name,phone,phone_normalized,comment,assigned_operator_id,created_by,updated_by)
      values(tenant,nullif(payload->>'facebook_page_id','')::uuid,nullif(payload->>'product_id','')::uuid,coalesce(nullif(trim(contact->>'customer_name'),''),'Нэргүй'),phone,phone,left(contact->>'comment',2000),auth.uid(),auth.uid(),auth.uid()) returning * into row;
    result:=result||jsonb_build_array(to_jsonb(row));
  end loop;
  perform momo_core_private.audit('core.leads.create','lead_batch',null,jsonb_build_object('count',jsonb_array_length(result)));
  perform momo_core_private.save_receipt('leads.create',payload,tenant,result); return result;
end $$;
create function public.core_update_lead(target_lead uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=momo_core_private.require_permission('leads.update'); row public.leads; target_status public.lead_status;
begin
  perform momo_core_private.check_payload(payload,array['status','record_call','note','expected_updated_at']);
  select * into row from public.leads where id=target_lead and organization_id=tenant and not is_demo for update;
  if not found then raise exception using errcode='P0002',message='Lead unavailable.'; end if;
  if row.converted_order_id is not null then raise exception using errcode='23514',message='Converted lead cannot be reopened.'; end if;
  if row.updated_at is distinct from (payload->>'expected_updated_at')::timestamptz then raise exception using errcode='40001',message='Lead changed.'; end if;
  target_status:=(payload->>'status')::public.lead_status;
  if target_status is null or target_status='converted' then raise exception using errcode='22023',message='Conversion requires an atomic order.'; end if;
  if coalesce((payload->>'record_call')::boolean,false) then
    perform momo_core_private.require_permission('calls.create');
    insert into public.call_logs(organization_id,lead_id,operator_id,result,note) values(tenant,row.id,auth.uid(),target_status,left(payload->>'note',2000));
  end if;
  update public.leads set status=target_status,call_attempts=call_attempts+case when coalesce((payload->>'record_call')::boolean,false) then 1 else 0 end,
    last_called_at=case when coalesce((payload->>'record_call')::boolean,false) then clock_timestamp() else last_called_at end,updated_by=auth.uid() where id=row.id returning * into row;
  perform momo_core_private.audit('core.lead.update','lead',row.id::text,jsonb_build_object('status',target_status)); return to_jsonb(row);
end $$;
create function public.core_update_delivery(target_order uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=momo_core_private.require_permission('deliveries.manage'); row public.deliveries; order_row public.orders; target_status text:=payload->>'status'; courier uuid:=nullif(payload->>'courier_id','')::uuid;
begin
  perform momo_core_private.check_payload(payload,array['status','courier_id','note','expected_updated_at']);
  if target_status is null or target_status not in ('pending','assigned','in_transit','delivered','failed','returned') then raise exception using errcode='22023',message='Invalid delivery status.'; end if;
  select * into order_row from public.orders where id=target_order and organization_id=tenant and not is_demo for update;
  if not found or order_row.status='cancelled' then raise exception using errcode='23514',message='Order unavailable for delivery.'; end if;
  select * into row from public.deliveries where order_id=target_order and organization_id=tenant for update;
  if not found then raise exception using errcode='P0002',message='Delivery unavailable.'; end if;
  if row.updated_at is distinct from (payload->>'expected_updated_at')::timestamptz then raise exception using errcode='40001',message='Delivery changed.'; end if;
  if row.status='delivered' and target_status<>'delivered' then raise exception using errcode='23514',message='Final delivery cannot be reopened.'; end if;
  perform momo_core_private.assert_ref('profiles',courier,tenant);
  if courier is not null and not exists(select 1 from public.profiles where id=courier and status='active') then raise exception using errcode='23514',message='Courier inactive.'; end if;
  update public.deliveries set status=target_status,courier_id=courier,note=case when payload ? 'note' then left(payload->>'note',2000) else note end,
    assigned_at=case when courier is not null then coalesce(assigned_at,clock_timestamp()) else assigned_at end,
    delivered_at=case when target_status='delivered' then coalesce(delivered_at,clock_timestamp()) else delivered_at end where id=row.id returning * into row;
  if target_status in ('delivered','in_transit') and order_row.status::text<>target_status then
    update public.orders set status=target_status::public.order_status,delivered_at=case when target_status='delivered' then coalesce(delivered_at,clock_timestamp()) else delivered_at end,updated_by=auth.uid() where id=target_order;
    insert into public.order_status_history(organization_id,order_id,from_status,to_status,changed_by) values(tenant,target_order,order_row.status,target_status::public.order_status,auth.uid());
  end if;
  perform momo_core_private.audit('core.delivery.update','delivery',row.id::text,jsonb_build_object('status',target_status)); return to_jsonb(row);
end $$;
create function public.core_record_finance(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid:=momo_core_private.require_permission('finance.manage'); previous jsonb; row public.finance_entries; amount numeric:=(payload->>'amount')::numeric; kind text:=payload->>'entry_type';
begin
  perform momo_core_private.check_payload(payload,array['request_id','entry_type','amount','description','order_id','occurred_at']);
  previous:=momo_core_private.receipt('finance.record',payload,tenant); if previous is not null then return previous; end if;
  if amount is null or amount<=0 or kind is null or kind not in ('income','expense') then raise exception using errcode='22023',message='Positive cash amount and entry type required.'; end if;
  perform momo_core_private.assert_ref('orders',nullif(payload->>'order_id','')::uuid,tenant);
  if exists(select 1 from public.orders where id=nullif(payload->>'order_id','')::uuid and is_demo) then raise exception using errcode='23514',message='Demo order cannot enter production finance.'; end if;
  insert into public.finance_entries(organization_id,entry_type,amount,description,order_id,occurred_at,created_by)
    values(tenant,kind,amount,momo_core_private.required_text(payload->>'description',1000),nullif(payload->>'order_id','')::uuid,coalesce((payload->>'occurred_at')::timestamptz,clock_timestamp()),auth.uid()) returning * into row;
  perform momo_core_private.audit('core.finance.record','finance_entry',row.id::text,jsonb_build_object('type',kind,'amount',amount));
  perform momo_core_private.save_receipt('finance.record',payload,tenant,to_jsonb(row)); return to_jsonb(row);
end $$;

-- Order creation needs warehouse identity, not inventory quantities/cost rights.
create function public.core_order_options() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=momo_core_private.require_permission('orders.create'); result jsonb;
begin
  select jsonb_build_object('source','supabase','warehouses',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb))
  into result from public.warehouses where organization_id=tenant and is_active;
  return result;
end $$;

create function public.core_dashboard_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.current_organization_id(); zone text; today date; month date; result jsonb; stock jsonb; cash jsonb;
  metrics_allowed boolean:=public.has_permission('dashboard.view') or public.has_permission('reports.view');
begin
  if auth.uid() is null or tenant is null or not (metrics_allowed or public.has_permission('finance.view')) then
    raise exception using errcode='42501',message='Dashboard, reports or finance permission required.';
  end if;
  select timezone into zone from public.organizations where id=tenant;
  today:=(now() at time zone zone)::date; month:=date_trunc('month',today)::date;
  if public.has_permission('inventory.read') and public.has_permission('products.read') then
    select jsonb_build_object('products',(select count(*) from public.products where organization_id=tenant and is_active),
      'lowStock',count(*) filter(where b.quantity between 1 and 5),'outOfStock',count(*) filter(where b.quantity=0),
      'stockCost',case when public.has_permission('finance.view') then coalesce(sum(b.quantity*p.cost_price),0) else null end)
      into stock from public.inventory_balances b join public.products p on p.id=b.product_id and p.organization_id=tenant where b.organization_id=tenant;
  end if;
  if public.has_permission('finance.view') then
    select jsonb_build_object('month',month,'income',coalesce(sum(amount) filter(where entry_type='income'),0),
      'expense',coalesce(sum(amount) filter(where entry_type='expense'),0),
      'netCashflow',coalesce(sum(case when entry_type='income' then amount else -amount end),0),
      'receivable',(select coalesce(sum(greatest(o.collect_amount-coalesce((select sum(f.amount) from public.finance_entries f where f.order_id=o.id and f.entry_type='income' and not f.is_demo),0),0)),0)
        from public.orders o where o.organization_id=tenant and not o.is_demo and o.status='delivered')) into cash
      from public.finance_entries where organization_id=tenant and not is_demo and (occurred_at at time zone zone)::date>=month and (occurred_at at time zone zone)::date<=today;
  end if;
  select jsonb_build_object('source','supabase','currency','MNT','today',jsonb_build_object('date',today,
    'deliveredRevenue',coalesce(sum(product_total) filter(where status='delivered' and (coalesce(delivered_at,updated_at) at time zone zone)::date=today),0),
    'orders',count(*) filter(where (created_at at time zone zone)::date=today),'newOrders',count(*) filter(where status='new'),
    'delivered',count(*) filter(where status='delivered'),'inTransit',count(*) filter(where status='in_transit'),
    'pending',count(*) filter(where status in ('new','preparing'))),'inventory',stock,'finance',cash,
    'statusCounts',(select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from(select status,count(*) n from public.orders where organization_id=tenant and not is_demo group by status) s),
    'dailySales',(select coalesce(jsonb_agg(jsonb_build_object('date',d.sales_day,'total',coalesce(s.total,0)) order by d.sales_day),'[]'::jsonb)
      from(select today-i as sales_day from generate_series(0,6) i)d left join(select (coalesce(delivered_at,updated_at) at time zone zone)::date as sales_day,sum(product_total) as total from public.orders where organization_id=tenant and not is_demo and status='delivered' group by 1)s on s.sales_day=d.sales_day)) into result
    from public.orders where organization_id=tenant and not is_demo;
  if not metrics_allowed then result:=result||jsonb_build_object('today',null,'dailySales','[]'::jsonb,'statusCounts','{}'::jsonb); end if;
  return result;
end $$;

-- Preserve reads/RLS, require atomic workflows for stock/order/cash mutation.
revoke insert,update,delete on public.orders,public.order_items,public.order_status_history,public.deliveries,
  public.inventory_balances,public.inventory_movements,public.leads,public.call_logs from authenticated;
revoke all on all functions in schema momo_core_private from public,anon,authenticated;
do $$ declare item record; begin
  for item in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'core\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated',item.signature);
    execute format('grant execute on function %s to authenticated',item.signature);
  end loop;
end $$;
