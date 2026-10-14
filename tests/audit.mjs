// Auditoría de seguridad de los enlaces de carpeta y plantillas (2.85.0) y de la vista previa de HTML (2.86.0).
// Cada prueba es un ataque que funcionó, o uno que se intentó y tiene que seguir sin funcionar:
//  - el nombre corto de una plantilla quitada no pasa al próximo enlace de la cuenta (los números de enlace se reusan);
//  - listar una carpeta compartida no cuesta más porque sus notas pesen (lo pide cualquiera, sin sesión);
//  - nada de afuera de la carpeta sale por el enlace, con la ruta escrita como sea;
//  - el ZIP de una plantilla ajena no trae archivos que el sistema ejecute con doble clic;
//  - los nombres de una plantilla hostil se muestran como texto;
//  - un <template shadowrootmode> no saltea lo que la vista previa le saca a un HTML (ni una conexión, sin scripts);
//  - con scripts, un HTML no lee de su carpeta lo que no es un recurso de página (una nota, un .env).
// Todo contra servidores locales. "Afuera" es un servidor de acá que anota cada pedido y cada conexión.
//   node audit.mjs
//   ONLY=server node audit.mjs    (una parte: server, template, html)
import { rig, tally, sleep, root } from './rig.mjs';
import { chromium } from 'playwright-core';
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path';

const ONLY = process.env.ONLY || '';
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 10000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(80); } };
const step = async (id, name, fn) => { if (ONLY && ONLY !== id) return; console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } };
// Los nombres de un ZIP, leídos de su índice.
function zipNames(buf) {
  const out = []; const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); const n = buf.readUInt16LE(end + 10); let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < n; i++) { const nl = buf.readUInt16LE(p + 28); const el = buf.readUInt16LE(p + 30); const cl = buf.readUInt16LE(p + 32); out.push(buf.slice(p + 46, p + 46 + nl).toString('utf8')); p += 46 + nl + el + cl; }
  return out;
}

// ================= El servidor =================
await step('server', 'Enlaces de carpeta y plantillas: el servidor', async () => {
  const R = await rig({});
  try {
    const api = R.api;
    const a = await R.signup('autora@example.test', true); const b = await R.signup('otra@example.test', true);
    const put = (who, p, text) => api('PUT', '/notes/' + encodeURIComponent(p), { text }, who.s);
    const raw = (p, h) => fetch(R.base + p, { headers: h || {} }).then(async (r) => ({ status: r.status, text: await r.text() }));
    const N = { 'Planillas/README.md': '# P\n', 'Planillas/sub/x.md': 'X\n', 'Planillas-privado/s.md': 'SECRETO-1', 'planillas/s.md': 'SECRETO-2', 'Planillas /s.md': 'SECRETO-3', 'PlanillasX/s.md': 'SECRETO-4', 'otro/s.md': 'SECRETO-5', 'Planillas.md': 'SECRETO-6',
      'Curso/a.md': 'PUBLICO', 'Interno/b.md': 'SECRETO-INTERNO' };
    for (const [p, t] of Object.entries(N)) await put(a, p, t);

    // ---- El nombre corto y el número de enlace que se vuelve a usar ----
    const l1 = (await api('POST', '/links', { path: 'Curso', kind: 'folder', template: true, name: 'curso' }, a.s)).json;
    check('la plantilla con nombre se abre por su nombre', (await raw('/template/curso')).status === 200 && l1.name === 'curso', l1);
    await api('DELETE', '/links/' + l1.id, undefined, a.s);
    check('quitado el enlace, el nombre responde que fue retirada', (await raw('/template/curso')).status === 410);
    const l2 = (await api('POST', '/links', { path: 'Interno', kind: 'folder', template: true }, a.s)).json;
    const leak = await raw('/template/curso?all=1');
    check('otra plantilla de la cuenta, creada sin nombre, no hereda el nombre de la que se quitó (aunque reciba su número)', l2.name === '' && leak.status === 410 && !/SECRETO/.test(leak.text) && (await raw('/template/curso')).status === 410, { id1: l1.id, id2: l2.id, name: l2.name, status: leak.status, body: leak.text.slice(0, 120) });
    check('y esa plantilla sigue abriéndose solo por su enlace secreto', (await raw('/public/' + l2.token + '?all=1')).status === 200);
    const again = await api('PUT', '/links/' + l2.id, { name: 'curso' }, a.s);
    check('el nombre sigue siendo de la cuenta: lo puede volver a apuntar a mano', again.status === 200 && again.json.name === 'curso' && /SECRETO-INTERNO/.test((await raw('/template/curso?all=1')).text), again.json);
    // Lo mismo cuando el enlace se va por otro camino: la carpeta pasa a estar protegida con contraseña.
    const vb = (n, seed) => Buffer.from(Array.from({ length: n }, (x, i) => (i * 7 + seed * 13) % 256)).toString('base64');
    await put(a, 'Cofre/in/n.md', 'N'); const l3 = (await api('POST', '/links', { path: 'Cofre/in', kind: 'folder', template: true, name: 'cofre-in' }, a.s)).json;
    const v = await api('POST', '/vaults', { folder: 'Cofre', salt: vb(16, 1), iters: 200000, wrapped: vb(60, 2), check: vb(32, 3) }, a.s);
    await put(a, 'Libre/n.md', 'SECRETO-LIBRE'); const l4 = (await api('POST', '/links', { path: 'Libre', kind: 'folder', template: true }, a.s)).json;
    const leak2 = await raw('/template/cofre-in?all=1');
    check('un enlace que se va al proteger su carpeta también suelta su nombre', v.status === 200 && l4.name === '' && leak2.status === 410 && !/SECRETO/.test(leak2.text), { v: v.status, ids: [l3.id, l4.id], name: l4.name, status: leak2.status });

    // ---- Nada de afuera de la carpeta ----
    const mk = (await api('POST', '/links', { path: 'Planillas', kind: 'folder', template: true, login: true }, a.s)).json; const tok = mk.token;
    const tries = ['../otro/s.md', '..%2Fotro%2Fs.md', '%2e%2e/otro/s.md', '..\\otro\\s.md', '%252e%252e%252fotro%252fs.md', '/otro/s.md', 'sub/../../otro/s.md', '../Planillas-privado/s.md', '-privado/s.md', '', '.', 'sub/', 'SUB/x.md', 'readme.md', 'sub//x.md', 'README.md\u0000', '../Planillas.md', '‥/otro/s.md', '．．/otro/s.md'];
    const got = []; for (const t of tries) { const r = await raw('/public/' + tok + '?note=' + encodeURIComponent(t)); got.push([t, r.status, /SECRETO/.test(r.text)]); }
    check('una ruta que quiere salir de la carpeta (.., codificada, doble, barras invertidas, mayúsculas, Unicode parecido) no devuelve nada', got.every((g) => g[1] >= 400 && !g[2]), got.filter((g) => g[1] < 400 || g[2]));
    const list = await raw('/public/' + tok);
    check('la lista trae solo lo de la carpeta: ni las de nombre parecido, ni otras mayúsculas, ni el archivo del mismo nombre', J(JSON.parse(list.text).notes.map((n) => n.path)) === J(['README.md', 'sub/x.md']) && !/SECRETO|text/.test(list.text), list.text);
    const odd = []; for (const p of ['', '/', '.', '..', 'Planillas/..', 'Planillas/sub/../..', '%', 'Plan', 'Planillas-', 'P%', '\\']) { const r = await api('POST', '/links', { path: p, kind: 'folder' }, a.s); odd.push([p, r.status]); }
    check('no se puede pedir un enlace de la raíz, de un prefijo ni de una ruta con ..', odd.every((o) => o[1] === 400 || o[1] === 404), odd);
    check('una plantilla que pide cuenta no se entrega entera sin sesión, por ningún camino', (await raw('/public/' + tok + '?all=1')).status === 401 && (await raw('/public/' + tok + '?all=1', { authorization: 'Bearer mds_inventada' })).status === 401 && (await api('POST', '/public/' + tok + '/copied')).status === 401 && !/"text"/.test((await raw('/public/' + tok + '?all=true')).text));
    check('otra cuenta no cambia ni quita el enlace, ni con su número ni nombrando a la dueña', (await api('PUT', '/links/' + mk.id, { template: true, name: 'robado' }, b.s)).status === 404 && (await api('PUT', '/links/' + mk.id, { o: a.id, template: true, name: 'robado' }, b.s)).status === 403
      && (await api('DELETE', '/links/' + mk.id, undefined, b.s)).status === 200 && (await raw('/public/' + tok)).status === 200);
    const pre = await fetch(R.base + '/links', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
    check('un sitio ajeno no recibe permiso de CORS, y ningún origen lo recibe con credenciales', pre.headers.get('access-control-allow-origin') === null && pre.headers.get('access-control-allow-credentials') === null && (await fetch(R.base + '/public/' + tok, { headers: { origin: 'chrome-extension://abcdefghijklmnop' } })).headers.get('access-control-allow-credentials') === null);
    // La IP sale del último tramo de x-forwarded-for (el que anota el proxy): cambiar los anteriores no esquiva un tope.
    const xf = async (val) => (await api('GET', '/template/no-existe-x', undefined, undefined, { 'x-forwarded-for': val })).status;
    let hit = 0; for (let i = 0; i < 64; i++) { if ((await xf('9.9.9.' + i + ', 7.7.7.7')) === 429) { hit = i; break; } }
    check('inventar el comienzo de x-forwarded-for no esquiva el tope de nombres probados', hit === 60, hit);

    // ---- Listar no lee las notas ----
    const big = 'x'.repeat(1000 * 1000);
    for (let i = 0; i < 40; i++) await put(a, 'Grande/n' + i + '.md', big);
    for (let i = 0; i < 40; i++) await put(a, 'Chica/n' + i + '.md', 'x');
    const g = (await api('POST', '/links', { path: 'Grande', kind: 'folder', template: true }, a.s)).json; const c = (await api('POST', '/links', { path: 'Chica', kind: 'folder', template: true }, a.s)).json;
    const lap = async (t) => { const t0 = Date.now(); const rs = await Promise.all(Array.from({ length: 30 }, () => raw('/public/' + t))); return { ms: Date.now() - t0, ok: rs.every((r) => r.status === 200) }; };
    await lap(c.token); await lap(g.token); // en caliente
    const small = await lap(c.token); const large = await lap(g.token);
    check('listar una carpeta de 40 MB cuesta lo mismo que una de 40 bytes: el listado no pasa por el texto', small.ok && large.ok && large.ms < small.ms * 4 + 150, { small: small.ms, large: large.ms });
    const all = await raw('/public/' + g.token + '?all=1');
    check('y una carpeta que pesa más que el tope no se entrega entera', all.status === 413 && all.text.length < 200, all.status);
    check('una nota sola de esa carpeta se sigue leyendo', JSON.parse((await raw('/public/' + g.token + '?note=n3.md')).text).text.length === big.length);
  } finally { await R.close(); }
});

// ================= Una plantilla hostil, en la app =================
await step('template', 'Una plantilla hostil, vista y descargada por otra persona', async () => {
  const R = await rig({ ALLOW_ORIGINS: '*' });
  try {
    const api = R.api;
    const mala = await R.signup('mala@example.test', true); const vic = await R.signup('victima@example.test', true);
    const put = (who, p, text) => api('PUT', '/notes/' + encodeURIComponent(p), { text }, who.s);
    const F = '<img src=x data-pwn onerror=window.__pwn=1>';
    const NOTES = {
      'README.md': '# <img src=x data-pwn onerror=window.__pwn=2>\n\n<script>window.__pwn=3</script><a href="javascript:window.__pwn=4" id="jsl">js</a> [md](javascript:window.__pwn=5) <iframe src="/src/htmlrun.html" data-pwn></iframe><object data="/src/htmlrun.html" data-pwn></object><embed src="/src/htmlrun.html" data-pwn>\n\n[[<img src=x data-pwn onerror=window.__pwn=6>]]\n',
      '"><img src=x data-pwn onerror=window.__pwn=12>.md': '---\ntitle: "<img src=x data-pwn onerror=window.__pwn=13>"\n---\n# <img src=x data-pwn onerror=window.__pwn=14>\n',
      "'onmouseover='window.__pwn=15' x='.md": '# c\n', 'sub/__proto__.md': 'p', '__proto__/x.md': 'p', 'constructor.md': 'c', 'notas/buena.md': '# buena\n', 'datos.json': '{}', 'pagina.html': '<h1 id="t">html</h1><script>parent.__pwn=16</script>',
      'abrir.bat': '@echo off\r\necho PWN\r\n', 'leeme.md.cmd': 'echo PWN', 'x.js': 'WScript.Echo("PWN")', 'acceso.url': '[InternetShortcut]\nURL=file://evil.example/share\n', 'm.hta': '<script>x</script>', 'r.reg': 'Windows Registry Editor', 'p.ps1': 'x', 'v.VBS': 'x', 's.scr': 'x', 'w.wsf': 'x', 'punto.bat.': 'x', 'sub/guion.py': 'x',
      'nota‮txt.exe': 'rtl',
    };
    for (const [p, t] of Object.entries(NOTES)) { const r = await put(mala, F + '/' + p, t); if (r.status !== 200) throw new Error('no se pudo crear ' + p + ': ' + J(r.json)); }
    const mk = (await api('POST', '/links', { path: F, kind: 'folder', template: true, name: 'hostil' }, mala.s)).json; const tok = mk.token;
    await put(vic, 'mias/privada.md', 'MIO');
    const v = await R.open(vic, { acceptDownloads: true }); const page = v.page;
    const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    const popups = []; v.ctx.on('page', (p) => popups.push(p.url()));
    const st = () => page.evaluate(() => ({ pwn: window.__pwn, marks: [...document.querySelectorAll('[data-pwn]')].map((n) => n.tagName + '@' + (n.parentNode.className || n.parentNode.tagName)), frames: document.querySelectorAll('iframe, object, embed, form, base, meta[http-equiv=refresh]').length,
      onattr: [...document.querySelectorAll('*')].filter((n) => [...n.attributes].some((a) => /^on/i.test(a.name))).length, jslinks: [...document.querySelectorAll('a[href]')].filter((a) => /^\s*javascript:/i.test(a.getAttribute('href'))).length }));
    const cleanSt = (s) => s.pwn === undefined && s.marks.length === 0 && s.frames === 0 && s.onattr === 0 && s.jslinks === 0;

    await page.goto(R.home + '?f=' + encodeURIComponent('pub/' + tok + '/')); await page.waitForSelector('.lmd-fp[data-done]', { timeout: 15000 }); await sleep(600);
    const fp = await page.evaluate(() => ({ title: document.title, name: document.querySelector('.lmd-fp-name').textContent, rows: [...document.querySelectorAll('.lmd-fp-row')].map((a) => a.getAttribute('title')), tree: [...document.querySelectorAll('.lmd-xroot[data-root=pub] .lmd-node')].map((n) => n.getAttribute('title')) }));
    check('la página de la carpeta muestra el nombre de la carpeta y de cada archivo como texto', cleanSt(await st()) && fp.name === F && fp.rows.includes('"><img src=x data-pwn onerror=window.__pwn=12>.md') && fp.tree.includes("'onmouseover='window.__pwn=15' x='.md"), [await st(), fp.name]);
    const seen = [];
    for (const p of ['"><img src=x data-pwn onerror=window.__pwn=12>.md', "'onmouseover='window.__pwn=15' x='.md", 'sub/__proto__.md', 'abrir.bat', 'pagina.html']) {
      await page.goto(R.home + '?f=' + encodeURIComponent('pub/' + tok + '/' + p.split('/').map(encodeURIComponent).join('/'))); await page.waitForSelector('.lmd-article', { state: 'attached' }); await sleep(900);
      seen.push([p, await st()]);
    }
    check('cada nota de nombre o título armado se abre sin que nada de eso llegue a ser una etiqueta', seen.every((s) => cleanSt(s[1])), seen.filter((s) => !cleanSt(s[1])));
    // Los parámetros de la dirección
    const params = [];
    for (const u of ['?t=' + encodeURIComponent('<img src=x data-pwn onerror=window.__pwn=30>'), '?f=' + encodeURIComponent('t/<img src=x data-pwn onerror=window.__pwn=31>/'), '?f=' + encodeURIComponent('pub/' + tok + '/../../x'), '#open=' + encodeURIComponent('javascript:window.__pwn=32'), '?f=' + encodeURIComponent('javascript:window.__pwn=33'), '?f=' + encodeURIComponent('//evil.example/x')]) {
      await page.goto('about:blank'); await page.goto(R.home + u); await page.waitForSelector('.lmd-home, .lmd-article', { state: 'attached' }); await sleep(900);
      params.push([u, await st(), new URL(page.url()).origin === R.origin]);
    }
    check('un nombre de plantilla o una ruta armados en la dirección no inyectan nada ni sacan a la persona del sitio', params.every((p) => cleanSt(p[1]) && p[2]), params.filter((p) => !cleanSt(p[1]) || !p[2]));

    // "Usar esta plantilla": la ventana, el ZIP y la copia.
    await page.goto(R.home + '?t=hostil'); await page.waitForSelector('.lmd-tplbar'); await page.waitForSelector('.lmd-fp[data-done]');
    await page.click('.lmd-tplbar [data-act=tpl-use]'); await page.waitForSelector('.lmd-fork .lmd-fork-way');
    check('la ventana "Usar esta plantilla" no dibuja nada de la plantilla como etiqueta', cleanSt(await st()), await st());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.lmd-fork [data-fk=zip]')]);
    const zp = path.join(os.tmpdir(), 'audit-hostil-' + Date.now() + '.zip'); await dl.saveAs(zp);
    const names = zipNames(fs.readFileSync(zp)); try { fs.rmSync(zp); } catch (e) { /* queda en la carpeta temporal */ }
    const RUNS = /\.(bat|cmd|com|exe|scr|pif|msi|ps1|vbs|vbe|js|jse|wsf|wsh|hta|reg|lnk|url|scf|inf|jar|py|pyw|desktop|command)[. ]*$/i;
    const top = dl.suggestedFilename().replace(/\.zip$/, '');
    check('el ZIP no trae ningún archivo que el sistema ejecute con doble clic: salen con .txt al final', names.length === Object.keys(NOTES).length && !names.some((n) => RUNS.test(n)) && ['abrir.bat.txt', 'leeme.md.cmd.txt', 'x.js.txt', 'acceso.url.txt', 'm.hta.txt', 'v.VBS.txt', 'punto.bat..txt', 'sub/guion.py.txt'].every((n) => names.includes(top + '/' + n)), names.filter((n) => RUNS.test(n)));
    check('ni nombres con marcas que los muestran dados vuelta', !names.some((n) => /[‎‏‪-‮⁦-⁩]/.test(n)) && names.includes(top + '/notatxt.exe.txt'), names.filter((n) => /nota/.test(n)));
    check('las notas y los demás archivos salen con su nombre, dentro de una sola carpeta sin .. ni rutas absolutas', ['README.md', 'notas/buena.md', 'datos.json', 'pagina.html', 'sub/__proto__.md'].every((n) => names.includes(top + '/' + n)) && names.every((n) => n.startsWith(top + '/') && !n.split('/').some((s) => s === '..' || s === '.' || !s)) && !/[<>:"|?*\\]/.test(top), [top, names.slice(0, 4)]);
    await page.evaluate(() => document.querySelectorAll('.lmd-sent').forEach((b) => b.remove()));
    await page.click('.lmd-tplbar [data-act=tpl-use]'); await page.waitForSelector('.lmd-fork .lmd-fork-way'); await page.click('.lmd-fork [data-fk=browser]');
    await until(async () => (await page.evaluate(async () => (await LMD.store.notesAll()).length)) >= Object.keys(NOTES).length, 12000); await sleep(600);
    const local = await page.evaluate(async () => ({ names: (await LMD.store.notesAll()).map((n) => n.name), polluted: ({}).text !== undefined || ({}).name !== undefined }));
    check('la copia al navegador queda toda en una carpeta nueva y no toca nada más', local.names.length === Object.keys(NOTES).length && local.names.every((n) => n.startsWith(top + '/')) && !local.polluted && cleanSt(await st()), [local.names.length, local.polluted, await st()]);
    const cloud = (await api('GET', '/notes', undefined, vic.s)).json.map((n) => n.path); const shares = (await api('GET', '/shares', undefined, vic.s)).json;
    check('la cuenta de quien mira queda como estaba: sus notas, sin enlaces ni nada compartido', J(cloud) === J(['mias/privada.md']) && shares.links.length === 0 && shares.people.length === 0 && dialogs.length === 0 && popups.length === 0, { cloud, shares, dialogs, popups });
    await v.ctx.close();
  } finally { await R.close(); }
});

// ================= La vista previa de un HTML =================
await step('html', 'La vista previa de HTML: lo que la reescritura no veía y lo que lee de la carpeta', async () => {
  const P = createRequire(import.meta.url)(path.join(root, 'src', 'codeview.js'));
  const B = 'https://lmd.local/d1/';
  const ok = [['a.css', 'css'], ['A.CSS', 'css'], ['x/app.js', 'js'], ['m.mjs', 'js'], ['logo.png', 'data'], ['f.woff2', 'data'], ['v.mp4', 'data'], ['i.svg', 'data'], ['a.css?v=1#x', 'css']];
  const no = [['secreto.md', 'css'], ['.env', 'css'], ['.env', 'js'], ['notas.md', 'js'], ['notas.md', 'data'], ['.env', 'data'], ['id_rsa', 'data'], ['datos.json', 'js'], ['datos.json', 'data'], ['a.js', 'css'], ['a.css', 'js'], ['a.css', 'data'], ['a.md.css.md', 'css'], ['a.css.', 'css'], ['a.css%00.md', 'css'], ['clave.pem', 'data'], ['pagina.html', 'data'], ['a.txt', 'data']];
  check('de la carpeta solo entra lo que es un recurso de página, cada uno por su tipo', typeof P.resOk === 'function' && ok.every((c) => P.resOk(B + c[0], c[1]) === true) && no.every((c) => P.resOk(B + c[0], c[1]) === false), typeof P.resOk === 'function' ? ok.filter((c) => !P.resOk(B + c[0], c[1])).concat(no.filter((c) => P.resOk(B + c[0], c[1]))) : 'sin resOk');

  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.md': 'text/markdown', '.svg': 'image/svg+xml' };
  const site = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]); const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + site.address().port; const home = origin + '/src/app.html';
  const out = { hits: [], conns: 0 };
  const far = http.createServer((req, res) => { out.hits.push(req.method + ' ' + req.url); res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' }); res.end('afuera'); });
  far.on('connection', () => { out.conns++; });
  await new Promise((r) => far.listen(0, '127.0.0.1', r));
  const FAR = 'http://127.0.0.1:' + far.address().port;
  const reset = () => { out.hits.length = 0; out.conns = 0; };
  // Lo de adentro de un <template shadowrootmode> es inerte para el DOMParser que prepara la vista previa, y el marco
  // lo vuelve un árbol aparte: un marco, un enlace o una hoja de estilos ahí adentro pasaban sin tocar.
  const DSD = `<!doctype html><html><head><title>dsd</title></head><body><h1 id="t">dsd</h1>
<div id="host"><template shadowrootmode="open"><iframe src="${FAR}/dsd-iframe"></iframe><iframe srcdoc="<img src='${FAR}/dsd-srcdoc.png'>"></iframe><meta http-equiv="refresh" content="0;url=${FAR}/dsd-refresh"><img src="${FAR}/dsd.png"><link rel="stylesheet" href="${FAR}/dsd.css"><link rel="preconnect" href="${FAR}">
<object data="${FAR}/dsd-object"></object><embed src="${FAR}/dsd-embed"><a id="dsda" href="${FAR}/dsd-a" target="_self">clic</a>
<div><template shadowrootmode="open"><iframe src="${FAR}/dsd-anidado"></iframe></template></div></template></div>
<div id="viejo"><template shadowroot="open"><iframe src="${FAR}/dsd-viejo"></iframe></template></div>
<template id="comun"><p>plantilla común</p></template></body></html>`;
  const LEE = `<!doctype html><html><head><title>lee</title><link rel="stylesheet" href="secreto.md"><link rel="stylesheet" href=".env"><link rel="stylesheet" href="estilo.css">
<style>@import "notas/privada.md"; @import url(.env); h1 { background: url(notas/privada.md); }</style></head><body><h1 id="t" style="background: url(.env)">lee</h1>
<img id="im" src="notas/privada.md"><img id="im2" src=".env"><img id="logo" src="logo.svg"><video id="vd" src="secreto.md" poster=".env"></video><svg><image id="si" href="notas/privada.md"/></svg>
<script id="s1" src="notas/privada.md"></script><script id="s2" src=".env"></script><script id="s3" src="datos.json"></script><script src="app.js"></script>
<script>var R = { all: document.documentElement.outerHTML, app: document.body.dataset.app, color: getComputedStyle(document.body).color, logo: (document.getElementById('logo').getAttribute('src') || '').slice(0, 19) }; document.body.dataset.r = JSON.stringify(R);</script></body></html>`;
  // Un HTML que, escrito y vuelto a leer, da otro árbol: el <style> queda dentro de MathML y lo que era su texto pasa
  // a ser un marco y un <link> que la primera lectura no vio.
  const MUTA = `<!doctype html><h1 id="t">muta</h1><form><math><mtext></form><form><mglyph><style></math><iframe src="${FAR}/muta-iframe"></iframe><link rel="preconnect" href="${FAR}"><a id="ma" href="${FAR}/muta-a" target="_self">a</a>`;
  const SEED = { 'readme.md': '# r\n', 'dsd.html': DSD, 'muta.html': MUTA, 'lee.html': LEE, 'secreto.md': '# Secreto\n\nCLAVE-EN-MD\n', '.env': 'API_KEY=CLAVE-EN-ENV\n', 'notas/privada.md': 'DIARIO-PRIVADO\n', 'datos.json': '{"k":"CLAVE-EN-JSON"}',
    'estilo.css': 'body { color: rgb(1, 2, 3); }\n', 'app.js': 'document.body.dataset.app = "1";\n', 'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>' };
  const SEED64 = Object.fromEntries(Object.entries(SEED).map(([k, v]) => ['sitio/' + k, Buffer.from(v, 'utf8').toString('base64')]));
  const node = (name) => '.lmd-tree-box .lmd-node[title=' + J(name) + ']';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-audit-'));
  const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  try {
    await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(home); await page.waitForSelector('.lmd-home');
    await page.evaluate(() => { localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: 'off' })); });
    await page.reload(); await page.waitForSelector('.lmd-home');
    await page.evaluate(async (seed) => {
      const top = await navigator.storage.getDirectory(); const base = await top.getDirectoryHandle('web', { create: true });
      for (const [name, data] of Object.entries(seed)) {
        const parts = name.split('/'); let d = base;
        for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
        const h = await d.getFileHandle(parts[parts.length - 1], { create: true }); const w = await h.createWritable();
        await w.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))); await w.close();
      }
      const dir = await base.getDirectoryHandle('sitio'); window.showDirectoryPicker = async () => dir;
    }, SEED64);
    await page.click('[data-home=dir]'); await page.waitForSelector(node('readme.md'), { state: 'attached' }); await sleep(300);
    const frameOf = async () => { const h = await page.$('iframe.lmd-cv-frame'); return h ? h.contentFrame() : null; };
    const openFile = async (name) => { await page.click(node(name)); await page.waitForSelector('.lmd-article pre code.lmd-cv', { state: 'attached', timeout: 15000 }); await sleep(200); };
    const loaded = (want) => until(async () => { const f = await frameOf(); return f && await f.evaluate((w) => document.readyState === 'complete' && !!document.querySelector(w), want).catch(() => false) ? f : null; }, 12000);

    reset();
    await openFile('dsd.html'); await page.click('.lmd-cv-seg [data-cv=prev]');
    const f = await loaded('#t'); await sleep(2000);
    const d = f ? await f.evaluate(() => ({ url: location.href, roots: [...document.querySelectorAll('*')].filter((n) => n.shadowRoot).length, tpl: [...document.querySelectorAll('template')].map((t) => [t.id, t.hasAttribute('shadowrootmode') || t.hasAttribute('shadowroot')]), live: document.querySelectorAll('iframe[src], iframe[srcdoc], a[href^=http]').length })).catch((e) => String(e)) : null;
    check('estático: un <template shadowrootmode> llega al marco como una plantilla común, sin árbol aparte', !!d && d.url === 'about:srcdoc' && d.roots === 0 && d.tpl.length === 3 && d.tpl.every((t) => !t[1]) && d.live === 0 && (await page.evaluate(() => document.querySelector('iframe.lmd-cv-frame').getAttribute('sandbox'))) === '', d);
    check('y lo que traía adentro no abre ni una conexión ni hace un pedido', out.hits.length === 0 && out.conns === 0, { hits: out.hits, conns: out.conns });
    reset();
    await openFile('muta.html'); const fm = await loaded('#t'); await sleep(2000);
    const dm = fm ? await fm.evaluate(() => ({ url: location.href, live: [...document.querySelectorAll('iframe[src], iframe[srcdoc], link, base[href], a[href^=http], meta[http-equiv=refresh i]')].map((n) => n.outerHTML.slice(0, 80)), first: document.head.firstElementChild.getAttribute('http-equiv') })).catch((e) => String(e)) : null;
    check('estático: un HTML que cambia al escribirse y volver a leerse no deja en el marco nada sin revisar', !!dm && dm.url === 'about:srcdoc' && dm.live.length === 0 && dm.first === 'Content-Security-Policy' && out.hits.length === 0 && out.conns === 0, { dm, hits: out.hits, conns: out.conns });

    // Con scripts: lo que la página consigue leer de su carpeta.
    await openFile('lee.html'); await loaded('#t');
    await page.click('.lmd-cv-note [data-cv=run]');
    const fr = await until(async () => { const x = await frameOf(); return x && await x.evaluate(() => document.body && !!document.body.dataset.r).catch(() => false) ? x : null; }, 12000);
    const Rr = fr ? JSON.parse(await fr.evaluate(() => document.body.dataset.r)) : null;
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/=+$/, '');
    const secrets = ['CLAVE-EN-MD', 'CLAVE-EN-ENV', 'DIARIO-PRIVADO', 'CLAVE-EN-JSON'].concat([SEED['secreto.md'], SEED['.env'], SEED['notas/privada.md']].map((s) => b64(s).slice(0, 16)));
    check('con scripts, la página corre con el origen opaco y con sus recursos de verdad (su hoja de estilos, su script, su imagen)', !!Rr && (await page.evaluate(() => document.querySelector('iframe.lmd-cv-frame').getAttribute('sandbox'))) === 'allow-scripts' && Rr.app === '1' && Rr.color === 'rgb(1, 2, 3)' && Rr.logo === 'data:image/svg+xml;', Rr && [Rr.app, Rr.color, Rr.logo]);
    check('y no consigue el contenido de una nota, de un .env ni de un .json de la carpeta, ni como hoja de estilos, ni como script, ni como imagen', !!Rr && !secrets.some((s) => Rr.all.includes(s)), Rr && secrets.filter((s) => Rr.all.includes(s)));
    check('sin que nada de eso salga a la red', out.hits.length === 0, out.hits);
  } finally {
    await ctx.close(); site.close(); far.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows lo suelta después */ }
  }
});

const bad = done();
process.exit(bad ? 1 : 0);
