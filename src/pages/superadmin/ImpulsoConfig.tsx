import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseService';
import { usePlataforma } from './dados';

/** Preço, vagas e descontos do impulso da vitrine (SQL 20) e as últimas compras dos lojistas. */
interface Config { preco_dia: number; vagas: number; desc_7: number; desc_15: number; desc_30: number; ativo: boolean }
interface Compra { id: string; store_id: string; dias: number; valor: number; status: string; criado_em: string; ate: string | null }

const campo = 'w-full rounded-lg bg-gray-700 border border-gray-600 p-2 text-white';
const brl = (v: number) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
const dataBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export const ImpulsoConfig: React.FC = () => {
    const d = usePlataforma();
    const [cfg, setCfg] = useState<Config | null | undefined>(undefined);
    const [compras, setCompras] = useState<Compra[]>([]);
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        const { data, error } = await supabase.from('impulso_config').select('preco_dia,vagas,desc_7,desc_15,desc_30,ativo').eq('id', 1).limit(1);
        if (error || !data?.[0]) { setCfg(null); return; }
        setCfg(data[0] as Config);
        const c = await supabase.from('impulsos').select('id,store_id,dias,valor,status,criado_em,ate').order('criado_em', { ascending: false }).limit(15);
        setCompras((c.data || []) as Compra[]);
    };
    useEffect(() => { void carregar(); }, []);

    if (cfg === undefined) return null;
    if (cfg === null) return <div className="rounded-xl border border-yellow-700 bg-gray-800 p-4 text-sm text-yellow-300">Impulsionamento: rode o SQL 20 no Supabase para liberar a compra pelo lojista.</div>;

    const salvar = async () => {
        setSalvando(true);
        const { error } = await supabase.from('impulso_config').update({ ...cfg, atualizado_em: new Date().toISOString() }).eq('id', 1);
        setSalvando(false);
        if (error) alert(`Erro ao salvar: ${error.message}`); else alert('Impulsionamento atualizado.');
    };
    const num = (k: keyof Config, v: string) => setCfg({ ...cfg, [k]: Number(v.replace(',', '.')) || 0 });
    const nomeDa = (id: string) => d.stores.find(s => s.id === id)?.name || '?';

    return (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4 space-y-4">
            <div>
                <h2 className="text-lg font-bold text-white">Impulsionamento (lojas patrocinadas)</h2>
                <p className="text-sm text-gray-400">O lojista de comissão compra sozinho em /impulsionar, por dia. Quem não comprou fica de fora. Você ainda pode impulsionar na mão em Lojas, editando a loja.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <label className="text-xs text-gray-400">Preço por dia (R$)<input className={campo} inputMode="decimal" value={cfg.preco_dia} onChange={e => num('preco_dia', e.target.value)} /></label>
                <label className="text-xs text-gray-400">Vagas ao mesmo tempo<input className={campo} inputMode="numeric" value={cfg.vagas} onChange={e => num('vagas', e.target.value)} /></label>
                <label className="text-xs text-gray-400">Desconto 7+ dias (%)<input className={campo} inputMode="decimal" value={cfg.desc_7} onChange={e => num('desc_7', e.target.value)} /></label>
                <label className="text-xs text-gray-400">Desconto 15+ dias (%)<input className={campo} inputMode="decimal" value={cfg.desc_15} onChange={e => num('desc_15', e.target.value)} /></label>
                <label className="text-xs text-gray-400">Desconto 30+ dias (%)<input className={campo} inputMode="decimal" value={cfg.desc_30} onChange={e => num('desc_30', e.target.value)} /></label>
            </div>
            <p className="text-xs text-gray-400">Com esses valores: 7 dias = {brl(7 * cfg.preco_dia * (1 - cfg.desc_7 / 100))}, 15 dias = {brl(15 * cfg.preco_dia * (1 - cfg.desc_15 / 100))}, 30 dias = {brl(30 * cfg.preco_dia * (1 - cfg.desc_30 / 100))}.</p>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" checked={cfg.ativo} onChange={e => setCfg({ ...cfg, ativo: e.target.checked })} className="h-4 w-4" />
                Venda de impulso ligada (desligada, a vitrine não mostra o convite e o lojista não compra)
            </label>
            <button onClick={salvar} disabled={salvando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50">{salvando ? 'Salvando...' : 'Salvar'}</button>

            {compras.length > 0 && (
                <div className="overflow-x-auto">
                    <p className="text-sm font-bold text-gray-300 mb-1">Últimas compras</p>
                    <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase text-gray-400"><tr><th className="py-1 pr-3">Loja</th><th className="pr-3">Dias</th><th className="pr-3">Valor</th><th className="pr-3">Situação</th><th>Vale até</th></tr></thead>
                        <tbody className="divide-y divide-gray-700 text-gray-300">
                            {compras.map(c => (
                                <tr key={c.id}>
                                    <td className="py-1 pr-3">{nomeDa(c.store_id)}</td><td className="pr-3">{c.dias}</td><td className="pr-3">{brl(c.valor)}</td>
                                    <td className="pr-3">{c.status === 'pago' ? 'pago' : c.status === 'sem_vaga' ? 'sem vaga (estornar)' : 'aguardando'}</td>
                                    <td>{c.ate ? dataBR(c.ate) : '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
