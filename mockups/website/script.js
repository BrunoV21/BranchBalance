(function () {
  const root = document.documentElement;
  const themeKey = 'bb-theme';
  const savedTheme = localStorage.getItem(themeKey);

  if (savedTheme === 'light' || savedTheme === 'dark') {
    root.dataset.theme = savedTheme;
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    root.dataset.theme = 'dark';
  }

  function currentTheme() {
    return root.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function themeIcon(isDark) {
    return isDark
      ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>'
      : '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"></path></svg>';
  }

  function syncPreviewThemes() {
    document.querySelectorAll('[data-app-preview]').forEach((frame) => {
      try {
        frame.contentDocument.documentElement.dataset.theme = currentTheme();
      } catch (_) {
        // The standalone prototype remains usable if a browser isolates file frames.
      }
    });
  }

  function syncThemeControls() {
    const isDark = currentTheme() === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.innerHTML = themeIcon(isDark);
      button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    });
    syncPreviewThemes();
  }

  function setTheme(theme) {
    root.dataset.theme = theme;
    localStorage.setItem(themeKey, theme);
    syncThemeControls();
  }

  const menuButton = document.querySelector('[data-menu-toggle]');
  const siteNav = document.querySelector('[data-site-nav]');

  function setMenu(open) {
    if (!menuButton || !siteNav) return;
    siteNav.classList.toggle('is-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  }

  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied ? Promise.resolve() : Promise.reject(new Error('Copy is unavailable'));
  }

  document.addEventListener('click', (event) => {
    const themeButton = event.target.closest('[data-theme-toggle]');
    if (themeButton) setTheme(currentTheme() === 'dark' ? 'light' : 'dark');

    if (event.target.closest('[data-menu-toggle]')) {
      setMenu(!siteNav.classList.contains('is-open'));
      return;
    }

    if (event.target.closest('[data-site-nav] a')) setMenu(false);
    if (siteNav && siteNav.classList.contains('is-open') && !event.target.closest('.nav-shell')) setMenu(false);

    const copyButton = event.target.closest('[data-copy-target]');
    if (copyButton) {
      const target = document.getElementById(copyButton.dataset.copyTarget);
      if (target) {
        copyText(target.textContent).then(() => {
          const original = copyButton.textContent;
          copyButton.textContent = 'Copied';
          window.setTimeout(() => { copyButton.textContent = original; }, 1400);
        }).catch(() => { copyButton.textContent = 'Select to copy'; });
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenu(false);
  });

  document.querySelectorAll('[data-app-preview]').forEach((frame) => {
    frame.addEventListener('load', syncPreviewThemes);
  });

  const search = document.querySelector('[data-doc-search]');
  if (search) {
    const entries = Array.from(document.querySelectorAll('[data-doc-entry]'));
    const groups = Array.from(document.querySelectorAll('[data-doc-group]'));
    const status = document.querySelector('[data-search-status]');
    const empty = document.querySelector('[data-search-empty]');

    function applySearch() {
      const query = search.value.trim().toLocaleLowerCase();
      let visible = 0;
      entries.forEach((entry) => {
        const matches = !query || entry.textContent.toLocaleLowerCase().includes(query);
        entry.classList.toggle('is-hidden', !matches);
        if (matches) visible += 1;
      });
      groups.forEach((group) => {
        group.classList.toggle('is-hidden', !group.querySelector('[data-doc-entry]:not(.is-hidden)'));
      });
      if (status) status.textContent = query ? `${visible} ${visible === 1 ? 'guide' : 'guides'} found for “${search.value.trim()}”` : 'Browse 12 guides across four topics.';
      if (empty) empty.classList.toggle('is-visible', visible === 0);
    }

    search.addEventListener('input', applySearch);
    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && document.activeElement !== search) {
        event.preventDefault();
        search.focus();
      }
      if (event.key === 'Escape' && document.activeElement === search && search.value) {
        search.value = '';
        applySearch();
      }
    });
    applySearch();
  }

  document.querySelectorAll('[data-current-year]').forEach((node) => {
    node.textContent = new Date().getFullYear();
  });

  window.addEventListener('storage', (event) => {
    if (event.key === themeKey && (event.newValue === 'light' || event.newValue === 'dark')) {
      root.dataset.theme = event.newValue;
      syncThemeControls();
    }
  });

  syncThemeControls();
})();
