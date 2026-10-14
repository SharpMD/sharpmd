// Recorrido de la primera vez en el celular: tres pasos que se pueden saltear, una sola vez. Se muestra sobre el
// inicio de la app, en pantalla chica o dentro de la app de la tienda. Lo que ya se vio queda en este navegador.
(function () {
  'use strict';

  const { el } = LMD.kit;
  const T = LMD.t;
  const KEY = 'lmd-tour-seen';

  const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const mark = () => { try { localStorage.setItem(KEY, '1'); } catch (e) { /* sin almacenamiento: se vuelve a ofrecer */ } };
  const wanted = () => {
    if (seen() || document.querySelector('.lmd-tour')) return false;
    return LMD.storeApp === true || window.matchMedia('(max-width: 700px)').matches;
  };

  const steps = () => {
    const list = [
      { title: 'Una nota rápida', text: 'Tocá "Nueva nota" en el inicio y escribí. Se guarda sola en este dispositivo.' },
      { title: 'Una tarea', text: 'Empezá una línea con - [ ] y queda una casilla que se tilda con un toque.' },
      { title: 'Abrir un .md compartido', text: 'Desde otra app, compartí un archivo .md con SharpMD y se abre acá para leerlo o editarlo.' },
    ];
    // En la app de la tienda, lo que la cuenta suma.
    if (LMD.storeApp === true) list.push({ title: 'Tus notas en la nube', text: '10 notas gratis en la nube, para tenerlas en todos tus dispositivos.' });
    return list;
  };

  function show() {
    if (!wanted()) return;
    const list = steps(); let at = 0;
    const title = el('h2', { class: 'lmd-tour-title' });
    const text = el('p', { class: 'lmd-tour-text' });
    const count = el('span', { class: 'lmd-tour-count' });
    const skip = el('button', { type: 'button', class: 'lmd-tour-skip', text: T('Saltear') });
    const next = el('button', { type: 'button', class: 'lmd-tour-next' });
    const card = el('div', { class: 'lmd-tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('Primeros pasos') }, [count, title, text, el('div', { class: 'lmd-tour-actions' }, [skip, next])]);
    const wrap = el('div', { class: 'lmd-tour' }, [card]);
    const close = () => { mark(); wrap.remove(); };
    const paint = () => {
      const s = list[at];
      count.textContent = (at + 1) + ' / ' + list.length;
      title.textContent = T(s.title);
      text.textContent = T(s.text);
      next.textContent = T(at === list.length - 1 ? 'Listo' : 'Siguiente');
    };
    skip.onclick = close;
    next.onclick = () => { if (at >= list.length - 1) close(); else { at += 1; paint(); } };
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    paint();
    document.body.appendChild(wrap);
    next.focus();
  }

  LMD.tour = { show, seen, wanted };
})();
