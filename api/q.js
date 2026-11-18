/**
 * Redireciona o QR Code dinamico: /q/CODIGO (reescrito pela Vercel para /api/q?c=CODIGO).
 * Pergunta ao banco para onde o codigo aponta hoje (funcao qr_resolver, que tambem conta a leitura) e responde 302.
 * QR vazio, pausado ou inexistente mostra uma pagina simples do Pede Aki, nunca um erro seco.
 */
const pagina = (titulo, texto, status) => ({
    status,
    html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head>` +
        `<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#110E15;color:#F7EFE4;font-family:system-ui,sans-serif;text-align:center;padding:24px">` +
        `<div><h1 style="font-size:22px;margin:0 0 8px">${titulo}</h1><p style="margin:0 0 20px;color:#CFC7D6">${texto}</p>` +
        `<a href="/" style="display:inline-block;background:#FF6A1A;color:#000;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:8px">Ir para o Pede Aki</a></div></body></html>`,
});

export async function tratar({ codigo, host, env, buscar }) {
    if (!/^[A-Za-z0-9]{4,12}$/.test(codigo || '')) return pagina('QR não encontrado', 'Este código não existe.', 404);
    const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
    const r = await buscar(`${base}/rest/v1/rpc/qr_resolver`, {
        method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_codigo: codigo }),
    });
    if (!r.ok) throw new Error(`qr_resolver ${r.status}`);
    const d = await r.json();
    if (d.estado === 'ok' && d.tipo === 'loja' && /^[a-z0-9-_]+$/i.test(d.slug || '')) return { status: 302, destino: `https://${host}/${d.slug}` };
    if (d.estado === 'ok' && d.tipo === 'url' && /^https?:\/\//i.test(d.url || '')) return { status: 302, destino: d.url };
    if (d.estado === 'vazio') return pagina('QR ainda não ativado', 'Este QR Code existe, mas ainda não foi ligado a um destino.', 404);
    if (d.estado === 'pausado') return pagina('QR indisponível', 'Este QR Code está pausado no momento.', 404);
    return pagina('QR não encontrado', 'Este código não existe.', 404);
}

export default async function handler(req, res) {
    try {
        const codigo = String((req.query && req.query.c) || '');
        const r = await tratar({ codigo, host: req.headers['x-forwarded-host'] || req.headers.host, env: process.env, buscar: fetch });
        res.setHeader('Cache-Control', 'no-store');
        if (r.destino) { res.redirect(302, r.destino); return; }
        res.status(r.status).setHeader('Content-Type', 'text/html; charset=utf-8').send(r.html);
    } catch (e) {
        console.error('q', e.message);
        const p = pagina('Tente de novo', 'Não foi possível abrir este QR agora.', 502);
        res.status(p.status).setHeader('Content-Type', 'text/html; charset=utf-8').send(p.html);
    }
}
