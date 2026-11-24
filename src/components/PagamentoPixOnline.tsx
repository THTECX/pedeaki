import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseService';

/**
 * Tela do PIX online: pede o CPF (o Asaas exige), mostra o QR e o copia e cola, conta os 15 minutos e
 * confere o pagamento de 3 em 3 segundos. Quem confirma o pagamento é o servidor (webhook); aqui só se espera.
 */
interface Props {
    pedido: { id: string; phone: string; total: number; pagarAte?: string | null };
    qrInicial?: { imagem: string; copiaCola: string };
    onQr?: (qr: { imagem: string; copiaCola: string }, pagarAte: string | null) => void;
    onPago: () => void;
    onExpirou?: () => void;
    onVoltar: () => void;
}

const CHAVE_CPF = 'pedeaki_cliente_cpf';
const so = (v: string) => v.replace(/\D/g, '');
const mascara = (v: string) => {
    const d = so(v).slice(0, 14);
    if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};
const lerCpf = () => { try { return localStorage.getItem(CHAVE_CPF) || ''; } catch { return ''; } };
const guardarCpf = (v: string) => { try { localStorage.setItem(CHAVE_CPF, v); } catch { /* sem armazenamento: digita de novo na proxima */ } };
const esquecerCpf = () => { try { localStorage.removeItem(CHAVE_CPF); } catch { /* tudo bem */ } };
/** Mostra so o meio do documento, para o CPF salvo nunca aparecer inteiro na tela de quem pega o celular emprestado. */
const ocultar = (d: string) => d.length === 14 ? `••.•••.${d.slice(5, 8)}/${d.slice(8, 12)}-••` : `•••.${d.slice(3, 6)}.${d.slice(6, 9)}-••`;

export const PagamentoPixOnline = ({ pedido, qrInicial, onQr, onPago, onExpirou, onVoltar }: Props) => {
    const [cpf, setCpf] = useState('');             // o campo sempre comeca limpo
    const [salvo, setSalvo] = useState(lerCpf());      // CPF guardado neste aparelho: so aparece como atalho, mascarado
    const [fase, setFase] = useState<'cpf' | 'gerando' | 'qr' | 'expirou'>(qrInicial ? 'qr' : 'cpf');
    const [erro, setErro] = useState('');
    const [qr, setQr] = useState<{ imagem: string; copiaCola: string } | null>(qrInicial || null);
    const [pagarAte, setPagarAte] = useState<number>(pedido.pagarAte ? new Date(pedido.pagarAte).getTime() : Date.now() + 15 * 60000);
    const [agora, setAgora] = useState(Date.now());
    const [copiado, setCopiado] = useState(false);
    const avisou = useRef(false);

    const gerar = async () => {
        setErro('');
        if (so(cpf).length !== 11 && so(cpf).length !== 14) { setErro('Digite o CPF completo.'); return; }
        setFase('gerando');
        try {
            const r = await fetch('/api/asaas-cobrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: pedido.id, phone: pedido.phone, cpf: so(cpf) }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { setErro(j.erro || 'Não foi possível gerar o PIX. Tente de novo.'); setFase('cpf'); return; }
            guardarCpf(so(cpf));
            if (j.pagar_ate) setPagarAte(new Date(j.pagar_ate).getTime());
            const novoQr = { imagem: j.qr_imagem as string, copiaCola: j.copia_cola as string };
            setQr(novoQr);
            onQr?.(novoQr, j.pagar_ate || null);
            setFase('qr');
        } catch {
            setErro('Sem conexão. Tente de novo.'); setFase('cpf');
        }
    };

    // Relógio e conferência do pagamento enquanto o QR está na tela
    useEffect(() => {
        if (fase !== 'qr') return;
        const relogio = setInterval(() => setAgora(Date.now()), 1000);
        const conferir = setInterval(async () => {
            try {
                const { data } = await supabase.rpc('pedido_status', { p_order: pedido.id, p_phone: pedido.phone });
                if (data?.payment_status === 'pago' && !avisou.current) { avisou.current = true; onPago(); }
                else if (data?.status === 'Expirado' || data?.status === 'Cancelado') { setFase('expirou'); onExpirou?.(); }
            } catch { /* tenta de novo no proximo ciclo */ }
        }, 3000);
        return () => { clearInterval(relogio); clearInterval(conferir); };
    }, [fase, pedido.id, pedido.phone, onPago]);

    useEffect(() => { if (fase === 'qr' && agora > pagarAte + 20000) { setFase('expirou'); onExpirou?.(); } }, [agora, pagarAte, fase, onExpirou]);

    const falta = Math.max(0, Math.floor((pagarAte - agora) / 1000));
    const relogio = `${String(Math.floor(falta / 60)).padStart(2, '0')}:${String(falta % 60).padStart(2, '0')}`;
    const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

    const copiar = async () => {
        try { await navigator.clipboard.writeText(qr?.copiaCola || ''); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { /* o texto fica na tela para selecionar */ }
    };

    return (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-end sm:items-center justify-center backdrop-blur-sm">
            <div className="w-full max-w-md bg-surface text-text-light rounded-t-2xl sm:rounded-2xl p-5 max-h-[94vh] overflow-y-auto">
                <h2 className="text-lg font-bold">Pagar com PIX</h2>
                <p className="text-sm text-text-dark mt-0.5">Total do pedido: <span className="font-bold text-text-light">{brl(pedido.total)}</span></p>

                {(fase === 'cpf' || fase === 'gerando') && (
                    <div className="mt-4 space-y-3">
                        <label className="block text-sm">
                            CPF do pagador
                            <input
                                value={mascara(cpf)} onChange={e => setCpf(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" autoComplete="off"
                                className="mt-1 w-full p-2.5 bg-background border border-surface rounded-lg outline-none focus:border-primary text-base"
                            />
                        </label>
                        {so(salvo).length >= 11 && !so(cpf) && (
                            <p className="text-xs text-text-dark">
                                CPF guardado neste aparelho: {ocultar(so(salvo))}.{' '}
                                <button type="button" onClick={() => setCpf(salvo)} className="font-bold text-primary underline">Usar este</button>{' '}
                                <button type="button" onClick={() => { esquecerCpf(); setSalvo(''); }} className="underline">Esquecer</button>
                            </p>
                        )}
                        <p className="text-xs text-text-dark">O banco exige o CPF para gerar o PIX. Se quiser, guardamos só neste aparelho, mascarado, para você usar de novo com um toque.</p>
                        {erro && <p className="text-sm text-red-500 font-semibold">{erro}</p>}
                        <button onClick={gerar} disabled={fase === 'gerando'} className="w-full py-3 bg-primary text-background font-bold rounded-lg disabled:opacity-50">
                            {fase === 'gerando' ? 'Gerando o PIX...' : 'Gerar PIX'}
                        </button>
                        <button onClick={onVoltar} className="w-full py-2 text-sm text-text-dark underline">Voltar ao carrinho</button>
                    </div>
                )}

                {fase === 'qr' && qr && (
                    <div className="mt-4 space-y-3 text-center">
                        <p className="text-sm">Abra o app do seu banco, escolha pagar com PIX e leia o código.</p>
                        <img src={`data:image/png;base64,${qr.imagem}`} alt="QR Code do PIX" className="mx-auto w-52 h-52 bg-white p-2 rounded-lg" />
                        <button onClick={copiar} className="w-full py-3 bg-primary text-background font-bold rounded-lg">{copiado ? 'Código copiado' : 'Copiar código PIX'}</button>
                        <p className="text-xs text-text-dark break-all select-all">{qr.copiaCola}</p>
                        <p className="text-sm">Tempo para pagar: <span className="font-bold">{relogio}</span></p>
                        <p className="text-xs text-text-dark">Assim que o pagamento cair, esta tela fecha sozinha e a loja recebe o seu pedido.</p>
                        <button onClick={onVoltar} className="w-full py-2 text-sm text-text-dark underline">Fechar e pagar depois</button>
                    </div>
                )}

                {fase === 'expirou' && (
                    <div className="mt-4 space-y-3 text-center">
                        <p className="text-sm">O tempo para pagar acabou e o pedido foi cancelado. Se você já pagou, o valor volta para a sua conta automaticamente.</p>
                        <button onClick={onVoltar} className="w-full py-3 bg-primary text-background font-bold rounded-lg">Fazer o pedido de novo</button>
                    </div>
                )}
            </div>
        </div>
    );
};

/** Selo que fica na tela enquanto existe um PIX pendente e a janela de pagamento esta fechada. */
export const PixPendentePill = ({ pagarAte, total, onAbrir, onExpirou }: { pagarAte: string; total: number; onAbrir: () => void; onExpirou: () => void }) => {
    const [agora, setAgora] = useState(Date.now());
    useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
    const limite = new Date(pagarAte).getTime();
    const falta = Math.max(0, Math.floor((limite - agora) / 1000));
    useEffect(() => { if (agora > limite + 20000) onExpirou(); }, [agora, limite, onExpirou]);
    if (falta <= 0) return null;
    const relogio = `${String(Math.floor(falta / 60)).padStart(2, '0')}:${String(falta % 60).padStart(2, '0')}`;
    return (
        <button onClick={onAbrir} className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[65] px-4 py-2 rounded-full bg-primary text-background text-sm font-bold shadow-lg active:scale-95">
            PIX aguardando pagamento: R$ {total.toFixed(2).replace('.', ',')} ({relogio}). Abrir
        </button>
    );
};
