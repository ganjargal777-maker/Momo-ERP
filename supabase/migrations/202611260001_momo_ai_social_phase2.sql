insert into public.permissions(code,module,description) values
 ('ai_assistant.use','ai_assistant','MOMO AI туслах ашиглах'),
 ('ai_assistant.erp_read','ai_assistant','ERP бараа, үлдэгдэл унших'),
 ('ai_suggestions.create','ai_assistant','AI хариултын санал үүсгэх'),
 ('social_inbox.read','social_inbox','Сошиал харилцаа харах'),
 ('social_inbox.assign','social_inbox','Харилцаа ажилтанд хуваарилах'),
 ('social_inbox.reply_draft','social_inbox','Хариултын draft үүсгэх, засах'),
 ('social_inbox.reply_send','social_inbox','Баталсан хариулт илгээх'),
 ('social_inbox.resolve','social_inbox','Харилцаа шийдвэрлэх'),
 ('social_inbox.order_create','social_inbox','Харилцаанаас захиалга үүсгэх'),
 ('social_audit.read','social_inbox','Сошиал audit харах')
on conflict(code) do update set module=excluded.module,description=excluded.description;

create table public.feature_flags(
 organization_id uuid not null references public.organizations(id) on delete cascade,
 key text not null check(key ~ '^[a-z][a-z0-9_]{2,63}$'), enabled boolean not null default false,
 updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now(),
 primary key(organization_id,key));
create table public.ai_threads(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade, title text not null default 'Шинэ чат', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.ai_messages(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 thread_id uuid not null references public.ai_threads(id) on delete cascade, role text not null check(role in('user','assistant')),
 content text not null check(char_length(content) between 1 and 12000), sources jsonb not null default '[]'::jsonb,
 created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now());

alter table public.feature_flags enable row level security; alter table public.ai_threads enable row level security; alter table public.ai_messages enable row level security;
create policy feature_flags_read on public.feature_flags for select to authenticated using(organization_id=public.current_organization_id());
create policy feature_flags_manage on public.feature_flags for all to authenticated using(organization_id=public.current_organization_id() and public.has_permission('settings.manage')) with check(organization_id=public.current_organization_id() and public.has_permission('settings.manage'));
create policy ai_threads_owner on public.ai_threads for all to authenticated using(organization_id=public.current_organization_id() and owner_id=auth.uid() and public.has_permission('ai_assistant.use')) with check(organization_id=public.current_organization_id() and owner_id=auth.uid() and public.has_permission('ai_assistant.use'));
create policy ai_messages_owner_read on public.ai_messages for select to authenticated using(organization_id=public.current_organization_id() and public.has_permission('ai_assistant.use') and exists(select 1 from public.ai_threads t where t.id=thread_id and t.owner_id=auth.uid()));
create policy ai_messages_owner_insert on public.ai_messages for insert to authenticated with check(organization_id=public.current_organization_id() and created_by=auth.uid() and public.has_permission('ai_assistant.use') and exists(select 1 from public.ai_threads t where t.id=thread_id and t.owner_id=auth.uid()));
grant select,insert,update,delete on public.feature_flags,public.ai_threads to authenticated; grant select,insert on public.ai_messages to authenticated;

insert into public.feature_flags(organization_id,key,enabled)
select id,key,false from public.organizations cross join (values('momo_ai_ui'),('momo_ai_grounded_search'),('social_inbox_ui'),('social_inbox_read'),('social_inbox_ai_draft'),('social_inbox_reply_send'),('social_inbox_order_create')) f(key)
on conflict do nothing;

insert into public.role_permissions(role_id,permission_code)
select r.id,p.code from public.roles r cross join public.permissions p where r.name='Admin' and p.module in('ai_assistant','social_inbox') on conflict do nothing;
