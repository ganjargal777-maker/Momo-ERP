create or replace function public.has_assigned_role(target_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role_id = target_role_id
  )
$$;

revoke all on function public.has_assigned_role(uuid) from public;
grant execute on function public.has_assigned_role(uuid) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or (
      organization_id = public.current_organization_id()
      and (public.has_permission('users.read') or public.has_permission('users.manage'))
    )
  );

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.has_assigned_role(id)
      or public.has_permission('users.read')
      or public.has_permission('users.manage')
    )
  );

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (
    public.has_assigned_role(role_id)
    or public.has_permission('users.read')
    or public.has_permission('users.manage')
  );

drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (
    user_id = auth.uid()
    or (
      exists (
        select 1 from public.profiles p
        where p.id = user_id and p.organization_id = public.current_organization_id()
      )
      and (public.has_permission('users.read') or public.has_permission('users.manage'))
    )
  );
