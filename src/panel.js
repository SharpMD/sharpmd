// SharpMD en el panel lateral del navegador: la misma app, angosta, para tomar notas mientras se navega.
// El panel carga src/app.html?panel=1 desde la extensión, así que comparte todo con la app grande: las notas de
// este navegador, la nube y las carpetas del disco. Acá solo se suma lo propio del panel:
// - una cabecera con el menú de archivos (el árbol se despliega como el menú de una app del teléfono), nota nueva,
//   agregar la página que se está mirando y abrir la nota en una pestaña para seguirla en grande;
// - lo que se manda desde el menú del clic derecho ("Agregar a SharpMD"), que el service worker deja en
//   chrome.storage.local.panelClip para que el panel lo agregue a la nota abierta.
(function () {
  'use strict';
  const LMD = (window.LMD = window.LMD || {});
  const ext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && location.protocol === 'chrome-extension:';
  let on = false;
  try { on = ext && (new URLSearchParams(location.search).has('panel') || sessionStorage.getItem('lmd-sidepanel') === '1'); } catch (e) { on = false; }
  if (!on) { LMD.panel = { on: false, init() {} }; return; }
  // La app cambia la dirección al abrir una nota (?f=...) y pierde ?panel: lo recuerda la sesión del panel.
  try { sessionStorage.setItem('lmd-sidepanel', '1'); } catch (e) { /* sin sessionStorage: vale hasta recargar */ }
  document.documentElement.classList.add('lmd-sidepanel');

  const T = (s, v) => (LMD.t ? LMD.t(s, v) : s);
  const KEY = 'panelClip';
  const ICON = {
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    clip: '<svg viewBox="0 0 24 24"><path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5l1.2-1.2a3.9 3.9 0 0 1 5.5 5.5L16.5 12M13 17.5l-1.2 1.2a3.9 3.9 0 0 1-5.5-5.5L7.5 12"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M13.5 4.5h6v6M19.5 4.5l-8 8"/><path d="M17.5 13.5v4.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V8A1.5 1.5 0 0 1 6 6.5h4.5"/></svg>',
  };

  // El recorte en Markdown: el enlace a la página y, si había texto elegido, citado abajo.
  const mdEsc = (s) => String(s || '').replace(/([\\[\]])/g, '\\$1').replace(/\s+/g, ' ').trim();
  function clipText(c) {
    const url = String(c.url || '').trim(); const title = mdEsc(c.title) || url;
    const head = url && /^https?:|^file:/i.test(url) ? '[' + title + '](<' + url.replace(/>/g, '%3E') + '>)' : title;
    const quote = String(c.text || '').replace(/\r\n?/g, '\n').trim();
    return [head, quote ? quote.split('\n').map((l) => (l.trim() ? '> ' + l.trim() : '>')).join('\n') : ''].filter(Boolean).join('\n\n');
  }

  let core = null; let busy = Promise.resolve();
  // Va al final de la nota abierta. Sin nota, o si la abierta no es Markdown que se pueda escribir, nace una nueva.
  async function add(c) {
    const text = clipText(c); if (!text || !core) return false;
    const can = !core.noDoc && !core.readOnly && !core.dirPage && !core.viewing && core.docKind === 'md';
    if (!can) { await core.newNote({ text: text + '\n' }); core.flash(T('Página agregada a una nota nueva')); return true; }
    const raw = core.raw || '';
    core.setRaw((raw.replace(/\s+$/, '') ? raw.replace(/\s+$/, '') + '\n\n' : '') + text + '\n');
    try { await core.save(false); } catch (e) { /* queda sin guardar, con su marca */ }
    core.flash(T('Página agregada a la nota'));
    return true;
  }
  const queue = (c) => (busy = busy.then(() => add(c)).catch(() => false));

  // La pestaña que se está mirando en esta ventana, y lo que tenga elegido. Una página del navegador (chrome://, la
  // tienda) no deja leer nada: va el título y la dirección.
  async function here() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;
    let text = '';
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection() || '').slice(0, 20000) });
      text = (r && r.result) || '';
    } catch (e) { /* no se puede leer esa página */ }
    return { title: tab.title || '', url: tab.url || '', text };
  }

  // Lo que dejó el clic derecho. Se borra al tomarlo, así no se agrega dos veces.
  async function pending() {
    let c = null;
    try { c = (await chrome.storage.local.get(KEY))[KEY]; } catch (e) { return; }
    if (!c || typeof c !== 'object') return;
    await chrome.storage.local.remove(KEY).catch(() => {});
    if (Date.now() - (c.at || 0) < 10 * 60000) await queue(c);
  }

  // Abre lo mismo en una pestaña, en la app web o en la de la extensión según Ajustes > Instalar.
  async function bigger() {
    if (core.dirty) { try { await core.save(false); } catch (e) { /* se abre igual */ } }
    const q = new URLSearchParams(location.search); q.delete('panel');
    const query = q.toString() ? '?' + q.toString() : '';
    chrome.runtime.sendMessage({ type: 'openApp', pref: true, query: query + (/^#(lmd-|open=|signin=)/.test(location.hash) ? '' : location.hash) }).catch(() => {});
  }

  function bar() {
    const b = document.createElement('div'); b.className = 'lmd-panelbar';
    const btn = (act, icon, title) => '<button type="button" class="lmd-icon-btn" data-panel="' + act + '" title="' + title + '" aria-label="' + title + '">' + icon + '</button>';
    b.innerHTML = btn('files', ICON.menu, T('Archivos')) + '<span class="lmd-panel-name">SharpMD</span><span class="lmd-panel-gap"></span>' +
      btn('new', ICON.plus, T('Nota nueva')) + btn('clip', ICON.clip, T('Agregar esta página')) + btn('tab', ICON.out, T('Abrir en una pestaña'));
    b.addEventListener('click', async (e) => {
      const k = e.target.closest('[data-panel]'); if (!k) return;
      const act = k.dataset.panel;
      if (act === 'files') { const s = document.querySelector('.lmd-topbar [data-act=sidebar]'); if (s) s.click(); }
      else if (act === 'new') core.newNote();
      else if (act === 'clip') { const c = await here().catch(() => null); if (c) queue(c); else core.flash(T('No hay una página para agregar'), 'warn'); }
      else if (act === 'tab') bigger();
    });
    return b;
  }

  LMD.panel = {
    on: true,
    clipText,
    add: queue,
    init(c) {
      core = c;
      const main = document.querySelector('.lmd-main');
      if (main && !main.querySelector('.lmd-panelbar')) main.insertBefore(bar(), main.firstChild);
      chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[KEY] && ch[KEY].newValue) pending(); });
      pending();
    },
  };
})();
