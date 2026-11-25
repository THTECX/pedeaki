/** Constantes e formatadores da central de gestão (Super Admin). */

export interface FormFinanceiro {
    comissao_pct_propria: number;
    comissao_pct_app: number;
    comissao_fixa: number;
    repassa_taxa_pagamento: boolean;
    limite_debito: number;
    debito_dinheiro: number;
    /** Carteira (walletId) da loja no Asaas: recebe o repasse do PIX online. Vazio = a loja ainda nao aceita pagamento online. */
    asaas_wallet_id?: string | null;
}
export const FIN_PADRAO: FormFinanceiro = { comissao_pct_propria: 8, comissao_pct_app: 20, comissao_fixa: 0.99, repassa_taxa_pagamento: true, limite_debito: 100, debito_dinheiro: 0 };

/** Valor mensal sugerido de cada PDV (editável na criação). A loja de comissão não tem mensalidade. */
export const VALOR_PADRAO: Record<'pdv_basico' | 'pdv_avancado', number> = { pdv_basico: 199, pdv_avancado: 499 };
export const CATEGORIAS_LOJA = ['Lanchonete', 'Sorveteria / Açaí', 'Pizzaria', 'Restaurante', 'Padaria', 'Hortifruti', 'Agropecuária', 'Farmácia', 'Presentes e flores', 'Outros'];

/** Lembretes que aparecem ao escolher a categoria da loja (como montar o cardápio e o que combinar com o lojista). */
export const DICAS_POR_CATEGORIA: Record<string, string[]> = {
    'Hortifruti': [
        'Venda por cestas e kits de preço fixo: Cesta de frutas, Cesta de verduras, Kit feira da semana (preço fixo resolve o preço que muda todo dia e a venda por quilo, que o sistema ainda não faz).',
        'Mais 10 a 15 itens por unidade ou pacote: dúzia de banana, bandeja de ovos, maço de cheiro-verde, caixa de tomate.',
        'Só item que o motoboy consegue levar. Combinar com o lojista quem entrega (ele, o app ou retirada).',
        'Itens do dia em falta: o lojista marca indisponível, ou recusa o pedido em 1 toque.',
    ],
    'Agropecuária': [
        'Cadastrar só os 30 a 40 itens que mais saem, de preço estável. Cada marca e tamanho vira um item (ração 25 kg, 15 kg...).',
        'Não listar remédio veterinário controlado nem agrotóxico: exigem receita.',
        'Saco pesado: deixar só para retirada na loja ou combinar o frete.',
        'Escolher junto com o lojista no papel e tirar a foto de cada item com o celular dele, na hora.',
    ],
    'Farmácia': [
        'Não listar remédio que exige receita nem controlado. Começar por higiene, cuidado pessoal e vendas livres.',
        'Cadastrar só os mais vendidos, de preço estável.',
    ],
    'Pizzaria': [
        'Hoje o app NÃO tem meio a meio nem preço por tamanho e sabor. Fase A: um produto por sabor em categorias por tamanho (Pizzas Médias, Pizzas Grandes). Meio a meio ainda não.',
        'Borda recheada e extras entram como complemento adicional (pago).',
        'Perguntar: tamanhos, quantos sabores no meio a meio, preço do meio a meio e tempo de preparo.',
    ],
    'Sorveteria / Açaí': [
        'Açaí e picolé já têm complementos em passos (sabor, opcional, adicional). Cada sabor extra conta como outra unidade.',
        'Fotos boas do copo e do açaí montado vendem mais que a lista de complementos.',
    ],
    'Lanchonete': [
        'Cadastrar o cardápio completo, com foto nos 10 itens mais vendidos.',
        'Combos (lanche + batata + refri) com preço fechado ajudam o ticket médio.',
    ],
    'Padaria': [
        'Itens por unidade ou pacote (pão francês 10 un., bolo inteiro). Por quilo real ainda não existe.',
    ],
    'Presentes e flores': [
        'Aqui vale o catálogo completo com foto: o cliente escolhe olhando. Cestas e arranjos com preço fechado.',
    ],
};

// Endereços que já são rotas do app: não podem virar link de loja.
export const SLUGS_RESERVADOS = ['admin', 'login', 'super-admin', 'staff', 'acesso', 'hub-equipe', 'portal-equipe', 'garcom', 'waiter', 'entregador', 'tv', 'cadastro', 'shopping', 'vitrine', 'perfil', 'motoboy', 'impulsionar', 'carteira', 'q', 'entrar', 'termos', 'privacidade', 'redefinir_senha', 'assets', 'public'];

export const limparSlug = (texto: string) =>
    texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

export const brl = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;
export const pct = (v: number) => `${String(Number(v) || 0).replace('.', ',')}%`;

/** "há 3 min", "há 2 h", "há 4 dias". */
export const haQuanto = (iso: string | null | undefined, agora = Date.now()): string => {
    if (!iso) return 'nunca';
    const min = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.round(min / 60)} h`;
    return `há ${Math.round(min / 1440)} dias`;
};

export const dataHora = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
