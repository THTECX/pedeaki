/**
 * Devolve o PIX de um pedido pago que a LOJA deixou sem resposta por 15 minutos (o banco cancela o pedido e chama aqui).
 *
 * Quem chama: o banco (rotina expirar_aceite_lojista, via pg_net) com o cabecalho x-push-segredo, o mesmo segredo do aviso de pedido.
 * So age em pedido Cancelado e pago online; chamar de novo nao faz nada de novo. Falha do Asaas deixa o pedido como
 * "estorno_pendente" para o Super Admin resolver na mao (mesmo caminho do estorno pedido pelo lojista).
 */
import { criarClientes, iguais } from './_asaas.js';

export async function tratar({ segredoRecebido, corpo, env, buscar }) {
    if (!env.PUSH_SEGREDO || !iguais(segredoRecebido, env.PUSH_SEGREDO)) return { status: 401, corpo: { erro: 'negado' } };
    const orderId = corpo && corpo.order_id;
    if (!orderId || typeof orderId !== 'string') return { status: 400, corpo: { erro: 'pedido ausente' } };

    const { sup, asaas } = criarClientes(env, buscar);
    const id = encodeURIComponent(orderId);
    const [o] = await sup(`/rest/v1/orders?id=eq.${id}&select=id,status,payment_status,asaas_payment_id`);
    if (!o || o.status !== 'Cancelado' || o.payment_status !== 'pago' || !o.asaas_payment_id) return { status: 200, corpo: { estornado: false, motivo: 'nada a estornar' } };

    try {
        await asaas(`/payments/${o.asaas_payment_id}/refund`, 'POST', { description: 'A loja nao respondeu ao pedido a tempo' });
    } catch (e) {
        await sup(`/rest/v1/orders?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ payment_status: 'estorno_pendente' }) });
        await sup(`/rest/v1/pagamentos?asaas_payment_id=eq.${encodeURIComponent(o.asaas_payment_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'ESTORNO_FALHOU', atualizado_em: new Date().toISOString() }) });
        console.error('estorno-automatico recusado', e.message);
        return { status: 200, corpo: { estornado: false, pendente: true } };
    }
    await sup(`/rest/v1/orders?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ payment_status: 'estornando' }) });
    await sup(`/rest/v1/pagamentos?asaas_payment_id=eq.${encodeURIComponent(o.asaas_payment_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'ESTORNO_SOLICITADO', atualizado_em: new Date().toISOString() }) });
    return { status: 200, corpo: { estornado: true } };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).json({ erro: 'metodo' }); return; }
    try {
        const r = await tratar({ segredoRecebido: req.headers['x-push-segredo'], corpo: typeof req.body === 'string' ? JSON.parse(req.body) : req.body, env: process.env, buscar: fetch });
        res.status(r.status).json(r.corpo);
    } catch (e) {
        console.error('estorno-automatico', e.message);
        res.status(502).json({ erro: 'falha' });
    }
}
