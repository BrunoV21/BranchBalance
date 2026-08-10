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
    group.innerHTML = '<div class="group-top"><div class="group-icon trip"><svg class="icon" viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="13" rx="2"></rect><path d="M9 7V5a3 3 0 0 1 6 0v2M4 12h16"></path></svg></div><div class="group-card-copy"><div class="group-name">Lisbon weekend</div><div class="group-meta">2 members · EUR · joined just now</div></div><span class="group-type-label"><svg class="icon" viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="13" rx="2"></rect></svg>Trip</span></div><div class="group-card-summary"><div><strong>No spending plan yet</strong><span>Start and end dates required when added</span></div><div class="summary-value">€0.00</div></div>';
    list.prepend(group);
    document.querySelectorAll('[data-active-group-count]').forEach((count) => { count.textContent = '3'; });
  }

  function syncCreateGroupType() {
    const selected = document.querySelector('[data-group-type-input]:checked');
    if (!selected) return;
    const isFuel = selected.value === 'fuel';
    const label = document.querySelector('[data-selected-type-label]');
    const copy = document.querySelector('[data-selected-type-copy]');
    const cta = document.querySelector('[data-create-group-cta]');

    if (label) {
      label.classList.toggle('fuel', isFuel);
      label.innerHTML = isFuel
        ? '<svg class="icon" viewBox="0 0 24 24"><path d="M5 21V4h10v17M7 7h6v5H7z"></path></svg>Fuel'
        : '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="13" rx="2"></rect><path d="M9 7V5a3 3 0 0 1 6 0v2"></path></svg>Trip';
    }
    if (copy) copy.textContent = isFuel
      ? 'A Fuel group uses recurring calendar-month limits, fuel fields, and the dedicated on-device fuel receipt profile.'
      : 'A Trip group uses an inclusive date range, optional budgets, daily pace, and the generic on-device receipt profile.';
    if (cta) {
      cta.firstChild.textContent = isFuel ? 'Create Fuel group' : 'Create Trip group';
      cta.href = isFuel ? '14-fuel-overview.html' : '05-group-overview.html';
    }
  }

  function applySelectedGroupContext() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('group') !== 'fuel') return;
    const path = window.location.pathname;
    if (!path.endsWith('/08-members.html') && !path.endsWith('/09-balances.html') && path !== '/08-members.html' && path !== '/09-balances.html') return;

    const context = document.querySelector('.group-context');
    if (context) context.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h10v17M7 7h6v5H7z"></path></svg><span>Fuel</span><span class="group-context-separator">·</span><span class="group-context-name">Family car fuel</span>';

    const back = document.querySelector('.app-header > a.icon-button');
    if (back) back.href = '14-fuel-overview.html';
    const routes = ['14-fuel-overview.html', '15-fuel-spending.html', '09-balances.html?group=fuel', '08-members.html?group=fuel'];
    document.querySelectorAll('.bottom-nav.group-nav .nav-item').forEach((item, index) => {
      if (routes[index]) item.href = routes[index];
    });
    const invite = document.querySelector('[data-invite-guidance]');
    if (invite) invite.dataset.repository = 'branch-balance-family-car-fuel';
  }

  function applyFuelExpenseMode() {
    const form = document.querySelector('[data-fuel-expense-form]');
    if (!form) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('source') === 'receipt') return;

    const title = document.querySelector('[data-fuel-expense-title]');
    const notice = document.querySelector('[data-fuel-scan-notice]');
    const preview = document.querySelector('[data-fuel-extraction-preview]');
    const previewTitle = document.querySelector('[data-fuel-extraction-title]');
    const previewCopy = document.querySelector('[data-fuel-extraction-copy]');
    if (title) title.textContent = 'Add fuel';
    if (notice) notice.classList.add('hidden');
    if (preview) preview.classList.add('manual-extraction-preview');
    if (previewTitle) previewTitle.textContent = 'Fuel expense details';
    if (previewCopy) previewCopy.textContent = 'Enter the paid amount and any optional fuel details available to you.';
    const previewBadge = preview?.querySelector('.group-type-label');
    if (previewBadge) previewBadge.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M5 21V4h10v17M7 7h6v5H7z"></path></svg>Fuel group';
    const fuelFieldsTitle = form.querySelector('.fuel-fields-title h2');
    if (fuelFieldsTitle) fuelFieldsTitle.textContent = 'Optional fuel details';
    form.querySelectorAll('.detected-field').forEach((field) => field.classList.remove('detected-field'));
    form.querySelectorAll('.detected-badge').forEach((badge) => badge.remove());

    const values = {
      '#fuel-description': '',
      '#fuel-paid': '',
      '#fuel-date': '2026-08-10',
      '#fuel-litres': '',
      '#fuel-unit-price': '',
      '#fuel-gross': '',
      '#fuel-discount': ''
    };
    Object.entries(values).forEach(([selector, value]) => {
      const input = document.querySelector(selector);
      if (input) input.value = value;
    });
    const save = form.querySelector('.btn-primary.btn-block');
    if (save) save.textContent = 'Save fuel expense';
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

    const inviteGuidance = event.target.closest('[data-invite-guidance]');
    if (inviteGuidance) {
      const inviteCard = inviteGuidance.closest('.card');
      const invitedLogin = inviteCard?.querySelector('input')?.value.trim() || 'the invited user';
      const repository = inviteGuidance.dataset.repository || 'this repository';
      const notice = document.querySelector('[data-invite-notice]');
      if (notice) {
        notice.textContent = `Invitation sent to @${invitedLogin}. Ask them to go to github.com and accept the invitation to collaborate on ${repository}. After accepting, they should open BranchBalance and refresh Your groups.`;
        notice.hidden = false;
      }
      showToast('Invitation sent through GitHub');
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

    const removeLineItem = event.target.closest('[data-line-item-remove]');
    if (removeLineItem) {
      const item = removeLineItem.closest('[data-line-item]');
      if (!item) return;
      item.remove();
      const remaining = syncDetectedLineItems();
      showToast(remaining === 0 ? 'Line items removed from this expense' : 'Line item removed');
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

  function parseMinorUnits(value) {
    const amount = Number.parseFloat(String(value).trim().replace(',', '.'));
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
  }

  function parseDecimal(value) {
    const number = Number.parseFloat(String(value).trim().replace(',', '.'));
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function syncFuelReceiptPreview() {
    const form = document.querySelector('[data-fuel-expense-form]');
    if (!form) return;
    const consistency = form.querySelector('[data-fuel-consistency]');
    const pill = form.querySelector('[data-fuel-consistency-pill]');
    if (!consistency || !pill) return;

    const paid = parseMinorUnits(document.querySelector('#fuel-paid')?.value);
    const gross = parseMinorUnits(document.querySelector('#fuel-gross')?.value);
    const discount = parseMinorUnits(document.querySelector('#fuel-discount')?.value);
    const litres = parseDecimal(document.querySelector('#fuel-litres')?.value);
    const unitPrice = parseDecimal(document.querySelector('#fuel-unit-price')?.value);
    const complete = [paid, gross, discount, litres, unitPrice].every((value) => value !== null);
    const totalsMatch = complete && gross - discount === paid;
    const calculatedGross = complete ? Math.round(litres * unitPrice * 100) : null;
    const pumpMatches = complete && Math.abs(calculatedGross - gross) <= 2;
    const matches = totalsMatch && pumpMatches;

    pill.classList.toggle('success', matches);
    pill.classList.toggle('pending', !matches);
    consistency.classList.toggle('warning', !matches);
    if (matches) {
      pill.innerHTML = '<span class="dot"></span>Arithmetic matches';
      consistency.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"></path></svg><span><strong>Totals are consistent.</strong><br>€${(gross / 100).toFixed(2)} gross − €${(discount / 100).toFixed(2)} discount = €${(paid / 100).toFixed(2)} paid. Litres × €${unitPrice.toFixed(3)}/L rounds within €0.02 of gross.</span>`;
    } else if (!complete) {
      pill.innerHTML = '<span class="dot"></span>Incomplete details';
      consistency.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle></svg><span><strong>Fuel details are optional.</strong><br>Complete the available fields for volume and price insights, or save an amount-only expense after review.</span>';
    } else {
      pill.innerHTML = '<span class="dot"></span>Needs review';
      consistency.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle></svg><span><strong>Check the extracted fuel values.</strong><br>Paid, gross, discount, litres and printed price do not currently reconcile. Your edits are never overwritten.</span>';
    }
  }

  function syncDetectedLineItems() {
    const section = document.querySelector('[data-detected-line-items]');
    if (!section) return 0;
    const rows = Array.from(section.querySelectorAll('[data-line-item]'));
    if (rows.length === 0) {
      section.remove();
      return 0;
    }

    const count = section.querySelector('[data-line-item-count]');
    if (count) count.textContent = `${rows.length} ${rows.length === 1 ? 'item' : 'items'} found · edit anything that looks wrong`;

    const totals = rows.map((row) => parseMinorUnits(row.querySelector('[data-line-item-total]')?.value));
    const sumIsValid = totals.every((value) => value !== null);
    const sumMinor = sumIsValid ? totals.reduce((sum, value) => sum + value, 0) : null;
    const amountMinor = parseMinorUnits(document.querySelector('#add-amount')?.value);
    const summary = section.querySelector('[data-line-items-summary]');
    if (summary) {
      const matches = sumMinor !== null && amountMinor !== null && sumMinor === amountMinor;
      summary.classList.toggle('warning', !matches);
      if (sumMinor === null) {
        summary.innerHTML = '<strong>Check the item totals.</strong> One or more values need attention.';
      } else {
        const formatted = `€${(sumMinor / 100).toFixed(2)}`;
        summary.innerHTML = matches
          ? `<strong>Items total ${formatted} · matches Amount.</strong>`
          : `<strong>Items total ${formatted} · differs from Amount.</strong> Tax, tips or discounts may explain this.`;
      }
    }
    return rows.length;
  }

  function applyReceiptPrefillMockup() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('source') !== 'receipt') return;
    const form = document.querySelector('form.form');
    if (!form) return;

    const title = document.querySelector('[data-trip-expense-title]');
    const description = document.querySelector('#add-description');
    const amount = document.querySelector('#add-amount');
    const date = document.querySelector('#add-date');
    if (!description || !amount || !date) return;

    if (title) title.textContent = 'Review extracted expense';
    description.value = 'BAGUETTERIA LISBOA';
    amount.value = '20.90';
    date.value = '2026-07-20';
    [description, amount, date].forEach((input) => input.closest('.field')?.classList.add('detected-field'));
    description.closest('.field')?.querySelector('label')?.insertAdjacentHTML('beforeend', '<span class="detected-badge">Detected · 97%</span>');
    amount.closest('.field')?.querySelector('label')?.insertAdjacentHTML('beforeend', '<span class="detected-badge">Detected · 98%</span>');
    date.closest('.field')?.querySelector('label')?.insertAdjacentHTML('beforeend', '<span class="detected-badge">Detected · 94%</span>');

    form.querySelectorAll('input[name="category"], input[name="payment"]').forEach((input) => { input.checked = false; });
    const equalShares = ['€5.23 share', '€5.23 share', '€5.22 share', '€5.22 share'];
    form.querySelectorAll('[data-split-panel="equal"] .check-row small').forEach((value, index) => { value.textContent = equalShares[index] || 'Included'; });
    form.querySelectorAll('[data-split-panel="full"] .check-row small').forEach((value) => { value.textContent = 'Owes €20.90'; });

    form.insertAdjacentHTML('afterbegin', '<div class="callout scan-result-notice"><svg class="icon" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path><path d="m9 12 2 2 4-4"></path></svg><span class="scan-result-copy"><strong>Receipt read on this device.</strong><br>Description, amount, date and 2 line items were detected. Review every value before saving.<span class="scan-result-meta">EUR matches this group · receipt photo will not be attached</span></span><a class="scan-result-retake" href="13-scan-receipt.html">Retake</a></div>');

    const descriptionField = description.closest('.field');
    const amountField = amount.closest('.field');
    const dateField = date.closest('.field');
    if (!descriptionField || !amountField || !dateField) return;
    const preview = document.createElement('section');
    preview.className = 'extraction-preview-panel generic-extraction-preview';
    preview.setAttribute('aria-labelledby', 'generic-extraction-title');
    preview.innerHTML = '<div class="extraction-preview-head"><div><h2 id="generic-extraction-title">Editable OCR preview</h2><p>Every extracted value is grouped here so you can correct it before making the manual choices.</p></div><span class="group-type-label"><svg class="icon" viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="13" rx="2"></rect><path d="M9 7V5a3 3 0 0 1 6 0v2"></path></svg>Generic</span></div>';
    descriptionField.before(preview);
    preview.append(descriptionField, amountField, dateField);

    dateField.insertAdjacentHTML('afterend', `<section class="detected-line-items" data-detected-line-items aria-labelledby="detected-line-items-title">
      <div class="detected-line-items-head">
        <div><div class="detected-line-items-title"><h2 id="detected-line-items-title">Detected line items</h2><span class="detected-badge">Generic OCR</span></div><p data-line-item-count>2 items found · edit anything that looks wrong</p></div>
      </div>
      <div class="detected-line-item" data-line-item>
        <label class="line-item-name"><span>Item 1</span><input class="input" value="SALMON BAGUETTE" aria-label="Item 1 description"></label>
        <div class="line-item-values"><label><span>Qty</span><input class="input" value="1" inputmode="decimal" aria-label="Salmon baguette quantity"></label><label><span>Unit</span><span class="line-item-money"><b>€</b><input class="input" value="8.95" inputmode="decimal" aria-label="Salmon baguette unit price"></span></label><label><span>Line total</span><span class="line-item-money"><b>€</b><input class="input" value="8.95" inputmode="decimal" data-line-item-total aria-label="Salmon baguette line total"></span></label><button class="line-item-remove" type="button" data-line-item-remove aria-label="Remove Salmon baguette"><svg class="icon" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M8 7l1 13h6l1-13M10 11v5M14 11v5"></path></svg></button></div>
      </div>
      <div class="detected-line-item" data-line-item>
        <label class="line-item-name"><span>Item 2</span><input class="input" value="FOCACCIA PASTRAMI" aria-label="Item 2 description"></label>
        <div class="line-item-values"><label><span>Qty</span><input class="input" value="1" inputmode="decimal" aria-label="Focaccia pastrami quantity"></label><label><span>Unit</span><span class="line-item-money"><b>€</b><input class="input" value="11.95" inputmode="decimal" aria-label="Focaccia pastrami unit price"></span></label><label><span>Line total</span><span class="line-item-money"><b>€</b><input class="input" value="11.95" inputmode="decimal" data-line-item-total aria-label="Focaccia pastrami line total"></span></label><button class="line-item-remove" type="button" data-line-item-remove aria-label="Remove Focaccia pastrami"><svg class="icon" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M8 7l1 13h6l1-13M10 11v5M14 11v5"></path></svg></button></div>
      </div>
      <div class="line-items-reconciliation" data-line-items-summary><strong>Items total €20.90 · matches Amount.</strong></div>
      <p class="line-items-persistence">Only confirmed rows are saved as shared expense details. The receipt photo and raw OCR stay off GitHub.</p>
    </section>`);
    preview.insertAdjacentHTML('afterend', '<div class="callout scan-manual-note"><svg class="icon" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle></svg><span><strong>Now finish the manual choices.</strong><br>Category and payment method are never guessed from a receipt.</span></div>');
    syncDetectedLineItems();
  }

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-line-item-total], #add-amount')) syncDetectedLineItems();
    if (event.target.matches('#fuel-paid, #fuel-litres, #fuel-unit-price, #fuel-gross, #fuel-discount')) syncFuelReceiptPreview();
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-expense-filter]')) applyExpenseFilters();
    if (event.target.matches('[data-group-type-input]')) syncCreateGroupType();
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

  applyReceiptPrefillMockup();
  applySelectedGroupContext();
  applyFuelExpenseMode();
  syncFuelReceiptPreview();
  syncCreateGroupType();
  syncThemeIcons();
  applyExpenseFilters();
  syncActivityMockup();
})();
