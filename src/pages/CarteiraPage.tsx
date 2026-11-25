import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { fetchMinhaLoja } from '../services/supabaseService';
import { CarteiraPainel } from '../components/CarteiraPainel';
import type { Store } from '../types';

/** Carteira do lojista de comissão (botão "Carteira" do painel). Sem login, passa pelo /entrar e volta. */
const CarteiraPage = () => {
    const { session, loading } = useAuth();
    const [loja, setLoja] = useState<Store | null | undefined>(undefined);

    useEffect(() => {
        if (!session) return;
        fetchMinhaLoja(session.user.id).then(setLoja).catch(() => setLoja(null));
    }, [session?.user?.id]);

    if (loading) return <div className="min-h-screen bg-[#F3F3F1]" />;
    if (!session) return <Navigate to="/entrar" state={{ from: { pathname: '/carteira' } }} replace />;

    return (
        <div className="min-h-screen bg-[#F3F3F1] text-gray-900" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>
            <header className="sticky top-0 z-10 bg-[#F26B1D] px-4 py-3 text-[#1F1F1F]">
                <div className="mx-auto flex max-w-md items-center gap-3">
                    {loja?.slug
                        ? <Link to={`/${loja.slug}/admin`} aria-label="Voltar ao painel" className="rounded-full bg-white/80 p-2"><ArrowLeft size={18} /></Link>
                        : <span className="w-9" />}
                    <div>
                        <p className="text-lg font-bold leading-tight">Carteira</p>
                        {loja && <p className="text-xs">{loja.name}</p>}
                    </div>
                </div>
            </header>
            <main className="mx-auto max-w-md p-4">
                {loja === undefined && <p className="text-sm text-gray-600">Carregando...</p>}
                {loja === null && <p className="rounded-lg bg-white p-4 text-sm text-gray-700">Não achamos a sua loja neste login.</p>}
                {loja && loja.modelo !== 'comissao' && <p className="rounded-lg bg-white p-4 text-sm text-gray-700">A carteira é para as lojas que vendem pelo app do Pede Aki (comissão).</p>}
                {loja && loja.modelo === 'comissao' && (
                    <CarteiraPainel tipo="loja" quem={{ dono: 'loja', store_id: loja.id, authToken: session.access_token }} />
                )}
            </main>
        </div>
    );
};

export default CarteiraPage;
