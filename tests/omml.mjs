// MathML a OMML: prueba pura de node, sin navegador. KaTeX (el del repo) da el MathML de cada fórmula.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const katex = require('../vendor/katex/katex.min.js');
const omml = require('../src/omml.js');

const conv = (tex, display) => {
  const html = katex.renderToString(tex, { output: 'mathml', displayMode: !!display, throwOnError: true });
  return omml.fromMathML(html, { display });
};
const has = (tex, ...bits) => {
  const o = conv(tex);
  assert.ok(o, 'no convierte: ' + tex);
  for (const b of bits) assert.ok(o.includes(b), tex + ' deberia contener ' + b + '\n' + o);
  return o;
};

has('\\frac{a}{b}', '<m:f>', '<m:num>', '<m:den>');
has('x^2', '<m:sSup>');
has('x_i', '<m:sSub>');
has('x_i^2', '<m:sSubSup>');
has('\\sqrt{x}', '<m:rad>', '<m:degHide m:val="1"/>');
has('\\sqrt[3]{x}', '<m:rad>', '<m:deg><m:r>');
has('\\sum_{i=1}^{n} i', '<m:nary>', 'm:val="∑"', '<m:sub>', '<m:sup>');
has('\\int_0^1 x\\,dx', '<m:nary>', 'm:val="∫"');
has('\\left(\\frac{a}{b}\\right)', '<m:d>', 'm:begChr m:val="("');
has('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '<m:d>', '<m:m>', '<m:mr>');
assert.ok(conv('\\lim_{x\\to 0} f(x)', true).includes('<m:limLow>'));
has('\\underset{a}{b}', '<m:limLow>');
has('\\hat{x}', '<m:acc>');
has('\\overline{x}', '<m:bar>');
has('\\sin x', 'm:sty m:val="p"');

// el cuerpo de una sumatoria queda dentro del nary, no al lado
const s = conv('\\sum_{i=1}^{n} a_i + b');
assert.match(s, /<m:nary>[\s\S]*<m:e>[\s\S]*<m:sSub>[\s\S]*<\/m:nary>/);
assert.ok(s.indexOf('</m:nary>') < s.lastIndexOf('>b<'), 'lo que viene tras el + queda fuera');

// bloque: oMathPara; en línea: oMath pelado
assert.ok(conv('x', true).startsWith('<m:oMathPara><m:oMath>'));
assert.ok(conv('x', false).startsWith('<m:oMath>'));

// escape de caracteres
assert.ok(conv('a < b').includes('&lt;'));

// lo que no se sabe convertir devuelve null (y docx.js dibuja la imagen)
assert.equal(omml.fromMathML('<math><mmultiscripts><mi>a</mi></mmultiscripts></math>'), null);
assert.equal(omml.fromMathML('no es mathml'), null);
assert.equal(omml.fromMathML(''), null);

// todo XML bien formado
const bien = (xml) => {
  const t = [];
  for (const m of xml.matchAll(/<(\/?)([\w:]+)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) assert.equal(t.pop(), m[2], 'mal cerrado: ' + xml); else t.push(m[2]);
  }
  assert.equal(t.length, 0);
};
for (const tex of ['\\frac{1}{2}', '\\sum_{k=0}^\\infty \\frac{x^k}{k!}', '\\begin{cases} a & b \\\\ c & d \\end{cases}', '\\sqrt{x^2+y^2}', '\\mathbb{R}']) bien(conv(tex, true));
console.log('omml ok');
