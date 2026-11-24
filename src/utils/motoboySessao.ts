/** Sessao do motoboy neste aparelho: o login e feito no Perfil (porta unica do app) e a Central (/motoboy) le o mesmo token. */
const CHAVE = 'pedeaki_motoboy_token';
export const lerTokenMotoboy = (): string => { try { return localStorage.getItem(CHAVE) || ''; } catch { return ''; } };
export const guardarTokenMotoboy = (t: string): void => { try { t ? localStorage.setItem(CHAVE, t) : localStorage.removeItem(CHAVE); } catch { /* sem armazenamento: entra de novo na proxima */ } };
