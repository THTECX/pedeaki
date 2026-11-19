import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseService';

/** Taxa de aceite por loja de comissão nos últimos 30 dias (SQL 18): quem aceita, quem recusa e quem deixa o pedido sem resposta. */
interface Linha { store_id: string; loja: string; recebidos: number; aceitos: number; recusados: number; sem_resposta: number; minutos_medios: number | null }

export const AceiteLojas: React.FC = () => {
    const [linhas, setLinhas] = useState<Linha[] | null | undefined>(undefined);
    useEffect(() => {
        supabase.rpc('aceite_das_lojas', { p_dias: 30 }).then(({ data, error }) => setLinhas(error || !Array.isArray(data) ? null : (data as Linha[])));
    }, []);

    if (linhas === undefined) return null;
    if (linhas === null) return <div className="rounded-xl border border-yellow-700 bg-gray-800 p-4 text-sm text-yellow-300">Taxa de aceite: rode a versão nova do SQL 18 no Supabase para ver esta tabela.</div>;

    const pct = (n: number, d: number) => d > 0 ? `${Math.round((n / d) * 100)}%` : '-';
    return (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-2">
            <div>
                <h2 className="text-lg font-bold text-white">Aceite dos pedidos (últimos 30 dias)</h2>
                <p className="text-sm text-gray-400">Pedidos pagos online que chegaram na loja. Loja que recusa ou deixa sem resposta com frequência é loja para conversar ou pausar.</p>
            </div>
            {linhas.length === 0 ? <p className="text-sm text-gray-400">Nenhum pedido pago online ainda.</p> : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase text-gray-400"><tr><th className="py-1 pr-3">Loja</th><th className="pr-3">Recebidos</th><th className="pr-3">Aceitos</th><th className="pr-3">Recusados</th><th className="pr-3">Sem resposta</th><th>Tempo médio para aceitar</th></tr></thead>
                        <tbody className="divide-y divide-gray-700 text-gray-300">
                            {linhas.map(l => (
                                <tr key={l.store_id}>
                                    <td className="py-1 pr-3 font-bold text-white">{l.loja}</td>
                                    <td className="pr-3">{l.recebidos}</td>
                                    <td className="pr-3">{l.aceitos} ({pct(l.aceitos, l.recebidos)})</td>
                                    <td className={`pr-3 ${l.recusados > 0 ? 'text-yellow-300' : ''}`}>{l.recusados} ({pct(l.recusados, l.recebidos)})</td>
                                    <td className={`pr-3 ${l.sem_resposta > 0 ? 'text-red-300 font-bold' : ''}`}>{l.sem_resposta} ({pct(l.sem_resposta, l.recebidos)})</td>
                                    <td>{l.minutos_medios === null ? '-' : `${Number(l.minutos_medios).toFixed(1).replace('.', ',')} min`}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
