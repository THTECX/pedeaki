import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Home, Search, ShoppingCart, User, ArrowRight, Store as StoreIcon, LogOut, MapPin, RotateCcw, Gift, X, Bike } from 'lucide-react';
import {
    supabase, fetchLojasShopping, fetchInfoLojasShopping, fetchCustomerByPhone, fetchCustomerPointsBalance, fetchLastOrderByPhone,
    canonicalPhone, type LojaShopping,
} from '../services/supabaseService';
import { statusDaLoja } from '../utils/lojaAberta';
import { telefoneDoAparelho, guardarTelefoneDoAparelho, apagarTelefoneDoAparelho } from '../utils/telefoneCliente';
import { InstalarApp } from '../components/InstalarApp';
import { lerTokenMotoboy, guardarTokenMotoboy } from '../utils/motoboySessao';

// Perfil do cliente, pensado para caber numa tela de celular sem rolar: quem sou, meu endereco, meu ultimo pedido (pedir de novo),
// minha fidelidade e o botao "Lojas" (todas as lojas abertas agora, sem categoria). Entra so com o telefone, sem validacao
// (decisao do Ikarus de 05/11/2026): sem validacao, qualquer pessoa pode digitar o telefone de outra.

const DDD_PADRAO = '32'; // Tocantins/MG

const corte = (px: number): React.CSSProperties => ({
    clipPath: `polygon(${px}px 0%, calc(100% - ${px}px) 0%, 100% ${px}px, 100% calc(100% - ${px}px), calc(100% - ${px}px) 100%, ${px}px 100%, 0% calc(100% - ${px}px), 0% ${px}px)`,
});

const mascara = (canon: string) => (canon.length === 10 ? `(${canon.slice(0, 2)}) ${canon.slice(2, 6)}-${canon.slice(6)}` : canon);
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const resumoDosItens = (itens: any[] | undefined): string => {
    const lista = (itens || []).filter(i => Number(i.price) > 0).map(i => `${i.quantity || 1}x ${i.name}`);
    return lista.length <= 2 ? lista.join(', ') : `${lista.slice(0, 2).join(', ')} e mais ${lista.length - 2}`;
};

interface Ultimo { loja: LojaShopping; total: number; quando: string; itens: string }

const Logo: React.FC<{ loja: LojaShopping }> = ({ loja }) => {
    const [falhou, setFalhou] = useState(false);
    if (loja.logo_url && !falhou) return <img src={loja.logo_url} alt="" loading="lazy" onError={() => setFalhou(true)} className="w-full h-full object-cover" />;
    return <div className="w-full h-full flex items-center justify-center font-black text-xl text-black bg-gradient-to-br from-[#FF6A1A] to-[#FF9A5A]">{loja.name.trim().charAt(0).toUpperCase()}</div>;
};

const PerfilPage: React.FC = () => {
    const navigate = useNavigate();
    const [telefone, setTelefone] = useState<string>(telefoneDoAparelho);
    const [campo, setCampo] = useState('');
    const [erro, setErro] = useState('');
    const [nome, setNome] = useState('');
    const [endereco, setEndereco] = useState('');
    const [pontos, setPontos] = useState<number | null>(null);
    const [ultimo, setUltimo] = useState<Ultimo | null | undefined>(undefined);
    const [verLojas, setVerLojas] = useState(false);
    // Motoboy: telefone no campo, senha no pop-up, e entra na Central dentro do app
    const [mbTel, setMbTel] = useState('');
    const [mbPopup, setMbPopup] = useState(false);
    const [mbSenha, setMbSenha] = useState('');
    const [mbErro, setMbErro] = useState('');
    const [mbOcupado, setMbOcupado] = useState(false);
    const temSessaoMotoboy = !!lerTokenMotoboy();
    const [abertas, setAbertas] = useState<LojaShopping[] | null>(null);

    useEffect(() => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Space+Grotesk:wght@400;500;600;700&display=swap';
        document.head.appendChild(l);
        return () => { document.head.removeChild(l); };
    }, []);

    // Com o telefone salvo, busca o que o cliente tem em cada loja (so leitura) e fica com o que importa: dados, pontos e o ultimo pedido
    useEffect(() => {
        if (!telefone) { setNome(''); setEndereco(''); setPontos(null); setUltimo(undefined); return; }
        let vivo = true;
        (async () => {
            try {
                const lojas = await fetchLojasShopping();
                const linhas = await Promise.all(lojas.map(async (loja) => {
                    const [cliente, pts, ult] = await Promise.all([
                        fetchCustomerByPhone(telefone, loja.id, DDD_PADRAO).catch(() => null),
                        fetchCustomerPointsBalance(telefone, loja.id).catch(() => 0),
                        fetchLastOrderByPhone(telefone, loja.id).catch(() => null),
                    ]);
                    return { loja, cliente, pts, ult };
                }));
                if (!vivo) return;
                setNome(linhas.find(l => l.cliente?.name)?.cliente?.name || '');
                setEndereco((linhas.find(l => l.cliente?.address)?.cliente?.address || '').replace(/ - Bairro: /, ', '));
                setPontos(linhas.reduce((t, l) => t + (Number(l.pts) || 0), 0));
                // pedido que nunca virou compra (PIX nao pago, expirado ou cancelado) nao conta como "ultimo pedido"
                const validos = linhas.filter(l => l.ult && !['Aguardando pagamento', 'Expirado', 'Cancelado'].includes(String(l.ult.status))).map(l => ({
                    loja: l.loja, total: Number(l.ult!.total) || 0, quando: l.ult!.timestamp || '', itens: resumoDosItens(l.ult!.items as any[]),
                }));
                validos.sort((a, b) => new Date(b.quando || 0).getTime() - new Date(a.quando || 0).getTime());
                setUltimo(validos[0] || null);
            } catch {
                if (vivo) { setPontos(0); setUltimo(null); }
            }
        })();
        return () => { vivo = false; };
    }, [telefone]);

    // Botao Lojas: todas as lojas que estao abertas agora, sem categoria (quem esta no perfil ja esta procurando o que pedir)
    const abrirLojas = async () => {
        setVerLojas(true);
        if (abertas) return;
        try {
            const [lojas, infos] = await Promise.all([fetchLojasShopping(), fetchInfoLojasShopping().catch(() => [])]);
            const mapa = Object.fromEntries(infos.map(i => [i.store_id, i]));
            setAbertas(lojas.filter(l => statusDaLoja(mapa[l.id]).aberta !== false));
        } catch { setAbertas([]); }
    };

    const entrar = (e: React.FormEvent) => {
        e.preventDefault();
        const digitos = campo.replace(/\D/g, '');
        if (digitos.length < 8) { setErro('Digite o telefone com DDD. Exemplo: 32 99999-9999'); return; }
        const canon = canonicalPhone(campo, DDD_PADRAO);
        if (canon.length !== 10) { setErro('Esse telefone não parece certo. Confira o DDD e o número.'); return; }
        guardarTelefoneDoAparelho(canon);
        setErro('');
        setTelefone(canon);
    };

    const sair = () => {
        apagarTelefoneDoAparelho();
        setTelefone(''); setCampo('');
    };

    const continuarMotoboy = (e: React.FormEvent) => {
        e.preventDefault();
        if (mbTel.replace(/\D/g, '').length < 8) { setMbErro('Digite o telefone com DDD.'); return; }
        setMbErro(''); setMbSenha(''); setMbPopup(true);
    };
    const entrarMotoboy = async (e: React.FormEvent) => {
        e.preventDefault();
        setMbOcupado(true); setMbErro('');
        const { data, error } = await supabase.rpc('motoboy_login', { p_telefone: mbTel, p_senha: mbSenha });
        setMbOcupado(false);
        if (error) { setMbErro('Sem conexão. Tente de novo.'); return; }
        if (!data?.ok) { setMbErro(data?.erro || 'Não foi possível entrar.'); return; }
        guardarTokenMotoboy(data.token);
        navigate('/motoboy');
    };

    // Motoboy ja entrou neste aparelho e nao e cliente aqui: a porta o leva direto para a Central
    if (!telefone && temSessaoMotoboy) return <Navigate to="/motoboy" replace />;

    return (
        <div className="min-h-screen flex justify-center bg-[#0B0910]" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>
            <div className="w-full max-w-[390px] min-h-screen bg-[#110E15] text-[#F7EFE4] border-x border-[#241F2B] flex flex-col pb-20">

                <header className="px-4 pt-3 pb-2.5 border-b border-[#241F2B] flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-1.5">
                        <div className="w-1.5 h-4 bg-[#FF6A1A] shadow-[0_0_8px_#FF6A1A]" />
                        <span style={{ fontFamily: 'Anton, sans-serif', textShadow: '0 0 12px rgba(255,106,26,.7)' }} className="text-[22px] tracking-wider uppercase">PEDE AKI</span>
                    </Link>
                    <button onClick={abrirLojas} style={corte(6)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FF6A1A] text-black text-[12px] font-bold uppercase tracking-wider active:scale-95"><StoreIcon size={14} />Lojas</button>
                </header>

                <main className="flex flex-col gap-2.5 pt-3">
                    <InstalarApp escuro />

                    {!telefone ? (
                        <section className="px-4">
                            <div style={corte(14)} className="bg-[#F7EFE4] text-[#15121A] p-4 flex flex-col gap-2.5 border-2 border-[#F7EFE4]">
                                <h1 style={{ fontFamily: 'Anton, sans-serif' }} className="text-[26px] tracking-wide uppercase leading-none">SOU CLIENTE</h1>
                                <p className="text-[13px] text-[#55565B] leading-snug">Entre com o seu telefone: seus dados, seu último pedido e sua fidelidade num lugar só.</p>
                                <form onSubmit={entrar} className="flex flex-col gap-2.5">
                                    <label style={corte(8)} className="flex items-center bg-white border border-[#E3D8C9] focus-within:border-[#FF6A1A]">
                                        <span className="pl-3 text-[14px] font-bold text-[#55565B]">+55</span>
                                        <input
                                            id="telefone-cliente"
                                            value={campo}
                                            onChange={e => { setCampo(e.target.value); setErro(''); }}
                                            type="tel"
                                            inputMode="tel"
                                            autoComplete="tel-national"
                                            placeholder="(32) 99999-9999"
                                            className="w-full bg-transparent py-3 px-2.5 text-[16px] font-bold text-[#15121A] border-none outline-none focus:ring-0"
                                        />
                                    </label>
                                    {erro && <p className="text-[12px] font-bold text-[#B3261E]">{erro}</p>}
                                    <button type="submit" style={{ ...corte(10), fontFamily: 'Anton, sans-serif' }} className="w-full py-3 bg-[#FF6A1A] text-black text-[18px] tracking-wider uppercase flex items-center justify-center gap-2 active:scale-[0.98]">
                                        ENTRAR <ArrowRight size={18} />
                                    </button>
                                </form>
                            </div>

                            <form onSubmit={continuarMotoboy} style={corte(12)} className="mt-2.5 bg-[#2A2430] border border-[#4A4154] p-3 flex flex-col gap-2">
                                <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-[#CFC7D6]"><Bike size={16} className="text-[#FF6A1A]" />Sou motoboy</p>
                                <div className="flex gap-2">
                                    <input
                                        value={mbTel}
                                        onChange={e => { setMbTel(e.target.value); setMbErro(''); }}
                                        type="tel" inputMode="tel" autoComplete="off"
                                        placeholder="Telefone com DDD"
                                        className="min-w-0 flex-1 bg-[#110E15] border border-[#4A4154] rounded-md px-3 py-2.5 text-[15px] text-[#F7EFE4] placeholder:text-[#8A8294] outline-none focus:border-[#FF6A1A]"
                                    />
                                    <button type="submit" style={corte(8)} className="shrink-0 px-4 bg-[#FF6A1A] text-black text-[13px] font-bold uppercase tracking-wider active:scale-95">Continuar</button>
                                </div>
                                {mbErro && !mbPopup && <p className="text-[12px] font-bold text-[#FF8A7A]">{mbErro}</p>}
                            </form>

                            <button onClick={() => navigate('/entrar')} style={corte(10)} className="mt-2.5 w-full py-3 border border-[#FF6A1A] bg-[#1A171F] text-[#F7EFE4] text-[14px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 active:scale-[0.98]">
                                <StoreIcon size={16} className="text-[#FF6A1A]" />Sou lojista
                            </button>
                        </section>
                    ) : (
                        <section className="px-4 flex flex-col gap-2.5">
                            {/* quem sou e onde moro */}
                            <div style={corte(14)} className="bg-[#F7EFE4] text-[#15121A] px-4 py-3 flex flex-col gap-1.5 border-2 border-[#F7EFE4]">
                                <div className="flex items-center justify-between gap-3">
                                    <p style={{ fontFamily: 'Anton, sans-serif' }} className="text-[20px] tracking-wide leading-tight truncate">{nome ? `${nome.split(' ')[0]} • ` : ''}{mascara(telefone)}</p>
                                    <button onClick={sair} style={corte(6)} className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-[#15121A] text-[#F7EFE4] text-[10px] font-bold uppercase tracking-wider"><LogOut size={12} />Sair</button>
                                </div>
                                <p className="text-[12px] text-[#55565B] flex items-start gap-1.5 leading-snug"><MapPin size={13} className="mt-0.5 shrink-0 text-[#FF6A1A]" /><span className="line-clamp-2">{endereco || 'O endereço fica salvo no seu primeiro pedido de entrega.'}</span></p>
                            </div>

                            {/* ultimo pedido */}
                            <div style={corte(12)} className="bg-[#2A2430] border border-[#4A4154] p-3 flex flex-col gap-1.5">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#CFC7D6]">Último pedido</p>
                                {ultimo === undefined && <p className="text-[13px] text-[#CFC7D6]">Buscando...</p>}
                                {ultimo === null && <p className="text-[13px] text-[#CFC7D6]">Você ainda não fez nenhum pedido. Toque em Lojas e escolha o seu.</p>}
                                {ultimo && (
                                    <>
                                        <div className="flex items-center justify-between gap-2">
                                            <span style={{ fontFamily: 'Anton, sans-serif' }} className="text-[18px] tracking-wide uppercase leading-none truncate">{ultimo.loja.name}</span>
                                            <span className="shrink-0 text-[13px] font-bold">{moeda(ultimo.total)}</span>
                                        </div>
                                        <p className="text-[12px] text-[#CFC7D6] truncate">{ultimo.itens}{ultimo.quando ? ` · ${new Date(ultimo.quando).toLocaleDateString('pt-BR')}` : ''}</p>
                                        <div className="flex gap-2 pt-0.5">
                                            <Link to={`/${ultimo.loja.slug}?repetir=1`} style={corte(8)} className="flex-1 py-2.5 bg-[#FF6A1A] text-black text-[13px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-[0.98]"><RotateCcw size={14} />Pedir de novo</Link>
                                            <Link to={`/${ultimo.loja.slug}`} style={corte(8)} className="flex-1 py-2.5 border border-[#FF6A1A]/60 bg-[#1A171F] text-[#F7EFE4] text-[13px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-[0.98]">Ver cardápio</Link>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* fidelidade */}
                            <div style={corte(12)} className="bg-[#2A2430] border border-[#4A4154] px-3 py-2.5 flex items-center gap-3">
                                <Gift size={22} className="shrink-0 text-[#FF6A1A]" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#CFC7D6]">Fidelidade</p>
                                    <p className="text-[13px] text-[#CFC7D6] leading-tight">Você tem <b className="text-[#F7EFE4]">{pontos ?? 0} {pontos === 1 ? 'ponto' : 'pontos'}</b></p>
                                </div>
                            </div>
                        </section>
                    )}

                    {telefone && temSessaoMotoboy && (
                        <button onClick={() => navigate('/motoboy')} className="mx-4 py-2 text-[12px] font-bold uppercase tracking-wider text-[#CFC7D6] flex items-center justify-center gap-1.5">
                            <Bike size={14} className="text-[#FF6A1A]" />Ir para a central do motoboy
                        </button>
                    )}
                </main>

                {/* Senha do motoboy */}
                {mbPopup && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-6" onClick={() => !mbOcupado && setMbPopup(false)}>
                        <form onSubmit={entrarMotoboy} onClick={e => e.stopPropagation()} style={corte(14)} className="w-full max-w-[340px] bg-[#F7EFE4] text-[#15121A] p-5 flex flex-col gap-3">
                            <h2 style={{ fontFamily: 'Anton, sans-serif' }} className="text-[24px] tracking-wide uppercase leading-none">SENHA DO MOTOBOY</h2>
                            <p className="text-[12px] text-[#55565B]">Telefone {mbTel}</p>
                            <input
                                autoFocus type="password" value={mbSenha} onChange={e => { setMbSenha(e.target.value); setMbErro(''); }}
                                placeholder="Sua senha" autoComplete="current-password"
                                className="w-full bg-white border border-[#E3D8C9] rounded-md px-3 py-3 text-[16px] font-bold text-[#15121A] placeholder:text-[#9A9AA0] outline-none focus:border-[#FF6A1A]"
                            />
                            {mbErro && <p className="text-[12px] font-bold text-[#B3261E]">{mbErro}</p>}
                            <button disabled={mbOcupado || !mbSenha} type="submit" style={{ ...corte(10), fontFamily: 'Anton, sans-serif' }} className="w-full py-3 bg-[#FF6A1A] text-black text-[18px] tracking-wider uppercase disabled:opacity-50 active:scale-[0.98]">{mbOcupado ? 'ENTRANDO...' : 'ENTRAR'}</button>
                            <button type="button" onClick={() => setMbPopup(false)} className="text-[12px] text-[#55565B] underline">Cancelar</button>
                        </form>
                    </div>
                )}

                {/* Lojas abertas agora (sem categoria) */}
                {verLojas && (
                    <div className="fixed inset-0 z-[60] flex justify-center bg-black/70" onClick={() => setVerLojas(false)}>
                        <div className="w-full max-w-[390px] mt-14 bg-[#110E15] border-t border-x border-[#322C3A] rounded-t-2xl flex flex-col min-h-0" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-4 pt-4 pb-2">
                                <h2 style={{ fontFamily: 'Anton, sans-serif' }} className="text-[22px] tracking-wide uppercase leading-none">ABERTAS AGORA</h2>
                                <button onClick={() => setVerLojas(false)} aria-label="Fechar" className="p-1 text-[#CFC7D6]"><X size={22} /></button>
                            </div>
                            <div className="px-4 pb-6 overflow-y-auto flex flex-col gap-2.5">
                                {abertas === null && <p className="text-[13px] text-[#CFC7D6]">Buscando as lojas...</p>}
                                {abertas !== null && abertas.length === 0 && <p className="text-[13px] text-[#CFC7D6]">Nenhuma loja aberta agora. Volte daqui a pouco.</p>}
                                {abertas?.map(l => (
                                    <Link key={l.id} to={`/${l.slug}`} style={corte(12)} className="bg-[#F7EFE4] text-[#15121A] p-2.5 flex items-center gap-3 active:scale-[0.99]">
                                        <div style={corte(8)} className="w-14 h-14 shrink-0 overflow-hidden bg-black"><Logo loja={l} /></div>
                                        <div className="min-w-0 flex-1">
                                            <p style={{ fontFamily: 'Anton, sans-serif' }} className="text-[18px] tracking-wide uppercase leading-none truncate">{l.name}</p>
                                            <p className="text-[12px] text-[#55565B] truncate mt-0.5">{[l.categoria, l.cidade].filter(Boolean).join(' • ')}</p>
                                        </div>
                                        <ArrowRight size={18} className="shrink-0 text-[#FF6A1A]" />
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] z-50 bg-[#15121A] border-t border-[#241F2B] px-2 py-1 flex items-center justify-around" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                    <Link to="/" className="flex flex-col items-center py-1 text-[#B9B0C2] font-medium"><Home size={20} /><span className="text-[10px] tracking-wider mt-0.5">Início</span></Link>
                    <Link to="/" className="flex flex-col items-center py-1 text-[#B9B0C2] font-medium"><Search size={20} /><span className="text-[10px] tracking-wider mt-0.5">Busca</span></Link>
                    <span className="flex flex-col items-center py-1 text-[#B9B0C2]/40 font-medium"><ShoppingCart size={20} /><span className="text-[10px] tracking-wider mt-0.5">Carrinho</span></span>
                    <span className="flex flex-col items-center py-1 text-[#FF6A1A] font-bold"><User size={20} /><span className="text-[10px] tracking-wider mt-0.5">Perfil</span></span>
                </nav>
            </div>
        </div>
    );
};

export default PerfilPage;
