// Pruebas sin navegador: parser de bibliografía, citas, ecuaciones numeradas y macros.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0; let pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FALLA:', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' -> ' + JSON.stringify(a));

const win = {};
const ctx = { window: win, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'vendor/markdown-it.min.js'), 'utf8'), ctx);
win.markdownit = ctx.markdownit || vm.runInContext('typeof markdownit === "function" ? markdownit : (typeof globalThis.markdownit !== "undefined" ? globalThis.markdownit : undefined)', ctx);
const LMD = {
  kit: { esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') },
  t: (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s),
};
ctx.LMD = LMD;
for (const f of ['src/markdown.js', 'src/citations.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

// ---- macros
const m = LMD.md.macrosOf([['title', 'x'], ['macros', '\\RR: "\\\\mathbb{R}"\n- \\NN: \'\\mathbb{N}\'\n"\\vec": "\\mathbf"\nmalo: 1\n\\x: \\alpha']]);
eq(m['\\RR'], '\\mathbb{R}', 'macro entre comillas dobles');
eq(m['\\NN'], '\\mathbb{N}', 'macro con guion y comillas simples');
eq(m['\\vec'], '\\mathbf', 'nombre entre comillas');
eq(m['\\x'], '\\alpha', 'sin comillas');
ok(!('malo' in m), 'nombre sin barra se ignora');
eq(Object.keys(LMD.md.macrosOf(null)).length, 0, 'sin cabecera');

// ---- numeración
const nums = LMD.md.numberEquations(['a', 'b', 'a']);
eq([nums.byId.a, nums.byId.b, nums.list.length], [1, 2, 3], 'etiqueta repetida va a la primera');

const parser = LMD.md.buildParser({ katex: true });
const html = parser.render('Ver @eq:uno y \\eqref{dos} y @eq:nada.\n\n$$ a=b $$ {#eq:uno}\n\n$$\nc=d\n$$ {#eq:dos}\n\nmail a@eq:x no.\n');
ok(/data-eq="uno" data-n="1"/.test(html), 'primera ecuacion numerada 1');
ok(/data-eq="dos" data-n="2"/.test(html), 'segunda numerada 2');
ok(/class="lmd-eqref" href="#eq-uno" data-ref="uno">\(1\)</.test(html), '@eq:uno da (1)');
ok(/data-ref="dos" data-form="eqref">\(2\)</.test(html), 'eqref dos da (2)');
ok(/lmd-eqref-bad[^>]*>\(\?\)</.test(html), 'referencia sin definir marcada');
ok(/mail a@eq:x no/.test(html), 'a@eq pegado a una palabra no es referencia');
ok(!/\{#eq:/.test(html), 'la etiqueta no queda en el texto');
const plain = parser.render('$$ a=b $$\n');
ok(!/data-n=/.test(plain), 'sin etiqueta no se numera');

// ---- citas en el Markdown
const h2 = parser.render('Dice [@perez2020, p. 12] y [@a; @b] y [@x](http://z.com) y [texto].');
ok(/data-cite="@perez2020, p. 12"/.test(h2), 'cita con locator');
ok(/data-cite="@a; @b"/.test(h2), 'cita multiple');
ok(/<a href="http:\/\/z.com">@x<\/a>/.test(h2), 'enlace con @ no es cita');

// ---- bibliografía
const C = LMD.cite;
const db = C.parseBib(`
@string{rev = "Revista Uno"}
@comment{nada}
@article{perez2020, author = {P{\\'e}rez, Juan and Mar{\\'i}a G{\\'o}mez}, title = {Un {T}ítulo}, journal = rev, year = 2020, volume = {3}, number = {2}, pages = {1--10}, doi = {10.1/abc}}
@book{smith99, author = "Smith, John A. and Lee, Ann and Wu, Bo", title = {Libro}, publisher = {Ed}, year = {1999}}
@misc{org, author = {{Naciones Unidas}}, title = {Informe largo sobre algo muy particular de la vida}, url = {https://un.org}}
@inproceedings{conf, author = {Ruiz, Ana}, title = {Charla}, booktitle = {Actas}, year = {2021}}
@article{roto, author = {Sin cierre
`);
ok(db.perez2020 && db.smith99 && db.org && db.conf, 'lee los cuatro tipos');
eq(db.perez2020.f.journal, 'Revista Uno', 'usa @string');
eq(C.citeText([{ key: 'perez2020', loc: '' }], db), '(Pérez y Gómez, 2020)', 'dos autores');
eq(C.citeText([{ key: 'smith99', loc: 'p. 4' }], db), '(Smith et al., 1999, p. 4)', 'tres autores y locator');
eq(C.citeText([{ key: 'org', loc: '' }], db), '(Naciones Unidas, s. f.)', 'autor corporativo sin año');
eq(C.citeText([{ key: 'PEREZ2020', loc: '' }], db), '(Pérez y Gómez, 2020)', 'clave sin distinguir mayusculas');
eq(C.citeText([{ key: 'nope', loc: '' }], db), null, 'clave desconocida da null');
eq(C.parseCite('@a, p. 3; @b'), [{ key: 'a', loc: 'p. 3' }, { key: 'b', loc: '' }], 'parseCite');
eq(C.bibFiles('refs.bib'), ['refs.bib'], 'bibFiles uno');
eq(C.bibFiles('[a.bib, "b.bib"]'), ['a.bib', 'b.bib'], 'bibFiles lista');
eq(C.bibFiles('\n- a.bib\n- b.bib'), ['a.bib', 'b.bib'], 'bibFiles guiones');
eq(C.initials('Jean-Pierre Luc'), 'J.-P. L.', 'iniciales con guion');
const two = C.parseBib('@book{a1, author={Gil, A.}, title={Zeta}, year={2000}}\n@book{a2, author={Gil, A.}, title={Alfa}, year={2000}}');
eq([two.a2.suffix, two.a1.suffix], ['a', 'b'], 'sufijos a y b');
const order = C.sortKeys(db).map((e) => e.key);
ok(order.indexOf('org') < order.indexOf('perez2020') && order.indexOf('perez2020') < order.indexOf('conf') && order.indexOf('conf') < order.indexOf('smith99'), 'orden alfabetico por apellido: ' + order);
const refText = (k) => C.refSegments(db[k]).map((s) => s.text).join('');
ok(/^Pérez, J\. y Gómez, M\. \(2020\)\. Un Título\. /.test(refText('perez2020')), 'articulo: ' + refText('perez2020'));
ok(/Revista Uno, 3\(2\), 1-10\./.test(refText('perez2020')) && /https:\/\/doi\.org\/10\.1\/abc$/.test(refText('perez2020')), 'volumen, paginas y doi');
ok(/^Naciones Unidas\. \(s\. f\.\)\./.test(refText('org')) && /https:\/\/un\.org$/.test(refText('org')), 'misc corporativo: ' + refText('org'));
ok(/Charla\. En Actas/.test(refText('conf')), 'inproceedings');
ok(C.refSegments(db.org).some((s) => s.t === 'a'), 'la url es un enlace');
const q = C.quoteBlock('linea uno\nlinea dos', 'mi libro (1).pdf', 7);
ok(q.startsWith('> linea uno\n> linea dos\n>') && q.includes('(mi%20libro%20%281%29.pdf#page=7)') && q.includes('p. 7'), 'bloque de cita: ' + q);
ok(!/[—!]/.test(q), 'sin raya ni exclamacion');
eq(Object.keys(C.parseBib('basura @@ {{{ ')).length, 0, 'basura no rompe');

console.log(fail ? 'FALLARON ' + fail + ' de ' + (pass + fail) : 'OK ' + pass);
process.exit(fail ? 1 : 0);
