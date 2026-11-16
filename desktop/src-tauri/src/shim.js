// SharpMD for Windows, macOS and Linux: the app is the same page as sharpmd.app, and this script gives it the disk.
// It replaces the browser's File System Access pickers and handles with native ones: no permission prompt on every
// launch, the same API on macOS and Linux (whose webviews have none), atomic saves, and files opened from the system (double
// click, "Open with", a second launch) land in the open app. The native side only touches what the person picked.
(function () {
  'use strict';
  if (location.hostname !== 'sharpmd.app' || !window.__TAURI_INTERNALS__ || window.__smdDesktop) return;
  const invoke = (cmd, args, opt) => window.__TAURI_INTERNALS__.invoke(cmd, args, opt);
  const WIN = /Windows/i.test(navigator.userAgent);
  const SEP = WIN ? '\\' : '/';

  const fail = (e) => {
    const s = String((e && e.message) || e || '');
    const m = /^(NotFoundError|TypeMismatchError|NotAllowedError|InvalidModificationError|AbortError|NoModificationAllowedError):?\s*(.*)$/.exec(s);
    return new DOMException(m ? m[2] || m[1] : s, m ? m[1] : 'NotReadableError');
  };
  const call = (cmd, args, opt) => invoke(cmd, args, opt).catch((e) => { throw fail(e); });
  const childName = (name) => {
    name = String(name);
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new TypeError('Name is not allowed.');
    return name;
  };
  const join = (dir, name) => (dir.endsWith(SEP) ? dir : dir + SEP) + name;
  const baseName = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
  const same = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
  const TYPES = { md: 'text/markdown', markdown: 'text/markdown', mdx: 'text/markdown', txt: 'text/plain', json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml',
    html: 'text/html', csv: 'text/csv', pdf: 'application/pdf', epub: 'application/epub+zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm' };
  const typeOf = (name) => TYPES[(/\.([a-z0-9]+)$/i.exec(name) || ['', ''])[1].toLowerCase()] || '';

  // Handles keep only plain own fields, so they survive being stored in IndexedDB; revive() puts the methods back.
  class Handle {
    constructor(kind, path) { this.__smd = 1; this.kind = kind; this.path = path; this.name = baseName(path); }
    async isSameEntry(other) { return !!other && other.kind === this.kind && typeof other.path === 'string' && same(other.path, this.path); }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
    async remove(opt) { await call('fs_remove', { path: this.path, recursive: !!(opt && opt.recursive) }); }
  }

  class Writable {
    constructor(handle, data) { this.handle = handle; this.buf = data; this.pos = 0; this.closed = false; }
    async bytes(data) {
      if (typeof data === 'string') return new TextEncoder().encode(data);
      if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      throw new TypeError('Unsupported data');
    }
    async write(data) {
      if (this.closed) throw new TypeError('The stream is closed.');
      if (data && typeof data === 'object' && 'type' in data && !(data instanceof Blob) && !ArrayBuffer.isView(data)) {
        if (data.type === 'seek') { this.pos = data.position; return; }
        if (data.type === 'truncate') { this.truncate(data.size); return; }
        if (typeof data.position === 'number') this.pos = data.position;
        data = data.data;
      }
      const b = await this.bytes(data);
      const end = this.pos + b.length;
      if (end > this.buf.length) { const n = new Uint8Array(end); n.set(this.buf); this.buf = n; }
      this.buf.set(b, this.pos); this.pos = end;
    }
    async seek(position) { this.pos = position; }
    async truncate(size) {
      const n = new Uint8Array(size); n.set(this.buf.subarray(0, Math.min(size, this.buf.length))); this.buf = n;
      if (this.pos > size) this.pos = size;
    }
    async close() {
      if (this.closed) return; this.closed = true;
      await call('fs_write', this.buf, { headers: { 'x-path': encodeURIComponent(this.handle.path) } });
    }
    async abort() { this.closed = true; }
    getWriter() {
      const w = this;
      return { write: (d) => w.write(d), close: () => w.close(), abort: () => w.abort(), releaseLock() {}, get ready() { return Promise.resolve(); } };
    }
  }

  class FileHandle extends Handle {
    constructor(path) { super('file', path); }
    async getFile() {
      const st = await call('fs_stat', { path: this.path });
      if (st.kind !== 'file') throw new DOMException('A requested file could not be found.', st.kind === 'none' ? 'NotFoundError' : 'TypeMismatchError');
      const buf = await call('fs_read', { path: this.path });
      return new File([buf], this.name, { type: typeOf(this.name), lastModified: st.mtime });
    }
    async createWritable(opt) {
      let data = new Uint8Array(0);
      if (opt && opt.keepExistingData) { try { data = new Uint8Array(await call('fs_read', { path: this.path })); } catch (e) { /* new file */ } }
      return new Writable(this, data);
    }
    // Rename in place, or move into another folder: move(name) or move(dirHandle, name).
    async move(a, b) {
      const dir = a && typeof a === 'object' ? a.path : this.path.slice(0, this.path.length - this.name.length);
      const name = childName(a && typeof a === 'object' ? (b || this.name) : a);
      const to = join(dir, name);
      await call('fs_rename', { from: this.path, to });
      this.path = to; this.name = name;
    }
  }

  class DirHandle extends Handle {
    constructor(path) { super('directory', path); }
    async *entries() {
      const list = await call('fs_list', { path: this.path });
      for (const it of list) yield [it.name, it.dir ? new DirHandle(join(this.path, it.name)) : new FileHandle(join(this.path, it.name))];
    }
    async *keys() { for await (const [k] of this.entries()) yield k; }
    async *values() { for await (const [, v] of this.entries()) yield v; }
    [Symbol.asyncIterator]() { return this.entries(); }
    async getFileHandle(name, opt) {
      const path = join(this.path, childName(name));
      const st = await call('fs_stat', { path });
      if (st.kind === 'dir') throw new DOMException('The path supplied exists, but was not an entry of requested type.', 'TypeMismatchError');
      if (st.kind === 'none') {
        if (!(opt && opt.create)) throw new DOMException('A requested file or directory could not be found.', 'NotFoundError');
        await call('fs_touch', { path });
      }
      return new FileHandle(path);
    }
    async getDirectoryHandle(name, opt) {
      const path = join(this.path, childName(name));
      const st = await call('fs_stat', { path });
      if (st.kind === 'file') throw new DOMException('The path supplied exists, but was not an entry of requested type.', 'TypeMismatchError');
      if (st.kind === 'none') {
        if (!(opt && opt.create)) throw new DOMException('A requested file or directory could not be found.', 'NotFoundError');
        await call('fs_mkdir', { path });
      }
      return new DirHandle(path);
    }
    async removeEntry(name, opt) { await call('fs_remove', { path: join(this.path, childName(name)), recursive: !!(opt && opt.recursive) }); }
    async resolve(other) {
      if (!other || typeof other.path !== 'string') return null;
      if (same(other.path, this.path)) return [];
      const base = this.path.endsWith(SEP) ? this.path : this.path + SEP;
      if (other.path.length <= base.length || !same(other.path.slice(0, base.length), base)) return null;
      return other.path.slice(base.length).split(/[\\/]/).filter(Boolean);
    }
  }

  const make = (kind, path) => (kind === 'directory' || kind === 'dir' ? new DirHandle(path) : new FileHandle(path));
  function revive(v, depth) {
    if (!v || typeof v !== 'object' || (depth || 0) > 3) return v;
    if (v.__smd === 1 && typeof v.path === 'string' && !(v instanceof Handle)) return make(v.kind, v.path);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = revive(v[i], (depth || 0) + 1); return v; }
    if (Object.getPrototypeOf(v) === Object.prototype) for (const k of Object.keys(v)) v[k] = revive(v[k], (depth || 0) + 1);
    return v;
  }

  const filters = (types) => (Array.isArray(types) ? types : []).map((t) => ({
    name: String((t && t.description) || 'Files'),
    exts: [].concat(...Object.values((t && t.accept) || {}).map((x) => [].concat(x))).map((e) => String(e).replace(/^\./, '')).filter((e) => /^[a-z0-9]+$/i.test(e)),
  })).filter((f) => f.exts.length);
  const abort = () => new DOMException('The user aborted a request.', 'AbortError');

  window.showDirectoryPicker = async () => {
    const p = await call('pick_dir', {}); if (!p) throw abort();
    return new DirHandle(p);
  };
  window.showOpenFilePicker = async (opt) => {
    const list = await call('pick_files', { multiple: !!(opt && opt.multiple), filters: opt && opt.excludeAcceptAllOption === false ? [] : filters(opt && opt.types) });
    if (!list || !list.length) throw abort();
    return list.map((p) => new FileHandle(p));
  };
  window.showSaveFilePicker = async (opt) => {
    const p = await call('pick_save', { name: String((opt && opt.suggestedName) || ''), filters: filters(opt && opt.types) }); if (!p) throw abort();
    return new FileHandle(p);
  };
  // A file dropped from the system: the native handle, so saving writes back to it.
  if (window.DataTransferItem) {
    try { delete DataTransferItem.prototype.getAsFileSystemHandle; } catch (e) { /* not configurable */ }
  }

  // Files and folders opened from the system go to the app once it is ready.
  let pulling = false;
  async function pull() {
    if (pulling) return; pulling = true;
    try {
      for (let i = 0; i < 300 && !(window.LMD && window.LMD.openDisk); i++) await new Promise((r) => setTimeout(r, 100));
      const list = await call('take_pending', {});
      for (const it of list || []) { try { await window.LMD.openDisk(make(it.dir ? 'directory' : 'file', it.path)); } catch (e) { /* the app says why */ } }
    } finally { pulling = false; }
  }

  window.__smdDesktop = { revive, pull, platform: WIN ? 'windows' : /Mac/i.test(navigator.userAgent) ? 'mac' : 'linux' };
  document.documentElement.classList.add('lmd-desktop');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pull, { once: true }); else pull();
})();
