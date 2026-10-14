// Exportar a EPUB 3. Arma el libro (mimetype primero y sin comprimir, container.xml, content.opf, nav.xhtml, un XHTML por
// capítulo, imágenes y hoja de estilo) y lo empaqueta con el zip de docx.js. No toca la página: recibe el libro ya
// resuelto (títulos, XHTML de cada capítulo e imágenes con sus bytes) y devuelve los bytes del .epub. folderexport.js
// es quien lee la carpeta y arma ese libro. Corre igual en node (tests/epub.mjs), pasándole un zip de prueba.
(function () {
  'use strict';

  const x = (s) => String(s == null ? '' : s).replace(/[^\x09\x0A\x0D\x20-퟿-�\uD800-\uDFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const utf8 = (s) => new TextEncoder().encode(s);
  const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const NS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"';
  const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
  const extOf = (t) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' }[t] || '');

  const CSS = 'body{font-family:serif;line-height:1.5;margin:0 5%}h1,h2,h3,h4,h5,h6{font-family:sans-serif;line-height:1.25;page-break-after:avoid}' +
    'h1{font-size:1.7em;margin:1.2em 0 .6em}p{margin:.7em 0;text-align:left}img,svg{max-width:100%;height:auto}' +
    'pre,code{font-family:monospace;font-size:.88em}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f1;padding:.6em .8em;border-radius:3px}' +
    'blockquote{margin:.8em 0;padding:0 0 0 1em;border-left:3px solid #c9c6bc;color:#444}table{border-collapse:collapse;margin:1em 0;max-width:100%}' +
    'th,td{border:1px solid #bbb;padding:.3em .55em;text-align:left}th{background:#eeede8}hr{border:0;border-top:1px solid #c9c6bc;margin:1.6em 0}' +
    'nav ol{list-style:none;padding-left:0}nav li{margin:.5em 0}.title{margin-top:30%;text-align:center}.title h1{font-size:2.2em}.title p{font-size:1.15em;color:#555}';

  function page(title, lang, body, css) {
    return XML + '<!DOCTYPE html>\n<html ' + NS + ' lang="' + x(lang) + '" xml:lang="' + x(lang) + '"><head><meta charset="utf-8"/><title>' + x(title) + '</title>' +
      '<link rel="stylesheet" type="text/css" href="' + css + '"/></head><body>' + body + '</body></html>';
  }

  // book: { title, author, lang, id, modified, index, indexTitle, chapters: [{ title, body, math, svg }], images: [{ file, type, data }] }
  // zip: la función de docx.js (files -> bytes).
  async function build(book, zip) {
    const lang = book.lang || 'es';
    const chapters = book.chapters.map((c, i) => Object.assign({ file: 'chapter' + (i + 1) + '.xhtml', id: 'chapter' + (i + 1) }, c));
    const files = [];
    const add = (name, data, store) => files.push({ name, data: typeof data === 'string' ? utf8(data) : data, store: !!store });

    add('mimetype', 'application/epub+zip', true); // el primero y sin comprimir: así lo piden los lectores
    add('META-INF/container.xml', XML + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    add('OEBPS/style.css', CSS);

    // La portada del libro: título y autor.
    add('OEBPS/titlepage.xhtml', page(book.title, lang, '<section epub:type="titlepage" class="title"><h1>' + x(book.title) + '</h1>' + (book.author ? '<p>' + x(book.author) + '</p>' : '') + '</section>', 'style.css'));
    // El índice: la navegación de EPUB 3, con un renglón por capítulo.
    const li = chapters.map((c) => '<li><a href="' + c.file + '">' + x(c.title) + '</a></li>').join('');
    const nav = '<nav epub:type="toc" id="toc"><h1>' + x(book.indexTitle || 'Índice') + '</h1><ol>' + li + '</ol></nav>' +
      '<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="titlepage" href="titlepage.xhtml">' + x(book.title) + '</a></li>' + (chapters.length ? '<li><a epub:type="bodymatter" href="' + chapters[0].file + '">' + x(chapters[0].title) + '</a></li>' : '') + '</ol></nav>';
    add('OEBPS/nav.xhtml', page(book.indexTitle || 'Índice', lang, nav, 'style.css'));
    chapters.forEach((c) => add('OEBPS/' + c.file, page(c.title, lang, c.body, 'style.css')));
    (book.images || []).forEach((im) => add('OEBPS/' + im.file, im.data, true)); // ya vienen comprimidas

    const props = (c) => [c.math ? 'mathml' : '', c.svg ? 'svg' : ''].filter(Boolean).join(' ');
    const manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      '<item id="css" href="style.css" media-type="text/css"/>',
      '<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>']
      .concat(chapters.map((c) => '<item id="' + c.id + '" href="' + c.file + '" media-type="application/xhtml+xml"' + (props(c) ? ' properties="' + props(c) + '"' : '') + '/>'))
      .concat((book.images || []).map((im, i) => '<item id="img' + (i + 1) + '" href="' + x(im.file) + '" media-type="' + x(im.type) + '"/>'));
    const spine = ['<itemref idref="titlepage"/>', '<itemref idref="nav"/>'].concat(chapters.map((c) => '<itemref idref="' + c.id + '"/>'));
    const modified = (book.modified || new Date().toISOString()).replace(/\.\d+Z$/, 'Z');
    add('OEBPS/content.opf', XML + '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="' + x(lang) + '"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:identifier id="bookid">' + x(book.id) + '</dc:identifier><dc:title>' + x(book.title) + '</dc:title><dc:language>' + x(lang) + '</dc:language>' +
      (book.author ? '<dc:creator>' + x(book.author) + '</dc:creator>' : '') + '<meta property="dcterms:modified">' + x(modified) + '</meta></metadata>' +
      '<manifest>' + manifest.join('') + '</manifest><spine>' + spine.join('') + '</spine></package>');
    return zip(files);
  }

  const uuid = () => {
    const b = new Uint8Array(16);
    (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(b);
    b[6] = (b[6] & 0x0F) | 0x40; b[8] = (b[8] & 0x3F) | 0x80;
    const h = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
    return 'urn:uuid:' + [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
  };

  const api = { build, uuid, extOf, TYPES, CSS };
  if (typeof LMD !== 'undefined') LMD.epub = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
