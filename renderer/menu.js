(function () {
  const items = Array.prototype.slice.call(document.querySelectorAll('.item'));

  function mark(mode) {
    items.forEach((el) => {
      const cur = el.getAttribute('data-mode') === mode;
      el.className = cur ? 'item cur' : 'item';
      el.querySelector('.ck').textContent = cur ? '当前' : '';
    });
  }

  items.forEach((el) => {
    el.addEventListener('click', () => {
      window.widget.setMode(el.getAttribute('data-mode'));
    });
  });

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { window.widget.toolHide(); } });
  window.widget.onModeCurrent((m) => mark(m || 'normal'));
  window.widget.modeGet().then((m) => mark(m || 'normal'));
})();
