/** Carteira (subconta Asaas) do lojista e do motoboy. Tudo passa pelo servidor (api/carteira.js). */

export interface CarteiraPublica {
    status_geral: string;              // CRIANDO, PENDING, AWAITING_APPROVAL, APPROVED, REJECTED
    status_documentos: string | null;
    status_comercial: string | null;
    nome: string | null;
    email: string | null;
    documento: string | null;
    motivo_recusa: string | null;
    onboarding_url: string | null;
    criada_em: string;
    tem_carteira: boolean;
}

export interface RespostaCarteira {
    existe: boolean;
    criada_agora?: boolean;
    carteira?: CarteiraPublica;
    saldo?: number | null;
    acesso: string;
    sugestao?: { nome?: string; telefone?: string };
    avisos?: string[];
}

export type DonoCarteira =
    | { dono: 'loja'; store_id: string; authToken: string }
    | { dono: 'motoboy'; token: string }
    | { dono: 'motoboy'; motoboy_id: string; authToken: string };

export interface DadosCarteira {
    nome: string; email: string; documento: string; nascimento: string; tipo_empresa: string;
    celular: string; renda: string; cep: string; rua: string; numero: string; complemento: string; bairro: string;
}

export async function chamarCarteira(acao: 'ver' | 'criar', quem: DonoCarteira, dados?: DadosCarteira): Promise<RespostaCarteira> {
    const { authToken, ...resto } = quem as DonoCarteira & { authToken?: string };
    const r = await fetch('/api/carteira', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ acao, ...resto, dados }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não foi possível abrir a carteira agora.');
    return j as RespostaCarteira;
}

/** Em que pé está a carteira, em linguagem de gente. */
export type EtapaCarteira = 'criando' | 'falta_enviar' | 'docs_recusados' | 'analise' | 'aprovada' | 'recusada';
export function etapaDaCarteira(c: CarteiraPublica): EtapaCarteira {
    if (c.status_geral === 'CRIANDO') return 'criando';
    if (c.status_geral === 'APPROVED') return 'aprovada';
    if (c.status_geral === 'REJECTED') return 'recusada';
    if (c.status_documentos === 'REJECTED') return 'docs_recusados';
    if (c.status_geral === 'AWAITING_APPROVAL' || c.status_documentos === 'AWAITING_APPROVAL' || c.status_documentos === 'APPROVED') return 'analise';
    return 'falta_enviar';
}
