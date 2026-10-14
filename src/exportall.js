// Descargar todas mis notas. Arma en el navegador un ZIP con todas las notas de la nube, con sus carpetas, los
// tableros (viven dentro de las notas) y las imágenes que las notas usan, que van en _images/ con la dirección ya
// apuntando ahí. Las notas del equipo, si la persona las quiere, van en la subcarpeta @team/.
//  - Lo lee todo con los mismos pedidos de siempre (lista y lectura de cada nota): no hay un endpoint aparte.
//  - Una carpeta protegida con la llave abierta sale descifrada, y se descifra acá. Si está bloqueada se ofrece
//    desbloquearla; si no, queda afuera y el ZIP lleva _not-included.txt con la lista. La llave nunca sale del navegador.
//  - El ZIP lo arma LMD.docx.zip, el mismo de las plantillas y los documentos.
// Se pide recién al usarla (LAZY_APP en content.js): desde Ajustes > Nube y desde el aviso de eliminar la cuenta.
(function () {
  'use strict';

  const { el } = LMD.kit;
  const T = LMD.t;
  let busy = false;

  const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  // Una ruta adentro del ZIP: tramos con nombre, sin "..", sin barras invertidas ni caracteres de control.
  const okPath = (p) => typeof p === 'string' && !!p && p.length <= 400 && !/[\\\u0000-\u001f]/.test(p) && p.split('/').every((s) => s && s !== '.' && s !== '..');
  const sealed = (v) => !!v && (v.state === 'on' || v.state === 'rotating');
  const nameOf = (v) => (v.team ? T('Equipo') : v.folder || T('Tu nube'));

  // La ventana que muestra cuánto va. Cancelar frena el trabajo en el próximo paso.
  function progress(title) {
    const box = el('div', { class: 'lmd-ask lmd-dlg' });
    box.innerHTML = '<div class="lmd-ask-card lmd-dlg-card" role="dialog" aria-modal="true"><h3></h3><p class="lmd-dlg-text" role="status"></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-esc data-x></button></div></div>';
    box.querySelector('h3').textContent = title; box.querySelector('[data-x]').textContent = T('Cancelar');
    box.querySelector('.lmd-dlg-card').setAttribute('aria-label', title);
    const state = { stop: false, say: (t) => { box.querySelector('.lmd-dlg-text').textContent = t; }, close: () => { box.remove(); } };
    box.querySelector('[data-x]').addEventListener('click', () => { state.stop = true; state.close(); });
    document.body.appendChild(box);
    return state;
  }

  // De a pocos a la vez: la nube entera no se pide en un solo golpe.
  async function pool(items, size, fn, state) {
    let i = 0;
    const worker = async () => { while (i < items.length && !state.stop) { const k = i++; await fn(items[k], k); } };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  }

  // opts.team: false deja afuera las notas del equipo sin preguntar (al eliminar la cuenta no se borran).
  // Devuelve { n, images, skipped } al terminar, o null si se canceló o no se pudo.
  async function run(core, opts) {
    opts = opts || {};
    if (busy) return null; busy = true;
    let prog = null;
    try {
      if (!LMD.cloud.signedIn()) return null;
      if (!(await core.ensure('docx')) || !LMD.docx) { core.flash(T('No se pudo armar el archivo. Probá de nuevo.'), 'error'); return null; }
      const team = LMD.cloud.teamNow();
      const own = (await LMD.cloud.list(true)).filter((r) => okPath(r.path)).map((r) => ({ full: r.path, inner: r.path, space: '', root: '' }));
      let mates = [];
      if (team && opts.team !== false) {
        try { mates = (await LMD.cloud.list(true, team.space)).filter((r) => okPath(r.path)).map((r) => ({ full: '~' + team.space + '/' + r.path, inner: r.path, space: String(team.space), root: '@team/' })); }
        catch (e) { mates = []; }
      }
      if (!own.length && !mates.length) { core.flash(T('No hay notas para descargar.')); return null; }
      if (mates.length) {
        const pick = await LMD.dialog.confirm({ title: T('Notas del equipo'), text: T('Tu equipo tiene {n} notas. Podés sumarlas al ZIP en una carpeta aparte, @team.', { n: mates.length }), ok: T('Incluirlas'), alt: T('Solo las mías') });
        if (!pick) return null;
        if (pick === 'alt') mates = [];
      }
      let rows = own.concat(mates);
      // Las carpetas protegidas que siguen bloqueadas: se ofrece abrirlas. Lo que no se abre, queda afuera.
      const vaults = await LMD.cloud.vaults(true);
      const locked = () => vaults.filter((v) => sealed(v) && !LMD.vault.isOpen(v) && rows.some((r) => LMD.cloud.vaultHas(v, r.full)));
      const first = locked();
      if (first.length) {
        const pick = await LMD.dialog.confirm({ title: T('Hay carpetas bloqueadas'),
          text: T('Estas carpetas están protegidas con contraseña: {a}. Si las desbloqueás, salen descifradas en el ZIP; la llave no sale de este navegador. Si no, quedan afuera.', { a: first.map(nameOf).join(', ') }),
          ok: T('Desbloquear'), alt: T('Seguir sin ellas') });
        if (!pick) return null;
        if (pick === true) for (const v of first) { try { await LMD.vault.unlock(v); } catch (e) { /* queda afuera */ } }
      }
      const closed = locked();
      const skipped = [];
      rows = rows.filter((r) => { if (closed.some((v) => LMD.cloud.vaultHas(v, r.full))) { skipped.push({ path: r.root + r.inner, why: T('Carpeta bloqueada') }); return false; } return true; });

      prog = progress(T('Descargar todas mis notas'));
      const notes = [];
      let done = 0;
      prog.say(T('Leyendo notas: {a} de {b}', { a: 0, b: rows.length }));
      let offline = false;
      await pool(rows, 4, async (r) => {
        try { const n = await LMD.cloud.read(r.full); notes.push({ r, text: String(n.text == null ? '' : n.text) }); }
        catch (e) {
          if (e.code === 'offline') { offline = true; prog.stop = true; return; }
          skipped.push({ path: r.root + r.inner, why: e.code === 'vault_locked' ? T('Carpeta bloqueada') : T('No se pudo leer') });
        }
        prog.say(T('Leyendo notas: {a} de {b}', { a: ++done, b: rows.length }));
      }, prog);
      if (offline) { prog.close(); core.flash(T('No hay conexión con el servidor.'), 'error'); return null; }
      if (prog.stop) return null;

      // Las imágenes que las notas usan: cada una se baja una vez por árbol (lo propio y @team/) y la dirección
      // del texto pasa a ser la ruta relativa dentro del ZIP. Las que no se pueden bajar quedan como estaban.
      const files = []; const imgs = new Map(); let missing = 0;
      const refsOf = (n) => (LMD.images ? LMD.images.refsIn(n.text) : []);
      const wanted = [];
      for (const n of notes) for (const ref of refsOf(n)) { const key = n.r.root + '|' + ref.id; if (!imgs.has(key)) { imgs.set(key, null); wanted.push({ key, ref, root: n.r.root, space: n.r.space }); } }
      done = 0;
      await pool(wanted, 4, async (w) => {
        try {
          const got = await LMD.images.fetchRef(w.ref, w.space ? [w.space, ''] : ['']);
          if (got) { const name = '_images/' + w.ref.id + '.' + got.ext; imgs.set(w.key, name); files.push({ name: w.root + name, data: got.bytes }); } else missing++;
        } catch (e) { if (e.code === 'offline') { offline = true; prog.stop = true; return; } missing++; }
        prog.say(T('Bajando imágenes: {a} de {b}', { a: ++done, b: wanted.length }));
      }, prog);
      if (offline) { prog.close(); core.flash(T('No hay conexión con el servidor.'), 'error'); return null; }
      if (prog.stop) return null;

      prog.say(T('Armando el ZIP'));
      const enc = new TextEncoder(); const top = 'sharpmd-notes/';
      const used = new Set();
      for (const n of notes.sort((a, b) => nat(a.r.root + a.r.inner, b.r.root + b.r.inner))) {
        let text = n.text; const up = '../'.repeat(n.r.inner.split('/').length - 1);
        for (const ref of refsOf(n)) { const name = imgs.get(n.r.root + '|' + ref.id); if (name) text = text.split(ref.url).join(up + name); }
        files.push({ name: n.r.root + n.r.inner, data: enc.encode(text) });
      }
      if (skipped.length) {
        const list = skipped.sort((a, b) => nat(a.path, b.path)).map((s) => s.why + ': ' + s.path);
        files.push({ name: '_not-included.txt', data: enc.encode(T('Notas que no entraron en este ZIP') + '\n\n' + list.join('\n') + '\n') });
      }
      const named = files.filter((f) => { const k = f.name.toLowerCase(); if (used.has(k)) return false; used.add(k); return true; }).map((f) => ({ name: top + f.name, data: f.data }));
      let bytes = null;
      try { bytes = await LMD.docx.zip(named); } catch (e) { prog.close(); core.flash(T('No se pudo armar el archivo. Probá de nuevo.'), 'error'); return null; }
      prog.close();
      const file = 'sharpmd-notes-' + new Date().toISOString().slice(0, 10) + '.zip';
      LMD.kit.saveFile(new Blob([bytes], { type: 'application/zip' }), file);
      const out = { n: notes.length, images: wanted.length - missing, skipped: skipped.length };
      let msg = notes.length === 1 ? T('Se descargó 1 nota en "{a}".', { a: file }) : T('Se descargaron {n} notas en "{a}".', { n: notes.length, a: file });
      if (skipped.length) msg += ' ' + T('Quedaron afuera {n}; la lista está en _not-included.txt.', { n: skipped.length });
      core.flash(msg, skipped.length ? 'warn' : undefined);
      return out;
    } catch (e) {
      if (prog) prog.close();
      core.flash(T(e && e.code === 'offline' ? 'No hay conexión con el servidor.' : 'No se pudo completar. Probá de nuevo.'), 'error');
      return null;
    } finally { busy = false; }
  }

  LMD.exportall = { run };
})();
