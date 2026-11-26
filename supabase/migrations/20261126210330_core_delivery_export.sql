-- A delivery reader may classify the parent order without reading customer
-- or finance fields. This owner-evaluated projection stays in the private
-- schema and exposes only eligible keys for the caller's active tenant.
create view momo_core_private.delivery_export_orders with (security_barrier = true) as
select o.organization_id, o.id
from public.orders o
where o.organization_id = (select public.current_organization_id())
  and (select public.has_permission('deliveries.read'))
  and not o.is_demo;

revoke all on momo_core_private.delivery_export_orders from public, anon, authenticated;
grant select on momo_core_private.delivery_export_orders to authenticated;

create view public.core_delivery_export with (security_invoker = true) as
select d.organization_id, d.order_id, d.status, d.courier_id, d.delivered_at
from public.deliveries d
join momo_core_private.delivery_export_orders o
  on o.organization_id = d.organization_id and o.id = d.order_id;

revoke all on public.core_delivery_export from public, anon, authenticated;
grant select on public.core_delivery_export to authenticated;
