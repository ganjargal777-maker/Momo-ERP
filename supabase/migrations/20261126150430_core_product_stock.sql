create index inventory_balances_org_product_idx
  on public.inventory_balances (organization_id, product_id);

create function public.core_product_stock(product_ids uuid[])
returns table (product_id uuid, quantity bigint)
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  tenant uuid := public.current_organization_id();
begin
  if tenant is null or not public.has_permission('products.read')
                    or not public.has_permission('inventory.read') then
    raise exception 'Inventory and catalog access required' using errcode = '42501';
  end if;
  if product_ids is null or cardinality(product_ids) > 500 then
    raise exception 'Expected at most 500 product IDs' using errcode = '22023';
  end if;

  return query
    select p.id, coalesce(sum(b.quantity), 0::bigint)
    from public.products as p
    left join public.inventory_balances as b
      on b.organization_id = p.organization_id and b.product_id = p.id
    where p.organization_id = tenant and p.is_active and p.id = any(product_ids)
    group by p.id;
end;
$$;

revoke all on function public.core_product_stock(uuid[]) from public, anon, service_role;
grant execute on function public.core_product_stock(uuid[]) to authenticated;
