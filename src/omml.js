// MathML a OMML (las fórmulas de Word). KaTeX da el MathML de cada fórmula; acá se pasa a lo que Word entiende como
// ecuación de verdad: fracciones, índices, raíces, sumatorias e integrales, límites, acentos, paréntesis que crecen,
// matrices y sistemas. Es una conversión acotada a lo común: ante algo que no conoce (multiscripts, menclose…) devuelve
// null y quien llama dibuja la fórmula como imagen. Es una función pura de texto a texto, sin DOM: corre igual en el
// navegador (docx.js) y en node (tests/omml.mjs).
(function () {
  'use strict';

  const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00A0' };
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
  });
  const x = (s) => String(s == null ? '' : s).replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\uD800-\uDFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------- Leer el MathML ----------
  // Un lector mínimo de etiquetas, atributos y texto: alcanza para lo que escribe KaTeX (o outerHTML de un <math>).
  function parse(src) {
    const root = { t: '#root', a: {}, k: [] }; const stack = [root];
    const re = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
    let m;
    while ((m = re.exec(src))) {
      if (m[1]) {
        const name = m[1].replace(/^\w+:/, '');
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].t === name) { stack.length = i; break; }
      } else if (m[2]) {
        const a = {}; const are = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let at;
        while ((at = are.exec(m[3]))) a[at[1].replace(/^\w+:/, '')] = decode(at[2] != null ? at[2] : at[3] != null ? at[3] : at[4] || '');
        const node = { t: m[2].replace(/^\w+:/, ''), a, k: [] };
        stack[stack.length - 1].k.push(node);
        if (!m[4]) stack.push(node);
      } else if (m[5] != null) stack[stack.length - 1].k.push({ t: '#text', s: decode(m[5]) });
    }
    return root;
  }
  const els = (n) => n.k.filter((c) => c.t[0] !== '#' && c.t !== 'annotation' && c.t !== 'annotation-xml');
  const textOf = (n) => n.k.map((c) => (c.t === '#text' ? c.s : c.t === 'annotation' || c.t === 'annotation-xml' ? '' : textOf(c))).join('');
  const flat = (n) => textOf(n).replace(/[\s\u00A0]+/g, ' ').trim();

  // ---------- Escribir OMML ----------
  const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '∯', '∰', '⋃', '⋂', '⋀', '⋁', '⨁', '⨂', '⨀', '⨄', '⨆']);
  const OPEN = new Set(['(', '[', '{', '⟨', '⌈', '⌊']); const SHUT = new Set([')', ']', '}', '⟩', '⌉', '⌋']);
  // Dónde termina lo que una sumatoria o integral abarca: en el próximo signo de suma, resta o relación, fuera de paréntesis.
  const STOP = /^[+\-−±∓=≠≈≡≤≥<>→⇒⇔⟹,;:]$/;
  const ACCENT = { '^': '\u0302', 'ˆ': '\u0302', '~': '\u0303', '˜': '\u0303', '→': '\u20D7', '˙': '\u0307', '¨': '\u0308', 'ˇ': '\u030C', '´': '\u0301', '`': '\u0300', '\u00B4': '\u0301' };
  const BAR = new Set(['¯', '‾', '\u203E', '_']);
  const SCR = { 'double-struck': 'double-struck', script: 'script', 'bold-script': 'script', fraktur: 'fraktur', 'bold-fraktur': 'fraktur', 'sans-serif': 'sans-serif', monospace: 'monospace' };
  const fail = (what) => { throw new Error('omml: ' + what); };

  function run(text, o) {
    if (!text) return '';
    o = o || {};
    const pr = (o.nor ? '<m:nor/>' : '') + (o.scr ? '<m:scr m:val="' + o.scr + '"/>' : '') + (o.sty ? '<m:sty m:val="' + o.sty + '"/>' : '');
    return '<m:r>' + (pr ? '<m:rPr>' + pr + '</m:rPr>' : '') + '<m:t xml:space="preserve">' + x(text) + '</m:t></m:r>';
  }
  const wrap = (tag, inner) => '<m:' + tag + '>' + inner + '</m:' + tag + '>';

  function leaf(n) {
    const t = n.t; const v = n.a.mathvariant || '';
    if (t === 'mtext') return run(textOf(n), { nor: true });
    const s = flat(n);
    if (t === 'mn') return run(s, v === 'bold' ? { sty: 'b' } : {});
    if (t === 'mo') return run(s);
    // mi: una letra va en cursiva (lo de Word por defecto); un nombre (sin, lim, log) o lo pedido, derecho.
    const o = {};
    if (SCR[v]) o.scr = SCR[v];
    if (v === 'bold') o.sty = 'b'; else if (v === 'bold-italic') o.sty = 'bi'; else if (v === 'normal' || (!v && [...s].length > 1)) o.sty = 'p';
    return run(s, o);
  }

  // Una sumatoria, producto o integral con sus límites: qué es, dónde van los límites y cuáles hay.
  function naryOf(n) {
    if (n.t === 'mo') { const s = flat(n); return NARY.has(s) ? { ch: s, sub: null, sup: null, loc: 'subSup' } : null; }
    const k = els(n); const first = k[0];
    if (!first || first.t !== 'mo' || !NARY.has(flat(first))) return null;
    const ch = flat(first);
    if (n.t === 'msub') return { ch, sub: k[1], sup: null, loc: 'subSup' };
    if (n.t === 'msup') return { ch, sub: null, sup: k[1], loc: 'subSup' };
    if (n.t === 'msubsup') return { ch, sub: k[1], sup: k[2], loc: 'subSup' };
    if (n.t === 'munder') return { ch, sub: k[1], sup: null, loc: 'undOvr' };
    if (n.t === 'mover') return { ch, sub: null, sup: k[1], loc: 'undOvr' };
    if (n.t === 'munderover') return { ch, sub: k[1], sup: k[2], loc: 'undOvr' };
    return null;
  }
  function nary(nb, body) {
    const pr = '<m:chr m:val="' + x(nb.ch) + '"/><m:limLoc m:val="' + nb.loc + '"/>' + (nb.sub ? '' : '<m:subHide m:val="1"/>') + (nb.sup ? '' : '<m:supHide m:val="1"/>');
    return wrap('nary', wrap('naryPr', pr) + wrap('sub', nb.sub ? one(nb.sub) : '') + wrap('sup', nb.sup ? one(nb.sup) : '') + wrap('e', body));
  }

  // Una lista de hermanos. Lo que sigue a una sumatoria o integral hasta el próximo + − = (fuera de paréntesis) es su cuerpo.
  function seq(list) {
    let out = '';
    for (let i = 0; i < list.length; i++) {
      const nb = naryOf(list[i]);
      if (!nb) { out += one(list[i]); continue; }
      let j = i + 1; let depth = 0;
      for (; j < list.length; j++) {
        const s = list[j].t === 'mo' ? flat(list[j]) : '';
        if (s) {
          if (OPEN.has(s)) depth++;
          else if (SHUT.has(s)) { if (!depth) break; depth--; }
          else if (!depth && STOP.test(s)) break;
        }
      }
      out += nary(nb, seq(list.slice(i + 1, j)));
      i = j - 1;
    }
    return out;
  }
  const group = (n) => seq(els(n));

  // \left( … \right), \begin{pmatrix}…: un mrow que abre y cierra con delimitadores marcados como fence.
  function fenced(n) {
    const k = els(n); if (k.length < 2) return null;
    const a = k[0]; const z = k[k.length - 1];
    const isFence = (c) => c.t === 'mo' && c.a.fence === 'true' && [...flat(c)].length <= 1;
    if (!isFence(a)) return null;
    const closes = isFence(z) && z !== a;
    const mid = k.slice(1, closes ? -1 : undefined);
    const clean = (s) => (s === '.' ? '' : s);
    return wrap('d', wrap('dPr', '<m:begChr m:val="' + x(clean(flat(a))) + '"/><m:endChr m:val="' + x(closes ? clean(flat(z)) : '') + '"/><m:grow m:val="1"/>') + wrap('e', seq(mid)));
  }

  function table(n) {
    const rows = els(n).map((tr) => {
      let cells = els(tr); if (tr.t === 'mlabeledtr') cells = cells.slice(1);
      return wrap('mr', cells.map((td) => wrap('e', td.t === 'mtd' ? group(td) : one(td))).join(''));
    });
    return wrap('m', rows.join(''));
  }

  function one(n) {
    const t = n.t; const k = els(n);
    switch (t) {
      case '#text': return '';
      case 'mi': case 'mn': case 'mo': case 'mtext': return k.length ? group(n) : leaf(n); // KaTeX anida cosas dentro de un mi (\underset)
      case 'mspace': return /^0?\.?0*(em|px|pt|ex)?$/.test(n.a.width || '0') ? '' : run('\u2009');
      case 'mrow': return fenced(n) || group(n);
      case 'math': case 'semantics': case 'mstyle': case 'mpadded': case 'merror': return t === 'semantics' ? (k[0] ? one(k[0]) : '') : group(n);
      case 'mphantom': return wrap('phant', wrap('e', group(n)));
      case 'mfrac': {
        const th = n.a.linethickness; const none = th != null && /^0+(\.0+)?(px|em|pt|ex)?$/.test(th.trim());
        return wrap('f', (none ? wrap('fPr', '<m:type m:val="noBar"/>') : '') + wrap('num', one(k[0] || { t: 'mrow', a: {}, k: [] })) + wrap('den', one(k[1] || { t: 'mrow', a: {}, k: [] })));
      }
      case 'msqrt': return wrap('rad', wrap('radPr', '<m:degHide m:val="1"/>') + '<m:deg/>' + wrap('e', seq(k)));
      case 'mroot': return wrap('rad', wrap('deg', one(k[1])) + wrap('e', one(k[0])));
      case 'msup': return wrap('sSup', wrap('e', one(k[0])) + wrap('sup', one(k[1])));
      case 'msub': return wrap('sSub', wrap('e', one(k[0])) + wrap('sub', one(k[1])));
      case 'msubsup': return wrap('sSubSup', wrap('e', one(k[0])) + wrap('sub', one(k[1])) + wrap('sup', one(k[2])));
      case 'munder': return wrap('limLow', wrap('e', one(k[0])) + wrap('lim', one(k[1])));
      case 'mover': {
        const over = k[1]; const ch = over && over.t === 'mo' ? flat(over) : '';
        if (ch && BAR.has(ch)) return wrap('bar', wrap('barPr', '<m:pos m:val="top"/>') + wrap('e', one(k[0])));
        if (ch && ACCENT[ch] && (n.a.accent === 'true' || ch.length === 1)) return wrap('acc', wrap('accPr', '<m:chr m:val="' + ACCENT[ch] + '"/>') + wrap('e', one(k[0])));
        return wrap('limUpp', wrap('e', one(k[0])) + wrap('lim', one(over)));
      }
      case 'munderover': return wrap('limUpp', wrap('e', wrap('limLow', wrap('e', one(k[0])) + wrap('lim', one(k[1])))) + wrap('lim', one(k[2])));
      case 'mtable': return table(n);
      default: return fail(t);
    }
  }

  // El MathML (texto) de una fórmula a OMML. display: ecuación en su propio renglón (m:oMathPara). null si no se puede.
  function fromMathML(src, opt) {
    try {
      const tree = parse(String(src || ''));
      const math = (function find(n) { if (n.t === 'math') return n; for (const c of n.k) { if (c.t[0] === '#') continue; const f = find(c); if (f) return f; } return null; })(tree);
      if (!math) return null;
      const body = one(math);
      if (!body || !/<m:/.test(body)) return null;
      const display = opt && opt.display != null ? !!opt.display : math.a.display === 'block';
      return display ? wrap('oMathPara', wrap('oMath', body)) : wrap('oMath', body);
    } catch (e) { return null; }
  }

  const api = { fromMathML, parse };
  if (typeof LMD !== 'undefined') LMD.omml = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
