/* Controle de Entregas — GrupoPro
   Uma empresa por vez: seletor no topo, itens de conferencia em cards.
   Front-end estatico (GitHub Pages) sobre Postgres (Supabase).
   Sem login por decisao do time: a chave abaixo e publica de proposito e so
   alcanca as tabelas ctrl_*, que tem politica liberada. As demais tabelas do
   banco exigem usuario autenticado e permanecem inacessiveis por ela. */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://czbumtufqxbbvfbmjzdt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wRmo_lZyNkQx0OuD1OOeXg_75Aj13pT';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
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
  const l = ITENS.get(cod) || [];
  return {
    total: l.length,
    sim: l.filter((i) => i.valor === 'sim').length,
    nao: l.filter((i) => i.valor === 'nao').length,
    branco: l.filter((i) => !i.valor).length
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

/* --------------------------------------------------------- ficha -------- */
function abrir(cod) {
  sel = cod || null;
  try { sel ? localStorage.setItem(K_SEL, sel) : localStorage.removeItem(K_SEL); } catch { /* privado */ }

  const e = EMPRESAS.find((x) => x.codigo === sel);
  qs('#vazio').hidden = !!e;
  qs('#conteudo').hidden = !e;
  if (!e) { atualizarKpis(); return; }

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

function atualizarKpis() {
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
function cardDe(it) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = it.id;
  card.setAttribute('data-v', it.valor || '');

  /* Todo card e editavel: o que vale numa empresa nao vale em outra.
     O flag `padrao` fica so como procedencia, nao trava mais nada. */
  const h = document.createElement('div');
  h.className = 'card-h';
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
  /* nulo quando o titulo esta em edicao: nao atropela quem esta digitando */
  const t = qs('.card-t', card);
  if (t) t.textContent = it.item;
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
        if (cod === sel) renderCards();
        break;
      }
    }
  } else {
    const lista = ITENS.get(linha.codigo) || [];
    const i = lista.findIndex((x) => x.id === linha.id);
    if (i >= 0) {
      lista[i] = linha;
      ITENS.set(linha.codigo, lista);
      if (linha.codigo === sel) repintarCard(linha);
    } else {
      lista.push(linha);
      ITENS.set(linha.codigo, lista);
      if (linha.codigo === sel) renderCards();
    }
  }
  atualizarKpis();
  montarSeletorEmpresas();
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
  const p = [];
  if (qs('#f-busca').value.trim()) p.push(`Busca: "${qs('#f-busca').value.trim()}"`);
  if (qs('#f-grupo').value) p.push('Grupo: ' + qs('#f-grupo').value);
  if (qs('#f-regime').value) p.push('Regime: ' + qs('#f-regime').value);
  if (qs('#f-periodo').value) p.push('Periodicidade: ' + qs('#f-periodo').value);

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
function ligarEventos() {
  qs('#f-empresa').addEventListener('change', (ev) => abrir(ev.target.value));
  ['f-grupo', 'f-regime', 'f-periodo'].forEach((id) =>
    qs('#' + id).addEventListener('change', montarSeletorEmpresas));
  qs('#f-busca').addEventListener('input', montarSeletorEmpresas);

  qs('#btn-pdf').addEventListener('click', pdfEmpresa);
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

async function iniciar() {
  ligarEventos();
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
  abrir(sel);
  ouvirTempoReal();
  sync('ok');
}

iniciar();
