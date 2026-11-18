-- SQL 20: o proprio lojista (so loja de comissao) compra o impulso da vitrine por dia, pagando PIX.
-- Depende do SQL 19. So ACRESCENTA tabelas e funcoes; nao muda nada do que ja funciona.
-- Preco, vagas e descontos ficam em impulso_config e quem edita e o Super Admin.
-- O preco e a vaga sao calculados AQUI no banco (nunca na tela), e so o servidor (chave de servico) cria e ativa compras.

-- 1. Configuracao unica (uma linha) -------------------------------------------------------------
create table if not exists public.impulso_config (
  id int primary key default 1 check (id = 1),
  preco_dia numeric(10,2) not null default 4.00 check (preco_dia >= 0),
  vagas int not null default 5 check (vagas >= 0),
  desc_7 numeric(5,2) not null default 10 check (desc_7 between 0 and 90),
  desc_15 numeric(5,2) not null default 15 check (desc_15 between 0 and 90),
  desc_30 numeric(5,2) not null default 25 check (desc_30 between 0 and 90),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
insert into public.impulso_config (id) values (1) on conflict (id) do nothing;
alter table public.impulso_config enable row level security;
drop policy if exists impulso_config_le on public.impulso_config;
create policy impulso_config_le on public.impulso_config for select to anon, authenticated using (true);
drop policy if exists impulso_config_admin on public.impulso_config;
create policy impulso_config_admin on public.impulso_config for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 2. Compras de impulso -----------------------------------------------------------------------
create table if not exists public.impulsos (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  dias int not null check (dias between 1 and 90),
  valor numeric(10,2) not null check (valor >= 0),
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'sem_vaga')),
  documento text,
  aceite_em timestamptz,
  pagar_ate timestamptz not null,
  asaas_payment_id text,
  pix_copia_cola text,
  pix_imagem text,
  ate timestamptz,
  ativado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists impulsos_store_idx on public.impulsos (store_id, criado_em desc);
create unique index if not exists impulsos_pagamento_uk on public.impulsos (asaas_payment_id) where asaas_payment_id is not null;
alter table public.impulsos enable row level security;
drop policy if exists impulsos_dono_le on public.impulsos;
create policy impulsos_dono_le on public.impulsos for select to authenticated using (public.owns_store(store_id));
drop policy if exists impulsos_admin_le on public.impulsos;
create policy impulsos_admin_le on public.impulsos for select to authenticated using (public.is_platform_admin());
-- sem politica de escrita: so a chave de servico (servidor) grava

-- 3. Vagas ocupadas (interna): lojas com impulso valido + reservas de PIX ainda dentro dos 15 minutos
create or replace function public.impulso_ocupadas(p_excluir uuid default null)
returns int language sql stable security definer set search_path = public as $$
  select (
    select count(*) from public.stores s
     where s.is_active and s.aparecer_no_shopping and s.impulso in ('patrocinada', 'destaque')
       and s.impulso_ate > now() and s.id is distinct from p_excluir
  ) + (
    select count(distinct i.store_id) from public.impulsos i
     where i.status = 'pendente' and i.pagar_ate > now() and i.store_id is distinct from p_excluir
       and not exists (select 1 from public.stores s2 where s2.id = i.store_id and s2.impulso in ('patrocinada', 'destaque') and s2.impulso_ate > now())
  );
$$;
revoke all on function public.impulso_ocupadas(uuid) from public;

-- 4. Vagas e precos (a vitrine e a tela do lojista leem isto)
create or replace function public.impulso_vagas()
returns json language plpgsql stable security definer set search_path = public as $$
declare c public.impulso_config; ocup int; prox timestamptz;
begin
  select * into c from public.impulso_config where id = 1;
  ocup := public.impulso_ocupadas(null);
  select min(s.impulso_ate) into prox from public.stores s
   where s.is_active and s.aparecer_no_shopping and s.impulso in ('patrocinada', 'destaque') and s.impulso_ate > now();
  return json_build_object('ativo', c.ativo, 'vagas', c.vagas, 'ocupadas', ocup, 'livres', greatest(c.vagas - ocup, 0),
    'proxima_vaga', prox, 'preco_dia', c.preco_dia, 'desc_7', c.desc_7, 'desc_15', c.desc_15, 'desc_30', c.desc_30);
end $$;
revoke all on function public.impulso_vagas() from public;
grant execute on function public.impulso_vagas() to anon, authenticated;

-- 5. Cria a compra (so o servidor chama): calcula o valor, confere a vaga e reserva por 15 minutos
create or replace function public.impulso_criar(p_store uuid, p_dias int, p_documento text)
returns json language plpgsql security definer set search_path = public as $$
declare c public.impulso_config; s public.stores; ativo_agora boolean; pct numeric; v numeric; novo public.impulsos;
begin
  perform pg_advisory_xact_lock(hashtext('impulso_vagas'));
  select * into c from public.impulso_config where id = 1;
  if not c.ativo then raise exception 'impulso_desligado'; end if;
  if p_dias is null or p_dias < 1 or p_dias > 90 then raise exception 'dias_invalidos'; end if;
  select * into s from public.stores where id = p_store;
  if s.id is null or s.modelo is distinct from 'comissao' or s.is_active is not true or s.aparecer_no_shopping is not true then
    raise exception 'loja_nao_elegivel';
  end if;
  ativo_agora := s.impulso in ('patrocinada', 'destaque') and s.impulso_ate > now();
  -- PIX anterior ainda aberto desta loja deixa de reservar vaga (vale o novo)
  update public.impulsos set pagar_ate = now() where store_id = p_store and status = 'pendente' and pagar_ate > now();
  if not ativo_agora and public.impulso_ocupadas(p_store) >= c.vagas then raise exception 'sem_vaga'; end if;
  pct := case when p_dias >= 30 then c.desc_30 when p_dias >= 15 then c.desc_15 when p_dias >= 7 then c.desc_7 else 0 end;
  v := round(p_dias * c.preco_dia * (1 - pct / 100.0), 2);
  if v <= 0 then raise exception 'valor_invalido'; end if;
  insert into public.impulsos (store_id, dias, valor, documento, aceite_em, pagar_ate)
  values (p_store, p_dias, v, p_documento, now(), now() + interval '15 minutes') returning * into novo;
  return json_build_object('id', novo.id, 'valor', novo.valor, 'dias', novo.dias, 'pagar_ate', novo.pagar_ate, 'desconto_pct', pct);
end $$;
revoke all on function public.impulso_criar(uuid, int, text) from public;
grant execute on function public.impulso_criar(uuid, int, text) to service_role;

-- 6. Ativa a compra quando o PIX e pago (so o webhook chama). Se ja tem impulso valido, soma os dias no fim do prazo.
--    Devolve 'ativado', 'ja_ativado', 'estornar' (vaga acabou depois que o prazo de 15 minutos passou) ou 'nao_encontrado'.
create or replace function public.impulso_ativar(p_id uuid, p_payment text)
returns text language plpgsql security definer set search_path = public as $$
declare i public.impulsos; s public.stores; c public.impulso_config; fim timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('impulso_vagas'));
  select * into i from public.impulsos where id = p_id for update;
  if i.id is null then return 'nao_encontrado'; end if;
  if i.status = 'pago' then return 'ja_ativado'; end if;
  select * into s from public.stores where id = i.store_id;
  select * into c from public.impulso_config where id = 1;
  if s.impulso in ('patrocinada', 'destaque') and s.impulso_ate > now() then
    fim := s.impulso_ate + make_interval(days => i.dias);
  else
    if public.impulso_ocupadas(i.store_id) >= c.vagas then
      update public.impulsos set status = 'sem_vaga', asaas_payment_id = coalesce(p_payment, asaas_payment_id) where id = i.id;
      return 'estornar';
    end if;
    fim := now() + make_interval(days => i.dias);
  end if;
  update public.stores set impulso = 'patrocinada', impulso_ate = fim where id = i.store_id;
  update public.impulsos set status = 'pago', ativado_em = now(), ate = fim, asaas_payment_id = coalesce(p_payment, asaas_payment_id) where id = i.id;
  return 'ativado';
end $$;
revoke all on function public.impulso_ativar(uuid, text) from public;
grant execute on function public.impulso_ativar(uuid, text) to service_role;

-- Conferencia: deve mostrar 5 vagas, 5 livres, R$ 4,00 por dia
select public.impulso_vagas();
