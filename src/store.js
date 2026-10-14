// Permisos de archivos y carpetas (File System Access), guardados en IndexedDB para no volver a pedirlos.
(function () {
  'use strict';

  function handlesDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('lmd-permisos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('h', { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function handlesAll() {
    try {
      const db = await handlesDb();
      return await new Promise((resolve, reject) => {
        const q = db.transaction('h').objectStore('h').getAll();
        q.onsuccess = () => resolve(q.result || []); q.onerror = () => reject(q.error);
      });
    } catch (e) { return []; }
  }
  async function handlesGet(key) {
    try {
      const db = await handlesDb();
      return await new Promise((resolve, reject) => {
        const q = db.transaction('h').objectStore('h').get(key);
        q.onsuccess = () => resolve(q.result || null); q.onerror = () => reject(q.error);
      });
    } catch (e) { return null; }
  }
  async function handlesPut(rec) {
    try {
      const db = await handlesDb();
      await new Promise((resolve, reject) => {
        const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(rec);
        t.oncomplete = resolve; t.onerror = () => reject(t.error);
      });
      return true;
    } catch (e) { return false; }
  }

  async function canWrite(handle, ask) {
    try {
      if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
      if (!ask) return false;
      return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch (e) { return false; }
  }

  async function walk(dir, parts) {
    let cur = dir;
    for (let k = 0; k < parts.length - 1; k++) cur = await cur.getDirectoryHandle(parts[k]);
    return cur.getFileHandle(parts[parts.length - 1]);
  }

  async function handlesDelete(key) {
    try {
      const db = await handlesDb();
      await new Promise((resolve) => { const t = db.transaction('h', 'readwrite'); t.objectStore('h').delete(key); t.oncomplete = resolve; t.onerror = resolve; });
    } catch (e) { /* queda guardado */ }
  }

  // Lo abierto desde la página propia: carpetas y archivos recientes, del más nuevo al más viejo.
  const rootsAll = async () => (await handlesAll()).filter((r) => r.root).sort((a, b) => (b.at || 0) - (a.at || 0));

  // Notas guardadas en el navegador: no necesitan carpeta ni cuenta, y siguen ahí al cerrar la pestaña.
  const noteKey = (name) => 'note:' + name;
  const notesAll = async () => (await handlesAll()).filter((r) => r.note).sort((a, b) => (b.at || 0) - (a.at || 0));
  const noteGet = async (name) => (await handlesAll()).find((r) => r.note && r.name === name) || null;
  const notePut = (name, text) => handlesPut({ key: noteKey(name), note: true, name, text, at: Date.now() });
  const noteDelete = (name) => handlesDelete(noteKey(name));
  // Se comporta como un archivo del disco, para que leer y guardar pasen por el mismo camino.
  function noteHandle(name) {
    return {
      kind: 'file', name,
      queryPermission: async () => 'granted',
      getFile: async () => { const r = await noteGet(name); if (!r) throw new Error('missing'); return { text: async () => r.text, lastModified: r.at, size: r.text.length }; },
      createWritable: async () => { let data = ''; return { write: async (t) => { data = String(t); }, close: async () => { await LMD.store.notePut(name, data); } }; }, // por LMD.store: el puente con la extensión se entera
    };
  }

  // Copia de cada nota de la nube que se abrió o se guardó, por cuenta, para abrirla sin conexión.
  // text es lo último escrito acá, base lo último que se supo del servidor, y pending marca lo que falta subir.
  const cloudKey = (who, path) => 'cloud:' + who + ':' + path;
  const cloudAll = async (who) => (await handlesAll()).filter((r) => r.cloud && r.who === who);
  const cloudGet = (who, path) => handlesGet(cloudKey(who, path));
  const cloudPut = (who, path, rec) => handlesPut(Object.assign({}, rec, { key: cloudKey(who, path), cloud: true, who, path, at: Date.now() }));
  const cloudDelete = (who, path) => handlesDelete(cloudKey(who, path));

  // Carpetas con contraseña de la nube. Lo que el servidor sabe de cada una (para poder abrirlas sin conexión) y,
  // si la persona eligió "Recordar en este dispositivo", la llave de cifrado: una CryptoKey que no se puede exportar.
  const vaultsGet = async (who) => { const r = await handlesGet('vaults:' + who); return r ? r.list : null; };
  const vaultsPut = (who, list) => handlesPut({ key: 'vaults:' + who, vaults: true, who, list });
  const vkeyKey = (who, check) => 'vkey:' + who + ':' + check;
  const vkeyGet = async (who, check) => { const r = await handlesGet(vkeyKey(who, check)); return r ? r.cryptoKey : null; };
  const vkeyPut = (who, check, cryptoKey) => handlesPut({ key: vkeyKey(who, check), vkey: true, who, cryptoKey });
  const vkeyDelete = (who, check) => handlesDelete(vkeyKey(who, check));
  const vkeyClear = async (who) => { for (const r of await handlesAll()) if ((r.vkey || r.vaults) && r.who === who) await handlesDelete(r.key); };

  // La conexión del asistente de IA (aikey.js): proveedor, modelo y la clave cifrada. Es de este dispositivo: no es
  // una nota ni una carpeta, así que el puente con la extensión y la nube no la ven.
  const aiGet = () => handlesGet('ai:key');
  const aiPut = (rec) => handlesPut(Object.assign({}, rec, { key: 'ai:key', ai: true }));
  const aiDelete = () => handlesDelete('ai:key');

  // Archivos abiertos como copia, sin acceso al disco (Firefox, Safari, o un texto recién importado): viven en la
  // sesión de la pestaña. 'mdt-mem' es el que está a la vista; los demás esperan en 'lmd-mem-more' para volver a él.
  const memRead = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const memMore = () => { const m = memRead('lmd-mem-more'); return Array.isArray(m) ? m.filter((x) => x && typeof x.name === 'string') : []; };
  const memSave = (list) => { try { if (list.length) sessionStorage.setItem('lmd-mem-more', JSON.stringify(list)); else sessionStorage.removeItem('lmd-mem-more'); return true; } catch (e) { return false; } };
  const memNow = () => { const m = memRead('mdt-mem'); return m && typeof m.name === 'string' ? m : null; };
  const memAll = () => { const cur = memNow(); return (cur ? [cur] : []).concat(memMore().filter((m) => !cur || m.name !== cur.name)); };
  // Antes de poner otro a la vista, el que estaba pasa a la espera. name: el que entra (no se guarda dos veces).
  function memKeep(name) {
    const cur = memNow(); if (!cur || cur.name === name) return;
    memSave(memMore().filter((m) => m.name !== cur.name && m.name !== name).concat([cur]));
  }
  // Trae a la vista uno que estaba esperando. Devuelve lo guardado, o null si no está.
  function memTake(name) {
    const cur = memNow(); if (cur && cur.name === name) return cur;
    const more = memMore(); const hit = more.find((m) => m.name === name); if (!hit) return null;
    const rest = more.filter((m) => m.name !== name); if (cur) rest.push(cur);
    try { sessionStorage.setItem('mdt-mem', JSON.stringify(hit)); } catch (e) { return null; }
    memSave(rest);
    return hit;
  }
  function memDrop(name) {
    const cur = memNow(); if (cur && cur.name === name) { try { sessionStorage.removeItem('mdt-mem'); } catch (e) { /* sin sesión */ } }
    memSave(memMore().filter((m) => m.name !== name));
  }

  // Los archivos del disco abiertos por enlace (los lee la extensión, sin permiso propio): la lista de sus direcciones,
  // para que sigan en "Abiertos" al volver. Clave nueva; no guarda el texto.
  const FS_MAX = 40;
  const fsOpenAll = () => new Promise((resolve) => { try { chrome.storage.local.get('openFs', (r) => { void chrome.runtime.lastError; resolve(Array.isArray(r && r.openFs) ? r.openFs.filter((f) => typeof f === 'string') : []); }); } catch (e) { resolve([]); } });
  const fsOpenSet = (list) => new Promise((resolve) => { try { chrome.storage.local.set({ openFs: list.slice(-FS_MAX) }, () => { void chrome.runtime.lastError; resolve(); }); } catch (e) { resolve(); } });
  const fsOpenAdd = async (f) => { const all = await fsOpenAll(); if (all.includes(f)) return false; await fsOpenSet(all.concat([f])); return true; };
  const fsOpenDrop = async (f) => { const all = await fsOpenAll(); if (!all.includes(f)) return false; await fsOpenSet(all.filter((x) => x !== f)); return true; };

  // Se abrió o se cerró algo: las otras pestañas se enteran por el cambio de esta marca (no guarda nada más).
  let openMark = '';
  const openBump = () => { openMark = Date.now() + ':' + Math.random().toString(36).slice(2, 8); try { chrome.storage.local.set({ openRev: openMark }); } catch (e) { /* queda para esta pestaña */ } };
  // Si esa marca la puso esta misma pestaña (que ya redibujó su lista).
  const openMine = (mark) => !!mark && mark === openMark;

  LMD.store = { memAll, memKeep, memTake, memDrop, fsOpenAll, fsOpenAdd, fsOpenDrop, openBump, openMine, handlesAll, handlesPut, handlesDelete, canWrite, walk, rootsAll, notesAll, noteGet, notePut, noteDelete, noteHandle, cloudAll, cloudGet, cloudPut, cloudDelete, vaultsGet, vaultsPut, vkeyGet, vkeyPut, vkeyDelete, vkeyClear, aiGet, aiPut, aiDelete };
})();
