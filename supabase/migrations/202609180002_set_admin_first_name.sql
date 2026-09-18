update public.profiles
set first_name = 'Sanji'
where id = 'd12c65af-eaea-46c7-a07d-9cbac8f0e057'::uuid;

do $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = 'd12c65af-eaea-46c7-a07d-9cbac8f0e057'::uuid
      and first_name = 'Sanji'
  ) then
    raise exception 'Admin profile first_name update was not applied';
  end if;
end $$;
