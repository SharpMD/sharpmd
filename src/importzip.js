// Traer notas de Notion u Obsidian: el ZIP que exporta Notion ("Markdown y CSV"), el ZIP de una bóveda de Obsidian o
// la carpeta de la bóveda. Todo pasa en el navegador y nada se sube salvo que se elija la nube.
//  - Lo primero es una función pura, sin navegador (plan): recibe la lista de archivos con su texto y devuelve las
//    notas y los adjuntos ya con sus rutas nuevas y los enlaces arreglados. La prueba tests/importzip.mjs la corre
//    sola, con un ZIP chico de ejemplo (tests/fixtures/).
//  - Notion: se quitan los códigos de 32 letras y números de cada nombre de archivo y de carpeta, los enlaces y las
//    imágenes pasan a las rutas nuevas y cada CSV de base de datos queda como una nota con su tabla.
//  - Obsidian: las notas y los adjuntos quedan donde estaban; [[enlaces]] y front matter no se tocan. ![[imagen.png]]
//    pasa a la sintaxis de Markdown, que SharpMD dibuja. Se ignora .obsidian/.
//  - Después viene la ventana: qué se detectó, dónde dejarlo (la carpeta abierta del disco, este navegador o la nube)
//    y cómo se llamará la carpeta. En la nube el recorrido es el de "Enviar a la nube" (send.js): el tope del plan
//    se respeta y se dice cuántas notas entran antes de empezar.
// Lo pide import.js al recibir un ZIP, o el botón de la bóveda (ver LAZY_APP en content.js).
(function () {
  'use strict';

  // ---------- Rutas ----------
  const MD_RE = /\.(?:md|markdown)$/i;
  const IMG_EXT = /^(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i;
  const FILE_EXT = /^(?:png|jpe?g|gif|webp|avif|svg|bmp|mp3|wav|ogg|m4a|flac|mp4|webm|mov|mkv|pdf)$/i;
  // El código que Notion pone al final de cada nombre: un espacio y 32 letras y números (y "_all" en el CSV completo).
  const ID_PART = /(?:^|\s)[0-9a-f]{32}(?:_all)?(?=\.[A-Za-z0-9]{1,8}$|$)/i;
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^(?:\.?\/+)+/, '').replace(/\/{2,}/g, '/');
  const extOf = (name) => (/\.([A-Za-z0-9]{1,8})$/.exec(name) || ['', ''])[1];
  const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
  const stemOf = (name) => name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const key = (s) => String(s).normalize('NFC').toLowerCase();
  const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const JUNK = /(?:^|\/)(?:__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)(?:\/|$)/i;
  // Lo que una bóveda trae y no es contenido: la configuración de Obsidian, su papelera y el control de versiones.
  const VAULT_SKIP = /(?:^|\/)(?:\.obsidian|\.trash|\.git|\.svn|node_modules)(?:\/|$)/i;
  const hasId = (seg) => ID_PART.test(seg);
  function cleanSeg(seg, untitled) {
    const out = seg.replace(ID_PART, '').replace(/\s+(?=\.[A-Za-z0-9]{1,8}$)/, '');
    if (!out.trim() || /^\.[A-Za-z0-9]{1,8}$/.test(out)) return untitled + out;
    return out.trim();
  }
  // Una ruta de adentro del paquete, a partir de la carpeta de quien la nombra. Nada si se sale de la raíz.
  function resolve(dir, target) {
    const parts = (target[0] === '/' ? target.slice(1) : dir + target).split('/'); const out = [];
    for (const p of parts) {
      if (!p || p === '.') continue;
      if (p === '..') { if (!out.length) return null; out.pop(); } else out.push(p);
    }
    return out.join('/');
  }
  function relative(fromDir, to) {
    const a = fromDir.split('/').filter(Boolean); const b = to.split('/'); let n = 0;
    while (n < a.length && n < b.length - 1 && key(a[n]) === key(b[n])) n++;
    return '../'.repeat(a.length - n) + b.slice(n).join('/');
  }
  // Una ruta como va dentro de un enlace de Markdown: lo que lo rompería (espacios, paréntesis, # y ?) va con %.
  const enc = (p) => p.split('/').map((s) => s.replace(/[%\s()<>[\]#?"\\|^`]/g, (c) => (c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c)))).join('/');
  function decode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  // Si todo está adentro de una sola carpeta, cuál es.
  function topFolder(paths) {
    if (!paths.length) return '';
    const first = paths[0].split('/'); if (first.length < 2) return '';
    return paths.every((p) => p.split('/').length > 1 && p.split('/')[0] === first[0]) ? first[0] : '';
  }
  // Un nombre que no pise a otro de la lista (sin mirar mayúsculas): el mismo con un número antes de la extensión.
  function unique(taken, path) {
    let p = path; let n = 2;
    while (taken.has(key(p))) { const cut = p.lastIndexOf('.'); const slash = p.lastIndexOf('/'); const stem = cut > slash + 1 ? path.slice(0, path.lastIndexOf('.')) : path; const ext = cut > slash + 1 ? path.slice(path.lastIndexOf('.')) : ''; p = stem + ' ' + n + ext; n++; }
    taken.add(key(p));
    return p;
  }
  const wikiKey = (s) => String(s).toLowerCase().replace(/\.(md|mdx|mkd|mdown|markdown)$/i, '').replace(/[\s_-]+/g, '');

  // ---------- El texto: solo lo que no es código ----------
  // Recorre una nota y le aplica fn a cada trozo de texto corrido. El front matter, los bloques de código y lo que va
  // entre acentos graves quedan como están.
  function mapProse(text, fn) {
    const lines = String(text).split('\n'); const out = []; let i = 0; let fence = null;
    if (lines[0] && lines[0].trim() === '---') {
      for (let j = 1; j < lines.length && j < 400; j++) { if (/^(?:---|\.\.\.)\s*$/.test(lines[j])) { out.push(...lines.slice(0, j + 1)); i = j + 1; break; } }
    }
    for (; i < lines.length; i++) {
      const line = lines[i]; const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) { out.push(line); if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) fence = null; continue; }
      if (m) { fence = m[1]; out.push(line); continue; }
      out.push(line.split(/(``+[^`]*``+|`[^`\n]*`)/).map((part, k) => (k % 2 ? part : fn(part))).join(''));
    }
    return out.join('\n');
  }

  // ---------- CSV ----------
  function parseCsv(text) {
    const src = String(text).replace(/^\uFEFF/, ''); const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"' && !cell) q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    while (rows.length && rows[rows.length - 1].every((x) => !x.trim())) rows.pop();
    return rows;
  }
  const cellText = (s) => String(s).replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim();

  // ---------- Los enlaces de una nota ----------
  const LINK_RE = /(!?\[[^\]\n]*\]\()(<[^>\n]*>|[^)\s]*)((?:\s+"[^"\n]*")?\))/g;
  const URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
  const NOTION_RE = /^https?:\/\/(?:[\w-]+\.)?notion\.(?:so|site)\/([^?#]*)/i;
  const REL_REF = /([^,\n()[\]][^,\n()[\]]*?) \(([^()\s][^()]*?\.(?:md|csv))\)/g;

  // ---------- Notion ----------
  function planNotion(files, o) {
    const untitled = o.untitled; const st = stats();
    const list = files.slice().sort((a, b) => nat(a.path, b.path));
    // El CSV completo (_all) repite al de la vista: se toma uno solo.
    const csvKey = (p) => key(p.replace(/_all(\.csv)$/i, '$1'));
    const csvPick = new Map();
    list.forEach((f) => { if (/\.csv$/i.test(f.path)) { const k = csvKey(f.path); const was = csvPick.get(k); if (!was || (/_all\.csv$/i.test(was.path) && !/_all\.csv$/i.test(f.path))) csvPick.set(k, f); } });
    const taken = new Set(); const byOrig = new Map(); const byId = new Map(); const items = []; const rowsByDir = new Map();
    const idIn = (name) => { const m = /(?:^|\s)([0-9a-f]{32})(?:_all)?(?=\.[A-Za-z0-9]{1,8}$|$)/i.exec(name); return m ? m[1].toLowerCase() : ''; };
    for (const f of list) {
      const csv = /\.csv$/i.test(f.path);
      if (csv && csvPick.get(csvKey(f.path)) !== f) continue;
      const segs = f.path.split('/'); const name = segs.pop(); const dirs = segs.map((s) => cleanSeg(s, untitled));
      let nname = cleanSeg(name, untitled); if (csv) nname = nname.replace(/\.csv$/i, '.md');
      const to = unique(taken, dirs.concat(nname).join('/'));
      const kind = csv ? 'csv' : MD_RE.test(f.path) ? 'md' : 'asset';
      items.push({ f, to, kind });
      byOrig.set(key(f.path), to);
      const id = idIn(name); if (id && kind !== 'asset') byId.set(id, to);
      if (to !== f.path) st.renamed++;
      if (kind === 'md') { const d = key(dirOf(f.path)); if (!rowsByDir.has(d)) rowsByDir.set(d, new Map()); rowsByDir.get(d).set(key(stemOf(cleanSeg(name, untitled))), to); }
    }
    // Los que quedaron afuera por repetidos apuntan al mismo lugar.
    list.forEach((f) => { if (/\.csv$/i.test(f.path) && csvPick.get(csvKey(f.path)) !== f) byOrig.set(key(f.path), byOrig.get(key(csvPick.get(csvKey(f.path)).path))); });

    // A dónde apunta un enlace que está en el archivo `from` (su ruta original), escrito ahora en `toPath`.
    function target(raw, from, toPath, count) {
      let t = raw[0] === '<' ? raw.slice(1, -1) : raw;
      const n = NOTION_RE.exec(t);
      if (n) {
        const ids = n[1].match(/[0-9a-f]{32}/gi); const hit = ids ? byId.get(ids[ids.length - 1].toLowerCase()) : null;
        if (hit) { if (count) st.fixed++; return enc(relative(dirOf(toPath), hit)); }
        return null;
      }
      if (URL_RE.test(t) || t[0] === '#' || t[0] === '/') return null;
      const cut = t.search(/[?#]/); const tail = cut >= 0 ? t.slice(cut) : ''; if (cut >= 0) t = t.slice(0, cut);
      if (!t) return null;
      const at = resolve(dirOf(from), decode(t));
      const hit = at == null ? null : byOrig.get(key(at));
      if (count) st.links++;
      if (!hit) { if (count) st.unresolved++; return null; }
      if (count) st.fixed++;
      return enc(relative(dirOf(toPath), hit)) + (/^#/.test(tail) ? tail : '');
    }
    const fixLine = (line, from, toPath) => line.replace(LINK_RE, (all, a, raw, z) => { const t = target(raw, from, toPath, true); return t == null ? all : a + t + z; });

    const notes = []; const assets = [];
    for (const it of items) {
      if (it.kind === 'asset') { assets.push({ path: it.to, from: it.f.path }); continue; }
      if (it.kind === 'md') {
        notes.push({ path: it.to, from: it.f.path, text: mapProse(it.f.text == null ? '' : it.f.text, (l) => fixLine(l, it.f.path, it.to)) });
        st.notes++;
        continue;
      }
      // Una base de datos: una nota con su tabla. Los títulos se enlazan a sus páginas cuando están en la carpeta.
      const rows = parseCsv(it.f.text == null ? '' : it.f.text); const title = stemOf(baseOf(it.to));
      const rowDir = key(it.f.path.replace(/_all\.csv$/i, '.csv').replace(/\.csv$/i, '') + '/'); const pages = rowsByDir.get(rowDir) || new Map();
      let md = '# ' + title + '\n';
      if (rows.length) {
        let head = rows[0]; let body = rows.slice(1);
        if (head.length > o.maxCols) { st.cols += head.length - o.maxCols; head = head.slice(0, o.maxCols); }
        if (body.length > o.maxRows) { st.rowsCut += body.length - o.maxRows; body = body.slice(0, o.maxRows); }
        const width = head.length;
        const fixCell = (s) => String(s).replace(NOTION_URL_IN_CELL, (all, name, url) => { const t = target(url, it.f.path, it.to, false); return t == null ? name : '[' + name + '](' + t + ')'; })
          .replace(REL_REF, (all, name, ref) => { const t = target(ref, it.f.path, it.to, false); return t == null ? all : '[' + name + '](' + t + ')'; });
        const line = (cells) => '| ' + Array.from({ length: width }, (x, i) => cells[i] == null ? '' : cells[i]).join(' | ') + ' |';
        md += '\n' + line(head.map((h) => cellText(h))) + '\n|' + '---|'.repeat(width) + '\n';
        md += body.map((r) => {
          const cells = r.slice(0, width).map((c, i) => { const v = fixCell(c); if (i) return cellText(v); const page = pages.get(key(c.trim())); return page ? '[' + cellText(c) + '](' + enc(relative(dirOf(it.to), page)) + ')' : cellText(v); });
          return line(cells);
        }).join('\n') + '\n';
        st.tableRows += body.length;
      }
      notes.push({ path: it.to, from: it.f.path, text: md, table: true });
      st.dbs++;
    }
    st.assets = assets.length;
    return { kind: 'notion', notes, assets, stats: st };
  }
  // "Nombre (https://www.notion.so/…)": la forma en que un CSV nombra a otra página.
  const NOTION_URL_IN_CELL = /([^,\n()[\]][^,\n()[\]]*?) \((https?:\/\/(?:[\w-]+\.)?notion\.(?:so|site)\/[^()\s]*)\)/g;

  // ---------- Obsidian ----------
  function planVault(files, o) {
    const st = stats();
    const list = files.slice().sort((a, b) => nat(a.path, b.path));
    const notes = []; const assets = []; const byBase = new Map(); const noteKeys = new Set();
    for (const f of list) {
      if (MD_RE.test(f.path)) noteKeys.add(wikiKey(baseOf(f.path)));
      else { assets.push({ path: f.path, from: f.path }); const b = key(baseOf(f.path)); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(f.path); }
    }
    // Obsidian busca el adjunto por su nombre en toda la bóveda: si hay varios, el más cercano a la nota.
    function find(name, note) {
      const hits = byBase.get(key(baseOf(name))); if (!hits) return null;
      const want = key(name); const fit = name.indexOf('/') >= 0 ? hits.filter((p) => key(p) === want || key(p).endsWith('/' + want)) : hits;
      if (!fit.length) return null;
      const near = (p) => { const a = p.split('/'); const b = note.split('/'); let n = 0; while (n < a.length - 1 && n < b.length - 1 && a[n] === b[n]) n++; return n; };
      return fit.slice().sort((a, b) => near(b) - near(a) || a.split('/').length - b.split('/').length || nat(a, b))[0];
    }
    function embed(all, inner, note) {
      const parts = inner.split('|'); const raw = parts[0].trim(); const path = raw.split('#')[0].trim(); const alias = parts.slice(1).join('|').trim();
      if (!path) { st.noteEmbeds++; return '[[' + inner + ']]'; }
      if (FILE_EXT.test(extOf(path))) {
        const hit = find(path, note);
        if (!hit) { st.embedsMissing++; return all; }
        st.embeds++;
        const rel = enc(relative(dirOf(note), hit)); const stem = stemOf(baseOf(hit));
        if (IMG_EXT.test(extOf(hit))) { const alt = (alias && !/^\d+(?:x\d+)?$/.test(alias) ? alias : stem).replace(/[[\]]/g, ''); return '![' + alt + '](' + rel + ')'; }
        return '[' + baseOf(hit).replace(/[[\]]/g, '') + '](' + rel + ')';
      }
      // Una nota incrustada se muestra como enlace: SharpMD no incrusta notas dentro de otras.
      st.noteEmbeds++;
      return '[[' + inner + ']]';
    }
    for (const f of list) {
      if (!MD_RE.test(f.path)) continue;
      const text = mapProse(f.text == null ? '' : f.text, (l) => {
        let line = l.replace(/!\[\[([^\]\n]+?)\]\]/g, (all, inner) => embed(all, inner, f.path));
        line.replace(/\[\[([^\]\n]+?)\]\]/g, (all, inner, at, whole) => {
          if (whole[at - 1] === '!') return all; // un adjunto que falta, ya contado aparte
          const t =inner.split('|')[0].split('#')[0].split('^')[0].replace(/\\$/, '').trim().split('/').pop();
          if (!t) return all;
          st.wikis++; if (!noteKeys.has(wikiKey(t))) st.wikiMissing++;
          return all;
        });
        // Un enlace con [[nombre\|texto]] dentro de una tabla: la barra invertida es de la tabla, no del nombre.
        line = line.replace(/\[\[([^\]\n|]+?)\\\|([^\]\n]*)\]\]/g, (all, a, b) => '[[' + a + '|' + b + ']]');
        return line;
      });
      notes.push({ path: f.path, from: f.path, text });
      st.notes++;
    }
    st.assets = assets.length;
    return { kind: 'vault', notes, assets, stats: st };
  }
  function stats() { return { notes: 0, dbs: 0, assets: 0, renamed: 0, links: 0, fixed: 0, unresolved: 0, tableRows: 0, rowsCut: 0, cols: 0, embeds: 0, embedsMissing: 0, noteEmbeds: 0, wikis: 0, wikiMissing: 0 }; }

  // De qué es el paquete: una bóveda trae .obsidian; Notion deja un código en los nombres.
  function detect(paths) {
    const all = paths.map(norm);
    if (all.some((p) => /(?:^|\/)\.obsidian\//.test(p))) return 'vault';
    return all.some((p) => hasId(baseOf(p)) && /\.(?:md|csv)$/i.test(p)) ? 'notion' : 'vault';
  }
  // files: [{ path, text }]. text solo en los .md y .csv. Devuelve { kind, root, notes, assets, stats }.
  // opt: { kind: 'notion' | 'vault' (si no, se detecta), untitled: el nombre de una página sin título }.
  function plan(files, opt) {
    opt = opt || {};
    const clean = []; const seen = new Set();
    for (const f of files || []) {
      const path = norm(f.path);
      if (!path || /\/$/.test(path) || JUNK.test(path) || seen.has(path)) continue;
      seen.add(path); clean.push({ path, text: f.text, size: f.size });
    }
    const kind = opt.kind === 'notion' || opt.kind === 'vault' ? opt.kind : detect(clean.map((f) => f.path));
    const root = topFolder(clean.map((f) => f.path));
    const inside = clean.filter((f) => kind !== 'vault' || !VAULT_SKIP.test(f.path)).map((f) => (root ? { path: f.path.slice(root.length + 1), text: f.text, size: f.size } : f));
    const own = { untitled: opt.untitled || 'Untitled', maxRows: opt.maxRows || 2000, maxCols: opt.maxCols || 50 };
    const res = (kind === 'notion' ? planNotion : planVault)(inside, own);
    const skipped = clean.length - inside.length;
    // La carpeta de arriba de una exportación de Notion es "Export-<código>": no sirve de nombre.
    const name = root && !/^Export-/i.test(root) ? root : '';
    return Object.assign(res, { root: name, ignored: skipped });
  }

  const pure = { plan, detect, parseCsv, cleanSeg, mapProse, relative, resolve, enc, hasId };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof LMD === 'undefined' || !LMD.kit) return;

  // ---------- La ventana ----------
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const MAX_TEXT = 20 * 1024 * 1024; const MAX_ENTRIES = 20000; const MAX_FILE = 64 * 1024 * 1024;
  const pause = () => new Promise((r) => setTimeout(r, 0));
  const fail = (code) => Object.assign(new Error(code), { code });
  const count = (n, one, many, more) => T(n === 1 ? one : many, Object.assign({ a: n }, more || {}));
  const isText = (path) => MD_RE.test(path) || /\.csv$/i.test(path);

  // Las fuentes devuelven entradas { path, size, text(), bytes() }.
  async function fromZip(file, job, say) {
    const K = LMD.import.kit; const out = []; let nested = false;
    const add = async (zip, depth) => {
      for (const name of zip.names()) {
        if (out.length > MAX_ENTRIES) throw fail('many');
        if (/\.zip$/i.test(name) && depth < 1) { nested = true; await add(K.unzip(await zip.read(name), job), depth + 1); continue; }
        out.push({ path: name, size: zip.size(name), text: () => zip.text(name), bytes: () => zip.read(name) });
        if (out.length % 200 === 0) { say(out.length); await pause(); if (job.cancelled) throw fail('cancel'); }
      }
    };
    await add(K.unzip(new Uint8Array(await file.arrayBuffer()), job), 0);
    return { entries: out, nested, name: String(file.name || '').replace(/\.zip$/i, '') };
  }
  async function fromHandle(handle, say, job) {
    const out = [];
    const walk = async (dir, prefix) => {
      for await (const k of dir.values()) {
        if (job.cancelled) throw fail('cancel');
        if (out.length > MAX_ENTRIES) throw fail('many');
        if (k.kind === 'directory') { if (!VAULT_SKIP.test('/' + prefix + k.name + '/')) await walk(k, prefix + k.name + '/'); continue; }
        const get = () => k.getFile();
        out.push({ path: prefix + k.name, size: 0, text: async () => (await get()).text(), bytes: async () => new Uint8Array(await (await get()).arrayBuffer()) });
        if (out.length % 200 === 0) { say(out.length); await pause(); }
      }
    };
    await walk(handle, '');
    return { entries: out, nested: false, name: handle.name };
  }
  function fromFiles(files, say, job) {
    const out = [];
    for (const f of files) {
      const path = String(f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
      if (VAULT_SKIP.test('/' + path)) continue;
      out.push({ path, size: f.size, text: () => f.text(), bytes: async () => new Uint8Array(await f.arrayBuffer()) });
    }
    say(out.length);
    return { entries: out, nested: false, name: String((files[0] && files[0].webkitRelativePath) || '').split('/')[0] };
  }

  // Lee el texto de los .md y .csv y arma la lista que entiende plan().
  async function load(entries, job, progress) {
    const files = []; let n = 0; const total = entries.filter((e) => isText(e.path)).length;
    for (const e of entries) {
      if (isText(e.path) && e.size <= MAX_TEXT) {
        let text = '';
        try { text = await e.text(); } catch (err) { if (job.cancelled) throw fail('cancel'); text = ''; }
        files.push({ path: e.path, text, size: e.size });
        if (++n % 25 === 0) { progress(n, total); await pause(); if (job.cancelled) throw fail('cancel'); }
      } else files.push({ path: e.path, size: e.size });
    }
    progress(total, total);
    return files;
  }

  // Escribir en una carpeta del disco: nunca pisa nada, si la carpeta existe se usa otro nombre.
  async function toDisk(parent, folder, res, entryOf, tick, job) {
    let name = folder; let n = 2;
    for (;;) { try { await parent.getDirectoryHandle(name); name = folder + '-' + n++; } catch (e) { break; } }
    const root = await parent.getDirectoryHandle(name, { create: true });
    const dirs = new Map([['', root]]);
    const dirFor = async (path) => {
      const parts = path.split('/').slice(0, -1); let at = root; let acc = '';
      for (const p of parts) { acc += p + '/'; if (!dirs.has(acc)) dirs.set(acc, await at.getDirectoryHandle(p, { create: true })); at = dirs.get(acc); }
      return at;
    };
    const all = res.notes.map((x) => ({ path: x.path, data: () => x.text })).concat(res.assets.map((a) => ({ path: a.path, data: async () => (await entryOf(a.from).bytes()) })));
    let done = 0;
    for (const x of all) {
      if (job.cancelled) throw fail('cancel');
      const dir = await dirFor(x.path); const h = await dir.getFileHandle(baseOf(x.path), { create: true });
      const w = await h.createWritable(); await w.write(await x.data()); await w.close();
      tick(++done, all.length); if (done % 20 === 0) await pause();
    }
    return { folder: name, notes: res.notes.length, assets: res.assets.length };
  }
  async function toBrowser(folder, res, tick, job, core) {
    const have = new Set((await LMD.store.notesAll()).map((n) => n.name));
    let name = folder; let n = 2; const used = () => Array.from(have).some((x) => x.startsWith(name + '/'));
    while (used()) name = folder + '-' + n++;
    const put = []; let done = 0;
    for (const x of res.notes) {
      if (job.cancelled) throw fail('cancel');
      if (!(await LMD.store.notePut(name + '/' + x.path, x.text))) {
        for (const p of put) { try { await LMD.store.noteDelete(p); } catch (e) { /* queda para borrarla a mano */ } }
        throw fail('store');
      }
      put.push(name + '/' + x.path); tick(++done, res.notes.length); if (done % 20 === 0) await pause();
    }
    core.reloadTree();
    return { folder: name, notes: res.notes.length, assets: 0, first: put.slice().sort(nat)[0] };
  }
  // Para la nube: el mismo árbol de nodos que arma send.js con una carpeta elegida. Las imágenes viajan con las notas.
  function cloudTree(folder, res, entryOf) {
    const mk = (name) => { const kids = new Map(); return { name, dir: true, kids, list: async () => Array.from(kids.values()) }; };
    const top = mk(folder);
    const put = (path, node) => {
      const parts = path.split('/'); const last = parts.pop(); let at = top;
      for (const p of parts) { if (!at.kids.has(p + '/')) at.kids.set(p + '/', mk(p)); at = at.kids.get(p + '/'); }
      at.kids.set(last, Object.assign(node, { name: last }));
    };
    res.notes.forEach((x) => { const file = new File([x.text], baseOf(x.path), { type: 'text/markdown' }); put(x.path, { dir: false, file: async () => file, read: async () => x.text }); });
    res.assets.forEach((a) => {
      if (!/\.(?:png|jpe?g|gif|webp|avif)$/i.test(a.path)) return;
      const get = async () => new File([await entryOf(a.from).bytes()], baseOf(a.path));
      put(a.path, { dir: false, file: get, read: async () => (await get()).text() });
    });
    return [top];
  }

  function dialog(title) {
    const box = el('div', { class: 'lmd-ask lmd-imp lmd-imz' });
    box.innerHTML = '<div class="lmd-ask-card lmd-imp-card" role="dialog" aria-modal="true" aria-labelledby="lmd-imz-title">' +
      '<h3 id="lmd-imz-title">' + esc(T('Importar desde Notion u Obsidian')) + '</h3><p class="lmd-imp-name"></p>' +
      '<div class="lmd-imp-stage" data-z="stage"><div class="lmd-imp-row"><span data-z="what"></span><span class="lmd-imp-n" data-z="n"></span></div>' +
        '<div class="lmd-imp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div></div>' +
      '<p class="lmd-imp-live" role="status" aria-live="polite"></p>' +
      '<div class="lmd-imz-form" hidden>' +
        '<label class="lmd-field"><span>' + esc(T('Qué es')) + '</span><select data-z="kind"><option value="notion">' + esc(T('Exportación de Notion')) + '</option><option value="vault">' + esc(T('Bóveda de Obsidian')) + '</option></select></label>' +
        '<p class="lmd-imp-sum" data-z="sum"></p><p class="lmd-imz-how" data-z="how"></p><ul class="lmd-imp-warn" data-z="warn"></ul>' +
        '<fieldset class="lmd-imz-dest"><legend>' + esc(T('Dónde dejarlo')) + '</legend></fieldset>' +
        '<label class="lmd-field"><span>' + esc(T('Carpeta')) + '</span><input type="text" data-z="folder" spellcheck="false" autocomplete="off"></label>' +
      '</div>' +
      '<p class="lmd-dlg-err lmd-imp-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-z="cancel" data-esc>' + esc(T('Cancelar')) + '</button>' +
        '<button type="button" class="lmd-btn lmd-btn-fill" data-z="go" hidden>' + esc(T('Importar')) + '</button></div></div>';
    box.querySelector('.lmd-imp-name').textContent = title;
    return box;
  }

  let busy = false;
  // src: { entries, nested, name }. core: el núcleo de la app.
  async function session(core, src, job, label) {
    const box = dialog(label); const q = (s) => box.querySelector(s); const z = (n) => box.querySelector('[data-z=' + n + ']');
    const live = q('.lmd-imp-live'); let closed = false; let stop = null;
    const close = () => { if (closed) return; closed = true; box.remove(); };
    const bar = (what, done, total) => {
      const pct = total ? Math.round(100 * done / total) : 0; const b = q('.lmd-imp-bar');
      z('what').textContent = what; z('n').textContent = total ? T('{a} de {b}', { a: done, b: total }) : '';
      b.setAttribute('aria-valuenow', String(pct)); b.firstChild.style.width = pct + '%';
    };
    const fault = (text) => { q('.lmd-imp-err').hidden = false; q('.lmd-imp-err').textContent = text; live.textContent = text; };
    document.body.appendChild(box);
    z('cancel').focus();
    const wait = new Promise((resolve) => { stop = resolve; });
    box.addEventListener('keydown', (e) => e.stopPropagation());
    z('cancel').addEventListener('click', () => { job.cancel(); close(); stop(null); });
    const by = new Map(src.entries.map((e) => [e.path, e]));
    const entryOf = (p) => by.get(p);
    try {
      bar(T('Leyendo el archivo…'), 0, 0);
      const files = await load(src.entries, job, (d, t) => bar(T('Leyendo el archivo…'), d, t));
      if (closed) return;
      job.unzipped = 0;
      const untitled = T('Sin título');
      let kind = plan(files, { untitled }).kind; let res = null;
      const redo = () => { res = plan(files, { kind, untitled, maxRows: 2000, maxCols: 50 }); };
      redo();
      if (!res.notes.length) { z('stage').hidden = true; fault(T('Ese ZIP no trae notas en Markdown ni bases de datos.')); z('cancel').textContent = T('Cerrar'); return; }
      const dests = [];
      const diskUrl = core.APP && core.diskDir ? core.diskDir() : '';
      if (diskUrl && window.showDirectoryPicker) dests.push({ id: 'disk', label: T('En la carpeta abierta del disco') });
      dests.push({ id: 'browser', label: T('En este navegador') });
      if (LMD.send && LMD.send.upload && LMD.send.reach()) dests.push({ id: 'cloud', label: T('En mi nube') });
      let dest = dests[0].id; 
      const fs = q('.lmd-imz-dest');
      dests.forEach((d) => {
        const lab = el('label', { class: 'lmd-send-img' }); const r = el('input', { type: 'radio', name: 'lmd-imz-dest', value: d.id }); r.checked = d.id === dest;
        lab.append(r, el('span', { text: d.label })); fs.appendChild(lab);
      });
      if (!diskUrl) fs.appendChild(el('p', { class: 'lmd-hint', text: T('Para dejarlo en el disco, abrí antes la carpeta donde lo querés.') }));
      const hints = el('p', { class: 'lmd-hint', 'data-z': 'hint' }); fs.appendChild(hints);
      const nameBox = z('folder');
      const paint = () => {
        z('kind').value = res.kind;
        const s = res.stats; const lines = [];
        z('sum').textContent = [count(s.notes, '1 nota', '{a} notas'), s.dbs ? count(s.dbs, '1 base de datos', '{a} bases de datos') : '', s.assets ? count(s.assets, '1 adjunto', '{a} adjuntos') : ''].filter(Boolean).join(', ') + '.';
        z('how').textContent = res.kind === 'notion'
          ? T('Se quitan los códigos de los nombres, se arreglan los enlaces y cada base de datos queda como una nota con su tabla.')
          : T('Las notas y los adjuntos quedan donde están. Los enlaces con corchetes dobles y el front matter no se tocan, y las imágenes incrustadas pasan a Markdown.');
        if (s.fixed) lines.push(count(s.fixed, '1 enlace arreglado.', '{a} enlaces arreglados.'));
        if (s.unresolved) lines.push(count(s.unresolved, '1 enlace no apunta a nada de lo importado.', '{a} enlaces no apuntan a nada de lo importado.'));
        if (s.embeds) lines.push(count(s.embeds, '1 imagen o archivo incrustado pasó a Markdown.', '{a} imágenes o archivos incrustados pasaron a Markdown.'));
        if (s.noteEmbeds) lines.push(count(s.noteEmbeds, '1 nota incrustada quedó como enlace.', '{a} notas incrustadas quedaron como enlaces.'));
        if (s.embedsMissing) lines.push(count(s.embedsMissing, '1 adjunto incrustado no está en la carpeta.', '{a} adjuntos incrustados no están en la carpeta.'));
        if (s.wikiMissing) lines.push(count(s.wikiMissing, '1 enlace con corchetes dobles no encuentra su nota.', '{a} enlaces con corchetes dobles no encuentran su nota.'));
        if (s.rowsCut) lines.push(T('Tablas cortadas: {a} filas quedaron afuera.', { a: s.rowsCut }));
        if (s.cols) lines.push(T('Tablas cortadas: {a} columnas quedaron afuera.', { a: s.cols }));
        if (res.ignored) lines.push(T('Se ignoró la configuración de Obsidian y la papelera.'));
        if (src.nested) lines.push(T('Había otro ZIP adentro (Notion parte las exportaciones grandes): también se abrió.'));
        const ul = z('warn'); ul.textContent = ''; lines.forEach((l) => ul.appendChild(el('li', { text: l }))); ul.hidden = !lines.length;
        const chosen = box.querySelector('[name=lmd-imz-dest]:checked'); dest = chosen ? chosen.value : dest;
        hints.textContent = dest === 'browser' && s.assets ? T('Este navegador guarda solo notas: los adjuntos no entran. Para llevarlos, elegí el disco o la nube.')
          : dest === 'cloud' ? T('En la nube se respeta el tope del plan: antes de subir se dice cuántas notas entran. De los adjuntos, suben solo las imágenes.') : '';
        live.textContent = z('sum').textContent;
      };
      nameBox.value = (LMD.send && LMD.send.cleanName ? LMD.send.cleanName(res.root || src.name) : (res.root || src.name)) || (kind === 'notion' ? 'Notion' : 'Obsidian');
      z('stage').hidden = true; q('.lmd-imz-form').hidden = false; z('go').hidden = false; paint();
      z('go').focus();
      box.addEventListener('change', (e) => {
        if (e.target === z('kind')) { kind = z('kind').value; redo(); paint(); } else if (e.target.name === 'lmd-imz-dest') paint();
      });
      for (;;) {
        const choice = await Promise.race([wait, new Promise((resolve) => z('go').addEventListener('click', () => resolve('go'), { once: true }))]);
        if (choice !== 'go' || closed) return;
        const folder = (nameBox.value || '').trim() || (kind === 'notion' ? 'Notion' : 'Obsidian');
        const form = (on) => { q('.lmd-imz-form').hidden = !on; z('go').hidden = !on; z('stage').hidden = on; };
        q('.lmd-imp-err').hidden = true; form(false);
        const tick = (d, t) => bar(T('Guardando…'), d, t);
        let out = null;
        if (dest === 'cloud') {
          close();
          await LMD.send.upload(cloudTree(folder, res, entryOf));
          return;
        }
        if (dest === 'disk') {
          if (!(await core.allowWrite(diskUrl))) { form(true); fault(T('Falta el permiso para escribir en la carpeta.')); continue; }
          out = await toDisk(await core.dirHandle(diskUrl), folder, res, entryOf, tick, job);
          await core.reloadTree();
        } else out = await toBrowser(folder, res, tick, job, core);
        close();
        const said = count(out.notes, 'Se guardó 1 nota en "{b}".', 'Se guardaron {a} notas en "{b}".', { b: out.folder });
        core.flash(said + (out.assets ? ' ' + count(out.assets, 'Y 1 adjunto.', 'Y {a} adjuntos.') : ''));
        if (out.first) { try { await core.open(core.localUrl(out.first), { tree: true, edit: 'on' }); } catch (e) { /* queda en el explorador */ } }
        return;
      }
    } catch (e) {
      if (e && e.code === 'cancel') { close(); core.flash(T('Importación cancelada')); return; }
      if (closed) return;
      z('stage').hidden = true; q('.lmd-imz-form').hidden = true; z('go').hidden = true;
      fault(e && e.code === 'store' ? T('No hay lugar en el navegador para guardar todo.') : e && e.code === 'many' ? T('Hay demasiados archivos para importar de una vez.') : e && /^(?:bad|zip_big|no_inflate)$/.test(e.code) ? LMD.import.kit.why(e) : T('No se pudo importar. Probá de nuevo.'));
      z('cancel').textContent = T('Cerrar'); z('cancel').focus();
      await wait;
    }
  }

  async function open(core, makeSource, label) {
    if (busy) return false;
    busy = true;
    const job = LMD.import.kit.newJob();
    try {
      let src = null;
      try { src = await makeSource(job); } catch (e) {
        if (e && e.code === 'cancel') return false;
        if (e && e.code === 'many') { core.flash(T('Hay demasiados archivos para importar de una vez.'), 'error'); return false; }
        core.flash(LMD.import.kit.why(e), 'error'); return false;
      }
      if (!src) return false;
      await session(core, src, job, label || src.name);
      return true;
    } finally { busy = false; }
  }
  // Un ZIP: el de Notion o el de una bóveda.
  const run = (file, core) => open(core, (job) => fromZip(file, job, () => {}), file.name);
  // La carpeta de una bóveda: con el selector de carpetas del navegador o, donde no hay, con un input de carpeta.
  function pickVault(core) {
    if (busy) return;
    if (window.showDirectoryPicker) {
      let asked = null;
      try { asked = window.showDirectoryPicker({ mode: 'read' }); } catch (e) { asked = Promise.reject(e); }
      Promise.resolve(asked).then((h) => { if (h) open(core, (job) => fromHandle(h, () => {}, job), h.name); }, (e) => { if (!e || e.name !== 'AbortError') core.flash(T('No se pudo abrir. Probá de nuevo.'), 'error'); });
      return;
    }
    const input = el('input', { type: 'file', class: 'lmd-imp-file', hidden: '' }); input.webkitdirectory = true; input.multiple = true;
    input.addEventListener('change', () => { const files = Array.from(input.files || []); input.remove(); if (files.length) open(core, (job) => fromFiles(files, () => {}, job), files[0].webkitRelativePath.split('/')[0]); });
    input.addEventListener('cancel', () => input.remove());
    document.body.appendChild(input); input.click();
  }
  const canPickVault = () => !!window.showDirectoryPicker || 'webkitdirectory' in HTMLInputElement.prototype;

  LMD.importzip = { run, pickVault, canPickVault, pure, busy: () => busy };
})();
