import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '../../services/supabaseService';
import { usePlataforma } from './dados';

/**
 * QR Code dinamico (SQL 21). O QR impresso leva ao link curto /q/CODIGO; o destino fica no banco e pode ser trocado
 * sem reimprimir. Dois tipos: loja do Pede Aki (guarda a loja, nao o endereco) e URL personalizada. Tambem da para
 * criar sem destino (placa impressa antes da venda) e gerar em lote (Mesa 1 a Mesa 20, com {n} na URL).
 */
type Tipo = 'loja' | 'url' | 'vazio';
interface Qr { id: string; codigo: string; nome: string; tipo: Tipo; store_id: string | null; url: string | null; ativo: boolean; lote: string | null; leituras: number; ultima_leitura: string | null; criado_em: string }

const QR_BASE = (import.meta as any).env?.VITE_QR_BASE || 'https://pedeaki.tecx.pro';
const linkDo = (codigo: string) => `${QR_BASE}/q/${codigo}`;
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // sem 0, 1, I, L, O (confundem na impressao)
const novoCodigo = () => { const b = new Uint8Array(6); crypto.getRandomValues(b); return Array.from(b, x => ALFABETO[x % ALFABETO.length]).join(''); };
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const opcoesQr = { errorCorrectionLevel: 'M' as const, margin: 2 };
const urlValida = (u: string) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
const baixar = (href: string, nome: string) => { const a = document.createElement('a'); a.href = href; a.download = nome; a.click(); };
const arquivo = (t: string) => t.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'qr';

const campo = 'w-full rounded-lg bg-gray-700 border border-gray-600 p-2 text-white';
const botao = 'rounded-lg px-3 py-1.5 text-sm font-bold';

export const QrSecao: React.FC = () => {
    const d = usePlataforma();
    const [qrs, setQrs] = useState<Qr[] | null | undefined>(undefined);
    const [filtro, setFiltro] = useState('');
    const [marcados, setMarcados] = useState<Set<string>>(new Set());
    const [novo, setNovo] = useState(false);
    const [ver, setVer] = useState<Qr | null>(null);
    const [editar, setEditar] = useState<Qr | null>(null);

    const carregar = async () => {
        const { data, error } = await supabase.from('qr_codes').select('*').order('criado_em', { ascending: false }).limit(1000);
        if (error) { setQrs(null); return; }
        setQrs((data || []) as Qr[]);
    };
    useEffect(() => { void carregar(); }, []);

    const lojas = useMemo(() => d.stores.filter(s => s.is_active !== false).sort((a, b) => a.name.localeCompare(b.name)), [d.stores]);
    const nomeLoja = (id: string | null) => lojas.find(s => s.id === id)?.name || d.stores.find(s => s.id === id)?.name || '(loja removida)';
    const visiveis = useMemo(() => {
        const t = filtro.trim().toLowerCase();
        return (qrs || []).filter(q => !t || `${q.nome} ${q.codigo} ${q.url || ''} ${q.store_id ? nomeLoja(q.store_id) : ''}`.toLowerCase().includes(t));
    }, [qrs, filtro, d.stores]);

    if (qrs === undefined) return <p className="text-gray-400">Carregando...</p>;
    if (qrs === null) return <div className="rounded-xl border border-yellow-700 bg-gray-800 p-4 text-sm text-yellow-300">QR Codes: rode o SQL 21 no Supabase para liberar esta seção.</div>;

    const destinoTexto = (q: Qr) => q.tipo === 'loja' ? `Loja: ${nomeLoja(q.store_id)}` : q.tipo === 'url' ? (q.url || '') : 'Sem destino ainda';
    const alternar = (id: string) => setMarcados(m => { const n = new Set(m); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const pausar = async (q: Qr) => { const { error } = await supabase.from('qr_codes').update({ ativo: !q.ativo }).eq('id', q.id); if (error) alert(error.message); else void carregar(); };
    const excluir = async (q: Qr) => {
        if (!confirm(`Excluir o QR "${q.nome}" (${q.codigo})? Quem ler a placa impressa verá uma página de QR inexistente. Para só desligar, use Pausar.`)) return;
        const { error } = await supabase.from('qr_codes').delete().eq('id', q.id); if (error) alert(error.message); else { setMarcados(m => { const n = new Set(m); n.delete(q.id); return n; }); void carregar(); }
    };

    // Folha de impressao: uma janela com todos os QRs escolhidos (ou os filtrados), nome embaixo de cada um
    const imprimir = async () => {
        const lista = marcados.size > 0 ? (qrs || []).filter(q => marcados.has(q.id)) : visiveis;
        if (lista.length === 0) return alert('Não há QR para imprimir.');
        if (lista.length > 120 && !confirm(`Vão ${lista.length} QRs na folha. Continuar?`)) return;
        const w = window.open('', '_blank');
        if (!w) return alert('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.');
        const cel = await Promise.all(lista.map(async q => `<div class="c">${await QRCode.toString(linkDo(q.codigo), { ...opcoesQr, type: 'svg' })}<div class="n">${esc(q.nome)}</div><div class="k">${q.codigo}</div></div>`));
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR Codes</title><style>
            body{font-family:system-ui,sans-serif;margin:12mm}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm}
            .c{break-inside:avoid;text-align:center;border:1px dashed #bbb;padding:4mm}.c svg{width:100%;height:auto}
            .n{font-weight:700;font-size:14pt;margin-top:2mm}.k{font-size:9pt;color:#666}
            @media print{body{margin:6mm}}</style></head><body><div class="g">${cel.join('')}</div><script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
        w.document.close();
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold text-white">QR Codes</h1>
                    <p className="text-sm text-gray-400 mt-1">O QR impresso leva a um link curto nosso. O destino você troca aqui quando quiser, sem reimprimir. {qrs.length} QR{qrs.length === 1 ? '' : 's'} criado{qrs.length === 1 ? '' : 's'}.</p>
                </div>
                <button onClick={() => setNovo(true)} className={`${botao} bg-blue-600 text-white hover:bg-blue-500`}>Novo QR</button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar por nome, código, loja ou endereço" className={`${campo} max-w-sm`} />
                <button onClick={() => setMarcados(new Set(visiveis.map(q => q.id)))} className={`${botao} bg-gray-700 text-gray-200`}>Marcar os da lista</button>
                {marcados.size > 0 && <button onClick={() => setMarcados(new Set())} className={`${botao} bg-gray-700 text-gray-200`}>Limpar ({marcados.size})</button>}
                <button onClick={imprimir} className={`${botao} bg-orange-600 text-white hover:bg-orange-500`}>Imprimir folha {marcados.size > 0 ? `(${marcados.size})` : '(da lista)'}</button>
            </div>

            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-700 text-gray-300 uppercase text-xs"><tr><th className="p-3 w-8"></th><th className="p-3">Nome</th><th className="p-3">Destino</th><th className="p-3">Leituras</th><th className="p-3">Situação</th><th className="p-3 text-right">Ações</th></tr></thead>
                    <tbody className="divide-y divide-gray-700">
                        {visiveis.length === 0 && <tr><td colSpan={6} className="p-4 text-gray-400">{qrs.length === 0 ? 'Nenhum QR ainda. Clique em Novo QR.' : 'Nada encontrado.'}</td></tr>}
                        {visiveis.map(q => (
                            <tr key={q.id}>
                                <td className="p-3"><input type="checkbox" checked={marcados.has(q.id)} onChange={() => alternar(q.id)} className="h-4 w-4" /></td>
                                <td className="p-3 font-bold text-white">{q.nome}<span className="block text-xs font-mono font-normal text-gray-400">{q.codigo}</span></td>
                                <td className="p-3 text-gray-300 max-w-xs truncate" title={destinoTexto(q)}>{destinoTexto(q)}</td>
                                <td className="p-3 text-gray-300">{q.leituras}{q.ultima_leitura && <span className="block text-xs text-gray-500">última {new Date(q.ultima_leitura).toLocaleDateString('pt-BR')}</span>}</td>
                                <td className="p-3">{!q.ativo ? <span className="rounded px-2 py-1 text-xs font-bold bg-red-900 text-red-200">pausado</span> : q.tipo === 'vazio' ? <span className="rounded px-2 py-1 text-xs font-bold bg-yellow-900 text-yellow-200">sem destino</span> : <span className="rounded px-2 py-1 text-xs font-bold bg-green-900 text-green-200">ativo</span>}</td>
                                <td className="p-3 text-right whitespace-nowrap space-x-1">
                                    <button onClick={() => setVer(q)} className={`${botao} bg-gray-700 text-gray-100`}>QR</button>
                                    <button onClick={() => setEditar(q)} className={`${botao} bg-gray-700 text-gray-100`}>Destino</button>
                                    <button onClick={() => pausar(q)} className={`${botao} bg-gray-700 text-gray-100`}>{q.ativo ? 'Pausar' : 'Ativar'}</button>
                                    <button onClick={() => excluir(q)} className={`${botao} bg-red-900 text-red-100`}>Excluir</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {novo && <NovoQr lojas={lojas} onFechar={() => setNovo(false)} onCriou={() => { setNovo(false); void carregar(); }} />}
            {ver && <VerQr qr={ver} destino={destinoTexto(ver)} onFechar={() => setVer(null)} />}
            {editar && <EditarQr qr={editar} lojas={lojas} onFechar={() => setEditar(null)} onSalvou={() => { setEditar(null); void carregar(); }} />}
        </div>
    );
};

const Janela: React.FC<{ titulo: string; onFechar: () => void; children: React.ReactNode }> = ({ titulo, onFechar, children }) => (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onFechar}>
        <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-800 p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-white">{titulo}</h2><button onClick={onFechar} className="text-gray-400 text-xl leading-none">×</button></div>
            {children}
        </div>
    </div>
);

/** Escolha do destino: loja da lista (com busca), URL personalizada ou sem destino. */
const SeletorDestino: React.FC<{ lojas: { id: string; name: string }[]; tipo: Tipo; setTipo: (t: Tipo) => void; storeId: string; setStoreId: (v: string) => void; url: string; setUrl: (v: string) => void; dicaLote?: boolean }> = ({ lojas, tipo, setTipo, storeId, setStoreId, url, setUrl, dicaLote }) => {
    const [busca, setBusca] = useState('');
    const filtradas = lojas.filter(l => l.name.toLowerCase().includes(busca.trim().toLowerCase()));
    return (
        <div className="space-y-2">
            <label className="block text-sm text-gray-300">Destino
                <select value={tipo} onChange={e => setTipo(e.target.value as Tipo)} className={campo}>
                    <option value="loja">Loja do Pede Aki</option>
                    <option value="url">URL personalizada</option>
                    <option value="vazio">Sem destino ainda (ligar depois)</option>
                </select>
            </label>
            {tipo === 'loja' && (
                <>
                    <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar loja..." className={campo} />
                    <select value={storeId} onChange={e => setStoreId(e.target.value)} size={Math.min(6, Math.max(3, filtradas.length))} className={campo}>
                        {filtradas.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                </>
            )}
            {tipo === 'url' && (
                <label className="block text-sm text-gray-300">Endereço (começa com https://)
                    <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className={campo} />
                    {dicaLote && <span className="block text-xs text-gray-400 mt-1">Em lote, escreva {'{n}'} onde vai o número. Exemplo: https://restaurante.com/cardapio?mesa={'{n}'}</span>}
                </label>
            )}
        </div>
    );
};

const NovoQr: React.FC<{ lojas: { id: string; name: string }[]; onFechar: () => void; onCriou: () => void }> = ({ lojas, onFechar, onCriou }) => {
    const [nome, setNome] = useState('');
    const [tipo, setTipo] = useState<Tipo>('loja');
    const [storeId, setStoreId] = useState('');
    const [url, setUrl] = useState('');
    const [lote, setLote] = useState(false);
    const [de, setDe] = useState(1);
    const [ate, setAte] = useState(20);
    const [salvando, setSalvando] = useState(false);

    const criar = async () => {
        if (!nome.trim()) return alert('Dê um nome ao QR (por exemplo, "Mesa" ou "Instagram da Casa do Luiz").');
        if (tipo === 'loja' && !storeId) return alert('Escolha a loja.');
        const nums: (number | null)[] = lote ? Array.from({ length: Math.max(0, ate - de + 1) }, (_, i) => de + i) : [null];
        if (lote && (de < 0 || nums.length === 0 || nums.length > 200)) return alert('Informe um intervalo de 1 a 200 QRs (de menor para maior).');
        if (tipo === 'url') {
            if (!lote && url.includes('{n}')) return alert('Tire o {n} do endereço ou marque "Gerar vários".');
            if (!urlValida(url.split('{n}').join('1'))) return alert('Endereço inválido. Ele precisa começar com http:// ou https://.');
        }
        const loteId = lote ? `${nome.trim()} ${Date.now().toString(36)}` : null;
        setSalvando(true);
        for (let tentativa = 0; tentativa < 4; tentativa++) {
            const usados = new Set<string>();
            const linhas = nums.map(n => {
                let codigo = novoCodigo(); while (usados.has(codigo)) codigo = novoCodigo(); usados.add(codigo);
                return {
                    codigo, nome: n === null ? nome.trim() : `${nome.trim()} ${n}`, tipo,
                    store_id: tipo === 'loja' ? storeId : null,
                    url: tipo === 'url' ? url.trim().split('{n}').join(String(n ?? '')) : null,
                    lote: loteId,
                };
            });
            const { error } = await supabase.from('qr_codes').insert(linhas);
            if (!error) { setSalvando(false); onCriou(); return; }
            if (error.code !== '23505') { setSalvando(false); return alert(`Erro ao criar: ${error.message}`); }
        }
        setSalvando(false); alert('Não consegui gerar códigos únicos. Tente de novo.');
    };

    return (
        <Janela titulo="Novo QR Code" onFechar={onFechar}>
            <label className="block text-sm text-gray-300">Nome interno
                <input value={nome} onChange={e => setNome(e.target.value)} placeholder={lote ? 'Mesa' : 'Instagram da Casa do Luiz'} className={campo} />
            </label>
            <SeletorDestino lojas={lojas} tipo={tipo} setTipo={setTipo} storeId={storeId} setStoreId={setStoreId} url={url} setUrl={setUrl} dicaLote={lote} />
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer"><input type="checkbox" checked={lote} onChange={e => setLote(e.target.checked)} className="h-4 w-4" />Gerar vários (lote numerado)</label>
            {lote && (
                <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-gray-400">Do número<input type="number" min={0} value={de} onChange={e => setDe(Math.floor(Number(e.target.value) || 0))} className={campo} /></label>
                    <label className="text-xs text-gray-400">Até o número<input type="number" min={0} value={ate} onChange={e => setAte(Math.floor(Number(e.target.value) || 0))} className={campo} /></label>
                    <p className="col-span-2 text-xs text-gray-400">Vão ser criados os QRs "{nome.trim() || 'Nome'} {de}" até "{nome.trim() || 'Nome'} {ate}".</p>
                </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
                <button onClick={onFechar} className={`${botao} bg-gray-700 text-gray-100`}>Cancelar</button>
                <button onClick={criar} disabled={salvando} className={`${botao} bg-blue-600 text-white disabled:opacity-50`}>{salvando ? 'Criando...' : 'Criar'}</button>
            </div>
        </Janela>
    );
};

const EditarQr: React.FC<{ qr: Qr; lojas: { id: string; name: string }[]; onFechar: () => void; onSalvou: () => void }> = ({ qr, lojas, onFechar, onSalvou }) => {
    const [nome, setNome] = useState(qr.nome);
    const [tipo, setTipo] = useState<Tipo>(qr.tipo);
    const [storeId, setStoreId] = useState(qr.store_id || '');
    const [url, setUrl] = useState(qr.url || '');
    const salvar = async () => {
        if (!nome.trim()) return alert('O nome não pode ficar vazio.');
        if (tipo === 'loja' && !storeId) return alert('Escolha a loja.');
        if (tipo === 'url' && !urlValida(url.trim())) return alert('Endereço inválido. Ele precisa começar com http:// ou https://.');
        const { error } = await supabase.from('qr_codes').update({ nome: nome.trim(), tipo, store_id: tipo === 'loja' ? storeId : null, url: tipo === 'url' ? url.trim() : null }).eq('id', qr.id);
        if (error) alert(error.message); else onSalvou();
    };
    return (
        <Janela titulo={`Destino de ${qr.codigo}`} onFechar={onFechar}>
            <label className="block text-sm text-gray-300">Nome interno<input value={nome} onChange={e => setNome(e.target.value)} className={campo} /></label>
            <SeletorDestino lojas={lojas} tipo={tipo} setTipo={setTipo} storeId={storeId} setStoreId={setStoreId} url={url} setUrl={setUrl} />
            <p className="text-xs text-gray-400">O QR impresso não muda: só o destino que ele abre.</p>
            <div className="flex justify-end gap-2 pt-2">
                <button onClick={onFechar} className={`${botao} bg-gray-700 text-gray-100`}>Cancelar</button>
                <button onClick={salvar} className={`${botao} bg-blue-600 text-white`}>Salvar</button>
            </div>
        </Janela>
    );
};

const VerQr: React.FC<{ qr: Qr; destino: string; onFechar: () => void }> = ({ qr, destino, onFechar }) => {
    const [svg, setSvg] = useState('');
    const [copiado, setCopiado] = useState(false);
    useEffect(() => { void QRCode.toString(linkDo(qr.codigo), { ...opcoesQr, type: 'svg' }).then(setSvg); }, [qr.codigo]);
    const png = async () => baixar(await QRCode.toDataURL(linkDo(qr.codigo), { ...opcoesQr, width: 1024 }), `qr-${arquivo(qr.nome)}-${qr.codigo}.png`);
    const vetor = () => { const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); baixar(url, `qr-${arquivo(qr.nome)}-${qr.codigo}.svg`); setTimeout(() => URL.revokeObjectURL(url), 2000); };
    const copiar = async () => { try { await navigator.clipboard.writeText(linkDo(qr.codigo)); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* o link aparece na tela */ } };
    return (
        <Janela titulo={qr.nome} onFechar={onFechar}>
            <div className="mx-auto w-64 bg-white p-2 rounded-lg" dangerouslySetInnerHTML={{ __html: svg }} />
            <p className="text-center text-sm text-gray-300 break-all select-all">{linkDo(qr.codigo)}</p>
            <p className="text-center text-xs text-gray-400">Leva a: {destino}</p>
            <div className="flex flex-wrap justify-center gap-2">
                <button onClick={png} className={`${botao} bg-blue-600 text-white`}>Baixar PNG</button>
                <button onClick={vetor} className={`${botao} bg-gray-700 text-gray-100`}>Baixar SVG</button>
                <button onClick={copiar} className={`${botao} bg-gray-700 text-gray-100`}>{copiado ? 'Link copiado' : 'Copiar link (para a tag NFC)'}</button>
            </div>
        </Janela>
    );
};
