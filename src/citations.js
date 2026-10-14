// Citas y bibliografía: lee un .bib (BibTeX, la parte que se usa de verdad), escribe las citas [@clave] como
// autor-año (APA simple) y arma la sección "Referencias" al final de la nota. El parser es propio y acotado:
// article, book, inproceedings y misc; author, year, title, journal, publisher, doi y url. Una clave que no
// existe se marca, no rompe nada. Se carga solo cuando una nota tiene citas (renderCites en content.js).
(function () {
  'use strict';

  const T = LMD.t;

  // ---------- BibTeX ----------
  const ACCENTS = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇' };

  // El texto de un campo sin el LaTeX: acentos, llaves y espacios.
  function clean(v) {
    return String(v == null ? '' : v)
      .replace(/\\([`'^"~=.])\s*\{?\\?([A-Za-z])\}?/g, (m, a, l) => l + ACCENTS[a])
      .replace(/\\c\s*\{?([cC])\}?/g, (m, l) => (l === 'c' ? 'ç' : 'Ç'))
      .replace(/\\ss\b/g, 'ß').replace(/\\&/g, '&').replace(/\\_/g, '_').replace(/\\%/g, '%').replace(/\\\$/g, '$')
      .replace(/[{}]/g, '').replace(/~/g, ' ').replace(/\s+/g, ' ').trim().normalize('NFC');
  }

  // Lee un valor de campo desde i: {...} balanceado, "..." o un número/nombre suelto, unidos con #.
  function readValue(s, i, strings) {
    let out = ''; const n = s.length;
    for (;;) {
      while (i < n && /\s/.test(s[i])) i++;
      const c = s[i];
      if (c === '{') {
        let d = 1; let j = i + 1;
        while (j < n && d > 0) { if (s[j] === '\\') j++; else if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
        out += s.slice(i + 1, d === 0 ? j - 1 : j); i = j;
      } else if (c === '"') {
        let d = 0; let j = i + 1;
        while (j < n && !(s[j] === '"' && d === 0)) { if (s[j] === '\\') j++; else if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
        out += s.slice(i + 1, j); i = j + 1;
      } else {
        const m = /^[\w:.+-]+/.exec(s.slice(i, i + 200));
        if (!m) break;
        out += Object.prototype.hasOwnProperty.call(strings, m[0].toLowerCase()) ? strings[m[0].toLowerCase()] : m[0];
        i += m[0].length;
      }
      while (i < n && /\s/.test(s[i])) i++;
      if (s[i] === '#') { i++; continue; }
      break;
    }
    return [out, i];
  }

  // Salta un bloque con llaves balanceadas que empieza en la llave de apertura i. Devuelve el índice siguiente.
  function skipBlock(s, i) {
    let d = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '\\') j++;
      else if (s[j] === '{' || s[j] === '(') d++;
      else if (s[j] === '}' || s[j] === ')') { d--; if (d <= 0) return j + 1; }
    }
    return s.length;
  }

  // Separa "A and B and C" a nivel de llaves.
  function splitAnd(raw) {
    const parts = []; let d = 0; let cur = '';
    const toks = raw.split(/(\s+)/);
    toks.forEach((t) => {
      if (d === 0 && /^and$/i.test(t)) { parts.push(cur.trim()); cur = ''; return; }
      for (const ch of t) { if (ch === '{') d++; else if (ch === '}') d--; }
      cur += t;
    });
    if (cur.trim()) parts.push(cur.trim());
    return parts.filter(Boolean);
  }

  const PARTICLE = /^(von|van|de|del|della|da|di|du|la|le|der|den|dos|das|bin|al|el)$/;
  function parseNames(raw) {
    return splitAnd(String(raw || '')).map((p) => {
      if (/^\{[^{}]*\}$/.test(p)) return { last: clean(p), first: '', corp: true };
      const c = clean(p);
      if (c.indexOf(',') >= 0) {
        const k = c.indexOf(',');
        return { last: c.slice(0, k).trim(), first: c.slice(k + 1).replace(/^,/, '').trim(), corp: false };
      }
      const toks = c.split(' ').filter(Boolean);
      if (toks.length <= 1) return { last: c, first: '', corp: false };
      let at = toks.length - 1;
      while (at > 1 && PARTICLE.test(toks[at - 1].toLowerCase())) at--;
      return { last: toks.slice(at).join(' '), first: toks.slice(0, at).join(' '), corp: false };
    }).filter((a) => a.last);
  }

  function initials(first) {
    return String(first || '').split(/\s+/).filter(Boolean).map((tok) =>
      tok.split('-').filter(Boolean).map((x) => { const l = Array.from(x)[0]; return l.toUpperCase() + '.'; }).join('-')
    ).join(' ');
  }

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function parseBib(text) {
    const db = Object.create(null); const strings = {};
    const s = String(text || '').replace(/\r/g, '');
    const at = /@([A-Za-z]+)\s*([{(])/g;
    let m;
    try {
      while ((m = at.exec(s))) {
        const type = m[1].toLowerCase();
        const open = m.index + m[0].length - 1;
        const end = skipBlock(s, open);
        const body = s.slice(open + 1, Math.max(open + 1, end - 1));
        if (type === 'comment' || type === 'preamble') { at.lastIndex = end; continue; }
        if (type === 'string') {
          const sm = /^\s*([\w:.-]+)\s*=\s*/.exec(body);
          if (sm) strings[sm[1].toLowerCase()] = readValue(body, sm[0].length, strings)[0];
          at.lastIndex = end; continue;
        }
        const km = /^\s*([^,\s]+)\s*,/.exec(body);
        if (!km) { at.lastIndex = end; continue; }
        const raw = {};
        let i = km[0].length;
        for (;;) {
          while (i < body.length && /[\s,]/.test(body[i])) i++;
          const fm = /^([A-Za-z][\w-]*)\s*=\s*/.exec(body.slice(i));
          if (!fm) break;
          const r = readValue(body, i + fm[0].length, strings);
          raw[fm[1].toLowerCase()] = r[0]; i = r[1];
        }
        const f = {};
        Object.keys(raw).forEach((k) => { if (k !== 'author') f[k] = clean(raw[k]); });
        const year = (/\d{4}/.exec(f.year || f.date || '') || [''])[0];
        db[km[1]] = { key: km[1], type, f, authors: parseNames(raw.author), year, suffix: '' };
        at.lastIndex = end;
      }
    } catch (e) { /* una entrada rota no tumba a las demás */ }
    // a, b, c cuando el mismo autor tiene dos obras del mismo año
    const groups = {};
    Object.keys(db).forEach((k) => {
      const e = db[k]; if (!e.year) return;
      const g = e.authors.slice(0, 3).map((a) => norm(a.last)).join('|') + '|' + (e.authors.length > 2 ? 'x' : '') + e.year;
      (groups[g] = groups[g] || []).push(e);
    });
    Object.keys(groups).forEach((g) => {
      if (groups[g].length < 2) return;
      groups[g].sort((a, b) => norm(a.f.title).localeCompare(norm(b.f.title)));
      groups[g].forEach((e, i) => { e.suffix = String.fromCharCode(97 + i); });
    });
    return db;
  }

  // ---------- Qué bibliografía declara la nota ----------
  function bibFiles(value) {
    return String(value || '').split(/[\n,]/).map((x) => x.replace(/^\s*-\s+/, '').replace(/^[\s[\]"']+|[\s[\]"']+$/g, '')).filter(Boolean);
  }

  function parseCite(inner) {
    return String(inner || '').split(';').map((p) => {
      const m = /^\s*@([^\s,]+)\s*(?:,\s*(.*))?$/.exec(p);
      return m ? { key: m[1], loc: (m[2] || '').trim() } : null;
    }).filter(Boolean);
  }

  function lookup(db, key) {
    if (db[key]) return db[key];
    const low = key.toLowerCase();
    const k = Object.keys(db).find((x) => x.toLowerCase() === low);
    return k ? db[k] : null;
  }

  // ---------- Cómo se escribe ----------
  function authorShort(e) {
    const a = e.authors;
    if (!a.length) {
      const w = (e.f.title || e.key).split(/\s+/);
      return w.slice(0, 4).join(' ') + (w.length > 4 ? '...' : '');
    }
    if (a.length === 1) return a[0].last;
    if (a.length === 2) return a[0].last + ' ' + T('y') + ' ' + a[1].last;
    return a[0].last + ' et al.';
  }

  // "(Pérez y Gómez, 2020, p. 12)"; null si alguna clave no está en la bibliografía.
  function citeText(items, db) {
    const parts = [];
    for (const it of items) {
      const e = lookup(db, it.key);
      if (!e) return null;
      parts.push(authorShort(e) + ', ' + (e.year ? e.year + e.suffix : T('s. f.')) + (it.loc ? ', ' + it.loc : ''));
    }
    return parts.length ? '(' + parts.join('; ') + ')' : null;
  }

  function authorsFull(a) {
    const one = (x) => (x.corp || !x.first ? x.last : x.last + ', ' + initials(x.first));
    if (!a.length) return '';
    if (a.length === 1) return one(a[0]);
    if (a.length <= 20) return a.slice(0, -1).map(one).join(', ') + ' ' + T('y') + ' ' + one(a[a.length - 1]);
    return a.slice(0, 19).map(one).join(', ') + ' ... ' + one(a[a.length - 1]);
  }

  const dot = (s) => (/[.?]$/.test(s) ? s : s + '.');

  // La referencia como trozos: {t:'text'|'i'|'a', text, href}. Nunca HTML crudo.
  function refSegments(e) {
    const f = e.f; const seg = [];
    const txt = (x) => { if (x) seg.push({ t: 'text', text: x }); };
    const ital = (x) => { if (x) seg.push({ t: 'i', text: x }); };
    const who = authorsFull(e.authors);
    const yr = '(' + (e.year ? e.year + e.suffix : T('s. f.')) + ').';
    if (e.type === 'book') {
      txt(who ? dot(who) + ' ' + yr + ' ' : '');
      if (!who) { ital(dot(f.title || e.key)); txt(' ' + yr + ' '); } else ital(dot(f.title || e.key));
      txt(f.publisher ? ' ' + dot(f.publisher) : '');
    } else if (e.type === 'article') {
      txt(who ? dot(who) + ' ' + yr + ' ' : '');
      if (!who) { txt(dot(f.title || e.key) + ' ' + yr); } else txt(dot(f.title || e.key));
      if (f.journal || f.journaltitle) {
        txt(' '); ital(f.journal || f.journaltitle);
        let vn = f.volume || ''; if (f.number) vn += '(' + f.number + ')';
        txt((vn ? ', ' + vn : '') + (f.pages ? ', ' + f.pages.replace(/\s*(--|–|—)\s*/g, '-') : '') + '.');
      }
    } else if (e.type === 'inproceedings') {
      txt(who ? dot(who) + ' ' + yr + ' ' : '');
      if (!who) txt(dot(f.title || e.key) + ' ' + yr); else txt(dot(f.title || e.key));
      if (f.booktitle) { txt(' ' + T('En') + ' '); ital(f.booktitle); txt(f.pages ? ' (pp. ' + f.pages.replace(/\s*(--|–|—)\s*/g, '-') + ').' : '.'); }
      if (f.publisher) txt(' ' + dot(f.publisher));
    } else {
      txt(who ? dot(who) + ' ' + yr + ' ' : '');
      if (!who) { ital(dot(f.title || e.key)); txt(' ' + yr); } else ital(dot(f.title || e.key));
      if (f.publisher || f.howpublished) txt(' ' + dot(f.publisher || f.howpublished));
    }
    const doi = (f.doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    const link = doi ? 'https://doi.org/' + doi : /^https?:\/\//i.test(f.url || '') ? f.url : '';
    if (link) { txt(' '); seg.push({ t: 'a', text: link, href: link }); }
    return seg;
  }

  const refPlain = (e) => refSegments(e).map((x) => x.text).join('');

  function sortKeys(db) {
    const k = (e) => norm(e.authors.length ? e.authors[0].last : e.f.title || e.key);
    return Object.keys(db).map((x) => db[x]).sort((a, b) =>
      k(a).localeCompare(k(b)) || String(a.year).localeCompare(String(b.year)) || (a.suffix || '').localeCompare(b.suffix || '') || norm(a.f.title).localeCompare(norm(b.f.title)));
  }

  // ---------- Bloque de cita desde un PDF ----------
  function quoteBlock(text, name, page) {
    const lines = String(text || '').trim().split(/\r?\n/).map((l) => '> ' + l.trim());
    const file = String(name || '');
    const base = file.split(/[\\/]/).pop();
    const href = file.split('/').map((p) => encodeURIComponent(p).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/') + '#page=' + page;
    return lines.join('\n') + '\n>\n> [' + base.replace(/([[\]])/g, '\\$1') + ', p. ' + page + '](' + href + ')\n';
  }

  // ---------- Al DOM ----------
  // opt: { db, declared, errors: [archivos que no se pudieron leer], main: true si es la nota abierta }
  function apply(article, opt) {
    const db = opt.db || {}; const doc = article.ownerDocument; const cited = new Set();
    article.querySelectorAll('.lmd-cite').forEach((sp) => {
      const items = parseCite(sp.getAttribute('data-cite'));
      const text = citeText(items, db);
      sp.classList.remove('lmd-cite-bad');
      if (text == null) {
        const bad = items.find((it) => !lookup(db, it.key));
        sp.textContent = '[' + (sp.getAttribute('data-cite') || '') + ']';
        sp.classList.add('lmd-cite-bad');
        sp.title = !opt.declared ? T('La nota no declara una bibliografía.')
          : opt.errors && opt.errors.length ? T('No se pudo leer {a}.', { a: opt.errors[0] })
            : T('Clave desconocida: {a}', { a: bad ? bad.key : '' });
        return;
      }
      sp.textContent = text;
      sp.title = items.map((it) => { const e = lookup(db, it.key); cited.add(e.key); return refPlain(e); }).join('\n');
    });
    article.querySelectorAll('.lmd-bib').forEach((n) => n.remove());
    if (!opt.main || !cited.size) return;
    const sec = doc.createElement('section');
    sec.className = 'lmd-bib'; sec.setAttribute('contenteditable', 'false');
    const h = doc.createElement('div');
    h.className = 'lmd-bib-title'; h.setAttribute('role', 'heading'); h.setAttribute('aria-level', '2');
    h.textContent = T('Referencias');
    sec.appendChild(h);
    sortKeys(db).filter((e) => cited.has(e.key)).forEach((e) => {
      const p = doc.createElement('p');
      p.className = 'lmd-bib-item'; p.id = 'ref-' + e.key;
      refSegments(e).forEach((x) => {
        if (x.t === 'i') { const i = doc.createElement('em'); i.textContent = x.text; p.appendChild(i); }
        else if (x.t === 'a') { const a = doc.createElement('a'); a.href = x.href; a.textContent = x.text; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.appendChild(a); }
        else p.appendChild(doc.createTextNode(x.text));
      });
      sec.appendChild(p);
    });
    article.appendChild(sec);
  }

  LMD.cite = { parseBib, parseNames, bibFiles, parseCite, citeText, refSegments, sortKeys, quoteBlock, apply, initials };
})();
