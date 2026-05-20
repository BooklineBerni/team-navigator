// =============================================================================
// lib/pickers.js
// ---------------------------------------------------------------------------
// Reusable picker UI components used inside the task modal and elsewhere:
//
//   1. Multi-select Proposed By picker (proposedChipHtml, refreshProposedChips,
//      filterProposedDropdown) — chip+search for selecting multiple people
//      who proposed a task.
//   2. Responsible single-select photo picker (setResponsiblePicker,
//      _respPickerOpenDropdown, etc.) — avatar+search for the owner.
//   3. Custom colored picklist component (setColoredPicker) — generic
//      dropdown with colored pills, used for Status / Priority / Type.
//   4. Group picker helpers (_groupPickerRenderChip, refreshGroupSelectOptions,
//      applyGroupModeToModal) — parent-group selector + isGroup mode toggle.
//
// Loaded AFTER inline. All references resolve via shared classic-script scope
// at runtime (these functions are called from openModal in inline, which fires
// when the user clicks a task — by then this file has loaded).
// =============================================================================

// =========================== Multi-select Proposed By picker ===========================
let proposedSelectedIds = [];

// Map a person's section to a CSS class suffix for chip / dropdown coloring.
// Disabled=gray, Bookline=black, team=light blue, supplementary=green.
function _proposedSectionClass(p) {
  if (!p) return 'psec-bookline';
  try {
    const sec = (typeof getPersonSection === 'function') ? getPersonSection(p.id) : '';
    if (sec === 'disabled') return 'psec-disabled';
    if (sec === 'team') return 'psec-team';
    if (sec === 'supplementary') return 'psec-supplementary';
    return 'psec-bookline'; // empty section = Bookline
  } catch (_) { return 'psec-bookline'; }
}
function proposedChipHtml(p) {
  const ini = initials(p.name||'');
  const color = p.color || '#9a9a9a';
  const photoImg = p.photo ? '<img src="'+escapeHtml(p.photo)+'" alt="" onerror="this.remove()">' : '';
  const ext = p.external ? ' proposed-chip-external' : '';
  const sc = ' ' + _proposedSectionClass(p);
  return '<span class="proposed-chip'+ext+sc+'" data-pid="'+escapeHtml(p.id)+'">' +
    '<span class="av-mini" style="background:'+color+'">'+photoImg+'<span class="ini">'+escapeHtml(ini)+'</span></span>' +
    '<span class="proposed-chip-name">'+escapeHtml(p.displayName||p.name||'?')+'</span>' +
    '<button type="button" class="proposed-chip-x" title="Remove">×</button>' +
    '</span>';
}

function refreshProposedChips() {
  const cont = document.getElementById('f_proposedChips');
  if (!cont) return;
  const html = proposedSelectedIds.map(id => {
    const p = findPerson(id);
    if (!p) return '<span class="proposed-chip" data-pid="'+escapeHtml(id)+'" title="Unknown user">'+escapeHtml(id)+'<button type="button" class="proposed-chip-x">×</button></span>';
    return proposedChipHtml(p);
  }).join('');
  cont.innerHTML = html;
  cont.querySelectorAll('.proposed-chip-x').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const chip = btn.closest('.proposed-chip');
      const pid = chip.dataset.pid;
      proposedSelectedIds = proposedSelectedIds.filter(x => x !== pid);
      refreshProposedChips();
      filterProposedDropdown(document.getElementById('f_proposedInput').value);
    });
  });
}

function filterProposedDropdown(query) {
  const dd = document.getElementById('f_proposedDropdown');
  if (!dd) return;
  const q = (query||'').trim().toLowerCase();
  // Pull from the union: TEAM + EXTERNAL_TEAM + full SLACK_DIRECTORY.
  const all = (typeof bnAllPeopleForProposedBy === 'function') ? bnAllPeopleForProposedBy() : allPeopleForPicker();
  // Rules:
  //  • Every Bookline Slack user appears, even if they have no tasks yet.
  //  • Disabled people are NEVER shown (handled in bnAllPeopleForProposedBy).
  //  • Already-selected people in THIS task are excluded.
  const matches = all.filter(p => {
    if (proposedSelectedIds.includes(p.id)) return false;
    if (!q) return true;
    return (p.name||'').toLowerCase().includes(q) ||
           (p.displayName||'').toLowerCase().includes(q) ||
           (p.email||'').toLowerCase().includes(q);
  });
  if (matches.length === 0) {
    dd.style.display = 'none';
    return;
  }
  // Split into TEAM/SUPPLEMENTARY/BOOKLINE/SLACK-ONLY buckets so we can show headers.
  const bTeam = [], bSupp = [], bBook = [], bSlack = [];
  matches.forEach(p => {
    if (p._slackOnly) { bSlack.push(p); return; }
    let sec = '';
    try { sec = (typeof getPersonSection === 'function') ? getPersonSection(p.id) : ''; } catch(_) {}
    if (sec === 'team') bTeam.push(p);
    else if (sec === 'supplementary') bSupp.push(p);
    else bBook.push(p);
  });
  const byName = (a,b) => (a.displayName||a.name||'').localeCompare(b.displayName||b.name||'');
  bTeam.sort(byName); bSupp.sort(byName); bBook.sort(byName); bSlack.sort(byName);
  const renderRow = (p) => {
    const ini = initials(p.name||'');
    const photoImg = p.photo ? '<img src="'+escapeHtml(p.photo)+'" alt="" onerror="this.remove()">' : '';
    const sc = ' ' + _proposedSectionClass(p);
    const slackTag = p._slackOnly ? '<span class="proposed-dd-ext" style="background:#f3f4f6;color:#6b7280">no tasks</span>' : (p.external ? '<span class="proposed-dd-ext">extended</span>' : '');
    return '<div class="proposed-dd-item'+sc+'" data-pid="'+escapeHtml(p.id)+'">' +
      '<span class="av-mini" style="background:'+(p.color||'#9a9a9a')+'">'+photoImg+'<span class="ini">'+escapeHtml(ini)+'</span></span>' +
      '<div class="proposed-dd-meta"><div class="proposed-dd-name">'+escapeHtml(p.name||'')+'</div>' +
      '<div class="proposed-dd-email">'+escapeHtml(p.email||'')+'</div></div>' +
      slackTag +
      '</div>';
  };
  const header = (label) => '<div class="proposed-dd-section">'+escapeHtml(label)+'</div>';
  let html = '';
  if (bTeam.length)  html += header('Team')          + bTeam.map(renderRow).join('');
  if (bSupp.length)  html += header('Supplementary') + bSupp.map(renderRow).join('');
  if (bBook.length)  html += header('Bookline')      + bBook.map(renderRow).join('');
  if (bSlack.length) html += header('Bookline · No tasks yet') + bSlack.map(renderRow).join('');
  dd.innerHTML = html;
  dd.style.display = '';
  dd.querySelectorAll('.proposed-dd-item').forEach(it => {
    it.addEventListener('click', e => {
      e.stopPropagation();
      const pid = it.dataset.pid;
      // Auto-promote Slack-only people into customMembers so the chip and downstream
      // task rendering work consistently.
      try { if (typeof bnEnsurePersonExists === 'function') bnEnsurePersonExists(pid); } catch(_) {}
      if (!proposedSelectedIds.includes(pid)) proposedSelectedIds.push(pid);
      const inp = document.getElementById('f_proposedInput');
      inp.value = '';
      refreshProposedChips();
      filterProposedDropdown('');
      inp.focus();
    });
  });
}

// =========================== Responsible (single-select photo picker) ===========================
// Backed by the hidden input #f_responsibleId so existing save code keeps working.
// Source list: Team + Supplementary members. Disabled members are excluded.
let _respPickerSelectedId = '';
let _respPickerActiveIndex = -1;
function _respPickerAvatarHtml(p) {
  const ini = (typeof initials === 'function') ? initials(p.name||'') : (p.name||'?').slice(0,1).toUpperCase();
  const color = p.color || '#9a9a9a';
  const photoImg = p.photo ? '<img src="'+escapeHtml(p.photo)+'" alt="" onerror="this.remove()">' : '';
  return '<span class="av-mini" style="background:'+color+'">'+photoImg+'<span>'+escapeHtml(ini)+'</span></span>';
}
function _respPickerCandidates() {
  // Only team + supplementary; disabled excluded. Sort: team first (alphabetical), then supplementary.
  const all = [...TEAM, ...((typeof EXTERNAL_TEAM !== 'undefined') ? EXTERNAL_TEAM : [])];
  const team = [], supp = [];
  const seen = new Set();
  all.forEach(p => {
    if (!p || seen.has(p.id)) return;
    seen.add(p.id);
    const sec = (typeof getPersonSection === 'function') ? getPersonSection(p.id) : '';
    if (sec === 'team') team.push(p);
    else if (sec === 'supplementary') supp.push(p);
    // disabled or empty section → excluded from picker
  });
  const byName = (a,b) => (a.displayName||a.name||'').localeCompare(b.displayName||b.name||'');
  team.sort(byName); supp.sort(byName);
  return { team, supp };
}
function setResponsiblePicker(id) {
  _respPickerSelectedId = id || '';
  const hidden = document.getElementById('f_responsibleId');
  if (hidden) hidden.value = _respPickerSelectedId;
  const chip = document.getElementById('f_responsibleChip');
  if (!chip) return;
  if (!_respPickerSelectedId) {
    chip.innerHTML = '<span class="resp-picker-empty">— Select a person…</span><span class="resp-picker-caret">▾</span>';
    return;
  }
  const p = (typeof findPerson === 'function') ? findPerson(_respPickerSelectedId) : null;
  if (!p) {
    chip.innerHTML = '<span class="resp-picker-empty">' + escapeHtml(_respPickerSelectedId) + '</span><button type="button" class="resp-picker-clear" title="Clear">×</button><span class="resp-picker-caret">▾</span>';
  } else {
    chip.innerHTML =
      _respPickerAvatarHtml(p) +
      '<span class="resp-picker-name">' + escapeHtml(p.displayName || p.name || '?') + '</span>' +
      '<button type="button" class="resp-picker-clear" title="Clear">×</button>' +
      '<span class="resp-picker-caret">▾</span>';
  }
  const clr = chip.querySelector('.resp-picker-clear');
  if (clr) clr.addEventListener('click', e => { e.stopPropagation(); setResponsiblePicker(''); });
}
function _respPickerRenderList(query) {
  const list = document.getElementById('f_responsibleList');
  if (!list) return;
  const q = (query||'').trim().toLowerCase();
  const { team, supp } = _respPickerCandidates();
  const matches = p => !q || (p.name||'').toLowerCase().includes(q) ||
                              (p.displayName||'').toLowerCase().includes(q) ||
                              (p.email||'').toLowerCase().includes(q);
  const teamMatches = team.filter(matches);
  const suppMatches = supp.filter(matches);
  let html = '';
  if (teamMatches.length === 0 && suppMatches.length === 0) {
    html = '<div class="resp-picker-empty-state">No matches</div>';
  } else {
    if (teamMatches.length > 0) {
      html += '<div class="resp-picker-section-label">Team</div>';
      teamMatches.forEach(p => {
        html += '<div class="resp-picker-item" data-pid="' + escapeHtml(p.id) + '">' +
          _respPickerAvatarHtml(p) +
          '<div class="resp-picker-item-meta"><div class="resp-picker-item-name">' + escapeHtml(p.displayName || p.name || '?') + '</div>' +
          (p.email ? '<div class="resp-picker-item-email">' + escapeHtml(p.email) + '</div>' : '') + '</div>' +
          '</div>';
      });
    }
    if (suppMatches.length > 0) {
      html += '<div class="resp-picker-section-label">Supplementary</div>';
      suppMatches.forEach(p => {
        html += '<div class="resp-picker-item" data-pid="' + escapeHtml(p.id) + '">' +
          _respPickerAvatarHtml(p) +
          '<div class="resp-picker-item-meta"><div class="resp-picker-item-name">' + escapeHtml(p.displayName || p.name || '?') + '</div>' +
          (p.email ? '<div class="resp-picker-item-email">' + escapeHtml(p.email) + '</div>' : '') + '</div>' +
          '</div>';
      });
    }
  }
  list.innerHTML = html;
  _respPickerActiveIndex = -1;
  list.querySelectorAll('.resp-picker-item').forEach(it => {
    it.addEventListener('mousedown', e => { e.preventDefault(); }); // keep input focus
    it.addEventListener('click', () => {
      setResponsiblePicker(it.dataset.pid);
      _respPickerCloseDropdown();
    });
  });
}
function _respPickerOpenDropdown() {
  const dd = document.getElementById('f_responsibleDropdown');
  if (!dd) return;
  dd.style.display = '';
  const inp = document.getElementById('f_responsibleInput');
  if (inp) { inp.value = ''; inp.focus(); }
  _respPickerRenderList('');
}
function _respPickerCloseDropdown() {
  const dd = document.getElementById('f_responsibleDropdown');
  if (dd) dd.style.display = 'none';
}
(function wireResponsiblePicker(){
  const chip = document.getElementById('f_responsibleChip');
  const dd = document.getElementById('f_responsibleDropdown');
  const inp = document.getElementById('f_responsibleInput');
  if (!chip || !dd || !inp) return;
  chip.addEventListener('click', e => {
    if (e.target && e.target.classList && e.target.classList.contains('resp-picker-clear')) return;
    if (dd.style.display === 'none' || !dd.style.display) _respPickerOpenDropdown();
    else _respPickerCloseDropdown();
  });
  chip.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _respPickerOpenDropdown(); }
  });
  inp.addEventListener('input', () => _respPickerRenderList(inp.value));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') { _respPickerCloseDropdown(); chip.focus(); return; }
    const items = Array.from(dd.querySelectorAll('.resp-picker-item'));
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _respPickerActiveIndex = Math.min(items.length - 1, _respPickerActiveIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _respPickerActiveIndex = Math.max(0, _respPickerActiveIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = _respPickerActiveIndex >= 0 ? _respPickerActiveIndex : 0;
      const it = items[idx];
      if (it) { setResponsiblePicker(it.dataset.pid); _respPickerCloseDropdown(); }
      return;
    } else { return; }
    items.forEach(it => it.classList.remove('active'));
    if (items[_respPickerActiveIndex]) {
      items[_respPickerActiveIndex].classList.add('active');
      items[_respPickerActiveIndex].scrollIntoView({ block: 'nearest' });
    }
  });
  document.addEventListener('click', e => {
    const box = document.getElementById('f_responsibleBox');
    if (!box) return;
    if (!box.contains(e.target)) _respPickerCloseDropdown();
  });
})();

// =========================== Custom colored picklist component ===========================
// Native <option> elements can't be styled on macOS native popups. We render a custom
// chip + dropdown that visually applies the option's bg/fg/border, and write the chosen
// value into a hidden input with the same id as the original <select> so all existing
// read/write code (e.g. `document.getElementById('f_slackStatus').value`) keeps working.
const COLORED_PICKLIST_OPTIONS = {
  f_slackStatus: [
    { value: '',              label: '(empty)',      bg: '#ffffff', fg: '#6b6b6b', border: '#d8d6d1' },
    { value: 'Waiting',       label: 'Waiting',      bg: '#e0f2fe', fg: '#0369a1', border: '#7dd3fc' },
    { value: 'Proposed',      label: 'Proposed',     bg: '#c7d2fe', fg: '#1e3a8a', border: '#818cf8' },
    { value: 'Later / Next',  label: 'Later / Next', bg: '#fee2e2', fg: '#b91c1c', border: '#fca5a5' },
    { value: 'In Progress',   label: 'In Progress',  bg: '#ffedd5', fg: '#9a3412', border: '#fed7aa' },
    { value: 'Under Review',  label: 'Under Review', bg: '#ede9fe', fg: '#5b21b6', border: '#c4b5fd' },
    { value: 'Completed',     label: 'Completed',    bg: '#ecfdf3', fg: '#027a48', border: '#a7f3d0' },
    { value: 'Archived',      label: 'Archived',     bg: '#f5efe6', fg: '#78350f', border: '#d6c5a8' },
    { value: 'Discarded',     label: 'Discarded',    bg: '#f1f5f9', fg: '#64748b', border: '#d8d6d1' },
  ],
  f_priority: [
    { value: '',          label: '(empty)',   bg: '#ffffff', fg: '#6b6b6b', border: '#d8d6d1' },
    { value: 'Critical',  label: 'Critical',  bg: '#fee4e2', fg: '#b42318', border: '#fecaca' },
    { value: 'High',      label: 'High',      bg: '#fef0c7', fg: '#b54708', border: '#fde68a' },
    { value: 'Medium',     label: 'Medium',     bg: '#d1fadf', fg: '#027a48', border: '#a7f3d0' },
    { value: 'Low',      label: 'Low',      bg: '#dbeafe', fg: '#1d4ed8', border: '#bfdbfe' },
    { value: 'Very Low', label: 'Very Low', bg: '#1e3a8a', fg: '#ffffff', border: '#1e3a8a' },
  ],
  f_type: [
    { value: '',               label: '(empty)',        bg: '#ffffff', fg: '#6b6b6b', border: '#d8d6d1' },
    { value: 'Project',        label: 'Project',        bg: '#f4ebff', fg: '#6941c6', border: '#d6bbfb' },
    { value: 'Responsability', label: 'Responsability', bg: '#e0eaff', fg: '#3538cd', border: '#c7d7fe' },
    { value: 'Request',        label: 'Request',        bg: '#ecfdf3', fg: '#027a48', border: '#a7f3d0' },
    { value: 'ERROR',          label: 'ERROR',          bg: '#fee4e2', fg: '#b42318', border: '#fecaca' },
    { value: 'Infinite',       label: 'Infinite',       bg: '#fef0c7', fg: '#92400e', border: '#fde68a' },
  ],
  f_shareWith: [
    { value: '',         label: '(empty)',  bg: '#ffffff', fg: '#6b6b6b', border: '#d8d6d1' },
    { value: 'Private',  label: 'Private',  bg: '#fee2e2', fg: '#b91c1c', border: '#fca5a5' },
    { value: 'Team',     label: 'Team',     bg: '#cffafe', fg: '#0e7490', border: '#67e8f9' },
    { value: 'Everyone', label: 'Everyone', bg: '#1a1a1a', fg: '#ffffff', border: '#1a1a1a' },
  ],
};
function setColoredPicker(id, value) {
  const opts = COLORED_PICKLIST_OPTIONS[id];
  if (!opts) return;
  const opt = opts.find(o => o.value === value) || opts[0];
  const box = document.querySelector('[data-cp-id="' + id + '"]');
  if (!box) return;
  const chip = box.querySelector('.bn-cp-chip');
  const hidden = box.querySelector('input[type="hidden"]');
  if (hidden) hidden.value = opt.value;
  if (chip) {
    chip.style.background = opt.bg;
    chip.style.color = opt.fg;
    chip.style.borderColor = opt.border;
    const labelEl = chip.querySelector('.bn-cp-label');
    if (labelEl) labelEl.textContent = opt.label;
    const caretEl = chip.querySelector('.bn-cp-caret');
    if (caretEl) caretEl.style.color = opt.fg;
  }
  // Mark active in dropdown if rendered
  const dd = box.querySelector('.bn-cp-dropdown');
  if (dd) {
    dd.querySelectorAll('.bn-cp-item').forEach(it => {
      it.classList.toggle('active', it.dataset.value === opt.value);
    });
  }
}
(function wireColoredPickers(){
  Object.keys(COLORED_PICKLIST_OPTIONS).forEach(id => {
    const box = document.querySelector('[data-cp-id="' + id + '"]');
    if (!box) return;
    const chip = box.querySelector('.bn-cp-chip');
    const dd = box.querySelector('.bn-cp-dropdown');
    if (!chip || !dd) return;
    // Build items
    const opts = COLORED_PICKLIST_OPTIONS[id];
    dd.innerHTML = opts.map(o =>
      '<div class="bn-cp-item" data-value="' + escapeHtml(o.value) + '" style="background:' + o.bg + '; color:' + o.fg + '">' +
        '<span class="bn-cp-check">' + '</span>' +
        '<span>' + escapeHtml(o.label) + '</span>' +
      '</div>'
    ).join('');
    // Wire items
    dd.querySelectorAll('.bn-cp-item').forEach(it => {
      it.addEventListener('click', e => {
        e.stopPropagation();
        setColoredPicker(id, it.dataset.value);
        dd.style.display = 'none';
      });
    });
    // Toggle dropdown
    chip.addEventListener('click', () => {
      dd.style.display = (dd.style.display === 'none' || !dd.style.display) ? '' : 'none';
    });
    chip.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); }
      else if (e.key === 'Escape') dd.style.display = 'none';
    });
    // Close on outside click
    document.addEventListener('click', e => {
      if (!box.contains(e.target)) dd.style.display = 'none';
    });
    // Initial state
    setColoredPicker(id, '');
    // Update check mark on each item (set after items render, so the active state initialises)
    dd.querySelectorAll('.bn-cp-item').forEach(it => {
      const checkEl = it.querySelector('.bn-cp-check');
      if (checkEl) checkEl.textContent = '';
    });
  });
})();
// Re-render check marks on the active item whenever selection changes (visual cue inside dropdown).
const _origSetColoredPicker = setColoredPicker;
setColoredPicker = function(id, value) {
  _origSetColoredPicker(id, value);
  const box = document.querySelector('[data-cp-id="' + id + '"]');
  if (!box) return;
  const dd = box.querySelector('.bn-cp-dropdown');
  if (!dd) return;
  dd.querySelectorAll('.bn-cp-item').forEach(it => {
    const check = it.querySelector('.bn-cp-check');
    if (!check) return;
    check.textContent = (it.dataset.value === (document.getElementById(id) || {}).value) ? '✓' : '';
  });
};

(function wireProposedPicker(){
  const inp = document.getElementById('f_proposedInput');
  if (!inp) return;
  inp.addEventListener('focus', () => filterProposedDropdown(inp.value));
  inp.addEventListener('input', () => filterProposedDropdown(inp.value));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !inp.value && proposedSelectedIds.length > 0) {
      proposedSelectedIds.pop();
      refreshProposedChips();
      filterProposedDropdown('');
    } else if (e.key === 'Escape') {
      document.getElementById('f_proposedDropdown').style.display = 'none';
    }
  });
  // Close dropdown on outside click
  document.addEventListener('click', e => {
    const box = document.getElementById('f_proposedBox');
    if (!box) return;
    if (!box.contains(e.target)) {
      const dd = document.getElementById('f_proposedDropdown');
      if (dd) dd.style.display = 'none';
    }
  });
})();

// Legacy name kept; now drives the searchable group picker (chip + dropdown).
let _groupPickerExcludeTaskId = '';
function _groupPickerCandidates(excludeTaskId) {
  return (STORE.tasks || [])
    .filter(x => x.isGroup && x.id !== excludeTaskId)
    .slice()
    .sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
}
function _groupPickerRenderChip(currentGroupId) {
  const chip = document.getElementById('f_groupChip');
  const inp = document.getElementById('f_groupInput');
  const icon = document.getElementById('f_groupIcon');
  const clr = document.getElementById('f_groupClear');
  if (!chip || !inp) return;
  if (!currentGroupId) {
    chip.removeAttribute('data-status');
    inp.value = '';
    inp.placeholder = '— No group —';
    if (icon) icon.style.display = 'none';
    if (clr) clr.style.display = 'none';
    return;
  }
  const g = (STORE.tasks || []).find(x => x.id === currentGroupId);
  if (!g) {
    chip.removeAttribute('data-status');
    inp.value = '';
    inp.placeholder = '(missing group)';
    if (icon) icon.style.display = 'none';
    if (clr) clr.style.display = '';
  } else {
    if (g.slackStatus) chip.setAttribute('data-status', g.slackStatus);
    else chip.removeAttribute('data-status');
    inp.value = g.subject || '(unnamed)';
    inp.placeholder = '— No group —';
    if (icon) icon.style.display = '';
    if (clr) clr.style.display = '';
  }
}
function _groupPickerRenderList(query) {
  const list = document.getElementById('f_groupList');
  if (!list) return;
  const q = (query || '').trim().toLowerCase();
  const cands = _groupPickerCandidates(_groupPickerExcludeTaskId).filter(g => !q || (g.subject||'').toLowerCase().includes(q));
  if (cands.length === 0) {
    list.innerHTML = '<div class="group-picker-empty-state">No matches</div>';
  } else {
    list.innerHTML = cands.map(g => {
      const status = g.slackStatus || '';
      return '<div class="group-picker-item" data-gid="' + escapeHtml(g.id) + '">' +
        '<span class="folder-emoji" style="font-size:14px">📁</span>' +
        '<span class="gpi-name">' + escapeHtml(g.subject || '(unnamed)') + '</span>' +
        (status ? '<span class="gpi-status" data-status="' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>' : '') +
        '</div>';
    }).join('');
    list.querySelectorAll('.group-picker-item').forEach(it => {
      it.addEventListener('mousedown', e => e.preventDefault());
      it.addEventListener('click', () => {
        refreshGroupSelectOptions(it.dataset.gid, _groupPickerExcludeTaskId);
        const dd = document.getElementById('f_groupDropdown');
        if (dd) dd.style.display = 'none';
      });
    });
  }
}
function refreshGroupSelectOptions(currentGroupId, excludeTaskId) {
  _groupPickerExcludeTaskId = excludeTaskId || '';
  const hidden = document.getElementById('f_groupId');
  if (hidden) hidden.value = currentGroupId || '';
  _groupPickerRenderChip(currentGroupId || '');
}
// Positions the group dropdown over the chip using viewport coordinates so it
// overlays the modal instead of pushing its content down. Called every time the
// dropdown opens (chip click) and on window resize/scroll while it's open.
function _bnPositionGroupDropdown() {
  const chip = document.getElementById('f_groupChip');
  const dd = document.getElementById('f_groupDropdown');
  if (!chip || !dd) return;
  const r = chip.getBoundingClientRect();
  dd.style.left = r.left + 'px';
  dd.style.width = r.width + 'px';
  // Place below first so we can measure actual rendered height.
  dd.style.top = (r.bottom + 4) + 'px';
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const ddH = dd.offsetHeight || 280;
  const spaceBelow = vh - r.bottom - 8;
  const spaceAbove = r.top - 8;
  // Flip up only when it doesn't fit below AND there's more room above.
  if (ddH > spaceBelow && spaceAbove > spaceBelow) {
    const top = Math.max(8, r.top - ddH - 4);
    dd.style.top = top + 'px';
  }
}
(function wireGroupPicker(){
  const chip = document.getElementById('f_groupChip');
  const dd = document.getElementById('f_groupDropdown');
  const inp = document.getElementById('f_groupInput');
  const clr = document.getElementById('f_groupClear');
  if (!chip || !dd || !inp) return;
  function openAndRender(query) {
    dd.style.display = '';
    _groupPickerRenderList(query || '');
    // Reposition AFTER the list is rendered so the dropdown's actual
    // height is known — required for the flip-up logic to kick in.
    _bnPositionGroupDropdown();
  }
  // Click anywhere inside the chip (the surrounding row) → focus the input.
  chip.addEventListener('click', e => {
    if (e.target === inp) return;          // already targeted
    if (e.target && e.target.id === 'f_groupClear') return;
    inp.focus();
    inp.select();
  });
  // Focus on the input → show the FULL list (use empty query, since the input
  // value when focused is the current group's name and we don't want that to
  // filter the list down to one item).
  inp.addEventListener('focus', () => {
    inp.select();
    openAndRender('');
  });
  inp.addEventListener('input', () => {
    openAndRender(inp.value);
  });
  inp.addEventListener('blur', () => {
    // Defer so the click on a list item can register first.
    setTimeout(() => {
      dd.style.display = 'none';
      // Restore the input to show the current selected group's name.
      _groupPickerRenderChip(document.getElementById('f_groupId').value || '');
    }, 120);
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      dd.style.display = 'none';
      inp.blur();
    }
  });
  if (clr) clr.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    refreshGroupSelectOptions('', _groupPickerExcludeTaskId);
    dd.style.display = 'none';
  });
  // Reposition when the user scrolls inside the modal or resizes the window.
  window.addEventListener('scroll', () => { if (dd.style.display !== 'none') _bnPositionGroupDropdown(); }, true);
  window.addEventListener('resize', () => { if (dd.style.display !== 'none') _bnPositionGroupDropdown(); });
})();

function applyGroupModeToModal(isGroup) {
  // Tasks now keep ALL their own fields whether or not isGroup is on.
  // The checkbox just enables the Subtasks panel and shows children.
  document.querySelectorAll(".f_taskOnlyRow").forEach(el => { el.style.display = ""; });
  document.getElementById("f_groupRow").style.display = "";
  document.getElementById("f_extraCommentsLabel").textContent = "Extra comments";
  // Show/hide the inner subtasks panel (the field + checkbox stay visible always)
  const subPanel = document.getElementById("f_subtasksPanel");
  if (subPanel) subPanel.style.display = isGroup ? "" : "none";
  // Title hint
  const subjInp = document.getElementById("f_subject");
  if (subjInp) subjInp.placeholder = isGroup ? "e.g. Q4 Redesign Project (this task contains others)" : "";
}

