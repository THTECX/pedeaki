-- SQL 22: o administrador (e o dono da loja) le e grava o endereco da loja pelo Super Admin.
-- O endereco fica em settings.store_address e e o que o motoboy ve para coletar o pedido.
-- So ACRESCENTA duas funcoes.

create or replace function public.endereco_da_loja(p_store uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or public.owns_store(p_store)) then raise exception 'sem permissao nesta loja'; end if;
  return coalesce((select store_address from public.settings where store_id = p_store limit 1), '');
end $$;
revoke all on function public.endereco_da_loja(uuid) from public, anon;
grant execute on function public.endereco_da_loja(uuid) to authenticated;

create or replace function public.definir_endereco_da_loja(p_store uuid, p_endereco text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or public.owns_store(p_store)) then raise exception 'sem permissao nesta loja'; end if;
  if not exists (select 1 from public.settings where store_id = p_store) then
    raise exception 'A loja ainda nao tem configuracoes. Abra Configuracoes dentro do painel da loja uma vez e salve.';
  end if;
  update public.settings set store_address = nullif(btrim(p_endereco), '') where store_id = p_store;
end $$;
revoke all on function public.definir_endereco_da_loja(uuid, text) from public, anon;
grant execute on function public.definir_endereco_da_loja(uuid, text) to authenticated;

-- Conferencia: deve listar as lojas e o endereco de cada uma (vazio = ainda nao preenchido)
select s.name, (select store_address from public.settings where store_id = s.id limit 1) as endereco from public.stores s order by s.name;
