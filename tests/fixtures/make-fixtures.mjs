// Arma los dos ZIP de ejemplo de tests/importzip.mjs: una exportación de Notion ("Markdown y CSV") y una bóveda de
// Obsidian. Son chicos a propósito. Se vuelven a generar con: node tests/fixtures/make-fixtures.mjs
import fs from 'fs'; import path from 'path'; import zlib from 'zlib'; import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const crc = (buf) => zlib.crc32(buf) >>> 0;

// Un ZIP mínimo, comprimido con deflate, con la fecha fija para que el archivo salga igual cada vez.
function zip(files) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8'); const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const comp = zlib.deflateRawSync(raw); const sum = crc(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(0, 10); head.writeUInt16LE(0x21, 12); head.writeUInt32LE(sum, 14); head.writeUInt32LE(comp.length, 18);
    head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28);
    parts.push(head, nameBuf, comp);
    const ent = Buffer.alloc(46);
    ent.writeUInt32LE(0x02014b50, 0); ent.writeUInt16LE(20, 4); ent.writeUInt16LE(20, 6); ent.writeUInt16LE(0x0800, 8); ent.writeUInt16LE(8, 10);
    ent.writeUInt16LE(0, 12); ent.writeUInt16LE(0x21, 14); ent.writeUInt32LE(sum, 16); ent.writeUInt32LE(comp.length, 20);
    ent.writeUInt32LE(raw.length, 24); ent.writeUInt16LE(nameBuf.length, 28); ent.writeUInt32LE(offset, 42);
    central.push(ent, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

// Un PNG de 1x1 píxel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ---------- Notion ----------
const ID_HOME = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const ID_PLAN = '1a1b2c3d4e5f60718293a4b5c6d7e8f9';
const ID_TASKS = '2a1b2c3d4e5f60718293a4b5c6d7e8f9';
const ID_ROW = '3a1b2c3d4e5f60718293a4b5c6d7e8f9';
const ID_LOOSE = '4a1b2c3d4e5f60718293a4b5c6d7e8f9';
const R = 'Export-9f8e7d6c-5b4a-4321-8765-0123456789ab/';
const notion = [
  [R + `Inicio ${ID_HOME}.md`, `# Inicio

Mirá el [plan de viaje](Inicio%20${ID_HOME}/Plan%20de%20viaje%20${ID_PLAN}.md) y la base de [tareas](Inicio%20${ID_HOME}/Tareas%20${ID_TASKS}.csv).

Una [web](https://example.com/a%20b) y la [misma página en Notion](https://www.notion.so/Plan-de-viaje-${ID_PLAN}?pvs=4).

Un enlace roto: [nada](Inicio%20${ID_HOME}/No%20existe%20${ID_LOOSE}.md).

\`\`\`
[no se toca](Inicio%20${ID_HOME}/Plan%20de%20viaje%20${ID_PLAN}.md)
\`\`\`
`],
  [R + `Inicio ${ID_HOME}/Plan de viaje ${ID_PLAN}.md`, `# Plan de viaje

![mapa](Plan%20de%20viaje%20${ID_PLAN}/mapa.png)

Volver a [Inicio](../Inicio%20${ID_HOME}.md#arriba).
`],
  [R + `Inicio ${ID_HOME}/Plan de viaje ${ID_PLAN}/mapa.png`, PNG],
  [R + `Inicio ${ID_HOME}/Tareas ${ID_TASKS}.csv`, 'Nombre,Estado,Responsable\nComprar pasajes,Hecho,Ana\n"Reservar, hotel",Pendiente,Luis\nCon | barra,Hecho,"dos\nlíneas"\n'],
  [R + `Inicio ${ID_HOME}/Tareas ${ID_TASKS}_all.csv`, 'Nombre,Estado,Responsable,Notas\nComprar pasajes,Hecho,Ana,x\n'],
  [R + `Inicio ${ID_HOME}/Tareas ${ID_TASKS}/Comprar pasajes ${ID_ROW}.md`, '# Comprar pasajes\n\nEstado: Hecho\n'],
  [R + `${ID_LOOSE}.md`, 'Una página sin título.\n'],
  [R + '__MACOSX/._basura', 'x'],
];

// ---------- Obsidian ----------
const V = 'Mi Boveda/';
const vault = [
  [V + '.obsidian/app.json', '{"promptDelete":false}'],
  [V + '.obsidian/workspace.json', '{}'],
  [V + 'Diario/2026-10-13.md', `---
tags: [diario, ideas]
fecha: 2026-10-13
---

# Martes

Hoy pensé en [[Idea]] y en [[Idea|mi idea]]. También en [[Idea#Detalle]] y en [[No existe]].

![[captura.png]]

![[captura.png|300]]

![[captura.png|Una captura]]

![[audio.mp3]]

![[Idea]]

![[falta.png]]

\`![[en-codigo.png]]\`

\`\`\`
![[captura.png]]
\`\`\`
`],
  [V + 'Notas/Idea.md', '# Idea\n\n## Detalle\n\nTexto.\n'],
  [V + 'Adjuntos/captura.png', PNG],
  [V + 'Adjuntos/audio.mp3', Buffer.from('ID3')],
];

fs.writeFileSync(path.join(here, 'notion-export.zip'), zip(notion));
fs.writeFileSync(path.join(here, 'obsidian-vault.zip'), zip(vault));
console.log('listo: notion-export.zip y obsidian-vault.zip');
