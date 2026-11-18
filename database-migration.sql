create table if not exists public.rpg_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rpg_profiles_email_lower_idx on public.rpg_profiles (lower(email));
alter table public.rpg_profiles enable row level security;
grant select, insert, update on public.rpg_profiles to authenticated;
drop policy if exists "profile read self or master" on public.rpg_profiles;
create policy "profile read self or master" on public.rpg_profiles for select to authenticated
using (id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'master');
drop policy if exists "profile insert self" on public.rpg_profiles;
create policy "profile insert self" on public.rpg_profiles for insert to authenticated
with check (id = (select auth.uid()));
drop policy if exists "profile update self" on public.rpg_profiles;
create policy "profile update self" on public.rpg_profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('character-portraits','character-portraits',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/png','image/jpeg','image/webp'];
drop policy if exists "portrait read owner or master" on storage.objects;
create policy "portrait read owner or master" on storage.objects for select to authenticated
using (bucket_id='character-portraits' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select auth.jwt()->'app_metadata'->>'role')='master'));
drop policy if exists "portrait insert own folder" on storage.objects;
create policy "portrait insert own folder" on storage.objects for insert to authenticated
with check (bucket_id='character-portraits' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select auth.jwt()->'app_metadata'->>'role')='master'));
drop policy if exists "portrait update owner or master" on storage.objects;
create policy "portrait update owner or master" on storage.objects for update to authenticated
using (bucket_id='character-portraits' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select auth.jwt()->'app_metadata'->>'role')='master'))
with check (bucket_id='character-portraits' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select auth.jwt()->'app_metadata'->>'role')='master'));
drop policy if exists "portrait delete owner or master" on storage.objects;
create policy "portrait delete owner or master" on storage.objects for delete to authenticated
using (bucket_id='character-portraits' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select auth.jwt()->'app_metadata'->>'role')='master'));
