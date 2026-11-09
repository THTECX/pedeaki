import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Home, Search, ShoppingCart, User, ArrowRight, Store as StoreIcon, LogOut } from 'lucide-react';
import {
    fetchLojasShopping, fetchCustomerByPhone, fetchCustomerPointsBalance, fetchLastOrderByPhone,
    canonicalPhone, type LojaShopping,
} from '../services/supabaseService';
import { telefoneDoAparelho, guardarTelefoneDoAparelho, apagarTelefoneDoAparelho } from '../utils/telefoneCliente';
import { InstalarApp } from '../components/InstalarApp';

// Perfil do cliente. Entra só com o telefone, sem validação (mesmo jeito do Papa-Leguas).
// O telefone fica guardado neste aparelho. Lojista entra pelo botão "Sou lojista" (/entrar).
// Risco aceito e registrado no diário: sem validação, qualquer pessoa pode digitar o telefone de outra.

const DDD_PADRAO = '32'; // Tocantins/MG

const corte = (px: number): React.CSSProperties => ({
    clipPath: `polygon(${px}px 0%, calc(100% - ${px}px) 0%, 100% ${px}px, 100% calc(100% - ${px}px), calc(100% - ${px}px) 100%, ${px}px 100%, 0% calc(100% - ${px}px), 0% ${px}px)`,
});

const mascara = (canon: string) => (canon.length === 10 ? `(${canon.slice(0, 2)}) ${canon.slice(2, 6)}-${canon.slice(6)}` : canon);
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface DadosLoja { loja: LojaShopping; pontos: number; ultimo: { total: number; status: string; quando: string } | null }

const PerfilPage: React.FC = () => {
    const navigate = useNavigate();
    const [telefone, setTelefone] = useState<string>(telefoneDoAparelho);
    const [campo, setCampo] = useState('');
    const [erro, setErro] = useState('');
    const [nome, setNome] = useState('');
    const [dados, setDados] = useState<DadosLoja[] | null>(null);

    useEffect(() => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Space+Grotesk:wght@400;500;600;700&display=swap';
        document.head.appendChild(l);
        return () => { document.head.removeChild(l); };
    }, []);

    // Com o telefone salvo, busca o que o cliente tem em cada loja (só leitura, funções que já existem)
    useEffect(() => {
        if (!telefone) { setDados(null); setNome(''); return; }
        let vivo = true;
        (async () => {
            try {
                const lojas = await fetchLojasShopping();
                const linhas = await Promise.all(lojas.map(async (loja) => {
                    const [cliente, pontos, ultimo] = await Promise.all([
                        fetchCustomerByPhone(telefone, loja.id, DDD_PADRAO).catch(() => null),
                        fetchCustomerPointsBalance(telefone, loja.id).catch(() => 0),
                        fetchLastOrderByPhone(telefone, loja.id).catch(() => null),
                    ]);
                    return { loja, nome: cliente?.name || '', pontos, ultimo };
                }));
                if (!vivo) return;
                setNome(linhas.find(l => l.nome)?.nome || '');
                setDados(linhas.map(l => ({
                    loja: l.loja,
                    pontos: l.pontos,
                    ultimo: l.ultimo ? { total: Number(l.ultimo.total) || 0, status: String(l.ultimo.status || ''), quando: l.ultimo.timestamp || '' } : null,
                })));
            } catch {
                if (vivo) setDados([]);
            }
        })();
        return () => { vivo = false; };
    }, [telefone]);

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
        setTelefone(''); setCampo(''); setDados(null); setNome('');
    };

    return (
        <div className="min-h-screen flex justify-center bg-[#0B0910]" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>
            <div className="w-full max-w-[390px] min-h-screen bg-[#110E15] text-[#F7EFE4] border-x border-[#241F2B] flex flex-col pb-24">

                <header className="px-4 pt-4 pb-3 border-b border-[#241F2B] flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-1.5">
                        <div className="w-1.5 h-4 bg-[#FF6A1A] shadow-[0_0_8px_#FF6A1A]" />
                        <span style={{ fontFamily: 'Anton, sans-serif', textShadow: '0 0 12px rgba(255,106,26,.7)' }} className="text-[24px] tracking-wider uppercase">PEDE AKI</span>
                    </Link>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[#CFC7D6]">Perfil</span>
                </header>

                <main className="flex flex-col gap-6 px-4 pt-6">
                    <div className="-mx-4"><InstalarApp escuro comFechar={false} /></div>
                    {!telefone ? (
                        <section style={corte(14)} className="bg-[#F7EFE4] text-[#15121A] p-5 flex flex-col gap-3 border-2 border-[#F7EFE4]">
                            <h1 style={{ fontFamily: 'Anton, sans-serif' }} className="text-[30px] tracking-wide uppercase leading-none">ENTRE COM O SEU TELEFONE</h1>
                            <p className="text-[13px] text-[#55565B] leading-snug">Seus pedidos, endereços e pontos em todas as lojas da cidade, num lugar só.</p>
                            <form onSubmit={entrar} className="flex flex-col gap-3">
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
                        </section>
                    ) : (
                        <section className="flex flex-col gap-4">
                            <div style={corte(14)} className="bg-[#F7EFE4] text-[#15121A] p-4 flex items-center justify-between gap-3 border-2 border-[#F7EFE4]">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6C72]">Você está com o número</p>
                                    <p style={{ fontFamily: 'Anton, sans-serif' }} className="text-[22px] tracking-wide leading-tight truncate">{nome ? `${nome.split(' ')[0]} • ` : ''}{mascara(telefone)}</p>
                                </div>
                                <button onClick={sair} style={corte(8)} className="shrink-0 flex items-center gap-1 px-3 py-2 bg-[#15121A] text-[#F7EFE4] text-[11px] font-bold uppercase tracking-wider"><LogOut size={14} />Sair</button>
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 bg-[#FF6A1A] rotate-45 shadow-[0_0_6px_#FF6A1A]" />
                                <h2 style={{ fontFamily: 'Anton, sans-serif' }} className="text-[24px] tracking-wide uppercase leading-none">SUAS LOJAS</h2>
                            </div>
                            {dados === null && <p className="text-[13px] text-[#CFC7D6]">Buscando o que você tem em cada loja...</p>}
                            {dados !== null && dados.length === 0 && <p className="text-[13px] text-[#CFC7D6]">Nenhuma loja encontrada agora. Tente de novo em instantes.</p>}
                            {dados?.map(({ loja, pontos, ultimo }) => (
                                <Link key={loja.id} to={`/${loja.slug}`} style={corte(12)} className="bg-[#2A2430] border border-[#4A4154] p-3 flex flex-col gap-2 active:scale-[0.99]">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="flex items-center gap-2 min-w-0"><StoreIcon size={16} className="text-[#FF6A1A] shrink-0" /><span style={{ fontFamily: 'Anton, sans-serif' }} className="text-[18px] tracking-wide uppercase leading-none truncate">{loja.name}</span></span>
                                        <ArrowRight size={16} className="text-[#FF6A1A] shrink-0" />
                                    </div>
                                    <div className="flex gap-4 text-[12px] text-[#CFC7D6]">
                                        <span>Pontos: <b className="text-[#F7EFE4]">{pontos}</b></span>
                                        <span className="min-w-0 truncate">{ultimo ? `Último pedido: ${moeda(ultimo.total)}${ultimo.quando ? ` em ${new Date(ultimo.quando).toLocaleDateString('pt-BR')}` : ''}` : 'Nenhum pedido ainda'}</span>
                                    </div>
                                </Link>
                            ))}
                        </section>
                    )}

                    <button onClick={() => navigate('/entrar')} style={corte(10)} className="w-full py-3 border border-[#FF6A1A]/60 bg-[#1A171F] text-[#F7EFE4] text-[13px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 active:scale-[0.98]">
                        <StoreIcon size={16} className="text-[#FF6A1A]" />Sou lojista
                    </button>
                </main>

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
