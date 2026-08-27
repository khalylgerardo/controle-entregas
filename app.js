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
let selItem = null;           // chave normalizada do item aberto (vista por item)
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
  const l = ITENS.get(cod) || [];
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
    const it = (ITENS.get(e.codigo) || []).find((x) => normalizar(x.item) === chave);
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
  const lista = filtradas();
  el.textContent = '';
  el.append(new Option(lista.length ? '— escolha a empresa —' : '— nenhuma empresa no filtro —', ''));
  for (const e of lista) {
    const c = contagem(e.codigo);
    const marca = c.nao ? '!' : (c.total && c.sim === c.total) ? '✓' : '·';
    el.append(new Option(`${marca}  ${e.codigo} — ${e.empresa}`, e.codigo));
  }
  qs('#contagem').textContent = lista.length === EMPRESAS.length
    ? `${EMPRESAS.length} empresas`
    : `${lista.length} de ${EMPRESAS.length} empresas`;
  if (sel && lista.some((e) => e.codigo === sel)) el.value = sel;
  else el.value = '';
}

function montarSeletorItens() {
  const el = qs('#f-item');
  const lista = catalogoItens();
  el.textContent = '';
  el.append(new Option('— ver por item —', ''));
  for (const i of lista) {
    const c = contagemItem(i.chave);
    const marca = c.nao ? '!' : (c.total && c.sim === c.total) ? '✓' : '·';
    el.append(new Option(`${marca}  ${i.nome}  (${c.total})`, i.chave));
  }
  el.value = selItem || '';
}

/* --------------------------------------------------------- ficha -------- */
function abrir(cod) {
  selItem = null;
  qs('#f-item').value = '';
  sel = cod || null;
  try { sel ? localStorage.setItem(K_SEL, sel) : localStorage.removeItem(K_SEL); } catch { /* privado */ }

  const e = EMPRESAS.find((x) => x.codigo === sel);
  qs('#vazio').hidden = !!e;
  qs('#conteudo').hidden = !e;
  if (!e) { atualizarKpis(); return; }

  qs('#ficha-empresa').hidden = false;
  qs('#ficha-item').hidden = true;
  qs('#bloco-obs').hidden = false;
  qs('#titulo-cards').textContent = 'Itens de conferência';
  qs('#btn-pdf').textContent = 'PDF da empresa';

  qs('#ficha-cod').textContent = 'Código ' + e.codigo;
  qs('#ficha-nome').textContent = e.empresa;
  qs('#ficha-cnpj').textContent = e.cnpj || '—';
  qs('#ficha-grupo').textContent = e.grupo + (e.regional ? ' · ' + e.regional : '');
  qs('#ficha-regime').textContent = e.regime + (e.atividade ? ' · ' + e.atividade : '');
  qs('#ficha-periodo').textContent = e.periodicidade;

  renderCards();
  renderObs();
  sairDaEdicaoObs();
  qs('#obs-texto').value = '';
  atualizarKpis();
}

/* Vista por item: um card por empresa que tem aquele item. */
function abrirItem(chave) {
  sel = null;
  qs('#f-empresa').value = '';
  try { localStorage.removeItem(K_SEL); } catch { /* privado */ }
  selItem = chave || null;

  const reg = selItem ? catalogoItens().find((i) => i.chave === selItem) : null;
  qs('#vazio').hidden = !!reg;
  qs('#conteudo').hidden = !reg;
  if (!reg) { atualizarKpis(); return; }

  qs('#ficha-empresa').hidden = true;
  qs('#ficha-item').hidden = false;
  qs('#bloco-obs').hidden = true;          /* observacao geral e da empresa */
  qs('#titulo-cards').textContent = 'Empresas';
  qs('#btn-pdf').textContent = 'PDF do item';

  qs('#item-nome').textContent = reg.nome;
  renderCards();
  atualizarKpis();
}

function atualizarKpis() {
  if (selItem) {
    const c = contagemItem(selItem);
    qs('#kpi-ok').textContent = c.sim;
    qs('#kpi-nao').textContent = c.nao;
    qs('#kpi-branco').textContent = c.branco;
    const pct = c.total ? Math.round((c.sim / c.total) * 100) : 0;
    qs('#item-barra').style.width = pct + '%';
    qs('#item-quantas').textContent = c.total;
    qs('#item-progresso').textContent =
      `${c.sim} de ${c.total} ${c.total === 1 ? 'empresa conferida' : 'empresas conferidas'} (${pct}%)`;
    return;
  }
  if (!sel) {
    qs('#kpi-ok').textContent = '—';
    qs('#kpi-nao').textContent = '—';
    qs('#kpi-branco').textContent = '—';
    return;
  }
  const c = contagem(sel);
  qs('#kpi-ok').textContent = c.sim;
  qs('#kpi-nao').textContent = c.nao;
  qs('#kpi-branco').textContent = c.branco;
  const pct = c.total ? Math.round((c.sim / c.total) * 100) : 0;
  qs('#barra-i').style.width = pct + '%';
  qs('#progresso-txt').textContent = `${c.sim} de ${c.total} itens conferidos (${pct}%)`;
}

/* --------------------------------------------------------- cards -------- */
function cardDe(it, empresaDoCard) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = it.id;
  card.setAttribute('data-v', it.valor || '');

  const h = document.createElement('div');
  h.className = 'card-h';

  if (empresaDoCard) {
    /* vista por item: o titulo e a empresa. Renomear e excluir sao acoes
       sobre o ITEM e ficariam ambiguas aqui, entao nao aparecem. */
    card.dataset.modo = 'item';
    const t = document.createElement('span');
    t.className = 'card-t card-t-fixo';
    t.textContent = empresaDoCard.codigo + ' — ' + empresaDoCard.empresa;
    t.title = empresaDoCard.grupo + (empresaDoCard.regional ? ' · ' + empresaDoCard.regional : '');
    h.append(t);
  } else {
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
  }

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

  const pe = document.createElement('p');
  pe.className = 'card-pe';
  pe.textContent = it.atualizado_em ? 'Atualizado em ' + agora(it.atualizado_em) : '';

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

function renderCards() {
  const grade = qs('#cards');
  grade.textContent = '';

  if (selItem) {
    const linhas = linhasDoItem(selItem);
    for (const l of linhas) grade.append(cardDe(l.item, l.empresa));
    if (!linhas.length) {
      grade.append(Object.assign(document.createElement('p'), {
        className: 'vazio-selecao',
        textContent: 'Nenhuma empresa do filtro tem este item.'
      }));
    }
    return;                                /* nao ha "+" aqui: item ja existe */
  }

  if (!sel) return;
  for (const it of itensDe(sel)) grade.append(cardDe(it));
  grade.append(cardNovo());
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
  qs('.card-pe', card).textContent = it.atualizado_em ? 'Atualizado em ' + agora(it.atualizado_em) : '';
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
  repintarCard(it);
  atualizarKpis();
  montarSeletorEmpresas();

  sync('salvando');
  const { error } = await sb.from('ctrl_itens')
    .update(patch)
    .eq('id', id);

  if (error) {
    Object.assign(it, antes);
    repintarCard(it);
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

async function criarItem(nome) {
  const limpo = nome.trim();
  const erro = qs('#novo-erro');
  if (!limpo) { erro.textContent = 'Dê um nome ao item.'; return; }
  const existe = (ITENS.get(sel) || []).some(
    (i) => normalizar(i.item) === normalizar(limpo));
  if (existe) { erro.textContent = 'Já existe um item com esse nome nesta empresa.'; return; }

  const maior = (ITENS.get(sel) || []).reduce((a, i) => Math.max(a, i.ordem), 0);
  qs('#novo-salvar').disabled = true;
  sync('salvando');

  const { data, error } = await sb.from('ctrl_itens').insert({
    codigo: sel, item: limpo, ordem: maior + 1, padrao: false
  }).select().single();

  if (error) {
    qs('#novo-salvar').disabled = false;
    erro.textContent = 'Não consegui criar o item. Tente de novo.';
    sync('erro', error.message);
    return;
  }
  aplicarItemLocal('INSERT', data);
  fecharFormNovo();
  sync('ok');
}

async function excluirItem(id) {
  const it = acharItem(id);
  if (!it) return;
  sync('salvando');
  const { error } = await sb.from('ctrl_itens').delete().eq('id', id);
  if (error) { sync('erro', error.message); toast('Não consegui excluir o item.', 'erro'); return; }
  aplicarItemLocal('DELETE', { id });
  sync('ok');
}

/* aplica mudanca de item ao estado local, venha daqui ou do tempo real */
function aplicarItemLocal(tipo, linha) {
  if (tipo === 'DELETE') {
    for (const [cod, lista] of ITENS) {
      const i = lista.findIndex((x) => x.id === linha.id);
      if (i >= 0) {
        lista.splice(i, 1);
        if (cod === sel || selItem) renderCards();
        break;
      }
    }
  } else {
    const lista = ITENS.get(linha.codigo) || [];
    const i = lista.findIndex((x) => x.id === linha.id);
    if (i >= 0) {
      lista[i] = linha;
      ITENS.set(linha.codigo, lista);
      repintarCard(linha);          /* nao faz nada se o card nao esta na tela */
    } else {
      lista.push(linha);
      ITENS.set(linha.codigo, lista);
      if (linha.codigo === sel || selItem) renderCards();
    }
  }
  atualizarKpis();
  montarSeletorEmpresas();
  montarSeletorItens();
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
  return {
    empresa: e,
    itens: itensDe(cod).map((i) => ({
      item: i.item, valor: i.valor || '',
      observacao: [resumoMeses(i), i.observacao].filter(Boolean).join('\n'),
      quando: i.atualizado_em ? agora(i.atualizado_em) : ''
    })),
    observacoes: (OBS.get(cod) || []).map((o) => ({
      data: agora(o.criado_em), texto: o.texto
    })),
    resumo: `${c.sim} de ${c.total} itens conferidos · ${c.nao} com pendência · ${c.branco} em branco`
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

function pdfItem() {
  const reg = catalogoItens().find((i) => i.chave === selItem);
  if (!reg) { toast('Escolha um item primeiro.', 'erro'); return; }
  const linhas = linhasDoItem(selItem);
  if (!linhas.length) { toast('Nenhuma empresa do filtro tem este item.', 'erro'); return; }
  const c = contagemItem(selItem);
  const p = textoFiltros();

  baixar(window.ControlePDF.buildItem({
    item: reg.nome,
    rows: linhas.map((l) => ({
      codigo: l.empresa.codigo,
      empresa: l.empresa.empresa + (l.empresa.grupo ? '  ·  ' + l.empresa.grupo : ''),
      valor: l.item.valor || '',
      observacao: [resumoMeses(l.item), l.item.observacao].filter(Boolean).join('\n') || '—',
      quando: l.item.atualizado_em ? agora(l.item.atualizado_em) : '—',
      _situacao: l.item.valor === 'sim' ? 'ok' : l.item.valor === 'nao' ? 'pendente' : 'vazio'
    })),
    emitido: 'Emitido em ' + agora(),
    filtros: p.length ? p.join(' · ') : 'nenhum (todas as empresas)',
    resumo: `${c.total} ${c.total === 1 ? 'empresa' : 'empresas'} · ${c.sim} conferidas`
          + ` · ${c.nao} com pendência · ${c.branco} em branco`,
    rodape: 'GrupoPro · Controle de Entregas Contábil — uso interno'
  }), `Controle_item_${reg.nome.replace(/[^A-Za-z0-9]+/g, '-')}_${dataArquivo()}.pdf`, c.total);
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

function baixar(bytes, nome, quantos) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`PDF gerado (${quantos} ${quantos === 1 ? 'empresa' : 'empresas'}).`, 'ok');
}

/* --------------------------------------------------------- eventos ------ */
/* Os filtros de grupo/regime/periodicidade valem para as duas vistas:
   estreitam a lista de empresas e, na vista por item, quais empresas aparecem. */
function aoMudarFiltro() {
  montarSeletorEmpresas();
  montarSeletorItens();
  if (selItem) { renderCards(); atualizarKpis(); }
}

function ligarEventos() {
  qs('#f-empresa').addEventListener('change', (ev) => abrir(ev.target.value));
  qs('#f-item').addEventListener('change', (ev) => abrirItem(ev.target.value));
  ['f-grupo', 'f-regime', 'f-periodo'].forEach((id) =>
    qs('#' + id).addEventListener('change', aoMudarFiltro));
  qs('#f-busca').addEventListener('input', aoMudarFiltro);

  qs('#btn-pdf').addEventListener('click', () => (selItem ? pdfItem() : pdfEmpresa()));
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
function ouvirTempoReal() {
  sb.channel('controle-entregas')
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

async function carregarDados() {
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
  montarSeletorItens();
  abrir(sel);
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
