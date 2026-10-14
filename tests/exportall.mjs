// Descargar todas mis notas: el botón de Ajustes > Nube arma en el navegador un ZIP con las notas de la nube, sus
// carpetas, los tableros y las imágenes (en _images/, con la dirección ya relativa), y el aviso de eliminar la
// cuenta ofrece la misma descarga como primer paso. No hay endpoint nuevo: se usa la lista y la lectura de siempre.
// Contra un servidor local, con la app web. Las carpetas protegidas y el equipo los cubren vault.mjs y team.mjs.
// Uso: node exportall.mjs
import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
import { rig, tally, sleep, root } from './rig.mjs';

const { check, done } = tally();
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(80); } };

// Un lector de ZIP mínimo: la central de directorios, y cada entrada guardada o con deflate.
function unzip(buf) {
  let end = buf.length - 22; while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('no es un zip');
  const count = buf.readUInt16LE(end + 10); let at = buf.readUInt32LE(end + 16); const out = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10); const size = buf.readUInt32LE(at + 20); const nameLen = buf.readUInt16LE(at + 28); const extra = buf.readUInt16LE(at + 30); const note = buf.readUInt16LE(at + 32); const local = buf.readUInt32LE(at + 42);
    const name = buf.slice(at + 46, at + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28); const body = buf.slice(start, start + size);
    out[name] = method === 8 ? zlib.inflateRawSync(body) : body;
    at += 46 + nameLen + extra + note;
  }
  return out;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const R = await rig({ ALLOW_ORIGINS: '*' });
const BOARD = '# Plan\n\n```kanban\n## To do\n- [ ] Write the guide {id=c1}\n\n## Done\n- [x] Ship it {id=c2}\n```\n';
let bad = 1;
try {
  const ana = await R.signup('ana@example.test');
  const put = (p, text) => R.api('PUT', '/notes/' + encodeURIComponent(p), { text }, ana.s);
  const img = await fetch(R.base + '/files', { method: 'POST', headers: { authorization: 'Bearer ' + ana.s, 'content-type': 'image/png' }, body: PNG }).then((r) => r.json());
  await put('a.md', '# Alpha\n\nTop level.\n');
  await put('proj/b.md', '# Beta\n\nIn a folder.\n');
  await put('proj/deep/c.md', '# Gamma\n\n![dot](' + img.url + ')\n\nTwo levels down.\n');
  await put('board.md', BOARD);
  await put('data.json', '{ "n": 1 }\n');
  const before = (await R.api('GET', '/notes', undefined, ana.s)).json.length;

  const { page } = await R.open(ana);
  await page.goto(R.home); await page.waitForSelector('.lmd-home');
  await page.waitForSelector('[data-act=settings]');
  await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=cloud]'); await page.waitForSelector('[data-acct=cloud] [data-c=export]');

  console.log('El botón y el ZIP');
  const label = await page.textContent('[data-acct=cloud] [data-c=export]');
  check('Ajustes > Nube tiene el botón "Download all my notes"', label === 'Download all my notes', label);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('[data-acct=cloud] [data-c=export]')]);
  check('el archivo se llama sharpmd-notes y la fecha, con .zip', /^sharpmd-notes-\d{4}-\d{2}-\d{2}\.zip$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const file = await dl.path(); const z = unzip(fs.readFileSync(file)); const names = Object.keys(z).sort();
  const T = (n) => (z['sharpmd-notes/' + n] || Buffer.alloc(0)).toString('utf8');
  check('lleva todas las notas con sus carpetas', ['a.md', 'board.md', 'data.json', 'proj/b.md', 'proj/deep/c.md'].every((n) => 'sharpmd-notes/' + n in z), names);
  check('el texto de cada nota es el de la nube', T('a.md') === '# Alpha\n\nTop level.\n' && T('proj/b.md') === '# Beta\n\nIn a folder.\n' && T('data.json') === '{ "n": 1 }\n', names);
  check('el tablero viaja entero dentro de su nota', T('board.md') === BOARD, T('board.md'));
  const imgName = Object.keys(z).find((n) => /^sharpmd-notes\/_images\/[0-9a-f]{40}\.png$/.test(n));
  check('la imagen va en _images/ con sus mismos bytes', !!imgName && Buffer.compare(z[imgName], PNG) === 0, names);
  check('la dirección de la imagen pasa a ser relativa a la nota', !!imgName && T('proj/deep/c.md').includes('(../../_images/' + imgName.split('/').pop() + ')') && !T('proj/deep/c.md').includes(R.base), T('proj/deep/c.md'));
  check('sin nada que dejar afuera no hay _not-included.txt', !names.some((n) => /_not-included/.test(n)), names);
  check('no quedó ninguna ventana de progreso abierta', await until(() => page.evaluate(() => !document.querySelector('.lmd-dlg')), 4000));
  check('el servidor no cambió: mismas notas', (await R.api('GET', '/notes', undefined, ana.s)).json.length === before);

  console.log('Eliminar la cuenta');
  await page.click('[data-acct=cloud] [data-c=delete]'); await page.waitForSelector('.lmd-dlg');
  const ask = await page.evaluate(() => ({ title: document.querySelector('.lmd-dlg h3').textContent, buttons: [...document.querySelectorAll('.lmd-dlg [data-dlg]')].map((b) => b.textContent), input: !!document.querySelector('.lmd-dlg input') }));
  check('el primer paso ofrece descargar todo antes, sin pedir todavía el correo', ask.title === 'Before deleting the account' && ask.buttons.includes('Download all my notes') && ask.buttons.includes('Continue without downloading') && !ask.input, ask);
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('.lmd-dlg [data-dlg=ok]')]);
  check('descargar desde ahí entrega el mismo ZIP', Object.keys(unzip(fs.readFileSync(await dl2.path()))).length === names.length);
  check('y después sigue el paso de siempre: escribir el correo', !!(await until(() => page.evaluate(() => !!document.querySelector('.lmd-dlg input')), 6000)));
  await page.keyboard.press('Escape');
  await until(() => page.evaluate(() => !document.querySelector('.lmd-dlg')), 3000);
  await page.click('[data-acct=cloud] [data-c=delete]'); await page.waitForSelector('.lmd-dlg [data-dlg=alt]');
  await page.click('.lmd-dlg [data-dlg=alt]');
  check('"Continue without downloading" salta directo al correo', !!(await until(() => page.evaluate(() => !!document.querySelector('.lmd-dlg input')), 4000)));
  await page.keyboard.press('Escape');
  check('cancelar no borra nada', (await R.api('GET', '/notes', undefined, ana.s)).json.length === before);

  console.log('El archivo nuevo y la guía');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const lazy = /const LAZY_APP = \{([\s\S]*?)\n\s*\};/.exec(read('src/content.js'))[1];
  check('src/exportall.js está en LAZY_APP, LAZY_HAVE, LATE y el manifiesto', /exportall: \{ js: \['src\/exportall\.js'\] \}/.test(lazy) && /LAZY_HAVE\.exportall/.test(read('src/content.js')) && /'src\/exportall\.js'/.test(read('sw.js')) && /"src\/exportall\.js"/.test(read('manifest.json')));
  const strings = [...read('src/exportall.js').matchAll(/T\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  const inDefaults = (s) => read('src/defaults.js').includes('"' + s.replace(/\\'/g, "'").replace(/"/g, '\\"') + '":');
  check('los textos nuevos no llevan signos de admiración ni rayas largas', strings.length > 10 && strings.every((s) => !/[!¡–—]/.test(s)), strings.filter((s) => /[!¡–—]/.test(s)));
  check('cada texto nuevo tiene su par en inglés en defaults.js', strings.every(inDefaults), strings.filter((s) => !inDefaults(s)));
  check('la guía lo explica en los dos idiomas', /Download all my notes/.test(read('src/guide/en/export-and-import.md')) && /Descargar todas mis notas/.test(read('src/guide/es/export-and-import.md')));

  check('sin errores de página', R.errors.length === 0, R.errors.slice(0, 5));
  check('nada salió hacia sharpmd.app', R.outside.length === 0, R.outside.slice(0, 3));
  bad = done();
} catch (e) {
  console.log('\nLa prueba se cortó: ' + (e && e.stack || e));
} finally {
  await R.close().catch(() => {});
}
process.exit(bad ? 1 : 0);
