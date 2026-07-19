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

  function showToast(message) {
    const toast = document.querySelector('.toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function resolveInvitation(card) {
    const section = card.closest('[data-invited-section]');
    card.remove();
    if (!section) return;
    const remaining = section.querySelectorAll('[data-invitation]').length;
    const count = section.querySelector('[data-invitation-count]');
    if (count) count.innerHTML = `<span class="dot"></span>${remaining} pending`;
    if (remaining === 0) section.classList.add('hidden');
  }

  function addAcceptedMockGroup() {
    const list = document.querySelector('[data-active-groups]');
    if (!list || list.querySelector('[data-accepted-invitation-group]')) return;
    const group = document.createElement('a');
    group.className = 'group-card';
    group.href = '05-group-overview.html';
    group.dataset.acceptedInvitationGroup = '';
    group.innerHTML = '<div class="group-top"><div class="group-icon" style="background:var(--positive-soft);color:var(--positive)"><svg class="icon" viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v10H3z"></path><path d="M3 7V5h6l2 2"></path></svg></div><div style="flex:1"><div class="group-name">Lisbon weekend</div><div class="group-meta">2 members · EUR · joined just now</div></div><span class="pill success"><span class="dot"></span>Joined</span></div><div class="group-balance"><div><div class="value" style="color:var(--positive)">€0.00</div><div class="caption">All settled</div></div><div style="display:flex"><div class="avatar xs">AK</div><div class="avatar xs green" style="margin-left:-6px">MB</div></div></div>';
    list.prepend(group);
    document.querySelectorAll('[data-active-group-count]').forEach((count) => { count.textContent = '4'; });
  }

  function syncActivityMockup() {
    const items = Array.from(document.querySelectorAll('[data-activity-item]'));
    const unread = items.filter((item) => item.hasAttribute('data-activity-unread'));
    const list = document.querySelector('[data-activity-list]');
    const empty = document.querySelector('[data-activity-empty]');
    const clear = document.querySelector('[data-activity-clear]');
    const count = document.querySelector('[data-new-activity-count]');

    if (list) list.classList.toggle('hidden', items.length === 0);
    if (empty) empty.classList.toggle('hidden', items.length !== 0);
    if (clear) clear.classList.toggle('hidden', items.length === 0);
    if (count) {
      count.innerHTML = `<span class="dot"></span>${unread.length} new`;
      count.classList.toggle('hidden', unread.length === 0);
    }

    document.querySelectorAll('.activity-section').forEach((section) => {
      section.classList.toggle('hidden', section.querySelectorAll('[data-activity-item]').length === 0);
    });
  }

  function applyChartFilter(filterName, value, label) {
    const filter = document.querySelector(`[data-expense-filter="${filterName}"]`);
    if (!filter) return;
    filter.value = value;
    applyExpenseFilters();
    const explorer = document.querySelector('#expenses');
    if (explorer) explorer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`${label} expenses shown`);
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

    const categoryFilter = event.target.closest('[data-chart-filter-category]');
    if (categoryFilter) {
      const label = categoryFilter.querySelector('.spending-row-title')?.textContent || 'Category';
      applyChartFilter('category', categoryFilter.dataset.chartFilterCategory, label);
    }

    const scopeFilter = event.target.closest('[data-chart-filter-scope]');
    if (scopeFilter) {
      const label = scopeFilter.dataset.chartFilterScope === 'just_me' ? 'Just me' : 'Shared';
      applyChartFilter('scope', scopeFilter.dataset.chartFilterScope, label);
    }

    const dateFilter = event.target.closest('[data-chart-filter-date]');
    if (dateFilter) {
      const label = dateFilter.querySelector('.daily-date')?.textContent || 'Selected date';
      applyChartFilter('date', dateFilter.dataset.chartFilterDate, label);
    }

    const toastTrigger = event.target.closest('[data-toast-message]');
    if (toastTrigger) {
      showToast(toastTrigger.dataset.toastMessage);
    }

    const invitationAction = event.target.closest('[data-invitation-action]');
    if (invitationAction) {
      const card = invitationAction.closest('[data-invitation]');
      if (!card) return;
      const groupName = card.dataset.groupName || 'this group';
      const action = invitationAction.dataset.invitationAction;
      if (action === 'decline' && !window.confirm(`Decline the invitation to ${groupName}? The owner will need to invite you again if you change your mind.`)) return;

      card.querySelectorAll('[data-invitation-action]').forEach((button) => { button.disabled = true; });
      invitationAction.textContent = action === 'accept' ? 'Accepting…' : 'Declining…';

      window.setTimeout(() => {
        if (action === 'accept') {
          addAcceptedMockGroup();
          showToast(`${groupName} accepted and added to your groups`);
        } else {
          showToast(`${groupName} invitation declined`);
        }
        resolveInvitation(card);
      }, 650);
    }

    const dismissActivity = event.target.closest('[data-activity-dismiss]');
    if (dismissActivity) {
      const item = dismissActivity.closest('[data-activity-item]');
      if (!item) return;
      item.remove();
      syncActivityMockup();
      showToast('Activity dismissed on this device');
    }

    const clearActivity = event.target.closest('[data-activity-clear]');
    if (clearActivity) {
      if (!window.confirm('Clear all recent activity from this device? This will not undo any group actions.')) return;
      document.querySelectorAll('[data-activity-item]').forEach((item) => item.remove());
      syncActivityMockup();
      showToast('Recent activity cleared on this device');
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

  document.addEventListener('keydown', (event) => {
    const categoryFilter = event.target.closest('[data-chart-filter-category]');
    if (!categoryFilter || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    categoryFilter.click();
  });

  window.addEventListener('storage', (event) => {
    if (event.key === 'bb-theme' && (event.newValue === 'dark' || event.newValue === 'light')) {
      root.dataset.theme = event.newValue;
      syncThemeIcons();
    }
  });

  syncThemeIcons();
  applyExpenseFilters();
  syncActivityMockup();
})();
