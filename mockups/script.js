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
      if (group) {
        group.querySelectorAll('[data-segment]').forEach((s) => {
          s.classList.remove('active');
          s.setAttribute('aria-pressed', 'false');
        });
      }
      segment.classList.add('active');
      segment.setAttribute('aria-pressed', 'true');
      const target = segment.dataset.target;
      const scope = segment.closest('[data-segment-scope]') || document;
      scope.querySelectorAll('[data-split-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.splitPanel !== target));
    }

    const resetFilters = event.target.closest('[data-reset-filters]');
    if (resetFilters) {
      document.querySelectorAll('[data-expense-filter]').forEach((select) => { select.value = 'all'; });
      applyExpenseFilters();
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

  function applyExpenseFilters() {
    const filters = Array.from(document.querySelectorAll('[data-expense-filter]'));
    const rows = Array.from(document.querySelectorAll('[data-expense-row]'));
    if (!filters.length || !rows.length) return;

    let visible = 0;
    rows.forEach((row) => {
      const matches = filters.every((filter) => filter.value === 'all' || row.dataset[filter.dataset.expenseFilter] === filter.value);
      row.classList.toggle('hidden', !matches);
      if (matches) visible += 1;
    });

    const count = document.querySelector('[data-filter-count]');
    if (count) count.textContent = `${visible} ${visible === 1 ? 'expense' : 'expenses'} shown`;
    const empty = document.querySelector('[data-filter-empty]');
    if (empty) empty.classList.toggle('hidden', visible !== 0);
  }

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-expense-filter]')) applyExpenseFilters();
  });

  window.addEventListener('storage', (event) => {
    if (event.key === 'bb-theme' && (event.newValue === 'dark' || event.newValue === 'light')) {
      root.dataset.theme = event.newValue;
      syncThemeIcons();
    }
  });

  syncThemeIcons();
  applyExpenseFilters();
})();
