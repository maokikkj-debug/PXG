-- Run after the private import. The role checks are read-only and the transaction is rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"player"},"user_metadata":{"role":"master"}}',true);
do $$
begin
  if exists(select 1 from public.rpg_master_books)
    or exists(select 1 from public.rpg_master_state)
    or exists(select 1 from public.rpg_master_awards) then
    raise exception 'Player must not receive private data';
  end if;
  begin
    perform public.rpg_master_grant('verification',array['00000000-0000-4000-8000-000000000001']::uuid[],'xp','verification',1,false);
    raise exception 'Player must not be able to grant rewards';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"master"}}',true);
do $$
declare book jsonb;
begin
  select body into strict book from public.rpg_master_books where id='ruptura-da-nevoa';
  if jsonb_array_length(book->'pages') <> 24
    or jsonb_array_length(book->'chapters') <> 8
    or jsonb_array_length(book->'quests') <> 10
    or jsonb_array_length(book->'monsters') <> 16
    or jsonb_array_length(book->'npcs') <> 6 then
    raise exception 'Private import is incomplete';
  end if;
end;
$$;
rollback;
