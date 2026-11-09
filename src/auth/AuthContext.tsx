import { comTempo } from '../utils/comTempo';
import React, { useState, useEffect, createContext, useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../services/supabaseService';
import type { Session } from '@supabase/supabase-js';

interface AuthContextType {
  session: Session | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
        setLoading(false);
        return;
    }
    // O cliente do Supabase foi criado com detectSessionInUrl desligado (Electron usa # para rotas).
    // Os links de e-mail (redefinir senha, confirmar cadastro) trazem a sessão no #access_token,
    // então é aqui que ela é lida. Sem isso o link sempre parecia "vencido".
    const iniciar = async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const access = hash.get('access_token');
      const refresh = hash.get('refresh_token');
      if (access && refresh) {
        await supabase.auth.setSession({ access_token: access, refresh_token: refresh }).catch(() => {});
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      // Sem internet, ler a sessao pode ficar pendurado (o token vencido tenta renovar pela rede). Com limite de tempo a tela
      // sai do "Carregando", e quando a internet volta a sessao e lida de novo.
      try {
        const { data: { session } } = await comTempo(supabase.auth.getSession(), 8000, 'sessao demorou');
        setSession(session);
      } catch (e) {
        console.warn('[auth] nao foi possivel ler a sessao agora:', e);
      } finally {
        setLoading(false);
      }
    };
    iniciar();
    const aoVoltarInternet = () => { iniciar(); };
    window.addEventListener('online', aoVoltarInternet);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => { subscription.unsubscribe(); window.removeEventListener('online', aoVoltarInternet); };
  }, []);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
};

export const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { session, loading } = useAuth();
    const location = useLocation();

    if (loading) return <div className="flex items-center justify-center h-screen bg-background"><div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>;
    if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
    return <>{children}</>;
};