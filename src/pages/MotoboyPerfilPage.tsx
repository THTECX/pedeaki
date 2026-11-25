import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Bike, ChevronRight, Wallet, History } from 'lucide-react';
import { lerTokenMotoboy, guardarTokenMotoboy } from '../utils/motoboySessao';
import { supabase } from '../services/supabaseService';
import { CarteiraPainel } from '../components/CarteiraPainel';
import { telefoneBonito } from '../utils/telefoneCliente';

/**
 * Perfil do motoboy (/motoboy/perfil): a primeira tela depois do login. Daqui ele vai para a Central de entregas,
 * abre a Carteira (subconta Asaas: frete cai la depois de cada entrega) e ve o historico e os ganhos.
 * Base para o que vier depois (avisos, metas, indicacao).
 */
interface ItemHistorico { id: string; valor: number; status: 'pendente' | 'enviando' | 'pago'; quando: string; loja: string; bairro: string | null; frustrada: boolean }
interface Perfil {
    ok: boolean; erro?: string; nome: string; telefone: string; online: boolean; tem_carteira: boolean;
    hoje: number; semana: number; mes: number; entregas_mes: number; a_enviar: number; historico: ItemHistorico[];
}

const brl = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const SITUACAO: Record<ItemHistorico['status'], { texto: string; cor: string }> = {
    pago: { texto: 'na carteira', cor: 'text-green-700' },
    enviando: { texto: 'enviando', cor: 'text-blue-700' },
    pendente: { texto: 'a enviar', cor: 'text-amber-700' },
};

const MotoboyPerfilPage = () => {
    const navigate = useNavigate();
    const [token] = useState(lerTokenMotoboy());
    const [perfil, setPerfil] = useState<Perfil | null>(null);
    const [erro, setErro] = useState('');
    const [aba, setAba] = useState<'inicio' | 'carteira' | 'historico'>('inicio');

    const carregar = useCallback(async () => {
        if (!token) return;
        const { data, error } = await supabase.rpc('motoboy_perfil', { p_token: token });
        if (error) { setErro('Sem conexão. Tente de novo.'); return; }
        if (!data?.ok) { guardarTokenMotoboy(''); navigate('/perfil', { replace: true }); return; }
        setErro(''); setPerfil(data as Perfil);
    }, [token, navigate]);
    useEffect(() => { void carregar(); const t = setInterval(carregar, 30000); return () => clearInterval(t); }, [carregar]);

    if (!token) return <Navigate to="/perfil" replace />;
    const sair = () => { guardarTokenMotoboy(''); navigate('/perfil', { replace: true }); };

    return (
        <div className="min-h-screen bg-[#F3F3F1] pb-10 text-gray-900" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>
            <header className="sticky top-0 z-10 bg-[#F26B1D] px-4 py-3 text-[#1F1F1F]">
                <div className="mx-auto flex max-w-md items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/80"><Bike size={22} /></div>
                    <div className="flex-1">
                        <p className="text-lg font-bold leading-tight">{perfil ? perfil.nome : 'Motoboy'}</p>
                        <p className="text-xs">{perfil ? telefoneBonito(perfil.telefone) : ''}</p>
                    </div>
                    <button onClick={sair} className="text-xs font-bold underline">Sair</button>
                </div>
            </header>

            <main className="mx-auto max-w-md space-y-4 p-4">
                {erro && <p className="rounded-lg bg-yellow-100 p-2 text-sm text-yellow-900">{erro}</p>}

                <button onClick={() => navigate('/motoboy')} className="flex w-full items-center gap-3 rounded-xl bg-[#1F1F1F] p-4 text-left text-white active:scale-[0.98]">
                    <Bike size={26} className="text-[#F26B1D]" />
                    <span className="flex-1">
                        <span className="block text-lg font-bold">Central de entregas</span>
                        <span className="block text-xs text-gray-300">{perfil?.online ? 'Você está online' : 'Fique online e veja as coletas'}</span>
                    </span>
                    <ChevronRight size={22} />
                </button>

                {perfil && (
                    <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl bg-white p-3"><p className="text-[11px] font-bold uppercase text-gray-500">Hoje</p><p className="text-lg font-bold">{brl(perfil.hoje)}</p></div>
                        <div className="rounded-xl bg-white p-3"><p className="text-[11px] font-bold uppercase text-gray-500">Semana</p><p className="text-lg font-bold">{brl(perfil.semana)}</p></div>
                        <div className="rounded-xl bg-white p-3"><p className="text-[11px] font-bold uppercase text-gray-500">Mês</p><p className="text-lg font-bold">{brl(perfil.mes)}</p><p className="text-[11px] text-gray-500">{perfil.entregas_mes} entrega(s)</p></div>
                    </div>
                )}
                {perfil && perfil.a_enviar > 0 && (
                    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{brl(perfil.a_enviar)} a enviar para a sua carteira{perfil.tem_carteira ? ' (sai sozinho em instantes).' : '. Crie a sua carteira para receber direto.'}</p>
                )}

                <div className="flex gap-2">
                    <button onClick={() => setAba(aba === 'carteira' ? 'inicio' : 'carteira')} className={`flex flex-1 items-center justify-center gap-2 rounded-xl p-3 text-sm font-bold ${aba === 'carteira' ? 'bg-[#F26B1D] text-[#1F1F1F]' : 'bg-white text-gray-800'}`}><Wallet size={18} />Carteira</button>
                    <button onClick={() => setAba(aba === 'historico' ? 'inicio' : 'historico')} className={`flex flex-1 items-center justify-center gap-2 rounded-xl p-3 text-sm font-bold ${aba === 'historico' ? 'bg-[#F26B1D] text-[#1F1F1F]' : 'bg-white text-gray-800'}`}><History size={18} />Histórico</button>
                </div>

                {aba === 'carteira' && <CarteiraPainel tipo="motoboy" quem={{ dono: 'motoboy', token }} />}

                {aba === 'historico' && perfil && (
                    <section className="space-y-2">
                        {perfil.historico.length === 0 && <p className="rounded-lg bg-white p-3 text-sm text-gray-600">Nenhuma entrega ainda.</p>}
                        {perfil.historico.map(h => (
                            <div key={h.id} className="flex items-center gap-3 rounded-lg bg-white p-3 text-sm">
                                <div className="flex-1 min-w-0">
                                    <p className="truncate font-bold">{h.loja}{h.bairro ? ` → ${h.bairro}` : ''}</p>
                                    <p className="text-xs text-gray-500">{quando(h.quando)}{h.frustrada ? ' | cliente não recebeu' : ''}</p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold">{brl(h.valor)}</p>
                                    <p className={`text-[11px] font-bold ${SITUACAO[h.status].cor}`}>{SITUACAO[h.status].texto}</p>
                                </div>
                            </div>
                        ))}
                    </section>
                )}

                {aba === 'inicio' && perfil && !perfil.tem_carteira && (
                    <button onClick={() => setAba('carteira')} className="w-full rounded-xl border-2 border-dashed border-[#F26B1D] bg-white p-4 text-left text-sm text-gray-800">
                        <b className="block text-base">Crie a sua carteira</b>
                        Com ela o frete de cada entrega cai na hora numa conta sua no Asaas, e você saca quando quiser.
                    </button>
                )}
            </main>
        </div>
    );
};

export default MotoboyPerfilPage;
