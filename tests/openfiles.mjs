// "Abiertos": lo que la persona abrió del disco, en una sola sección del explorador.
// Un archivo suelto es un renglón (nunca una raíz con él mismo adentro) y una carpeta se despliega. Abrir otro lo suma;
// la lista sigue al recargar y en otra pestaña; se cierra con la cruz o desde el menú, sin tocar el disco; cerrar lo
// que está a la vista vuelve al inicio; un permiso vencido se pide con el mismo toque y nunca al cargar; sin acceso
// al disco (Firefox, Safari) son copias de la pestaña y se dice. Además: la guía no aparece sola, cada botón de
// ícono dice qué hace en los dos idiomas, el teléfono, el teclado, y atrás y adelante.
// El disco es OPFS con los selectores reemplazados, en un perfil de verdad (guardar un permiso en el contexto de
// paso del rig cierra el navegador; ver folderpage.mjs). Capturas en C:\tmp\agabiertos\ (o SHOTS).
// Uso: node openfiles.mjs
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { rig, tally, sleep } from './rig.mjs';

const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(60); } };
const SHOTS = process.env.SHOTS || 'C:\\tmp\\agabiertos';
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) { /* sin carpeta de capturas, se sigue */ }
const shot = async (page, name) => { try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } catch (e) { /* una captura que falla no frena la prueba */ } };
const noShout = (s) => !/[!¡—–]/.test(s);

const R = await rig({ ALLOW_ORIGINS: '*' });
const FILES = {
  'mensaje-lunes-fede.md': '# Mensaje del lunes\n\nHola. Texto del archivo suelto.\n',
  'otro.md': '# Otro archivo\n\nSegundo suelto.\n',
  'tercero.md': '# Tercero\n\nDesde la otra pestaña.\n',
  'notas/README.md': '# Notas\n\nLa carpeta. Mirá [el fondo](sub/deep/fondo.md).\n',
  'notas/b.md': '# Beta\n\nOtra nota.\n',
  'notas/sub/c.md': '# Gamma\n',
  'notas/sub/deep/fondo.md': '# Fondo\n\nBien adentro.\n',
  'proyecto/plan.md': '# Plan\n\nEl plan.\n',
};
for (let i = 1; i <= 40; i++) FILES['notas/n' + String(i).padStart(2, '0') + '.md'] = '# Nota ' + i + '\n\nCuerpo ' + i + '.\n';

// Lo que se pone antes de cada página: los selectores (devuelven lo que la prueba pidió por nombre) y el permiso de
// cada archivo o carpeta, que se puede dejar en "hay que pedirlo" por nombre. Cada pedido queda anotado.
const INIT = () => {
  const perms = () => { try { return JSON.parse(localStorage.getItem('__perm') || '{}'); } catch (e) { return {}; } };
  const walk = async (rel, dir) => { let d = await navigator.storage.getDirectory(); const parts = rel.split('/'); const last = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); return dir ? d.getDirectoryHandle(last) : d.getFileHandle(last); };
  window.__asks = []; window.__picks = [];
  window.__row = (name) => [...document.querySelectorAll('.lmd-open-row')].find((r) => r.querySelector('.lmd-node-name').textContent === name);
  if (!window.FileSystemHandle || window.__noFs) return;
  const q = FileSystemHandle.prototype.queryPermission; const w = FileSystemFileHandle.prototype.createWritable;
  FileSystemHandle.prototype.queryPermission = function (o) { const p = perms()[this.name]; return p ? Promise.resolve(p) : q.call(this, o); };
  FileSystemHandle.prototype.requestPermission = function (o) {
    window.__asks.push(this.name + ':' + ((o && o.mode) || 'read'));
    const all = perms(); if (!all[this.name]) return Promise.resolve('granted');
    const say = window.__answer || 'granted';
    if (say === 'granted') { delete all[this.name]; localStorage.setItem('__perm', JSON.stringify(all)); }
    return Promise.resolve(say);
  };
  FileSystemFileHandle.prototype.createWritable = function (o) { return window.__nowrite ? Promise.reject(new DOMException('no', 'NotAllowedError')) : w.call(this, o); };
  window.showOpenFilePicker = async () => { window.__picks.push('file'); return [await walk(window.__next)]; };
  window.showDirectoryPicker = async () => { window.__picks.push('dir'); return walk(window.__next, true); };
};
const profiles = [];
const persistent = async (opt) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-of-'));
  const ctx = await chromium.launchPersistentContext(dir, Object.assign({ executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', serviceWorkers: 'block' }, opt || {}));
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => { R.outside.push(r.request().url()); return r.abort(); });
  await ctx.addInitScript((url) => { try { if (!localStorage.getItem('mdtools:settings')) localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: url })); } catch (e) { /* una página en blanco no tiene almacenamiento */ } }, R.base);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage(); page.on('pageerror', (e) => R.errors.push(e.message));
  profiles.push({ ctx, dir });
  return { ctx, page };
};
const seed = (page) => page.evaluate(async (files) => {
  const base = await navigator.storage.getDirectory();
  for (const [rel, text] of Object.entries(files)) { let d = base; const parts = rel.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p, { create: true }); const h = await d.getFileHandle(name, { create: true }); const w = await h.createWritable(); await w.write(text); await w.close(); }
}, FILES);
// Todo lo que hay en el "disco", con su texto: para comprobar que cerrar no toca nada.
const disk = (page) => page.evaluate(async () => { const out = {}; const walk = async (d, pre) => { for await (const [name, h] of d.entries()) { if (h.kind === 'directory') await walk(h, pre + name + '/'); else out[pre + name] = await (await h.getFile()).text(); } }; await walk(await navigator.storage.getDirectory(), ''); return out; });

// Lo que muestra el explorador.
const tree = (page) => page.evaluate(() => {
  const box = document.querySelector('.lmd-tree-box'); const open = box.querySelector(':scope > .lmd-xroot[data-root=open]');
  const row = (r) => { const a = r.querySelector('.lmd-node'); return { name: a.querySelector('.lmd-node-name').textContent, sub: (a.querySelector('.lmd-node-sub') || { textContent: '' }).textContent.trim(), locked: a.classList.contains('lmd-node-locked'), active: a.classList.contains('lmd-active'), tag: a.tagName, kids: r.querySelectorAll('.lmd-node').length, ico: !!a.querySelector('.lmd-node-ico svg'), title: a.title, x: !!r.querySelector('.lmd-node-x') }; };
  const dirs = open ? [...open.querySelectorAll(':scope > .lmd-tree > .lmd-xroot')] : [];
  return {
    roots: [...box.querySelectorAll(':scope > .lmd-xroot')].map((s) => s.dataset.root),
    openName: open ? open.querySelector(':scope > .lmd-tree-head .lmd-tree-path').textContent : '',
    files: open ? [...open.querySelectorAll(':scope > .lmd-tree > .lmd-open-row')].map(row) : [],
    dirs: dirs.map((s) => ({ name: s.querySelector('.lmd-tree-path').textContent, root: s.dataset.root, shut: s.classList.contains('lmd-shut'), sub: (s.querySelector('.lmd-root-tog .lmd-node-sub') || { textContent: '' }).textContent.trim(), locked: s.querySelector('.lmd-root-tog').classList.contains('lmd-node-locked'), x: !!s.querySelector(':scope > .lmd-tree-head .lmd-node-x'), nodes: [...s.querySelectorAll(':scope > .lmd-tree > .lmd-node .lmd-node-name')].map((n) => n.textContent) })),
    note: open && open.querySelector('.lmd-open-note') ? open.querySelector('.lmd-open-note').textContent : '',
    names: [...box.querySelectorAll('.lmd-node-name, .lmd-tree-path')].map((n) => n.textContent),
    active: [...box.querySelectorAll('.lmd-active')].map((n) => (n.querySelector('.lmd-node-name, .lmd-tree-path') || n).textContent),
    localEmpty: (box.querySelector('.lmd-xroot[data-root=local] .lmd-empty') || { textContent: '' }).textContent,
    cloudHint: (box.querySelector('.lmd-xroot[data-root=cloud] .lmd-root-hint') || { textContent: '' }).textContent,
    wide: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
const st = (page) => page.evaluate(() => ({ f: new URLSearchParams(location.search).get('f') || '', title: document.title, h1: (document.querySelector('.lmd-article h1') || { textContent: '' }).textContent.trim(), home: !document.querySelector('.lmd-home').hidden, dir: document.documentElement.classList.contains('lmd-dir'), flash: [...document.querySelectorAll('.lmd-toast, .lmd-status')].map((n) => n.textContent).filter(Boolean).join(' '), msg: (document.querySelector('.lmd-home-msg') || { textContent: '' }).textContent, dlg: (document.querySelector('.lmd-dlg-card') || { textContent: '' }).textContent }));
const h1is = (page, text, ms) => until(async () => { const s = await st(page); return s.h1 === text && !s.home ? s : null; }, ms || 8000);
const atHome = (page, ms) => until(async () => { const s = await st(page); return s.home && !s.f ? s : null; }, ms || 8000);
const files = async (page) => (await tree(page)).files.map((f) => f.name);
const dirs = async (page) => (await tree(page)).dirs.map((d) => d.name);
const next = (page, rel) => page.evaluate((r) => { window.__next = r; }, rel);
// Abrir desde el botón "Abrir" de la cabecera del explorador.
const openVia = async (page, what, rel) => { await next(page, rel); await page.click('.lmd-zone-head .lmd-tree-open'); await page.click('.lmd-menu [data-f=' + what + ']'); };
const rowOf = (name) => '.lmd-open-row:has(.lmd-node-name:text-is("' + name + '"))';
const dirOf = (name) => '.lmd-open-dir:has(> .lmd-tree-head .lmd-tree-path:text-is("' + name + '"))';
const stored = (page) => page.evaluate(async () => (await LMD.store.rootsAll()).map((r) => r.kind + ':' + r.name).sort());
const setTheme = async (page, theme) => { await page.evaluate((t) => LMD.patch({ theme: t }), theme); await sleep(350); };
const both = async (page, name) => { await page.evaluate(() => { const pane = document.querySelector('.lmd-pane-files'); if (pane) pane.scrollTop = 0; }); await shot(page, name + '-oscuro'); await setTheme(page, 'light'); await shot(page, name + '-claro'); await setTheme(page, 'dark'); };
const menu = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-menu [role=menuitem]')].map((b) => b.textContent.trim()));

let bad = 1;
try {
  // ---------- Alguien nuevo ----------
  console.log('La primera pantalla de alguien nuevo');
  const k = await persistent(); const p = k.page;
  await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]'); await p.waitForSelector('.lmd-xroot[data-root=cloud]');
  await sleep(400);
  const n0 = await tree(p);
  check('el explorador muestra solo lo suyo: En este navegador y la nube, sin la guía y sin "Abiertos"', J(n0.roots) === J(['local', 'cloud']), n0.roots);
  check('En este navegador está vacío y dice cómo empezar; la nube invita a entrar', n0.localEmpty === 'Create a note with the + button.' && n0.cloudHint === 'Sign in to see your notes', [n0.localEmpty, n0.cloudHint]);
  const acts = await p.evaluate(() => ({ btns: [...document.querySelectorAll('.lmd-home-actions > *')].map((b) => (b.dataset.home || 'label') + ':' + b.textContent.trim()), tips: [...document.querySelectorAll('.lmd-home-actions .lmd-btn')].map((b) => [b.title, b.getAttribute('aria-label')]), guide: !!document.querySelector('.lmd-home [data-home=guide]'), icons: [...document.querySelectorAll('.lmd-home-actions .lmd-btn')].map((b) => b.querySelector('svg').innerHTML) }));
  check('el inicio separa crear de abrir: nota nueva y plantilla arriba; con su rótulo, abrir archivo y abrir carpeta', J(acts.btns) === J(['new:New note', 'tpl:From a template', 'label:Or open something from your disk', 'file:Open file', 'dir:Open folder']) && acts.guide, acts.btns);
  check('cada botón del inicio dice qué hace (title y aria-label), y ningún ícono se repite', acts.tips.every((t) => t[0] && t[1] && t[1].length > t[0].length - 80 && noShout(t[0])) && new Set(acts.icons).size === acts.icons.length && /whole folder/.test(acts.tips[3][0]) && /a file from your disk/.test(acts.tips[2][0]), acts.tips);
  await both(p, '1-alguien-nuevo');

  console.log('La guía no aparece sola');
  await p.click('.lmd-home [data-home=guide]'); await h1is(p, 'Getting started');
  await p.waitForSelector('.lmd-xroot[data-root=guide] .lmd-node.lmd-active');
  const g1 = await tree(p);
  check('leyendo una nota de la guía, su raíz está en el explorador para pasar de una a otra', g1.roots[g1.roots.length - 1] === 'guide' && g1.active.includes('Start here'), g1);
  await p.click('.lmd-xroot[data-root=guide] .lmd-node:has-text("Files and folders")'); await h1is(p, 'Files and folders');
  check('y se navega entre sus notas', (await tree(p)).active.includes('Files and folders'));
  await p.goBack(); await h1is(p, 'Getting started'); await p.goBack(); await atHome(p);
  await until(async () => !(await tree(p)).roots.includes('guide'));
  check('al salir de la guía su raíz se va', J((await tree(p)).roots) === J(['local', 'cloud']), (await tree(p)).roots);

  // ---------- Un archivo suelto ----------
  console.log('Un archivo suelto es un renglón');
  await seed(p);
  const disk0 = await disk(p);
  await next(p, 'mensaje-lunes-fede.md'); await p.click('[data-home=file]'); await h1is(p, 'Mensaje del lunes');
  await p.waitForSelector(rowOf('mensaje-lunes-fede.md') + ' .lmd-node.lmd-active');
  const a1 = await tree(p);
  check('abrir un archivo lo deja en "Abiertos" como un renglón: su ícono, su nombre y la cruz', a1.roots[0] === 'open' && a1.openName === 'Open' && a1.files.length === 1 && a1.files[0].name === 'mensaje-lunes-fede.md' && a1.files[0].tag === 'A' && a1.files[0].ico && a1.files[0].x && a1.files[0].active, a1);
  check('sin anidar: el nombre figura una sola vez, no hay una raíz con su nombre ni nada adentro', a1.names.filter((n) => n === 'mensaje-lunes-fede.md').length === 1 && a1.files[0].kids === 1 && !a1.dirs.length && !a1.roots.includes('disk'), a1.names);
  check('y queda guardado en el navegador', J(await stored(p)) === J(['file:mensaje-lunes-fede.md']), await stored(p));

  console.log('Abrir otro lo suma');
  await openVia(p, 'file', 'otro.md'); await h1is(p, 'Otro archivo');
  await p.waitForSelector(rowOf('otro.md') + ' .lmd-node.lmd-active');
  check('un segundo archivo se suma: dos renglones, y el primero sigue ahí', J(await files(p)) === J(['mensaje-lunes-fede.md', 'otro.md']), await files(p));
  await openVia(p, 'dir', 'notas'); await h1is(p, 'Notas');
  await p.waitForSelector(dirOf('notas') + ' .lmd-node.lmd-active');
  const a2 = await tree(p);
  check('una carpeta se suma a la misma sección, desplegable y con su árbol; los archivos siguen arriba', J(a2.files.map((f) => f.name)) === J(['mensaje-lunes-fede.md', 'otro.md']) && a2.dirs.length === 1 && a2.dirs[0].name === 'notas' && a2.dirs[0].root === 'disk' && !a2.dirs[0].shut && a2.dirs[0].nodes.includes('README.md') && a2.dirs[0].nodes.includes('sub') && a2.dirs[0].x && a2.roots[0] === 'open' && !a2.roots.includes('disk') && !a2.roots.includes('recent'), a2);
  await both(p, '2-dos-archivos-y-una-carpeta');
  await openVia(p, 'dir', 'proyecto'); await h1is(p, 'Plan');
  const a3 = await until(async () => { const t = await tree(p); return t.dirs.length === 2 ? t : null; });
  check('otra carpeta también: las dos a la vez, y la anterior sigue desplegada', !!a3 && J(a3.dirs.map((d) => d.name + ':' + d.shut)) === J(['notas:false', 'proyecto:false']) && a3.files.length === 2, a3 && a3.dirs);
  check('pasar de una carpeta a otra no vuelve a armar los renglones de la primera', await p.evaluate(async () => { const n = document.querySelector('.lmd-open-dir a.lmd-node[data-url$="/b.md"]'); n.__same = true; return !!n; }) && !!(await (async () => { await p.click(dirOf('notas') + ' a.lmd-node:has-text("b.md")'); await h1is(p, 'Beta'); await sleep(300); return p.evaluate(() => document.querySelector('.lmd-open-dir a.lmd-node[data-url$="/b.md"]').__same === true); })()));
  check('el orden es fijo (archivos por nombre, después carpetas): abrir una nota no mueve los renglones', J(await files(p)) === J(['mensaje-lunes-fede.md', 'otro.md']) && J(await dirs(p)) === J(['notas', 'proyecto']));

  // ---------- Persisten ----------
  console.log('Siguen al recargar y en otra pestaña');
  await p.reload(); await h1is(p, 'Beta'); await p.waitForSelector(dirOf('notas') + ' .lmd-node.lmd-active');
  const r1 = await tree(p);
  check('recargar deja todo en la sección', J(r1.files.map((f) => f.name)) === J(['mensaje-lunes-fede.md', 'otro.md']) && J(r1.dirs.map((d) => d.name)) === J(['notas', 'proyecto']), r1);
  check('y al cargar no se pidió ningún permiso ni salió ningún selector', J(await p.evaluate(() => [window.__asks, window.__picks])) === '[[],[]]', await p.evaluate(() => [window.__asks, window.__picks]));
  const p2 = await k.ctx.newPage(); p2.on('pageerror', (e) => R.errors.push(e.message));
  await p2.goto(R.home); await p2.waitForSelector('.lmd-home [data-home=new]'); await p2.waitForSelector('.lmd-open-row');
  const t2 = await tree(p2);
  check('otra pestaña, en el inicio, muestra la misma lista', J(t2.files.map((f) => f.name)) === J(['mensaje-lunes-fede.md', 'otro.md']) && J(t2.dirs.map((d) => d.name)) === J(['notas', 'proyecto']), t2);
  await p2.click(rowOf('otro.md') + ' .lmd-node'); await h1is(p2, 'Otro archivo');
  check('y desde ahí se abre con un clic', (await st(p2)).h1 === 'Otro archivo');
  await openVia(p2, 'file', 'tercero.md'); await h1is(p2, 'Tercero');
  check('lo que se abre en una pestaña aparece en la otra sin recargar', !!(await until(async () => (await files(p)).includes('tercero.md'), 6000)), await files(p));
  await p2.close();

  // ---------- La cruz ----------
  console.log('Cerrar con la cruz y con el menú');
  const x0 = await p.evaluate((name) => { const x = window.__row(name).querySelector('.lmd-node-x'); return { op: getComputedStyle(x).opacity, title: x.title, aria: x.getAttribute('aria-label') }; }, 'tercero.md');
  await p.hover(rowOf('tercero.md')); await sleep(200);
  const x1 = await p.evaluate((name) => getComputedStyle(window.__row(name).querySelector('.lmd-node-x')).opacity, 'tercero.md');
  check('la cruz aparece al pasar el mouse, y su título dice que el archivo no se borra', x0.op === '0' && x1 === '1' && x0.title === 'Close. The file is not deleted.' && x0.aria === x0.title, [x0, x1]);
  await both(p, '3-la-cruz');
  await p.click(rowOf('tercero.md') + ' .lmd-node-x');
  await until(async () => !(await files(p)).includes('tercero.md'));
  check('la cruz saca el renglón, y la nota que estaba a la vista sigue', J(await files(p)) === J(['mensaje-lunes-fede.md', 'otro.md']) && (await st(p)).h1 === 'Beta', [await files(p), await st(p)]);
  check('sale también de lo guardado', !(await stored(p)).includes('file:tercero.md'), await stored(p));
  await p.click(dirOf('proyecto') + ' > .lmd-tree-head', { button: 'right' }); await p.waitForSelector('.lmd-menu');
  const m1 = await menu(p);
  check('el menú de una carpeta abierta trae Cerrar, además de lo de siempre', m1[m1.length - 1] === 'Close' && m1.includes('Blank note') && m1.includes('Export the folder…'), m1);
  await p.click('.lmd-menu [data-f=close]');
  await until(async () => !(await dirs(p)).includes('proyecto'));
  check('Cerrar en el menú saca la carpeta', J(await dirs(p)) === J(['notas']) && !(await stored(p)).includes('dir:proyecto'), [await dirs(p), await stored(p)]);
  await p.click(rowOf('otro.md'), { button: 'right' }); await p.waitForSelector('.lmd-menu');
  const m2 = await menu(p);
  check('y el de un archivo suelto: Abrir y Cerrar', m2[0] === 'Open' && m2[m2.length - 1] === 'Close', m2);
  await p.keyboard.press('Escape');
  check('el disco quedó igual: cerrar no borra nada', J(await disk(p)) === J(disk0), Object.keys(await disk(p)).length);

  console.log('Cerrar lo que está a la vista');
  await p.click(rowOf('otro.md') + ' .lmd-node'); await h1is(p, 'Otro archivo');
  await p.click(rowOf('otro.md') + ' .lmd-node-x');
  const c1 = await atHome(p);
  check('cerrar el archivo que está a la vista vuelve al inicio', !!c1 && J(await files(p)) === J(['mensaje-lunes-fede.md']), [c1, await files(p)]);
  await p.goBack(); await sleep(700);
  const c2 = await st(p);
  check('atrás no lo revive: dice que ese acceso ya no está, sin pedir nada', c2.home && J(await p.evaluate(() => window.__picks)) === '[]', c2);
  await p.goto(R.home); await p.waitForSelector(rowOf('mensaje-lunes-fede.md'));
  // Con cambios que no se pueden guardar, pregunta antes de cerrar, como al salir de cualquier nota.
  await p.click(rowOf('mensaje-lunes-fede.md') + ' .lmd-node'); await h1is(p, 'Mensaje del lunes');
  await p.click('[data-act=mode-edit]'); await p.waitForSelector('.lmd-article .lmd-editable');
  await p.evaluate(() => { window.__nowrite = true; });
  await p.locator('.lmd-article .lmd-editable', { hasText: 'Texto del archivo suelto' }).first().click(); await p.keyboard.press('Control+End'); await p.keyboard.type(' Sin guardar.', { delay: 10 });
  await p.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }); await sleep(300);
  await p.click(rowOf('mensaje-lunes-fede.md') + ' .lmd-node-x');
  const d1 = await until(async () => { const s = await st(p); return /Unsaved changes/.test(s.dlg) ? s : null; }, 6000);
  check('con cambios sin guardar, cerrar pregunta primero', !!d1, await st(p));
  await p.click('.lmd-dlg-card [data-dlg=no]'); await sleep(300);
  check('si se cancela, el archivo sigue abierto y en la lista', (await st(p)).h1 === 'Mensaje del lunes' && (await files(p)).includes('mensaje-lunes-fede.md'), await st(p));
  await p.click(rowOf('mensaje-lunes-fede.md') + ' .lmd-node-x'); await p.waitForSelector('.lmd-dlg-card'); await p.click('.lmd-dlg-card [data-dlg=ok]');
  check('y si se confirma, se cierra y se vuelve al inicio', !!(await atHome(p)) && J(await files(p)) === '[]', [await st(p), await files(p)]);
  await p.evaluate(() => { window.__nowrite = false; });
  check('el archivo del disco sigue como estaba', (await disk(p))['mensaje-lunes-fede.md'] === FILES['mensaje-lunes-fede.md']);
  // Cerrar la carpeta de la nota a la vista.
  await p.click(dirOf('notas') + ' a.lmd-node:has-text("b.md")'); await h1is(p, 'Beta');
  await p.click(dirOf('notas') + ' > .lmd-tree-head .lmd-node-x');
  const c3 = await atHome(p);
  check('cerrar la carpeta de la nota a la vista también vuelve al inicio, y la sección desaparece si no queda nada', !!c3 && !(await tree(p)).roots.includes('open') && J(await stored(p)) === '[]', [await tree(p), await stored(p)]);
  check('y el disco sigue igual', J(await disk(p)) === J(disk0));

  // ---------- El permiso ----------
  console.log('Un permiso que hay que volver a pedir');
  await next(p, 'otro.md'); await p.click('[data-home=file]'); await h1is(p, 'Otro archivo');
  await openVia(p, 'file', 'mensaje-lunes-fede.md'); await h1is(p, 'Mensaje del lunes');
  await openVia(p, 'dir', 'notas'); await h1is(p, 'Notas');
  await openVia(p, 'dir', 'proyecto'); await h1is(p, 'Plan');
  await p.evaluate(() => localStorage.setItem('__perm', JSON.stringify({ 'otro.md': 'prompt', notas: 'prompt' })));
  await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]'); await p.waitForSelector(rowOf('otro.md'));
  await sleep(500);
  const q0 = await tree(p);
  const lockedFile = q0.files.find((f) => f.name === 'otro.md'); const okFile = q0.files.find((f) => f.name === 'mensaje-lunes-fede.md'); const lockedDir = q0.dirs.find((d) => d.name === 'notas');
  check('lo que quedó sin permiso figura igual, atenuado y con su indicador', !!lockedFile && lockedFile.locked && lockedFile.sub === 'Allow' && /permission is missing/.test(lockedFile.title) && !!okFile && !okFile.locked && !okFile.sub, q0.files);
  check('una carpeta sin permiso también, plegada', !!lockedDir && lockedDir.locked && lockedDir.sub === 'Allow' && lockedDir.shut && lockedDir.x, q0.dirs);
  check('al cargar la página no se pidió nada: ni permiso ni selector', J(await p.evaluate(() => [window.__asks, window.__picks])) === '[[],[]]', await p.evaluate(() => [window.__asks, window.__picks]));
  const op = await p.evaluate((name) => getComputedStyle(window.__row(name).querySelector('.lmd-node-name')).opacity, 'otro.md');
  check('atenuado de verdad', Number(op) < 0.8, op);
  await both(p, '4-sin-permiso');
  await p.evaluate(() => { window.__answer = 'denied'; });
  await p.click(rowOf('otro.md') + ' .lmd-node'); await sleep(500);
  const q1 = await st(p);
  check('tocarlo pide el permiso con ese mismo toque; si se niega, queda en la lista y lo dice', J(await p.evaluate(() => window.__asks)) === J(['otro.md:read']) && q1.home && (await tree(p)).files.find((f) => f.name === 'otro.md').locked && /stays in the list/.test(q1.msg) && noShout(q1.msg), [await p.evaluate(() => window.__asks), q1]);
  await p.evaluate(() => { window.__answer = 'granted'; window.__asks.length = 0; });
  await p.click(rowOf('otro.md') + ' .lmd-node');
  check('si se da, se abre', !!(await h1is(p, 'Otro archivo')) && J(await p.evaluate(() => window.__asks)) === J(['otro.md:read']) && !(await tree(p)).files.find((f) => f.name === 'otro.md').locked, [await st(p), await p.evaluate(() => window.__asks)]);
  await p.click(dirOf('notas') + ' .lmd-root-tog');
  const q2 = await until(async () => { const d = (await tree(p)).dirs.find((x) => x.name === 'notas'); return d && !d.locked && !d.shut && d.nodes.includes('README.md') ? d : null; });
  check('la carpeta, igual: un toque pide el permiso y la despliega', !!q2 && (await p.evaluate(() => window.__asks)).includes('notas:read'), [q2, await p.evaluate(() => window.__asks)]);
  await p.evaluate(() => localStorage.setItem('__perm', JSON.stringify({ 'mensaje-lunes-fede.md': 'prompt' })));
  await p.goto(R.home); await p.waitForSelector(rowOf('mensaje-lunes-fede.md') + ' .lmd-node-locked');
  await p.click(rowOf('mensaje-lunes-fede.md') + ' .lmd-node-x');
  await until(async () => !(await files(p)).includes('mensaje-lunes-fede.md'));
  check('uno sin permiso se puede cerrar sin que se pida nada', !(await files(p)).includes('mensaje-lunes-fede.md') && J(await p.evaluate(() => window.__asks)) === '[]', [await files(p), await p.evaluate(() => window.__asks)]);
  await p.evaluate(() => localStorage.removeItem('__perm'));

  // ---------- Lo que ya estaba guardado de antes ----------
  console.log('Lo guardado por una versión anterior ("Recientes")');
  await p.evaluate(async () => { const h = await (await navigator.storage.getDirectory()).getFileHandle('tercero.md'); await LMD.store.handlesPut({ key: 'root:viejo1', root: true, id: 'viejo1', kind: 'file', name: 'tercero.md', handle: h, at: 5, last: 'viejo1/tercero.md' }); });
  await p.goto(R.home); await p.waitForSelector(rowOf('tercero.md'));
  await p.click(rowOf('tercero.md') + ' .lmd-node');
  check('aparece en "Abiertos" sin perderse, y abre', !!(await h1is(p, 'Tercero')), await st(p));

  // ---------- Navegación ----------
  console.log('Atrás y adelante');
  await p.goto(R.home); await p.waitForSelector(rowOf('tercero.md')); await atHome(p);
  await p.evaluate(() => LMD.store.notePut('del-navegador.md', '# Del navegador\n\nUna nota.\n')); await p.reload(); await p.waitForSelector('.lmd-xroot[data-root=local] a.lmd-node'); await atHome(p);
  await p.click(rowOf('tercero.md') + ' .lmd-node'); await h1is(p, 'Tercero');
  // La carpeta que no es la última que se usó espera plegada: el triángulo la despliega, sin abrir nada.
  const lazy = await tree(p);
  check('la carpeta que no es la última usada espera plegada, y la otra, desplegada', J(lazy.dirs.map((d) => d.name + ':' + d.shut)) === J(['notas:true', 'proyecto:false']), lazy.dirs);
  await p.click(dirOf('notas') + ' .lmd-root-tog .lmd-node-chev'); await p.waitForSelector(dirOf('notas') + ' a.lmd-node:has-text("b.md")');
  check('el triángulo la despliega en el lugar, sin cambiar de nota', (await st(p)).h1 === 'Tercero' && !(await tree(p)).dirs[0].shut, await st(p));
  await p.click(dirOf('notas') + ' a.lmd-node:has-text("b.md")'); await h1is(p, 'Beta');
  await p.click(dirOf('notas') + ' .lmd-root-tog .lmd-tree-path'); await until(async () => (await st(p)).dir);
  const fdir = (await st(p)).f;
  await p.click('.lmd-xroot[data-root=local] a.lmd-node'); await h1is(p, 'Del navegador');
  const hops = [];
  await p.goBack(); hops.push(!!(await until(async () => { const s = await st(p); return s.dir && s.f === fdir; })));
  await p.goBack(); hops.push(!!(await h1is(p, 'Beta')));
  await p.goBack(); hops.push(!!(await h1is(p, 'Tercero')));
  await p.goBack(); hops.push(!!(await atHome(p)));
  await p.goForward(); hops.push(!!(await h1is(p, 'Tercero')));
  await p.goForward(); hops.push(!!(await h1is(p, 'Beta')));
  await p.goForward(); hops.push(!!(await until(async () => { const s = await st(p); return s.dir && s.f === fdir; })));
  await p.goForward(); hops.push(!!(await h1is(p, 'Del navegador')));
  check('atrás y adelante recorren el inicio, un archivo suelto, una nota de la carpeta, la página de la carpeta y una nota del navegador', hops.every(Boolean), hops);
  check('y el explorador marca lo que quedó a la vista', (await tree(p)).active.includes('del-navegador.md') || (await tree(p)).active.includes('Del navegador'), (await tree(p)).active);

  console.log('Sin parpadeo: lo dibujado no se arma de nuevo');
  await p.click(dirOf('notas') + ' a.lmd-node:has-text("b.md")'); await h1is(p, 'Beta'); await sleep(400);
  await p.evaluate(() => { document.querySelectorAll('.lmd-tree-box .lmd-node').forEach((n) => { n.__old = true; }); window.__made = 0; new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) [n].concat([...n.querySelectorAll('.lmd-node')]).forEach((x) => { if (x.classList.contains('lmd-node') && !x.__old) { x.__old = true; window.__made++; } }); }).observe(document.querySelector('.lmd-tree-box'), { childList: true, subtree: true }); });
  for (const [sel, title] of [[rowOf('tercero.md') + ' .lmd-node', 'Tercero'], ['.lmd-xroot[data-root=local] a.lmd-node', 'Del navegador'], [dirOf('notas') + ' a.lmd-node:has-text("n07.md")', 'Nota 7'], [rowOf('tercero.md') + ' .lmd-node', 'Tercero'], [dirOf('notas') + ' a.lmd-node:has-text("n12.md")', 'Nota 12']]) { await p.click(sel); await h1is(p, title); await sleep(250); }
  check('pasar entre un archivo suelto, una nota del navegador y notas de la carpeta no crea ni un renglón nuevo', (await p.evaluate(() => window.__made)) === 0, await p.evaluate(() => window.__made));
  await p.click(dirOf('notas') + ' a.lmd-node:has-text("README.md")'); await h1is(p, 'Notas'); await p.click('[data-act=mode-read]'); await sleep(300); // leyendo, un clic sigue el enlace
  const made0 = await p.evaluate(() => window.__made);
  await p.click('.lmd-article a:has-text("el fondo")'); await h1is(p, 'Fondo');
  const deepOk = await until(() => p.evaluate(() => { const a = document.querySelector('.lmd-open-dir a.lmd-node.lmd-active'); return !!a && /fondo\.md/.test(a.textContent); }), 6000);
  const made1 = await p.evaluate(() => window.__made);
  check('un enlace a una nota dentro de carpetas plegadas despliega el camino en el lugar: solo se crean los renglones de adentro', !!deepOk && made1 - made0 > 0 && made1 - made0 <= 4 && await p.evaluate(() => !!document.querySelector('.lmd-open-dir a.lmd-node[data-url$="/b.md"]').__old), [made0, made1, await st(p), await p.evaluate(() => [...document.querySelectorAll('.lmd-open-dir .lmd-node-dir')].map((n) => n.textContent + ':' + n.classList.contains('lmd-open') + ':' + !!n._open + ':' + !!n.offsetParent + ':' + n.dataset.url))]);
  await p.evaluate(() => { document.querySelector('.lmd-pane-files').scrollTop = 500; }); await sleep(150);
  const y0 = await p.evaluate(() => document.querySelector('.lmd-pane-files').scrollTop);
  await p.evaluate(() => { const pane = document.querySelector('.lmd-pane-files').getBoundingClientRect(); const a = [...document.querySelectorAll('.lmd-open-dir a.lmd-node')].find((n) => { const r = n.getBoundingClientRect(); return r.top > pane.top + 50 && r.bottom < pane.bottom - 50; }); a.click(); });
  await until(async () => /^Nota \d+$/.test((await st(p)).h1)); await sleep(300);
  check('y el explorador conserva su posición y lo desplegado', Math.abs((await p.evaluate(() => document.querySelector('.lmd-pane-files').scrollTop)) - y0) < 2 && await p.evaluate(() => !!document.querySelector('.lmd-open-dir .lmd-node-dir.lmd-open')), [y0, await p.evaluate(() => document.querySelector('.lmd-pane-files').scrollTop)]);

  console.log('El teclado');
  await p.evaluate(() => { document.querySelector('.lmd-pane-files').scrollTop = 0; });
  await p.click(dirOf('notas') + ' a.lmd-node:has-text("b.md")'); await h1is(p, 'Beta'); await p.click('.lmd-article h1');
  await p.keyboard.press('Alt+Shift+E');
  const f0 = await p.evaluate(() => { const a = document.activeElement; return a && a.classList.contains('lmd-node') ? a.textContent.trim() : ''; });
  check('Alt+Shift+E lleva el foco al explorador, a la nota abierta', f0 === 'b.md', f0);
  await p.keyboard.press('ArrowDown');
  const f1 = await p.evaluate(() => document.activeElement.textContent.trim());
  await p.keyboard.press('Enter');
  const k1 = await until(async () => { const s = await st(p); return s.h1 && s.h1 !== 'Beta' ? s : null; });
  check('las flechas se mueven y Enter abre, sin que el foco se vaya del explorador', f1 !== 'b.md' && !!k1 && await p.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('lmd-node') && !!document.activeElement.closest('.lmd-tree-box')), [f1, k1]);
  await p.keyboard.press('Home');
  const f2 = await p.evaluate(() => document.activeElement.classList.contains('lmd-root-tog') ? document.activeElement.querySelector('.lmd-tree-path').textContent : '');
  await p.keyboard.press('ArrowDown');
  const f3 = await p.evaluate(() => document.activeElement.textContent.trim());
  check('Inicio va a la cabecera de "Abiertos", y de ahí se baja al primer archivo', f2 === 'Open' && /otro\.md/.test(f3), [f2, f3]);
  await p.keyboard.press('Control+Shift+F'); await p.keyboard.press('ArrowDown');
  check('del buscador, flecha abajo entra al explorador', await p.evaluate(() => !!document.activeElement.closest('.lmd-tree-box')));

  // ---------- Tooltips, en los dos idiomas ----------
  console.log('Cada ícono dice qué hace');
  const tips = (page) => page.evaluate(() => {
    const seen = (b) => !!b.offsetParent;
    const pick = (sel) => [...document.querySelectorAll(sel)].filter(seen).map((b) => ({ id: b.dataset.act || b.className.replace(/lmd-(icon-btn|zone-btn|zone-word|tree-up|node-x|on|doc-only)\b/g, '').trim(), title: b.title, aria: b.getAttribute('aria-label') || '' }));
    return { top: pick('.lmd-topbar button'), head: pick('.lmd-zone-head .lmd-zone-btn'), roots: pick('.lmd-tree-head button:not(.lmd-root-tog)'), open: (document.querySelector('.lmd-tree-open') || {}).title, add: (document.querySelector('.lmd-tree-add') || {}).title, words: [...document.querySelectorAll('.lmd-zone-word')].map((b) => b.textContent.trim() + ':' + (b.querySelector('span').offsetParent ? 'v' : 'h')) };
  });
  const en = await tips(p);
  const bare = (t) => t.top.concat(t.head, t.roots).filter((b) => !b.title || !b.aria || !noShout(b.title));
  check('en inglés: cada ícono de la barra de arriba, de la cabecera de Archivos y de cada raíz tiene title y aria-label', en.top.length >= 10 && en.head.length >= 4 && en.roots.length >= 3 && !bare(en).length, bare(en));
  check('crear y abrir llevan su palabra al lado, y el tooltip dice qué abre', J(en.words) === J(['New:v', 'Open:v']) && en.open === 'Open a file or a folder from your disk' && en.add === 'Create a note or a folder', [en.words, en.open, en.add]);
  await p.evaluate(() => LMD.patch({ language: 'es' })); await p.waitForFunction(() => document.querySelector('.lmd-tree-open') && /Abrir/.test(document.querySelector('.lmd-tree-open').title), null, { timeout: 10000 });
  await until(async () => (await st(p)).h1); await p.waitForSelector('.lmd-open-row'); await sleep(400);
  const es = await tips(p);
  check('en español también, todos', es.top.length === en.top.length && !bare(es).length && es.open === 'Abrir un archivo o una carpeta del disco' && es.add === 'Crear una nota o una carpeta' && J(es.words) === J(['Nueva:v', 'Abrir:v']), [bare(es), es.open, es.add, es.words]);
  const esTree = await tree(p);
  const esX = await p.evaluate(() => [...document.querySelectorAll('.lmd-open-list .lmd-node-x')].map((x) => x.title));
  check('la sección se llama Abiertos y la cruz dice "Cerrar. El archivo no se borra."', esTree.openName === 'Abiertos' && esX.includes('Cerrar. El archivo no se borra.') && esX.includes('Cerrar. La carpeta no se borra.') && esX.every(noShout), [esTree.openName, esX]);
  await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]');
  const esHome = await p.evaluate(() => [...document.querySelectorAll('.lmd-home-actions > *')].map((b) => b.textContent.trim() + '|' + (b.title || '')));
  check('el inicio en español, con sus tooltips y sin signos de admiración', J(esHome.map((s) => s.split('|')[0])) === J(['Nueva nota', 'Desde una plantilla', 'O abrí algo de tu disco', 'Abrir archivo', 'Abrir carpeta']) && esHome.filter((s) => !/^O abrí/.test(s)).every((s) => s.split('|')[1].length > 10) && esHome.every(noShout), esHome);
  await p.evaluate(() => LMD.patch({ language: 'en' })); await p.waitForFunction(() => document.querySelector('.lmd-tree-open') && /Open/.test(document.querySelector('.lmd-tree-open').title), null, { timeout: 10000 });

  // ---------- Teléfono ----------
  console.log('Teléfono (390 px)');
  const m = await persistent({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); const mp = m.page;
  await mp.goto(R.home); await mp.waitForSelector('.lmd-home [data-home=new]');
  await seed(mp);
  const mh = await mp.evaluate(() => ({ wide: document.documentElement.scrollWidth > window.innerWidth + 1, rows: [...document.querySelectorAll('.lmd-home-actions > *')].map((b) => { const r = b.getBoundingClientRect(); return Math.round(r.left) + ':' + Math.round(r.width) + ':' + Math.round(r.height); }), label: document.querySelector('.lmd-home-label').getBoundingClientRect().width > 250 }));
  check('el inicio entra en 390 px: sin desborde, con el rótulo a lo ancho y botones de 44 px o más', !mh.wide && mh.label && mh.rows.filter((r) => Number(r.split(':')[2]) >= 44).length >= 4, mh);
  await shot(mp, '5-telefono-inicio-oscuro');
  await next(mp, 'mensaje-lunes-fede.md'); await mp.tap('[data-home=file]'); await h1is(mp, 'Mensaje del lunes');
  await mp.tap('[data-act=sidebar]'); await mp.waitForSelector('html.lmd-side-open');
  await next(mp, 'notas'); await mp.tap('.lmd-zone-head .lmd-tree-open'); await mp.tap('.lmd-menu [data-f=dir]'); await h1is(mp, 'Notas');
  await mp.tap('[data-act=sidebar]'); await mp.waitForSelector('html.lmd-side-open'); await mp.waitForSelector(rowOf('mensaje-lunes-fede.md')); await sleep(400);
  const mt = await tree(mp);
  const mx = await mp.evaluate((name) => { const x = window.__row(name).querySelector('.lmd-node-x'); const r = x.getBoundingClientRect(); const side = document.querySelector('.lmd-sidebar').getBoundingClientRect(); return { op: getComputedStyle(x).opacity, w: Math.round(r.width), h: Math.round(r.height), inside: r.right <= side.right + 1, words: [...document.querySelectorAll('.lmd-zone-word span')].map((s) => !!s.offsetParent), coarse: matchMedia('(hover: none)').matches }; }, 'mensaje-lunes-fede.md');
  check('en el teléfono la sección es la misma: el archivo como renglón y la carpeta desplegable', J(mt.files.map((f) => f.name)) === J(['mensaje-lunes-fede.md']) && J(mt.dirs.map((d) => d.name)) === J(['notas']) && !mt.wide, mt);
  check('la cruz está siempre a la vista con el dedo, con 40 px de lado, y los botones de la cabecera quedan en íconos', mx.coarse && mx.op === '1' && mx.w >= 40 && mx.h >= 40 && mx.inside && mx.words.every((v) => !v), mx);
  await both(mp, '5-telefono');
  await mp.tap(rowOf('mensaje-lunes-fede.md') + ' .lmd-node'); await h1is(mp, 'Mensaje del lunes');
  check('tocar el renglón abre el archivo y cierra el cajón', await mp.evaluate(() => !document.documentElement.classList.contains('lmd-side-open')));
  await mp.tap('[data-act=sidebar]'); await mp.waitForSelector('html.lmd-side-open'); await mp.tap(rowOf('mensaje-lunes-fede.md') + ' .lmd-node-x');
  check('y la cruz lo cierra y vuelve al inicio', !!(await atHome(mp)) && J(await files(mp)) === '[]', [await st(mp), await files(mp)]);

  // ---------- Sin acceso a archivos del disco ----------
  console.log('Sin acceso al disco (Firefox, Safari): copias de la pestaña');
  const w = await R.open(null); const wp = w.page;
  await w.ctx.addInitScript(() => { delete window.showOpenFilePicker; delete window.showDirectoryPicker; window.showOpenFilePicker = undefined; window.showDirectoryPicker = undefined; });
  await wp.goto(R.home); await wp.waitForSelector('.lmd-home [data-home=new]');
  const wHome = await wp.evaluate(() => ({ dir: !!document.querySelector('[data-home=dir]'), tip: document.querySelector('[data-home=file]').title }));
  check('sin acceso al disco no se ofrece abrir carpeta, y el botón dice que abre una copia', !wHome.dir && wHome.tip === 'Open a copy of a file from your disk', wHome);
  const pickFile = async (sel, name, text) => { const [fc] = await Promise.all([wp.waitForEvent('filechooser'), wp.click(sel)]); await fc.setFiles({ name, mimeType: 'text/markdown', buffer: Buffer.from(text) }); };
  await pickFile('[data-home=file]', 'copia-uno.md', '# Copia uno\n\nPrimera.\n'); await h1is(wp, 'Copia uno');
  await wp.waitForSelector(rowOf('copia-uno.md'));
  const w1 = await tree(wp);
  check('el archivo queda en "Abiertos" como renglón, marcado como copia, y la sección dice cuánto dura', w1.files.length === 1 && w1.files[0].sub === 'Copy' && /copies/.test(w1.note) && /while this tab stays open/.test(w1.note) && /this tab stays open/.test(w1.files[0].title), w1);
  await pickFile('.lmd-zone-head .lmd-tree-open', 'copia-dos.md', '# Copia dos\n\nSegunda.\n'); await h1is(wp, 'Copia dos');
  await until(async () => (await files(wp)).length === 2);
  check('abrir otro lo suma, y el primero sigue ahí', J(await files(wp)) === J(['copia-dos.md', 'copia-uno.md']), await files(wp));
  await wp.click(rowOf('copia-uno.md') + ' .lmd-node');
  check('y se vuelve al primero con un clic', !!(await h1is(wp, 'Copia uno')) && J(await files(wp)) === J(['copia-dos.md', 'copia-uno.md']), [await st(wp), await files(wp)]);
  await wp.reload(); await h1is(wp, 'Copia uno'); await wp.waitForSelector(rowOf('copia-uno.md'));
  check('recargar la pestaña las conserva (viven en la sesión)', J(await files(wp)) === J(['copia-dos.md', 'copia-uno.md']), await files(wp));
  await shot(wp, '6-copias-sin-acceso-al-disco-oscuro');
  await wp.click(rowOf('copia-dos.md') + ' .lmd-node-x'); await until(async () => (await files(wp)).length === 1);
  await wp.click(rowOf('copia-uno.md') + ' .lmd-node-x');
  check('se cierran con la cruz; la que está a la vista vuelve al inicio', !!(await atHome(wp)) && !(await tree(wp)).roots.includes('open') && (await wp.evaluate(() => sessionStorage.getItem('mdt-mem') + '|' + sessionStorage.getItem('lmd-mem-more'))) === 'null|null', [await st(wp), await wp.evaluate(() => sessionStorage.getItem('mdt-mem') + '|' + sessionStorage.getItem('lmd-mem-more'))]);
  const w2 = await w.ctx.newPage(); await w2.goto(R.home); await w2.waitForSelector('.lmd-home [data-home=new]'); await w2.waitForSelector('.lmd-xroot[data-root=local]');
  check('en otra pestaña no figuran: no se promete lo que no hay', !(await tree(w2)).roots.includes('open'));

  check('nada apuntó a la nube de verdad', !R.outside.length, R.outside.slice(0, 3));
  check('sin errores de JavaScript', !R.errors.length, R.errors.slice(0, 3));
  bad = done();
} catch (e) {
  console.log('\nLa prueba se cortó: ' + (e && e.stack || e));
  done();
} finally {
  for (const pr of profiles) { try { await pr.ctx.close(); } catch (e) { /* ya estaba cerrado */ } try { fs.rmSync(pr.dir, { recursive: true, force: true }); } catch (e) { /* Windows suelta el perfil después */ } }
  await R.close();
}
process.exit(bad ? 1 : 0);
