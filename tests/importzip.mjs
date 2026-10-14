// Traer notas de Notion u Obsidian (src/importzip.js). Se prueba la parte pura, sin navegador: el lector de zip de
// import.js abre los dos ZIP de ejemplo de tests/fixtures/ y plan() devuelve las notas con sus rutas y enlaces nuevos.
// Los ZIP se regeneran con: node tests/fixtures/make-fixtures.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import { fileURLToPath } from 'url';

// Sin navegador: no importa rig.mjs (que pide playwright), lleva su propia cuenta.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 700))); };
const done = () => { const bad = results.filter((x) => !x).length; console.log('\n' + (results.length - bad) + ' de ' + results.length + ' pruebas pasaron'); if (bad) process.exitCode = 1; };
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

// import.js solo aporta su lector de zip; no necesita página.
const LMD = { t: (s) => s, kit: { el: () => ({}), esc: (s) => s }, tools: { register() {}, isOn: () => false }, home: {}, store: {} };
const sandbox = { LMD, window: {}, document: {}, navigator: {}, DecompressionStream, Blob, TextDecoder, DataView, Uint8Array, AbortController, setTimeout, console };
let loaded = true;
try { vm.runInNewContext(src('import.js'), sandbox); } catch (e) { loaded = false; console.log('  import.js no cargó en el sandbox: ' + e.message); }
check('import.js carga y trae su lector de zip', loaded && !!(LMD.import && LMD.import.kit && LMD.import.kit.unzip));

const mod = { exports: {} };
vm.runInNewContext(src('importzip.js'), { module: mod, LMD: {}, window: {}, document: {}, File: class {}, setTimeout, console, Map, Set });
const Z = mod.exports;
check('importzip.js exporta la parte pura sin navegador', typeof Z.plan === 'function' && typeof Z.parseCsv === 'function');

// Lee un ZIP de ejemplo con el lector de la app: [{ path, text }] para los .md y .csv.
async function open(name) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(root, 'tests', 'fixtures', name)));
  const zip = LMD.import.kit.unzip(bytes, { cancelled: false, unzipped: 0 });
  const out = [];
  for (const n of zip.names()) out.push(/\.(md|csv)$/i.test(n) ? { path: n, text: await zip.text(n) } : { path: n });
  return { out, zip };
}
const byPath = (res) => Object.fromEntries(res.notes.map((n) => [n.path, n.text]));

// ---------- Notion ----------
console.log('Notion');
const nz = await open('notion-export.zip');
check('el ZIP de ejemplo se abre con el lector de la app', nz.out.length === 8);
let r = Z.plan(nz.out, { untitled: 'Sin título' });
check('se detecta como Notion', r.kind === 'notion');
check('la carpeta Export-… de arriba no es nombre', r.root === '');
const paths = r.notes.map((n) => n.path).sort();
check('quita los códigos de 32 letras y números de archivos y carpetas', JSON.stringify(paths) === JSON.stringify(['Inicio.md', 'Inicio/Plan de viaje.md', 'Inicio/Tareas.md', 'Inicio/Tareas/Comprar pasajes.md', 'Sin título.md']), paths.join(' | '));
check('ningún nombre conserva un código', !r.notes.concat(r.assets).some((n) => /[0-9a-f]{32}/i.test(n.path)));
check('la imagen se mueve a su ruta nueva', r.assets.length === 1 && r.assets[0].path === 'Inicio/Plan de viaje/mapa.png', JSON.stringify(r.assets));
check('lo de __MACOSX queda afuera', !r.notes.concat(r.assets).some((n) => /MACOSX|basura/.test(n.path)));
const t = byPath(r);
check('enlace a otra página: ruta nueva, con espacios codificados', t['Inicio.md'].includes('[plan de viaje](Inicio/Plan%20de%20viaje.md)'), t['Inicio.md']);
check('enlace a la base de datos: apunta a su nota', t['Inicio.md'].includes('[tareas](Inicio/Tareas.md)'));
check('enlace de notion.so con el código: pasa a la nota', t['Inicio.md'].includes('[misma página en Notion](Inicio/Plan%20de%20viaje.md)'));
check('un enlace a la web queda como estaba', t['Inicio.md'].includes('[web](https://example.com/a%20b)'));
check('un enlace roto queda como estaba y se cuenta', t['Inicio.md'].includes('(Inicio%20' + '0a1b2c3d4e5f60718293a4b5c6d7e8f9/No%20existe') && r.stats.unresolved === 1, JSON.stringify(r.stats));
check('el código de ejemplo (entre ```) no se toca', t['Inicio.md'].includes('[no se toca](Inicio%200a1b2c3d4e5f60718293a4b5c6d7e8f9/Plan%20de%20viaje%201a1b2c3d4e5f60718293a4b5c6d7e8f9.md)'));
check('la imagen de la página apunta a la ruta nueva', t['Inicio/Plan de viaje.md'].includes('![mapa](Plan%20de%20viaje/mapa.png)'), t['Inicio/Plan de viaje.md']);
check('el enlace de vuelta sube una carpeta y conserva el ancla', t['Inicio/Plan de viaje.md'].includes('[Inicio](../Inicio.md#arriba)'));
const tasks = t['Inicio/Tareas.md'];
check('la base de datos es una nota con título y tabla', tasks.startsWith('# Tareas\n\n| Nombre | Estado | Responsable |\n|---|---|---|\n'), tasks);
check('usa el CSV de la vista y no el _all', !tasks.includes('Notas'));
check('una coma entre comillas queda en su celda', tasks.includes('| Reservar, hotel | Pendiente | Luis |'));
check('la barra de una celda va escapada y el salto pasa a <br>', tasks.includes('Con \\| barra') && tasks.includes('dos<br>líneas'), tasks);
check('el título de cada fila se enlaza a su página', tasks.includes('| [Comprar pasajes](Tareas/Comprar%20pasajes.md) | Hecho | Ana |'), tasks);
check('cuenta lo importado', r.stats.notes === 4 && r.stats.dbs === 1 && r.stats.assets === 1 && r.stats.tableRows === 3, JSON.stringify(r.stats));
// Sin la carpeta de arriba y forzando el tipo.
const bare = nz.out.filter((f) => !/MACOSX/.test(f.path)).map((f) => ({ path: f.path.replace(/^Export-[^/]+\//, ''), text: f.text }));
const r2 = Z.plan(bare, { kind: 'notion' });
check('lo mismo sin la carpeta de arriba', JSON.stringify(r2.notes.map((n) => n.path).sort()) === JSON.stringify(paths.map((p) => (p === 'Sin título.md' ? 'Untitled.md' : p))));
check('el nombre de una página sin título se pasa de afuera', Z.plan(bare, { untitled: 'Sin nombre' }).notes.some((n) => n.path === 'Sin nombre.md'));
// Nombres que chocan.
const clash = Z.plan([{ path: 'A 0a1b2c3d4e5f60718293a4b5c6d7e8f9.md', text: 'uno' }, { path: 'A 1a1b2c3d4e5f60718293a4b5c6d7e8f9.md', text: 'dos' }], { kind: 'notion' });
check('dos páginas con el mismo título no se pisan', clash.notes.map((n) => n.path).sort().join('|') === 'A 2.md|A.md', clash.notes.map((n) => n.path).join('|'));
check('un tope de filas corta la tabla y lo cuenta', (() => {
  const big = 'a,b\n' + Array.from({ length: 10 }, (x, i) => i + ',x').join('\n') + '\n';
  const q = Z.plan([{ path: 'B 0a1b2c3d4e5f60718293a4b5c6d7e8f9.csv', text: big }], { kind: 'notion', maxRows: 4 });
  return q.stats.rowsCut === 6 && q.notes[0].text.split('\n').filter((l) => l.startsWith('| ')).length === 5;
})());

// ---------- Obsidian ----------
console.log('Obsidian');
const vz = await open('obsidian-vault.zip');
const v = Z.plan(vz.out, {});
check('se detecta como bóveda por su .obsidian', v.kind === 'vault');
check('la carpeta de arriba es el nombre sugerido', v.root === 'Mi Boveda');
check('.obsidian/ se ignora', !v.notes.concat(v.assets).some((n) => /obsidian/.test(n.path)) && v.ignored === 2, String(v.ignored));
check('las notas y los adjuntos quedan donde estaban', v.notes.map((n) => n.path).sort().join('|') === 'Diario/2026-10-13.md|Notas/Idea.md' && v.assets.map((a) => a.path).sort().join('|') === 'Adjuntos/audio.mp3|Adjuntos/captura.png');
const d = byPath(v)['Diario/2026-10-13.md'];
check('el front matter queda igual', d.startsWith('---\ntags: [diario, ideas]\nfecha: 2026-10-13\n---\n'));
check('los [[enlaces]] quedan, con alias y sección', d.includes('[[Idea]]') && d.includes('[[Idea|mi idea]]') && d.includes('[[Idea#Detalle]]'));
check('![[imagen.png]] pasa a una imagen de Markdown con la ruta relativa', d.includes('![captura](../Adjuntos/captura.png)'), d);
check('el tamaño (|300) se descarta y un texto se usa de alt', !d.includes('|300') && d.includes('![Una captura](../Adjuntos/captura.png)'));
check('un audio incrustado pasa a un enlace', d.includes('[audio.mp3](../Adjuntos/audio.mp3)'));
check('una nota incrustada queda como enlace', d.includes('\n[[Idea]]\n') && !d.includes('![[Idea]]'));
check('un adjunto que falta queda como estaba y se cuenta', d.includes('![[falta.png]]') && v.stats.embedsMissing === 1);
check('el código no se toca', d.includes('`![[en-codigo.png]]`') && d.includes('```\n![[captura.png]]\n```'));
check('cuenta los enlaces que no encuentran su nota', v.stats.wikiMissing === 1 && v.stats.embeds === 4, JSON.stringify(v.stats));
const fromFolder = Z.plan(vz.out.map((f) => ({ path: f.path.replace(/^Mi Boveda\//, ''), text: f.text })), { kind: 'vault' });
check('sin la carpeta de arriba da lo mismo', JSON.stringify(fromFolder.notes.map((n) => n.path)) === JSON.stringify(v.notes.map((n) => n.path)));

// ---------- Piezas ----------
console.log('Piezas');
check('cleanSeg: un nombre que era solo el código se llama como se pida', Z.cleanSeg('4a1b2c3d4e5f60718293a4b5c6d7e8f9.md', 'Sin título') === 'Sin título.md');
check('cleanSeg: no toca un nombre con 31 letras y números', Z.cleanSeg('Nota ' + 'a'.repeat(31) + '.md', 'X') === 'Nota ' + 'a'.repeat(31) + '.md');
check('resolve: no sale de la raíz', Z.resolve('a/', '../../x.md') === null && Z.resolve('a/b/', '../c.md') === 'a/c.md');
check('relative: sube y baja carpetas', Z.relative('a/b/', 'a/c/d.md') === '../c/d.md' && Z.relative('', 'x/y.md') === 'x/y.md');
check('parseCsv: comillas, comas y saltos', JSON.stringify(Z.parseCsv('a,"b,c","d""e"\r\n"f\ng",h,\n')) === JSON.stringify([['a', 'b,c', 'd"e'], ['f\ng', 'h', '']]));
check('mapProse: no toca el front matter ni el código', Z.mapProse('---\nx: 1\n---\nuno `dos` tres\n```\ncuatro\n```\ncinco', (s) => s.toUpperCase()) === '---\nx: 1\n---\nUNO `dos` TRES\n```\ncuatro\n```\nCINCO');
const all = r.notes.concat(v.notes).map((n) => n.text).join('\n') + fs.readFileSync(path.join(root, 'src', 'importzip.js'), 'utf8');
check('sin signos de exclamación en el texto ni rayas largas en el código', !/[—–]/.test(all) && !/'[^'\n]*[A-Za-zñáéíóú]!(?:\s|'|$)/.test(fs.readFileSync(path.join(root, 'src', 'importzip.js'), 'utf8')));

done();
