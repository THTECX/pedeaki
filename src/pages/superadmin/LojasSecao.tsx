import React, { useState } from 'react';
import { criarLojaCompleta, updateStoreSubscription, salvarFinanceiro } from '../../services/supabaseService';
import { tipoDaLoja, ROTULO_DO_TIPO, type TipoDeLoja } from '../../services/recursos';
import type { Store } from '../../types';
import { usePlataforma } from './dados';
import { CamposFinanceiros } from './CamposFinanceiros';
import { AcessoDoDono } from './AcessoDoDono';
import { chamarAdmin, gerarSenha, useLogins } from './logins';
import { Janela, BotaoCancelar, BotaoPrincipal } from './Janela';
import { FIN_PADRAO, VALOR_PADRAO, CATEGORIAS_LOJA, DICAS_POR_CATEGORIA, SLUGS_RESERVADOS, limparSlug, brl, pct, type FormFinanceiro } from './util';

const PlusIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>;
const EditIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>;

const campoBase = 'w-full bg-gray-700 border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500';

const DicasDaCategoria: React.FC<{ categoria: string }> = ({ categoria }) => {
    const dicas = DICAS_POR_CATEGORIA[categoria];
    if (!dicas) return null;
    return (
        <div className="mt-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-orange-300 mb-1.5">Dicas para {categoria}</p>
            <ul className="list-disc pl-4 space-y-1 text-xs text-gray-300">
                {dicas.map(d => <li key={d}>{d}</li>)}
            </ul>
        </div>
    );
};

export const LojasSecao: React.FC = () => {
    const { stores, financeiros, padroes, cardapio, recarregar } = usePlataforma();
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingStore, setEditingStore] = useState<Store | null>(null);
    const [criada, setCriada] = useState<{ nome: string; slug: string; email: string; senha: string; comLogin: boolean; aviso?: string } | null>(null);
    const { logins, recarregar: recarregarLogins } = useLogins();
    // Login do dono ao criar a loja: 'novo' (cria agora, junto), 'depois' ou o id de um login que já existe.
    const [loginModo, setLoginModo] = useState<string>('novo');
    const [loginSenha, setLoginSenha] = useState('');

    const finPadroes = (): FormFinanceiro => ({ ...FIN_PADRAO, ...(padroes || {}) });
    const novoFormulario = (fin: FormFinanceiro = finPadroes()) => ({
        name: '', slug: '', owner_email: '', tipo: 'comissao' as TipoDeLoja, plan_value: VALOR_PADRAO.pdv_basico,
        categoria: '', cidade: '', aparecer_no_shopping: false, fin,
    });
    const [newStore, setNewStore] = useState(novoFormulario());
    const [editForm, setEditForm] = useState<{ tipo: TipoDeLoja; plan_value: number; subscription_end_date: string; is_active: boolean; categoria: string; cidade: string; aparecer_no_shopping: boolean; aceita_dinheiro: boolean; pagamento_pix: boolean; pagamento_cartao: boolean; entrega_modo: 'propria' | 'app'; impulso: 'nenhum' | 'patrocinada' | 'destaque'; impulso_ate: string; fin: FormFinanceiro }>({
        tipo: 'pdv_avancado', plan_value: 0, subscription_end_date: '', is_active: true, categoria: '', cidade: '', aparecer_no_shopping: false, aceita_dinheiro: true, pagamento_pix: true, pagamento_cartao: false, entrega_modo: 'propria', impulso: 'nenhum', impulso_ate: '', fin: FIN_PADRAO,
    });

    const handleCreateStore = async () => {
        const slug = limparSlug(newStore.slug || newStore.name);
        const existente = logins.find(l => l.id === loginModo);
        const email = existente ? existente.email : (loginModo === 'novo' ? newStore.owner_email.trim().toLowerCase() : '');
        if (!newStore.name.trim()) return alert('Informe o nome da loja.');
        if (!slug) return alert('Informe um link (slug) válido.');
        if (SLUGS_RESERVADOS.includes(slug)) return alert(`"${slug}" é um endereço reservado do sistema. Escolha outro.`);
        if (stores.some(s => s.slug === slug)) return alert(`Já existe uma loja com o link "${slug}".`);
        if (loginModo === 'novo' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert('Informe o e-mail do login do dono (pode ser de fachada).');
        if (loginModo === 'novo' && loginSenha.length < 8) return alert('A senha do login precisa ter pelo menos 8 caracteres.');
        const comissao = newStore.tipo === 'comissao';
        if (comissao && padroes === null) return alert('As condições de comissão ainda não existem no banco. Rode o SQL 4 no Supabase antes de criar lojas.');
        try {
            // PDV: 30 dias de teste. Comissão não tem mensalidade nem vencimento.
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + 30);
            const { debito_dinheiro: _d, ...condicoes } = newStore.fin;

            const loja = await criarLojaCompleta({
                name: newStore.name.trim(),
                slug,
                ...(email ? { owner_email: email } : {}),
                modelo: comissao ? 'comissao' : 'pdv',
                plan: comissao ? null : (newStore.tipo === 'pdv_basico' ? 'basico' : 'avancado'),
                plan_value: comissao ? 0 : (newStore.plan_value || 0),
                is_active: true,
                ...(comissao ? {} : { subscription_end_date: expirationDate.toISOString() }),
                ...(newStore.categoria ? { categoria: newStore.categoria } : {}),
                ...(newStore.cidade.trim() ? { cidade: newStore.cidade.trim() } : {}),
                ...(newStore.aparecer_no_shopping ? { aparecer_no_shopping: true } : {}),
            }, comissao ? condicoes : undefined);
            setShowCreateModal(false);
            // Login e loja são coisas separadas: a loja já existe; agora cria o login junto ou liga o escolhido.
            let comLogin = !!loja.owner_id; let aviso: string | undefined;
            try {
                if (loginModo === 'novo') { await chamarAdmin({ acao: 'criar', email, senha: loginSenha, store_id: loja.id }); comLogin = true; }
                else if (existente) { await chamarAdmin({ acao: 'vincular', store_id: loja.id, user_id: existente.id }); comLogin = true; }
            } catch (e: any) { aviso = `A loja foi criada, mas o login não: ${e?.message || e}. Ligue um login na janela de editar a loja.`; }
            setCriada({ nome: newStore.name.trim(), slug, email, senha: loginModo === 'novo' ? loginSenha : '', comLogin, aviso });
            setNewStore(novoFormulario()); setLoginModo('novo'); setLoginSenha('');
            recarregar(); recarregarLogins();
        } catch (error: any) {
            console.error(error);
            alert(`Erro ao criar loja: ${error?.message || error}`);
        }
    };

    const handleUpdateStore = async () => {
        if (!editingStore) return;
        const comissao = editForm.tipo === 'comissao';
        if (editingStore.impulso !== undefined && editForm.impulso !== 'nenhum' && !editForm.impulso_ate) return alert('Informe até quando vai o impulsionamento.');
        try {
            await updateStoreSubscription(editingStore.id, {
                modelo: comissao ? 'comissao' : 'pdv',
                plan: comissao ? null : (editForm.tipo === 'pdv_basico' ? 'basico' : 'avancado'),
                plan_value: comissao ? 0 : editForm.plan_value,
                is_active: editForm.is_active,
                categoria: editForm.categoria || null,
                cidade: editForm.cidade.trim() || null,
                aparecer_no_shopping: editForm.aparecer_no_shopping,
                aceita_dinheiro: comissao ? editForm.aceita_dinheiro : true,
                // controles do SQL 17: so vao se a coluna ja existe (a loja carregada traz o campo)
                ...(comissao && editingStore.entrega_modo !== undefined ? { pagamento_pix: editForm.pagamento_pix, pagamento_cartao: editForm.pagamento_cartao, entrega_modo: editForm.entrega_modo } : {}),
                // impulsionamento (SQL 19): so vai se a coluna ja existe (a loja carregada traz o campo)
                ...(editingStore.impulso !== undefined ? { impulso: editForm.impulso, impulso_ate: editForm.impulso === 'nenhum' || !editForm.impulso_ate ? null : new Date(editForm.impulso_ate + 'T23:59:59').toISOString() } : {}),
                subscription_end_date: comissao ? null : (editForm.subscription_end_date ? new Date(editForm.subscription_end_date + 'T23:59:59').toISOString() : null),
            });
            if (comissao) await salvarFinanceiro(editingStore.id, editForm.fin);
            alert('Loja atualizada!');
            setEditingStore(null);
            recarregar();
        } catch (error: any) {
            console.error(error);
            alert(`Erro ao atualizar loja: ${error?.message || error}`);
        }
    };

    const openEditModal = (store: Store) => {
        setEditingStore(store);
        setEditForm({
            tipo: tipoDaLoja(store),
            plan_value: store.plan_value || 0,
            subscription_end_date: store.subscription_end_date ? new Date(store.subscription_end_date).toISOString().split('T')[0] : '',
            is_active: store.is_active ?? true,
            categoria: store.categoria || '',
            cidade: store.cidade || '',
            aparecer_no_shopping: store.aparecer_no_shopping ?? false,
            aceita_dinheiro: store.aceita_dinheiro ?? true,
            pagamento_pix: store.pagamento_pix ?? true,
            pagamento_cartao: store.pagamento_cartao ?? false,
            entrega_modo: store.entrega_modo ?? 'propria',
            impulso: store.impulso ?? 'nenhum',
            impulso_ate: store.impulso_ate ? new Date(store.impulso_ate).toISOString().split('T')[0] : '',
            fin: { ...finPadroes(), ...(financeiros[store.id] ? { ...financeiros[store.id] } : {}) } as FormFinanceiro,
        });
    };

    const linkDaLoja = (slug: string) => `${window.location.origin}/${slug}`;
    const pacote = (c: { slug: string; email: string; senha: string }) => `Acesso ao painel da sua loja no Pede Aki\nEndereço: ${linkDaLoja(c.slug)}/admin\nLogin: ${c.email}\nSenha: ${c.senha}`;
    const seletorDeTipo = (valor: TipoDeLoja, aoMudar: (t: TipoDeLoja) => void) => (
        <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Modelo da loja</label>
            <select value={valor} onChange={e => aoMudar(e.target.value as TipoDeLoja)} className={campoBase}>
                <option value="comissao">Comissão (Pede Aki, sem mensalidade)</option>
                <option value="pdv_basico">PDV Básico (mensalidade)</option>
                <option value="pdv_avancado">PDV Avançado (mensalidade)</option>
            </select>
        </div>
    );

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-white">Lojas</h1>
                <button onClick={() => { setNewStore(novoFormulario()); setLoginModo('novo'); setLoginSenha(''); setShowCreateModal(true); }} className="flex items-center space-x-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg font-bold transition">
                    <PlusIcon /> <span>Nova Loja</span>
                </button>
            </div>

            {padroes === null && (
                <div className="mb-6 rounded-lg bg-yellow-900/40 border border-yellow-700 text-yellow-200 px-4 py-3 text-sm">
                    As tabelas de condições de comissão ainda não existem no banco. Rode o SQL 4 no Supabase. Enquanto isso só dá para criar lojas de PDV.
                </div>
            )}

            <div className="bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-700">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-700 text-gray-300 uppercase text-sm">
                            <tr>
                                <th className="p-4">Nome</th>
                                <th className="p-4">Link</th>
                                <th className="p-4">Email Dono</th>
                                <th className="p-4">Modelo</th>
                                <th className="p-4">Condições</th>
                                <th className="p-4">Cardápio</th>
                                <th className="p-4">Status</th>
                                <th className="p-4 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {stores.map(store => {
                                const tipo = tipoDaLoja(store);
                                const comissao = tipo === 'comissao';
                                const fin = financeiros[store.id];
                                const daysRemaining = store.subscription_end_date
                                    ? Math.ceil((new Date(store.subscription_end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                                    : 0;
                                return (
                                    <tr key={store.id} className="hover:bg-gray-750 transition">
                                        <td className="p-4 font-bold text-white">
                                            {store.name}
                                            {(store.categoria || store.cidade) && <span className="block text-xs font-normal text-gray-400">{[store.categoria, store.cidade].filter(Boolean).join(' · ')}{store.aparecer_no_shopping ? ' · no shopping' : ''}</span>}
                                        </td>
                                        <td className="p-4 text-blue-400 space-x-3 whitespace-nowrap">
                                            <a href={`/${store.slug}`} target="_blank" rel="noreferrer">/{store.slug}</a>
                                            <a href={`/${store.slug}/admin`} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-200" title="Abre o painel da loja (você entra como administrador)">painel</a>
                                        </td>
                                        <td className="p-4 text-gray-300">
                                            {store.owner_email || '-'}
                                            {store.owner_email && !store.owner_id && <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold bg-yellow-900 text-yellow-200" title="O dono ainda não criou/recebeu o login com este e-mail">sem login</span>}
                                        </td>
                                        <td className="p-4 text-gray-300">
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${comissao ? 'bg-orange-900 text-orange-200' : 'bg-blue-900 text-blue-200'}`}>{ROTULO_DO_TIPO[tipo]}</span>
                                            {!comissao && <span className="block text-green-400 font-mono text-xs mt-1">{brl(store.plan_value || 0)}/mês</span>}
                                        </td>
                                        <td className="p-4 text-xs">
                                            {comissao ? (
                                                fin ? (
                                                    <span className="text-gray-300">
                                                        {pct(fin.comissao_pct_propria)} / {pct(fin.comissao_pct_app)} + {brl(fin.comissao_fixa)}
                                                        <span className={`block ${fin.debito_dinheiro >= fin.limite_debito && fin.limite_debito > 0 ? 'text-red-400 font-bold' : 'text-gray-400'}`}>
                                                            débito {brl(fin.debito_dinheiro)} de {brl(fin.limite_debito)}{store.aceita_dinheiro === false ? ' (dinheiro bloqueado)' : ''}
                                                        </span>
                                                    </span>
                                                ) : <span className="text-yellow-400">sem condições cadastradas</span>
                                            ) : (
                                                <span className={`px-2 py-1 rounded font-bold ${daysRemaining < 7 ? 'bg-red-900 text-red-200' : 'bg-gray-700 text-gray-300'}`}>
                                                    {store.subscription_end_date ? new Date(store.subscription_end_date).toLocaleDateString() : '-'}
                                                    {store.subscription_end_date && ` (${daysRemaining} dias)`}
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4 text-xs">
                                            {cardapio[store.id] > 0 ? <span className="text-gray-300">{cardapio[store.id]} itens</span> : <span className="text-yellow-400">vazio</span>}
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${store.is_active ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                                                {store.is_active ? 'ATIVO' : 'SUSPENSO'}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right">
                                            <button onClick={() => openEditModal(store)} className="text-blue-400 hover:text-blue-300 p-2 rounded hover:bg-gray-700" aria-label="Editar loja">
                                                <EditIcon />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Loja criada: o que falta fazer */}
            {criada && (
                <Janela titulo="Loja criada" onFechar={() => setCriada(null)} rodape={<>
                    <BotaoCancelar rotulo="Copiar link da loja" onClick={() => { navigator.clipboard?.writeText(linkDaLoja(criada.slug)).catch(() => {}); }} />
                    <BotaoPrincipal rotulo="Ok" onClick={() => setCriada(null)} />
                </>}>
                    <div className="space-y-3">
                        <p className="text-gray-300"><b>{criada.nome}</b></p>
                        <p className="text-sm text-gray-400">Link da loja (cardápio): <span className="text-blue-400 break-all">{linkDaLoja(criada.slug)}</span></p>
                        <p className="text-sm text-gray-400">Painel do dono: <span className="text-blue-400 break-all">{linkDaLoja(criada.slug)}/admin</span></p>
                        {criada.aviso && <p className="text-sm text-red-300">{criada.aviso}</p>}
                        {criada.comLogin && criada.senha ? (
                            <div className="rounded-lg bg-gray-900 border border-gray-600 p-3 space-y-2">
                                <p className="text-xs text-gray-400">Dados para enviar ao cliente (somem quando você fechar esta janela):</p>
                                <pre className="text-sm text-gray-100 whitespace-pre-wrap break-all">{pacote(criada)}</pre>
                                <button type="button" onClick={() => { navigator.clipboard?.writeText(pacote(criada)).catch(() => {}); }} className="px-2 py-1 rounded text-xs font-bold bg-gray-600 hover:bg-gray-500 text-white">Copiar dados</button>
                            </div>
                        ) : criada.comLogin ? (
                            <p className="text-sm text-green-300">A loja foi ligada ao login <b>{criada.email}</b>. Ele já pode entrar no painel.</p>
                        ) : !criada.aviso && (
                            <p className="text-sm text-yellow-300">A loja ainda não tem login. Ligue um na janela de editar a loja, ou crie um na aba Logins.</p>
                        )}
                    </div>
                </Janela>
            )}

            {/* Nova loja: duas colunas no computador */}
            {showCreateModal && (
                <Janela titulo="Nova Loja" larga onFechar={() => setShowCreateModal(false)} rodape={<>
                    <BotaoCancelar onClick={() => setShowCreateModal(false)} />
                    <BotaoPrincipal rotulo="Criar loja" onClick={handleCreateStore} />
                </>}>
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-4">
                            {seletorDeTipo(newStore.tipo, t => setNewStore({ ...newStore, tipo: t, plan_value: t === 'comissao' ? 0 : VALOR_PADRAO[t] }))}
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Nome da Loja</label>
                                <input type="text" value={newStore.name} onChange={e => setNewStore({ ...newStore, name: e.target.value })} className={campoBase} placeholder="Ex: Lanchonete do João" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Link (slug)</label>
                                <input type="text" value={newStore.slug} onChange={e => setNewStore({ ...newStore, slug: e.target.value })} className={campoBase} placeholder={limparSlug(newStore.name) || 'lanchonetedojoao'} />
                                <p className="text-xs text-gray-500 mt-1">{window.location.origin}/{limparSlug(newStore.slug || newStore.name) || '...'}</p>
                            </div>
                            <div className="rounded-lg border border-gray-700 p-3 space-y-3">
                                <label className="block text-sm font-medium text-gray-400">Login do dono da loja</label>
                                <select value={loginModo} onChange={e => setLoginModo(e.target.value)} className={campoBase}>
                                    <option value="novo">Criar um login novo agora</option>
                                    <option value="depois">Ligar um login depois</option>
                                    {logins.map(l => <option key={l.id} value={l.id}>{l.email}{l.lojas.length ? ` (já usado em: ${l.lojas.map(x => x.nome).join(', ')})` : ' (livre)'}</option>)}
                                </select>
                                {loginModo === 'novo' && <>
                                    <input type="email" value={newStore.owner_email} onChange={e => setNewStore({ ...newStore, owner_email: e.target.value })} className={campoBase} placeholder="login (e-mail, pode ser de fachada)" autoComplete="off" />
                                    <div className="flex gap-2">
                                        <input type="text" value={loginSenha} onChange={e => setLoginSenha(e.target.value)} className={campoBase} placeholder="senha (mínimo 8)" autoComplete="off" />
                                        <button type="button" onClick={() => setLoginSenha(gerarSenha())} className="px-3 rounded-lg bg-gray-600 hover:bg-gray-500 text-white text-sm font-bold">Gerar</button>
                                    </div>
                                </>}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Categoria</label>
                                    <select value={newStore.categoria} onChange={e => setNewStore({ ...newStore, categoria: e.target.value })} className={campoBase}>
                                        <option value="">Selecione</option>
                                        {CATEGORIAS_LOJA.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <DicasDaCategoria categoria={newStore.categoria} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Cidade</label>
                                    <input type="text" value={newStore.cidade} onChange={e => setNewStore({ ...newStore, cidade: e.target.value })} className={campoBase} placeholder="Palmas" />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            {newStore.tipo === 'comissao' ? (
                                <div className="rounded-lg border border-gray-700 p-4">
                                    <p className="text-sm font-bold text-orange-300 mb-3">Condições de comissão (começam nos padrões)</p>
                                    <CamposFinanceiros v={newStore.fin} onChange={fin => setNewStore({ ...newStore, fin })} />
                                </div>
                            ) : (
                                <div className="rounded-lg border border-gray-700 p-4">
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Valor da mensalidade (R$)</label>
                                    <input type="number" value={newStore.plan_value} onChange={e => setNewStore({ ...newStore, plan_value: parseFloat(e.target.value) || 0 })} className={campoBase} />
                                    <p className="text-xs text-gray-500 mt-1">Começa ativa, com 30 dias de teste.</p>
                                </div>
                            )}
                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                <input type="checkbox" checked={newStore.aparecer_no_shopping} onChange={e => setNewStore({ ...newStore, aparecer_no_shopping: e.target.checked })} className="h-4 w-4" />
                                Aparecer no shopping (marque quando o cardápio estiver pronto)
                            </label>
                        </div>
                    </div>
                </Janela>
            )}

            {/* Editar loja: duas colunas no computador */}
            {editingStore && (
                <Janela titulo={`Editar: ${editingStore.name}`} larga onFechar={() => setEditingStore(null)} rodape={<>
                    <BotaoCancelar onClick={() => setEditingStore(null)} />
                    <BotaoPrincipal rotulo="Salvar alterações" onClick={handleUpdateStore} />
                </>}>
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-4">
                            {seletorDeTipo(editForm.tipo, t => setEditForm({ ...editForm, tipo: t, plan_value: t === 'comissao' ? 0 : (editForm.plan_value || VALOR_PADRAO[t]) }))}
                            {editForm.tipo !== tipoDaLoja(editingStore) && (
                                <p className="text-xs text-yellow-300">Mudar o modelo muda na hora o que o lojista enxerga no painel dele.</p>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Categoria</label>
                                    <select value={editForm.categoria} onChange={e => setEditForm({ ...editForm, categoria: e.target.value })} className={campoBase}>
                                        <option value="">Sem categoria</option>
                                        {CATEGORIAS_LOJA.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <DicasDaCategoria categoria={editForm.categoria} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Cidade</label>
                                    <input type="text" value={editForm.cidade} onChange={e => setEditForm({ ...editForm, cidade: e.target.value })} className={campoBase} />
                                </div>
                            </div>
                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                <input type="checkbox" checked={editForm.aparecer_no_shopping} onChange={e => setEditForm({ ...editForm, aparecer_no_shopping: e.target.checked })} className="h-4 w-4" />
                                Aparecer no shopping (Pede Aki)
                            </label>
                            <div className="rounded-lg border border-gray-700 p-3 space-y-2">
                                <p className="text-sm font-bold text-orange-300">Impulsionamento na vitrine</p>
                                {editingStore.impulso === undefined ? (
                                    <p className="text-xs text-yellow-300">Rode o SQL 19 no Supabase para liberar o impulsionamento.</p>
                                ) : (
                                    <>
                                        <select value={editForm.impulso} onChange={e => setEditForm({ ...editForm, impulso: e.target.value as 'nenhum' | 'patrocinada' | 'destaque' })} className={campoBase}>
                                            <option value="nenhum">Sem impulso (padrão)</option>
                                            <option value="patrocinada">Patrocinada (faixa de selos)</option>
                                            <option value="destaque">Destaque (banner grande no topo)</option>
                                        </select>
                                        {editForm.impulso !== 'nenhum' && (
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Vale até (último dia)</label>
                                                <input type="date" value={editForm.impulso_ate} onChange={e => setEditForm({ ...editForm, impulso_ate: e.target.value })} className={campoBase} />
                                            </div>
                                        )}
                                        <p className="text-xs text-gray-400">Passada a data, a loja volta sozinha ao normal. Só aparece impulsionada se também estiver marcada para aparecer no shopping.</p>
                                    </>
                                )}
                            </div>
                            <div className="flex items-center space-x-3 bg-gray-700 p-3 rounded-lg">
                                <input type="checkbox" id="isActive" checked={editForm.is_active} onChange={e => setEditForm({ ...editForm, is_active: e.target.checked })} className="h-5 w-5 rounded text-blue-500 bg-gray-600 border-gray-500 focus:ring-blue-500" />
                                <label htmlFor="isActive" className="text-white font-medium cursor-pointer">Loja Ativa</label>
                            </div>
                            <AcessoDoDono store={stores.find(s => s.id === editingStore.id) || editingStore} onMudou={recarregar} />
                        </div>
                        <div className="space-y-4">
                            {editForm.tipo === 'comissao' ? (
                                <div className="rounded-lg border border-gray-700 p-4 space-y-3">
                                    <p className="text-sm font-bold text-orange-300">Condições de comissão</p>
                                    <CamposFinanceiros v={editForm.fin} onChange={fin => setEditForm({ ...editForm, fin })} comDebito comCarteira />
                                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                        <input type="checkbox" checked={editForm.aceita_dinheiro} onChange={e => setEditForm({ ...editForm, aceita_dinheiro: e.target.checked })} className="h-4 w-4" />
                                        Aceitar pagamento em dinheiro (desmarque para bloquear a opção Dinheiro no checkout)
                                    </label>
                                    {editingStore.entrega_modo !== undefined ? (
                                        <div className="space-y-2 rounded-lg bg-gray-800/60 p-3">
                                            <p className="text-xs font-bold text-gray-300">Formas de pagamento no checkout desta loja</p>
                                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                                <input type="checkbox" checked={editForm.pagamento_pix} onChange={e => setEditForm({ ...editForm, pagamento_pix: e.target.checked })} className="h-4 w-4" />
                                                PIX (online quando a loja tem carteira no Asaas)
                                            </label>
                                            <label className="flex items-center gap-2 text-sm text-gray-500">
                                                <input type="checkbox" checked={editForm.pagamento_cartao} onChange={e => setEditForm({ ...editForm, pagamento_cartao: e.target.checked })} className="h-4 w-4" disabled />
                                                Cartão online (em breve)
                                            </label>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-400 mb-1">Quem faz a entrega</label>
                                                <select value={editForm.entrega_modo} onChange={e => setEditForm({ ...editForm, entrega_modo: e.target.value as 'propria' | 'app' })} className={campoBase}>
                                                    <option value="propria">O próprio lojista (o frete fica com ele)</option>
                                                    <option value="app">Motoboy do Pede Aki (o frete vai para o motoboy)</option>
                                                </select>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-yellow-400">Para liberar os controles de pagamento e entrega, rode o SQL 17 no Supabase.</p>
                                    )}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-gray-700 p-4 space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-400 mb-1">Valor da mensalidade (R$)</label>
                                        <input type="number" value={editForm.plan_value} onChange={e => setEditForm({ ...editForm, plan_value: parseFloat(e.target.value) || 0 })} className={campoBase} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-400 mb-1">Data de Vencimento</label>
                                        <input type="date" value={editForm.subscription_end_date} onChange={e => setEditForm({ ...editForm, subscription_end_date: e.target.value })} className={campoBase} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </Janela>
            )}
        </div>
    );
};
