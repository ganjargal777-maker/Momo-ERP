-- Security-definer helpers must not inherit PostgreSQL's default EXECUTE grant
-- to PUBLIC. Trigger functions are invoked by their triggers and do not need
-- direct Data API access.
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.protect_profile_security_fields() from public, anon, authenticated;

-- These helpers are part of authenticated RLS evaluation. Keep the signed-in
-- contract explicit while denying anonymous callers.
revoke all on function public.current_organization_id() from public, anon;
revoke all on function public.has_permission(text) from public, anon;
revoke all on function public.has_assigned_role(uuid) from public, anon;

grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_assigned_role(uuid) to authenticated;

-- Supabase may install this event-trigger helper on hosted projects. It is not
-- present in every local image, so harden it conditionally without making the
-- migration environment-dependent.
do $$
declare
  target_function regprocedure;
begin
  select p.oid::regprocedure
    into target_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'rls_auto_enable'
    and p.pronargs = 0
  limit 1;

  if target_function is not null then
    execute format('revoke all on function %s from public, anon, authenticated', target_function);
  end if;
end
$$;
