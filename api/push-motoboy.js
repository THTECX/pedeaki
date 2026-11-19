/**
 * Avisa o(s) motoboy(s) por Web Push: COLETA DISPONIVEL (pedido pronto e ninguem aceitou: todos os online) ou PEDIDO PRONTO (so o motoboy que ja aceitou). Funcao serverless da Vercel.
 *
 * Quem chama: o banco (gatilho entregas_push e a rotina push_lembretes_entrega, via pg_net) com o cabecalho x-push-segredo.
 * So a coleta disponivel avisa: a previa e a efetivada nao tocam o celular (nao amolar o motoboy a toa).
 * O banco so entrega as assinaturas se o segredo bater (funcao push_para_entrega).
 *
 * Variaveis na Vercel: as mesmas do aviso de pedido (PUSH_SEGREDO, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e as do Supabase).
 */
import crypto from 'node:crypto';
import webpush from 'web-push';

const iguais = (a, b) => {
    const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const brl = (v) => `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;

export async function tratar({ segredoRecebido, corpo, env, buscar, enviar }) {
    if (!env.PUSH_SEGREDO || !iguais(segredoRecebido, env.PUSH_SEGREDO)) return { status: 401, corpo: { erro: 'negado' } };
    const entregaId = corpo && corpo.entrega_id;
    if (!entregaId || typeof entregaId !== 'string') return { status: 400, corpo: { erro: 'entrega ausente' } };

    const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const chave = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
    const rpc = async (nome, args) => {
        const r = await buscar(`${base}/rest/v1/rpc/${nome}`, {
            method: 'POST', headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
        });
        const t = await r.text();
        if (!r.ok) throw new Error(`${nome}: ${r.status} ${t.slice(0, 120)}`);
        return t ? JSON.parse(t) : null;
    };

    const info = await rpc('push_para_entrega', { p_entrega: entregaId, p_segredo: env.PUSH_SEGREDO });
    if (!info || !info.enviar || !Array.isArray(info.subs) || info.subs.length === 0) return { status: 200, corpo: { enviados: 0, motivo: 'nada a enviar' } };

    const lembrete = !!(corpo && corpo.lembrete);
    const pronto = info.tipo === 'pronto'; // o motoboy ja aceitou e a loja marcou Pronto
    const mensagem = JSON.stringify({
        titulo: pronto ? 'Pedido pronto, pode coletar' : (lembrete ? 'Coleta ainda esperando!' : 'Coleta disponível'),
        texto: pronto
            ? `${info.loja || 'Loja'} marcou o pedido como pronto. Frete ${brl(info.frete)}. Toque para abrir.`
            : `${info.loja || 'Loja'}${info.bairro ? ' para ' + info.bairro : ''}. Frete ${brl(info.frete)}. ${lembrete ? 'Ninguém pegou ainda.' : 'Toque para abrir.'}`,
        tag: `coleta-${entregaId}`,
        url: '/motoboy',
    });

    const mortos = [];
    let enviados = 0;
    await Promise.all(info.subs.map(async (s) => {
        try {
            await enviar({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, mensagem, { TTL: 600, urgency: 'high' });
            enviados++;
        } catch (e) {
            if (e && (e.statusCode === 404 || e.statusCode === 410)) mortos.push(s.id);
        }
    }));
    if (mortos.length) { try { await rpc('push_motoboy_remover', { p_ids: mortos, p_segredo: env.PUSH_SEGREDO }); } catch (_) { /* tenta de novo no proximo envio */ } }
    return { status: 200, corpo: { enviados, removidos: mortos.length } };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ erro: 'metodo' });
    const env = process.env;
    const pub = env.VAPID_PUBLIC_KEY || env.VITE_VAPID_PUBLIC_KEY;
    if (!pub || !env.VAPID_PRIVATE_KEY) return res.status(500).json({ erro: 'VAPID não configurado' });
    webpush.setVapidDetails(env.VAPID_ASSUNTO || 'https://pedeaki.tecx.pro', pub, env.VAPID_PRIVATE_KEY);

    let corpo = req.body;
    if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch (_) { corpo = null; } }
    try {
        const r = await tratar({ segredoRecebido: req.headers['x-push-segredo'], corpo, env, buscar: fetch, enviar: (sub, msg, opc) => webpush.sendNotification(sub, msg, opc) });
        return res.status(r.status).json(r.corpo);
    } catch (e) {
        return res.status(500).json({ erro: String((e && e.message) || e).slice(0, 200) });
    }
}
