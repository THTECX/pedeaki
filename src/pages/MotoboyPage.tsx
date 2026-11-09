import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseService';

/**
 * Area do motoboy do Pede Aki (/motoboy). Login por telefone e senha (cadastro feito pelo administrador).
 * Ve entregas previstas (so aviso), disponiveis (pode pegar) e as dele; retira, avisa que chegou e fecha a entrega
 * digitando o codigo que o cliente passou. Atualiza sozinho a cada 5 segundos e avisa com som quando chega entrega nova.
 */
interface Entrega {
    id: string; status: string; frete: number; loja: string; loja_endereco?: string | null; bairro?: string | null;
    cliente?: string; endereco?: string; referencia?: string; prazo_retirar?: string | null; prazo_entregar?: string | null;
    tentativas?: number; bloqueada?: boolean;
}
interface Painel { ok: boolean; erro?: string; nome: string; online: boolean; ganhos_hoje: number; a_receber: number; minhas: Entrega[]; disponiveis: Entrega[]; previstas: Entrega[] }

const CHAVE = 'pedeaki_motoboy_token';
const brl = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;
const hora = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
const maps = (texto: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${texto}, Tocantins, MG`)}`;
const lerToken = () => { try { return localStorage.getItem(CHAVE) || ''; } catch { return ''; } };
const guardarToken = (t: string) => { try { t ? localStorage.setItem(CHAVE, t) : localStorage.removeItem(CHAVE); } catch { /* sem armazenamento: entra de novo na proxima */ } };

const Contagem: React.FC<{ ate?: string | null; rotulo: string }> = ({ ate, rotulo }) => {
    const [, setT] = useState(0);
    useEffect(() => { const i = setInterval(() => setT(x => x + 1), 1000); return () => clearInterval(i); }, []);
    if (!ate) return null;
    const falta = Math.floor((new Date(ate).getTime() - Date.now()) / 1000);
    const abs = Math.abs(falta);
    const txt = `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    return <span className={`text-xs font-bold ${falta < 0 ? 'text-red-600' : 'text-gray-700'}`}>{rotulo} até {hora(ate)} ({falta < 0 ? `atrasado ${txt}` : `faltam ${txt}`})</span>;
};

export const MotoboyPage: React.FC = () => {
    const [token, setToken] = useState(lerToken());
    const [telefone, setTelefone] = useState('');
    const [senha, setSenha] = useState('');
    const [erro, setErro] = useState('');
    const [painel, setPainel] = useState<Painel | null>(null);
    const [codigos, setCodigos] = useState<Record<string, string>>({});
    const [ocupado, setOcupado] = useState(false);
    const vistas = useRef<Set<string>>(new Set());
    const primeira = useRef(true);

    const apitar = () => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            [880, 1100, 880].forEach((f, i) => {
                const o = ctx.createOscillator(); const g = ctx.createGain();
                o.frequency.value = f; o.connect(g); g.connect(ctx.destination); g.gain.value = 0.2;
                o.start(ctx.currentTime + i * 0.25); o.stop(ctx.currentTime + i * 0.25 + 0.18);
            });
        } catch { /* sem audio: so a tela avisa */ }
        try { navigator.vibrate?.([200, 100, 200]); } catch { /* tudo bem */ }
    };

    const atualizar = useCallback(async () => {
        if (!token) return;
        const { data, error } = await supabase.rpc('motoboy_painel', { p_token: token });
        if (error) { setErro('Sem conexão. Tentando de novo...'); return; }
        const p = data as Painel;
        if (!p?.ok) { guardarToken(''); setToken(''); setPainel(null); setErro(p?.erro || 'Entre de novo.'); return; }
        setErro('');
        const novas = p.disponiveis.filter(e => !vistas.current.has(e.id));
        p.disponiveis.forEach(e => vistas.current.add(e.id));
        if (!primeira.current && novas.length > 0 && p.online) apitar();
        primeira.current = false;
        setPainel(p);
    }, [token]);

    useEffect(() => {
        if (!token) return;
        atualizar();
        const i = setInterval(atualizar, 5000);
        // internet que volta ou a pessoa que volta para o aplicativo: atualiza na hora
        const agora = () => { if (document.visibilityState === 'visible') atualizar(); };
        window.addEventListener('online', agora);
        document.addEventListener('visibilitychange', agora);
        return () => { clearInterval(i); window.removeEventListener('online', agora); document.removeEventListener('visibilitychange', agora); };
    }, [token, atualizar]);

    const entrar = async (ev: React.FormEvent) => {
        ev.preventDefault();
        setOcupado(true); setErro('');
        const { data, error } = await supabase.rpc('motoboy_login', { p_telefone: telefone, p_senha: senha });
        setOcupado(false);
        if (error) { setErro('Sem conexão. Tente de novo.'); return; }
        if (!data?.ok) { setErro(data?.erro || 'Não foi possível entrar.'); return; }
        guardarToken(data.token); setToken(data.token); setSenha(''); primeira.current = true;
    };
    const sair = () => { guardarToken(''); setToken(''); setPainel(null); vistas.current.clear(); };

    const chamar = async (fn: string, args: Record<string, unknown>, sucesso?: () => void) => {
        setOcupado(true);
        const { data, error } = await supabase.rpc(fn, { p_token: token, ...args });
        setOcupado(false);
        if (error) { alert('Sem conexão. Tente de novo.'); return null; }
        if (!data?.ok) { alert(data?.erro || 'Não foi possível.'); atualizar(); return data; }
        sucesso?.(); atualizar(); return data;
    };
    const alternarOnline = () => painel && chamar('motoboy_online', { p_online: !painel.online });
    const entregar = async (e: Entrega) => {
        const codigo = (codigos[e.id] || '').trim();
        if (codigo.length !== 4) { alert('Digite os 4 números do código que o cliente passou.'); return; }
        const r = await chamar('motoboy_entregar', { p_entrega: e.id, p_codigo: codigo });
        if (r?.ok) { alert(`Entrega confirmada! Você ganhou ${brl(r.ganho)}.`); setCodigos({ ...codigos, [e.id]: '' }); }
        else if (r && !r.ok && r.restantes !== undefined && !r.bloqueada) alert(`Código incorreto. Restam ${r.restantes} tentativa(s).`);
    };
    const frustrada = async (e: Entrega) => {
        const motivo = window.prompt('O que aconteceu? (cliente não atende, recusou, endereço não existe...)');
        if (!motivo) return;
        if (!window.confirm('Registrar entrega não concluída? O suporte do Pede Aki vai decidir o resto.')) return;
        await chamar('motoboy_frustrada', { p_entrega: e.id, p_motivo: motivo });
    };

    const caixa = 'rounded-xl border border-gray-300 bg-white p-3 shadow-sm space-y-2';
    const botao = 'rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-50 active:scale-95';

    // Ja entrou mas o painel ainda nao chegou (carregando ou sem internet): nao volta para a tela de senha.
    if (token && !painel) {
        return (
            <div className="min-h-screen bg-[#F3F3F1] flex items-center justify-center p-6 text-center" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>
                <div className="space-y-3">
                    <p className="text-lg font-bold text-[#1A1A1A]">Carregando suas entregas...</p>
                    {erro && <p className="text-sm text-gray-600">{erro} Assim que a internet voltar, atualiza sozinho.</p>}
                    <button onClick={atualizar} className="rounded-lg bg-[#F26B1D] px-4 py-2 text-sm font-bold text-[#1F1F1F]">Tentar agora</button>
                    <button onClick={sair} className="block w-full text-sm text-gray-500 underline">Sair</button>
                </div>
            </div>
        );
    }

    if (!token || !painel) {
        return (
            <div className="min-h-screen bg-[#F3F3F1] flex items-center justify-center p-4" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>
                <form onSubmit={entrar} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow space-y-4">
                    <div className="text-center">
                        <img src="/pwa-192x192.png" alt="Pede Aki" className="mx-auto h-16 w-16 rounded-lg bg-black object-cover" />
                        <h1 className="mt-3 text-2xl font-bold text-[#1A1A1A]">Pede Aki Motoboy</h1>
                        <p className="text-sm text-gray-500">Entre com o telefone e a senha que o Pede Aki passou para você.</p>
                    </div>
                    <input value={telefone} onChange={e => setTelefone(e.target.value)} inputMode="tel" placeholder="Telefone com DDD" className="w-full rounded-lg border border-gray-300 p-3 text-base" required />
                    <input value={senha} onChange={e => setSenha(e.target.value)} type="password" placeholder="Senha" className="w-full rounded-lg border border-gray-300 p-3 text-base" required />
                    {erro && <p className="text-sm font-semibold text-red-600">{erro}</p>}
                    <button disabled={ocupado} className={`${botao} w-full bg-[#F26B1D] text-[#1F1F1F] text-base`}>{ocupado ? 'Entrando...' : 'Entrar'}</button>
                </form>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F3F3F1] pb-10" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>
            <header className="sticky top-0 z-10 bg-[#F26B1D] px-4 py-3 text-[#1F1F1F]">
                <div className="mx-auto flex max-w-md items-center gap-3">
                    <div className="flex-1">
                        <p className="text-lg font-bold leading-tight">Olá, {painel.nome.split(' ')[0]}</p>
                        <p className="text-xs">Hoje {brl(painel.ganhos_hoje)} | A receber {brl(painel.a_receber)}</p>
                    </div>
                    <button onClick={alternarOnline} disabled={ocupado} className={`${botao} ${painel.online ? 'bg-green-700 text-white' : 'bg-white text-gray-700'}`}>{painel.online ? 'Online' : 'Offline'}</button>
                </div>
            </header>
            <main className="mx-auto max-w-md space-y-5 p-4">
                {erro && <p className="rounded-lg bg-yellow-100 p-2 text-sm text-yellow-900">{erro}</p>}
                {!painel.online && <p className="rounded-lg bg-white p-3 text-sm text-gray-700">Você está offline. Toque em Offline para ficar online, ouvir os avisos e aparecer para os clientes.</p>}

                <section className="space-y-2">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-gray-600">Minhas entregas</h2>
                    {painel.minhas.length === 0 && <p className="text-sm text-gray-500">Nenhuma entrega com você agora.</p>}
                    {painel.minhas.map(e => (
                        <div key={e.id} className={caixa}>
                            <div className="flex items-center justify-between">
                                <p className="font-bold text-[#1A1A1A]">{e.loja}</p>
                                <p className="text-lg font-bold text-[#D1560F]">{brl(e.frete)}</p>
                            </div>
                            {e.status === 'aceita' && (
                                <>
                                    <p className="text-sm text-gray-700">Retirar em: {e.loja_endereco || 'endereço da loja'}</p>
                                    {e.loja_endereco && <a className="text-sm font-bold text-blue-700 underline" href={maps(e.loja_endereco)} target="_blank" rel="noreferrer">Abrir a loja no mapa</a>}
                                    <div><Contagem ate={e.prazo_retirar} rotulo="Retirar" /></div>
                                    <div className="flex gap-2">
                                        <button disabled={ocupado} onClick={() => chamar('motoboy_retirei', { p_entrega: e.id })} className={`${botao} flex-1 bg-[#F26B1D] text-[#1F1F1F]`}>Retirei o pedido</button>
                                        <button disabled={ocupado} onClick={() => window.confirm('Devolver esta entrega para outros motoboys?') && chamar('motoboy_soltar', { p_entrega: e.id })} className={`${botao} bg-gray-200 text-gray-800`}>Devolver</button>
                                    </div>
                                </>
                            )}
                            {e.status === 'retirada' && (
                                <>
                                    <p className="text-sm text-gray-700">Cliente: {e.cliente}</p>
                                    <p className="text-sm font-bold text-[#1A1A1A]">{e.endereco}</p>
                                    {e.referencia && <p className="text-sm text-gray-700">Referência: {e.referencia}</p>}
                                    {e.endereco && <a className="text-sm font-bold text-blue-700 underline" href={maps(e.endereco.replace(/ - Bairro:/, ','))} target="_blank" rel="noreferrer">Abrir o destino no mapa</a>}
                                    <div><Contagem ate={e.prazo_entregar} rotulo="Entregar" /></div>
                                    <div className="rounded-lg bg-gray-50 p-2 space-y-2">
                                        <p className="text-xs font-semibold text-gray-600">Só peça o código ao cliente quando entregar o pedido na mão dele.</p>
                                        <div className="flex gap-2">
                                            <input value={codigos[e.id] || ''} onChange={ev => setCodigos({ ...codigos, [e.id]: ev.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" placeholder="Código do cliente" className="w-full rounded-lg border border-gray-300 p-2.5 text-center text-lg tracking-widest" disabled={!!e.bloqueada} />
                                            <button disabled={ocupado || !!e.bloqueada} onClick={() => entregar(e)} className={`${botao} bg-green-700 text-white`}>Entregar</button>
                                        </div>
                                        {e.bloqueada && <p className="text-xs font-bold text-red-600">Código bloqueado por erros. Fale com o suporte.</p>}
                                    </div>
                                    <button disabled={ocupado} onClick={() => frustrada(e)} className={`${botao} w-full bg-gray-200 text-gray-800`}>Cliente não recebeu / não atende</button>
                                </>
                            )}
                        </div>
                    ))}
                </section>

                <section className="space-y-2">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-gray-600">Entregas disponíveis</h2>
                    {painel.disponiveis.length === 0 && <p className="text-sm text-gray-500">{painel.online ? 'Nenhuma entrega liberada agora. Fique atento.' : 'Fique online para ver e pegar entregas.'}</p>}
                    {painel.disponiveis.map(e => (
                        <div key={e.id} className={caixa}>
                            <div className="flex items-center justify-between">
                                <p className="font-bold text-[#1A1A1A]">{e.loja}</p>
                                <p className="text-lg font-bold text-[#D1560F]">{brl(e.frete)}</p>
                            </div>
                            <p className="text-sm text-gray-700">Destino: {e.bairro || 'bairro a confirmar'}</p>
                            <div className="flex flex-col"><Contagem ate={e.prazo_retirar} rotulo="Retirar" /><Contagem ate={e.prazo_entregar} rotulo="Entregar" /></div>
                            <button disabled={ocupado || !painel.online} onClick={() => chamar('motoboy_aceitar', { p_entrega: e.id })} className={`${botao} w-full bg-[#F26B1D] text-[#1F1F1F]`}>Pegar esta entrega</button>
                        </div>
                    ))}
                </section>

                {painel.previstas.length > 0 && (
                    <section className="space-y-2">
                        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-600">Em breve</h2>
                        {painel.previstas.map(e => (
                            <div key={e.id} className="rounded-xl border border-dashed border-gray-300 bg-gray-100 p-3">
                                <div className="flex items-center justify-between"><p className="font-bold text-gray-700">{e.loja}</p><p className="font-bold text-gray-600">{brl(e.frete)}</p></div>
                                <p className="text-sm text-gray-500">Destino: {e.bairro || 'a confirmar'}. A loja ainda vai aceitar o pedido. Se puder, fique perto.</p>
                            </div>
                        ))}
                    </section>
                )}

                <button onClick={sair} className="w-full text-center text-sm text-gray-500 underline">Sair</button>
            </main>
        </div>
    );
};

export default MotoboyPage;
