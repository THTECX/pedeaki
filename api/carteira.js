/**
 * CARTEIRA do lojista e do motoboy: subconta Asaas criada pela conta do Pede Aki.
 *
 * Corpo { acao, dono, ... }:
 *   acao 'ver'      -> situacao da carteira (consulta o Asaas quando faz sentido) e o saldo, ou { existe: false } com sugestao
 *   acao 'criar'    -> cria a subconta com os dados do formulario e grava a carteira sozinha (loja: split do PIX; motoboy: repasse)
 *   acao 'repassar' -> (so o banco, com x-push-segredo) transfere o frete pendente dos motoboys que ja tem carteira
 * Quem e o dono:
 *   dono 'loja'    + store_id + cabecalho Authorization (login do dono da loja ou do administrador)
 *   dono 'motoboy' + token (sessao do motoboy)  ou  motoboy_id + Authorization do administrador
 *
 * Variaveis na Vercel: as do Asaas (_asaas.js) e CARTEIRA_SEGREDO (texto longo qualquer, cifra a chave de leitura da subconta).
 * Opcional: ASAAS_EMAIL_AVISOS (e-mail que recebe os avisos de falha do webhook das subcontas).
 */
import crypto from 'node:crypto';
import { criarClientes, documentoValido, iguais, r2 } from './_asaas.js';

const enc = encodeURIComponent;
const TIPOS_EMPRESA = ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'];
const EVENTOS_CONTA = [
    'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED', 'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL', 'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING', 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
    'ACCOUNT_STATUS_DOCUMENT_APPROVED', 'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL', 'ACCOUNT_STATUS_DOCUMENT_PENDING', 'ACCOUNT_STATUS_DOCUMENT_REJECTED',
    'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED', 'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL', 'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING', 'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED',
];
const urlAcesso = (env) => (env.ASAAS_AMBIENTE === 'producao' ? 'https://www.asaas.com/login' : 'https://sandbox.asaas.com/login');

// ---------------------------------------------------------------- cifra da chave de leitura da subconta (AES-256-GCM)
const chaveCifra = (env) => (env.CARTEIRA_SEGREDO && String(env.CARTEIRA_SEGREDO).length >= 16
    ? crypto.createHash('sha256').update(String(env.CARTEIRA_SEGREDO)).digest() : null);
export function cifrar(texto, env) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', chaveCifra(env), iv);
    const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), dados].map(b => b.toString('base64')).join('.');
}
export function decifrar(s, env) {
    try {
        const [iv, tag, dados] = String(s).split('.').map(p => Buffer.from(p, 'base64'));
        const d = crypto.createDecipheriv('aes-256-gcm', chaveCifra(env), iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(dados), d.final()]).toString('utf8');
    } catch { return null; }
}

const mascararDoc = (d) => (d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`);

/** O que a tela pode ver da carteira (nunca a chave). */
function publico(c) {
    const linkValido = c.onboarding_url && (!c.onboarding_expira || new Date(c.onboarding_expira).getTime() > Date.now());
    return {
        status_geral: c.status_geral, status_documentos: c.status_documentos, status_comercial: c.status_comercial,
        nome: c.nome, email: c.email, documento: c.documento, motivo_recusa: c.motivo_recusa,
        onboarding_url: linkValido ? c.onboarding_url : null, criada_em: c.criada_em, tem_carteira: !!c.wallet_id,
    };
}

// ---------------------------------------------------------------- quem esta pedindo
async function identificar({ corpo, authorization, env, buscar, sup }) {
    const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
    const temLogin = /^Bearer .{20,}/.test(authorization || '');
    const comLogin = async (fn, args) => {
        const r = await buscar(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: anon, Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
        return r.ok ? r.json().catch(() => false) : false;
    };
    if (corpo.dono === 'loja') {
        const storeId = corpo.store_id;
        if (!temLogin || typeof storeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(storeId)) return null;
        if ((await comLogin('carteira_posso_loja', { p_store: storeId })) !== true) return null;
        const [loja] = await sup(`/rest/v1/stores?id=eq.${enc(storeId)}&select=id,name,modelo`);
        if (!loja) return null;
        const porAdmin = (await comLogin('carteira_sou_admin')) === true;
        return { tipo: 'loja', id: loja.id, porAdmin, modelo: loja.modelo, sugestao: { nome: loja.name || '' } };
    }
    if (corpo.dono === 'motoboy') {
        let m;
        if (typeof corpo.token === 'string' && corpo.token.length >= 16) {
            [m] = await sup(`/rest/v1/motoboys_app?session_token=eq.${enc(corpo.token)}&ativo=eq.true&select=id,nome,telefone`);
            if (!m) return null;
            return { tipo: 'motoboy', id: m.id, porAdmin: false, sugestao: { nome: m.nome || '', telefone: m.telefone || '' } };
        }
        if (temLogin && typeof corpo.motoboy_id === 'string' && /^[0-9a-f-]{36}$/i.test(corpo.motoboy_id)) {
            if ((await comLogin('carteira_sou_admin')) !== true) return null;
            [m] = await sup(`/rest/v1/motoboys_app?id=eq.${enc(corpo.motoboy_id)}&select=id,nome,telefone`);
            if (!m) return null;
            return { tipo: 'motoboy', id: m.id, porAdmin: true, sugestao: { nome: m.nome || '', telefone: m.telefone || '' } };
        }
    }
    return null;
}

const filtroDono = (quem) => (quem.tipo === 'loja' ? `store_id=eq.${quem.id}` : `motoboy_id=eq.${quem.id}`);

// ---------------------------------------------------------------- ver
async function ver(quem, { env, sup, asaasCom }) {
    const [c] = await sup(`/rest/v1/carteiras?${filtroDono(quem)}&select=*`);
    if (!c) return { status: 200, corpo: { existe: false, sugestao: quem.sugestao, acesso: urlAcesso(env) } };

    let atual = c, saldo = null;
    const idadeMs = Date.now() - new Date(c.criada_em).getTime();
    if (c.asaas_account_id && idadeMs > 15000 && chaveCifra(env)) {
        const [k] = await sup(`/rest/v1/carteiras_chaves?carteira_id=eq.${c.id}&select=chave_cifrada`);
        const chave = k ? decifrar(k.chave_cifrada, env) : null;
        if (chave) {
            const sub = asaasCom(chave);
            const velho = Date.now() - new Date(c.atualizada_em).getTime() > 20000;
            const mudar = {};
            if (velho && c.status_geral !== 'APPROVED') {
                try {
                    const st = await sub('/myAccount/status');
                    Object.assign(mudar, { status_geral: st.general || c.status_geral, status_documentos: st.documentation || null, status_comercial: st.commercialInfo || null, status_banco: st.bankAccountInfo || null });
                } catch (e) { console.warn('carteira status', e.message); }
                try {
                    const d = await sub('/myAccount/documents');
                    const grupo = (d.data || []).find(g => g.onboardingUrl && ['NOT_SENT', 'REJECTED'].includes(g.status));
                    Object.assign(mudar, { onboarding_url: grupo ? grupo.onboardingUrl : null, onboarding_expira: grupo ? grupo.onboardingUrlExpirationDate || null : null, motivo_recusa: d.rejectReasons || null });
                } catch (e) { console.warn('carteira documentos', e.message); }
            }
            if (Object.keys(mudar).length) {
                mudar.atualizada_em = new Date().toISOString();
                await sup(`/rest/v1/carteiras?id=eq.${c.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(mudar) });
                atual = { ...c, ...mudar };
            }
            try { const b = await sub('/finance/balance'); if (typeof b.balance === 'number') saldo = b.balance; } catch (e) { console.warn('carteira saldo', e.message); }
        }
    }
    return { status: 200, corpo: { existe: true, carteira: publico(atual), saldo, acesso: urlAcesso(env) } };
}

// ---------------------------------------------------------------- criar
function validar(d) {
    const so = (v) => String(v || '').replace(/\D/g, '');
    const nome = String(d.nome || '').trim();
    const email = String(d.email || '').trim().toLowerCase();
    const doc = documentoValido(d.documento);
    let celular = so(d.celular); if (celular.startsWith('55') && celular.length === 13) celular = celular.slice(2);
    const renda = Number(String(d.renda || '').replace(/\./g, '').replace(',', '.'));
    const cep = so(d.cep);
    if (nome.length < 3) return { erro: 'Digite o nome completo (ou a razao social).' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { erro: 'Digite um e-mail valido. O acesso a carteira chega nele.' };
    if (!doc) return { erro: 'CPF ou CNPJ invalido.' };
    if (celular.length !== 11) return { erro: 'Digite o celular com DDD (11 numeros).' };
    if (!(renda > 0)) return { erro: 'Informe o faturamento (ou renda) mensal aproximado.' };
    if (cep.length !== 8) return { erro: 'CEP invalido.' };
    if (!String(d.rua || '').trim() || !String(d.numero || '').trim() || !String(d.bairro || '').trim()) return { erro: 'Preencha rua, numero e bairro.' };
    const corpo = {
        name: nome.slice(0, 100), email, cpfCnpj: doc, mobilePhone: celular, incomeValue: r2(renda),
        address: String(d.rua).trim().slice(0, 120), addressNumber: String(d.numero).trim().slice(0, 10),
        complement: String(d.complemento || '').trim().slice(0, 60) || undefined, province: String(d.bairro).trim().slice(0, 60), postalCode: cep,
    };
    if (doc.length === 11) {
        const n = String(d.nascimento || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(n)) return { erro: 'Informe a data de nascimento.' };
        const idade = (Date.now() - new Date(`${n}T12:00:00Z`).getTime()) / (365.25 * 86400000);
        if (!(idade >= 18 && idade < 110)) return { erro: 'A carteira e so para maiores de 18 anos.' };
        corpo.birthDate = n;
    } else {
        if (!TIPOS_EMPRESA.includes(d.tipo_empresa)) return { erro: 'Escolha o tipo da empresa (MEI, LTDA, Individual ou Associacao).' };
        corpo.companyType = d.tipo_empresa;
    }
    return { corpo };
}

async function criar(quem, dados, { env, sup, asaas }) {
    if (quem.tipo === 'loja' && quem.modelo !== 'comissao') return { status: 409, corpo: { erro: 'A carteira e so para lojas de comissao.' } };
    if (!env.ASAAS_API_KEY || !chaveCifra(env)) return { status: 500, corpo: { erro: 'Carteira indisponivel no momento (configuracao do servidor).' } };
    const v = validar(dados || {});
    if (v.erro) return { status: 400, corpo: { erro: v.erro } };

    // Reserva a vaga (uma carteira por dono): dois toques seguidos nao criam duas subcontas.
    let reserva;
    try {
        [reserva] = await sup('/rest/v1/carteiras', {
            method: 'POST', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ dono_tipo: quem.tipo, store_id: quem.tipo === 'loja' ? quem.id : null, motoboy_id: quem.tipo === 'motoboy' ? quem.id : null, nome: v.corpo.name, email: v.corpo.email, documento: mascararDoc(v.corpo.cpfCnpj), criada_por: quem.porAdmin ? 'admin' : 'dono' }),
        });
    } catch (e) {
        if (String(e.message).includes('409') || String(e.message).includes('duplicate')) return { status: 409, corpo: { erro: 'Esta carteira ja foi criada. Abra de novo a tela da carteira.' } };
        throw e;
    }

    const pedido = { ...v.corpo };
    const token = String(env.ASAAS_WEBHOOK_TOKEN || '');
    if (token.length >= 32 && token.length <= 255 && env.ASAAS_EMAIL_AVISOS) {
        pedido.webhooks = [{ name: 'Pede Aki - situacao da carteira', url: 'https://pedeaki.tecx.pro/api/asaas-webhook', email: env.ASAAS_EMAIL_AVISOS, interrupted: false, enabled: true, apiVersion: 3, authToken: token, sendType: 'SEQUENTIALLY', events: EVENTOS_CONTA }];
    }
    // Chave que o Pede Aki guarda: SO LEITURA (situacao, documentos e saldo). Ela nao movimenta o dinheiro de ninguem.
    pedido.accessTokenConfig = { name: 'pedeaki-leitura', permissions: [{ name: 'ACCOUNT_INFO', scope: 'READ' }, { name: 'ACCOUNT_DOCUMENT', scope: 'READ' }, { name: 'FINANCIAL_TRANSACTION', scope: 'READ' }] };

    let conta;
    try {
        try {
            conta = await asaas('/accounts', 'POST', pedido);
        } catch (e) {
            // Conta do Pede Aki sem permissao para chave restrita: cria sem o pedido de chave (o Asaas recusa ANTES de criar)
            if (e.status === 400 && /accessToken|permiss/i.test(JSON.stringify(e.asaas || ''))) {
                delete pedido.accessTokenConfig;
                conta = await asaas('/accounts', 'POST', pedido);
            } else throw e;
        }
    } catch (e) {
        await sup(`/rest/v1/carteiras?id=eq.${reserva.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
        const msg = e.asaas && Array.isArray(e.asaas.errors) && e.asaas.errors[0] ? e.asaas.errors[0].description : null;
        console.error('carteira criar', e.message);
        return { status: e.status && e.status < 500 ? 400 : 502, corpo: { erro: msg ? `O Asaas recusou: ${msg}` : 'Nao foi possivel criar a carteira agora. Tente de novo.' } };
    }

    // Daqui em diante a subconta EXISTE no Asaas: nada de apagar a reserva; erro vira aviso para o Super Admin.
    const avisos = [];
    await sup(`/rest/v1/carteiras?id=eq.${reserva.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ asaas_account_id: conta.id, wallet_id: conta.walletId || null, status_geral: 'PENDING', atualizada_em: new Date(0).toISOString() }),
    });
    const apiKey = (conta.accessToken && conta.accessToken.apiKey) || conta.apiKey;
    if (apiKey) {
        await sup('/rest/v1/carteiras_chaves', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify({ carteira_id: reserva.id, chave_cifrada: cifrar(apiKey, env) }) })
            .catch(e => { avisos.push('chave'); console.error('carteira chave', e.message); });
    }
    if (conta.walletId) {
        try {
            if (quem.tipo === 'loja') {
                const feito = await sup(`/rest/v1/loja_financeiro?store_id=eq.${quem.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ asaas_wallet_id: conta.walletId }) });
                if (!feito || !feito.length) await sup('/rest/v1/loja_financeiro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ store_id: quem.id, asaas_wallet_id: conta.walletId }) });
            } else {
                await sup(`/rest/v1/motoboys_app?id=eq.${quem.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ wallet_id: conta.walletId }) });
            }
        } catch (e) { avisos.push('wallet'); console.error('carteira wallet', e.message); }
    }
    const [c] = await sup(`/rest/v1/carteiras?id=eq.${reserva.id}&select=*`);
    return { status: 200, corpo: { existe: true, criada_agora: true, carteira: publico(c), saldo: null, acesso: urlAcesso(env), avisos } };
}

// ---------------------------------------------------------------- repassar o frete aos motoboys (transferencia entre contas Asaas)
async function repassar({ sup, asaas }) {
    const lista = await sup('/rest/v1/repasses_motoboy?status=eq.pendente&tentativas=lt.5&select=id,valor,tentativas,motoboy_id,motoboys_app(wallet_id)&order=criado_em.asc&limit=20');
    const feitos = [];
    for (const r of lista || []) {
        const wallet = r.motoboys_app && r.motoboys_app.wallet_id;
        if (!wallet || !(Number(r.valor) > 0)) continue;
        // Reserva: so quem muda de pendente para enviando faz a transferencia (duas chamadas juntas nao pagam duas vezes)
        const pego = await sup(`/rest/v1/repasses_motoboy?id=eq.${r.id}&status=eq.pendente`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'enviando' }) });
        if (!pego || !pego.length) continue;
        try {
            const t = await asaas('/transfers', 'POST', { value: r2(r.valor), walletId: wallet, externalReference: `repasse:${r.id}` });
            const pronto = t.status === 'DONE';
            const falhou = t.status === 'FAILED' || t.status === 'CANCELLED';
            await sup(`/rest/v1/repasses_motoboy?id=eq.${r.id}`, {
                method: 'PATCH', headers: { Prefer: 'return=minimal' },
                body: JSON.stringify(falhou
                    ? { status: 'pendente', tentativas: r.tentativas + 1, ultimo_erro: `Asaas: ${t.failReason || t.status}`, asaas_transfer_id: t.id }
                    : { status: pronto ? 'pago' : 'enviando', pago_em: pronto ? new Date().toISOString() : null, asaas_transfer_id: t.id, ultimo_erro: null }),
            });
            feitos.push({ id: r.id, status: t.status });
        } catch (e) {
            // Asaas respondeu recusando: volta para a fila. Sem resposta (rede): fica "enviando" para o Super Admin conferir,
            // porque a transferencia pode ter acontecido e tentar de novo pagaria duas vezes.
            const recusou = !!e.status;
            await sup(`/rest/v1/repasses_motoboy?id=eq.${r.id}`, {
                method: 'PATCH', headers: { Prefer: 'return=minimal' },
                body: JSON.stringify(recusou
                    ? { status: 'pendente', tentativas: r.tentativas + 1, ultimo_erro: String(e.message).slice(0, 300) }
                    : { ultimo_erro: 'Sem resposta do Asaas: conferir no extrato antes de pagar de novo' }),
            }).catch(() => {});
            console.error('repasse motoboy', r.id, e.message);
        }
    }
    return { status: 200, corpo: { ok: true, feitos } };
}

// ---------------------------------------------------------------- entrada
export async function tratar({ authorization, segredoRecebido, corpo, env, buscar }) {
    corpo = corpo || {};
    const ctx = { env, ...criarClientes(env, buscar) };
    if (corpo.acao === 'repassar') {
        if (!env.PUSH_SEGREDO || !iguais(segredoRecebido, env.PUSH_SEGREDO)) return { status: 401, corpo: { erro: 'negado' } };
        if (!env.ASAAS_API_KEY) return { status: 500, corpo: { erro: 'sem chave' } };
        return repassar(ctx);
    }
    if (corpo.acao !== 'ver' && corpo.acao !== 'criar') return { status: 400, corpo: { erro: 'acao invalida' } };
    const quem = await identificar({ corpo, authorization, env, buscar, sup: ctx.sup });
    if (!quem) return { status: 401, corpo: { erro: 'Sem permissao. Entre de novo.' } };
    return corpo.acao === 'ver' ? ver(quem, ctx) : criar(quem, corpo.dados, ctx);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).json({ erro: 'metodo' }); return; }
    try {
        const r = await tratar({
            authorization: req.headers.authorization, segredoRecebido: req.headers['x-push-segredo'],
            corpo: typeof req.body === 'string' ? JSON.parse(req.body) : req.body, env: process.env, buscar: fetch,
        });
        res.status(r.status).json(r.corpo);
    } catch (e) {
        console.error('carteira', e.message);
        res.status(502).json({ erro: 'Nao foi possivel falar com a carteira agora. Tente de novo.' });
    }
}
