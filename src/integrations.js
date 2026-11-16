// Ajustes > Integraciones: con qué se conecta SharpMD por fuera. Orca (el botón de las tarjetas), los agentes de
// código (por MCP) y las apps de automatización. Las dos últimas llevan a la pestaña que las maneja.
// Se pide recién al abrir la pestaña (ver LAZY_APP en content.js).
(function () {
  'use strict';

  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const AGENTS = [['claude', 'Claude Code'], ['codex', 'Codex'], ['gemini', 'Gemini CLI'], ['opencode', 'OpenCode'], ['cursor', 'Cursor']];
  const ORCA_URL = 'https://orca.dev/download';

  const ICO = {
    orca: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.4" transform="rotate(-30 12 12)"/><circle cx="12" cy="12" r="1.6"/></svg>',
    agents: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m7.5 10 3 2-3 2M12.5 15h4"/></svg>',
    flows: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.3 11l7.4-4M8.3 13l7.4 4"/></svg>',
  };

  // Una tarjeta: ícono, nombre, una línea y, a la derecha, lo que se hace (un interruptor o un botón).
  const card = (id, ico, name, why, side) =>
    '<div class="lmd-wh-card lmd-in-card" data-integ="' + id + '"><span class="lmd-wh-ico" aria-hidden="true">' + ico + '</span>' +
    '<div class="lmd-wh-main"><b>' + esc(name) + '</b><p>' + esc(why) + '</p></div>' + (side || '') + '</div>';

  async function pane(box, core) {
    const s = await LMD.load();
    const orcaOn = s.orca !== false;
    const agent = AGENTS.some((a) => a[0] === s.orcaAgent) ? s.orcaAgent : 'claude';
    box.innerHTML = '<div class="lmd-wh-grid lmd-in-grid">' +
      '<div class="lmd-wh-card lmd-in-card lmd-in-orca" data-integ="orca"><span class="lmd-wh-ico" aria-hidden="true">' + ICO.orca + '</span>' +
        '<div class="lmd-wh-main"><b>Orca</b><p>' + esc(T('Abrí una tarjeta en un workspace de Orca.')) + '</p></div>' +
        '<ol class="lmd-in-steps">' +
          '<li><span>' + esc(T('Instalá Orca')) + '</span> <a class="lmd-link" href="' + ORCA_URL + '" target="_blank" rel="noopener noreferrer">orca.dev</a></li>' +
          '<li><span>' + esc(T('Conectá tu agente una vez')) + '</span> <button type="button" class="lmd-btn" data-integ-brief>' + esc(T('Copiar instrucciones para tu IA')) + '</button></li>' +
          '<li><span>' + esc(T('«Trabajar en Orca» copia el comando para la terminal')) + '</span> <select class="lmd-in-agent" data-integ-agent aria-label="' + esc(T('Agente')) + '">' + AGENTS.map(([v, n]) => '<option value="' + v + '"' + (agent === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select> <label class="lmd-switch"><input type="checkbox" data-integ-orca' + (orcaOn ? ' checked' : '') + ' aria-label="' + esc(T('Botón «Trabajar en Orca» en las tarjetas')) + '"><i></i></label></li>' +
        '</ol>' +
        '<p class="lmd-in-sub">' + esc(T('Plugin para Orca: tus tableros adentro de Orca')) + ' <a class="lmd-link" data-integ-plugin href="https://github.com/SharpMD/sharpmd/tree/main/integrations/orca-plugin" target="_blank" rel="noopener noreferrer">' + esc(T('Cómo instalarlo')) + '</a></p>' +
        '<p class="lmd-in-sub">' + esc(T('SharpMD también abre en el navegador de Orca')) + ' <button type="button" class="lmd-btn" data-integ-url>' + esc(T('Copiar enlace')) + '</button></p><p class="lmd-in-sub lmd-in-msg" role="status" data-integ-msg hidden></p></div>' +
      card('agents', ICO.agents, T('Agentes de código'), T('Se conectan por MCP a tus notas.'),
        '<button type="button" class="lmd-btn lmd-in-side" data-integ-go="ai">' + esc(T('Conectar')) + '</button><p class="lmd-in-sub">Claude Code, Cursor, VS Code, Windsurf, Codex</p>') +
      card('flows', ICO.flows, 'Slack, Zapier, Make y n8n', T('Avisos y flujos hacia otras apps.'),
        '<button type="button" class="lmd-btn lmd-in-side" data-integ-go="auto">' + esc(T('Configurar')) + '</button>') +
    '</div>';
    const on = box.querySelector('[data-integ-orca]');
    const sel = box.querySelector('[data-integ-agent]');
    sel.addEventListener('change', () => LMD.patch({ orcaAgent: sel.value }));
    on.addEventListener('change', () => LMD.patch({ orca: on.checked }));
    const say = (t) => { const m = box.querySelector('[data-integ-msg]'); m.hidden = false; m.textContent = t; };
    // El mensaje con el token solo existe mientras el token recién creado sigue a la vista: si no, se va a IA (MCP) a crear uno.
    box.querySelector('[data-integ-brief]').addEventListener('click', async () => {
      const text = LMD.sync.liveBrief ? LMD.sync.liveBrief() : '';
      if (!text) { if (core && core.tab) core.tab('ai'); return; }
      await LMD.sync.copyText(text); say(T('Instrucciones copiadas. Pegalas en tu IA.'));
    });
    box.querySelector('[data-integ-url]').addEventListener('click', async () => { await LMD.sync.copyText(LMD.WEB_APP_URL); say(T('Enlace copiado.')); });
    box.querySelectorAll('[data-integ-go]').forEach((b) => b.addEventListener('click', () => { if (core && core.tab) core.tab(b.dataset.integGo); }));
  }

  LMD.integrations = { pane };
})();
