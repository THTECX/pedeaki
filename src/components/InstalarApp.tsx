import { useEffect, useState } from 'react';

/**
 * Convite para instalar o Pede Aki na tela inicial. O Chrome so oferece "Instalar" quando acha que o site e um aplicativo,
 * e muita gente nunca acha o menu: por isso o botao fica visivel. No iPhone nao existe botao de instalar (so pelo menu
 * Compartilhar do Safari) e dentro do WhatsApp/Instagram nao da para instalar: o cartao explica cada caso.
 */
let eventoDeInstalacao: any = null;
const ouvintes = new Set<() => void>();
if (typeof window !== 'undefined') {
    // guarda o evento assim que o navegador o dispara, mesmo antes de a tela montar
    window.addEventListener('beforeinstallprompt', (e: any) => { e.preventDefault(); eventoDeInstalacao = e; ouvintes.forEach(f => f()); });
    window.addEventListener('appinstalled', () => { eventoDeInstalacao = null; ouvintes.forEach(f => f()); });
}

const jaInstalado = () => {
    try { return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true; } catch { return false; }
};
const navegadorDentroDeApp = () => /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok|MicroMessenger/i.test(navigator.userAgent);
const ehIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);

const CHAVE_FECHADO = 'pedeaki_instalar_fechado';
const lerFechado = () => { try { return Number(localStorage.getItem(CHAVE_FECHADO) || 0) > Date.now() - 2 * 86400000; } catch { return false; } };

export const InstalarApp = ({ escuro = false, comFechar = true }: { escuro?: boolean; comFechar?: boolean }) => {
    const [, forcar] = useState(0);
    const [fechado, setFechado] = useState(lerFechado());
    const [passos, setPassos] = useState(false);
    useEffect(() => { const f = () => forcar(x => x + 1); ouvintes.add(f); return () => { ouvintes.delete(f); }; }, []);

    if (jaInstalado() || fechado) return null;

    const instalar = async () => {
        if (!eventoDeInstalacao) { setPassos(true); return; }
        eventoDeInstalacao.prompt();
        try { await eventoDeInstalacao.userChoice; } catch { /* escolha cancelada */ }
        eventoDeInstalacao = null; forcar(x => x + 1);
    };
    const fechar = () => { try { localStorage.setItem(CHAVE_FECHADO, String(Date.now())); } catch { /* tudo bem */ } setFechado(true); };

    const caixa = escuro ? 'bg-[#1E1A24] border-[#2E2836] text-white' : 'bg-white border-gray-200 text-[#1A1A1A]';
    const suave = escuro ? 'text-gray-400' : 'text-gray-600';
    const dentroDeApp = navegadorDentroDeApp();
    const ios = ehIOS();

    return (
        <div className={`mx-4 rounded-xl border px-3 py-2 ${caixa}`}>
            <div className="flex items-center gap-2.5">
                <img src="/pwa-192x192.png" alt="" className="h-8 w-8 shrink-0 rounded-md bg-black object-cover" />
                <p className="min-w-0 flex-1 text-[13px] font-bold leading-tight">Instale o app do Pede Aki no seu celular</p>
                {!dentroDeApp && !ios && (
                    <button onClick={instalar} className="shrink-0 rounded-md bg-[#F26B1D] px-3 py-1.5 text-xs font-bold text-[#1F1F1F] active:scale-95">Instalar</button>
                )}
                {comFechar && <button onClick={fechar} aria-label="Fechar" className={`shrink-0 px-1 text-xl leading-none ${suave}`}>×</button>}
            </div>
            {dentroDeApp ? (
                <p className="mt-1.5 text-[11px] font-semibold leading-snug text-orange-500">Você está dentro de outro aplicativo. Abra este endereço no Chrome ou no Safari (três pontinhos, "Abrir no navegador") para instalar.</p>
            ) : ios ? (
                <p className={`mt-1.5 text-[11px] leading-snug ${suave}`}>No iPhone, no Safari: toque em compartilhar (quadrado com seta) e em "Adicionar à Tela de Início".</p>
            ) : passos ? (
                <p className={`mt-1.5 text-[11px] leading-snug ${suave}`}>O navegador não abriu a janela. Toque nos três pontinhos do Chrome e escolha "Instalar app" ou "Adicionar à tela inicial".</p>
            ) : null}
        </div>
    );
};
