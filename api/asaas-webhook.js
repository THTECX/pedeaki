/**
 * Recebe os avisos do Asaas (webhook). Confere o token, grava cada evento uma vez só e, quando o PIX é pago,
 * marca o pedido como pago (vira "Novo" e o lojista é avisado pelo gatilho do banco).
 *
 * Cadastro no Asaas: Integrações > Webhooks, URL https://pedeaki.tecx.pro/api/asaas-webhook, o token igual a
 * ASAAS_WEBHOOK_TOKEN, eventos de cobrança. Pagamento que chega depois do pedido expirar ou ser cancelado é estornado.
 * Resposta 200 = recebido; erro 500 faz o Asaas tentar de novo.
 */
import { criarClientes, iguais } from './_asaas.js';

const PAGO = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);

export async function tratar({ tokenRecebido, corpo, env, buscar }) {
    if (!env.ASAAS_WEBHOOK_TOKEN || !iguais(tokenRecebido, env.ASAAS_WEBHOOK_TOKEN)) return { status: 401, corpo: { erro: 'negado' } };
    const evento = corpo || {};
    const pagamento = evento.payment || {};
    if (!evento.id || !evento.event) return { status: 200, corpo: { ignorado: true } };

    const { sup, asaas } = criarClientes(env, buscar);
    const orderId = pagamento.externalReference ? String(pagamento.externalReference) : null;

    // Idempotência: mesmo evento reenviado não faz nada de novo se já foi tratado.
    const jaTem = await sup(`/rest/v1/asaas_eventos?id=eq.${encodeURIComponent(evento.id)}&select=tratado`);
    if (jaTem && jaTem[0] && jaTem[0].tratado) return { status: 200, corpo: { repetido: true } };
    if (!jaTem || !jaTem[0]) {
        await sup('/rest/v1/asaas_eventos', {
            method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
            body: JSON.stringify({ id: evento.id, tipo: evento.event, payment_id: pagamento.id || null, order_id: orderId, dados: evento }),
        });
    }

    let resultado = 'registrado';
    if (PAGO.has(evento.event) && pagamento.id && orderId && orderId.startsWith('impulso:')) {
        // Impulso da vitrine comprado pelo lojista: liga o impulso (soma dias se ja tinha). Sem vaga depois dos 15 minutos = devolve o valor.
        const r = await sup('/rest/v1/rpc/impulso_ativar', { method: 'POST', body: JSON.stringify({ p_id: orderId.slice(8), p_payment: pagamento.id }) });
        resultado = r;
        if (r === 'estornar') await asaas(`/payments/${pagamento.id}/refund`, 'POST', { description: 'Vagas de impulso esgotadas antes do pagamento' });
    } else if (PAGO.has(evento.event) && pagamento.id && orderId) {
        const r = await sup('/rest/v1/rpc/pedido_pago', { method: 'POST', body: JSON.stringify({ p_order: orderId, p_payment: pagamento.id }) });
        resultado = r;
        if (r === 'estornar') await asaas(`/payments/${pagamento.id}/refund`, 'POST', { description: 'Pedido expirado ou cancelado antes do pagamento' });
    } else if ((evento.event === 'PAYMENT_REFUNDED' || evento.event === 'PAYMENT_REFUND_IN_PROGRESS') && pagamento.id) {
        await sup(`/rest/v1/pagamentos?asaas_payment_id=eq.${encodeURIComponent(pagamento.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'ESTORNADO', atualizado_em: new Date().toISOString() }) });
        if (orderId) await sup(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&payment_status=neq.pago_apos_vencer`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ payment_status: 'estornado' }) });
    }
    // Eventos de split bloqueado ou divergente ficam gravados com tratado=false para o Super Admin alertar.
    const alerta = /SPLIT_DIVERGENCE|SPLIT_BLOCK|SPLIT_CANCELLED/.test(evento.event);
    if (!alerta) await sup(`/rest/v1/asaas_eventos?id=eq.${encodeURIComponent(evento.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ tratado: true }) });
    return { status: 200, corpo: { ok: true, resultado } };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).json({ erro: 'metodo' }); return; }
    try {
        const r = await tratar({ tokenRecebido: req.headers['asaas-access-token'], corpo: typeof req.body === 'string' ? JSON.parse(req.body) : req.body, env: process.env, buscar: fetch });
        res.status(r.status).json(r.corpo);
    } catch (e) {
        console.error('asaas-webhook', e.message);
        res.status(500).json({ erro: 'falha' });
    }
}
