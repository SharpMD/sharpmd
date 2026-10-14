// Markdown -> HTML: el parser con sus plugins, los links [[wiki]], la matemática y la cabecera YAML.
(function () {
  'use strict';

  const { esc } = LMD.kit;
  const T = LMD.t;

  function wikiPlugin(md) {
    md.inline.ruler.before('link', 'lmd_wiki', (state, silent) => {
      const src = state.src; const pos = state.pos;
      if (src.charCodeAt(pos) !== 0x5B || src.charCodeAt(pos + 1) !== 0x5B) return false;
      const end = src.indexOf(']]', pos + 2);
      if (end === -1) return false;
      const inner = src.slice(pos + 2, end);
      if (!inner.trim() || /[\[\]\n]/.test(inner) || /^toc$/i.test(inner.trim())) return false;
      if (!silent) {
        const parts = inner.split('|');
        const t = state.push('lmd_wiki', 'a', 0);
        t.meta = { target: parts[0].trim(), label: (parts[1] || parts[0]).trim() };
      }
      state.pos = end + 2;
      return true;
    });
    md.renderer.rules.lmd_wiki = (tokens, i) =>
      '<a class="lmd-wiki" data-wiki="' + esc(tokens[i].meta.target) + '">' + esc(tokens[i].meta.label) + '</a>';
  }

  function mathPlugin(md) {
    md.inline.ruler.after('escape', 'lmd_math_inline', (state, silent) => {
      const src = state.src; const start = state.pos;
      if (src.charCodeAt(start) !== 0x24) return false;
      if (src.charCodeAt(start + 1) === 0x24) return false;
      const next = src[start + 1];
      if (!next || /\s/.test(next)) return false;
      let end = start + 1;
      while ((end = src.indexOf('$', end)) !== -1) {
        if (src[end - 1] === '\\') { end++; continue; }
        break;
      }
      if (end === -1) return false;
      if (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] || '')) return false;
      if (!silent) {
        const t = state.push('lmd_math_inline', 'span', 0);
        t.content = src.slice(start + 1, end);
      }
      state.pos = end + 1;
      return true;
    });
    md.block.ruler.before('fence', 'lmd_math_block', (state, startLine, endLine, silent) => {
      let pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      if (state.src.slice(pos, pos + 2) !== '$$') return false;
      if (silent) return true;
      let first = state.src.slice(pos + 2, max);
      let line = startLine; let found = false; const parts = []; let label = '';
      const f = cutLabel(first);
      if (f[0].trim().endsWith('$$')) {
        parts.push(f[0].trim().slice(0, -2)); label = f[1]; found = true;
      } else {
        if (first.trim()) parts.push(first);
        for (line = startLine + 1; line < endLine; line++) {
          const l = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
          const c = cutLabel(l);
          if (c[0].trim().endsWith('$$')) { const rest = c[0].trim().slice(0, -2); if (rest) parts.push(rest); label = c[1]; found = true; break; }
          parts.push(l);
        }
      }
      if (!found) return false;
      state.line = line + 1;
      const t = state.push('lmd_math_block', 'div', 0);
      t.block = true; t.content = parts.join('\n'); t.map = [startLine, state.line];
      if (label) t.meta = { label };
      return true;
    }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    md.renderer.rules.lmd_math_inline = (tokens, i) => '<span class="lmd-math" data-tex="' + esc(tokens[i].content) + '"></span>';
    md.renderer.rules.lmd_math_block = (tokens, i) => {
      const t = tokens[i]; const m = t.meta;
      return '<div class="lmd-math lmd-math-block"' + (t.attrGet('data-l') ? ' data-l="' + t.attrGet('data-l') + '"' : '') +
        (m && m.n ? ' id="eq-' + esc(m.label) + '" data-eq="' + esc(m.label) + '" data-n="' + m.n + '"' : '') + ' data-tex="' + esc(t.content) + '"></div>\n';
    };
    // Ecuaciones numeradas: `$$ ... $$ {#eq:id}` lleva su número, y `@eq:id` o `\eqref{id}` lo citan. Los números se
    // asignan en orden de aparición, después de leer todo el texto, así una referencia puede ir antes que su ecuación.
    md.core.ruler.push('lmd_eq', (state) => {
      const found = numberEquations(state.tokens.filter((t) => t.type === 'lmd_math_block' && t.meta && t.meta.label).map((t) => t.meta.label));
      let k = 0;
      state.tokens.forEach((t) => { if (t.type === 'lmd_math_block' && t.meta && t.meta.label) t.meta.n = found.list[k++]; });
      state.env.lmdEq = found.byId;
      state.tokens.forEach((blockTok) => {
        if (blockTok.type !== 'inline' || !blockTok.children) return;
        const out = []; let inLink = 0;
        blockTok.children.forEach((c) => {
          if (c.type === 'link_open') inLink++; else if (c.type === 'link_close') inLink--;
          if (c.type !== 'text' || inLink > 0 || !EQ_REF.test(c.content)) { out.push(c); return; }
          EQ_REF.lastIndex = 0;
          let last = 0; let m;
          while ((m = EQ_REF.exec(c.content))) {
            if (m.index > last) { const tx = new state.Token('text', '', 0); tx.content = c.content.slice(last, m.index); out.push(tx); }
            const r = new state.Token('lmd_eqref', '', 0); r.meta = { id: m[1] || m[2], form: m[2] ? 'eqref' : '' }; out.push(r);
            last = m.index + m[0].length;
          }
          if (last < c.content.length) { const tx = new state.Token('text', '', 0); tx.content = c.content.slice(last); out.push(tx); }
        });
        blockTok.children = out;
      });
    });
    md.renderer.rules.lmd_eqref = (tokens, i, options, env) => {
      const m = tokens[i].meta; const n = env && env.lmdEq && env.lmdEq[m.id];
      const form = m.form ? ' data-form="eqref"' : '';
      return n ? '<a class="lmd-eqref" href="#eq-' + esc(m.id) + '" data-ref="' + esc(m.id) + '"' + form + '>(' + n + ')</a>'
        : '<span class="lmd-eqref lmd-eqref-bad" data-ref="' + esc(m.id) + '"' + form + ' title="' + esc(T('Ecuación sin definir: {a}', { a: m.id })) + '">(?)</span>';
    };
  }

  const EQ_ID = '[A-Za-z0-9_](?:[\\w.:-]*[A-Za-z0-9_])?';
  const EQ_LABEL = /\s*\{#eq:([A-Za-z0-9_][\w.:-]*)\}\s*$/;
  const EQ_REF = new RegExp('(?<![\\w@])@eq:(' + EQ_ID + ')|\\\\eqref\\{(' + EQ_ID + ')\\}', 'g');
  // `$$ {#eq:id}` al final de una línea que cierra el bloque: [la línea sin la etiqueta, la etiqueta].
  function cutLabel(line) {
    const m = EQ_LABEL.exec(line);
    return m && line.slice(0, m.index).trimEnd().endsWith('$$') ? [line.slice(0, m.index), m[1]] : [line, ''];
  }
  // Los números de las ecuaciones con etiqueta, en orden. Si una etiqueta se repite, las referencias van a la primera.
  function numberEquations(labels) {
    const byId = Object.create(null); const list = [];
    labels.forEach((id, i) => { list.push(i + 1); if (!(id in byId)) byId[id] = i + 1; });
    return { list, byId };
  }

  // Citas: [@clave], [@clave, p. 12] y [@uno; @otro]. Acá solo se reconocen; el autor y el año los pone citations.js
  // cuando se lee la bibliografía (renderCites en content.js).
  const CITE_KEY = '@[A-Za-z0-9_](?:[\\w:.-]*[A-Za-z0-9_])?(?:\\s*,\\s*[^;\\]]+?)?';
  const CITE = new RegExp('^' + CITE_KEY + '(?:\\s*;\\s*' + CITE_KEY + ')*$');
  function citePlugin(md) {
    md.inline.ruler.before('link', 'lmd_cite', (state, silent) => {
      const src = state.src; const pos = state.pos;
      if (src.charCodeAt(pos) !== 0x5B || src.charCodeAt(pos + 1) !== 0x40) return false;
      const end = src.indexOf(']', pos + 2);
      if (end === -1 || src.charCodeAt(end + 1) === 0x28) return false;
      const inner = src.slice(pos + 1, end);
      if (!CITE.test(inner)) return false;
      if (!silent) { const t = state.push('lmd_cite', 'span', 0); t.meta = { src: inner }; }
      state.pos = end + 1;
      return true;
    });
    md.renderer.rules.lmd_cite = (tokens, i) => '<span class="lmd-cite" data-cite="' + esc(tokens[i].meta.src) + '">[' + esc(tokens[i].meta.src) + ']</span>';
  }

  const CONTAINERS = { tip: 'Consejo', info: 'Información', note: 'Nota', warning: 'Advertencia', danger: 'Peligro', details: 'Detalles' };
  const ALERTS = { NOTE: 'Nota', TIP: 'Consejo', IMPORTANT: 'Importante', WARNING: 'Advertencia', CAUTION: 'Precaución' };

  function buildParser(p) {
    const md = window.markdownit({
      html: !!p.html,
      linkify: !!p.linkify,
      typographer: !!p.typographer,
      breaks: !!p.breaks,
      highlight: (str, lang) => {
        if (p.highlight && lang && window.hljs && hljs.getLanguage(lang)) {
          try { return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value; } catch (e) { /* cae al escape */ }
        }
        return '';
      },
    });
    const use = (flag, plugin) => { if (flag && plugin) md.use(plugin); };
    const emoji = window.markdownitEmoji;
    use(p.emoji, emoji && (emoji.full || emoji));
    use(p.sub, window.markdownitSub);
    use(p.sup, window.markdownitSup);
    use(p.ins, window.markdownitIns);
    use(p.mark, window.markdownitMark);
    use(p.abbr, window.markdownitAbbr);
    use(p.deflist, window.markdownitDeflist);
    use(p.footnote, window.markdownitFootnote);
    if (p.tables && window.markdownitMultimdTable) {
      md.use(window.markdownitMultimdTable, { multiline: true, rowspan: true, headerless: true });
    }
    if (p.containers && window.markdownitContainer) {
      Object.keys(CONTAINERS).forEach((name) => {
        md.use(window.markdownitContainer, name, {
          render: (tokens, idx) => {
            const t = tokens[idx];
            const title = md.utils.escapeHtml(t.info.trim().slice(name.length).trim() || T(CONTAINERS[name]));
            const at = t.nesting === 1 && t.attrGet('data-l') ? ' data-l="' + t.attrGet('data-l') + '"' : '';
            if (name === 'details') return t.nesting === 1 ? '<details class="lmd-box"' + at + '><summary>' + title + '</summary>\n' : '</details>\n';
            return t.nesting === 1 ? '<div class="lmd-box lmd-box-' + name + '"' + at + '><p class="lmd-box-title">' + title + '</p>\n' : '</div>\n';
          },
        });
      });
    }
    if (p.wikilinks) md.use(wikiPlugin);
    if (p.katex) md.use(mathPlugin);
    md.use(citePlugin);

    const fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const info = (tokens[idx].info || '').trim().split(/\s+/)[0].toLowerCase();
      const at = tokens[idx].attrGet('data-l') ? ' data-l="' + tokens[idx].attrGet('data-l') + '"' : '';
      // Con el tablero apagado en Ajustes > Herramientas el bloque sigue como bloque de código (board.js le suma una línea).
      if ((info === 'kanban' || info === 'tablero' || info === 'board') && (!LMD.tools || LMD.tools.isOn('kanban'))) return '<pre class="lmd-kanban"' + at + '>' + esc(tokens[idx].content) + '</pre>\n';
      if (p.mermaid && info === 'mermaid') return '<pre class="lmd-mermaid"' + at + '>' + esc(tokens[idx].content) + '</pre>\n';
      if (p.graphviz && (info === 'dot' || info === 'graphviz')) return '<pre class="lmd-graphviz"' + at + '>' + esc(tokens[idx].content) + '</pre>\n';
      return fence(tokens, idx, options, env, self);
    };
    // Cada bloque guarda de qué líneas del fuente salió (data-l). En las listas compactas el
    // párrafo no se dibuja, así que su rango va al <li> como data-p.
    md.core.ruler.push('lmd_lines', (state) => {
      const tokens = state.tokens;
      tokens.forEach((t, i) => {
        if (!t.map || !t.block) return;
        if (t.type === 'paragraph_open' && t.hidden) {
          for (let j = i - 1; j >= 0; j--) {
            if (tokens[j].type === 'list_item_open') { tokens[j].attrSet('data-p', t.map[0] + '-' + t.map[1]); break; }
            if (tokens[j].nesting !== 0) break;
          }
          return;
        }
        if (t.nesting === 1 || t.type === 'fence' || t.type === 'code_block' || t.type === 'hr' || t.type === 'lmd_math_block') t.attrSet('data-l', t.map[0] + '-' + t.map[1]);
      });
    });
    return md;
  }

  function slugify(text, used) {
    let base = text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'seccion';
    let slug = base; let n = 1;
    while (used.has(slug)) slug = base + '-' + n++;
    used.add(slug);
    return slug;
  }

  // El ancla que arma GitHub para un título: minúsculas, sin signos, cada espacio un guion, y los acentos quedan.
  // Es la que se escribe en los enlaces, para que el archivo se lea igual allá.
  function ghSlug(text, used) {
    const base = text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    let slug = base; let n = 1;
    while (used.has(slug)) slug = base + '-' + n++;
    used.add(slug);
    return slug;
  }

  // Cabecera YAML (--- ... ---) al inicio del archivo: se saca del cuerpo y se muestra como ficha.
  function splitFrontmatter(text) {
    const m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
    if (!m) return { body: text, rows: null };
    const rows = [];
    m[1].split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
      if (kv && !/^\s/.test(line)) rows.push([kv[1], kv[2]]);
      else if (rows.length) rows[rows.length - 1][1] += (rows[rows.length - 1][1] ? '\n' : '') + line.trim();
      else rows.push(['', line.trim()]);
    });
    return { body: text.slice(m[0].length), rows };
  }

  // ---------- Lo que el documento no puede traer ----------
  // El HTML de una nota pasa por DOMPurify. Además, de lo que escribe quien hizo la nota se saca lo que la app usa
  // para sí: atributos data-* (los botones de la app se reconocen por ellos), clases lmd-* fuera de las que arma
  // el propio parser, y estilos que saquen un bloque de su lugar para taparle la pantalla a la app.
  const OWN_DATA = ['data-l', 'data-p', 'data-tex', 'data-wiki', 'data-cite', 'data-ref', 'data-eq', 'data-n', 'data-form'];
  const OWN_CLASS = /^lmd-(wiki|math|math-block|box|box-(tip|info|note|warning|danger)|box-title|kanban|mermaid|graphviz|cite|cite-bad|eqref|eqref-bad|bib|bib-title|bib-item)$/;
  const SAFE_URL = /^(https?:|mailto:|tel:|#|[^:]*$)/i;
  let hardened = false;
  function harden(purify) {
    if (hardened || !purify || !purify.addHook) return;
    hardened = true;
    purify.addHook('uponSanitizeAttribute', (node, data) => {
      if (/^data-/.test(data.attrName) && !OWN_DATA.includes(data.attrName)) data.keepAttr = false;
    });
    purify.addHook('afterSanitizeAttributes', (node) => {
      if (!node.getAttribute) return;
      const cls = node.getAttribute('class');
      if (cls && /(^|\s)lmd-/.test(cls)) {
        const keep = cls.split(/\s+/).filter((c) => !/^lmd-/.test(c) || OWN_CLASS.test(c)).join(' ');
        if (keep) node.setAttribute('class', keep); else node.removeAttribute('class');
      }
      if (node.style && node.hasAttribute('style')) {
        if (/fixed|sticky|absolute/i.test(node.style.position)) node.style.removeProperty('position');
        if (node.style.zIndex) node.style.removeProperty('z-index');
        if (!node.getAttribute('style')) node.removeAttribute('style');
      }
    });
  }
  // El SVG de Graphviz no pasa por DOMPurify: de sus enlaces quedan solo los que llevan a una página o a una sección.
  function safeSvg(svg) {
    if (!svg || !svg.querySelectorAll) return svg;
    svg.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((n) => n.remove());
    [svg].concat(Array.from(svg.querySelectorAll('*'))).forEach((n) => {
      Array.from(n.attributes).forEach((a) => {
        const name = a.name.toLowerCase();
        if (/^on/.test(name)) n.removeAttribute(a.name);
        else if ((name === 'href' || name === 'xlink:href') && !SAFE_URL.test(a.value.trim())) n.removeAttribute(a.name);
      });
    });
    return svg;
  }

  // Macros de KaTeX en la cabecera: una línea por macro, `\RR: "\mathbb{R}"` (con o sin comillas y con o sin guion).
  function macrosOf(rows) {
    const out = {};
    const row = (rows || []).find((r) => r[0] === 'macros');
    if (!row) return out;
    let n = 0;
    String(row[1]).split('\n').forEach((line) => {
      if (n >= 200) return;
      const m = /^\s*(?:-\s+)?(?:"((?:[^"\\]|\\.)+)"|'((?:[^']|'')+)'|(\\[A-Za-z]+|\\[^A-Za-z\s]))\s*:\s*(.*?)\s*$/.exec(line);
      if (!m) return;
      const name = m[1] != null ? m[1].replace(/\\\\/g, '\\') : m[2] != null ? m[2].replace(/''/g, "'") : m[3];
      if (!/^\\([A-Za-z]+|[^A-Za-z])$/.test(name)) return;
      let v = m[4];
      if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\(["\\])/g, '$1');
      else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
      if (!v || v.length > 500) return;
      out[name] = v; n++;
    });
    return out;
  }

  LMD.md = { buildParser, macrosOf, numberEquations, cutLabel, EQ_REF, slugify, ghSlug, splitFrontmatter, CONTAINERS, ALERTS, harden, safeSvg };
})();
