// SharpMD en el panel lateral del navegador: la cabecera propia, el menú de archivos como en el teléfono, la nota
// nueva, lo que llega del clic derecho y abrir la nota en una pestaña. El panel es src/app.html?panel=1; acá se abre
// como pestaña angosta, que es lo mismo que ve el panel.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdpanel-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 400, height: 860 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
await ctx.addInitScript(() => { try { localStorage.setItem('lmd-tour-seen', '1'); } catch (e) { /* sin almacenamiento */ } });
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
const o = {}; const J = JSON.stringify;

// el panel del navegador apunta a la app con ?panel
o.opciones = await sw.evaluate(() => chrome.sidePanel.getOptions({}).then((x) => x.path, (e) => 'error: ' + e.message));
o.permisos = await sw.evaluate(() => chrome.runtime.getManifest().permissions);

await app.goto(`chrome-extension://${id}/src/app.html?panel=1`); await app.waitForSelector('.lmd-home'); await app.waitForSelector('.lmd-panelbar');
o.cabecera = await app.evaluate(() => ({
  clase: document.documentElement.classList.contains('lmd-sidepanel'),
  botones: [...document.querySelectorAll('.lmd-panelbar [data-panel]')].map((b) => b.dataset.panel + ':' + b.title),
  arriba: document.querySelector('.lmd-main').firstElementChild.className,
  lateralOculto: getComputedStyle(document.querySelector('.lmd-topbar [data-act=sidebar]')).display === 'none',
  ancho: document.documentElement.scrollWidth <= innerWidth,
}));
// el menú de archivos se despliega encima, como en el teléfono, y se cierra tocando afuera
await app.click('.lmd-panelbar [data-panel=files]'); await app.waitForTimeout(400);
o.menu = await app.evaluate(() => ({ abierto: document.querySelector('.lmd-root, html').classList.contains('lmd-side-open') || !!document.querySelector('.lmd-side-open'), visible: getComputedStyle(document.querySelector('.lmd-sidebar')).visibility }));
await app.mouse.click(390, 400); await app.waitForTimeout(400);
o.menuCerrado = await app.evaluate(() => !document.querySelector('.lmd-side-open'));

// nota nueva desde la cabecera
await app.click('.lmd-panelbar [data-panel=new]'); await app.waitForFunction(() => !document.querySelector('.lmd-nodoc') && /nota-/.test(document.querySelector('.lmd-docname').textContent), null, { timeout: 8000 });
o.nueva = await app.evaluate(() => ({ nombre: document.querySelector('.lmd-docname').textContent, url: location.search, cabecera: !!document.querySelector('.lmd-panelbar') }));

// lo que manda el clic derecho se agrega al final de la nota abierta, una sola vez
await app.evaluate(() => { const ed = document.querySelector('.lmd-article [contenteditable=true]'); if (ed) ed.blur(); });
await sw.evaluate(() => chrome.storage.local.set({ panelClip: { title: 'Ejemplo [uno]', url: 'https://example.com/a', text: 'Primera línea\nsegunda', at: Date.now() } }));
await app.waitForFunction(() => /example\.com/.test(LMD.panel && document.querySelector('.lmd-article').textContent + '') || /example\.com/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => {});
await app.waitForTimeout(800);
o.recorte = await app.evaluate(() => ({ link: document.querySelector('.lmd-article a[href="https://example.com/a"]')?.textContent || '', cita: document.querySelector('.lmd-article blockquote')?.textContent.trim() || '' }));
o.recorteBorrado = await sw.evaluate(() => chrome.storage.local.get('panelClip').then((x) => !x.panelClip));
o.formato = await app.evaluate(() => [LMD.panel.clipText({ title: 'Hola', url: 'https://a.com/x y' }), LMD.panel.clipText({ title: '', url: 'chrome://extensions/', text: '' }), LMD.panel.clipText({ title: 'T', url: 'https://a.com', text: ' uno \r\n dos ' })]);

// recargar el panel con otra nota abierta sigue siendo el panel
await app.reload(); await app.waitForSelector('.lmd-panelbar', { timeout: 8000 }).catch(() => {});
o.recarga = await app.evaluate(() => ({ panel: document.documentElement.classList.contains('lmd-sidepanel'), cabecera: !!document.querySelector('.lmd-panelbar'), url: location.search }));

// abrir en una pestaña: la misma nota, sin ?panel
await app.evaluate(() => chrome.storage.local.get('settings').then((x) => chrome.storage.local.set({ settings: Object.assign({}, x.settings, { openIn: 'ext' }) })));
const [tab] = await Promise.all([ctx.waitForEvent('page'), app.click('.lmd-panelbar [data-panel=tab]')]);
await tab.waitForLoadState('domcontentloaded');
o.pestana = { url: tab.url(), cabecera: await tab.waitForSelector('.lmd-topbar').then(() => tab.evaluate(() => !!document.querySelector('.lmd-panelbar'))) };

// la app de siempre no cambia
const plain = await ctx.newPage(); await plain.goto(`chrome-extension://${id}/src/app.html`); await plain.waitForSelector('.lmd-topbar');
o.comun = await plain.evaluate(() => ({ cabecera: !!document.querySelector('.lmd-panelbar'), clase: document.documentElement.classList.contains('lmd-sidepanel') }));

const checks = [
  ['el panel lateral del navegador abre la app con ?panel', o.opciones === 'src/app.html?panel=1', o.opciones],
  ['permisos para el panel y el clic derecho', o.permisos.includes('sidePanel') && o.permisos.includes('contextMenus'), o.permisos],
  ['arriba de todo, la cabecera: archivos, nota nueva, agregar la página y abrir en una pestaña', o.cabecera.clase && J(o.cabecera.botones.map((b) => b.split(':')[0])) === J(['files', 'new', 'clip', 'tab']) && /lmd-panelbar/.test(o.cabecera.arriba), o.cabecera],
  ['el botón de la barra lateral de la app no se repite, y no hay scroll de costado', o.cabecera.lateralOculto && o.cabecera.ancho, o.cabecera],
  ['el menú de archivos se despliega encima, como en el teléfono, y se cierra tocando afuera', o.menu.abierto && o.menu.visible === 'visible' && o.menuCerrado, [o.menu, o.menuCerrado]],
  ['nota nueva desde la cabecera, y la cabecera sigue', /^nota-/.test(o.nueva.nombre) && o.nueva.cabecera, o.nueva],
  ['lo del clic derecho se agrega a la nota abierta: el enlace y lo elegido, citado', o.recorte.link === 'Ejemplo [uno]' && /Primera línea\s*segunda/.test(o.recorte.cita), o.recorte],
  ['y se toma una sola vez', o.recorteBorrado, o.recorteBorrado],
  ['el recorte en Markdown: enlace seguro aunque tenga espacios, la dirección sola si no es web, y cada renglón citado', o.formato[0] === '[Hola](<https://a.com/x y>)' && o.formato[1] === 'chrome://extensions/' && o.formato[2] === '[T](<https://a.com>)\n\n> uno\n> dos', o.formato],
  ['al recargar sigue siendo el panel, con la nota abierta', o.recarga.panel && o.recarga.cabecera && /f=/.test(o.recarga.url), o.recarga],
  ['abrir en una pestaña lleva la misma nota a la app grande, sin la cabecera del panel', /src\/app\.html\?f=/.test(o.pestana.url) && !/panel/.test(o.pestana.url) && !o.pestana.cabecera, o.pestana],
  ['la app de siempre no lleva nada del panel', !o.comun.cabecera && !o.comun.clase, o.comun],
  ['sin errores de JavaScript', errors.length === 0, errors],
];
console.log('Panel lateral');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
