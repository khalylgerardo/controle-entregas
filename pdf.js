/* Gerador de PDF nativo (zero dependencias) para o Controle de Entregas GrupoPro.
   A4 paisagem, Helvetica com WinAnsiEncoding — acentos PT-BR saem corretos. */
(function (root) {
  'use strict';

  /* Larguras AFM oficiais da Helvetica / Helvetica-Bold, codigos 32..126 */
  var AFM_REG = [
    278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584
  ];
  var AFM_BOLD = [
    278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
    975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
    333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
    611,611,389,556,333,611,556,778,556,556,500,389,280,389,584
  ];

  var W_REG = {}, W_BOLD = {};
  for (var i = 0; i < AFM_REG.length; i++) {
    W_REG[32 + i] = AFM_REG[i];
    W_BOLD[32 + i] = AFM_BOLD[i];
  }

  /* Acentuados Latin-1 herdam a largura da letra base */
  var BASE = {
    192:65,193:65,194:65,195:65,196:65,197:65, 199:67,
    200:69,201:69,202:69,203:69, 209:78,
    210:79,211:79,212:79,213:79,214:79,216:79,
    217:85,218:85,219:85,220:85, 221:89, 223:115,
    224:97,225:97,226:97,227:97,228:97,229:97, 231:99,
    232:101,233:101,234:101,235:101, 241:110,
    242:111,243:111,244:111,245:111,246:111,248:111,
    249:117,250:117,251:117,252:117, 253:121,255:121
  };
  Object.keys(BASE).forEach(function (code) {
    W_REG[code] = W_REG[BASE[code]];
    W_BOLD[code] = W_BOLD[BASE[code]];
  });
  /* i acentuado usa o dotlessi, mais largo que o i simples */
  [204,205,206,207,236,237,238,239].forEach(function (c) { W_REG[c] = 278; W_BOLD[c] = 278; });
  W_REG[170] = 370; W_BOLD[170] = 370;   /* ordfeminine */
  W_REG[186] = 365; W_BOLD[186] = 365;   /* ordmasculine */
  W_REG[176] = 400; W_BOLD[176] = 400;   /* degree */
  W_REG[160] = 278; W_BOLD[160] = 278;   /* nbsp */

  /* Faixa alta do WinAnsi que realmente usamos (travessao, reticencias, aspas) */
  [[128,556,556],[133,1000,1000],[145,222,238],[146,222,238],[147,333,500],
   [148,333,500],[149,350,350],[150,556,556],[151,1000,1000],[169,737,737],
   [174,737,737]].forEach(function (r) { W_REG[r[0]] = r[1]; W_BOLD[r[0]] = r[2]; });

  /* Unicode -> byte WinAnsi, para o que nao cabe em Latin-1 */
  var UNI2WIN = {
    8364:128, 8218:130, 402:131, 8222:132, 8230:133, 8224:134, 8225:135,
    710:136, 8240:137, 352:138, 8249:139, 338:140, 381:142, 8216:145,
    8217:146, 8220:147, 8221:148, 8226:149, 8211:150, 8212:151, 732:152,
    8482:153, 353:154, 8250:155, 339:156, 382:158, 376:159
  };

  /* Converte para uma string de bytes (todo char <= 255). Idempotente. */
  function toWin(str) {
    var out = '';
    str = String(str == null ? '' : str);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c <= 255) out += str[i];
      else if (UNI2WIN[c]) out += String.fromCharCode(UNI2WIN[c]);
      else out += '?';
    }
    return out;
  }

  function widthOf(str, size, bold) {
    var t = bold ? W_BOLD : W_REG, total = 0;
    str = toWin(str);
    for (var i = 0; i < str.length; i++) {
      var w = t[str.charCodeAt(i)];
      total += (w === undefined ? 556 : w);
    }
    return total * size / 1000;
  }

  function truncate(str, maxW, size, bold) {
    str = String(str);
    if (widthOf(str, size, bold) <= maxW) return str;
    var out = str;
    while (out.length > 1 && widthOf(out + '…', size, bold) > maxW) out = out.slice(0, -1);
    return out.replace(/[\s\-.,;]+$/, '') + '…';
  }

  /* maxLines = 0 significa sem limite */
  function wrap(str, maxW, size, bold, maxLines) {
    var lines = [];
    String(str == null ? '' : str).split(/\r?\n/).forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), cur = '';
      if (!words.length) { lines.push(''); return; }
      for (var i = 0; i < words.length; i++) {
        var probe = cur ? cur + ' ' + words[i] : words[i];
        if (widthOf(probe, size, bold) <= maxW) { cur = probe; continue; }
        if (cur) { lines.push(cur); cur = ''; }
        var word = words[i];
        while (widthOf(word, size, bold) > maxW && word.length > 1) {
          var cut = word.length;
          while (cut > 1 && widthOf(word.slice(0, cut), size, bold) > maxW) cut--;
          lines.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        cur = word;
      }
      if (cur) lines.push(cur);
    });
    if (!lines.length) lines = [''];
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = truncate(lines[maxLines - 1] + ' …', maxW, size, bold);
    }
    return lines;
  }

  /* ---------- primitivas de pagina ---------- */
  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }

  function esc(s) {
    s = toWin(s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '\\' || ch === '(' || ch === ')') out += '\\' + ch;
      else out += ch;
    }
    return out;
  }

  function Page(w, h) { this.w = w; this.h = h; this.ops = []; }
  Page.prototype.text = function (x, y, str, size, bold, color) {
    if (str === '' || str == null) return;
    var c = color || [0, 0, 0];
    this.ops.push(fmt(c[0]) + ' ' + fmt(c[1]) + ' ' + fmt(c[2]) + ' rg');
    this.ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + fmt(size) + ' Tf ' +
      fmt(x) + ' ' + fmt(this.h - y) + ' Td (' + esc(String(str)) + ') Tj ET');
  };
  Page.prototype.rect = function (x, y, w, h, color) {
    this.ops.push(fmt(color[0]) + ' ' + fmt(color[1]) + ' ' + fmt(color[2]) + ' rg ' +
      fmt(x) + ' ' + fmt(this.h - y - h) + ' ' + fmt(w) + ' ' + fmt(h) + ' re f');
  };
  Page.prototype.line = function (x1, y1, x2, y2, color, lw) {
    this.ops.push(fmt(color[0]) + ' ' + fmt(color[1]) + ' ' + fmt(color[2]) + ' RG ' +
      fmt(lw || 0.5) + ' w ' + fmt(x1) + ' ' + fmt(this.h - y1) + ' m ' +
      fmt(x2) + ' ' + fmt(this.h - y2) + ' l S');
  };

  function serialize(pages) {
    var bytes = [], offsets = [], objects = [];
    function raw(s) {
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        bytes.push(c > 255 ? 63 : c);
      }
    }
    var nPages = pages.length, firstPage = 5;
    var kids = [];
    for (var i = 0; i < nPages; i++) kids.push((firstPage + i * 2) + ' 0 R');

    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = '<< /Type /Pages /Count ' + nPages + ' /Kids [' + kids.join(' ') + '] >>';
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    for (var p = 0; p < nPages; p++) {
      var pg = pages[p], pn = firstPage + p * 2, cn = pn + 1;
      objects[pn] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmt(pg.w) + ' ' + fmt(pg.h) + '] ' +
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + cn + ' 0 R >>';
      var stream = pg.ops.join('\n');
      objects[cn] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
    }

    raw('%PDF-1.4\n%âãÏÓ\n');
    for (var n = 1; n < objects.length; n++) {
      offsets[n] = bytes.length;
      raw(n + ' 0 obj\n' + objects[n] + '\nendobj\n');
    }
    var xrefAt = bytes.length;
    raw('xref\n0 ' + objects.length + '\n0000000000 65535 f \n');
    for (var k = 1; k < objects.length; k++) {
      raw(('0000000000' + offsets[k]).slice(-10) + ' 00000 n \n');
    }
    raw('trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n');
    return new Uint8Array(bytes);
  }

  /* ---------- relatorio ---------- */
  var C = {
    ink:   [0.05, 0.14, 0.16],
    muted: [0.35, 0.45, 0.47],
    brand: [0.06, 0.43, 0.47],
    line:  [0.82, 0.87, 0.87],
    head:  [0.90, 0.94, 0.94],
    zebra: [0.972, 0.982, 0.982],
    ok:    [0.18, 0.49, 0.32],
    no:    [0.70, 0.23, 0.19],
    warn:  [0.66, 0.45, 0.10]
  };

  var M = 28, BOTTOM = 26;
  var A4_RETRATO = [595.28, 841.89];
  var A4_PAISAGEM = [841.89, 595.28];

  function rotuloValor(v) { return v === 'sim' ? 'Sim' : v === 'nao' ? 'Nao' : '-'; }
  function corValor(v) { return v === 'sim' ? C.ok : v === 'nao' ? C.no : C.muted; }

  /* Contexto de desenho com paginacao. cols e opcional (secoes livres). */
  function Ctx(w, h, opts) {
    this.w = w; this.h = h; this.opts = opts;
    this.pages = []; this.page = null; this.y = 0;
    this.cols = null;
  }

  Ctx.prototype.nova = function (comTitulo) {
    this.page = new Page(this.w, this.h);
    this.pages.push(this.page);
    this.y = M;
    if (comTitulo) {
      this.page.rect(M, this.y, this.w - M * 2, 3, C.brand);
      this.y += 20;
      wrap(this.opts.title, this.w - M * 2, 15, true, 2).forEach(function (l) {
        this.page.text(M, this.y, l, 15, true, C.ink);
        this.y += 17;
      }, this);
      if (this.opts.subtitle) {
        wrap(this.opts.subtitle, this.w - M * 2, 8, false, 3).forEach(function (l) {
          this.page.text(M, this.y, l, 8, false, C.muted);
          this.y += 10;
        }, this);
      }
      if (this.opts.emitido) { this.page.text(M, this.y + 1, this.opts.emitido, 7.5, false, C.muted); this.y += 11; }
      if (this.opts.filtros) {
        wrap('Filtros: ' + this.opts.filtros, this.w - M * 2, 7.5, false, 2).forEach(function (l) {
          this.page.text(M, this.y, l, 7.5, false, C.muted);
          this.y += 9.5;
        }, this);
      }
      if (this.opts.resumo) { this.page.text(M, this.y + 2, this.opts.resumo, 8.5, true, C.brand); this.y += 15; }
      this.y += 4;
    } else {
      this.page.text(M, this.y + 8, this.opts.title + ' (continuacao)', 8.5, true, C.muted);
      this.y += 20;
    }
  };

  Ctx.prototype.espaco = function (precisa, cabecalho) {
    if (this.y + precisa <= this.h - BOTTOM) return;
    this.nova(false);
    if (cabecalho && this.cols) this.cabecalho();
  };

  Ctx.prototype.cabecalho = function () {
    this.page.rect(M, this.y, this.w - M * 2, 15, C.head);
    var x = M, self = this;
    this.cols.forEach(function (c) {
      var tx = c.align === 'c' ? x + c.w / 2 - widthOf(c.label, 7.2, true) / 2 : x + 4;
      self.page.text(tx, self.y + 10.4, c.label, 7.2, true, C.ink);
      x += c.w;
    });
    this.y += 15;
    this.page.line(M, this.y, this.w - M, this.y, C.brand, 0.8);
  };

  Ctx.prototype.secao = function (titulo) {
    this.espaco(46, false);
    this.y += 10;
    this.page.rect(M, this.y, this.w - M * 2, 2, C.brand);
    this.y += 15;
    this.page.text(M, this.y, titulo, 11, true, C.ink);
    this.y += 14;
  };

  Ctx.prototype.linha = function (valores, idx, faixa) {
    var self = this, fs = 7.4, lh = 8.6;
    var celulas = this.cols.map(function (c) {
      var v = valores[c.key] == null ? '' : String(valores[c.key]);
      if (c.flag) return [rotuloValor(v)];
      if (c.wrap) return wrap(v, c.w - 8, fs, false, c.wrap);
      return [truncate(v, c.w - 8, fs, false)];
    });
    var n = celulas.reduce(function (a, c) { return Math.max(a, c.length); }, 1);
    var rh = 6 + n * lh;

    this.espaco(rh, true);

    if (idx % 2 === 1) this.page.rect(M, this.y, this.w - M * 2, rh, C.zebra);
    if (faixa) this.page.rect(M, this.y, 2.5, rh, faixa);

    var x = M;
    this.cols.forEach(function (c, ci) {
      var bold = !!c.flag || c.bold;
      var cor = c.flag ? corValor(String(valores[c.key] || '')) : C.ink;
      celulas[ci].forEach(function (l, li) {
        var tx = c.align === 'c' ? x + c.w / 2 - widthOf(l, fs, bold) / 2 : x + (ci === 0 ? 7 : 4);
        self.page.text(tx, self.y + 9.6 + li * lh, l, fs, bold, cor);
      });
      x += c.w;
    });
    this.y += rh;
    this.page.line(M, this.y, this.w - M, this.y, C.line, 0.4);
  };

  Ctx.prototype.observacoes = function (itens) {
    var self = this;
    itens.forEach(function (o) {
      self.espaco(26, false);
      self.page.text(M + 4, self.y + 7, o.autor + ' — ' + o.data, 6.8, true, C.muted);
      self.y += 10;
      wrap(o.texto, self.w - M * 2 - 12, 7.4, false, 0).forEach(function (l) {
        self.espaco(12, false);
        self.page.text(M + 4, self.y + 7, l, 7.4, false, C.ink);
        self.y += 9.2;
      });
      self.y += 4;
      self.page.line(M, self.y, self.w - M, self.y, C.line, 0.4);
      self.y += 6;
    });
  };

  Ctx.prototype.fechar = function () {
    var self = this;
    this.pages.forEach(function (p, i) {
      p.text(M, self.h - 14, self.opts.rodape || '', 6.8, false, C.muted);
      var t = 'Pagina ' + (i + 1) + ' de ' + self.pages.length;
      p.text(self.w - M - widthOf(t, 6.8, false), self.h - 14, t, 6.8, false, C.muted);
    });
    return serialize(this.pages);
  };

  function escalar(cols, largura) {
    var soma = cols.reduce(function (a, c) { return a + c.w; }, 0);
    var k = largura / soma;
    return cols.map(function (c) {
      return { key: c.key, label: c.label, w: c.w * k, align: c.align, wrap: c.wrap, flag: c.flag, bold: c.bold };
    });
  }

  /* ---------- ficha de uma empresa (A4 retrato) ---------- */
  function buildEmpresa(o) {
    var e = o.empresa || {};
    var partes = [];
    if (e.cnpj) partes.push('CNPJ ' + e.cnpj);
    if (e.grupo) partes.push('Grupo ' + e.grupo + (e.regional ? ' / ' + e.regional : ''));
    if (e.regime) partes.push(e.regime);
    if (e.periodicidade) partes.push('Entrega ' + e.periodicidade);

    var ctx = new Ctx(A4_RETRATO[0], A4_RETRATO[1], {
      title: (e.codigo ? e.codigo + ' — ' : '') + (e.empresa || 'Empresa'),
      subtitle: partes.join('  ·  '),
      emitido: o.emitido,
      resumo: o.resumo,
      rodape: o.rodape
    });

    ctx.cols = escalar([
      { key: 'item', label: 'Item', w: 150, align: 'l', wrap: 2, bold: true },
      { key: 'valor', label: 'Situacao', w: 52, align: 'c', flag: true },
      { key: 'observacao', label: 'Observacao', w: 245, align: 'l', wrap: 4 },
      { key: 'quem', label: 'Atualizado por', w: 92, align: 'l', wrap: 2 }
    ], A4_RETRATO[0] - M * 2);

    ctx.nova(true);
    ctx.cabecalho();

    (o.itens || []).forEach(function (it, i) {
      ctx.linha({
        item: it.item, valor: it.valor,
        observacao: it.observacao || '—',
        quem: it.quem ? it.quem + (it.quando ? ' · ' + it.quando : '') : '—'
      }, i, corValor(it.valor));
    });

    if (!(o.itens || []).length) {
      ctx.page.text(M + 6, ctx.y + 16, 'Nenhum item cadastrado para esta empresa.', 9, false, C.muted);
      ctx.y += 24;
    }

    if ((o.observacoes || []).length) {
      ctx.secao('Observacoes gerais');
      ctx.observacoes(o.observacoes);
    }
    return ctx.fechar();
  }

  /* ---------- panorama de varias empresas (A4 paisagem) ---------- */
  function buildResumo(o) {
    var ctx = new Ctx(A4_PAISAGEM[0], A4_PAISAGEM[1], {
      title: 'Controle de Entregas — GrupoPro',
      subtitle: 'Panorama por empresa',
      emitido: o.emitido,
      filtros: o.filtros,
      resumo: o.resumo,
      rodape: o.rodape
    });

    ctx.cols = escalar([
      { key: 'codigo', label: 'Codigo', w: 46, align: 'l', bold: true },
      { key: 'empresa', label: 'Empresa', w: 236, align: 'l', wrap: 2 },
      { key: 'grupo', label: 'Grupo', w: 128, align: 'l', wrap: 2 },
      { key: 'regime', label: 'Regime', w: 98, align: 'l', wrap: 2 },
      { key: 'periodicidade', label: 'Periodic.', w: 60, align: 'l' },
      { key: 'sim', label: 'Conferidos', w: 58, align: 'c', bold: true },
      { key: 'nao', label: 'Pendencias', w: 58, align: 'c', bold: true },
      { key: 'branco', label: 'Em branco', w: 56, align: 'c' },
      { key: 'progresso', label: 'Progresso', w: 60, align: 'c' }
    ], A4_PAISAGEM[0] - M * 2);

    ctx.nova(true);
    ctx.cabecalho();

    (o.rows || []).forEach(function (r, i) {
      var pct = r.total ? Math.round((r.sim / r.total) * 100) : 0;
      ctx.linha({
        codigo: r.codigo, empresa: r.empresa, grupo: r.grupo,
        regime: r.regime, periodicidade: r.periodicidade,
        sim: r.sim + '/' + r.total, nao: r.nao || '-', branco: r.branco || '-',
        progresso: pct + '%'
      }, i, r._situacao === 'ok' ? C.ok : r._situacao === 'pendente' ? C.no
        : r._situacao === 'parcial' ? C.warn : C.line);
    });

    if (!(o.rows || []).length) {
      ctx.page.text(M + 6, ctx.y + 16, 'Nenhuma empresa corresponde aos filtros aplicados.', 9, false, C.muted);
    }
    return ctx.fechar();
  }

  var api = {
    buildEmpresa: buildEmpresa,
    buildResumo: buildResumo,
    widthOf: widthOf, wrap: wrap, truncate: truncate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ControlePDF = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
