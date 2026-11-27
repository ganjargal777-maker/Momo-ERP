-- RLS/client authorization helpers require authenticated/backend access only.
-- Supabase default privileges may grant anon directly, independently of PUBLIC.
-- Keep all function bodies, SECURITY DEFINER guards and existing RLS unchanged.
revoke execute on function public.current_organization_id(),
  public.has_permission(text), public.has_assigned_role(uuid)
  from public, anon;
grant execute on function public.current_organization_id(),
  public.has_permission(text), public.has_assigned_role(uuid)
  to authenticated, service_role;

-- This function is invoked by an existing database trigger, never a client RPC.
-- Revoking client EXECUTE does not remove or disable the installed trigger.
revoke execute on function public.protect_profile_security_fields()
  from public, anon, authenticated;
