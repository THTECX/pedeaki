-- SQL 23: telefone do cliente em QUALQUER formato acha os mesmos pedidos.
-- O cliente pode digitar (e o pedido pode estar gravado) como: 11 digitos (DDD + 9 + 8), 10 digitos (DDD + 8),
-- 9 digitos (9 + 8) ou so 8 digitos, com ou sem 55, com ou sem parenteses e traco.
-- Tres funcoes comparavam pelo "final dos digitos" (ilike) e falhavam quando o formato do pedido era outro:
-- o ultimo pedido do Perfil, a contagem de selos de fidelidade e o resgate de selos. Agora as tres comparam pela
-- regra unica do banco (fone_canonico: DDD + ultimos 8 digitos; sem DDD vale o 32). Mesma assinatura, mesmas permissoes.

create or replace function public.ultimo_pedido_por_telefone(p_store uuid, p_sufixo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_suf text := regexp_replace(coalesce(p_sufixo, ''), '\D', '', 'g'); v jsonb;
begin
  if p_store is null or length(v_suf) < 8 then return null; end if;
  select to_jsonb(o) into v from public.orders o
   where o.store_id = p_store and public.fone_canonico(o.phone) = public.fone_canonico(v_suf)
   order by o.timestamp desc limit 1;
  return v;
end $$;

create or replace function public.selos_do_cliente(p_store uuid, p_sufixo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_suf text := regexp_replace(coalesce(p_sufixo, ''), '\D', '', 'g'); v jsonb;
begin
  if p_store is null or length(v_suf) < 8 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(to_jsonb(o) order by o.timestamp asc), '[]'::jsonb) into v
    from public.orders o
   where o.store_id = p_store and public.fone_canonico(o.phone) = public.fone_canonico(v_suf)
     and o.is_loyalty_eligible = true and o.origin in ('WEB', 'APP')
     and o.status <> 'Cancelado' and o.loyalty_redeemed_at is null;
  return v;
end $$;

create or replace function public.resgatar_selos(p_store uuid, p_sufixo text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_suf text := regexp_replace(coalesce(p_sufixo, ''), '\D', '', 'g'); v_ids uuid[];
begin
  if p_store is null or length(v_suf) < 8 then raise exception 'Telefone invalido'; end if;
  select array_agg(id) into v_ids from (
    select id from public.orders
     where store_id = p_store and public.fone_canonico(phone) = public.fone_canonico(v_suf)
       and is_loyalty_eligible = true and status = 'Entregue' and loyalty_redeemed_at is null
     order by timestamp asc limit 10 for update) s;
  if coalesce(array_length(v_ids, 1), 0) < 10 then
    raise exception 'Saldo insuficiente de selos para resgate (minimo 10).';
  end if;
  update public.orders set loyalty_redeemed_at = now() where id = any(v_ids);
  return true;
end $$;

-- Conferencia: deve devolver true (as quatro formas de digitar acham o mesmo numero canonico)
select public.fone_canonico('32920007226') = public.fone_canonico('3220007226')
   and public.fone_canonico('3220007226') = public.fone_canonico('920007226')
   and public.fone_canonico('920007226') = public.fone_canonico('20007226')
   and public.fone_canonico('(32) 92000-7226') = public.fone_canonico('5532920007226') as quatro_formas_iguais;
