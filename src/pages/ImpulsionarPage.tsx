import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase, fetchMinhaLoja } from '../services/supabaseService';
import { fetchImpulsoVagas, valorDoImpulso, descontoDoImpulso, type ImpulsoVagas } from '../services/impulso';
import type { Store } from '../types';

/**
 * O lojista de comissão compra sozinho o impulso da vitrine: escolhe os dias, vê o valor definido pelo Pede Aki,
 * aceita que não há reembolso depois de ativado e paga por PIX. Quem liga o impulso é o servidor (webhook) quando o PIX cai.
 * Chega aqui pelo card "Impulsione sua loja" da vitrine; sem login, passa pelo /entrar e volta.
 */
const so = (v: string) => v.replace(/\D/g, '');
const mascara = (v: string) => {
    const d = so(v).slice(0, 14);
    if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};
const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const dataBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

const ImpulsionarPage = () => {
    const { session, loading } = useAuth();
    const [loja, setLoja] = useState<Store | null | undefined>(undefined);
    const [info, setInfo] = useState<ImpulsoVagas | null | undefined>(undefined);
    const [dias, setDias] = useState(7);
    const [doc, setDoc] = useState('');
    const [aceite, setAceite] = useState(false);
    const [fase, setFase] = useState<'form' | 'gerando' | 'qr' | 'pago' | 'expirou'>('form');
    const [erro, setErro] = useState('');
    const [qr, setQr] = useState<{ id: string; imagem: string; copiaCola: string; valor: number; pagarAte: number } | null>(null);
    const [fimNovo, setFimNovo] = useState<string | null>(null);
    const [agora, setAgora] = useState(Date.now());
    const [copiado, setCopiado] = useState(false);

    const carregar = async () => {
        if (!session) return;
        try {
            const [l, i] = await Promise.all([fetchMinhaLoja(session.user.id), fetchImpulsoVagas()]);
            setLoja(l); setInfo(i);
            if (l) {
                const { data } = await supabase.from('impulsos').select('documento').eq('store_id', l.id).not('documento', 'is', null).order('criado_em', { ascending: false }).limit(1);
                if (data?.[0]?.documento) setDoc(String(data[0].documento));
            }
        } catch { setLoja(null); setInfo(null); }
    };
    useEffect(() => { void carregar(); }, [session?.user?.id]);

    // Relógio e conferência do pagamento enquanto o QR está na tela
    useEffect(() => {
        if (fase !== 'qr' || !qr) return;
        const relogio = setInterval(() => setAgora(Date.now()), 1000);
        const conferir = setInterval(async () => {
            try {
                const { data } = await supabase.from('impulsos').select('status,ate').eq('id', qr.id).limit(1);
                if (data?.[0]?.status === 'pago') { setFimNovo(data[0].ate); setFase('pago'); void carregar(); }
            } catch { /* tenta de novo no proximo ciclo */ }
        }, 3000);
        return () => { clearInterval(relogio); clearInterval(conferir); };
    }, [fase, qr?.id]);
    useEffect(() => { if (fase === 'qr' && qr && agora > qr.pagarAte + 20000) setFase('expirou'); }, [agora, fase, qr]);

    if (loading) return <div className="min-h-screen bg-[#110E15]" />;
    if (!session) return <Navigate to="/entrar" state={{ from: { pathname: '/impulsionar' } }} replace />;

    const ativoAte = loja?.impulso_ate && new Date(loja.impulso_ate).getTime() > Date.now() && loja.impulso && loja.impulso !== 'nenhum' ? loja.impulso_ate : null;
    const valor = info ? valorDoImpulso(info, dias) : 0;
    const pct = info ? descontoDoImpulso(info, dias) : 0;

    const gerar = async () => {
        setErro('');
        if (!loja) return;
        if (so(doc).length !== 11 && so(doc).length !== 14) { setErro('Digite o CPF ou CNPJ completo.'); return; }
        if (!aceite) { setErro('Marque o aceite para continuar.'); return; }
        setFase('gerando');
        try {
            const r = await fetch('/api/impulso-cobrar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ store_id: loja.id, dias, documento: so(doc), aceite: true }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { setErro(j.erro || 'Não foi possível gerar o PIX. Tente de novo.'); setFase('form'); void carregar(); return; }
            setQr({ id: j.impulso_id, imagem: j.qr_imagem, copiaCola: j.copia_cola, valor: j.valor, pagarAte: new Date(j.pagar_ate).getTime() });
            setFase('qr');
        } catch { setErro('Sem conexão. Tente de novo.'); setFase('form'); }
    };
    const copiar = async () => { try { await navigator.clipboard.writeText(qr?.copiaCola || ''); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { /* o texto fica na tela */ } };
    const falta = qr ? Math.max(0, Math.floor((qr.pagarAte - agora) / 1000)) : 0;
    const relogio = `${String(Math.floor(falta / 60)).padStart(2, '0')}:${String(falta % 60).padStart(2, '0')}`;

    const caixa = 'rounded-xl border border-[#322C3A] bg-[#1A171F] p-4';
    const pacotes = [7, 15, 30];
    const esgotado = !!info && info.livres <= 0 && !ativoAte;

    return (
        <div className="min-h-screen bg-[#110E15] text-[#F7EFE4] flex justify-center">
            <div className="w-full max-w-[430px] px-4 py-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-black">Impulsionar minha loja</h1>
                    <Link to="/vitrine" className="text-xs text-[#CFC7D6] underline">Ver vitrine</Link>
                </div>

                {loja === undefined || info === undefined ? <p className="text-sm text-[#CFC7D6]">Carregando...</p>
                : loja === null ? (
                    <div className={caixa}><p className="text-sm">Não encontramos uma loja ligada a este login. <Link to="/cadastro" className="underline text-[#FF6A1A]">Cadastrar minha loja</Link></p></div>
                ) : loja.modelo !== 'comissao' ? (
                    <div className={caixa}><p className="text-sm">O impulsionamento é para as lojas do modelo de comissão do Pede Aki.</p></div>
                ) : !loja.aparecer_no_shopping ? (
                    <div className={caixa}><p className="text-sm">Sua loja ainda não está liberada para aparecer na vitrine. Fale com o Pede Aki para liberar e depois volte aqui.</p></div>
                ) : info === null ? (
                    <div className={caixa}><p className="text-sm">O impulsionamento ainda não está disponível. Tente novamente em breve.</p></div>
                ) : !info.ativo ? (
                    <div className={caixa}><p className="text-sm">O impulsionamento está pausado no momento. Tente novamente em breve.</p></div>
                ) : fase === 'pago' ? (
                    <div className={`${caixa} space-y-2 text-center`}>
                        <p className="text-lg font-black text-[#5FD068]">Pagamento confirmado</p>
                        <p className="text-sm">{loja.name} já aparece em Lojas patrocinadas{fimNovo ? ` até ${dataBR(fimNovo)}` : ''}.</p>
                        <Link to="/vitrine" className="inline-block mt-2 px-4 py-2 rounded-lg bg-[#FF6A1A] text-black font-bold text-sm">Ver na vitrine</Link>
                    </div>
                ) : fase === 'qr' && qr ? (
                    <div className={`${caixa} space-y-3 text-center`}>
                        <p className="text-sm">Pague {brl(qr.valor)} no app do seu banco com PIX.</p>
                        <img src={`data:image/png;base64,${qr.imagem}`} alt="QR Code do PIX" className="mx-auto w-52 h-52 bg-white p-2 rounded-lg" />
                        <button onClick={copiar} className="w-full py-3 bg-[#FF6A1A] text-black font-bold rounded-lg">{copiado ? 'Código copiado' : 'Copiar código PIX'}</button>
                        <p className="text-xs text-[#CFC7D6] break-all select-all">{qr.copiaCola}</p>
                        <p className="text-sm">Tempo para pagar: <span className="font-bold">{relogio}</span></p>
                        <p className="text-xs text-[#CFC7D6]">Assim que o pagamento cair, esta tela avisa e sua loja entra na vitrine. A vaga fica reservada por 15 minutos.</p>
                    </div>
                ) : fase === 'expirou' ? (
                    <div className={`${caixa} space-y-3 text-center`}>
                        <p className="text-sm">O tempo para pagar acabou. Se você já pagou, o impulso é ligado sozinho assim que o banco confirmar (se ainda houver vaga; se não houver, o valor volta para você).</p>
                        <button onClick={() => { setFase('form'); void carregar(); }} className="w-full py-3 bg-[#FF6A1A] text-black font-bold rounded-lg">Gerar outro PIX</button>
                    </div>
                ) : (
                    <>
                        <div className={caixa}>
                            <p className="text-sm font-bold">{loja.name}</p>
                            {ativoAte ? <p className="text-sm mt-1 text-[#5FD068]">Impulsionada até {dataBR(ativoAte)}. Se comprar agora, os dias novos somam no fim do prazo.</p>
                                : <p className="text-sm mt-1 text-[#CFC7D6]">Hoje sua loja não está impulsionada.</p>}
                            <p className="text-xs mt-2 text-[#CFC7D6]">Sua loja aparece em Lojas patrocinadas, logo abaixo das categorias, para todos que abrirem o Pede Aki. Vagas: {info.livres} livre{info.livres === 1 ? '' : 's'} de {info.vagas}.</p>
                        </div>

                        {esgotado ? (
                            <div className={caixa}><p className="text-sm">As vagas estão esgotadas.{info.proxima_vaga ? ` A próxima abre por volta de ${dataBR(info.proxima_vaga)}.` : ''} Volte aqui nessa data.</p></div>
                        ) : (
                            <div className={`${caixa} space-y-3`}>
                                <p className="text-sm font-bold">Quantos dias?</p>
                                <div className="grid grid-cols-3 gap-2">
                                    {pacotes.map(d => (
                                        <button key={d} onClick={() => setDias(d)} className={`rounded-lg border-2 py-2 text-center ${dias === d ? 'border-[#FF6A1A] bg-[#FF6A1A] text-black' : 'border-[#322C3A]'}`}>
                                            <span className="block font-black">{d} dias</span>
                                            <span className="block text-xs">{brl(valorDoImpulso(info, d))}</span>
                                            {descontoDoImpulso(info, d) > 0 && <span className="block text-[10px] font-bold">{descontoDoImpulso(info, d)}% off</span>}
                                        </button>
                                    ))}
                                </div>
                                <label className="block text-xs text-[#CFC7D6]">Ou outra quantidade (1 a 90)
                                    <input type="number" min={1} max={90} value={dias} onChange={e => setDias(Math.max(1, Math.min(90, Math.floor(Number(e.target.value) || 1))))}
                                        className="mt-1 w-full rounded-lg bg-[#110E15] border border-[#322C3A] p-2.5 text-base text-[#F7EFE4]" />
                                </label>
                                <div className="rounded-lg bg-[#110E15] p-3 text-sm">
                                    {dias} {dias === 1 ? 'dia' : 'dias'} x {brl(info.preco_dia)}{pct > 0 ? `, com ${pct}% de desconto` : ''}
                                    <p className="text-xl font-black text-[#FF6A1A] mt-1">Total: {brl(valor)}</p>
                                </div>
                                <label className="block text-sm">CPF ou CNPJ de quem paga
                                    <input value={mascara(doc)} onChange={e => setDoc(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="CPF ou CNPJ"
                                        className="mt-1 w-full rounded-lg bg-[#110E15] border border-[#322C3A] p-2.5 text-base text-[#F7EFE4]" />
                                    <span className="block text-xs text-[#CFC7D6] mt-1">O banco exige para gerar o PIX. Guardamos para você não digitar de novo.</span>
                                </label>
                                <label className="flex items-start gap-2 text-xs text-[#CFC7D6] cursor-pointer">
                                    <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} className="mt-0.5 h-4 w-4" />
                                    Entendo que o impulsionamento não é reembolsável depois de ativado e que a loja volta ao normal quando o prazo acaba.
                                </label>
                                {erro && <p className="text-sm text-red-400 font-semibold">{erro}</p>}
                                <button onClick={gerar} disabled={fase === 'gerando'} className="w-full py-3 bg-[#FF6A1A] text-black font-bold rounded-lg disabled:opacity-50">
                                    {fase === 'gerando' ? 'Gerando o PIX...' : `Gerar PIX de ${brl(valor)}`}
                                </button>
                            </div>
                        )}
                        <Link to={`/${loja.slug}/admin`} className="block text-center text-sm text-[#CFC7D6] underline">Voltar ao painel da loja</Link>
                    </>
                )}
            </div>
        </div>
    );
};

export default ImpulsionarPage;
