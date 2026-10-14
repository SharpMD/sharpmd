// Cuánto tarda y cuánto redibuja el explorador al pasar de una nota a otra. No es una prueba: mide y muestra.
// Una carpeta del disco con 300 notas (OPFS, con el selector reemplazado), un archivo suelto y dos notas del navegador.
// De cada paso: del clic a la nota dibujada (ms), cuántas veces se rearmó el árbol entero y cuántos renglones se
// crearon de nuevo. Sirve para comparar dos versiones: con ROOT se sirve otra copia del repositorio.
// Uso: node navperf.mjs            (esta copia)
//      ROOT=C:\otra\copia node navperf.mjs
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.ROOT ? path.resolve(process.env.ROOT) : here;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(50); } };
const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : -1);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.md': 'text/markdown' };
const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]); const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
const home = 'http://127.0.0.1:' + site.address().port + '/src/app.html';
const N = 300;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-nav-'));
const ctx = await chromium.launchPersistentContext(dir, { executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', serviceWorkers: 'block' });
await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
const out = { root, steps: {} };
try {
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(home); await page.waitForSelector('.lmd-home [data-home=new]');
  await page.evaluate(async (n) => {
    const put = async (d, name, text) => { const h = await d.getFileHandle(name, { create: true }); const w = await h.createWritable(); await w.write(text); await w.close(); };
    const base = await navigator.storage.getDirectory();
    const top = await base.getDirectoryHandle('big', { create: true });
    for (let i = 1; i <= n; i++) await put(top, 'n' + String(i).padStart(3, '0') + '.md', '# Note ' + i + '\n\nBody ' + i + '. ' + (i === 5 ? 'Go [deep](sub/deep/x.md).' : '') + '\n\n' + Array.from({ length: 12 }, (_, k) => 'Paragraph ' + k + ' of note ' + i + ' with **bold** text.').join('\n\n') + '\n');
    const sub = await top.getDirectoryHandle('sub', { create: true }); for (let i = 1; i <= 5; i++) await put(sub, 's' + i + '.md', '# Sub ' + i + '\n');
    const deep = await sub.getDirectoryHandle('deep', { create: true }); await put(deep, 'x.md', '# Deep X\n\nDown here.\n');
    await put(base, 'suelto.md', '# Suelto\n\nA loose file.\n');
    const loose = await base.getFileHandle('suelto.md');
    window.showDirectoryPicker = async () => top; window.showOpenFilePicker = async () => [loose];
    await LMD.store.notePut('uno.md', '# Uno\n\nBrowser note.\n'); await LMD.store.notePut('dos.md', '# Dos\n\nBrowser note.\n');
  }, N);
  const h1 = () => page.evaluate(() => { const h = document.querySelector('.lmd-article h1'); return h ? h.textContent.trim() : ''; });
  await page.click('[data-home=dir]'); await until(async () => /^Note \d+$/.test(await h1()), 15000);
  await page.waitForSelector('.lmd-tree-box a.lmd-node'); await sleep(1500); // los números de cada carpeta terminan de contarse
  // El archivo suelto se abre una vez, para que quede en el explorador.
  await page.click('.lmd-tree-open'); await page.click('.lmd-menu [data-f=file]'); await until(async () => (await h1()) === 'Suelto', 8000); await sleep(600);

  // El contador: cada vez que el árbol se rearma entero (entran secciones nuevas) y cada renglón que se crea de nuevo.
  await page.evaluate(() => {
    const box = document.querySelector('.lmd-tree-box'); const st = window.__nav = { rebuilds: 0, rows: 0, shift: 0 };
    const seen = new WeakSet(); box.querySelectorAll('.lmd-node').forEach((n) => seen.add(n));
    new MutationObserver((list) => {
      let rebuilt = false;
      for (const m of list) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (m.target === box && n.classList.contains('lmd-xroot')) rebuilt = true;
        const rows = (n.classList.contains('lmd-node') ? [n] : []).concat(Array.from(n.querySelectorAll('.lmd-node')));
        rows.forEach((r) => { if (!seen.has(r)) { seen.add(r); st.rows++; } });
      }
      if (rebuilt) st.rebuilds++;
    }).observe(box, { childList: true, subtree: true });
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) st.shift += e.value; }).observe({ type: 'layout-shift', buffered: false }); } catch (e) { /* sin esa medida */ }
  });
  const stat = () => page.evaluate(() => Object.assign({}, window.__nav, { nodes: document.querySelectorAll('.lmd-tree-box .lmd-node').length, top: document.querySelector('.lmd-pane-files').scrollTop }));
  // Clic en el primer renglón a la vista con uno de esos nombres; espera el título pedido. Devuelve los ms, o -1.
  const go = (names, want) => page.evaluate(([list, expect]) => new Promise((resolve) => {
    let hit = null;
    for (const name of list) { hit = Array.from(document.querySelectorAll('.lmd-tree-box a.lmd-node')).find((a) => a.offsetParent && (a.querySelector('.lmd-node-name') || a).textContent.trim() === name); if (hit) break; }
    if (!hit) { resolve(-2); return; }
    const t0 = performance.now(); hit.click();
    const tick = () => { const h = document.querySelector('.lmd-article h1'); const homeUp = document.querySelector('.lmd-home'); if (h && h.textContent.trim() === expect && (!homeUp || homeUp.hidden)) requestAnimationFrame(() => resolve(performance.now() - t0)); else if (performance.now() - t0 > 8000) resolve(-1); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), [names, want]);
  const run = async (label, steps) => {
    const a = await stat(); const times = [];
    for (const [names, want] of steps) { times.push(Math.round(await go(names, want))); await sleep(350); }
    await sleep(500);
    const b = await stat();
    out.steps[label] = { n: steps.length, ms_median: median(times.filter((t) => t >= 0)), ms_max: Math.max(...times), failed: times.filter((t) => t < 0).length, rebuilds: b.rebuilds - a.rebuilds, rows_created: b.rows - a.rows, layout_shift: +(b.shift - a.shift).toFixed(4), rows_in_tree: b.nodes, times: process.env.DEBUG ? times : undefined };
    console.log(label + '  ' + JSON.stringify(out.steps[label]));
  };

  // De vuelta a la carpeta (en la versión vieja, por Recientes; en la nueva, el árbol sigue ahí).
  await page.evaluate(() => { const pick = (name) => Array.from(document.querySelectorAll('.lmd-tree-box a.lmd-node')).find((a) => a.offsetParent && (a.querySelector('.lmd-node-name') || a).textContent.trim() === name); (pick('n005.md') || pick('big')).click(); });
  await until(async () => /^Note \d+$/.test(await h1()), 8000); await sleep(800);
  await go(['n005.md'], 'Note 5'); await sleep(500);

  // A. Veinte clics entre notas a la vista de la carpeta de 300.
  const seq = []; for (let i = 0; i < 20; i++) { const k = 2 + ((i * 7) % 18); seq.push([['n' + String(k).padStart(3, '0') + '.md'], 'Note ' + k]); }
  await run('A: 20 notas de la carpeta de 300', seq);
  // B. Con el explorador desplazado: se conserva la posición.
  await page.evaluate(() => { document.querySelector('.lmd-pane-files').scrollTop = 2400; }); await sleep(200);
  const y0 = (await stat()).top;
  const mid = await page.evaluate(() => { const pane = document.querySelector('.lmd-pane-files').getBoundingClientRect(); const a = Array.from(document.querySelectorAll('.lmd-tree-box a.lmd-node')).find((n) => { const r = n.getBoundingClientRect(); return r.top > pane.top + 60 && r.bottom < pane.bottom - 60 && /^n\d+\.md$/.test(n.textContent.trim()); }); return a ? a.textContent.trim() : ''; });
  if (mid) { await go([mid], 'Note ' + Number(mid.slice(1, 4))); await sleep(500); }
  const y1 = (await stat()).top; out.scroll = { before: y0, after: y1, kept: Math.abs(y1 - y0) < 2, note: mid }; console.log('B: scroll del explorador  ' + JSON.stringify(out.scroll));
  await page.evaluate(() => { document.querySelector('.lmd-pane-files').scrollTop = 0; }); await go(['n005.md'], 'Note 5'); await sleep(500);
  // C. Entre raíces: nota de la carpeta, archivo suelto, nota del navegador, y de vuelta. Cinco vueltas.
  const round = []; for (let i = 0; i < 5; i++) round.push([['suelto.md'], 'Suelto'], [['uno.md'], 'Uno'], [['dos.md'], 'Dos'], [['n005.md', 'big'], 'Note 5']);
  await run('C: 5 vueltas carpeta, archivo suelto, navegador', round);
  // D. Un enlace a una nota dentro de una carpeta plegada.
  const a = await stat();
  const t = await page.evaluate(() => new Promise((resolve) => { const link = Array.from(document.querySelectorAll('.lmd-article a')).find((x) => x.textContent === 'deep'); if (!link) { resolve(-2); return; } const t0 = performance.now(); link.click(); const tick = () => { const h = document.querySelector('.lmd-article h1'); if (h && h.textContent.trim() === 'Deep X') requestAnimationFrame(() => resolve(performance.now() - t0)); else if (performance.now() - t0 > 8000) resolve(-1); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
  await until(() => page.evaluate(() => !!document.querySelector('.lmd-tree-box .lmd-node.lmd-active') && /x\.md/.test(document.querySelector('.lmd-tree-box .lmd-node.lmd-active').textContent)), 5000); await sleep(500);
  const b = await stat();
  out.steps['D: enlace a una nota en una carpeta plegada'] = { ms: Math.round(t), rebuilds: b.rebuilds - a.rebuilds, rows_created: b.rows - a.rows, marked: await page.evaluate(() => { const n = document.querySelector('.lmd-tree-box .lmd-node.lmd-active'); return n ? n.textContent.trim() : ''; }) };
  console.log('D: enlace a carpeta plegada  ' + JSON.stringify(out.steps['D: enlace a una nota en una carpeta plegada']));
  out.errors = errors;
  if (errors.length) console.log('errores de página: ' + JSON.stringify(errors.slice(0, 5)));
} finally {
  await ctx.close(); site.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows suelta el perfil después */ }
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
