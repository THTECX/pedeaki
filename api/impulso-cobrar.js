/**
 * Cobra o impulso da vitrine que o proprio lojista comprou (PIX do Asaas, 100% para o Pede Aki, sem split).
 *
 * Quem chama: a tela de impulsionar do lojista. Cabeçalho Authorization com o login dele.
 * Corpo: { store_id, dias, documento, aceite }. aceite precisa ser true (nao reembolsavel apos a ativacao).
 * O valor e a vaga sao decididos no banco (funcao impulso_criar), nunca pelo que a tela mandar.
 * Quem ativa o impulso e o webhook, quando o PIX cai.
 * Devolve: { impulso_id, qr_imagem, copia_cola, valor, dias, pagar_ate, desconto_pct }.
 */
import { criarClientes, documentoValido } from './_asaas.js';

const hojeBR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

export async function tratar({ authorization, corpo, env, buscar }) {
    const { store_id: storeId, dias, documento, aceite } = corpo || {};
    if (!storeId || typeof storeId !== 'string' || !/^Bearer .{20,}/.test(authorization || '')) return { status: 401, corpo: { erro: 'negado' } };
    if (aceite !== true) return { status: 400, corpo: { erro: 'E preciso aceitar que o impulso nao e reembolsavel depois de ativado.' } };
    const nDias = Number(dias);
    if (!Number.isInteger(nDias) || nDias < 1 || nDias > 90) return { status: 400, corpo: { erro: 'Escolha de 1 a 90 dias.' } };
    const doc = documentoValido(documento);
    if (!doc) return { status: 400, corpo: { erro: 'CPF ou CNPJ invalido.' } };
    if (!env.ASAAS_API_KEY) return { status: 500, corpo: { erro: 'Pagamento indisponivel.' } };
    const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

    // 1. Leitura com o login do lojista: se ele nao e dono da loja, a lista vem vazia.
    const r = await buscar(`${base}/rest/v1/stores?id=eq.${encodeURIComponent(storeId)}&select=id,name`, { headers: { apikey: anon, Authorization: authorization } });
    const lista = r.ok ? await r.json().catch(() => []) : [];
    if (!Array.isArray(lista) || lista.length !== 1) return { status: 404, corpo: { erro: 'Loja nao encontrada.' } };
    const loja = lista[0];

    // 2. A partir daqui, chave de servico. O banco calcula valor e confere a vaga.
    const { sup, asaas } = criarClientes(env, buscar);
    let compra;
    try {
        compra = await sup('/rest/v1/rpc/impulso_criar', { method: 'POST', body: JSON.stringify({ p_store: loja.id, p_dias: nDias, p_documento: doc }) });
    } catch (e) {
        const m = String(e.message);
        if (m.includes('sem_vaga')) return { status: 409, corpo: { erro: 'As vagas de patrocinada acabaram. Tente de novo quando abrir uma vaga.' } };
        if (m.includes('loja_nao_elegivel')) return { status: 403, corpo: { erro: 'So lojas de comissao ativas e no shopping podem impulsionar.' } };
        if (m.includes('impulso_desligado')) return { status: 409, corpo: { erro: 'O impulsionamento esta pausado no momento.' } };
        throw e;
    }

    // 3. Cobranca no Asaas. Se falhar, libera a reserva da vaga na hora.
    try {
        const cliente = await asaas('/customers', 'POST', { name: String(loja.name || 'Loja Pede Aki').slice(0, 100), cpfCnpj: doc, externalReference: `loja:${loja.id}` });
        const cobranca = await asaas('/payments', 'POST', {
            customer: cliente.id, billingType: 'PIX', value: compra.valor, dueDate: hojeBR(),
            description: `Impulso na vitrine Pede Aki (${nDias} dias)`, externalReference: `impulso:${compra.id}`,
        });
        const qr = await asaas(`/payments/${cobranca.id}/pixQrCode`);
        await sup(`/rest/v1/impulsos?id=eq.${compra.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ asaas_payment_id: cobranca.id, pix_copia_cola: qr.payload, pix_imagem: qr.encodedImage }) });
        return { status: 200, corpo: { impulso_id: compra.id, qr_imagem: qr.encodedImage, copia_cola: qr.payload, valor: compra.valor, dias: compra.dias, pagar_ate: compra.pagar_ate, desconto_pct: compra.desconto_pct } };
    } catch (e) {
        await sup(`/rest/v1/impulsos?id=eq.${compra.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ pagar_ate: new Date().toISOString() }) }).catch(() => {});
        throw e;
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).json({ erro: 'metodo' }); return; }
    try {
        const r = await tratar({ authorization: req.headers.authorization, corpo: typeof req.body === 'string' ? JSON.parse(req.body) : req.body, env: process.env, buscar: fetch });
        res.status(r.status).json(r.corpo);
    } catch (e) {
        console.error('impulso-cobrar', e.message);
        res.status(502).json({ erro: 'Nao foi possivel gerar o PIX agora. Tente de novo.' });
    }
}
