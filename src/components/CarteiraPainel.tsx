import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet, ExternalLink, CheckCircle2, Clock, AlertTriangle, Mail, Loader2 } from 'lucide-react';
import { chamarCarteira, etapaDaCarteira, type DadosCarteira, type DonoCarteira, type RespostaCarteira } from '../services/carteira';

/**
 * CARTEIRA do lojista ou do motoboy (subconta Asaas criada pelo Pede Aki).
 * Sem carteira: formulario curto; o app cria a subconta e o Asaas manda o e-mail de ativacao.
 * Com carteira: mostra em que pe esta (falta enviar documentos, em analise, aprovada, recusada), o saldo e o botao para o Asaas.
 * Usado no painel do lojista (/carteira), no perfil do motoboy e no Super Admin (porAdmin: o Ikarus preenche pelo dono).
 */
interface Props {
    quem: DonoCarteira;
    tipo: 'loja' | 'motoboy';
    porAdmin?: boolean;
}

const so = (v: string) => v.replace(/\D/g, '');
const mascaraDoc = (v: string) => {
    const d = so(v).slice(0, 14);
    if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};
const mascaraCel = (v: string) => {
    const d = so(v).slice(0, 11);
    return d.length > 10 ? d.replace(/(\d{2})(\d{5})(\d{1,4})/, '($1) $2-$3') : d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '');
};
const mascaraCep = (v: string) => so(v).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

const VAZIO: DadosCarteira = { nome: '', email: '', documento: '', nascimento: '', tipo_empresa: 'MEI', celular: '', renda: '', cep: '', rua: '', numero: '', complemento: '', bairro: '' };
const campo = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-[15px] text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#F26B1D]';
const rotulo = 'block text-[12px] font-bold uppercase tracking-wide text-gray-600 mb-1';
const botaoLaranja = 'w-full rounded-lg bg-[#F26B1D] px-4 py-3 text-[15px] font-bold text-[#1F1F1F] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2';

export const CarteiraPainel: React.FC<Props> = ({ quem, tipo, porAdmin }) => {
    const [resp, setResp] = useState<RespostaCarteira | null>(null);
    const [erro, setErro] = useState('');
    const [form, setForm] = useState<DadosCarteira>(VAZIO);
    const [aceite, setAceite] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [abrirForm, setAbrirForm] = useState(false);
    const quemRef = useRef(quem);
    quemRef.current = quem;

    const carregar = useCallback(async () => {
        try {
            const r = await chamarCarteira('ver', quemRef.current);
            setResp(r); setErro('');
            if (!r.existe && r.sugestao) setForm(f => ({ ...f, nome: f.nome || r.sugestao?.nome || '', celular: f.celular || mascaraCel(r.sugestao?.telefone ? (so(r.sugestao.telefone).length === 10 ? so(r.sugestao.telefone).slice(0, 2) + '9' + so(r.sugestao.telefone).slice(2) : r.sugestao.telefone) : '') }));
        } catch (e) { setErro((e as Error).message); }
    }, []);

    useEffect(() => { void carregar(); }, [carregar]);

    // Enquanto nao estiver aprovada: confere de novo de tempos em tempos e quando a pessoa volta do Asaas para o app
    const etapa = resp?.existe && resp.carteira ? etapaDaCarteira(resp.carteira) : null;
    useEffect(() => {
        if (!etapa || etapa === 'aprovada' || etapa === 'recusada') return;
        const t = setInterval(() => { if (document.visibilityState === 'visible') void carregar(); }, 30000);
        const volta = () => { if (document.visibilityState === 'visible') void carregar(); };
        document.addEventListener('visibilitychange', volta);
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', volta); };
    }, [etapa, carregar]);

    const buscarCep = async (cep: string) => {
        if (so(cep).length !== 8) return;
        try {
            const r = await fetch(`https://viacep.com.br/ws/${so(cep)}/json/`);
            const j = await r.json();
            if (!j.erro) setForm(f => ({ ...f, rua: f.rua || j.logradouro || '', bairro: f.bairro || j.bairro || '' }));
        } catch { /* sem CEP automatico: a pessoa digita */ }
    };

    const criar = async (e: React.FormEvent) => {
        e.preventDefault();
        setErro('');
        if (!aceite) { setErro('Marque que está de acordo para continuar.'); return; }
        setEnviando(true);
        try {
            const r = await chamarCarteira('criar', quem, form);
            setResp(r);
            // a situacao e o link de documentos ficam prontos no Asaas uns segundos depois
            setTimeout(() => { void carregar(); }, 20000);
        } catch (e2) { setErro((e2 as Error).message); }
        setEnviando(false);
    };

    const set = (k: keyof DadosCarteira) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
    const ehCpf = so(form.documento).length <= 11;
    const quemRecebe = porAdmin ? (tipo === 'loja' ? 'o lojista' : 'o motoboy') : 'você';
    const explicacao = tipo === 'loja'
        ? 'Os PIX dos pedidos do app caem direto nesta carteira, já sem a comissão do Pede Aki. O saque é feito pelo app do Asaas, para a conta que você quiser.'
        : 'O frete de cada entrega cai nesta carteira logo depois que a entrega é confirmada. O saque é feito pelo app do Asaas, para a conta que você quiser.';

    if (!resp && !erro) return <div className="flex items-center gap-2 p-4 text-sm text-gray-600"><Loader2 size={16} className="animate-spin" />Abrindo a carteira...</div>;

    return (
        <div className="campos-legiveis space-y-4 text-gray-900">
            {erro && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{erro}</p>}

            {/* ---------------- sem carteira ---------------- */}
            {resp && !resp.existe && !abrirForm && (
                <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                    <p className="flex items-center gap-2 text-lg font-bold"><Wallet size={20} className="text-[#F26B1D]" />Carteira ainda não criada</p>
                    <p className="text-sm text-gray-700">{explicacao}</p>
                    <p className="text-sm text-gray-700">A carteira é uma conta no Asaas, ligada ao Pede Aki. Leva uns 3 minutos: preencha os dados aqui e depois envie um documento e uma selfie no Asaas.</p>
                    <button onClick={() => setAbrirForm(true)} className={botaoLaranja}>Criar {porAdmin ? 'a' : 'minha'} carteira</button>
                </div>
            )}

            {resp && !resp.existe && abrirForm && (
                <form onSubmit={criar} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-lg font-bold">Dados da carteira</p>
                    <p className="text-xs text-gray-600">Use os dados de quem vai receber o dinheiro. O Asaas confere tudo com o documento.</p>
                    <div><label className={rotulo}>CPF ou CNPJ</label><input className={campo} inputMode="numeric" value={form.documento} onChange={e => setForm(f => ({ ...f, documento: mascaraDoc(e.target.value) }))} placeholder="000.000.000-00" /></div>
                    <div><label className={rotulo}>{ehCpf ? 'Nome completo' : 'Razão social'}</label><input className={campo} value={form.nome} onChange={set('nome')} autoComplete="name" /></div>
                    {ehCpf ? (
                        <div><label className={rotulo}>Data de nascimento</label><input className={campo} type="date" value={form.nascimento} onChange={set('nascimento')} /></div>
                    ) : (
                        <div><label className={rotulo}>Tipo da empresa</label>
                            <select className={campo} value={form.tipo_empresa} onChange={set('tipo_empresa')}>
                                <option value="MEI">MEI</option><option value="LIMITED">LTDA</option><option value="INDIVIDUAL">Empresário individual</option><option value="ASSOCIATION">Associação</option>
                            </select>
                        </div>
                    )}
                    <div><label className={rotulo}>E-mail (o acesso à carteira chega nele)</label><input className={campo} type="email" value={form.email} onChange={set('email')} autoComplete="email" placeholder="seuemail@exemplo.com" /></div>
                    <div><label className={rotulo}>Celular com DDD</label><input className={campo} type="tel" inputMode="tel" value={form.celular} onChange={e => setForm(f => ({ ...f, celular: mascaraCel(e.target.value) }))} placeholder="(32) 99999-9999" /></div>
                    <div><label className={rotulo}>{tipo === 'loja' ? 'Faturamento mensal aproximado' : 'Renda mensal aproximada'} (R$)</label><input className={campo} inputMode="decimal" value={form.renda} onChange={set('renda')} placeholder="Ex.: 3000" /></div>
                    <div className="grid grid-cols-2 gap-2">
                        <div><label className={rotulo}>CEP</label><input className={campo} inputMode="numeric" value={form.cep} onChange={e => { const v = mascaraCep(e.target.value); setForm(f => ({ ...f, cep: v })); void buscarCep(v); }} placeholder="36512-000" /></div>
                        <div><label className={rotulo}>Número</label><input className={campo} value={form.numero} onChange={set('numero')} /></div>
                    </div>
                    <div><label className={rotulo}>Rua</label><input className={campo} value={form.rua} onChange={set('rua')} /></div>
                    <div><label className={rotulo}>Bairro</label><input className={campo} value={form.bairro} onChange={set('bairro')} /></div>
                    <div><label className={rotulo}>Complemento (opcional)</label><input className={campo} value={form.complemento} onChange={set('complemento')} /></div>
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} className="mt-1 h-4 w-4 accent-[#F26B1D]" />
                        <span>{porAdmin ? 'O dono autorizou criar a carteira com estes dados.' : 'Concordo em abrir uma conta no Asaas, ligada ao Pede Aki, para receber os meus valores.'} A conta segue os termos de uso do Asaas.</span>
                    </label>
                    <button disabled={enviando} type="submit" className={botaoLaranja}>{enviando ? <><Loader2 size={16} className="animate-spin" />Criando...</> : 'Criar carteira'}</button>
                    <button type="button" onClick={() => setAbrirForm(false)} className="w-full text-center text-sm text-gray-500 underline">Voltar</button>
                </form>
            )}

            {/* ---------------- com carteira ---------------- */}
            {resp?.existe && resp.carteira && etapa && (
                <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="flex items-center gap-2 text-lg font-bold"><Wallet size={20} className="text-[#F26B1D]" />Carteira</p>
                            <p className="text-xs text-gray-600">{resp.carteira.nome} {resp.carteira.documento ? `| ${resp.carteira.documento}` : ''}</p>
                        </div>
                        {typeof resp.saldo === 'number' && (
                            <div className="text-right"><p className="text-[11px] font-bold uppercase text-gray-500">Saldo no Asaas</p><p className="text-xl font-bold text-green-700">{brl(resp.saldo)}</p></div>
                        )}
                    </div>

                    {etapa === 'criando' && <p className="flex items-center gap-2 rounded-lg bg-gray-100 p-3 text-sm text-gray-800"><Loader2 size={16} className="animate-spin" />Criando a carteira no Asaas. Se ficar assim por mais de 5 minutos, fale com o suporte do Pede Aki.</p>}

                    {etapa === 'falta_enviar' && (
                        <div className="space-y-3">
                            <p className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900"><Clock size={16} />Falta {porAdmin ? `${quemRecebe} terminar` : 'você terminar'} no Asaas</p>
                            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-800">
                                <li>Abra o e-mail do Asaas enviado para <b className="break-all">{resp.carteira.email}</b> e crie a senha. Não achou? Olhe no spam ou lixo eletrônico.</li>
                                <li>Entre no Asaas com esse e-mail e senha. Lá ele pede uma foto do documento e uma selfie.</li>
                                <li>Pronto: o Asaas analisa (normalmente em minutos, no máximo 48 horas) e esta tela muda sozinha.</li>
                            </ol>
                            {resp.carteira.onboarding_url
                                ? <a href={resp.carteira.onboarding_url} target="_blank" rel="noopener noreferrer" className={botaoLaranja}><ExternalLink size={16} />Enviar documentos no Asaas</a>
                                : <a href={resp.acesso} target="_blank" rel="noopener noreferrer" className={botaoLaranja}><ExternalLink size={16} />Entrar no Asaas</a>}
                            <p className="flex items-center gap-1.5 text-xs text-gray-500"><Mail size={13} />{explicacao}</p>
                        </div>
                    )}

                    {etapa === 'docs_recusados' && (
                        <div className="space-y-3">
                            <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800"><AlertTriangle size={16} />O Asaas pediu para enviar os documentos de novo</p>
                            {resp.carteira.motivo_recusa && <p className="text-sm text-gray-800">Motivo: {resp.carteira.motivo_recusa}</p>}
                            <a href={resp.carteira.onboarding_url || resp.acesso} target="_blank" rel="noopener noreferrer" className={botaoLaranja}><ExternalLink size={16} />Reenviar no Asaas</a>
                        </div>
                    )}

                    {etapa === 'analise' && (
                        <p className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm font-bold text-blue-900"><Clock size={16} />Documentos enviados. O Asaas está analisando (no máximo 48 horas). Esta tela muda sozinha.</p>
                    )}

                    {etapa === 'aprovada' && (
                        <div className="space-y-3">
                            <p className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm font-bold text-green-800"><CheckCircle2 size={16} />Carteira aprovada</p>
                            <p className="text-sm text-gray-700">{explicacao}</p>
                            <a href={resp.acesso} target="_blank" rel="noopener noreferrer" className={botaoLaranja}><ExternalLink size={16} />Abrir {porAdmin ? 'a' : 'minha'} carteira no Asaas</a>
                            <p className="text-xs text-gray-500">Dica: baixe o app "Asaas" na loja do celular e entre com o e-mail {resp.carteira.email}.</p>
                        </div>
                    )}

                    {etapa === 'recusada' && (
                        <div className="space-y-2">
                            <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800"><AlertTriangle size={16} />O Asaas recusou o cadastro</p>
                            {resp.carteira.motivo_recusa && <p className="text-sm text-gray-800">Motivo: {resp.carteira.motivo_recusa}</p>}
                            <p className="text-sm text-gray-700">Fale com o suporte do Pede Aki para resolver.</p>
                        </div>
                    )}

                    {etapa !== 'aprovada' && etapa !== 'recusada' && etapa !== 'criando' && (
                        <p className="text-xs text-gray-500">{tipo === 'loja' ? 'Os pedidos pagos já caem na carteira desde agora; o saque libera quando o Asaas aprovar.' : 'Os fretes já vão para a carteira desde agora; o saque libera quando o Asaas aprovar.'}</p>
                    )}
                    {resp.avisos && resp.avisos.length > 0 && <p className="text-xs font-bold text-red-700">Carteira criada, mas avise o suporte do Pede Aki (pendência: {resp.avisos.join(', ')}).</p>}
                </div>
            )}
        </div>
    );
};
