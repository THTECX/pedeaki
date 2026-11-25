import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchStoreBySlug } from '../services/supabaseService';
import { Store } from '../types';
import { definirNomeDaLoja, MARCA } from '../services/marcaService';
import { aplicarIdentidade, carregarMarca, useMarca } from '../services/marcaPlataforma';

interface StoreContextType {
    currentStore: Store | null;
    loading: boolean;
    error: string | null;
    refreshStore: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType>({
    currentStore: null,
    loading: true,
    error: null,
    refreshStore: async () => { },
});

export const useStore = () => useContext(StoreContext);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentStore, setCurrentStore] = useState<Store | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [slugDaRota, setSlugDaRota] = useState<string | null>(null);

    const location = useLocation();

    const fetchStore = async () => {
        let slug: string | null = null;

        // console.log("StoreContext: Starting fetchStore logic. Hostname:", window.location.hostname);

        // 1. Try to get slug from Subdomain
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const parts = hostname.split('.');

        // O programa instalado (file://) e o localhost não têm loja fixa: a loja vem do endereço (/loja/admin)
        // ou, no login geral, da conta do usuário. Para testar localmente numa loja só: VITE_LOJA_DEV=slug.
        if (protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1') {
            slug = ((import.meta as any).env?.VITE_LOJA_DEV as string) || null;
        }

        // Logic: 
        // localhost:3000 -> ['localhost'] (len 1) -> No subdomain
        // sub.localhost:3000 -> ['sub', 'localhost'] (len 2) -> Subdomain 'sub'
        // domain.com -> ['domain', 'com'] (len 2) -> No subdomain
        // sub.domain.com -> ['sub', 'domain', 'com'] (len 3) -> Subdomain 'sub'

        const isLocalhost = hostname.includes('localhost');
        const minParts = isLocalhost ? 2 : 3;

        // Domínios compartilhados (ex.: projeto.vercel.app) não têm loja no subdomínio.
        // O endereço da própria plataforma (ex.: pedeaki.tecx.pro) também não é uma loja.
        // Padrão: MARCA.site. A variável VITE_DOMINIO_PLATAFORMA só é preciso se o endereço mudar.
        const dominioPlataforma = ((import.meta as any).env?.VITE_DOMINIO_PLATAFORMA || MARCA.site).toLowerCase();
        const dominioCompartilhado = hostname.endsWith('.vercel.app') || hostname.endsWith('.web.app') || hostname.endsWith('.netlify.app')
            || (!!dominioPlataforma && hostname.toLowerCase() === dominioPlataforma);
        if (parts.length >= minParts && parts[0] !== 'www' && !dominioCompartilhado) {
            slug = parts[0];
            // console.log("StoreContext: Identified slug from subdomain:", slug);
        }

        // Link por loja: /<slug>, /<slug>/admin... A rota global (/admin, /login, /super-admin...)
        // não é loja. O caminho vale mais que o subdomínio e que o padrão do Electron/localhost.
        const rotasGlobais = ['admin', 'login', 'super-admin', 'staff', 'acesso', 'hub-equipe', 'portal-equipe', 'garcom', 'waiter', 'entregador', 'tv', 'cadastro', 'shopping', 'vitrine', 'perfil', 'motoboy', 'impulsionar', 'carteira', 'q', 'redefinir_senha', 'termos', 'privacidade', 'entrar'];
        const primeiroSegmento = location.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
        if (primeiroSegmento && !rotasGlobais.includes(primeiroSegmento)) {
            slug = primeiroSegmento;
        }

        // QUICK EXIT FOR STAFF ROUTES - No loading, no fetching, instantly clean.
        // We only do this if there is NO subdomain slug. If there IS a subdomain, we want to load the store context even on /admin.
        const reservedPaths = ['/admin', '/login', '/cadastro', '/shopping', '/vitrine', '/perfil', '/motoboy', '/redefinir_senha', '/termos', '/privacidade', '/entrar', '/super-admin', '/staff', '/acesso', '/hub-equipe', '/portal-equipe', '/garcom', '/entregador'];
        const isReserved = reservedPaths.some(p => location.pathname.toLowerCase().startsWith(p)) && !slug;
        // Em tela da plataforma (sem loja na rota) a identidade da aba é a do Pede Aki, mesmo que uma loja tenha sido vista antes.
        setSlugDaRota(isReserved || !slug ? null : slug);

        if (isReserved) {
            // console.log("StoreContext: Reserved path detected without subdomain, skipping store fetch.");
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        if (!slug) {
            // No store identified. 
            console.warn("StoreContext: No slug found.");
            // Sem loja na rota (ex.: voltou da loja para a vitrine): esquece a loja anterior, senao a raiz
            // continuaria mostrando a pagina dela com o endereco do Pede Aki.
            setCurrentStore(null);
            setLoading(false);
            return;
        }

        try {
            // console.log("StoreContext: Fetching store by slug:", slug);

            const store = await fetchStoreBySlug(slug);

            if (!store) {
                console.error("Store not found for slug:", slug);
                setError("Loja não encontrada");
                setCurrentStore(null);
            } else {
                // console.log("StoreContext: Store found:", store.name);
                setCurrentStore(store);
                definirNomeDaLoja(store.name);
            }
        } catch (err) {
            console.error("Unexpected error:", err);
            setError("Erro ao carregar loja");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStore();
    }, [location.pathname]);

    // Marca da plataforma (logo e cores definidas no Super Admin): carrega uma vez e refaz a identidade quando mudar.
    const marca = useMarca();
    useEffect(() => { carregarMarca(); }, []);

    // Ícone da aba, título, cor do navegador e manifesto do app instalado: loja atual ou, sem loja, a marca do Pede Aki.
    useEffect(() => {
        aplicarIdentidade(slugDaRota && currentStore && currentStore.slug === slugDaRota ? currentStore : null);
    }, [currentStore, slugDaRota, marca]);

    return (
        <StoreContext.Provider value={{ currentStore, loading, error, refreshStore: fetchStore }}>
            {children}
        </StoreContext.Provider>
    );
};
