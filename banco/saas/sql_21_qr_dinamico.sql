-- SQL 21: QR Code dinamico. O QR impresso leva ao link curto /q/CODIGO; o destino fica aqui e pode ser trocado quando quiser.
-- Dois tipos: 'loja' (uma loja do Pede Aki, guarda a loja e nao o endereco) e 'url' (qualquer endereco http/https).
-- 'vazio' = criado antes, sem destino ainda (placa impressa antes da venda).
-- So o administrador da plataforma cria e edita. Quem le o QR nao precisa de login (funcao qr_resolver).
-- So ACRESCENTA uma tabela e funcoes.

create table if not exists public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[A-Za-z0-9]{4,12}$'),
  nome text not null,
  tipo text not null default 'vazio' check (tipo in ('loja', 'url', 'vazio')),
  store_id uuid references public.stores(id) on delete set null,
  url text check (url is null or url ~* '^https?://'),
  ativo boolean not null default true,
  lote text,
  leituras int not null default 0,
  ultima_leitura timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists qr_codes_lote_idx on public.qr_codes (lote);
alter table public.qr_codes enable row level security;
drop policy if exists qr_codes_admin on public.qr_codes;
create policy qr_codes_admin on public.qr_codes for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Quem le o QR: devolve o destino e conta a leitura. Nao revela nada alem do destino do proprio codigo.
-- Resposta: {"estado":"ok","tipo":"loja","slug":"..."} | {"estado":"ok","tipo":"url","url":"..."} | {"estado":"vazio"|"pausado"|"inexistente"}
create or replace function public.qr_resolver(p_codigo text)
returns json language plpgsql security definer set search_path = public as $$
declare q public.qr_codes; slug_loja text;
begin
  select * into q from public.qr_codes where codigo = p_codigo;
  if q.id is null then return json_build_object('estado', 'inexistente'); end if;
  if not q.ativo then return json_build_object('estado', 'pausado'); end if;
  if q.tipo = 'loja' then
    select s.slug into slug_loja from public.stores s where s.id = q.store_id and s.is_active;
    if slug_loja is null then return json_build_object('estado', 'pausado'); end if;
    update public.qr_codes set leituras = leituras + 1, ultima_leitura = now() where id = q.id;
    return json_build_object('estado', 'ok', 'tipo', 'loja', 'slug', slug_loja);
  elsif q.tipo = 'url' and q.url is not null then
    update public.qr_codes set leituras = leituras + 1, ultima_leitura = now() where id = q.id;
    return json_build_object('estado', 'ok', 'tipo', 'url', 'url', q.url);
  end if;
  return json_build_object('estado', 'vazio');
end $$;
revoke all on function public.qr_resolver(text) from public;
grant execute on function public.qr_resolver(text) to anon, authenticated;

-- Conferencia: deve devolver {"estado":"inexistente"}
select public.qr_resolver('TESTE0');
