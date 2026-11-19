import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseService';
import { useStore } from '../contexts/StoreContext';

/**
 * Tempo médio de preparo da loja (só lojas de comissão com entrega pelo motoboy do Pede Aki). Fica nas configurações, uma vez;
 * o Pede Aki usa na prévia do motoboy ("pronto por volta de...") e o lojista não precisa informar a cada pedido.
 */
export const TempoDePreparoLoja = () => {
    const { currentStore } = useStore();
    const [min, setMin] = useState<number>(20);
    const [salvo, setSalvo] = useState(false);
    const [erro, setErro] = useState('');

    useEffect(() => { if (typeof currentStore?.tempo_preparo_min === 'number') setMin(currentStore.tempo_preparo_min); }, [currentStore?.tempo_preparo_min]);

    // Só aparece onde faz sentido (e se o SQL 18 já rodou, a loja traz o campo)
    if (!currentStore || currentStore.modelo !== 'comissao' || currentStore.tempo_preparo_min === undefined) return null;

    const salvar = async () => {
        setErro(''); setSalvo(false);
        const v = Math.round(Number(min));
        if (!(v >= 1 && v <= 180)) { setErro('Informe de 1 a 180 minutos.'); return; }
        const { error } = await supabase.from('stores').update({ tempo_preparo_min: v }).eq('id', currentStore.id);
        if (error) { setErro('Não foi possível salvar agora. Tente de novo.'); return; }
        setSalvo(true); setTimeout(() => setSalvo(false), 2500);
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Tempo médio de preparo</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Quanto tempo, em média, o seu pedido leva para ficar pronto. O Pede Aki usa isso para avisar o motoboy com antecedência. Você não precisa informar a cada pedido.</p>
            <div className="mt-3 flex items-center gap-3">
                <input type="number" min={1} max={180} value={min} onChange={e => setMin(Number(e.target.value))} className="w-24 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-2 text-gray-900 dark:text-gray-100" />
                <span className="text-sm text-gray-600 dark:text-gray-300">minutos</span>
                <button type="button" onClick={salvar} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500">Salvar</button>
                {salvo && <span className="text-sm font-semibold text-green-600">Salvo</span>}
            </div>
            {erro && <p className="mt-2 text-sm font-semibold text-red-600">{erro}</p>}
        </div>
    );
};
