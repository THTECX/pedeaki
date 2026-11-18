import { supabase } from './supabaseService';

/** Vagas, preços e descontos do impulso da vitrine (SQL 20). Quem edita é o Super Admin. */
export interface ImpulsoVagas {
    ativo: boolean; vagas: number; ocupadas: number; livres: number; proxima_vaga: string | null;
    preco_dia: number; desc_7: number; desc_15: number; desc_30: number;
}

/** Devolve null se o SQL 20 ainda não rodou (a vitrine então não oferece a compra). */
export const fetchImpulsoVagas = async (): Promise<ImpulsoVagas | null> => {
    const { data, error } = await supabase.rpc('impulso_vagas');
    if (error || !data) return null;
    return data as ImpulsoVagas;
};

/** Mesma conta do banco (impulso_criar), só para mostrar o total na tela. Quem cobra é o servidor. */
export const descontoDoImpulso = (c: Pick<ImpulsoVagas, 'desc_7' | 'desc_15' | 'desc_30'>, dias: number) =>
    dias >= 30 ? c.desc_30 : dias >= 15 ? c.desc_15 : dias >= 7 ? c.desc_7 : 0;
export const valorDoImpulso = (c: Pick<ImpulsoVagas, 'preco_dia' | 'desc_7' | 'desc_15' | 'desc_30'>, dias: number) =>
    Math.round(dias * c.preco_dia * (1 - descontoDoImpulso(c, dias) / 100) * 100) / 100;
