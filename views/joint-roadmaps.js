// =============================================================================
// views/joint-roadmaps.js
// ---------------------------------------------------------------------------
// "Joint Roadmaps" view — a single 6MFN (6-month forward) Gantt that merges
// tasks from any combination of roadmaps the admin selects. Activated via a
// "Joint" toggle next to the roadmap name picker on the Roadmaps page.
//
// Loaded AFTER views/roadmap-calendar.js so it can reuse globals like
// roadmapCalState.halfYearAnchor (we DON'T mutate it; we keep our own anchor).
//
// Persistent state:
//   localStorage 'bn-joint-mode'      → '1' when joint mode active
//   localStorage 'bn-joint-selection' → JSON array of roadmap ids
//   localStorage 'bn-joint-anchor'    → ISO YYYY-MM-DD first-of-month anchor
//
// Globals exposed:
//   window.bnIsJointMode()
//   window.bnSetJointMode(on)
//   window.bnGetJointSelection()  → Set<rmId>
//   window.bnToggleJointSelection(rmId)
//   window.renderJointRoadmapsView()
//
// The view is read-only: no drag-to-reschedule, no inline editing. Clicking a
// task title still opens the task modal so the user can edit there.
// =============================================================================

function bnIsJointMode() {
  return localStorage.getItem('bn-joint-mode') === '1';
}
function bnSetJointMode(on) {
  if (on) localStorage.setItem('bn-joint-mode', '1');
  else localStorage.removeItem('bn-joint-mode');
}
function bnGetJointSelection() {
  try {
    const raw = localStorage.getItem('bn-joint-selection');
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (_) { return new Set(); }
}
function bnSetJointSelection(set) {
  try {
    localStorage.setItem('bn-joint-selection', JSON.stringify(Array.from(set)));
  } catch (_) {}
}
function bnToggleJointSelection(rmId) {
  const sel = bnGetJointSelection();
  if (sel.has(rmId)) sel.delete(rmId);
  else sel.add(rmId);
  bnSetJointSelection(sel);
}
function bnJointSelectAll() {
  const rms = (typeof getRoadmaps === 'function') ? getRoadmaps() : (STORE.roadmaps || []);
  bnSetJointSelection(new Set(rms.map(r => r.id)));
}
function bnJointClearSelection() {
  bnSetJointSelection(new Set());
}
// 6m anchor lives here so we don't fight with single-roadmap's halfYearAnchor.
function bnJointGetAnchor() {
  const raw = localStorage.getItem('bn-joint-anchor');
  if (raw) {
    const d = parseDate(raw);
    if (d) return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), 1);
}
function bnJointSetAnchor(d) {
  const a = new Date(d.getFullYear(), d.getMonth(), 1);
  try { localStorage.setItem('bn-joint-anchor', dateKey(a)); } catch (_) {}
}
window.bnIsJointMode = bnIsJointMode;
window.bnSetJointMode = bnSetJointMode;
window.bnGetJointSelection = bnGetJointSelection;
window.bnToggleJointSelection = bnToggleJointSelection;

// Status color map (kept aligned with the per-roadmap calendar).
const BN_JOINT_STATUS_COLORS = {
  "": "#cbd5e1",
  "Waiting": "#60a5fa", "Proposed": "#1d4ed8", "Later / Next": "#dc2626",
  "In Progress": "#f97316", "Under Review": "#7c3aed", "Completed": "#16a34a",
  "Archived": "#a98c5a", "Discarded": "#9a9a9a"
};

// Build the list of events from selected roadmaps. Each event = one task per
// roadmap entry; if the same task appears in multiple selected roadmaps we
// still only render ONE row (the task's effective dates are roadmap-agnostic),
// but we collect the set of roadmap ids so we can show badges.
function bnJointBuildEvents(selectedRmIds) {
  const FAR_FUTURE = new Date(2099, 11, 31);
  const rms = (typeof getRoadmaps === 'function') ? getRoadmaps() : (STORE.roadmaps || []);
  const byTaskId = new Map(); // taskId → { task, start, end, openEnded, roadmapIds: Set }
  rms.forEach(rm => {
    if (!selectedRmIds.has(rm.id)) return;
    (rm.tasks || []).forEach(entry => {
      const task = (STORE.tasks || []).find(t => t.id === entry.taskId);
      if (!task) return;
      const eff = (typeof effectiveDatesForTask === 'function')
        ? effectiveDatesForTask(task)
        : { startStr: task.startDate || '', endStr: task.endDate || '' };
      const start = parseDate(eff.startStr);
      if (!start) return;   // unscheduled — skip in joint view
      const end = parseDate(eff.endStr) || FAR_FUTURE;
      const existing = byTaskId.get(task.id);
      if (existing) {
        existing.roadmapIds.add(rm.id);
      } else {
        byTaskId.set(task.id, {
          task, start, end,
          openEnded: !parseDate(eff.endStr),
          roadmapIds: new Set([rm.id]),
        });
      }
    });
  });
  return Array.from(byTaskId.values());
}

function renderJointRoadmapsView() {
  const cont = document.getElementById('rmPageContent');
  if (!cont) return;
  const allRoadmaps = (typeof getRoadmaps === 'function') ? getRoadmaps() : (STORE.roadmaps || []);
  // Default selection on first entry: pick all roadmaps so the user sees something.
  let selected = bnGetJointSelection();
  if (selected.size === 0) {
    selected = new Set(allRoadmaps.map(r => r.id));
    bnSetJointSelection(selected);
  }
  // ----- Summary card with joint toggle + multi-select chip picker -----
  let html = '<div class="rm-summary-card bn-joint-summary">' +
    '<div class="bn-joint-toggle-row">' +
      '<div class="rm-name-trigger active" id="rmNameTrigger" title="Switch to single-roadmap view">' +
        '<div class="rm-summary-name">Joint roadmaps</div>' +
      '</div>' +
      '<button type="button" class="btn bn-joint-toggle-btn active" id="bnJointToggleBtn" title="Currently in joint mode. Click to switch back to single-roadmap view.">Joint</button>' +
    '</div>' +
    '<div class="bn-joint-chips" id="bnJointChips">';
  if (allRoadmaps.length === 0) {
    html += '<div class="rm-empty" style="margin:0">No roadmaps yet.</div>';
  } else {
    html += '<button type="button" class="bn-joint-chip-action" id="bnJointChipAll" title="Select all roadmaps">All</button>';
    html += '<button type="button" class="bn-joint-chip-action" id="bnJointChipNone" title="Clear selection">None</button>';
    allRoadmaps.forEach(rm => {
      const isSel = selected.has(rm.id);
      const cnt = (rm.tasks || []).length;
      html += '<button type="button" class="bn-joint-chip' + (isSel ? ' selected' : '') + '" data-rm="' + escapeHtml(rm.id) + '" title="' + escapeHtml(rm.name || '') + ' · ' + cnt + ' task' + (cnt === 1 ? '' : 's') + '">' +
        escapeHtml(rm.name || '(unnamed)') +
        '<span class="bn-joint-chip-cnt">' + cnt + '</span>' +
      '</button>';
    });
  }
  html += '</div></div>';
  cont.innerHTML = html;

  // Wire the Joint toggle: clicking switches back to single mode.
  const toggleBtn = document.getElementById('bnJointToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      bnSetJointMode(false);
      if (typeof renderRoadmapsTimelinePage === 'function') renderRoadmapsTimelinePage();
    });
  }
  // The name trigger also bounces back to single mode (it's just a label hint).
  const nmTrig = document.getElementById('rmNameTrigger');
  if (nmTrig) {
    nmTrig.addEventListener('click', () => {
      bnSetJointMode(false);
      if (typeof renderRoadmapsTimelinePage === 'function') renderRoadmapsTimelinePage();
    });
  }
  // Wire chips: each click toggles inclusion of that roadmap in the selection.
  document.querySelectorAll('#bnJointChips .bn-joint-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const rmId = chip.dataset.rm;
      bnToggleJointSelection(rmId);
      renderJointRoadmapsView();
    });
  });
  const allBtn = document.getElementById('bnJointChipAll');
  if (allBtn) allBtn.addEventListener('click', () => { bnJointSelectAll(); renderJointRoadmapsView(); });
  const noneBtn = document.getElementById('bnJointChipNone');
  if (noneBtn) noneBtn.addEventListener('click', () => { bnJointClearSelection(); renderJointRoadmapsView(); });

  // ----- 6m grid + events -----
  const events = bnJointBuildEvents(selected);
  // Anchor (first-of-month) for the 6m window
  const anchor = bnJointGetAnchor();
  const firstOfMonth = new Date(anchor);
  const lastOfMonth  = new Date(anchor.getFullYear(), anchor.getMonth() + 6, 0);
  firstOfMonth.setHours(0,0,0,0);
  lastOfMonth.setHours(0,0,0,0);

  const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const endMonthIdx = (anchor.getMonth() + 5) % 12;
  const endYear = anchor.getFullYear() + Math.floor((anchor.getMonth() + 5) / 12);
  const sameYear = anchor.getFullYear() === endYear;
  const periodLabel = sameYear
    ? monthNames[anchor.getMonth()].slice(0,3) + ' – ' + monthNames[endMonthIdx].slice(0,3) + ' ' + anchor.getFullYear()
    : monthNames[anchor.getMonth()].slice(0,3) + ' ' + anchor.getFullYear() + ' – ' + monthNames[endMonthIdx].slice(0,3) + ' ' + endYear;

  let calHtml = '<div class="rm-content-row no-side"><div class="rm-cal-area">';
  calHtml += '<div class="rm-toolbar">' +
    '<div class="cal-nav">' +
      '<button class="btn" id="bnJointPrev" title="Previous month">◀</button>' +
      '<span class="cal-period-label">' + escapeHtml(periodLabel) + '</span>' +
      '<button class="btn" id="bnJointNext" title="Next month">▶</button>' +
      '<button class="btn" id="bnJointToday" style="margin-left:8px" title="Jump to current month">Today</button>' +
    '</div>' +
    '<div class="cal-views">' +
      '<button class="cal-view-btn active" disabled title="Joint roadmaps only render in 6 MFN view">6 MFN</button>' +
    '</div>' +
  '</div>';

  // 6m horizontal Gantt (mirrors the year/6m grid in renderRoadmapCalendar).
  const yearStartMs = firstOfMonth.getTime();
  const yearEndMs = lastOfMonth.getTime();
  const daysInYear = Math.round((yearEndMs - yearStartMs) / DAY_MS) + 1;
  const monthCount = 6;
  const monthStarts = [];
  const monthDays   = [];
  for (let mi = 0; mi < monthCount; mi++) {
    const ms = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + mi, 1);
    const me = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + mi + 1, 0);
    monthStarts.push(ms);
    monthDays.push(me.getDate());
  }
  const monthsGridTemplate = monthDays.map(d => d + 'fr').join(' ');

  // Sort: groups first with their children right after, then standalone tasks by date.
  const evByTaskId = {};
  events.forEach(e => { evByTaskId[e.task.id] = e; });
  const childrenByParent = {};
  events.forEach(e => {
    if (e.task.groupId && evByTaskId[e.task.groupId]) {
      (childrenByParent[e.task.groupId] = childrenByParent[e.task.groupId] || []).push(e);
    }
  });
  const orderedRows = [];
  const seen = new Set();
  const _pushSubtree = (e, depth) => {
    if (seen.has(e.task.id)) return;
    orderedRows.push({ ev: e, depth });
    seen.add(e.task.id);
    if (!e.task.isGroup) return;
    if (typeof isGroupExpanded === 'function' && !isGroupExpanded(e.task.id)) return;
    const kids = (childrenByParent[e.task.id] || []).slice().sort(
      (x, y) => (x.start - y.start) || (x.task.subject || '').localeCompare(y.task.subject || '')
    );
    kids.forEach(c => _pushSubtree(c, depth + 1));
  };
  events
    .filter(e => !e.task.groupId || !evByTaskId[e.task.groupId])
    .sort((a, b) => (a.start - b.start) || (a.task.subject || '').localeCompare(b.task.subject || ''))
    .forEach(e => _pushSubtree(e, 0));

  calHtml += '<div class="cal-year">';
  calHtml += '<div class="cal-year-headers">' +
              '<div class="cal-year-label-spacer"></div>' +
              '<div class="cal-year-months" style="grid-template-columns: ' + monthsGridTemplate + '">';
  for (let mi = 0; mi < monthCount; mi++) {
    const ms = monthStarts[mi];
    const lbl = monthNames[ms.getMonth()].slice(0,3) + ' ' + String(ms.getFullYear()).slice(2);
    calHtml += '<div class="cal-year-month-cell">' + lbl + '</div>';
  }
  calHtml += '</div></div>';

  // Today line
  let todayLineYearHtml = '';
  const yearToday = new Date(); yearToday.setHours(0,0,0,0);
  if (yearToday.getTime() >= yearStartMs && yearToday.getTime() <= yearEndMs) {
    const off = Math.round((yearToday.getTime() - yearStartMs) / DAY_MS);
    const leftPct = (off / daysInYear) * 100;
    todayLineYearHtml = '<div class="cal-year-today-line" style="left:calc(' + leftPct + '% )"></div>';
  }
  calHtml += '<div class="cal-year-rows-wrap">';
  calHtml += '<div class="cal-year-track-bg"><div class="cal-year-months-bg" style="grid-template-columns: ' + monthsGridTemplate + '">';
  for (let mi = 0; mi < monthCount; mi++) {
    calHtml += '<div class="cal-year-month-bg' + (mi % 2 ? ' alt' : '') + '"></div>';
  }
  calHtml += todayLineYearHtml + '</div></div>';
  calHtml += '<div class="cal-year-rows">';

  if (orderedRows.length === 0) {
    if (selected.size === 0) {
      calHtml += '<div class="rm-empty" style="margin:14px">Pick one or more roadmaps above to see their tasks here.</div>';
    } else {
      calHtml += '<div class="rm-empty" style="margin:14px">No scheduled tasks in this range across the selected roadmaps.</div>';
    }
  } else {
    orderedRows.forEach((row) => {
      const ev = row.ev;
      const isG = !!ev.task.isGroup;
      const startMs = Math.max(ev.start.getTime(), yearStartMs);
      const endMs   = Math.min(ev.end.getTime(),   yearEndMs);
      if (endMs < startMs) return;
      const off = Math.round((startMs - yearStartMs) / DAY_MS);
      const span = Math.round((endMs - startMs) / DAY_MS) + 1;
      const leftPct  = (off  / daysInYear) * 100;
      const widthPct = (span / daysInYear) * 100;
      const stHex = BN_JOINT_STATUS_COLORS[ev.task.slackStatus] || (isG ? '#d97706' : '#1a1a1a');
      const barStyle = isG
        ? 'background: transparent; border:1.5px dashed ' + stHex + '; color:' + stHex + '; font-weight:700;'
        : 'background:' + stHex + '; color:#fff;';
      const owner = ev.task.responsibleId ? findPerson(ev.task.responsibleId) : null;
      const avatar = owner
        ? '<span class="cal-year-bar-av" style="background:' + escapeHtml(owner.color || '#9a9a9a') + '"><img src="' + escapeHtml(owner.photo || '') + '" alt="" onerror="this.remove()"><span class="ini">' + escapeHtml(initials(owner.name || '')) + '</span></span>'
        : '';
      // Build the list of roadmap badges (only the roadmaps this task is in AND that are selected)
      const rmBadges = Array.from(ev.roadmapIds).map(rid => {
        const rm = (STORE.roadmaps || []).find(x => x.id === rid);
        return rm ? '<span class="bn-joint-rm-badge" title="In roadmap: ' + escapeHtml(rm.name || '') + '">' + escapeHtml((rm.name || '').slice(0, 14)) + '</span>' : '';
      }).join('');
      const indent = row.depth * 14;
      calHtml += '<div class="cal-year-row" data-tid="' + escapeHtml(ev.task.id) + '">' +
        '<div class="cal-year-label" style="padding-left:' + (8 + indent) + 'px">' +
          (isG ? '<span style="margin-right:4px">📁</span>' : '') +
          '<button type="button" class="cal-year-label-name bn-joint-task-name" data-tid="' + escapeHtml(ev.task.id) + '" title="Open task">' +
            escapeHtml(ev.task.subject || '(unnamed)') +
          '</button>' +
          (rmBadges ? '<span class="bn-joint-rm-badges">' + rmBadges + '</span>' : '') +
        '</div>' +
        '<div class="cal-year-track" style="grid-template-columns: ' + monthsGridTemplate + '">' +
          '<div class="cal-year-track-inner">' +
            '<div class="cal-year-bar" style="left:' + leftPct + '%; width:' + widthPct + '%; ' + barStyle + '">' +
              avatar +
              '<span class="cal-year-bar-name">' + escapeHtml(ev.task.subject || '') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
  }
  calHtml += '</div></div></div></div>';
  cont.insertAdjacentHTML('beforeend', calHtml);

  // Wire calendar nav
  const prevBtn = document.getElementById('bnJointPrev');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    const a = bnJointGetAnchor();
    bnJointSetAnchor(new Date(a.getFullYear(), a.getMonth() - 1, 1));
    renderJointRoadmapsView();
  });
  const nextBtn = document.getElementById('bnJointNext');
  if (nextBtn) nextBtn.addEventListener('click', () => {
    const a = bnJointGetAnchor();
    bnJointSetAnchor(new Date(a.getFullYear(), a.getMonth() + 1, 1));
    renderJointRoadmapsView();
  });
  const todayBtn = document.getElementById('bnJointToday');
  if (todayBtn) todayBtn.addEventListener('click', () => {
    const t = new Date();
    bnJointSetAnchor(new Date(t.getFullYear(), t.getMonth(), 1));
    renderJointRoadmapsView();
  });
  // Task name → open modal
  document.querySelectorAll('.bn-joint-task-name').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const tid = btn.dataset.tid;
      if (tid && typeof openModal === 'function') openModal(tid);
    });
  });
}
window.renderJointRoadmapsView = renderJointRoadmapsView;
