// Citas y ecuaciones numeradas: [@clave] con un .bib junto a la nota, la lista de Referencias, una clave desconocida
// marcada, un bloque bibtex dentro de la nota, ecuaciones con número y su referencia, y las macros de la cabecera.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdcite-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
const home = `chrome-extension://${id}/src/app.html`;
const B = String.fromCharCode(92);
const BIB = '@article{perez2020, author = {P{' + B + "'e}rez, Juan and Gomez, Maria}, title = {Un titulo}, journal = {Revista}, year = {2020}, volume = {3}, pages = {1--10}}\n" +
  '@book{smith99, author = {Smith, John}, title = {The Book}, publisher = {Press}, year = {1999}}\n';
const DOC = '---\ntitle: Estudio\nbibliography: refs.bib\nmacros:\n  ' + B + 'RR: "' + B + 'mathbb{R}"\n---\n\n# Estudio\n\nLo dice [@perez2020, p. 12] y tambien [@smith99; @perez2020].\n\nUna clave rota [@nadie].\n\nVer @eq:uno y ' + B + 'eqref{dos}, tambien @eq:fantasma.\n\n$$\nx ' + B + 'in ' + B + 'RR\n$$ {#eq:uno}\n\n$$\na^2 + b^2 = c^2\n$$ {#eq:dos}\n\nFin.\n';
const DOC2 = '# Con bloque\n\nCita [@k1].\n\n```bibtex\n@misc{k1, author = {Gil, Ana}, title = {Algo}, year = {2021}, url = {https://example.com/x}}\n```\n';
const checks = []; const J = (v) => JSON.stringify(v);
const add = (name, ok, detail) => checks.push([name, !!ok, detail]);
const write = (dir, name, text) => app.evaluate(async ([d, n, t]) => {
  const h = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(d, { create: true })).getFileHandle(n, { create: true });
  const s = await h.createWritable(); await s.write(t); await s.close();
}, [dir, name, text]);
const boot = async (dirName, files, open) => {
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate((s) => new Promise((resolve) => chrome.storage.local.set({ settings: s }, resolve)), { theme: 'dark', cloudUrl: 'off', updateCheck: 'off', language: 'en' });
  await app.goto(home); await app.waitForSelector('.lmd-home');
  for (const [n, t] of files) await write(dirName, n, t);
  await app.evaluate(async (d) => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(d, { create: true }); window.showDirectoryPicker = async () => dir; }, dirName);
  await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.lmd-article, .markdown-body');
  if (open) { await app.click('text=' + open); }
  await app.waitForSelector('.markdown-body h1');
};

try {
  await boot('cite1', [['refs.bib', BIB], ['doc.md', DOC]], null);
  await app.waitForSelector('.lmd-cite:not(.lmd-cite-bad)'); await app.waitForSelector('.lmd-bib-item');
  const r = await app.evaluate(() => ({
    cites: [...document.querySelectorAll('.lmd-cite')].map((c) => [c.textContent, c.classList.contains('lmd-cite-bad'), c.title]),
    refs: [...document.querySelectorAll('.lmd-bib-item')].map((p) => p.textContent),
    head: (document.querySelector('.lmd-bib-title') || {}).textContent,
    bibLast: document.querySelector('.lmd-article').lastElementChild.classList.contains('lmd-bib'),
  }));
  add('una cita muestra autor, año y lugar en la fuente', r.cites[0] && r.cites[0][0] === '(Pérez y Gomez, 2020, p. 12)' || (r.cites[0] && /Pérez (&|y) Gomez, 2020, p\. 12/.test(r.cites[0][0])), r.cites[0]);
  add('varias claves en una cita van separadas por punto y coma', r.cites[1] && /Smith, 1999; .*2020/.test(r.cites[1][0]), r.cites[1]);
  add('una clave desconocida queda marcada y con aviso', r.cites[2] && r.cites[2][1] && /Unknown key: nadie/.test(r.cites[2][2]) && r.cites[2][0] === '[@nadie]', r.cites[2]);
  add('al final aparece Referencias con solo lo citado, ordenado por autor', r.head === 'References' && r.refs.length === 2 && /^Pérez/.test(r.refs[0]) && /^Smith/.test(r.refs[1]) && r.bibLast, r);
  const eq = await app.evaluate(() => ({
    n: [...document.querySelectorAll('.lmd-math-block[data-n]')].map((n) => [n.dataset.eq, n.dataset.n, !!n.querySelector('.katex'), (n.textContent.match(/\(\d\)/) || [''])[0]]),
    refs: [...document.querySelectorAll('.lmd-eqref')].map((a) => [a.textContent, a.getAttribute('href'), a.classList.contains('lmd-eqref-bad')]),
  }));
  add('las ecuaciones con etiqueta se numeran en orden y se dibujan', J(eq.n.map((x) => x.slice(0, 3))) === J([['uno', '1', true], ['dos', '2', true]]) && eq.n.every((x) => x[3]), eq.n);
  add('@eq: y \\eqref llevan el número, y una etiqueta sin definir sale (?)', J(eq.refs) === J([['(1)', '#eq-uno', false], ['(2)', '#eq-dos', false], ['(?)', null, true]]) || (eq.refs.length === 3 && eq.refs[0][0] === '(1)' && eq.refs[1][0] === '(2)' && eq.refs[2][0] === '(?)' && eq.refs[2][2]), eq.refs);
  const macro = await app.evaluate(() => { const b = document.querySelector('.lmd-math-block[data-eq=uno]'); return { bad: b.classList.contains('lmd-math-bad'), html: !!b.querySelector('.katex-html') && !!b.querySelector('.katex-html .mathbb') }; });
  add('la macro de la cabecera se usa en la fórmula', !macro.bad && macro.html, macro);

  await write('cite1', 'doc.md', DOC2);
  await app.reload(); await app.waitForSelector('.lmd-home').catch(() => {});
  await boot('cite1', [['doc.md', DOC2]], null);
  await app.waitForSelector('.lmd-cite:not(.lmd-cite-bad)', { timeout: 8000 }).catch(() => {});
  const b2 = await app.evaluate(() => ({ cite: (document.querySelector('.lmd-cite') || {}).textContent, ref: (document.querySelector('.lmd-bib-item') || {}).textContent, link: !!document.querySelector('.lmd-bib-item a[href^="https://example.com"]') }));
  add('un bloque bibtex dentro de la nota alcanza como bibliografía', b2.cite === '(Gil, 2021)' && /^Gil, A\. \(2021\)\. Algo/.test(b2.ref || '') && b2.link, b2);
  add('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) { add('la prueba llegó hasta el final', false, String(e && e.stack || e).slice(0, 700)); }

console.log('Citas y ecuaciones numeradas');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail).slice(0, 700))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
