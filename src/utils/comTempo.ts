/**
 * Espera uma promessa por no maximo `ms` milissegundos. Sem internet, chamadas de rede podem ficar penduradas para sempre
 * e a tela fica em "Carregando..." sem explicar nada; com limite de tempo a tela consegue avisar e tentar de novo.
 */
export function comTempo<T>(promessa: Promise<T>, ms: number, mensagem = 'Tempo esgotado.'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(mensagem)), ms);
        promessa.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
}
