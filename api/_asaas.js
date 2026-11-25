/**
 * Ajudantes compartilhados das funções do Asaas (cobrar, webhook). O arquivo começa com _ para a Vercel
 * não expor como endereço. Tudo recebe o ambiente (env) e o fetch como argumento, para testar sem rede.
 *
 * Variáveis na Vercel: ASAAS_AMBIENTE (sandbox ou producao), ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN,
 * SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY (secret key sb_secret_).
 */
import crypto from 'node:crypto';

export const iguais = (a, b) => {
    const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Mesma conta do banco (fone_canonico): DDD mais os 8 últimos dígitos. */
export function foneCanonico(p, ddd = '32') {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
    if (d.length <= 8) return ddd + d.slice(-8);
    if (d.length - 8 >= 2) return d.slice(0, 2) + d.slice(-8);
    return ddd + d.slice(-8);
}

/** CPF (11) ou CNPJ (14) com dígitos verificadores. Devolve só os números ou null. */
export function documentoValido(valor) {
    const d = String(valor || '').replace(/\D/g, '');
    if (/^(\d)\1+$/.test(d)) return null;
    const dv = (base, pesos) => {
        const s = base.split('').reduce((a, c, i) => a + Number(c) * pesos[i], 0) % 11;
        return s < 2 ? 0 : 11 - s;
    };
    if (d.length === 11) {
        const a = dv(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
        const b = dv(d.slice(0, 9) + a, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
        return d.endsWith(`${a}${b}`) ? d : null;
    }
    if (d.length === 14) {
        const a = dv(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
        const b = dv(d.slice(0, 12) + a, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
        return d.endsWith(`${a}${b}`) ? d : null;
    }
    return null;
}

/**
 * Conta do pedido online: mesma regra de src/services/comissao.ts (calcularPedido) para PIX com entrega do lojista.
 * Usa a taxa MAIOR do PIX (R$ 1,99) mesmo na promoção, para a plataforma nunca ficar no prejuízo.
 */
export const TAXA_PIX = 1.99;
export function contaDoPedido({ total, frete, cond }) {
    total = r2(total);
    const base = r2(total - Math.min(r2(frete), total));
    const comissao = r2((base * (Number(cond.comissao_pct_propria) || 0)) / 100 + (base > 0 ? Number(cond.comissao_fixa) || 0 : 0));
    const lojistaPagaATaxa = !!cond.repassa_taxa_pagamento;
    const repasseLojista = r2(total - comissao - (lojistaPagaATaxa ? TAXA_PIX : 0));
    return { total, comissao, taxa: TAXA_PIX, repasseLojista };
}

export function criarClientes(env, buscar) {
    const baseSup = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const chaveSup = env.SUPABASE_SERVICE_ROLE_KEY;
    const sup = async (caminho, opcoes = {}) => {
        const r = await buscar(`${baseSup}${caminho}`, {
            ...opcoes,
            headers: { apikey: chaveSup, Authorization: `Bearer ${chaveSup}`, 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
        });
        const t = await r.text();
        if (!r.ok) throw new Error(`supabase ${caminho.split('?')[0]}: ${r.status} ${t.slice(0, 160)}`);
        return t ? JSON.parse(t) : null;
    };
    const baseAsaas = env.ASAAS_AMBIENTE === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
    // asaasCom(chave): mesma chamada com a chave de OUTRA conta (a chave de leitura da subconta do lojista ou do motoboy)
    const asaasCom = (chave) => async (caminho, metodo = 'GET', corpo) => {
        const r = await buscar(`${baseAsaas}${caminho}`, {
            method: metodo,
            headers: { access_token: chave, 'Content-Type': 'application/json', 'User-Agent': 'pedeaki' },
            body: corpo ? JSON.stringify(corpo) : undefined,
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { const e = new Error(`asaas ${caminho}: ${r.status} ${JSON.stringify(j.errors || j).slice(0, 200)}`); e.status = r.status; e.asaas = j; throw e; }
        return j;
    };
    const asaas = asaasCom(env.ASAAS_API_KEY);
    return { sup, asaas, asaasCom };
}
