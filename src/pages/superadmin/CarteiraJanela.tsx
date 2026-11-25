import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseService';
import { CarteiraPainel } from '../../components/CarteiraPainel';
import { Janela } from './Janela';

/**
 * Carteira de uma loja ou de um motoboy aberta pelo Super Admin: o Ikarus pode criar no lugar do dono (com os documentos
 * em mãos) ou só acompanhar em que pé está. O e-mail de ativação do Asaas vai sempre para o e-mail do dono.
 */
export const CarteiraJanela: React.FC<{ titulo: string; tipo: 'loja' | 'motoboy'; id: string; onFechar: () => void }> = ({ titulo, tipo, id, onFechar }) => {
    const [token, setToken] = useState<string | null>(null);
    useEffect(() => { supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token || '')); }, []);
    return (
        <Janela titulo={titulo} onFechar={onFechar}>
            <div className="rounded-xl bg-[#F3F3F1] p-3">
                {token === null && <p className="text-sm text-gray-600">Carregando...</p>}
                {token === '' && <p className="text-sm text-red-700">Sessão expirada. Entre de novo.</p>}
                {token && (tipo === 'loja'
                    ? <CarteiraPainel porAdmin tipo="loja" quem={{ dono: 'loja', store_id: id, authToken: token }} />
                    : <CarteiraPainel porAdmin tipo="motoboy" quem={{ dono: 'motoboy', motoboy_id: id, authToken: token }} />)}
            </div>
        </Janela>
    );
};
