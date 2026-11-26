create or replace function public.core_dashboard_summary() returns jsonb
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
    with product_stock as (
      select p.id, p.is_active, p.cost_price, sum(b.quantity) as units
      from public.products p
      left join public.inventory_balances b
        on b.product_id = p.id and b.organization_id = p.organization_id
      where p.organization_id = tenant
      group by p.id
    )
    select jsonb_build_object(
      'products', count(*) filter (where is_active),
      'lowStock', count(*) filter (where is_active and units between 1 and 5),
      'outOfStock', count(*) filter (where is_active and coalesce(units, 0) = 0),
      'stockCost', case when public.has_permission('finance.view')
                        then coalesce(sum(units * cost_price), 0) end
    ) into stock from product_stock;
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
