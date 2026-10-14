// EPUB: la estructura del libro, sin navegador. Se arma con el zip de docx.js (con un LMD mínimo) y se revisa por dentro.
import { createRequire } from 'node:module';
import assertStrict from 'node:assert/strict';
// Cuenta cada aserción que se ejecuta, para dar el total al final como las otras pruebas.
let pasaron = 0;
const assert = new Proxy(assertStrict, { get: (t, k) => (typeof t[k] === 'function' ? (...a) => { const r = t[k](...a); pasaron++; return r; } : t[k]) });
const require = createRequire(import.meta.url);
globalThis.LMD = { t: (s) => s, kit: { el() {} }, lang: () => 'es' };
const epub = require('../src/epub.js');
let zip = null;
try { require('../src/docx.js'); zip = globalThis.LMD.docx && globalThis.LMD.docx.zip; } catch (e) { zip = null; }

// Un zip de mentira que solo anota los archivos, para revisar el contenido sin descomprimir.
const seen = [];
const fake = async (files) => { seen.push(...files); return new Uint8Array(0); };
const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1, 2, 3]);
const book = {
  title: 'Mi libro & más', author: 'Ana <Pérez>', lang: 'es', id: epub.uuid(), modified: '2026-10-14T10:20:30.123Z', indexTitle: 'Índice',
  chapters: [
    { title: 'Uno', body: '<section xmlns="http://www.w3.org/1999/xhtml"><h1>Uno</h1><p>Hola <a href="chapter2.xhtml">dos</a><img src="images/img1.png" alt="x"/></p></section>' },
    { title: 'Dos & tres', body: '<section xmlns="http://www.w3.org/1999/xhtml"><h1>Dos</h1><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></section>', math: true },
  ],
  images: [{ file: 'images/img1.png', type: 'image/png', data: png }],
};
await epub.build(book, fake);
const by = Object.fromEntries(seen.map((f) => [f.name, f]));
const text = (n) => new TextDecoder().decode(by[n].data);

assert.equal(seen[0].name, 'mimetype');
assert.equal(seen[0].store, true);
assert.equal(text('mimetype'), 'application/epub+zip');
for (const n of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/titlepage.xhtml', 'OEBPS/chapter1.xhtml', 'OEBPS/chapter2.xhtml', 'OEBPS/style.css', 'OEBPS/images/img1.png']) assert.ok(by[n], 'falta ' + n);

const opf = text('OEBPS/content.opf');
assert.match(opf, /version="3\.0"/);
assert.match(opf, /<dc:title>Mi libro &amp; más<\/dc:title>/);
assert.match(opf, /<dc:creator>Ana &lt;Pérez&gt;<\/dc:creator>/);
assert.match(opf, /<meta property="dcterms:modified">2026-10-14T10:20:30Z<\/meta>/);
assert.match(opf, /properties="nav"/);
assert.match(opf, /id="chapter2"[^>]*properties="mathml"/);
assert.match(opf, /<item id="img1" href="images\/img1\.png" media-type="image\/png"\/>/);
assert.ok(opf.indexOf('idref="chapter1"') < opf.indexOf('idref="chapter2"'), 'capítulos en orden');
assert.ok(by['OEBPS/images/img1.png'].store);
const navx = text('OEBPS/nav.xhtml');
assert.match(navx, /epub:type="toc"/);
assert.ok(navx.indexOf('chapter1.xhtml') < navx.indexOf('chapter2.xhtml'));
assert.match(navx, /Dos &amp; tres/);

// Todo el XML bien formado (etiquetas balanceadas; las vacías cierran solas).
const bien = (name, xml) => {
  const stack = [];
  for (const m of xml.replace(/<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g, '').matchAll(/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], name + ' mal cerrado en ' + m[2]); else stack.push(m[2]);
  }
  assert.equal(stack.length, 0, name + ' quedó abierto: ' + stack.join(','));
};
for (const n of Object.keys(by)) if (/\.(xml|opf|xhtml)$/.test(n)) bien(n, text(n));

// Con el zip real: el mimetype es lo primero del archivo y va sin comprimir.
if (zip) {
  const bytes = await epub.build(book, zip);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint16(8, true), 0, 'mimetype sin comprimir');
  assert.equal(dv.getUint16(28, true), 0, 'sin campo extra');
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 38)), 'mimetype');
  assert.equal(new TextDecoder().decode(bytes.subarray(38, 38 + 20)), 'application/epub+zip');
} else console.log('epub: sin zip real, se probó con el de mentira');
console.log(pasaron + ' de ' + pasaron + ' pruebas pasaron');
