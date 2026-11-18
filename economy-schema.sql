begin;

create schema if not exists rpg_economy;
revoke all on schema rpg_economy from public, anon, authenticated;
grant usage on schema rpg_economy to authenticated;

create table public.rpg_arsenal (
  id text primary key,
  category text not null,
  name text not null,
  effect text not null,
  price_silver integer check (price_silver between 0 and 9999990),
  reference_price text,
  display_order integer not null,
  check (price_silver is not null or reference_price is not null)
);

create table public.rpg_economy_history (
  id uuid primary key,
  character_id uuid not null references public.rpg_characters(id) on delete cascade,
  actor_id uuid not null,
  operation text not null check (operation in ('buy','inventory','grant','adjust','refund')),
  items jsonb not null,
  gold_delta integer not null,
  silver_delta integer not null,
  note text,
  refund_for uuid references public.rpg_economy_history(id),
  created_at timestamptz not null default now()
);
create unique index rpg_economy_one_refund on public.rpg_economy_history(refund_for) where refund_for is not null;
create index rpg_economy_history_character on public.rpg_economy_history(character_id, created_at desc);

create table rpg_economy.requests (
  id uuid primary key references public.rpg_economy_history(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null
);
revoke all on rpg_economy.requests from public, anon, authenticated;

alter table public.rpg_arsenal enable row level security;
alter table public.rpg_economy_history enable row level security;
revoke all on public.rpg_arsenal, public.rpg_economy_history from public, anon, authenticated;
grant select on public.rpg_arsenal, public.rpg_economy_history to authenticated;
create policy arsenal_read on public.rpg_arsenal for select to authenticated using ((select auth.uid()) is not null);
create policy economy_history_read on public.rpg_economy_history for select to authenticated using (
  (select auth.jwt()->'app_metadata'->>'role') = 'master'
  or exists(select 1 from public.rpg_characters c where c.id = character_id and c.owner_id = (select auth.uid()))
);

create function rpg_economy.item_key(value text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(translate(lower(trim(value)), 'áàâãäéêëíìîóòôõöúùûüç', 'aaaaaeeeiiiooooouuuuc'), '[[:space:]]+', ' ', 'g')
$$;

-- Keep old text-form inventories readable, including quantities and unknown existing items.
create function rpg_economy.inventory(value jsonb) returns table(item_key text, label text, quantity integer)
language sql immutable set search_path = '' as $$
  with raw as (
    select trim(line) as line from jsonb_array_elements_text(
      case jsonb_typeof(value)
        when 'array' then value
        when 'string' then to_jsonb(regexp_split_to_array(value #>> '{}', E'\\r?\\n'))
        else '[]'::jsonb end
    ) line
  ), parsed as (
    select line, regexp_match(line, '^([0-9]{1,6})([[:space:]]*[×xX][[:space:]]+|[[:space:]]+)(.+)$') as m
    from raw where line <> ''
  )
  select rpg_economy.item_key(coalesce(m[3],line)), min(coalesce(m[3],line)),
    sum(greatest(1,coalesce(m[1]::integer,1)))::integer
  from parsed group by 1
$$;

create function rpg_economy.line(label text, quantity integer) returns text
language sql immutable set search_path = '' as $$
  select case when quantity = 1 then label else quantity::text || ' × ' || label end
$$;

create function rpg_economy.coin(value jsonb) returns integer
language sql immutable set search_path = '' as $$
  select case when value #>> '{}' ~ '^[0-9]{1,7}$' then (value #>> '{}')::integer else 0 end
$$;

create function rpg_economy.guard_sheet() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op = 'INSERT' then
      new.data := coalesce(new.data,'{}'::jsonb) || jsonb_build_object(
        'gold',100,'silver',50,'inventory',jsonb_build_array(
          'Arma simples inicial (a definir com o mestre)','Mochila','Cantil','3 × Ração',
          'Muda de roupas','Item pessoal','Armadura de Treinamento'));
    elsif new.data->'gold' is distinct from old.data->'gold'
       or new.data->'silver' is distinct from old.data->'silver'
       or new.data->'inventory' is distinct from old.data->'inventory' then
      raise exception 'Use a carteira ou o editor de inventário.' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger rpg_economy_guard before insert or update on public.rpg_characters
for each row execute function rpg_economy.guard_sheet();

-- The privileged implementation lives in a schema not exposed by the Data API.
-- Identity, ownership, operation, and master-only actions are checked inside it.
create function rpg_economy.perform(
  p_character uuid, p_action text, p_request uuid, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  is_master boolean := coalesce(auth.jwt()->'app_metadata'->>'role' = 'master', false);
  sheet public.rpg_characters%rowtype;
  catalog public.rpg_arsenal%rowtype;
  previous public.rpg_economy_history%rowtype;
  logged rpg_economy.requests%rowtype;
  change record;
  gold integer;
  silver integer;
  next_gold integer;
  next_silver integer;
  cost bigint := 0;
  amount integer;
  inventory jsonb;
  items jsonb := '[]'::jsonb;
  result jsonb;
  reference uuid;
  description text;
  item_name text;
begin
  if actor is null or not coalesce(p_action in ('buy','quote','inventory','grant','adjust','refund','price'),false)
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Operação inválida.' using errcode='42501';
  end if;
  if p_action in ('grant','adjust','refund','price') and not is_master then
    raise exception 'Somente o mestre pode fazer isso.' using errcode='42501';
  end if;

  if p_action = 'price' then
    amount := (p_payload->>'price_silver')::integer;
    if amount is null or amount not between 0 and 9999990 then raise exception 'Preço inválido.'; end if;
    update public.rpg_arsenal set price_silver=amount, reference_price=null where id=p_payload->>'item';
    if not found then raise exception 'Item indisponível.'; end if;
    return jsonb_build_object('price_silver',amount);
  end if;

  select * into sheet from public.rpg_characters
    where id=p_character and (owner_id=actor or is_master) for update;
  if not found then raise exception 'Ficha indisponível.' using errcode='42501'; end if;
  gold := rpg_economy.coin(sheet.data->'gold');
  silver := rpg_economy.coin(sheet.data->'silver');
  next_gold := gold;
  next_silver := silver;
  inventory := sheet.data->'inventory';

  if p_action <> 'quote' then
    if p_request is null then raise exception 'Identificador da operação obrigatório.'; end if;
    select * into logged from rpg_economy.requests where id=p_request;
    if found then
      if logged.payload is distinct from jsonb_build_array(actor,p_character,p_action,p_payload) then
        raise exception 'Identificador de operação já utilizado.';
      end if;
      return logged.result;
    end if;
  end if;

  if p_action in ('buy','grant') then
    select * into catalog from public.rpg_arsenal where id=p_payload->>'item' for share;
    amount := (p_payload->>'quantity')::integer;
    item_name := case when p_action='grant' then nullif(trim(p_payload->>'custom'),'') end;
    item_name := coalesce(item_name,catalog.name);
    if item_name is null or length(item_name)>120 or item_name ~ '[[:cntrl:]]'
      or item_name ~ '^[0-9]{1,6}([[:space:]]*[×xX][[:space:]]+|[[:space:]]+)'
      or amount is null or amount not between 1 and 99 then
      raise exception 'Item ou quantidade inválida.';
    end if;
    if p_action='buy' and catalog.price_silver is null then raise exception 'Preço a combinar com o mestre.'; end if;
    cost := case when p_action='buy' then catalog.price_silver::bigint*amount else 0 end;
    select coalesce(jsonb_agg(rpg_economy.line(i.label,i.quantity) order by i.label),'[]'::jsonb)
      into inventory from rpg_economy.inventory(inventory) i;
    inventory := inventory || jsonb_build_array(rpg_economy.line(item_name, amount));
    items := jsonb_build_array(jsonb_build_object('item',catalog.id,'name',item_name,'quantity',amount,'price_silver',case when p_action='buy' then catalog.price_silver else 0 end));

  elsif p_action in ('quote','inventory') then
    if (p_payload->>'revision')::integer is distinct from sheet.revision then
      raise exception 'A ficha mudou. Reabra o inventário e confira os itens atuais.';
    end if;
    if jsonb_typeof(p_payload->'inventory') is distinct from 'array' then raise exception 'Inventário inválido.'; end if;
    if jsonb_array_length(p_payload->'inventory') > 600 or exists (
      select 1 from jsonb_array_elements(p_payload->'inventory') v
      where jsonb_typeof(v)<>'string' or length(v #>> '{}')>180
    ) then raise exception 'Use até 600 linhas com até 180 caracteres em cada uma.'; end if;
    for change in
      select n.item_key,n.label,n.quantity-coalesce(o.quantity,0) as added
      from rpg_economy.inventory(p_payload->'inventory') n
      left join rpg_economy.inventory(inventory) o using (item_key)
      where n.quantity>coalesce(o.quantity,0) order by n.item_key
    loop
      select * into catalog from public.rpg_arsenal c where rpg_economy.item_key(c.name)=change.item_key for share;
      if catalog.id is null or catalog.price_silver is null then
        raise exception 'Item novo sem preço definido no Arsenal: %. Peça ao mestre para concedê-lo.',change.label;
      end if;
      if change.added > 99 then raise exception 'Adicione no máximo 99 unidades de cada item por vez.'; end if;
      cost := cost + catalog.price_silver::bigint*change.added;
      items := items || jsonb_build_array(jsonb_build_object('item',catalog.id,'name',catalog.name,'quantity',change.added,'price_silver',catalog.price_silver));
    end loop;
    inventory := p_payload->'inventory';
    if p_action='quote' then
      return jsonb_build_object('cost_silver',cost,'affordable',(gold::bigint*10+silver)>=cost,'items',items);
    end if;

  elsif p_action='adjust' then
    next_gold := gold+coalesce((p_payload->>'gold_delta')::integer,0);
    next_silver := silver+coalesce((p_payload->>'silver_delta')::integer,0);
    if next_gold=gold and next_silver=silver then raise exception 'Informe uma alteração de saldo.'; end if;

  elsif p_action='refund' then
    reference := (p_payload->>'purchase')::uuid;
    select * into previous from public.rpg_economy_history
      where id=reference and character_id=p_character and operation in ('buy','inventory') and (gold_delta<0 or silver_delta<0);
    if not found then raise exception 'Compra não encontrada.'; end if;
    if exists(select 1 from public.rpg_economy_history where refund_for=reference) then raise exception 'Compra já reembolsada.'; end if;
    for change in
      select rpg_economy.item_key(j->>'name') as key, sum((j->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(previous.items) j group by 1
    loop
      if coalesce((select i.quantity from rpg_economy.inventory(inventory) i where i.item_key=change.key),0)<change.quantity then
        raise exception 'Os itens precisam estar no inventário para o reembolso.';
      end if;
    end loop;
    select coalesce(jsonb_agg(rpg_economy.line(i.label,i.quantity-coalesce(r.quantity,0)) order by i.label),'[]'::jsonb)
    into inventory from rpg_economy.inventory(inventory) i
    left join (
      select rpg_economy.item_key(j->>'name') key,sum((j->>'quantity')::integer)::integer quantity
      from jsonb_array_elements(previous.items) j group by 1
    ) r on r.key=i.item_key
    where i.quantity>coalesce(r.quantity,0);
    items := previous.items;
    next_gold := gold-previous.gold_delta;
    next_silver := silver-previous.silver_delta;
    if next_silver<0 then
      amount := (-next_silver+9)/10;
      next_gold := next_gold-amount;
      next_silver := next_silver+amount*10;
    end if;
  end if;

  if p_action in ('buy','inventory') then
    if (p_payload->>'expected_silver')::bigint is distinct from cost then
      raise exception 'O total mudou. Confira o preço e confirme a compra novamente.';
    end if;
    if gold::bigint*10+silver < cost then raise exception 'Saldo insuficiente.'; end if;
    if cost>0 then
      -- Paga em ouro primeiro. Usa prata no restante e dá troco em prata quando necessário.
      amount := least(gold,(cost/10)::integer);
      next_gold := gold-amount;
      next_silver := (silver-(cost-amount::bigint*10))::integer;
      if next_silver<0 then
        amount := (-next_silver+9)/10;
        next_gold := next_gold-amount;
        next_silver := next_silver+amount*10;
      end if;
    end if;
  end if;
  if next_gold not between 0 and 9999999 or next_silver not between 0 and 9999999 then
    raise exception 'Saldo fora do limite permitido.';
  end if;

  description := nullif(left(trim(p_payload->>'note'),240),'');
  if p_action in ('adjust','refund','grant') and description is null then raise exception 'Informe o motivo.'; end if;

  update public.rpg_characters
    set data = coalesce(data,'{}'::jsonb) || jsonb_build_object('gold',next_gold,'silver',next_silver,'inventory',inventory)
    where id=p_character returning * into sheet;
  insert into public.rpg_economy_history(id,character_id,actor_id,operation,items,gold_delta,silver_delta,note,refund_for)
    values(p_request,p_character,actor,p_action,items,next_gold-gold,next_silver-silver,description,reference);
  result := jsonb_build_object('gold',next_gold,'silver',next_silver,'inventory',inventory,'revision',sheet.revision,'cost_silver',cost);
  insert into rpg_economy.requests values(p_request,jsonb_build_array(actor,p_character,p_action,p_payload),result);
  return result;
end
$$;

revoke execute on all functions in schema rpg_economy from public, anon, authenticated;
grant execute on function rpg_economy.perform(uuid,text,uuid,jsonb) to authenticated;
create function public.rpg_economy_action(p_character uuid, p_action text, p_request uuid, p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select rpg_economy.perform(p_character,p_action,p_request,p_payload)
$$;
revoke execute on function public.rpg_economy_action(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.rpg_economy_action(uuid,text,uuid,jsonb) to authenticated;

-- Catalog seeded from the prior arsenal and this update's approved prices.
insert into public.rpg_arsenal(id,category,name,effect,price_silver,reference_price,display_order) values
('adaga-de-bronze-celestial','Arma','Adaga de Bronze Celestial','1d6',200,null,1),
('espada-curta','Arma','Espada Curta','1d6',200,null,2),
('espada-longa','Arma','Espada Longa','2d6',600,null,3),
('lanca-campista','Arma','Lança Campista','2d6',600,null,4),
('arco-cacador','Arma','Arco Caçador','2d6; requer flechas',350,null,5),
('arco-cacador-versao-de-40-ouro','Arma','Arco Caçador (versão de 40 ouro)','2d6; requer flechas',400,null,6),
('aljava-com-10-flechas','Munição','Aljava com 10 flechas','10 flechas',80,null,7),
('machado-labirintico','Arma','Machado Labiríntico','2d6',850,null,8),
('martelo-de-guerra','Arma','Martelo de Guerra','3d6',1100,null,9),
('chicote-encantado','Arma','Chicote Encantado','1d6',280,null,10),
('martelo-de-ferro','Arma','Martelo de Ferro','2d6; Força 1',400,null,11),
('tunica-acolchoada','Armadura','Túnica Acolchoada','+1 Defesa',150,null,12),
('couraca-de-couro','Armadura','Couraça de Couro','+2 Defesa',400,null,13),
('peitoral-de-bronze','Armadura','Peitoral de Bronze','+3 Defesa',850,null,14),
('escamas-celestiais','Armadura','Escamas Celestiais','+4 Defesa',1900,null,15),
('escudo-redondo','Proteção','Escudo Redondo','+1 Defesa; bloqueia 1 ataque/cena',300,null,16),
('elmo-corintio','Proteção','Elmo Coríntio','+1 Defesa; resiste a medo',180,null,17),
('bronze-rebitado','Armadura','Bronze Rebitado','+3 Defesa; -2 Furtividade',700,null,18),
('pocao-de-cura-menor','Consumível','Poção de Cura Menor','1d6 PV',50,null,19),
('pocao-de-cura-maior','Consumível','Poção de Cura Maior','2d6 PV',200,null,20),
('pocao-de-vigor','Consumível','Poção de Vigor','+2 em teste físico',100,null,21),
('antidoto','Consumível','Antídoto','Neutraliza veneno comum',30,null,22),
('nectar','Consumível','Néctar','1d6 PV',150,null,23),
('ambrosia','Consumível','Ambrosia','2d6 PV; uso excessivo perigoso',400,null,24),
('tocha','Utilidade','Tocha','Ilumina área',50,null,25),
('pingente-de-hermes','Relíquia','Pingente de Hermes','+2 Iniciativa',1000,null,26),
('anel-de-atena','Relíquia','Anel de Atena','+2 investigação/estratégia',1150,null,27),
('bracelete-de-ares','Relíquia','Bracelete de Ares','+1 dado de dano, 1 ataque/cena',2100,null,28),
('concha-de-poseidon','Relíquia','Concha de Poseidon','Respirar debaixo d''água por 10 min',1100,null,29),
('lanterna-de-hecate','Relíquia','Lanterna de Hécate','+2 magia, Névoa ou ritual',1200,null,30),
('capa-da-nevoa','Relíquia','Capa da Névoa','Ocultação mágica',1750,null,31),
('corda-encantada','Utilidade','Corda Encantada','Corda mágica',80,null,32),
('reparo-de-forja','Serviço','Reparo de forja','Ajuste de equipamento',null,'4–15 ouro',33),
('encantamento-simples','Serviço','Encantamento simples','Ajuste de equipamento',800,null,34);
notify pgrst, 'reload schema';
commit;
