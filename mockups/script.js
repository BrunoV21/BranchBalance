(function () {
  const root = document.documentElement;
  const saved = localStorage.getItem('bb-theme');
  if (saved === 'dark' || saved === 'light') root.dataset.theme = saved;
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) root.dataset.theme = 'dark';

  function syncThemeIcons() {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const isDark = root.dataset.theme === 'dark';
      button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = isDark ? 'Light mode' : 'Dark mode';
      button.innerHTML = isDark
        ? '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>'
        : '<svg class="icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"></path></svg>';
    });
  }

  document.addEventListener('click', (event) => {
    const themeButton = event.target.closest('[data-theme-toggle]');
    if (themeButton) {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('bb-theme', root.dataset.theme);
      syncThemeIcons();
    }

    const segment = event.target.closest('[data-segment]');
    if (segment) {
      const group = segment.closest('[data-segment-group]');
      if (group) group.querySelectorAll('[data-segment]').forEach((s) => s.classList.remove('active'));
      segment.classList.add('active');
      const target = segment.dataset.target;
      document.querySelectorAll('[data-split-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.splitPanel !== target));
    }

    const toastTrigger = event.target.closest('[data-toast-message]');
    if (toastTrigger) {
      const toast = document.querySelector('.toast');
      if (toast) {
        toast.textContent = toastTrigger.dataset.toastMessage;
        toast.classList.add('show');
        window.setTimeout(() => toast.classList.remove('show'), 2200);
      }
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === 'bb-theme' && (event.newValue === 'dark' || event.newValue === 'light')) {
      root.dataset.theme = event.newValue;
      syncThemeIcons();
    }
  });

  syncThemeIcons();
})();
