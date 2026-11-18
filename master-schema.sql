begin;

create table if not exists public.rpg_master_books (
  id text primary key,
  body jsonb not null check (jsonb_typeof(body) = 'object')
);
create table if not exists public.rpg_master_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object')
);
create table if not exists public.rpg_master_awards (
  source text not null check (char_length(source) between 1 and 140),
  character_id uuid not null references public.rpg_characters(id) on delete cascade,
  kind text not null check (kind in ('xp','item','relic')),
  detail text not null check (char_length(detail) between 1 and 360),
  amount integer not null default 0 check (amount between 0 and 9999),
  granted_at timestamptz not null default now(),
  primary key (source, character_id, kind)
);

alter table public.rpg_master_books enable row level security;
alter table public.rpg_master_state enable row level security;
alter table public.rpg_master_awards enable row level security;

revoke all on public.rpg_master_books, public.rpg_master_state, public.rpg_master_awards from public, anon, authenticated;
grant select on public.rpg_master_books to authenticated;
grant select, insert, update on public.rpg_master_state to authenticated;
grant select, insert on public.rpg_master_awards to authenticated;
grant select, insert, update on public.rpg_master_books to service_role;

create policy master_book_read on public.rpg_master_books for select to authenticated
using ((select auth.uid()) is not null and (select auth.jwt()->'app_metadata'->>'role') = 'master');

create policy master_state_read on public.rpg_master_state for select to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()->'app_metadata'->>'role') = 'master');
create policy master_state_insert on public.rpg_master_state for insert to authenticated
with check (owner_id = (select auth.uid()) and (select auth.jwt()->'app_metadata'->>'role') = 'master');
create policy master_state_update on public.rpg_master_state for update to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()->'app_metadata'->>'role') = 'master')
with check (owner_id = (select auth.uid()) and (select auth.jwt()->'app_metadata'->>'role') = 'master');

create policy master_awards_read on public.rpg_master_awards for select to authenticated
using ((select auth.uid()) is not null and (select auth.jwt()->'app_metadata'->>'role') = 'master');
create policy master_awards_insert on public.rpg_master_awards for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.jwt()->'app_metadata'->>'role') = 'master');

create or replace function public.rpg_master_grant(
  p_source text, p_characters uuid[], p_kind text, p_detail text, p_amount integer, p_ritual_confirmed boolean default false
)
returns integer language plpgsql security invoker set search_path = ''
as $$
declare
  t uuid;
  current_sheet public.rpg_characters%rowtype;
  total integer := 0;
begin
  if auth.uid() is null or auth.jwt()->'app_metadata'->>'role' is distinct from 'master' then
    raise exception 'Somente o mestre pode registrar recompensas.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('xp','item','relic')
    or p_amount is null or p_amount < 0 or p_amount > 9999
    or (p_kind = 'xp' and p_amount = 0)
    or coalesce(cardinality(p_characters),0) not between 1 and 50 then
    raise exception 'Recompensa inválida.';
  end if;
  for t in select distinct unnest(p_characters) as id order by id loop
    select * into strict current_sheet from public.rpg_characters where id = t for update;
    if p_kind = 'relic' and (current_sheet.level < 4 or p_ritual_confirmed is not true) then
      raise exception 'A relíquia exige nível 4 e o ritual concluído.';
    end if;
    insert into public.rpg_master_awards (source,character_id,kind,detail,amount)
    values (
      case when p_kind='relic' then 'ritual-do-progenitor' else trim(lower(p_source)) end,
      t,p_kind,trim(p_detail),case when p_kind='xp' then p_amount else 0 end
    ) on conflict do nothing;
    if not found then continue; end if;
    total := total + 1;
    if p_kind = 'xp' then
      update public.rpg_characters
      set data = jsonb_set(data,'{xp}',to_jsonb(
        least(9999, p_amount + case when data->>'xp' ~ '^[0-9]{1,4}$' then (data->>'xp')::integer else 0 end)
      ),true) where id=t;
    elsif p_kind = 'relic' then
      update public.rpg_characters
      set data = jsonb_set(data, '{relics}',
        (case jsonb_typeof(data->'relics')
          when 'array' then data->'relics'
          when 'string' then to_jsonb(regexp_split_to_array(data->>'relics', E'\\r?\\n'))
          else '[]'::jsonb
        end) || jsonb_build_array(trim(p_detail)), true)
      where id=t;
    end if;
  end loop;
  return total;
end;
$$;
revoke all on function public.rpg_master_grant(text,uuid[],text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.rpg_master_grant(text,uuid[],text,text,integer,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
