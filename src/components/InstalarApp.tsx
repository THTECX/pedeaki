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
const lerFechado = () => { try { return Number(localStorage.getItem(CHAVE_FECHADO) || 0) > Date.now() - 7 * 86400000; } catch { return false; } };

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

    return (
        <div className={`mx-4 rounded-xl border p-3 ${caixa}`}>
            <div className="flex items-start gap-3">
                <img src="/pwa-192x192.png" alt="" className="h-11 w-11 shrink-0 rounded-lg bg-black object-cover" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-tight">Instale o Pede Aki no seu celular</p>
                    <p className={`text-xs leading-tight mt-0.5 ${suave}`}>Abre direto da tela inicial, sem digitar o endereço.</p>
                </div>
                {comFechar && <button onClick={fechar} aria-label="Fechar" className={`text-lg leading-none ${suave}`}>×</button>}
            </div>
            {dentroDeApp ? (
                <p className="mt-2 text-xs font-semibold text-orange-500">Você está dentro de outro aplicativo (WhatsApp, Instagram...). Abra este endereço no Chrome ou no Safari para instalar: toque nos três pontinhos e escolha "Abrir no navegador".</p>
            ) : ehIOS() ? (
                <p className={`mt-2 text-xs ${suave}`}>No iPhone: abra no Safari, toque no botão de compartilhar (o quadrado com a seta) e escolha "Adicionar à Tela de Início".</p>
            ) : (
                <>
                    <button onClick={instalar} className="mt-2 w-full rounded-lg bg-[#F26B1D] py-2 text-sm font-bold text-[#1F1F1F] active:scale-95">Instalar agora</button>
                    {passos && (
                        <p className={`mt-2 text-xs ${suave}`}>Seu navegador não abriu a janela de instalar. Toque nos três pontinhos do Chrome (canto de cima) e escolha "Instalar app" ou "Adicionar à tela inicial". Se aparecer só "Adicionar atalho", feche o Chrome por completo, abra de novo este endereço e espere uns segundos.</p>
                    )}
                </>
            )}
        </div>
    );
};
