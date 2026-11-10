-- SQL 19: impulsionamento de loja na vitrine (produto vendido por periodo).
-- impulso: 'nenhum' (padrao), 'patrocinada' (faixa de selos) ou 'destaque' (banner grande no topo).
-- impulso_ate: data em que o impulso termina. Sem data ou data passada = a loja NAO aparece como impulsionada.
-- So ACRESCENTA colunas e um gatilho. Nenhuma loja fica impulsionada sozinha.

alter table public.stores add column if not exists impulso text not null default 'nenhum';
alter table public.stores add column if not exists impulso_ate timestamptz;
alter table public.stores drop constraint if exists stores_impulso_check;
alter table public.stores add constraint stores_impulso_check check (impulso in ('nenhum', 'patrocinada', 'destaque'));

-- O lojista nao pode se impulsionar sozinho: so o administrador da plataforma (ou o editor de SQL do Supabase) altera.
create or replace function public.stores_protege_impulso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_admin() and (
        new.impulso is distinct from old.impulso
     or new.impulso_ate is distinct from old.impulso_ate) then
    raise exception 'Somente o administrador da plataforma altera o impulsionamento.';
  end if;
  return new;
end $$;
drop trigger if exists stores_protege_impulso on public.stores;
create trigger stores_protege_impulso before update on public.stores
  for each row execute function public.stores_protege_impulso();

-- Conferencia: deve listar todas as lojas com impulso 'nenhum'.
select name, impulso, impulso_ate from public.stores order by name;
