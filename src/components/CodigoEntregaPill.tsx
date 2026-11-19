import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseService';

/**
 * Andamento e codigo de entrega do cliente. Aparece depois que o PIX confirma, em pedido de Entrega feita pelo motoboy do Pede Aki, e
 * fica na tela (guardado no aparelho) ate a entrega acabar. O CODIGO so aparece quando o motoboy coleta o pedido na loja
 * ("coletado, em rota de entrega"); so o cliente ve o codigo e o motoboy digita no aplicativo dele.
 */
const CHAVE = 'pedeaki_pedido_ativo';
export interface PedidoAtivo { orderId: string; phone: string; storeId: string }

export const guardarPedidoAtivo = (p: PedidoAtivo) => { try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch { /* sem armazenamento: o codigo so aparece na confirmacao */ } };
const limpar = () => { try { localStorage.removeItem(CHAVE); } catch { /* tudo bem */ } };
const ler = (): PedidoAtivo | null => { try { const b = localStorage.getItem(CHAVE); return b ? JSON.parse(b) as PedidoAtivo : null; } catch { return null; } };

interface Info { tem_entrega: boolean; status?: string; codigo?: string | null; motoboy?: string | null; bloqueada?: boolean; pronta?: boolean }
const TEXTO: Record<string, string> = {
    prevista: 'Pagamento recebido. Aguardando a loja aceitar o pedido.',
    efetivada: 'A loja aceitou e está preparando o seu pedido.',
    disponivel: 'Pedido em fila de coleta. Estamos chamando um motoboy.',
    aceita: 'Um motoboy já aceitou e vai coletar o seu pedido.',
    retirada: 'Pedido coletado, em rota de entrega.',
};

export const CodigoEntregaPill = ({ storeId }: { storeId: string }) => {
    const [pedido, setPedido] = useState<PedidoAtivo | null>(() => { const p = ler(); return p && p.storeId === storeId ? p : null; });
    const [info, setInfo] = useState<Info | null>(null);
    const [aberto, setAberto] = useState(true);

    useEffect(() => {
        // outro pedido pode ter sido guardado depois (acabou de pagar): confere a cada ciclo
        let vivo = true;
        const conferir = async () => {
            const atual = ler();
            if (!atual || atual.storeId !== storeId) { if (vivo) { setPedido(null); setInfo(null); } return; }
            if (vivo) setPedido(atual);
            try {
                const { data } = await supabase.rpc('pedido_entrega', { p_order: atual.orderId, p_phone: atual.phone });
                if (!vivo) return;
                const i = data as Info | null;
                if (!i || !i.tem_entrega || !i.status || ['entregue', 'cancelada', 'frustrada'].includes(i.status)) { limpar(); setPedido(null); setInfo(null); return; }
                setInfo(i);
            } catch { /* tenta de novo no proximo ciclo */ }
        };
        conferir();
        const t = setInterval(conferir, 8000);
        return () => { vivo = false; clearInterval(t); };
    }, [storeId]);

    if (!pedido || !info) return null;
    if (!info.codigo) {
        return (
            <div className="fixed bottom-4 left-1/2 z-[64] w-[92%] max-w-sm -translate-x-1/2 rounded-2xl border border-primary bg-surface px-4 py-3 text-text-light shadow-xl">
                <p className="text-xs font-bold uppercase tracking-wide text-text-dark">Seu pedido</p>
                <p className="text-sm font-semibold">{info.status === 'aceita' && info.pronta ? 'Pedido pronto, aguardando o motoboy coletar.' : (TEXTO[info.status || ''] || 'Pedido em andamento.')}</p>
                <p className="text-xs text-text-dark">O código para o motoboy aparece aqui quando ele coletar o pedido na loja.</p>
            </div>
        );
    }
    if (!aberto) {
        return <button onClick={() => setAberto(true)} className="fixed bottom-4 right-4 z-[64] rounded-full bg-primary px-4 py-2 text-sm font-bold text-background shadow-lg">Código de entrega</button>;
    }
    return (
        <div className="fixed bottom-4 left-1/2 z-[64] w-[92%] max-w-sm -translate-x-1/2 rounded-2xl border-2 border-primary bg-surface p-4 text-text-light shadow-2xl">
            <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-text-dark">Seu código de entrega</p>
                <button onClick={() => setAberto(false)} className="text-xs text-text-dark underline">minimizar</button>
            </div>
            <p className="my-1 text-center text-4xl font-black tracking-[0.3em] text-primary">{info.codigo}</p>
            <p className="text-center text-xs font-semibold">Só passe este código ao motoboy quando receber o pedido na sua mão.</p>
            <p className="mt-2 text-center text-xs text-text-dark">{info.bloqueada ? 'Código bloqueado. O suporte do Pede Aki vai gerar um novo.' : (TEXTO[info.status || ''] || '')}{info.motoboy ? ` Motoboy: ${info.motoboy}.` : ''}</p>
        </div>
    );
};
