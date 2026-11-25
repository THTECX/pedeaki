-- SQL 24: CARTEIRA do lojista e do motoboy (subconta Asaas da conta do Pede Aki).
-- Quem cria a subconta e o servidor (api/carteira.js) com a chave do Pede Aki; o lojista ou o motoboy so preenche o formulario
-- no app (ou o Ikarus preenche pelo Super Admin). O Asaas manda o e-mail de ativacao, a pessoa cria a senha e envia os documentos
-- la dentro. A carteira (walletId) e gravada sozinha: na loja vai para loja_financeiro.asaas_wallet_id (split do PIX) e no motoboy
-- para motoboys_app.wallet_id (repasse do frete por transferencia automatica depois de cada entrega).
-- So ACRESCENTA tabelas, colunas e funcoes. Pode rodar de novo sem estragar nada.

-- 1. Carteiras (uma por loja e uma por motoboy). Situacao copiada do Asaas (webhook e consulta ao abrir a tela).
create table if not exists public.carteiras (
  id uuid primary key default gen_random_uuid(),
  dono_tipo text not null check (dono_tipo in ('loja', 'motoboy')),
  store_id uuid unique references public.stores(id) on delete cascade,
  motoboy_id uuid unique references public.motoboys_app(id) on delete cascade,
  asaas_account_id text unique,
  wallet_id text,
  nome text,
  email text,
  documento text,
  status_geral text not null default 'CRIANDO',      -- CRIANDO, PENDING, AWAITING_APPROVAL, APPROVED, REJECTED
  status_documentos text,
  status_comercial text,
  status_banco text,
  onboarding_url text,
  onboarding_expira timestamptz,
  motivo_recusa text,
  criada_por text,                                    -- 'admin' ou 'dono'
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  check ((dono_tipo = 'loja' and store_id is not null and motoboy_id is null) or (dono_tipo = 'motoboy' and motoboy_id is not null and store_id is null))
);
alter table public.carteiras enable row level security;
drop policy if exists carteiras_admin_le on public.carteiras;
create policy carteiras_admin_le on public.carteiras for select to authenticated using (public.is_platform_admin());

-- 2. Chave de leitura da subconta (cifrada pelo servidor). RLS ligada e SEM politica: so a chave de servico chega aqui.
create table if not exists public.carteiras_chaves (
  carteira_id uuid primary key references public.carteiras(id) on delete cascade,
  chave_cifrada text not null,
  criada_em timestamptz not null default now()
);
alter table public.carteiras_chaves enable row level security;

-- 3. Repasse automatico do frete ao motoboy (transferencia entre contas Asaas)
alter table public.repasses_motoboy add column if not exists asaas_transfer_id text;
alter table public.repasses_motoboy add column if not exists tentativas int not null default 0;
alter table public.repasses_motoboy add column if not exists ultimo_erro text;
alter table public.repasses_motoboy drop constraint if exists repasses_motoboy_status_check;
alter table public.repasses_motoboy add constraint repasses_motoboy_status_check check (status in ('pendente', 'enviando', 'pago'));

-- 4. Quem pode mexer na carteira de uma loja (o servidor pergunta com o login de quem chamou)
create or replace function public.carteira_posso_loja(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or public.owns_store(p_store);
$$;
revoke all on function public.carteira_posso_loja(uuid) from public, anon;
grant execute on function public.carteira_posso_loja(uuid) to authenticated;

create or replace function public.carteira_sou_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin();
$$;
revoke all on function public.carteira_sou_admin() from public, anon;
grant execute on function public.carteira_sou_admin() to authenticated;

-- 5. Perfil do motoboy: resumo e historico das entregas dele (valor de cada uma e se ja foi para a carteira)
create or replace function public.motoboy_perfil(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := public._motoboy_valido(p_token); m public.motoboys_app;
  v_hoje timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_semana timestamptz := date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if v_m is null then return jsonb_build_object('ok', false, 'erro', 'Sessao expirada. Entre de novo.'); end if;
  select * into m from public.motoboys_app where id = v_m;
  return jsonb_build_object(
    'ok', true, 'nome', m.nome, 'telefone', m.telefone, 'online', m.online, 'tem_carteira', m.wallet_id is not null,
    'hoje', coalesce((select sum(valor) from public.repasses_motoboy where motoboy_id = v_m and criado_em >= v_hoje), 0),
    'semana', coalesce((select sum(valor) from public.repasses_motoboy where motoboy_id = v_m and criado_em >= v_semana), 0),
    'mes', coalesce((select sum(valor) from public.repasses_motoboy where motoboy_id = v_m and criado_em >= v_mes), 0),
    'entregas_mes', (select count(*) from public.repasses_motoboy where motoboy_id = v_m and criado_em >= v_mes),
    'a_enviar', coalesce((select sum(valor) from public.repasses_motoboy where motoboy_id = v_m and status in ('pendente', 'enviando')), 0),
    'historico', coalesce((
      select jsonb_agg(h order by (h->>'quando') desc) from (
        select jsonb_build_object(
          'id', r.id, 'valor', r.valor, 'status', r.status, 'quando', coalesce(e.entregue_em, r.criado_em),
          'loja', s.name, 'bairro', nullif(btrim(substring(o.address from 'Bairro: (.*)$')), ''),
          'frustrada', e.status = 'frustrada') as h
        from public.repasses_motoboy r
        join public.entregas_app e on e.id = r.entrega_id
        join public.stores s on s.id = e.store_id
        left join public.orders o on o.id::text = e.order_id
        where r.motoboy_id = v_m
        order by r.criado_em desc limit 60) x), '[]'::jsonb));
end $$;
revoke all on function public.motoboy_perfil(text) from public;
grant execute on function public.motoboy_perfil(text) to anon, authenticated;

-- 6. Avisa o servidor para transferir o frete quando nasce um repasse (entrega confirmada ou frustrada)
create or replace function public.repasses_avisa_servidor()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_seg text;
begin
  select valor into v_seg from public.plataforma_segredos where nome = 'push';
  if v_seg is null then return new; end if;
  begin
    perform net.http_post(
      url := 'https://pedeaki.tecx.pro/api/carteira',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-segredo', v_seg),
      body := jsonb_build_object('acao', 'repassar'),
      timeout_milliseconds := 5000);
  exception when others then null; -- a rotina de 10 em 10 minutos tenta de novo
  end;
  return new;
end $$;
revoke all on function public.repasses_avisa_servidor() from public, anon, authenticated;
drop trigger if exists repasses_avisa_servidor on public.repasses_motoboy;
create trigger repasses_avisa_servidor after insert on public.repasses_motoboy
  for each row execute function public.repasses_avisa_servidor();

-- 7. Rotina: a cada 10 minutos, se houver frete parado de motoboy com carteira, pede ao servidor para transferir
--    (pega o motoboy que criou a carteira depois da entrega e as falhas passageiras do Asaas; desiste depois de 5 tentativas)
create or replace function public.repasses_pendentes_cron()
returns void language plpgsql security definer set search_path = public as $$
declare v_seg text;
begin
  if not exists (select 1 from public.repasses_motoboy r join public.motoboys_app m on m.id = r.motoboy_id
                  where r.status = 'pendente' and m.wallet_id is not null and r.tentativas < 5) then return; end if;
  select valor into v_seg from public.plataforma_segredos where nome = 'push';
  if v_seg is null then return; end if;
  perform net.http_post(
    url := 'https://pedeaki.tecx.pro/api/carteira',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-segredo', v_seg),
    body := jsonb_build_object('acao', 'repassar'),
    timeout_milliseconds := 5000);
end $$;
revoke all on function public.repasses_pendentes_cron() from public, anon, authenticated;
do $$ begin perform cron.unschedule('repasses-pendentes'); exception when others then null; end $$;
select cron.schedule('repasses-pendentes', '*/10 * * * *', 'select public.repasses_pendentes_cron()');

-- Conferencia: deve devolver as tres linhas com true
select 'tabela carteiras' as item, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'carteiras') as ok
union all select 'perfil do motoboy', exists (select 1 from pg_proc where proname = 'motoboy_perfil')
union all select 'rotina de repasse', exists (select 1 from cron.job where jobname = 'repasses-pendentes');
