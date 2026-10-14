// Modo sin distracciones, notas fijadas y recorrido de la primera vez.
// Modo sin distracciones: el botón y Alt+Shift+Z lo prenden y lo apagan, Esc sale, esconde la barra lateral y la de
// arriba, y se puede seguir editando. Notas fijadas: se fijan y se sueltan desde el menú de la nota y desde el del
// explorador, salen arriba del explorador y en el inicio, y quedan al recargar. Recorrido: en el teléfono sale una
// vez, se puede saltear y no vuelve. Chip sin conexión: con texto corto en pantalla chica.
// Todo contra un servidor local: la nube de verdad queda apagada.
// Uso: node zen.mjs
import { rig, tally, sleep } from './rig.mjs';

const { check, done } = tally();
const R = await rig({});
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(80); } };
const noShout = (s) => !/[!¡—–]/.test(s);

// Una nota nueva del navegador, abierta.
const newNote = async (page) => {
  await page.goto(R.home); await page.waitForSelector('.lmd-home [data-home=new]', { timeout: 15000 });
  await page.click('.lmd-home [data-home=new]'); await page.waitForSelector('.lmd-article', { timeout: 15000 });
  await sleep(400);
};
const zenOn = (page) => page.evaluate(() => document.documentElement.classList.contains('lmd-zen'));
const shown = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); if (!n) return false; const r = n.getBoundingClientRect(); return getComputedStyle(n).display !== 'none' && r.width > 0 && r.height > 0; }, sel);

try {
  // ---------- Modo sin distracciones (escritorio) ----------
  const d = await R.open(null);
  const page = d.page;
  await newNote(page);
  check('arranca sin el modo prendido y con el botón a la vista', !(await zenOn(page)) && await shown(page, '.lmd-zen-btn'));
  const tip = await page.getAttribute('.lmd-zen-btn', 'title');
  check('el botón dice el atajo en su ayuda', /Alt\+Shift\+Z/.test(tip || '') && /Distraction-free/.test(tip || ''), tip);

  await page.click('.lmd-zen-btn'); await sleep(200);
  check('el botón prende el modo', await zenOn(page));
  check('esconde la barra de arriba y la lateral', !(await shown(page, '.lmd-topbar')) && !(await shown(page, '.lmd-sidebar')));
  check('el texto sigue a la vista', await shown(page, '.lmd-article'));
  check('avisa cómo salir y el aviso no tiene signos de más', await shown(page, '.lmd-zen-hint') && noShout(await page.textContent('.lmd-zen-hint')), await page.textContent('.lmd-zen-hint').catch(() => ''));
  await page.keyboard.press('Escape'); await sleep(200);
  check('Esc sale del modo y vuelven las barras', !(await zenOn(page)) && await shown(page, '.lmd-topbar'));

  await page.keyboard.press('Alt+Shift+Z'); await sleep(200);
  check('Alt+Shift+Z lo prende', await zenOn(page));
  await page.keyboard.press('Alt+Shift+Z'); await sleep(200);
  check('Alt+Shift+Z lo apaga', !(await zenOn(page)));

  // Editando: el primer Esc cierra la edición del bloque y el segundo sale del modo.
  await page.click('[data-act=mode-edit]').catch(() => {}); await sleep(300);
  const block = page.locator('.lmd-article .lmd-editable').first();
  await block.click(); await page.keyboard.type('Escribo en el modo', { delay: 10 });
  await page.keyboard.press('Alt+Shift+Z'); await sleep(200);
  check('Alt+Shift+Z prende el modo mientras se edita', await zenOn(page));
  await page.keyboard.type(' y sigo', { delay: 10 });
  check('se puede seguir escribiendo adentro del modo', /sigo/.test(await page.evaluate(() => document.activeElement.textContent || document.activeElement.value || '')));
  await page.keyboard.press('Escape'); await sleep(250);
  await page.keyboard.press('Escape'); await sleep(250);
  check('con Esc se sale del modo aun editando', !(await zenOn(page)));

  // ---------- Fijar ----------
  await page.click('[data-act=more]'); await page.waitForSelector('.lmd-menu', { timeout: 4000 });
  const label = await page.evaluate(() => { const b = document.querySelector('.lmd-menu [data-more=pin]'); return b ? b.textContent.trim() : ''; });
  check('el menú de la nota ofrece fijar', /Pin to the top/.test(label), label);
  await page.click('.lmd-menu [data-more=pin]'); await sleep(500);
  const pinned = await until(() => page.evaluate(() => (JSON.parse(localStorage.getItem('mdtools:settings') || '{}').pins || []).length));
  check('fijar guarda la nota en las preferencias de este navegador', pinned === 1, pinned);
  const section = await until(() => page.evaluate(() => { const s = document.querySelector('.lmd-xroot[data-root=pins]'); return s ? s.querySelectorAll('.lmd-node').length : 0; }));
  check('la sección Fijadas sale arriba del explorador con la nota', section === 1 && await page.evaluate(() => document.querySelector('#lmd-tree .lmd-xroot, .lmd-tree-box .lmd-xroot, .lmd-xroot') === document.querySelector('.lmd-xroot[data-root=pins]')), section);

  await page.click('[data-act=more]'); await page.waitForSelector('.lmd-menu');
  check('con la nota fijada el menú ofrece soltarla', /Unpin/.test(await page.textContent('.lmd-menu [data-more=pin]')));
  await page.keyboard.press('Escape'); await sleep(200);

  await page.reload(); await page.waitForSelector('.lmd-article', { timeout: 15000 }).catch(() => {}); await sleep(600);
  check('la nota fijada sigue ahí al recargar', await page.evaluate(() => !!document.querySelector('.lmd-xroot[data-root=pins] .lmd-node')));

  // Desde el menú del explorador (clic derecho en la fila fijada).
  await page.click('.lmd-xroot[data-root=pins] .lmd-node', { button: 'right' }); await page.waitForSelector('.lmd-menu', { timeout: 4000 });
  check('el menú del explorador ofrece soltar la nota fijada', /Unpin/.test(await page.textContent('.lmd-menu [data-f=pin]').catch(() => '')));
  await page.click('.lmd-menu [data-f=pin]'); await sleep(500);
  check('soltarla saca la sección', await until(() => page.evaluate(() => !document.querySelector('.lmd-xroot[data-root=pins]'))));
  check('y la saca de las preferencias', await page.evaluate(() => (JSON.parse(localStorage.getItem('mdtools:settings') || '{}').pins || []).length === 0));

  // El inicio muestra las fijadas.
  await page.click('[data-act=more]'); await page.waitForSelector('.lmd-menu'); await page.click('.lmd-menu [data-more=pin]'); await sleep(400);
  await page.goto(R.home); await page.waitForSelector('.lmd-home', { timeout: 15000 });
  check('el inicio lista las notas fijadas', await until(() => page.evaluate(() => document.querySelectorAll('.lmd-home-pins a.lmd-home-pin').length === 1)));
  await d.ctx.close();

  // ---------- Teléfono: recorrido y chip ----------
  const m = await R.open(null, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const ph = m.page;
  await ph.goto(R.home);
  check('en el teléfono sale el recorrido de tres pasos', !!(await ph.waitForSelector('.lmd-tour', { timeout: 15000 }).catch(() => null)));
  const first = await ph.textContent('.lmd-tour-count').catch(() => '');
  check('empieza en el paso 1 de 3', /1 \/ 3/.test(first), first);
  await ph.click('.lmd-tour-next'); await sleep(150);
  check('Siguiente pasa al paso 2 (la tarea)', /2 \/ 3/.test(await ph.textContent('.lmd-tour-count')) && /- \[ \]/.test(await ph.textContent('.lmd-tour-text')));
  const texts = await ph.evaluate(() => document.querySelector('.lmd-tour').textContent);
  check('en la web no menciona la nube gratis (eso es de la app de la tienda)', !/10 free notes/.test(texts));
  check('los textos del recorrido no llevan signos de más', noShout(texts), texts);
  await ph.click('.lmd-tour-skip'); await sleep(200);
  check('Saltear lo cierra', !(await ph.$('.lmd-tour')));
  await ph.reload(); await ph.waitForSelector('.lmd-home', { timeout: 15000 }); await sleep(2200);
  check('no vuelve a salir', !(await ph.$('.lmd-tour')));
  check('quedó anotado en este navegador', await ph.evaluate(() => localStorage.getItem('lmd-tour-seen') === '1'));
  await m.ctx.close();

  // En la app de la tienda suma la línea de la nube gratis.
  const s = await R.open(null, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await s.page.goto(R.home + '?src=android');
  await s.page.waitForSelector('.lmd-tour', { timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 3; i++) await s.page.click('.lmd-tour-next').catch(() => {});
  const store = await s.page.textContent('.lmd-tour').catch(() => '');
  check('en la app de la tienda dice "10 free notes in the cloud"', /10 free notes in the cloud/.test(store), store);
  await s.ctx.close();

  // Chip sin conexión: texto corto junto al ícono en pantalla chica.
  const c = await R.open(null, { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await c.page.goto(R.home); await c.page.waitForSelector('.lmd-home', { timeout: 15000 });
  await c.ctx.setOffline(true); await c.page.evaluate(() => window.dispatchEvent(new Event('offline'))); await sleep(500);
  const chip = await until(() => c.page.evaluate(() => { const n = document.querySelector('.lmd-offline'); if (!n) return null; const sp = n.querySelector('span'); return { text: sp.textContent, shown: getComputedStyle(sp).display !== 'none', svg: !!n.querySelector('svg') }; }));
  check('sin red en el teléfono el chip muestra ícono y texto corto', !!chip && chip.shown && chip.svg && chip.text === 'Offline', chip);
  await c.ctx.close();

  check('ningún pedido salió a los servidores reales', R.outside.length === 0, R.outside);
  check('sin errores en la página', R.errors.length === 0, R.errors);
} catch (e) {
  check('la prueba no se cortó', false, String(e && e.stack || e));
}
const bad = done();
await R.close();
process.exit(bad ? 1 : 0);
