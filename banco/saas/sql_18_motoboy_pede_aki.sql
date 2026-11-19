-- SQL 18 (versao 2, 19/11/2026): entrega pelo motoboy do Pede Aki (loja de comissao com entrega_modo = 'app').
-- Pode ser rodado em banco limpo OU por cima da primeira versao do SQL 18: refaz as funcoes e acerta a tabela de entregas.
-- Fluxo:
--   pedido criado (antes de pagar)  -> entrega PREVISTA   (motoboy ve a previa na central, sem aviso sonoro)
--   loja aceita (Em Producao)       -> entrega EFETIVADA  (central mostra "pedido efetivado"; o motoboy JA PODE ACEITAR, mesmo a caminho)
--   motoboy aceita                  -> ACEITA             (a loja ve o nome dele; ele segue para a loja)
--   loja clica Pronto               -> se ninguem aceitou: DISPONIVEL ("coleta disponivel": aviso a todos os motoboys, cliente ve "em fila de coleta");
--                                      se um motoboy ja aceitou: so ele e avisado ("pedido pronto, pode coletar")
--   motoboy na loja toca "Peguei"   -> RETIRADA ("coletado, em rota"): o codigo do cliente aparece so agora (precisa estar pronto)
--   motoboy digita o codigo         -> ENTREGUE -> repasse do frete fica "pendente" para o Ikarus pagar
-- Tambem: aceite automatico por loja, loja que nao responde em 15 min tem o pedido cancelado e devolvido, "eu mesmo entrego",
-- aviso (Web Push) aos motoboys na coleta disponivel, estatistica de aceite por loja.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 0. Colunas novas em lojas e pedidos
alter table public.stores add column if not exists tempo_preparo_min int not null default 20;   -- tempo medio de preparo (usado na previa; o lojista ajusta nas configuracoes)
alter table public.stores add column if not exists aceite_automatico boolean not null default false; -- so o administrador liga
alter table public.orders add column if not exists aceito_em timestamptz;

-- so o administrador da plataforma liga/desliga estes controles (refaz a funcao do SQL 17 com o aceite automatico)
create or replace function public.stores_protege_controles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_admin() and (
        new.entrega_modo is distinct from old.entrega_modo
     or new.pagamento_pix is distinct from old.pagamento_pix
     or new.pagamento_cartao is distinct from old.pagamento_cartao
     or new.aceite_automatico is distinct from old.aceite_automatico) then
    raise exception 'Somente o administrador da plataforma altera estes controles.';
  end if;
  return new;
end $$;

-- 1. Motoboys do Pede Aki (cadastrados pelo administrador; senha guardada em hash)
create table if not exists public.motoboys_app (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text not null unique,
  senha text not null,
  wallet_id text,
  ativo boolean not null default true,
  online boolean not null default false,
  online_em timestamptz,
  session_token text,
  falhas int not null default 0,
  bloqueado_ate timestamptz,
  criado_em timestamptz not null default now()
);
alter table public.motoboys_app enable row level security;
drop policy if exists motoboys_admin on public.motoboys_app;
create policy motoboys_admin on public.motoboys_app for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create or replace function public.motoboys_app_prepara()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  new.telefone := public.fone_canonico(new.telefone);
  if tg_op = 'UPDATE' and (new.senha is null or new.senha = '') then
    new.senha := old.senha;
  end if;
  if new.senha is not null and new.senha <> '' and new.senha !~ '^\$2[aby]\$'
     and (tg_op = 'INSERT' or new.senha is distinct from old.senha) then
    new.senha := crypt(new.senha, gen_salt('bf'));
    new.session_token := null;
  end if;
  return new;
end $$;
drop trigger if exists motoboys_app_prepara on public.motoboys_app;
create trigger motoboys_app_prepara before insert or update on public.motoboys_app
  for each row execute function public.motoboys_app_prepara();

-- 2. Entregas (uma por pedido). O codigo fica aqui, numa tabela fechada: so o cliente (pelo telefone) e o administrador chegam nele.
create table if not exists public.entregas_app (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  store_id uuid not null,
  motoboy_id uuid references public.motoboys_app(id),
  status text not null default 'prevista',
  frete numeric(12,2) not null default 0,
  codigo text not null,
  tentativas int not null default 0,
  bloqueada boolean not null default false,
  prazo_retirar timestamptz,
  prazo_entregar timestamptz,
  criada_em timestamptz not null default now(),
  disponivel_em timestamptz,
  aceita_em timestamptz,
  retirada_em timestamptz,
  chegou_em timestamptz,
  entregue_em timestamptz,
  cancelada_em timestamptz,
  motivo text
);
alter table public.entregas_app add column if not exists efetivada_em timestamptz;
alter table public.entregas_app add column if not exists pronta_em timestamptz; -- quando a loja clicou Pronto
alter table public.entregas_app add column if not exists push_avisos int not null default 0;
alter table public.entregas_app drop constraint if exists entregas_app_status_check;
alter table public.entregas_app add constraint entregas_app_status_check
  check (status in ('prevista', 'efetivada', 'disponivel', 'aceita', 'retirada', 'entregue', 'cancelada', 'frustrada'));
create index if not exists entregas_app_status_idx on public.entregas_app (status);
create index if not exists entregas_app_motoboy_idx on public.entregas_app (motoboy_id);
alter table public.entregas_app enable row level security;
drop policy if exists entregas_admin on public.entregas_app;
create policy entregas_admin on public.entregas_app for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 3. Repasse do frete ao motoboy (o Ikarus paga e marca como pago)
create table if not exists public.repasses_motoboy (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null unique references public.entregas_app(id),
  motoboy_id uuid not null references public.motoboys_app(id),
  valor numeric(12,2) not null,
  status text not null default 'pendente' check (status in ('pendente', 'pago')),
  criado_em timestamptz not null default now(),
  pago_em timestamptz,
  observacao text
);
alter table public.repasses_motoboy enable row level security;
drop policy if exists repasses_admin on public.repasses_motoboy;
create policy repasses_admin on public.repasses_motoboy for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 4. Eventos da entrega (pronto, retirou, chegou, entregue...) para o Pede Aki mandar mensagem ao cliente (BTZap, depois)
create table if not exists public.entrega_eventos (
  id bigserial primary key,
  entrega_id uuid not null,
  order_id text not null,
  tipo text not null,
  criado_em timestamptz not null default now(),
  enviado boolean not null default false
);
alter table public.entrega_eventos enable row level security;
drop policy if exists eventos_admin on public.entrega_eventos;
create policy eventos_admin on public.entrega_eventos for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 5. Codigo de 4 digitos aleatorio, sem relacao com o telefone, sem sequencia nem numero repetido
create or replace function public._codigo_entrega()
returns text language plpgsql volatile set search_path = public, extensions as $$
declare c text; b bytea;
begin
  loop
    b := gen_random_bytes(2);
    c := lpad(((get_byte(b, 0) * 256 + get_byte(b, 1)) % 10000)::text, 4, '0');
    exit when c !~ '^(\d)\1{3}$' and c not in ('0123', '1234', '2345', '3456', '4567', '5678', '6789', '3210', '4321', '5432', '6543', '7654', '8765', '9876');
  end loop;
  return c;
end $$;
revoke all on function public._codigo_entrega() from public, anon, authenticated;

-- 6. A PREVIA nasce junto com o pedido (antes de pagar): so loja com entrega pelo Pede Aki e pedido de Entrega
create or replace function public.orders_cria_entrega_app()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_modo text;
begin
  if new.status is distinct from 'Aguardando pagamento' or new.order_type is distinct from 'Entrega' then return new; end if;
  select entrega_modo into v_modo from public.stores where id = new.store_id;
  if coalesce(v_modo, 'propria') = 'app' then
    insert into public.entregas_app (order_id, store_id, frete, codigo)
    values (new.id::text, new.store_id, coalesce(new.delivery_fee, 0), public._codigo_entrega())
    on conflict (order_id) do nothing;
  end if;
  return new;
exception when others then
  return new; -- a previa nunca pode impedir o pedido de entrar
end $$;
drop trigger if exists orders_cria_entrega_app on public.orders;
create trigger orders_cria_entrega_app after insert on public.orders
  for each row execute function public.orders_cria_entrega_app();

-- 7. Pagamento confirmado: vira Novo (o lojista e avisado); se a loja tem aceite automatico, ja entra em producao
create or replace function public.pedido_pago(p_order text, p_payment text)
returns text language plpgsql security definer set search_path = public as $$
declare o public.orders; v_modo text; v_auto boolean;
begin
  select * into o from public.orders where id::text = p_order for update;
  if not found then return 'nao_encontrado'; end if;
  if o.payment_status = 'pago' then return 'ja_pago'; end if;
  if o.status in ('Expirado', 'Cancelado') then
    update public.orders set payment_status = 'pago_apos_vencer', asaas_payment_id = p_payment where id = o.id;
    update public.pagamentos set status = 'PAGO_APOS_VENCER', pago_em = now(), atualizado_em = now() where asaas_payment_id = p_payment;
    return 'estornar';
  end if;
  update public.orders
     set status = 'Novo', payment_status = 'pago', pago_em = now(), asaas_payment_id = p_payment,
         status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', 'Novo', 'timestamp', now()))
   where id = o.id;
  update public.pagamentos set status = 'PAGO', pago_em = now(), atualizado_em = now() where asaas_payment_id = p_payment;

  select entrega_modo, aceite_automatico into v_modo, v_auto from public.stores where id = o.store_id;
  if coalesce(v_modo, 'propria') = 'app' and o.order_type = 'Entrega' then
    insert into public.entregas_app (order_id, store_id, frete, codigo)  -- normalmente a previa ja existe
    values (o.id::text, o.store_id, coalesce(o.delivery_fee, 0), public._codigo_entrega())
    on conflict (order_id) do nothing;
  end if;
  if coalesce(v_auto, false) then
    update public.orders
       set status = 'Em Produção',
           status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', 'Em Produção', 'timestamp', now()))
     where id = o.id;
  end if;
  return 'ok';
end $$;
revoke all on function public.pedido_pago(text, text) from public, anon, authenticated;

-- o aviso de pedido novo tambem vale para pedido que ja entrou aceito (aceite automatico)
create or replace function public.push_para_pedido(p_order uuid, p_segredo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_seg text; o record; s record; v_subs jsonb;
begin
  select valor into v_seg from public.plataforma_segredos where nome = 'push';
  if v_seg is null or p_segredo is distinct from v_seg then raise exception 'negado'; end if;
  select id, store_id, status, daily_order_number, total, order_type into o from public.orders where id = p_order;
  if not found or o.status not in ('Novo', 'Em Produção') then return jsonb_build_object('enviar', false); end if;
  select slug, name into s from public.stores where id = o.store_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::jsonb)
    into v_subs from public.push_assinaturas where store_id = o.store_id;
  return jsonb_build_object('enviar', true, 'slug', s.slug, 'loja', s.name, 'numero', o.daily_order_number,
                            'total', o.total, 'tipo', o.order_type, 'subs', v_subs);
end $$;
revoke all on function public.push_para_pedido(uuid, text) from public;
grant execute on function public.push_para_pedido(uuid, text) to anon, authenticated;

-- 8. Loja com entrega pelo Pede Aki: pedido de Entrega so com pagamento online (dinheiro so na Retirada)
create or replace function public.orders_formas_pagamento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if new.origin is null or new.origin not in ('WEB', 'APP') then return new; end if;
  select modelo, pagamento_pix, pagamento_cartao, entrega_modo into v from public.stores where id = new.store_id;
  if not found or coalesce(v.modelo, 'pdv') <> 'comissao' then return new; end if;
  if new.payment_method = 'PIX' and coalesce(v.pagamento_pix, true) = false then
    raise exception 'Esta loja nao aceita PIX.';
  end if;
  if new.payment_method = 'Cartão' and coalesce(v.pagamento_cartao, false) = false then
    raise exception 'Esta loja nao aceita cartao.';
  end if;
  if coalesce(v.entrega_modo, 'propria') = 'app' and new.order_type = 'Entrega' and new.payment_method not in ('PIX', 'Cartão') then
    raise exception 'A entrega pelo Pede Aki so aceita pagamento online. Escolha PIX ou retire na loja.';
  end if;
  return new;
end $$;

-- 9. Quando o lojista aceita (Em Producao) o pedido e EFETIVADO; cancelado ou expirado, a entrega some
create or replace function public.orders_marca_aceite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'Novo' and new.status = 'Em Produção' and new.aceito_em is null then new.aceito_em := now(); end if;
  return new;
end $$;
drop trigger if exists orders_marca_aceite on public.orders;
create trigger orders_marca_aceite before update of status on public.orders
  for each row execute function public.orders_marca_aceite();

create or replace function public.orders_entrega_app()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'Em Produção' then
    update public.entregas_app set status = 'efetivada', efetivada_em = now()
     where order_id = new.id::text and status = 'prevista';
  elsif new.status in ('Cancelado', 'Expirado') then
    update public.entregas_app
       set status = 'cancelada', cancelada_em = now(), motivo = coalesce(new.cancel_reason, 'Pedido ' || lower(new.status))
     where order_id = new.id::text and status in ('prevista', 'efetivada', 'disponivel', 'aceita');
  end if;
  return new;
end $$;
drop trigger if exists orders_entrega_app on public.orders;
create trigger orders_entrega_app after update of status on public.orders
  for each row execute function public.orders_entrega_app();

-- 10. Entrega do Pede Aki: so o motoboy (ou o administrador) leva o pedido para A Caminho, No Portao e Entregue
create or replace function public.orders_guarda_entrega_app()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('A Caminho', 'No Portão', 'Entregue')
     and coalesce(current_setting('pedeaki.entrega', true), '') <> '1'
     and auth.uid() is not null and not public.is_platform_admin()
     and exists (select 1 from public.entregas_app where order_id = new.id::text and status <> 'cancelada') then
    raise exception 'Esta entrega e feita pelo motoboy do Pede Aki.';
  end if;
  return new;
end $$;
drop trigger if exists orders_guarda_entrega_app on public.orders;
create trigger orders_guarda_entrega_app before update of status on public.orders
  for each row execute function public.orders_guarda_entrega_app();

-- 11. Funcoes do cliente (pelo telefone do pedido). O CODIGO so aparece depois que o motoboy coletou.
create or replace function public.pedido_entrega(p_order text, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e public.entregas_app; o record; v_nome text;
begin
  select id, phone, payment_status into o from public.orders
   where id::text = p_order and public.fone_canonico(phone) = public.fone_canonico(p_phone) limit 1;
  if not found or o.payment_status is distinct from 'pago' then return null; end if;
  select * into e from public.entregas_app where order_id = p_order;
  if not found then return jsonb_build_object('tem_entrega', false); end if;
  select nome into v_nome from public.motoboys_app where id = e.motoboy_id;
  return jsonb_build_object(
    'tem_entrega', true, 'status', e.status, 'bloqueada', e.bloqueada, 'motoboy', v_nome, 'frete', e.frete,
    'prazo_entregar', e.prazo_entregar, 'pronta', e.pronta_em is not null,
    'codigo', case when e.status = 'retirada' then e.codigo else null end);
end $$;
revoke all on function public.pedido_entrega(text, text) from public;
grant execute on function public.pedido_entrega(text, text) to anon, authenticated;

-- ha motoboy online agora? (o checkout so oferece Entrega Pede Aki se sim). "Online" e o botao dele, que vale por 10 horas sem mexer.
create or replace function public.entrega_app_disponivel()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.motoboys_app where ativo and online and online_em > now() - interval '10 hours');
$$;
revoke all on function public.entrega_app_disponivel() from public;
grant execute on function public.entrega_app_disponivel() to anon, authenticated;

-- 12. Funcoes do lojista (so o dono da loja)
-- Pronto: marca o pedido como pronto. Sem motoboy ainda, vira coleta DISPONIVEL (aviso a todos); com motoboy que ja aceitou, so ele e avisado.
create or replace function public.lojista_pronto(p_order text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid; e public.entregas_app;
begin
  select store_id into v_store from public.orders where id::text = p_order;
  if v_store is null or not public.owns_store(v_store) then raise exception 'sem permissao nesta loja'; end if;
  select * into e from public.entregas_app where order_id = p_order and status in ('efetivada', 'aceita') and pronta_em is null for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'Esta entrega nao esta esperando ficar pronta.'); end if;
  if e.status = 'efetivada' then
    update public.entregas_app set status = 'disponivel', disponivel_em = now(), pronta_em = now() where id = e.id;
  else
    update public.entregas_app set pronta_em = now() where id = e.id;
  end if;
  insert into public.entrega_eventos (entrega_id, order_id, tipo) values (e.id, e.order_id, 'pronto');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.lojista_pronto(text) from public, anon;
grant execute on function public.lojista_pronto(text) to authenticated;

-- Eu mesmo entrego: saida quando ninguem pegou a coleta em 5 minutos. O frete fica com a loja (o repasse ja a inclui).
create or replace function public.lojista_eu_entrego(p_order text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid; e public.entregas_app;
begin
  select store_id into v_store from public.orders where id::text = p_order;
  if v_store is null or not public.owns_store(v_store) then raise exception 'sem permissao nesta loja'; end if;
  select * into e from public.entregas_app where order_id = p_order for update;
  if not found or e.status <> 'disponivel' or e.motoboy_id is not null then
    return jsonb_build_object('ok', false, 'erro', 'Esta entrega nao esta esperando motoboy.');
  end if;
  if e.disponivel_em > now() - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'erro', 'Espere 5 minutos pelo motoboy antes de entregar por conta propria.');
  end if;
  update public.entregas_app set status = 'cancelada', cancelada_em = now(), motivo = 'Loja entrega por conta propria' where id = e.id;
  insert into public.entrega_eventos (entrega_id, order_id, tipo) values (e.id, e.order_id, 'loja_entrega');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.lojista_eu_entrego(text) from public, anon;
grant execute on function public.lojista_eu_entrego(text) to authenticated;

-- Dados extras dos pedidos da loja para a tela do celular: quando pagou, quando aceitou e como esta a entrega (sem o codigo)
create or replace function public.lojista_pedidos_extra(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.owns_store(p_store) then raise exception 'sem permissao nesta loja'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_id', o.id, 'pago_em', o.pago_em, 'aceito_em', o.aceito_em,
      'entrega', e.status, 'motoboy', m.nome, 'disponivel_em', e.disponivel_em, 'pronta_em', e.pronta_em))
    from public.orders o
    left join public.entregas_app e on e.order_id = o.id::text
    left join public.motoboys_app m on m.id = e.motoboy_id
    where o.store_id = p_store and o.timestamp > now() - interval '2 days'), '[]'::jsonb);
end $$;
revoke all on function public.lojista_pedidos_extra(uuid) from public, anon;
grant execute on function public.lojista_pedidos_extra(uuid) to authenticated;

-- 13. Funcoes do motoboy (sessao por token, como o entregador das lojas)
create or replace function public._motoboy_valido(p_token text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.motoboys_app where p_token is not null and p_token <> '' and session_token = p_token and ativo limit 1;
$$;
revoke all on function public._motoboy_valido(text) from public, anon, authenticated;

create or replace function public.motoboy_login(p_telefone text, p_senha text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare m public.motoboys_app; v_tok text;
begin
  select * into m from public.motoboys_app where telefone = public.fone_canonico(p_telefone);
  if not found or not m.ativo then return jsonb_build_object('ok', false, 'erro', 'Telefone ou senha incorretos.'); end if;
  if m.bloqueado_ate is not null and m.bloqueado_ate > now() then
    return jsonb_build_object('ok', false, 'erro', 'Muitas tentativas. Tente de novo em alguns minutos.');
  end if;
  if m.senha = crypt(coalesce(p_senha, ''), m.senha) then
    v_tok := encode(gen_random_bytes(24), 'hex');
    update public.motoboys_app set session_token = v_tok, falhas = 0, bloqueado_ate = null where id = m.id;
    return jsonb_build_object('ok', true, 'token', v_tok, 'nome', m.nome);
  end if;
  update public.motoboys_app
     set falhas = case when falhas + 1 >= 5 then 0 else falhas + 1 end,
         bloqueado_ate = case when falhas + 1 >= 5 then now() + interval '15 minutes' else bloqueado_ate end
   where id = m.id;
  return jsonb_build_object('ok', false, 'erro', 'Telefone ou senha incorretos.');
end $$;
revoke all on function public.motoboy_login(text, text) from public;
grant execute on function public.motoboy_login(text, text) to anon, authenticated;

create or replace function public.motoboy_online(p_token text, p_online boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := public._motoboy_valido(p_token);
begin
  if v_m is null then return jsonb_build_object('ok', false, 'erro', 'Sessao expirada. Entre de novo.'); end if;
  update public.motoboys_app set online = coalesce(p_online, false), online_em = now() where id = v_m;
  return jsonb_build_object('ok', true, 'online', coalesce(p_online, false));
end $$;
revoke all on function public.motoboy_online(text, boolean) from public;
grant execute on function public.motoboy_online(text, boolean) to anon, authenticated;

-- A central do motoboy: as dele (aceita e retirada), coleta disponivel (pronto, sem motoboy), efetivadas (em preparo, sem motoboy) e previas.
-- Cada chamada tambem renova o "online". Endereco completo do cliente so em "minhas" DEPOIS que ele pegou o pedido na loja (retirada).
create or replace function public.motoboy_painel(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := public._motoboy_valido(p_token); m public.motoboys_app; r jsonb;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'erro', 'Sessao expirada. Entre de novo.'); end if;
  update public.motoboys_app set online_em = now() where id = v_m and online;
  select * into m from public.motoboys_app where id = v_m;
  r := jsonb_build_object(
    'ok', true, 'nome', m.nome, 'online', m.online,
    'ganhos_hoje', coalesce((select sum(valor) from public.repasses_motoboy where motoboy_id = v_m and criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0),
    'a_receber', coalesce((select sum(valor) from public.repasses_motoboy where motoboy_id = v_m and status = 'pendente'), 0),
    'minhas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'status', e.status, 'frete', e.frete, 'loja', s.name, 'pronta', e.pronta_em is not null,
        'loja_endereco', (select store_address from public.settings where store_id = e.store_id limit 1),
        'bairro', nullif(btrim(substring(o.address from 'Bairro: (.*)$')), ''),
        'pronto_previsto', e.efetivada_em + make_interval(mins => coalesce(s.tempo_preparo_min, 20)),
        'cliente', case when e.status = 'retirada' then o.customer_name end,
        'endereco', case when e.status = 'retirada' then o.address end,
        'referencia', case when e.status = 'retirada' then o.reference_point end,
        'prazo_entregar', e.prazo_entregar, 'tentativas', e.tentativas, 'bloqueada', e.bloqueada) order by e.criada_em)
      from public.entregas_app e join public.stores s on s.id = e.store_id join public.orders o on o.id::text = e.order_id
      where e.motoboy_id = v_m and e.status in ('aceita', 'retirada')), '[]'::jsonb),
    'disponiveis', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'status', e.status, 'frete', e.frete, 'loja', s.name,
        'loja_endereco', (select store_address from public.settings where store_id = e.store_id limit 1),
        'bairro', nullif(btrim(substring(o.address from 'Bairro: (.*)$')), ''),
        'disponivel_em', e.disponivel_em) order by e.disponivel_em)
      from public.entregas_app e join public.stores s on s.id = e.store_id join public.orders o on o.id::text = e.order_id
      where e.status = 'disponivel' and e.motoboy_id is null), '[]'::jsonb),
    'efetivadas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'status', e.status, 'frete', e.frete, 'loja', s.name,
        'bairro', nullif(btrim(substring(o.address from 'Bairro: (.*)$')), ''),
        'pronto_previsto', e.efetivada_em + make_interval(mins => coalesce(s.tempo_preparo_min, 20))) order by e.efetivada_em)
      from public.entregas_app e join public.stores s on s.id = e.store_id join public.orders o on o.id::text = e.order_id
      where e.status = 'efetivada' and e.motoboy_id is null), '[]'::jsonb),
    'previas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'status', e.status, 'frete', e.frete, 'loja', s.name,
        'bairro', nullif(btrim(substring(o.address from 'Bairro: (.*)$')), ''),
        'preparo_min', coalesce(s.tempo_preparo_min, 20)) order by e.criada_em)
      from public.entregas_app e join public.stores s on s.id = e.store_id join public.orders o on o.id::text = e.order_id
      where e.status = 'prevista' and e.criada_em > now() - interval '35 minutes'
        and o.status in ('Aguardando pagamento', 'Novo')), '[]'::jsonb));
  return r;
end $$;
revoke all on function public.motoboy_painel(text) from public;
grant execute on function public.motoboy_painel(text) to anon, authenticated;

-- O motoboy ACEITA a entrega ja quando o pedido esta efetivado (em preparo) ou na coleta disponivel. Quem aceita primeiro leva
-- (a atualizacao so vale se ninguem pegou antes). Pode aceitar ate 2 ao mesmo tempo.
create or replace function public.motoboy_aceitar(p_token text, p_entrega uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := public._motoboy_valido(p_token); e public.entregas_app; v_nome text; v_ativas int;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'erro', 'Sessao expirada. Entre de novo.'); end if;
  select count(*) into v_ativas from public.entregas_app where motoboy_id = v_m and status in ('aceita', 'retirada');
  if v_ativas >= 2 then return jsonb_build_object('ok', false, 'erro', 'Termine as entregas que voce ja pegou antes de pegar outra.'); end if;
  update public.entregas_app set status = 'aceita', motoboy_id = v_m, aceita_em = now()
   where id = p_entrega and status in ('efetivada', 'disponivel') and motoboy_id is null returning * into e;
  if not found then return jsonb_build_object('ok', false, 'erro', 'Outro motoboy pegou esta entrega.'); end if;
  select nome into v_nome from public.motoboys_app where id = v_m;
  update public.orders set courier_name = v_nome where id::text = e.order_id;
  insert into public.entrega_eventos (entrega_id, order_id, tipo) values (e.id, e.order_id, 'aceitou');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.motoboy_aceitar(text, uuid) from public;
grant execute on function public.motoboy_aceitar(text, uuid) to anon, authenticated;

-- Devolver a entrega antes de coletar: volta para a fila (efetivada se ainda nao esta pronta, disponivel se ja esta)
create or replace function public.motoboy_soltar(p_token text, p_entrega uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := public._motoboy_valido(p_token); e public.entregas_app;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'erro', 'Sessao expirada. Entre de novo.'); end if;
  update public.entregas_app
     set status = case when pronta_em is null then 'efetivada' else 'disponivel' end,
         disponivel_em = case when pronta_em is null then disponivel_em else now() end,
         motoboy_id = null, aceita_em = null
   where id = p_entrega and motoboy_id = v_m and status = 'aceita' returning * into e;
  if not found then return jsonb_build_object('ok', false, 'erro', 'Nao foi possivel devolver esta entrega.'); end if;
  update public.orders set courier_name = null where id::text = e.order_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.motoboy_soltar(text, uuid) from public;
grant execute on function public.motoboy_soltar(text, uuid) to anon, authenticated;

-- Na loja, o motoboy toca "Peguei o pedido": so se a loja ja marcou Pronto. O pedido sai em rota (A Caminho) e o codigo do cliente aparece.
create or replace function public.motoboy_retirei(p_token text, p_entrega uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := public._motoboy_valido(p_token); e public.entregas_app;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'erro', 'Sessao expirada. Entre de novo.'); end if;
  select * into e from public.entregas_app where id = p_entrega and motoboy_id = v_m and status = 'aceita' for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'Entrega nao encontrada.'); end if;
  if e.pronta_em is null then return jsonb_build_object('ok', false, 'erro', 'A loja ainda nao marcou o pedido como pronto. Aguarde.'); end if;
  update public.entregas_app set status = 'retirada', retirada_em = now(), prazo_entregar = now() + interval '30 minutes' where id = e.id;
  perform set_config('pedeaki.entrega', '1', true);
  update public.orders
     set status = 'A Caminho',
         status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', 'A Caminho', 'timestamp', now()))
   where id::text = e.order_id;
  perform set_config('pedeaki.entrega', '', true);
  insert into public.entrega_eventos (entrega_id, order_id, tipo) values (e.id, e.order_id, 'retirou');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.motoboy_retirei(text, uuid) from public;
grant execute on function public.motoboy_retirei(text, uuid) to anon, authenticated;

create or replace function public.motoboy_cheguei(p_token text, p_entrega uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := public._motoboy_valido(p_token); e public.entregas_app;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'erro', 'Sessao expirada. Entre de novo.'); end if;
  update public.entregas_app set chegou_em = now()
   where id = p_entrega and motoboy_id = v_m and status = 'retirada' returning * into e;
  if not found then return jsonb_build_object('ok', false, 'erro', 'Entrega nao encontrada.'); end if;
  perform set_config('pedeaki.entrega', '1', true);
  update public.orders
     set status = 'No Portão',
         status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', 'No Portão', 'timestamp', now()))
   where id::text = e.order_id;
  perform set_config('pedeaki.entrega', '', true);
  insert into public.entrega_eventos (entrega_id, order_id, tipo) values (e.id, e.order_id, 'chegou');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.motoboy_cheguei(text, uuid) from public;
grant execute on function public.motoboy_cheguei(text, uuid) to anon, authenticated;

-- entrega: o motoboy digita o codigo que o cliente passou (3 erros bloqueiam; so o administrador libera com codigo novo)
create or replace function public.motoboy_entregar(p_token text, p_entrega uuid, p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := public._motoboy_valido(p_token); e public.entregas_app; v_t int;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'erro', 'Sessao expirada. Entre de novo.'); end if;
  select * into e from public.entregas_app where id = p_entrega and motoboy_id = v_m and status = 'retirada' for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'Entrega nao encontrada.'); end if;
  if e.bloqueada then return jsonb_build_object('ok', false, 'bloqueada', true, 'erro', 'Codigo bloqueado. Fale com o suporte do Pede Aki.'); end if;
  if btrim(coalesce(p_codigo, '')) = e.codigo then
    update public.entregas_app set status = 'entregue', entregue_em = now() where id = e.id;
    perform set_config('pedeaki.entrega', '1', true);
    update public.orders
       set status = 'Entregue',
           status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', 'Entregue', 'timestamp', now()))
     where id::text = e.order_id;
    perform set_config('pedeaki.entrega', '', true);
    insert into public.repasses_motoboy (entrega_id, motoboy_id, valor) values (e.id, v_m, e.frete) on conflict (entrega_id) do nothing;
    insert into public.entrega_eventos (entrega_id, order_id, tipo) values (e.id, e.order_id, 'entregue');
    return jsonb_build_object('ok', true, 'ganho', e.frete);
  end if;
  v_t := e.tentativas + 1;
  update public.entregas_app set tentativas = v_t, bloqueada = (v_t >= 3) where id = e.id;
  return jsonb_build_object('ok', false, 'bloqueada', v_t >= 3, 'restantes', greatest(0, 3 - v_t),
    'erro', case when v_t >= 3 then 'Codigo bloqueado. Fale com o suporte do Pede Aki.' else 'Codigo incorreto.' end);
end $$;
revoke all on function public.motoboy_entregar(text, uuid, text) from public;
grant execute on function public.motoboy_entregar(text, uuid, text) to anon, authenticated;

-- entrega frustrada (cliente ausente ou recusou): o motoboy recebe o frete; o suporte decide o resto
create or replace function public.motoboy_frustrada(p_token text, p_entrega uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := public._motoboy_valido(p_token); e public.entregas_app;
begin
  if v_m is null then return jsonb_build_object('ok', false, 'erro', 'Sessao expirada. Entre de novo.'); end if;
  update public.entregas_app set status = 'frustrada', cancelada_em = now(), motivo = left(coalesce(nullif(btrim(p_motivo), ''), 'Cliente nao recebeu'), 200)
   where id = p_entrega and motoboy_id = v_m and status = 'retirada' returning * into e;
  if not found then return jsonb_build_object('ok', false, 'erro', 'Entrega nao encontrada.'); end if;
  insert into public.repasses_motoboy (entrega_id, motoboy_id, valor, observacao) values (e.id, v_m, e.frete, 'Entrega frustrada: ' || e.motivo) on conflict (entrega_id) do nothing;
  insert into public.entrega_eventos (entrega_id, order_id, tipo) values (e.id, e.order_id, 'frustrada');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.motoboy_frustrada(text, uuid, text) from public;
grant execute on function public.motoboy_frustrada(text, uuid, text) to anon, authenticated;

-- 14. Administrador: codigo novo para o cliente (zera as tentativas e desbloqueia)
create or replace function public.entrega_novo_codigo(p_entrega uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Somente o administrador da plataforma.'; end if;
  update public.entregas_app set codigo = public._codigo_entrega(), tentativas = 0, bloqueada = false
   where id = p_entrega and status in ('prevista', 'efetivada', 'disponivel', 'aceita', 'retirada');
end $$;
revoke all on function public.entrega_novo_codigo(uuid) from public;
grant execute on function public.entrega_novo_codigo(uuid) to authenticated;

-- 15. Lojista que nao responde em 15 minutos: o pedido e cancelado e o PIX devolvido (o servidor faz o estorno)
create or replace function public.expirar_aceite_lojista()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_seg text;
begin
  select valor into v_seg from public.plataforma_segredos where nome = 'push';
  for r in
    select o.id from public.orders o join public.stores s on s.id = o.store_id
     where o.status = 'Novo' and o.payment_status = 'pago' and o.pago_em is not null
       and o.pago_em < now() - interval '15 minutes' and s.modelo = 'comissao'
  loop
    update public.orders
       set status = 'Cancelado', cancel_reason = 'A loja não respondeu a tempo',
           status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', 'Cancelado', 'timestamp', now()))
     where id = r.id and status = 'Novo';
    begin
      if v_seg is not null then
        perform net.http_post(
          url := 'https://pedeaki.tecx.pro/api/estorno-automatico',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-segredo', v_seg),
          body := jsonb_build_object('order_id', r.id),
          timeout_milliseconds := 5000);
      end if;
    exception when others then null; -- se o aviso falhar, o pedido fica cancelado com estorno pendente para o Super Admin ver
    end;
  end loop;
end $$;
revoke all on function public.expirar_aceite_lojista() from public, anon, authenticated;
do $$ begin perform cron.unschedule('expirar-aceite-lojista'); exception when others then null; end $$;
select cron.schedule('expirar-aceite-lojista', '* * * * *', 'select public.expirar_aceite_lojista()');

-- 16. Aviso (Web Push) aos motoboys quando a coleta fica disponivel. A previa e a efetivada NAO avisam (nao amolar o motoboy a toa).
create table if not exists public.motoboy_push (
  id uuid primary key default gen_random_uuid(),
  motoboy_id uuid not null references public.motoboys_app(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);
alter table public.motoboy_push enable row level security;
revoke all on public.motoboy_push from anon, authenticated;

create or replace function public.motoboy_push_registrar(p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := public._motoboy_valido(p_token);
begin
  if v_m is null then return jsonb_build_object('ok', false, 'erro', 'Sessao expirada. Entre de novo.'); end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then return jsonb_build_object('ok', false, 'erro', 'Assinatura invalida.'); end if;
  insert into public.motoboy_push (motoboy_id, endpoint, p256dh, auth) values (v_m, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set motoboy_id = excluded.motoboy_id, p256dh = excluded.p256dh, auth = excluded.auth;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.motoboy_push_registrar(text, text, text, text) from public;
grant execute on function public.motoboy_push_registrar(text, text, text, text) to anon, authenticated;

-- a funcao da Vercel (api/push-motoboy) pede quem avisar (so com o segredo).
-- Sem motoboy aceito: coleta disponivel, avisa todos os online. Com motoboy aceito e pedido pronto: avisa so ele.
create or replace function public.push_para_entrega(p_entrega uuid, p_segredo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_seg text; e public.entregas_app; s record; v_bairro text; v_subs jsonb; v_tipo text;
begin
  select valor into v_seg from public.plataforma_segredos where nome = 'push';
  if v_seg is null or p_segredo is distinct from v_seg then raise exception 'negado'; end if;
  select * into e from public.entregas_app where id = p_entrega;
  if not found then return jsonb_build_object('enviar', false); end if;
  select name into s from public.stores where id = e.store_id;
  select nullif(btrim(substring(address from 'Bairro: (.*)$')), '') into v_bairro from public.orders where id::text = e.order_id;
  if e.status = 'disponivel' and e.motoboy_id is null then
    v_tipo := 'coleta';
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)), '[]'::jsonb)
      into v_subs from public.motoboy_push p join public.motoboys_app m on m.id = p.motoboy_id
     where m.ativo and m.online and m.online_em > now() - interval '10 hours';
  elsif e.status = 'aceita' and e.pronta_em is not null then
    v_tipo := 'pronto';
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)), '[]'::jsonb)
      into v_subs from public.motoboy_push p where p.motoboy_id = e.motoboy_id;
  else
    return jsonb_build_object('enviar', false);
  end if;
  return jsonb_build_object('enviar', true, 'tipo', v_tipo, 'loja', s.name, 'bairro', v_bairro, 'frete', e.frete, 'subs', v_subs);
end $$;
revoke all on function public.push_para_entrega(uuid, text) from public;
grant execute on function public.push_para_entrega(uuid, text) to anon, authenticated;

create or replace function public.push_motoboy_remover(p_ids uuid[], p_segredo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_seg text;
begin
  select valor into v_seg from public.plataforma_segredos where nome = 'push';
  if v_seg is null or p_segredo is distinct from v_seg then raise exception 'negado'; end if;
  delete from public.motoboy_push where id = any(p_ids);
end $$;
revoke all on function public.push_motoboy_remover(uuid[], text) from public;
grant execute on function public.push_motoboy_remover(uuid[], text) to anon, authenticated;

create or replace function public.entregas_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_seg text;
begin
  -- avisa quando a loja clica Pronto, ou quando uma entrega ja pronta volta para a fila (motoboy devolveu)
  if new.pronta_em is null or not (old.pronta_em is null or (new.status = 'disponivel' and old.status is distinct from 'disponivel')) then return new; end if;
  select valor into v_seg from public.plataforma_segredos where nome = 'push';
  if v_seg is null then return new; end if;
  perform net.http_post(
    url := 'https://pedeaki.tecx.pro/api/push-motoboy',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-segredo', v_seg),
    body := jsonb_build_object('entrega_id', new.id),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  return new; -- o aviso nunca pode impedir a entrega de andar
end $$;
drop trigger if exists entregas_push on public.entregas_app;
create trigger entregas_push after update of status, pronta_em on public.entregas_app
  for each row execute function public.entregas_push();

-- coleta disponivel e ninguem pegou em 3 minutos: avisa de novo a cada minuto (ate 5 vezes)
create or replace function public.push_lembretes_entrega()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_seg text;
begin
  select valor into v_seg from public.plataforma_segredos where nome = 'push';
  if v_seg is null then return; end if;
  for r in
    select id from public.entregas_app
     where status = 'disponivel' and motoboy_id is null and push_avisos < 5
       and disponivel_em < now() - interval '3 minutes' and disponivel_em > now() - interval '60 minutes'
  loop
    update public.entregas_app set push_avisos = push_avisos + 1 where id = r.id;
    perform net.http_post(
      url := 'https://pedeaki.tecx.pro/api/push-motoboy',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-segredo', v_seg),
      body := jsonb_build_object('entrega_id', r.id, 'lembrete', true),
      timeout_milliseconds := 5000);
  end loop;
exception when others then
  null;
end $$;
revoke all on function public.push_lembretes_entrega() from public, anon, authenticated;
do $$ begin perform cron.unschedule('push-lembretes-entrega'); exception when others then null; end $$;
select cron.schedule('push-lembretes-entrega', '* * * * *', 'select public.push_lembretes_entrega()');

-- 17. Estatistica de aceite por loja (Super Admin): recebidos, aceitos, recusados, sem resposta e tempo medio para aceitar
create or replace function public.aceite_das_lojas(p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Somente o administrador da plataforma.'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'loja') from (
      select jsonb_build_object(
        'store_id', s.id, 'loja', s.name,
        'recebidos', count(*),
        'aceitos', count(*) filter (where o.aceito_em is not null),
        'sem_resposta', count(*) filter (where o.status = 'Cancelado' and o.aceito_em is null and coalesce(o.cancel_reason, '') ilike 'A loja não respondeu%'),
        'recusados', count(*) filter (where o.status = 'Cancelado' and o.aceito_em is null and coalesce(o.cancel_reason, '') not ilike 'A loja não respondeu%'),
        'minutos_medios', round((avg(extract(epoch from (o.aceito_em - o.pago_em)) / 60) filter (where o.aceito_em is not null))::numeric, 1)) as x
      from public.orders o join public.stores s on s.id = o.store_id
      where s.modelo = 'comissao' and o.pago_em is not null and o.pago_em > now() - make_interval(days => greatest(p_dias, 1))
      group by s.id, s.name) t), '[]'::jsonb);
end $$;
revoke all on function public.aceite_das_lojas(int) from public, anon;
grant execute on function public.aceite_das_lojas(int) to authenticated;

-- Conferencia: deve devolver true (ha motoboy online?) ou false, sem erro
select public.entrega_app_disponivel();
