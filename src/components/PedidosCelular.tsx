import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Phone, MessageCircle, Clock, Volume2, X } from 'lucide-react';
import type { Order } from '../types';
import { testarSirene, VOLUME_PADRAO } from '../services/sireneService';
import { usarAlertaDePedidoNovo, pedirPermissaoDeNotificacao } from '../services/alertaPedidoNovo';
import { ativarPush, renovarPushSeJaAtivo } from '../services/pushLojista';
import { useStore } from '../contexts/StoreContext';

/**
 * Pedidos para o celular (30/10/2026), pensada para a loja de comissão: sem PC, sem impressora.
 * Uma lista vertical, um pedido por cartão, botões grandes que fazem o pedido andar, e cancelamento com
 * motivo obrigatório (o cliente é avisado e a plataforma audita cancelamento para a comissão não ser burlada).
 * Quem chama (AdminPage) entrega os pedidos em andamento e as ações; o toque de pedido novo continua sendo
 * o mesmo do painel (sireneService), e aqui só há o botão que libera o som no celular.
 */
type Status = Order['status'];

/** Dados extras do pedido vindos do banco (funcao lojista_pedidos_extra): quando pagou e como esta a entrega do Pede Aki. */
export interface PedidoExtra { order_id: string; pago_em?: string | null; aceito_em?: string | null; entrega?: string | null; motoboy?: string | null; disponivel_em?: string | null; pronta_em?: string | null }
const LIMITE_ACEITE_MIN = 15;   // a loja tem 15 minutos para responder (depois o pedido e cancelado e devolvido)
const ESPERA_EU_ENTREGO_MIN = 5; // sem motoboy em 5 minutos, a loja pode entregar por conta propria
const ARRASTO_MIN = 110;         // px para o arrastar valer

const MOTIVOS = [
    'Cliente pediu para cancelar',
    'Produto em falta',
    'Fora da área de entrega',
    'Sem entregador agora',
    'Loja fechada',
    'Outro motivo',
];

const brl = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;

const minutosDesde = (t?: string): number => (t ? Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 60000)) : 0);

const ehEntrega = (o: Order) => String(o.orderType || '').toLowerCase().includes('entrega');

const PRIORIDADE: Record<string, number> = { 'Novo': 0, 'Em Produção': 1, 'A Caminho': 2, 'No Portão': 2 };

/** Próximo passo do pedido e o rótulo do botão grande. */
export function proximoPasso(o: Order): { status: Status; rotulo: string } | null {
    switch (o.status) {
        case 'Novo': return { status: 'Em Produção', rotulo: 'Recebi, em preparo' };
        case 'Em Produção': return ehEntrega(o)
            ? { status: 'A Caminho', rotulo: 'Saiu para entrega' }
            : { status: 'Entregue', rotulo: 'Entregue ao cliente' };
        case 'A Caminho':
        case 'No Portão': return { status: 'Entregue', rotulo: 'Entregue' };
        default: return null;
    }
}

const textoPagamento = (o: Order): string => {
    if (o.paymentMethod === 'Dinheiro') return `Dinheiro${o.changeFor ? `, troco para ${brl(Number(String(o.changeFor).replace(',', '.')))}` : ''}`;
    return String(o.paymentMethod || '');
};

interface Props {
    pedidos: Order[];
    onAvancar: (pedido: Order, novoStatus: Status) => void;
    onCancelar: (pedido: Order, motivo: string) => void;
    extras?: Record<string, PedidoExtra>;
    onPronto?: (pedido: Order) => void;
    onEuEntrego?: (pedido: Order) => void;
}

export const PedidosCelular: React.FC<Props> = ({ pedidos, onAvancar, onCancelar, extras = {}, onPronto, onEuEntrego }) => {
    const [, setTick] = useState(0);
    const [recusando, setRecusando] = useState<Order | null>(null);
    const [recusaOutro, setRecusaOutro] = useState(false);
    const [recusaTexto, setRecusaTexto] = useState('');
    const arrasto = useRef<{ id: string; x0: number; y0: number; ativo: boolean } | null>(null);
    const [dx, setDx] = useState<{ id: string; v: number } | null>(null);
    const [cancelando, setCancelando] = useState<Order | null>(null);
    const [motivo, setMotivo] = useState(MOTIVOS[0]);
    const [detalhe, setDetalhe] = useState('');
    const [somTestado, setSomTestado] = useState(false);
    const { currentStore } = useStore();
    const [push, setPush] = useState<{ ligado: boolean; aviso?: string }>({ ligado: false });
    const [dicaFechada, setDicaFechada] = useState(() => { try { return localStorage.getItem('pedidos_dica_pwa') === '1'; } catch (_) { return false; } });

    // Se o aviso com a tela bloqueada já estava ligado neste aparelho, renova o registro em silêncio.
    useEffect(() => {
        if (!currentStore?.id) return;
        let vivo = true;
        renovarPushSeJaAtivo(currentStore.id).then(ok => { if (vivo && ok) setPush({ ligado: true }); });
        return () => { vivo = false; };
    }, [currentStore?.id]);

    // Os minutos de espera de cada pedido andam sozinhos.
    useEffect(() => {
        const t = setInterval(() => setTick(x => x + 1), 15000);
        return () => clearInterval(t);
    }, []);

    const lista = useMemo(() => [...pedidos].sort((a, b) =>
        (PRIORIDADE[a.status] ?? 9) - (PRIORIDADE[b.status] ?? 9) ||
        new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()), [pedidos]);

    // Enquanto houver pedido novo nao visto: campainha repetida, titulo piscando, notificacao e tela acesa.
    usarAlertaDePedidoNovo({
        ligado: somTestado,
        novos: useMemo(() => pedidos.filter(p => p.status === 'Novo').map(p => ({ id: p.id, numero: p.dailyOrderNumber })), [pedidos]),
    });

    const instalado = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (window.navigator as any).standalone === true);

    const recusar = (o: Order, motivoRecusa: string) => {
        onCancelar(o, motivoRecusa);
        setRecusando(null); setRecusaOutro(false); setRecusaTexto('');
    };
    const sobreArrasto = {
        inicio: (e: React.PointerEvent, o: Order) => { arrasto.current = { id: String(o.id), x0: e.clientX, y0: e.clientY, ativo: false }; },
        mover: (e: React.PointerEvent, o: Order) => {
            const a = arrasto.current; if (!a || a.id !== String(o.id)) return;
            const ddx = e.clientX - a.x0, ddy = e.clientY - a.y0;
            if (!a.ativo) { if (Math.abs(ddx) > 14 && Math.abs(ddx) > Math.abs(ddy) * 1.5) { a.ativo = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } else return; }
            setDx({ id: a.id, v: Math.max(-220, Math.min(220, ddx)) });
        },
        fim: (o: Order) => {
            const a = arrasto.current; arrasto.current = null;
            const v = dx && dx.id === String(o.id) ? dx.v : 0;
            setDx(null);
            if (!a?.ativo) return;
            if (v >= ARRASTO_MIN) onAvancar(o, 'Em Produção');
            else if (v <= -ARRASTO_MIN) { setRecusando(o); setRecusaOutro(false); setRecusaTexto(''); }
        },
    };

    const confirmarCancelamento = () => {
        if (!cancelando) return;
        const texto = motivo === 'Outro motivo' && detalhe.trim() ? `Outro motivo: ${detalhe.trim()}` : motivo;
        onCancelar(cancelando, texto);
        setCancelando(null); setMotivo(MOTIVOS[0]); setDetalhe('');
    };

    return (
        <div className="flex-1 min-h-0 overflow-y-auto pb-24">
            <div className="sticky top-0 z-10 bg-gray-100 dark:bg-gray-900 pb-3">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-xl font-black text-gray-900 dark:text-gray-100">
                        Pedidos <span className="ml-1 inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-red-600 text-white text-sm">{lista.length}</span>
                    </h2>
                    <button
                        onClick={() => {
                            testarSirene('sino', VOLUME_PADRAO); setSomTestado(true);
                            if (currentStore?.id) void ativarPush(currentStore.id).then(r => setPush(r.ok ? { ligado: true } : { ligado: false, aviso: r.motivo }));
                            else void pedirPermissaoDeNotificacao();
                        }}
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${somTestado ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-500 text-slate-950'}`}
                    >
                        <Volume2 size={16} /> {somTestado ? 'Alerta ligado' : 'Ligar o alerta'}
                    </button>
                </div>
                {somTestado && push.ligado && <p className="mt-2 text-xs text-green-700 dark:text-green-300">Aviso com a tela bloqueada: ligado neste aparelho. Chegando pedido, o celular toca mesmo com o navegador fechado, e avisa de novo a cada minuto até você tocar em Recebi, em preparo.</p>}
                {somTestado && !push.ligado && push.aviso && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{push.aviso}</p>}
                {!somTestado && <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">Toque em Ligar o alerta uma vez. Sem isso o celular não toca quando chegar pedido. Com ele ligado, a campainha toca alto e se repete até você tocar em Recebi, em preparo, e a tela não apaga enquanto este painel estiver aberto.</p>}
                {!instalado && !dicaFechada && (
                    <div className="mt-2 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-3 py-2 text-xs text-sky-900 dark:text-sky-200 flex items-start gap-2">
                        <span className="flex-1">Para o aviso chegar com o celular bloqueado, adicione este aplicativo à tela inicial (menu do navegador, Adicionar à tela inicial).</span>
                        <button onClick={() => { setDicaFechada(true); try { localStorage.setItem('pedidos_dica_pwa', '1'); } catch (_) { /* tudo bem */ } }} aria-label="Fechar aviso"><X size={16} /></button>
                    </div>
                )}
            </div>

            {lista.length === 0 ? (
                <div className="mt-10 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
                    <p className="text-lg font-black text-gray-800 dark:text-gray-100">Nenhum pedido agora</p>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Quando chegar um pedido, o celular toca e ele aparece aqui.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {lista.map(o => {
                        const ext = extras[String(o.id)];
                        const entregaApp = ext?.entrega && ext.entrega !== 'cancelada' ? ext.entrega : null; // entrega pelo motoboy do Pede Aki em andamento
                        const novo = o.status === 'Novo';
                        const passoBase = proximoPasso(o);
                        // Entrega do Pede Aki: a loja nao manda "saiu para entrega" (quem coleta e o motoboy); ela clica Pronto
                        const passo = entregaApp ? null : passoBase;
                        const espera = minutosDesde(o.timestamp);
                        const baseResposta = ext?.pago_em || o.timestamp;
                        const restaResposta = novo && baseResposta ? Math.max(0, LIMITE_ACEITE_MIN - minutosDesde(baseResposta)) : null;
                        const urgente = novo && (restaResposta !== null ? restaResposta <= 5 : espera >= 5);
                        const esperaMotoboy = entregaApp === 'disponivel' && ext?.disponivel_em ? minutosDesde(ext.disponivel_em) : 0;
                        const arrastando = dx && dx.id === String(o.id) ? dx.v : 0;
                        const fone = String(o.phone || '').replace(/\D/g, '');
                        return (
                            <article key={o.id}
                                onPointerDown={novo ? e => sobreArrasto.inicio(e, o) : undefined}
                                onPointerMove={novo ? e => sobreArrasto.mover(e, o) : undefined}
                                onPointerUp={novo ? () => sobreArrasto.fim(o) : undefined}
                                onPointerCancel={novo ? () => { arrasto.current = null; setDx(null); } : undefined}
                                style={novo ? { transform: arrastando ? `translateX(${arrastando}px)` : undefined, touchAction: 'pan-y', transition: arrastando ? 'none' : 'transform .2s' } : undefined}
                                className={`rounded-2xl shadow border-2 overflow-hidden ${arrastando > 0 ? 'bg-green-50' : arrastando < 0 ? 'bg-red-50' : 'bg-white dark:bg-gray-800'} ${novo ? 'border-red-500' : 'border-transparent'}`}>
                                <header className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50">
                                    <div>
                                        <p className="text-lg font-black text-gray-900 dark:text-gray-100">Pedido #{o.dailyOrderNumber || '-'}</p>
                                        <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{o.status} · {ehEntrega(o) ? 'Entrega' : 'Retirada'}</p>
                                    </div>
                                    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${urgente ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-100'}`}>
                                        <Clock size={14} /> {restaResposta !== null ? `responda em ${restaResposta} min` : `${espera} min`}
                                    </span>
                                </header>

                                <div className="px-4 py-3 space-y-3">
                                    <div>
                                        <p className="font-bold text-gray-900 dark:text-gray-100">{o.customerName || 'Cliente'}</p>
                                        {ehEntrega(o) && o.address && <p className="text-sm text-gray-600 dark:text-gray-300">{o.address}</p>}
                                        {fone && (
                                            <div className="mt-2 flex gap-2">
                                                <a href={`tel:${fone}`} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 px-3 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100"><Phone size={15} /> Ligar</a>
                                                <a href={`https://wa.me/${fone.length <= 11 ? '55' + fone : fone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-green-100 dark:bg-green-900/30 px-3 py-2 text-sm font-semibold text-green-800 dark:text-green-300"><MessageCircle size={15} /> WhatsApp</a>
                                            </div>
                                        )}
                                    </div>

                                    <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
                                        {(o.items || []).map((it, i) => (
                                            <li key={i} className="py-1.5">
                                                <span className="font-bold text-gray-900 dark:text-gray-100">{it.quantity}x {it.name}</span>
                                                {Array.isArray(it.selectedAddons) && it.selectedAddons.length > 0 && (
                                                    <span className="block text-xs text-gray-500 dark:text-gray-400">{it.selectedAddons.map(a => a.name).join(', ')}</span>
                                                )}
                                                {it.notes && <span className="block text-xs italic text-gray-500 dark:text-gray-400">{it.notes}</span>}
                                            </li>
                                        ))}
                                    </ul>
                                    {o.observation && <p className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">Obs: {o.observation}</p>}

                                    <div className="flex items-end justify-between border-t border-gray-100 dark:border-gray-700 pt-3">
                                        <div className="text-sm text-gray-600 dark:text-gray-300">
                                            <p>{textoPagamento(o)}</p>
                                            {Number(o.deliveryFee) > 0 && <p className="text-xs">Taxa de entrega {brl(Number(o.deliveryFee))}</p>}
                                        </div>
                                        <p className="text-xl font-black text-gray-900 dark:text-gray-100">{brl(o.total)}</p>
                                    </div>
                                </div>

                                <footer className="px-4 pb-4 space-y-2">
                                    {novo && <p className="text-center text-[11px] text-gray-500 dark:text-gray-400">Arraste o pedido para a direita para aceitar ou para a esquerda para recusar.</p>}
                                    {entregaApp === 'efetivada' && <p className="rounded-lg bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">Entrega pelo motoboy do Pede Aki. Quando o pedido estiver pronto, toque em Pronto: o motoboy é avisado para coletar.</p>}
                                    {entregaApp === 'aceita' && !ext?.pronta_em && <p className="rounded-lg bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">{ext?.motoboy || 'Um motoboy'} aceitou a entrega e está a caminho. Quando o pedido estiver pronto, toque em Pronto.</p>}
                                    {entregaApp === 'aceita' && ext?.pronta_em && <p className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">Pedido pronto. Aguardando {ext?.motoboy || 'o motoboy'} coletar.</p>}
                                    {entregaApp === 'disponivel' && <p className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">Pedido na fila de coleta. Aguardando um motoboy aceitar{esperaMotoboy > 0 ? ` (${esperaMotoboy} min)` : ''}.</p>}
                                    {entregaApp === 'retirada' && <p className="rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs text-green-900 dark:text-green-200">Coletado{ext?.motoboy ? ` por ${ext.motoboy}` : ''}. A entrega segue com o motoboy.</p>}
                                    <div className="flex gap-2">
                                        {novo && (
                                            <button onClick={() => onAvancar(o, 'Em Produção')} className="flex-1 rounded-xl bg-green-600 active:bg-green-700 text-white font-black text-base py-4">Aceitar pedido</button>
                                        )}
                                        {!novo && passo && (
                                            <button onClick={() => onAvancar(o, passo.status)} className="flex-1 rounded-xl bg-green-600 active:bg-green-700 text-white font-black text-base py-4">{passo.rotulo}</button>
                                        )}
                                        {!novo && (entregaApp === 'efetivada' || (entregaApp === 'aceita' && !ext?.pronta_em)) && onPronto && (
                                            <button onClick={() => onPronto(o)} className="flex-1 rounded-xl bg-green-600 active:bg-green-700 text-white font-black text-base py-4">Pronto para coleta</button>
                                        )}
                                        {!novo && entregaApp === 'disponivel' && esperaMotoboy >= ESPERA_EU_ENTREGO_MIN && onEuEntrego && (
                                            <button onClick={() => onEuEntrego(o)} className="flex-1 rounded-xl bg-amber-500 active:bg-amber-600 text-slate-950 font-black text-base py-4">Eu mesmo entrego</button>
                                        )}
                                        {entregaApp !== 'retirada' && (
                                            <button onClick={() => { if (novo) { setRecusando(o); setRecusaOutro(false); setRecusaTexto(''); } else setCancelando(o); }} className="rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-bold text-sm px-4 py-4">{novo ? 'Recusar' : 'Cancelar'}</button>
                                        )}
                                    </div>
                                </footer>
                            </article>
                        );
                    })}
                </div>
            )}

            {recusando && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setRecusando(null)}>
                    <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 p-5 space-y-3" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-black text-gray-900 dark:text-gray-100">Recusar o pedido #{recusando.dailyOrderNumber || ''}?</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-300">O cliente é avisado e o dinheiro volta para ele. Por que está recusando?</p>
                        <button onClick={() => recusar(recusando, 'Sem produto')} className="w-full rounded-xl bg-red-600 text-white font-bold py-4">Sem produto</button>
                        <button onClick={() => recusar(recusando, 'Fechado')} className="w-full rounded-xl bg-red-600 text-white font-bold py-4">Fechado</button>
                        {!recusaOutro ? (
                            <button onClick={() => setRecusaOutro(true)} className="w-full rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-bold py-4">Outro</button>
                        ) : (
                            <div className="space-y-2">
                                <input autoFocus value={recusaTexto} onChange={e => setRecusaTexto(e.target.value)} placeholder="Se quiser, escreva o motivo" className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-3 text-sm text-gray-900 dark:text-gray-100" />
                                <button onClick={() => recusar(recusando, recusaTexto.trim() ? `Outro: ${recusaTexto.trim()}` : 'Outro')} className="w-full rounded-xl bg-red-600 text-white font-bold py-3">Recusar pedido</button>
                            </div>
                        )}
                        <button onClick={() => setRecusando(null)} className="w-full text-sm text-gray-600 dark:text-gray-300 underline py-1">Voltar</button>
                    </div>
                </div>
            )}

            {cancelando && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setCancelando(null)}>
                    <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 p-5 space-y-4" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-black text-gray-900 dark:text-gray-100">Cancelar o pedido #{cancelando.dailyOrderNumber || ''}?</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-300">O cliente é avisado. Escolha o motivo: ele fica registrado.</p>
                        <div className="space-y-2">
                            {MOTIVOS.map(m => (
                                <label key={m} className={`flex items-center gap-3 rounded-lg border px-3 py-3 cursor-pointer ${motivo === m ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-600'}`}>
                                    <input type="radio" name="motivo" checked={motivo === m} onChange={() => setMotivo(m)} className="h-4 w-4" />
                                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{m}</span>
                                </label>
                            ))}
                        </div>
                        {motivo === 'Outro motivo' && (
                            <input value={detalhe} onChange={e => setDetalhe(e.target.value)} placeholder="Explique em poucas palavras" className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-3 text-sm text-gray-900 dark:text-gray-100" />
                        )}
                        <div className="flex gap-2">
                            <button onClick={() => setCancelando(null)} className="flex-1 rounded-xl bg-gray-200 dark:bg-gray-700 font-bold py-3 text-gray-800 dark:text-gray-100">Voltar</button>
                            <button onClick={confirmarCancelamento} disabled={motivo === 'Outro motivo' && !detalhe.trim()} className="flex-1 rounded-xl bg-red-600 disabled:opacity-50 text-white font-bold py-3">Cancelar pedido</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
