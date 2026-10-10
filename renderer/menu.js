'use strict';

(function () {
  const api = window.widget;
  api.onThemeChanged(t => { document.body.className = 't' + (Number(t) || 0); });
  const items = Array.prototype.slice.call(document.querySelectorAll('.item[data-mode]'));

  const I = window.WidgetI18n;

  function mark(mode) {
    items.forEach((el) => {
      const cur = el.getAttribute('data-mode') === (mode || 'normal');
      el.className = cur ? 'item cur' : 'item';
      el.querySelector('.ck').textContent = cur ? I.t('menu.current') : '';
    });
  }

  // 语言跟着设置走
  api.appInit().then((d) => {
    if (!d) return;
    document.body.className = 't' + (Number(d.theme) || 0);
    I.setLocale(d.locale);
    I.applyDom();
    api.modeGet().then((m) => mark(m || 'normal'));
  }).catch(() => { I.applyDom(); });

  items.forEach((el) => {
    el.addEventListener('click', () => {
      api.setMode(el.getAttribute('data-mode'));
      mark(el.getAttribute('data-mode'));
    });
  });

  document.getElementById('mi-settings').onclick = () => { api.openSettings(); api.menuHide(); };
  document.getElementById('mi-panel').onclick = () => { api.togglePopup(); api.menuHide(); };
  document.getElementById('mi-quit').onclick = () => api.close();

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.menuHide(); });
  api.onModeCurrent((m) => mark(m || 'normal'));
})();
