/* Controle de Entregas — GrupoPro
   Uma empresa por vez: seletor no topo, itens de conferencia em cards.
   Front-end estatico (GitHub Pages) sobre Postgres (Supabase).
   Acesso por usuario e senha (Supabase Auth). A chave abaixo e publicavel de
   proposito: sozinha ela nao abre nada, porque as politicas das tabelas ctrl_*
   exigem sessao autenticada. Criar acesso e resetar senha exigem a chave de
   servico e por isso vivem na Edge Function admin-usuarios, nunca aqui. */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://czbumtufqxbbvfbmjzdt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wRmo_lZyNkQx0OuD1OOeXg_75Aj13pT';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 5 } }
});

const K_SEL = 'gp.controle.empresa';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                     'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ANO = new Date().getFullYear();
/* chave "AAAA-MM": o ano vai junto para o controle virar de ano sem migracao */
const chaveMes = (i) => ANO + '-' + String(i + 1).padStart(2, '0');

let EMPRESAS = [];
let ITENS = new Map();        // codigo -> [linhas de ctrl_itens]
let OBS = new Map();          // codigo -> [observacoes]
let sel = null;               // codigo da empresa aberta
let editandoObsId = null;

const qs = (s, r) => (r || document).querySelector(s);
const qsa = (s, r) => [...(r || document).querySelectorAll(s)];

const normalizar = (s) => String(s || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toUpperCase();

function agora(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------ avisos ----- */
let toastTimer = null;
function toast(msg, tom) {
  let el = qs('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.append(el); }
  el.textContent = msg;
  if (tom) el.setAttribute('data-tone', tom); else el.removeAttribute('data-tone');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 5200);
}

function avisar(texto) {
  qs('#banner-txt').textContent = texto;
  qs('#banner').setAttribute('data-show', '');
}

const ROTULO = {
  carregando: 'Carregando…', ok: 'Salvo', salvando: 'Salvando…',
  erro: 'Falha ao salvar', offline: 'Sem conexão'
};
function sync(estado, detalhe) {
  const el = qs('#sync');
  el.setAttribute('data-estado', estado);
  el.textContent = ROTULO[estado] || estado;
  if (detalhe) el.title = detalhe; else el.removeAttribute('title');
}

/* ------------------------------------------------------------ leitura --- */
const itensDe = (cod) => (ITENS.get(cod) || [])
  .slice().sort((a, b) => a.ordem - b.ordem || a.item.localeCompare(b.item, 'pt-BR'));

function contagem(cod) {
  const l = (ITENS.get(cod) || []).filter((i) => i.aplica !== false);
  return {
    total: l.length,
    sim: l.filter((i) => i.valor === 'sim').length,
    nao: l.filter((i) => i.valor === 'nao').length,
    branco: l.filter((i) => !i.valor).length
  };
}

/* Itens distintos de toda a carteira. Agrupa por nome normalizado para que
   "Folha" e "folha" nao virem duas entradas; guarda a grafia mais vista. */
function catalogoItens() {
  const mapa = new Map();
  for (const lista of ITENS.values()) {
    for (const it of lista) {
      const k = normalizar(it.item);
      const reg = mapa.get(k);
      if (reg) { reg.n++; reg.grafias[it.item] = (reg.grafias[it.item] || 0) + 1; }
      else mapa.set(k, { chave: k, n: 1, grafias: { [it.item]: 1 } });
    }
  }
  return [...mapa.values()].map((r) => {
    const nome = Object.keys(r.grafias).sort((a, b) => r.grafias[b] - r.grafias[a])[0];
    return { chave: r.chave, nome, n: r.n };
  }).sort((a, b) => normalizar(a.nome).localeCompare(normalizar(b.nome), 'pt-BR'));
}

/* Para o item aberto: a linha dele em cada empresa que passa nos filtros.
   Empresa que nao tem o item simplesmente nao aparece. */
function linhasDoItem(chave) {
  const saida = [];
  for (const e of filtradas()) {
    const it = (ITENS.get(e.codigo) || [])
      .find((x) => normalizar(x.item) === chave && x.aplica !== false);
    if (it) saida.push({ empresa: e, item: it });
  }
  return saida;
}

function contagemItem(chave) {
  const l = linhasDoItem(chave);
  return {
    total: l.length,
    sim: l.filter((x) => x.item.valor === 'sim').length,
    nao: l.filter((x) => x.item.valor === 'nao').length,
    branco: l.filter((x) => !x.item.valor).length
  };
}

/* ------------------------------------------------------- seletor -------- */
function filtradas() {
  const termo = normalizar(qs('#f-busca').value.trim());
  const g = qs('#f-grupo').value, r = qs('#f-regime').value, p = qs('#f-periodo').value;
  return EMPRESAS.filter((e) =>
    (!termo || e._busca.includes(termo)) &&
    (!g || e.grupo === g) && (!r || e.regime === r) && (!p || e.periodicidade === p));
}

function preencherSelect(id, valores, rotuloTodos) {
  const el = qs(id);
  const atual = el.value;
  const unicos = [...new Set(valores.filter(Boolean))]
    .sort((a, b) => normalizar(a).localeCompare(normalizar(b), 'pt-BR'));
  el.textContent = '';
  el.append(new Option(rotuloTodos, ''));
  unicos.forEach((v) => el.append(new Option(v, v)));
  if (atual) el.value = atual;
}

function montarSeletorEmpresas() {
  const el = qs('#f-empresa');
  /* o proprio select e a fonte da verdade agora; `sel` e derivado dele.
     Sem preservar o valor aqui, reconstruir a lista apagava a escolha. */
  const atual = el.value;
  const lista = filtradas();
  el.textContent = '';
  el.append(new Option(lista.length ? '— todas as empresas do filtro —' : '— nenhuma empresa no filtro —', ''));
  for (const e of lista) {
    const c = contagem(e.codigo);
    const marca = c.nao ? '!' : (c.total && c.sim === c.total) ? '✓' : '·';
    el.append(new Option(`${marca}  ${e.codigo} — ${e.empresa}`, e.codigo));
  }
  qs('#contagem').textContent = lista.length === EMPRESAS.length
    ? `${EMPRESAS.length} empresas`
    : `${lista.length} de ${EMPRESAS.length} empresas`;
  el.value = (atual && lista.some((e) => e.codigo === atual)) ? atual : '';
}


/* --------------------------------------------------------- ficha -------- */

/* Vista por item: um card por empresa que tem aquele item. */


/* ===== escopo x itens =====================================================
   Uma tela so. O ESCOPO diz quais empresas entram (empresa, grupo, regime,
   periodicidade, busca) e a MULTIESCOLHA diz quais itens. Cada cartao e um
   par (empresa, item). "Uma empresa, todos os itens" e "um item, varias
   empresas" deixam de ser telas rivais e viram duas combinacoes da mesma. */

const LIMITE_CARTOES = 400;
let itensEscolhidos = new Set();   /* vazio = todos os itens */

function escopoEmpresas() {
  const cod = qs('#f-empresa').value;
  const base = filtradas();
  return cod ? base.filter((e) => e.codigo === cod) : base;
}

/* Sem nenhum recorte nao ha o que mostrar: 50 empresas x 37 itens seriam
   milhares de cartoes e nenhuma leitura util. */
function haEscopo() {
  return !!(qs('#f-empresa').value || qs('#f-grupo').value || qs('#f-regime').value
         || qs('#f-periodo').value || qs('#f-busca').value.trim() || itensEscolhidos.size);
}

function paresPorAplicacao(aplica) {
  const pares = [];
  for (const e of escopoEmpresas()) {
    for (const it of itensDe(e.codigo)) {
      if ((it.aplica !== false) !== aplica) continue;
      if (itensEscolhidos.size && !itensEscolhidos.has(normalizar(it.item))) continue;
      pares.push({ empresa: e, item: it });
    }
  }
  return pares;
}
const paresVisiveis = () => paresPorAplicacao(true);
const paresInativos = () => paresPorAplicacao(false);

function resumoItens() {
  if (!itensEscolhidos.size) return 'Todos os itens';
  if (itensEscolhidos.size === 1) {
    const reg = catalogoItens().find((i) => i.chave === [...itensEscolhidos][0]);
    return reg ? reg.nome : '1 item';
  }
  return itensEscolhidos.size + ' itens';
}

/* ---------- multiescolha de itens ---------- */
function montarListaItens() {
  const lista = qs('#itens-lista');
  const termo = normalizar(qs('#itens-busca').value.trim());
  lista.textContent = '';

  for (const i of catalogoItens()) {
    if (termo && !normalizar(i.nome).includes(termo)) continue;
    const c = contagemItem(i.chave);
    const l = document.createElement('label');
    l.className = 'multi-item';
    const cx = document.createElement('input');
    cx.type = 'checkbox';
    cx.value = i.chave;
    cx.checked = itensEscolhidos.has(i.chave);
    l.append(
      cx,
      Object.assign(document.createElement('span'), { className: 'multi-nome', textContent: i.nome }),
      Object.assign(document.createElement('span'), {
        className: 'multi-cont',
        textContent: c.nao ? c.nao + ' pend.' : (c.total && c.sim === c.total ? 'ok' : c.total)
      })
    );
    lista.append(l);
  }
  qs('#itens-resumo').textContent = resumoItens();
}

/* ---------- a tela ---------- */
function preencherFichaEmpresa(e) {
  qs('#ficha-cod').textContent = 'Código ' + e.codigo;
  qs('#ficha-nome').textContent = e.empresa;
  qs('#ficha-cnpj').textContent = e.cnpj || '—';
  qs('#ficha-grupo').textContent = e.grupo + (e.regional ? ' · ' + e.regional : '');
  qs('#ficha-regime').textContent = e.regime + (e.atividade ? ' · ' + e.atividade : '');
  qs('#ficha-periodo').textContent = e.periodicidade;
}

function preencherFichaEscopo(empresas, quantosCartoes) {
  const partes = [];
  if (qs('#f-grupo').value) partes.push(qs('#f-grupo').value);
  if (qs('#f-regime').value) partes.push(qs('#f-regime').value);
  if (qs('#f-periodo').value) partes.push(qs('#f-periodo').value);
  if (qs('#f-busca').value.trim()) partes.push('"' + qs('#f-busca').value.trim() + '"');

  qs('#escopo-eyebrow').textContent = resumoItens();
  qs('#escopo-nome').textContent = partes.length ? partes.join(' · ') : 'Todas as empresas';
  qs('#escopo-empresas').textContent = empresas.length;
  qs('#escopo-cartoes').textContent = quantosCartoes;
}

function render() {
  const temEscopo = haEscopo();
  qs('#vazio').hidden = temEscopo;
  qs('#conteudo').hidden = !temEscopo;
  if (!temEscopo) { sel = null; atualizarKpis(); return; }

  const empresas = escopoEmpresas();
  const unica = empresas.length === 1 ? empresas[0] : null;
  /* sel alimenta as observacoes gerais, que so existem com uma empresa */
  sel = unica ? unica.codigo : null;
  try { sel ? localStorage.setItem(K_SEL, sel) : localStorage.removeItem(K_SEL); } catch { /* privado */ }

  qs('#ficha-empresa').hidden = !unica;
  qs('#ficha-escopo').hidden = !!unica;
  qs('#bloco-obs').hidden = !unica;
  qs('#btn-pdf').textContent = unica ? 'PDF da empresa' : 'PDF da seleção';
  qs('#titulo-cards').textContent = unica ? 'Itens de conferência' : 'Cartões';

  if (unica) {
    preencherFichaEmpresa(unica);
    renderObs();
    sairDaEdicaoObs();
    qs('#obs-texto').value = '';
  }

  renderCards();
  atualizarKpis();
}

function avisoGrade(texto) {
  return Object.assign(document.createElement('p'),
    { className: 'vazio-selecao', textContent: texto });
}

function renderCards() {
  const grade = qs('#cards');
  grade.textContent = '';
  if (!haEscopo()) return;

  const empresas = escopoEmpresas();
  const pares = paresVisiveis();
  const varias = empresas.length !== 1;

  /* com mais de uma empresa em cena, o cabecalho descreve a selecao */
  if (varias) preencherFichaEscopo(empresas, pares.length);

  if (pares.length > LIMITE_CARTOES) {
    grade.append(avisoGrade(
      `${pares.length} cartões nesta combinação — muita coisa para uma tela só. `
      + 'Escolha um grupo, uma empresa ou marque os itens que interessam.'));
    return;
  }

  for (const p of pares) grade.append(cardDe(p.item, varias ? p.empresa : null));

  /* o item criado vale para todas as empresas, mas nasceria escondido se
     houvesse filtro de item ligado */
  if (!itensEscolhidos.size) grade.append(cardNovo());

  if (!pares.length) grade.append(avisoGrade('Nenhum cartão para esta combinação.'));

  renderInativos(varias);
}

function renderInativos(varias) {
  const grade = qs('#cards-inativos');
  const bloco = qs('#bloco-inativos');
  const pares = paresInativos();
  grade.textContent = '';
  bloco.hidden = !pares.length;
  if (!pares.length) return;
  qs('#inativos-cont').textContent =
    pares.length === 1 ? '1 cartão' : pares.length + ' cartões';
  for (const p of pares) grade.append(cardDe(p.item, varias ? p.empresa : null));
}

function atualizarKpis() {
  const pares = haEscopo() ? paresVisiveis() : [];
  const sim = pares.filter((p) => p.item.valor === 'sim').length;
  const nao = pares.filter((p) => p.item.valor === 'nao').length;
  const branco = pares.length - sim - nao;

  qs('#kpi-ok').textContent = pares.length ? sim : '—';
  qs('#kpi-nao').textContent = pares.length ? nao : '—';
  qs('#kpi-branco').textContent = pares.length ? branco : '—';

  const pct = pares.length ? Math.round((sim / pares.length) * 100) : 0;
  const texto = `${sim} de ${pares.length} conferidos (${pct}%)`;
  qs('#barra-i').style.width = pct + '%';
  qs('#progresso-txt').textContent = texto;
  qs('#escopo-barra').style.width = pct + '%';
  qs('#escopo-progresso').textContent = texto;
}

/* --------------------------------------------------------- cards -------- */
function cardDe(it, empresaDoCard) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = it.id;
  card.setAttribute('data-v', it.valor || '');

  const h = document.createElement('div');
  h.className = 'card-h';

  /* Todo card e editavel: o que vale numa empresa nao vale em outra.
     O flag `padrao` fica so como procedencia, nao trava mais nada. */
  const t = document.createElement('button');
  t.type = 'button';
  t.className = 'card-t';
  t.textContent = it.item;
  t.title = 'Clique para renomear';
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'card-x';
  x.title = 'Excluir este item';
  h.append(t, x);

  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const v of ['sim', 'nao']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = v;
    b.dataset.v = v;
    b.textContent = v === 'sim' ? 'Sim' : 'Não';
    if (it.valor === v) b.setAttribute('data-on', '');
    seg.append(b);
  }

  const mt = document.createElement('div');
  mt.className = 'meses-t';
  mt.append(
    Object.assign(document.createElement('span'), { textContent: 'Meses' }),
    Object.assign(document.createElement('b'), { textContent: String(ANO) })
  );

  const meses = document.createElement('div');
  meses.className = 'meses';
  MESES.forEach((nome, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mes';
    b.dataset.mes = chaveMes(i);
    b.textContent = nome;
    meses.append(b);
  });

  const ta = document.createElement('textarea');
  ta.className = 'card-obs';
  ta.placeholder = 'Observação sobre este item…';
  ta.value = it.observacao || '';
  ta.setAttribute('aria-label', 'Observação sobre ' + it.item);

  const pe = document.createElement('div');
  pe.className = 'card-pe card-pe-linha';
  pe.append(Object.assign(document.createElement('span'), {
    className: 'card-quando',
    textContent: it.atualizado_em ? 'Atualizado em ' + agora(it.atualizado_em) : ''
  }));
  const na = document.createElement('button');
  na.type = 'button';
  na.className = 'card-na';
  na.textContent = it.aplica === false ? 'reativar' : 'não se aplica';
  pe.append(na);

  if (empresaDoCard) {
    /* com varias empresas na tela, o cartao precisa dizer de quem ele e */
    const et = document.createElement('span');
    et.className = 'card-empresa';
    et.textContent = empresaDoCard.codigo + ' · ' + empresaDoCard.empresa;
    et.title = empresaDoCard.grupo + (empresaDoCard.regional ? ' · ' + empresaDoCard.regional : '');
    card.append(et);
  }

  card.append(h, seg, mt, meses, ta, pe);
  pintarMeses(card, it);
  return card;
}

function pintarMeses(card, it) {
  const m = it.meses || {};
  qsa('.mes', card).forEach((b, i) => {
    const v = m[b.dataset.mes];
    if (v) b.setAttribute('data-m', v); else b.removeAttribute('data-m');
    b.title = `${MESES_LONGO[i]} de ${ANO} — ` +
      (v === 'tem' ? 'tem' : v === 'nao' ? 'não tem' : 'não avaliado');
  });
}

function cardNovo() {
  const el = document.createElement('div');
  el.className = 'card-novo';
  el.id = 'card-novo';
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.append(
    Object.assign(document.createElement('span'), { className: 'mais', textContent: '+' }),
    Object.assign(document.createElement('span'), { textContent: 'Adicionar item' })
  );
  return el;
}

function abrirFormNovo() {
  const el = qs('#card-novo');
  if (!el || el.hasAttribute('data-editando')) return;
  el.setAttribute('data-editando', '');
  el.removeAttribute('role');
  el.tabIndex = -1;
  el.textContent = '';

  const t = Object.assign(document.createElement('span'), { className: 'card-t', textContent: 'Novo item' });
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.id = 'novo-nome';
  inp.maxLength = 60;
  inp.placeholder = 'Ex.: Provisão de férias';
  inp.autocomplete = 'off';
  const erro = Object.assign(document.createElement('p'), { className: 'novo-erro', id: 'novo-erro' });
  const acoes = document.createElement('div');
  acoes.className = 'novo-acoes';
  const salvar = Object.assign(document.createElement('button'),
    { type: 'button', className: 'btn primary small', id: 'novo-salvar', textContent: 'Salvar' });
  const cancelar = Object.assign(document.createElement('button'),
    { type: 'button', className: 'btn ghost small', id: 'novo-cancelar', textContent: 'Cancelar' });
  acoes.append(salvar, cancelar);

  el.append(t, inp, erro, acoes);
  inp.focus();
}

function fecharFormNovo() {
  const el = qs('#card-novo');
  if (!el) return;
  el.replaceWith(cardNovo());
}


function repintarCard(it) {
  const card = qs(`.card[data-id="${CSS.escape(it.id)}"]`);
  if (!card) return;
  card.setAttribute('data-v', it.valor || '');
  qsa('.seg button', card).forEach((b) => {
    if (b.dataset.v === it.valor) b.setAttribute('data-on', ''); else b.removeAttribute('data-on');
  });
  /* nulo quando o titulo esta em edicao: nao atropela quem esta digitando.
     Na vista por item o titulo e a empresa, entao nao se mexe nele. */
  const t = qs('.card-t', card);
  if (t && card.dataset.modo !== 'item') t.textContent = it.item;
  const ta = qs('.card-obs', card);
  if (document.activeElement !== ta) ta.value = it.observacao || '';
  pintarMeses(card, it);
  qs('.card-quando', card).textContent =
    it.atualizado_em ? 'Atualizado em ' + agora(it.atualizado_em) : '';
  qs('.card-na', card).textContent = it.aplica === false ? 'reativar' : 'não se aplica';
}

/* ---- renomear o item ---- */
function abrirRenomear(card) {
  const btn = qs('.card-t', card);
  if (!btn) return;                       /* ja esta em edicao */
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'card-t-edit';
  inp.maxLength = 60;
  inp.value = btn.textContent;
  inp.setAttribute('aria-label', 'Renomear item');
  btn.replaceWith(inp);
  inp.focus();
  inp.select();
}

function fecharRenomear(card, nome) {
  const inp = qs('.card-t-edit', card);
  if (!inp) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-t';
  btn.textContent = nome;
  btn.title = 'Clique para renomear';
  inp.replaceWith(btn);
}

/* aoSairDoCampo: no blur nao insistimos — volta ao nome antigo em vez de
   prender a pessoa num campo que ela ja abandonou. */
function renomearItem(card, aoSairDoCampo) {
  const inp = qs('.card-t-edit', card);
  if (!inp) return;
  const it = acharItem(card.dataset.id);
  if (!it) { fecharRenomear(card, ''); return; }

  const novo = inp.value.trim();
  if (!novo || novo === it.item) { fecharRenomear(card, it.item); return; }

  const repetido = (ITENS.get(it.codigo) || [])
    .some((o) => o.id !== it.id && normalizar(o.item) === normalizar(novo));
  if (repetido) {
    if (aoSairDoCampo) { fecharRenomear(card, it.item); return; }
    toast('Já existe um item com esse nome nesta empresa.', 'erro');
    inp.focus();
    inp.select();
    return;
  }

  fecharRenomear(card, novo);
  gravarItem(it.id, { item: novo });
}

/* "Nao se aplica" nao apaga nada: o registro fica, so sai do controle
   daquela empresa e some das contagens. Reativar traz de volta intacto. */
function alternarAplicacao(id) {
  const it = acharItem(id);
  if (!it) return;
  gravarItem(id, { aplica: it.aplica === false });
}

/* nao avaliado -> tem -> nao tem -> nao avaliado */
function alternarMes(id, chave) {
  const it = acharItem(id);
  if (!it) return;
  const atual = (it.meses || {})[chave];
  const proximo = !atual ? 'tem' : atual === 'tem' ? 'nao' : null;
  const meses = { ...(it.meses || {}) };
  if (proximo) meses[chave] = proximo; else delete meses[chave];
  gravarItem(id, { meses });
}

/* --------------------------------------------------------- gravar ------- */
function acharItem(id) {
  for (const lista of ITENS.values()) {
    const it = lista.find((x) => x.id === id);
    if (it) return it;
  }
  return null;
}

async function gravarItem(id, patch) {
  const it = acharItem(id);
  if (!it) return;
  const antes = { ...it };
  /* atualizado_em NAO entra aqui de proposito: quem carimba e o servidor.
     Manter o carimbo antigo garante que o eco que voltar seja sempre mais
     novo que o local, e a comparacao no tempo real resolve a corrida. */
  Object.assign(it, patch);
  /* `aplica` troca o cartao de grade (ativos <-> nao se aplica): repintar no
     lugar nao basta, tem de redesenhar. */
  if ('aplica' in patch) renderCards(); else repintarCard(it);
  atualizarKpis();
  montarSeletorEmpresas();

  sync('salvando');
  const { error } = await sb.from('ctrl_itens')
    .update(patch)
    .eq('id', id);

  if (error) {
    Object.assign(it, antes);
    if ('aplica' in patch) renderCards(); else repintarCard(it);
    atualizarKpis();
    montarSeletorEmpresas();
    sync('erro', error.message);
    toast('Não consegui salvar. Confira a conexão — a alteração foi desfeita.', 'erro');
    return;
  }
  sync('ok');
}

const debounces = new Map();
function agendarObsItem(id, texto) {
  clearTimeout(debounces.get(id));
  sync('salvando');
  debounces.set(id, setTimeout(() => gravarItem(id, { observacao: texto }), 700));
}

/* O item e do catalogo, nao de uma empresa: nasce em todas. Onde nao fizer
   sentido, marca-se "nao se aplica" — que preserva o registro. */
async function criarItem(nome) {
  const limpo = nome.trim();
  const erro = qs('#novo-erro');
  if (!limpo) { erro.textContent = 'Dê um nome ao item.'; return; }
  if (catalogoItens().some((i) => i.chave === normalizar(limpo))) {
    erro.textContent = 'Já existe um item com esse nome.';
    return;
  }

  let maior = 0;
  for (const lista of ITENS.values()) {
    for (const i of lista) maior = Math.max(maior, i.ordem);
  }

  qs('#novo-salvar').disabled = true;
  sync('salvando');

  const linhas = EMPRESAS.map((e) => ({
    codigo: e.codigo, item: limpo, ordem: maior + 1, padrao: false
  }));
  const { data, error } = await sb.from('ctrl_itens')
    .upsert(linhas, { onConflict: 'codigo,item', ignoreDuplicates: true })
    .select();

  if (error) {
    qs('#novo-salvar').disabled = false;
    erro.textContent = 'Não consegui criar o item. Tente de novo.';
    sync('erro', error.message);
    return;
  }
  (data || []).forEach((linha) => aplicarItemLocal('INSERT', linha));
  fecharFormNovo();
  toast(`"${limpo}" criado em ${(data || []).length} empresas.`, 'ok');
  sync('ok');
}

/* Excluir remove o item do catalogo — de todas as empresas, com os dados.
   Para tirar de uma so, o caminho e "nao se aplica". */
async function excluirItem(id) {
  const it = acharItem(id);
  if (!it) return;
  const alvo = normalizar(it.item);
  const ids = [];
  for (const lista of ITENS.values()) {
    for (const x of lista) if (normalizar(x.item) === alvo) ids.push(x.id);
  }

  sync('salvando');
  const { error } = await sb.from('ctrl_itens').delete().in('id', ids);
  if (error) { sync('erro', error.message); toast('Não consegui excluir o item.', 'erro'); return; }
  ids.forEach((i) => aplicarItemLocal('DELETE', { id: i }));
  toast(`"${it.item}" removido de ${ids.length} empresas.`, 'ok');
  sync('ok');
}

/* aplica mudanca de item ao estado local, venha daqui ou do tempo real */
function aplicarItemLocal(tipo, linha) {
  if (tipo === 'DELETE') {
    for (const [cod, lista] of ITENS) {
      const i = lista.findIndex((x) => x.id === linha.id);
      if (i >= 0) {
        lista.splice(i, 1);
        renderCards();
        break;
      }
    }
  } else {
    const lista = ITENS.get(linha.codigo) || [];
    const i = lista.findIndex((x) => x.id === linha.id);
    if (i >= 0) {
      const mudouAplicacao = (lista[i].aplica !== false) !== (linha.aplica !== false);
      lista[i] = linha;
      ITENS.set(linha.codigo, lista);
      if (mudouAplicacao) renderCards();
      else repintarCard(linha);     /* nao faz nada se o card nao esta na tela */
    } else {
      lista.push(linha);
      ITENS.set(linha.codigo, lista);
      renderCards();
    }
  }
  atualizarKpis();
  montarSeletorEmpresas();
  montarListaItens();
}

/* --------------------------------------------------- observacoes -------- */
function renderObs() {
  const lista = qs('#obs-lista');
  lista.textContent = '';
  if (!sel) return;
  for (const o of (OBS.get(sel) || [])) {
    const art = document.createElement('article');
    art.className = 'obs';
    art.dataset.oid = o.id;

    const top = document.createElement('div');
    top.className = 'obs-top';
    top.append(Object.assign(document.createElement('span'), {
      className: 'obs-when',
      textContent: o.editado_em
        ? `${agora(o.criado_em)} · editada em ${agora(o.editado_em)}`
        : agora(o.criado_em)
    }));

    const p = Object.assign(document.createElement('p'), { className: 'obs-text', textContent: o.texto });
    const acts = document.createElement('div');
    acts.className = 'obs-acts';
    acts.append(
      Object.assign(document.createElement('button'), { type: 'button', className: 'obs-edit' }),
      Object.assign(document.createElement('button'), { type: 'button', className: 'obs-del' })
    );
    art.append(top, p, acts);
    lista.append(art);
  }
}

function sairDaEdicaoObs() {
  editandoObsId = null;
  qs('#obs-salvar').textContent = 'Adicionar observação';
  qs('#obs-cancelar').hidden = true;
  qs('#obs-aviso').textContent = '';
}

async function salvarObs() {
  if (!sel) return;
  const texto = qs('#obs-texto').value.trim();
  if (!texto) { qs('#obs-aviso').textContent = 'Escreva a observação antes de salvar.'; return; }
  const btn = qs('#obs-salvar');
  btn.disabled = true;
  sync('salvando');
  try {
    if (editandoObsId) {
      const { data, error } = await sb.from('ctrl_observacoes')
        .update({ texto, editado_em: new Date().toISOString() })
        .eq('id', editandoObsId).select().single();
      if (error) throw error;
      aplicarObsLocal('UPDATE', data);
    } else {
      const { data, error } = await sb.from('ctrl_observacoes')
        .insert({ codigo: sel, texto }).select().single();
      if (error) throw error;
      aplicarObsLocal('INSERT', data);
    }
    qs('#obs-texto').value = '';
    sairDaEdicaoObs();
    sync('ok');
  } catch (err) {
    sync('erro', err.message);
    qs('#obs-aviso').textContent = 'Não consegui salvar a observação. Tente de novo.';
  } finally {
    btn.disabled = false;
  }
}

async function excluirObs(id) {
  sync('salvando');
  const { error } = await sb.from('ctrl_observacoes').delete().eq('id', id);
  if (error) { sync('erro', error.message); toast('Não consegui excluir a observação.', 'erro'); return; }
  aplicarObsLocal('DELETE', { id });
  sync('ok');
}

function aplicarObsLocal(tipo, linha) {
  if (tipo === 'DELETE') {
    for (const lista of OBS.values()) {
      const i = lista.findIndex((o) => o.id === linha.id);
      if (i >= 0) { lista.splice(i, 1); break; }
    }
  } else {
    const lista = OBS.get(linha.codigo) || [];
    const i = lista.findIndex((o) => o.id === linha.id);
    if (i >= 0) lista[i] = linha; else lista.push(linha);
    lista.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
    OBS.set(linha.codigo, lista);
  }
  renderObs();
}

/* ------------------------------------------------------------- PDF ------ */
/* "Meses 2026 — tem: Jan, Fev | não tem: Mar" (vazio se nada foi marcado) */
function resumoMeses(it) {
  const m = it.meses || {};
  const tem = [], nao = [];
  MESES.forEach((nome, i) => {
    const v = m[chaveMes(i)];
    if (v === 'tem') tem.push(nome);
    else if (v === 'nao') nao.push(nome);
  });
  if (!tem.length && !nao.length) return '';
  const p = [];
  if (tem.length) p.push('tem: ' + tem.join(', '));
  if (nao.length) p.push('não tem: ' + nao.join(', '));
  return `Meses ${ANO} — ${p.join('  |  ')}`;
}

function dadosEmpresa(cod) {
  const e = EMPRESAS.find((x) => x.codigo === cod);
  const c = contagem(cod);
  const foraDoControle = (ITENS.get(cod) || []).filter((i) => i.aplica === false).length;
  return {
    empresa: e,
    itens: itensDe(cod).filter((i) => i.aplica !== false).map((i) => ({
      item: i.item, valor: i.valor || '',
      observacao: [resumoMeses(i), i.observacao].filter(Boolean).join('\n'),
      quando: i.atualizado_em ? agora(i.atualizado_em) : ''
    })),
    observacoes: (OBS.get(cod) || []).map((o) => ({
      data: agora(o.criado_em), texto: o.texto
    })),
    resumo: `${c.sim} de ${c.total} itens conferidos · ${c.nao} com pendência`
          + ` · ${c.branco} em branco` + (foraDoControle
            ? ` · ${foraDoControle} não se ${foraDoControle === 1 ? 'aplica' : 'aplicam'}`
            : '')
  };
}

function pdfEmpresa() {
  if (!sel) { toast('Escolha uma empresa primeiro.', 'erro'); return; }
  const d = dadosEmpresa(sel);
  baixar(window.ControlePDF.buildEmpresa({
    ...d,
    emitido: 'Emitido em ' + agora(),
    rodape: 'GrupoPro · Controle de Entregas Contábil — uso interno'
  }), `Controle_${d.empresa.codigo}_${dataArquivo()}.pdf`, 1);
}

function textoFiltros() {
  const p = [];
  if (qs('#f-busca').value.trim()) p.push(`Busca: "${qs('#f-busca').value.trim()}"`);
  if (qs('#f-grupo').value) p.push('Grupo: ' + qs('#f-grupo').value);
  if (qs('#f-regime').value) p.push('Regime: ' + qs('#f-regime').value);
  if (qs('#f-periodo').value) p.push('Periodicidade: ' + qs('#f-periodo').value);
  return p;
}

function pdfSelecao() {
  const pares = paresVisiveis();
  if (!pares.length) { toast('Nenhum cartão nesta seleção.', 'erro'); return; }
  const sim = pares.filter((x) => x.item.valor === 'sim').length;
  const nao = pares.filter((x) => x.item.valor === 'nao').length;
  const c = { total: pares.length, sim, nao, branco: pares.length - sim - nao };
  const p = textoFiltros();
  const linhas = pares;

  baixar(window.ControlePDF.buildItem({
    item: resumoItens(),
    rows: linhas.map((l) => ({
      codigo: l.empresa.codigo,
      empresa: l.empresa.empresa + (l.empresa.grupo ? '  ·  ' + l.empresa.grupo : ''),
      nomeItem: l.item.item,
      valor: l.item.valor || '',
      observacao: [resumoMeses(l.item), l.item.observacao].filter(Boolean).join('\n') || '—',
      quando: l.item.atualizado_em ? agora(l.item.atualizado_em) : '—',
      _situacao: l.item.valor === 'sim' ? 'ok' : l.item.valor === 'nao' ? 'pendente' : 'vazio'
    })),
    emitido: 'Emitido em ' + agora(),
    filtros: p.length ? p.join(' · ') : 'nenhum (todas as empresas)',
    resumo: `${c.total} ${c.total === 1 ? 'cartão' : 'cartões'} · ${c.sim} conferidos`
          + ` · ${c.nao} com pendência · ${c.branco} em branco`,
    rodape: 'GrupoPro · Controle de Entregas Contábil — uso interno'
  }), `Controle_selecao_${dataArquivo()}.pdf`, c.total, ['cartão', 'cartões']);
}

function pdfGeral() {
  const lista = filtradas();
  if (!lista.length) { toast('Nenhuma empresa no filtro.', 'erro'); return; }
  const rows = lista.map((e) => {
    const c = contagem(e.codigo);
    return {
      codigo: e.codigo, empresa: e.empresa,
      grupo: e.grupo + (e.regional ? ' · ' + e.regional : ''),
      regime: e.regime, periodicidade: e.periodicidade,
      sim: c.sim, nao: c.nao, branco: c.branco, total: c.total,
      _situacao: c.nao ? 'pendente' : (c.total && c.sim === c.total) ? 'ok'
               : c.sim ? 'parcial' : 'vazio'
    };
  });
  const p = textoFiltros();

  const ok = rows.filter((r) => r._situacao === 'ok').length;
  const pend = rows.filter((r) => r._situacao === 'pendente').length;

  baixar(window.ControlePDF.buildResumo({
    rows,
    emitido: 'Emitido em ' + agora(),
    filtros: p.length ? p.join(' · ') : 'nenhum (todas as empresas)',
    resumo: `${rows.length} ${rows.length === 1 ? 'empresa' : 'empresas'} · ${ok} completas · ${pend} com pendência`,
    rodape: 'GrupoPro · Controle de Entregas Contábil — uso interno'
  }), `Controle_Entregas_Geral_${dataArquivo()}.pdf`, rows.length);
}

function dataArquivo() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function baixar(bytes, nome, quantos, rotulo) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  const r = rotulo || ['empresa', 'empresas'];
  toast(`PDF gerado (${quantos} ${quantos === 1 ? r[0] : r[1]}).`, 'ok');
}

/* --------------------------------------------------------- eventos ------ */
/* Os filtros de grupo/regime/periodicidade valem para as duas vistas:
   estreitam a lista de empresas e, na vista por item, quais empresas aparecem. */
function aoMudarFiltro() {
  montarSeletorEmpresas();
  montarListaItens();
  render();
}

function ligarEventos() {
  qs('#f-empresa').addEventListener('change', aoMudarFiltro);

  /* multiescolha de itens */
  qs('#itens-lista').addEventListener('change', (ev) => {
    const cx = ev.target.closest('input[type="checkbox"]');
    if (!cx) return;
    if (cx.checked) itensEscolhidos.add(cx.value); else itensEscolhidos.delete(cx.value);
    qs('#itens-resumo').textContent = resumoItens();
    render();
  });
  qs('#itens-busca').addEventListener('input', montarListaItens);
  qs('#f-itens .multi-acoes').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-acao]');
    if (!b) return;
    if (b.dataset.acao === 'todos') {
      itensEscolhidos = new Set(catalogoItens().map((i) => i.chave));
    } else {
      itensEscolhidos.clear();
    }
    montarListaItens();
    render();
  });
  ['f-grupo', 'f-regime', 'f-periodo'].forEach((id) =>
    qs('#' + id).addEventListener('change', aoMudarFiltro));
  qs('#f-busca').addEventListener('input', aoMudarFiltro);

  qs('#btn-pdf').addEventListener('click', () => (sel ? pdfEmpresa() : pdfSelecao()));
  qs('#btn-pdf-geral').addEventListener('click', pdfGeral);

  qs('#obs-salvar').addEventListener('click', salvarObs);
  qs('#obs-cancelar').addEventListener('click', () => { qs('#obs-texto').value = ''; sairDaEdicaoObs(); });

  document.addEventListener('click', (ev) => {
    const t = ev.target;

    const segB = t.closest('.seg button');
    if (segB) {
      const card = segB.closest('.card');
      const atual = card.getAttribute('data-v') || '';
      const clicado = segB.dataset.v;
      gravarItem(card.dataset.id, { valor: atual === clicado ? '' : clicado });
      return;
    }

    const titulo = t.closest('.card-t');
    if (titulo) { abrirRenomear(titulo.closest('.card')); return; }

    const mes = t.closest('.mes');
    if (mes) {
      alternarMes(mes.closest('.card').dataset.id, mes.dataset.mes);
      return;
    }

    const na = t.closest('.card-na');
    if (na) {
      const card = na.closest('.card');
      const it = acharItem(card.dataset.id);
      /* reativar e inofensivo e vai direto; desativar confirma em dois cliques */
      if (it && it.aplica === false) { alternarAplicacao(card.dataset.id); return; }
      if (!na.hasAttribute('data-confirm')) {
        qsa('.card-na[data-confirm]').forEach((b) => {
          b.removeAttribute('data-confirm');
          b.textContent = 'não se aplica';
        });
        na.setAttribute('data-confirm', '');
        na.textContent = 'confirmar';
        setTimeout(() => {
          if (na.isConnected && na.hasAttribute('data-confirm')) {
            na.removeAttribute('data-confirm');
            na.textContent = 'não se aplica';
          }
        }, 4000);
        return;
      }
      alternarAplicacao(card.dataset.id);
      return;
    }

    const x = t.closest('.card-x');
    if (x) {
      if (!x.hasAttribute('data-confirm')) {
        qsa('.card-x[data-confirm]').forEach((b) => b.removeAttribute('data-confirm'));
        x.setAttribute('data-confirm', '');
        setTimeout(() => x.removeAttribute('data-confirm'), 4000);
        return;
      }
      excluirItem(x.closest('.card').dataset.id);
      return;
    }

    if (t.closest('#novo-salvar')) { criarItem(qs('#novo-nome').value); return; }
    if (t.closest('#novo-cancelar')) { fecharFormNovo(); return; }
    if (t.closest('#card-novo')) { abrirFormNovo(); return; }

    const ed = t.closest('.obs-edit');
    if (ed) {
      const art = ed.closest('.obs');
      editandoObsId = art.dataset.oid;
      qs('#obs-texto').value = qs('.obs-text', art).textContent;
      qs('#obs-salvar').textContent = 'Salvar alteração';
      qs('#obs-cancelar').hidden = false;
      qs('#obs-texto').focus();
      return;
    }

    const del = t.closest('.obs-del');
    if (del) {
      if (!del.hasAttribute('data-confirm')) {
        qsa('.obs-del[data-confirm]').forEach((b) => b.removeAttribute('data-confirm'));
        del.setAttribute('data-confirm', '');
        setTimeout(() => del.removeAttribute('data-confirm'), 4000);
        return;
      }
      const id = del.closest('.obs').dataset.oid;
      if (editandoObsId === id) { qs('#obs-texto').value = ''; sairDaEdicaoObs(); }
      excluirObs(id);
    }
  });

  document.addEventListener('input', (ev) => {
    const ta = ev.target.closest('.card-obs');
    if (ta) { agendarObsItem(ta.closest('.card').dataset.id, ta.value); return; }
    if (ev.target.id === 'obs-texto') qs('#obs-aviso').textContent = '';
  });

  /* focusout sobe na arvore; blur nao — por isso o listener e neste evento */
  document.addEventListener('focusout', (ev) => {
    const inp = ev.target.closest && ev.target.closest('.card-t-edit');
    if (inp) renomearItem(inp.closest('.card'), true);
  });

  document.addEventListener('keydown', (ev) => {
    const inp = ev.target.closest && ev.target.closest('.card-t-edit');
    if (inp) {
      const card = inp.closest('.card');
      if (ev.key === 'Enter') { ev.preventDefault(); renomearItem(card, false); }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        const it = acharItem(card.dataset.id);
        fecharRenomear(card, it ? it.item : '');
      }
      return;
    }
    if (ev.target.id === 'novo-nome') {
      if (ev.key === 'Enter') { ev.preventDefault(); criarItem(ev.target.value); }
      if (ev.key === 'Escape') { ev.preventDefault(); fecharFormNovo(); }
    }
    if (ev.key === 'Enter' && ev.target.id === 'card-novo') { ev.preventDefault(); abrirFormNovo(); }
  });

  addEventListener('online', () => sync('ok'));
  addEventListener('offline', () => sync('offline'));
}

/* ---------------------------------------------------------- inicio ------ */
let canalRealtime = null;
function ouvirTempoReal() {
  /* Assinar duas vezes o mesmo canal derruba o tempo real:
     "cannot add postgres_changes callbacks after subscribe()". Acontece de
     verdade quando alguem troca a senha ja dentro do app, porque esse fluxo
     volta por depoisDoLogin(). */
  if (canalRealtime) return;
  canalRealtime = sb.channel('controle-entregas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ctrl_itens' }, (p) => {
      if (p.eventType === 'DELETE') { aplicarItemLocal('DELETE', p.old); return; }
      /* Descarta eco atrasado: so aplica o que for mais novo que o local.
         Todos os carimbos vem do relogio do servidor, entao da para comparar. */
      const atual = acharItem(p.new.id);
      if (atual && atual.atualizado_em && p.new.atualizado_em <= atual.atualizado_em) return;
      aplicarItemLocal(p.eventType, p.new);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ctrl_observacoes' },
      (p) => aplicarObsLocal(p.eventType, p.eventType === 'DELETE' ? p.old : p.new))
    .subscribe();
}

let dadosCarregados = false;
async function carregarDados() {
  /* trocar senha estando logado passa por aqui de novo: nao vale recarregar
     a carteira inteira, so voltar a desenhar. */
  if (dadosCarregados) { render(); return; }

  const [emp, itens, obs] = await Promise.all([
    sb.from('ctrl_empresas').select('*').order('ordem'),
    sb.from('ctrl_itens').select('*'),
    sb.from('ctrl_observacoes').select('*').order('criado_em')
  ]);

  const falha = emp.error || itens.error || obs.error;
  if (falha) {
    sync('erro', falha.message);
    avisar('Não consegui carregar os dados do servidor. Recarregue a página; se insistir, me avise.');
    return;
  }

  EMPRESAS = emp.data.map((e) => ({
    ...e,
    _busca: normalizar([e.codigo, e.empresa, e.cnpj, e.grupo, e.regional].join(' '))
  }));
  itens.data.forEach((i) => {
    const l = ITENS.get(i.codigo) || []; l.push(i); ITENS.set(i.codigo, l);
  });
  obs.data.forEach((o) => {
    const l = OBS.get(o.codigo) || []; l.push(o); OBS.set(o.codigo, l);
  });

  preencherSelect('#f-grupo', EMPRESAS.map((e) => e.grupo), 'Todos');
  preencherSelect('#f-regime', EMPRESAS.map((e) => e.regime), 'Todos');
  preencherSelect('#f-periodo', EMPRESAS.map((e) => e.periodicidade), 'Todas');

  let inicial = null;
  try { inicial = localStorage.getItem(K_SEL); } catch { /* privado */ }
  if (inicial && EMPRESAS.some((e) => e.codigo === inicial)) sel = inicial;

  montarSeletorEmpresas();
  dadosCarregados = true;
  montarListaItens();
  if (sel) qs('#f-empresa').value = sel;
  render();
  ouvirTempoReal();
  sync('ok');
}


/* ===== acesso ============================================================= */
/* O usuario digita "nome.sobrenome"; o Auth trabalha com e-mail, entao o
   dominio interno e colado por baixo. Nenhum e-mail e enviado: as contas ja
   nascem confirmadas pela Edge Function. */
const DOMINIO = '@controle.proativaaccounting.com.br';
const SENHA_PADRAO = '123456';
let EU = null;

function mostrar(tela) {
  qs('#portao-login').hidden = tela !== 'login';
  qs('#portao-senha').hidden = tela !== 'senha';
  qs('#app').hidden = tela !== 'app';
}

async function perfilDe(uid) {
  const { data } = await sb.from('ctrl_usuarios').select('*').eq('id', uid).single();
  return data || null;
}

async function entrar(ev) {
  ev.preventDefault();
  const erro = qs('#login-erro');
  erro.textContent = '';
  const usuario = qs('#login-usuario').value.trim().toLowerCase();
  const senha = qs('#login-senha').value;
  if (!usuario || !senha) { erro.textContent = 'Preencha usuário e senha.'; return; }

  const btn = qs('#login-entrar');
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  const { data, error } = await sb.auth.signInWithPassword({
    email: usuario.includes('@') ? usuario : usuario + DOMINIO,
    password: senha
  });
  btn.disabled = false;
  btn.textContent = 'Entrar';

  if (error) {
    erro.textContent = 'Usuário ou senha incorretos.';
    qs('#login-senha').value = '';
    qs('#login-senha').focus();
    return;
  }
  await depoisDoLogin(data.user);
}

async function depoisDoLogin(user) {
  EU = await perfilDe(user.id);
  if (!EU) {
    await sb.auth.signOut();
    mostrar('login');
    qs('#login-erro').textContent =
      'Este acesso existe, mas está sem perfil. Peça a um administrador para recriá-lo.';
    return;
  }

  if (EU.trocar_senha) {
    mostrar('senha');
    qs('#senha-nova').focus();
    return;
  }

  const chip = qs('#sessao-nome');
  chip.textContent = EU.usuario;
  if (EU.admin) chip.append(Object.assign(document.createElement('b'), { textContent: 'admin' }));
  qs('#btn-usuarios').hidden = !EU.admin;

  mostrar('app');
  await carregarDados();
}

async function salvarNovaSenha(ev) {
  ev.preventDefault();
  const erro = qs('#senha-erro');
  erro.textContent = '';
  const nova = qs('#senha-nova').value;
  const repete = qs('#senha-repete').value;

  if (nova.length < 6) { erro.textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; }
  if (nova !== repete) { erro.textContent = 'As duas senhas não estão iguais.'; return; }
  /* unica regra alem do tamanho: repetir a inicial anularia a troca obrigatoria */
  if (nova === SENHA_PADRAO) { erro.textContent = 'Escolha uma senha diferente da inicial.'; return; }

  const btn = qs('#senha-salvar');
  btn.disabled = true;
  const { error } = await sb.auth.updateUser({ password: nova });
  if (error) {
    btn.disabled = false;
    erro.textContent = 'Não consegui salvar a senha. Tente de novo.';
    return;
  }
  await sb.from('ctrl_usuarios').update({ trocar_senha: false }).eq('id', EU.id);
  btn.disabled = false;
  qs('#senha-nova').value = '';
  qs('#senha-repete').value = '';
  EU.trocar_senha = false;
  await depoisDoLogin({ id: EU.id });
}

async function sair() {
  await sb.auth.signOut();
  location.reload();
}

/* ---------- administracao de acessos ---------- */
/* fetch explicito em vez de sb.functions.invoke: o invoke nao estava
   mandando o token da sessao, e sem ele a funcao (com razao) recusa. */
async function chamarAdmin(corpo) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Sessão expirada. Entre novamente.');

  const resp = await fetch(SUPABASE_URL + '/functions/v1/admin-usuarios', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY
    },
    body: JSON.stringify(corpo)
  });

  let json = null;
  try { json = await resp.json(); } catch { /* resposta sem corpo */ }
  if (!resp.ok || (json && json.erro)) {
    throw new Error((json && json.erro) || 'Não consegui completar a operação.');
  }
  return json;
}

function botaoAcao(acao, rotulo) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small';
  b.dataset.acao = acao;
  b.textContent = rotulo;
  return b;
}

function linhaUsuario(u) {
  const el = document.createElement('div');
  el.className = 'usuario-linha';
  el.dataset.id = u.id;

  const ident = document.createElement('div');
  ident.className = 'usuario-id';
  ident.append(
    Object.assign(document.createElement('span'), { className: 'usuario-login', textContent: u.usuario }),
    Object.assign(document.createElement('span'), { className: 'usuario-nome', textContent: u.nome || '—' })
  );
  el.append(ident);

  if (u.admin) {
    el.append(Object.assign(document.createElement('span'),
      { className: 'marca-admin', textContent: 'admin' }));
  }
  if (u.trocar_senha) {
    el.append(Object.assign(document.createElement('span'),
      { className: 'marca-pendente', textContent: 'senha inicial' }));
  }

  const acoes = document.createElement('div');
  acoes.className = 'usuario-acoes';
  acoes.append(botaoAcao('resetar', 'Resetar senha'));
  if (u.id !== EU.id) {
    acoes.append(botaoAcao('promover', u.admin ? 'Tirar admin' : 'Tornar admin'));
    acoes.append(botaoAcao('excluir', 'Excluir'));
  }
  el.append(acoes);
  return el;
}

async function renderUsuarios() {
  const lista = qs('#usuarios-lista');
  lista.textContent = 'Carregando…';
  const { data, error } = await sb.from('ctrl_usuarios').select('*').order('usuario');
  lista.textContent = '';
  if (error) { lista.textContent = 'Não consegui carregar os acessos.'; return; }
  data.forEach((u) => lista.append(linhaUsuario(u)));
}

async function acaoUsuario(botao) {
  const id = botao.closest('.usuario-linha').dataset.id;
  const acao = botao.dataset.acao;
  const erro = qs('#usuarios-erro');
  erro.textContent = '';

  /* excluir e resetar confirmam em dois cliques, como no resto do app */
  if ((acao === 'excluir' || acao === 'resetar') && !botao.hasAttribute('data-confirm')) {
    qsa('.usuario-acoes [data-confirm]').forEach((b) => {
      b.removeAttribute('data-confirm');
      if (b.dataset.rotulo) b.textContent = b.dataset.rotulo;
    });
    botao.dataset.rotulo = botao.textContent;
    botao.setAttribute('data-confirm', '');
    botao.textContent = acao === 'excluir' ? 'Confirmar exclusão' : 'Confirmar reset';
    setTimeout(() => {
      if (botao.isConnected && botao.hasAttribute('data-confirm')) {
        botao.removeAttribute('data-confirm');
        botao.textContent = botao.dataset.rotulo;
      }
    }, 4000);
    return;
  }

  botao.disabled = true;
  try {
    if (acao === 'resetar') {
      await chamarAdmin({ acao: 'resetar', id });
      toast('Senha redefinida para ' + SENHA_PADRAO + '. A pessoa troca no próximo acesso.', 'ok');
    } else if (acao === 'excluir') {
      await chamarAdmin({ acao: 'excluir', id });
      toast('Acesso removido.', 'ok');
    } else if (acao === 'promover') {
      await chamarAdmin({ acao: 'promover', id, admin: botao.textContent.startsWith('Tornar') });
    }
    await renderUsuarios();
  } catch (e) {
    erro.textContent = e.message;
    botao.disabled = false;
  }
}

async function criarUsuario(ev) {
  ev.preventDefault();
  const erro = qs('#usuarios-erro');
  erro.textContent = '';
  const usuario = qs('#novo-usuario').value.trim().toLowerCase();
  const nome = qs('#novo-nome-pessoa').value.trim();
  const admin = qs('#novo-admin').checked;

  const btn = qs('#novo-criar');
  btn.disabled = true;
  try {
    await chamarAdmin({ acao: 'criar', usuario, nome, admin });
    qs('#novo-usuario').value = '';
    qs('#novo-nome-pessoa').value = '';
    qs('#novo-admin').checked = false;
    await renderUsuarios();
    toast('Acesso "' + usuario + '" criado. Senha inicial ' + SENHA_PADRAO + '.', 'ok');
  } catch (e) {
    erro.textContent = e.message;
  }
  btn.disabled = false;
}

function ligarEventosAcesso() {
  qs('#form-login').addEventListener('submit', entrar);
  qs('#form-senha').addEventListener('submit', salvarNovaSenha);
  qs('#senha-sair').addEventListener('click', sair);
  qs('#btn-sair').addEventListener('click', sair);

  qs('#btn-trocar-senha').addEventListener('click', () => {
    qs('#senha-explica').textContent = 'Escolha a nova senha para o seu acesso.';
    qs('#senha-erro').textContent = '';
    mostrar('senha');
    qs('#senha-nova').focus();
  });

  qs('#btn-usuarios').addEventListener('click', async () => {
    qs('#usuarios-erro').textContent = '';
    await renderUsuarios();
    qs('#dlg-usuarios').showModal();
  });
  qs('#usuarios-fechar').addEventListener('click', () => qs('#dlg-usuarios').close());
  qs('#form-novo-usuario').addEventListener('submit', criarUsuario);
  qs('#usuarios-lista').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-acao]');
    if (b) acaoUsuario(b);
  });

  /* sessao encerrada em outra aba ou expirada */
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') location.reload();
  });
}

/* ---------- tema ---------- */
/* Tres posicoes, e o padrao e seguir o sistema. Sem a opcao "Sistema" a
   pessoa que escolhesse uma vez ficaria presa nela para sempre.
   Sem atributo no <html>, o CSS cai na media query e acompanha o SO ao vivo. */
const K_TEMA = 'gp.controle.tema';

function aplicarTema(escolha) {
  const raiz = document.documentElement;
  if (escolha === 'light' || escolha === 'dark') raiz.setAttribute('data-theme', escolha);
  else { raiz.removeAttribute('data-theme'); escolha = 'sistema'; }

  try {
    if (escolha === 'sistema') localStorage.removeItem(K_TEMA);
    else localStorage.setItem(K_TEMA, escolha);
  } catch { /* navegador em modo privado */ }

  qsa('#tema button').forEach((b) => {
    if (b.dataset.tema === escolha) b.setAttribute('data-ativo', '');
    else b.removeAttribute('data-ativo');
  });
}

function ligarTema() {
  let salvo = null;
  try { salvo = localStorage.getItem(K_TEMA); } catch { /* modo privado */ }
  aplicarTema(salvo || 'sistema');
  qs('#tema').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-tema]');
    if (b) aplicarTema(b.dataset.tema);
  });
}

async function arrancar() {
  ligarTema();
  ligarEventos();
  ligarEventosAcesso();
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    mostrar('login');
    qs('#login-usuario').focus();
    return;
  }
  await depoisDoLogin(data.session.user);
}

arrancar();
