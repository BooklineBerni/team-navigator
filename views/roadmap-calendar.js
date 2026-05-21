// =============================================================================
// views/roadmap-calendar.js
// ---------------------------------------------------------------------------
// Per-roadmap Gantt-style calendar (Google-Calendar-style). The largest view
// in the app: ~1600 lines of layout/scheduling logic supporting month, week,
// year, and 6-month modes, drag-and-drop, anchor pickers, weekend stripes,
// holidays, time-off, group expansion, etc.
//
// Loaded AFTER the inline app script. Top-level state (roadmapCalState) and
// the bnMondayOf helper live here too. All anchor / date helpers
// (effectiveDatesForTask, bnPropagateAnchorChanges, etc.) stay in inline
// because they are used throughout the app — this file only touches them
// through their already-on-window names at runtime.
// =============================================================================

// ---- Roadmap Calendar (Google Calendar-style) ----
let roadmapCalState = {
  yearMonth: null,
  hideWeekends: localStorage.getItem("bookline-rm-hide-weekends") === "true",
  viewMode: (localStorage.getItem("bookline-rm-view-mode") || "month"),    // "month" | "week" | "year" | "6m"
  weekStart: null,                                                          // Monday of the visible week (Date or null)
  year: null,                                                               // currently-shown year (number) for year view
  halfYearAnchor: null,                                                     // Date (first-of-month) anchoring the 6-month view
  sideHidden: localStorage.getItem("bookline-rm-side-hidden") === "true",   // collapse the Unscheduled/Archived sidebar
};
// Helper: snap a Date to the Monday of its week (Monday-first ISO style)
function bnMondayOf(d) {
  const r = new Date(d);
  r.setHours(0,0,0,0);
  const dow = (r.getDay() + 6) % 7;   // 0=Mon … 6=Sun
  r.setDate(r.getDate() - dow);
  return r;
}

function renderRoadmapCalendar(roadmapId) {
  const cont = document.getElementById('rmPageContent');
  const r = findRoadmap(roadmapId);
  if (!r) { cont.innerHTML = ''; return; }
  const owner = findPerson(r.responsibleId);
  // Day-off / worked-day toggles are scoped to the roadmap owner. The function
  // signatures of isTimeOff / isWorkedOverride / isNonWorkingDay / toggleTimeOff /
  // toggleWorkedOverride all accept an optional personId — we pass it everywhere
  // inside this calendar render so toggles on Berni's roadmap don't bleed into
  // Joan's roadmap, and vice versa.
  const personIdForOverrides = r.responsibleId || null;

  // Default month: roadmap start, or today
  if (!roadmapCalState.yearMonth) {
    const start = parseDate(r.startDate);
    const base = start || new Date();
    roadmapCalState.yearMonth = { year: base.getFullYear(), month: base.getMonth() };
  }
  const ym = roadmapCalState.yearMonth;
  const today = new Date(); today.setHours(0,0,0,0);

  // Build event list — task must have at least startDate; missing endDate → extend to far future ("infinity")
  const FAR_FUTURE = new Date(2099, 11, 31);
  // Resolve an anchor value to { taskId, side } or null.
  // Supported formats:
  //   ''                       → no anchor
  //   'group-start' (legacy)   → parent group's start
  //   'group-end'   (legacy)   → parent group's end
  //   'task:{id}:start|end'    → any task's start/end
  function parseAnchorRef(entry, anchorVal) {
    if (!anchorVal) return null;
    if (anchorVal === 'group-start' || anchorVal === 'group-end') {
      const t = bnTaskById(entry.taskId);
      if (t && t.groupId) return { taskId: t.groupId, side: anchorVal === 'group-end' ? 'end' : 'start' };
      return null;
    }
    if (anchorVal.indexOf('task:') === 0) {
      const parts = anchorVal.split(':');
      if (parts.length === 3 && (parts[2] === 'start' || parts[2] === 'end')) return { taskId: parts[1], side: parts[2] };
    }
    return null;
  }
  // Resolve effective dates for an entry, walking anchor chains so we always land on a concrete date.
  // Crossing anchors apply a day offset for predecessor/successor semantics:
  //   start anchored to end  → result = target_end + 1 day  (starts right after)
  //   end   anchored to start → result = target_start − 1 day (ends right before)
  // Cycles are protected by a visited-set; missing targets fall back to '' (no date).
  // Task-level dates are the source of truth — entries no longer carry per-roadmap dates.
  function effectiveDatesFor(entry) {
    const t = entry && (STORE.tasks || []).find(x => x.id === entry.taskId);
    return effectiveDatesForTask(t);
  }
  // Build the list of anchor menu items for `entry` (excludes self). Returns [{value, label}, …].
  function buildAnchorItems(entry) {
    const items = [{ value: '', label: '○  Custom date' }];
    const ownTask = bnTaskById(entry.taskId);
    // Order: parent group first (if any), then other groups, then standalone tasks.
    const others = (r.tasks || []).filter(e => e.taskId !== entry.taskId).map(e => ({
      entry: e, task: bnTaskById(e.taskId)
    })).filter(x => x.task);
    others.sort((a, b) => {
      const ag = ownTask && ownTask.groupId === a.task.id ? 0 : (a.task.isGroup ? 1 : 2);
      const bg = ownTask && ownTask.groupId === b.task.id ? 0 : (b.task.isGroup ? 1 : 2);
      if (ag !== bg) return ag - bg;
      return (a.task.subject || '').localeCompare(b.task.subject || '');
    });
    others.forEach(({ task }) => {
      const icon = task.isGroup ? '📁' : '·';
      const name = (task.subject || '(unnamed)').slice(0, 55);
      items.push({ value: 'task:' + task.id + ':start', label: '📌  ' + icon + ' ' + name + ' — start' });
      items.push({ value: 'task:' + task.id + ':end',   label: '📌  ' + icon + ' ' + name + ' — end' });
    });
    return items;
  }
  // Normalize an anchor for display selection: legacy 'group-start' → 'task:{groupId}:start' (for matching <select> options).
  function normalizeAnchorForSelect(entry, val) {
    if (val === 'group-start' || val === 'group-end') {
      const t = bnTaskById(entry.taskId);
      if (t && t.groupId) return 'task:' + t.groupId + (val === 'group-end' ? ':end' : ':start');
    }
    return val || '';
  }
  // Floating picker for anchor selection — modern UI with search + filter chips + per-task start/end buttons.
  // Closes any previous menu, opens a new one positioned near `anchorBtn`.
  function openAnchorPicker(anchorBtn, entry, kind /* 'start'|'end' */, currentValue, onPicked) {
    document.querySelectorAll('.bn-anchor-menu').forEach(n => n.remove());
    const ownTask = bnTaskById(entry.taskId);
    const others = (r.tasks || []).filter(e => e.taskId !== entry.taskId).map(e => ({
      entry: e, task: bnTaskById(e.taskId)
    })).filter(x => x.task);
    if (others.length === 0) return;
    // Order: parent group first, then groups alpha, then tasks alpha
    others.sort((a, b) => {
      const ap = ownTask && ownTask.groupId === a.task.id ? 0 : (a.task.isGroup ? 1 : 2);
      const bp = ownTask && ownTask.groupId === b.task.id ? 0 : (b.task.isGroup ? 1 : 2);
      if (ap !== bp) return ap - bp;
      return (a.task.subject || '').localeCompare(b.task.subject || '');
    });
    const groupCount = others.filter(x => x.task.isGroup).length;
    const taskCount = others.length - groupCount;
    const menu = document.createElement('div');
    menu.className = 'bn-anchor-menu';
    menu.innerHTML =
      '<div class="bam-head">' +
        '<strong>Anchor ' + (kind === 'start' ? 'start' : 'end') + ' to…</strong>' +
        '<button type="button" class="bam-close" title="Close">✕</button>' +
      '</div>' +
      '<div class="bam-search-wrap">' +
        '<span class="bam-search-icon">🔍</span>' +
        '<input type="text" class="bam-search" placeholder="Search tasks…" autocomplete="off">' +
      '</div>' +
      '<div class="bam-filters">' +
        '<button type="button" class="bam-chip active" data-filter="all">All <span class="bam-count">' + others.length + '</span></button>' +
        '<button type="button" class="bam-chip" data-filter="groups">📁 Groups <span class="bam-count">' + groupCount + '</span></button>' +
        '<button type="button" class="bam-chip" data-filter="tasks">Tasks <span class="bam-count">' + taskCount + '</span></button>' +
      '</div>' +
      '<div class="bam-list">' +
        '<div class="bam-row bam-custom' + (currentValue === '' ? ' selected' : '') + '" data-val="">' +
          '<span class="bam-row-name"><span class="bam-icon-custom">○</span> Custom date</span>' +
        '</div>' +
        others.map(({ task }) => {
          const isG = !!task.isGroup;
          const isParent = ownTask && ownTask.groupId === task.id;
          const name = task.subject || '(unnamed)';
          const valS = 'task:' + task.id + ':start';
          const valE = 'task:' + task.id + ':end';
          return '<div class="bam-row" data-type="' + (isG ? 'group' : 'task') + '" data-name="' + escapeHtml(name.toLowerCase()) + '">' +
            '<span class="bam-row-name">' +
              (isG ? '<span class="bam-icon">📁</span>' : '<span class="bam-icon-task">·</span>') +
              '<span class="bam-row-label" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>' +
              (isParent ? '<span class="bam-parent-tag">parent</span>' : '') +
            '</span>' +
            '<span class="bam-row-actions">' +
              '<button type="button" class="bam-side-btn' + (currentValue === valS ? ' selected' : '') + '" data-val="' + escapeHtml(valS) + '" title="Anchor to this task\'s start date">start</button>' +
              '<button type="button" class="bam-side-btn' + (currentValue === valE ? ' selected' : '') + '" data-val="' + escapeHtml(valE) + '" title="Anchor to this task\'s end date">end</button>' +
            '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="bam-empty" style="display:none">No matches</div>';
    document.body.appendChild(menu);
    // Position
    const rect = anchorBtn.getBoundingClientRect();
    menu.style.left = (rect.left + window.scrollX) + 'px';
    menu.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
    setTimeout(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.right > window.innerWidth - 8) {
        menu.style.left = Math.max(8, window.innerWidth - mr.width - 8 + window.scrollX) + 'px';
      }
      if (mr.bottom > window.innerHeight - 8) {
        const above = rect.top - mr.height - 6;
        menu.style.top = (Math.max(8, above) + window.scrollY) + 'px';
      }
    }, 0);
    // Filter state
    let activeFilter = 'all';
    let activeQuery = '';
    function applyFilter() {
      let visibleCount = 0;
      menu.querySelectorAll('.bam-row').forEach(row => {
        if (row.classList.contains('bam-custom')) {
          const show = activeQuery === '';
          row.style.display = show ? '' : 'none';
          if (show) visibleCount++;
          return;
        }
        const type = row.dataset.type;
        const name = row.dataset.name || '';
        const filterMatch = activeFilter === 'all' || activeFilter === (type === 'group' ? 'groups' : 'tasks');
        const queryMatch = !activeQuery || name.indexOf(activeQuery) >= 0;
        const show = filterMatch && queryMatch;
        row.style.display = show ? '' : 'none';
        if (show) visibleCount++;
      });
      menu.querySelector('.bam-empty').style.display = visibleCount === 0 ? '' : 'none';
    }
    const searchInput = menu.querySelector('.bam-search');
    searchInput.addEventListener('input', () => {
      activeQuery = searchInput.value.trim().toLowerCase();
      applyFilter();
    });
    setTimeout(() => searchInput.focus(), 30);
    menu.querySelectorAll('.bam-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        e.stopPropagation();
        menu.querySelectorAll('.bam-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeFilter = chip.dataset.filter;
        applyFilter();
      });
    });
    function pick(v) {
      menu.remove();
      if (typeof onPicked === 'function') onPicked(v);
    }
    menu.querySelector('.bam-custom').addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      pick('');
    });
    menu.querySelectorAll('.bam-side-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        pick(btn.dataset.val);
      });
    });
    menu.querySelector('.bam-close').addEventListener('click', e => {
      e.stopPropagation();
      menu.remove();
    });
    // Escape key
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') { menu.remove(); }
    });
    // Click outside
    setTimeout(() => {
      const onDoc = (ev) => {
        if (!document.body.contains(menu)) {
          document.removeEventListener('mousedown', onDoc, true);
          return;
        }
        if (!menu.contains(ev.target) && ev.target !== anchorBtn) {
          menu.remove();
          document.removeEventListener('mousedown', onDoc, true);
        }
      };
      document.addEventListener('mousedown', onDoc, true);
    }, 0);
  }
  const events = (r.tasks || []).map(entry => {
    const task = bnTaskById(entry.taskId);
    const eff = effectiveDatesFor(entry);
    let start = parseDate(eff.startStr);
    let end = parseDate(eff.endStr);
    if (start && !end) end = FAR_FUTURE;
    return { entry, task, start, end, openEnded: start && !parseDate(eff.endStr) };
  }).filter(e => e.task && e.start && e.end);

  // Unscheduled = no effective start date OR currently being edited and not yet applied.
  // Effective start respects anchors: a child anchored to a group inherits the group's dates.
  // Archived tasks are pulled out into their own section so they don't clutter the active list.
  if (!window.__rmPendingApply) window.__rmPendingApply = new Set();
  const rawUnscheduled = (r.tasks || []).filter(entry => {
    const t = bnTaskById(entry.taskId);
    if (!t) return false;
    if (window.__rmPendingApply.has(entry.taskId)) return true;  // user is editing dates here
    const eff = effectiveDatesFor(entry);
    return !parseDate(eff.startStr);
  });
  function entryStatus(entry) {
    const t = bnTaskById(entry.taskId);
    return (t && t.slackStatus) || '';
  }
  const unscheduled = rawUnscheduled.filter(e => entryStatus(e) !== 'Archived');
  const archivedEntries = rawUnscheduled.filter(e => entryStatus(e) === 'Archived');
  // Also exclude these "pending apply" entries from the calendar events
  const eventsScheduled = events.filter(e => !window.__rmPendingApply.has(e.entry.taskId));

  // Status color map (medium saturation for calendar bars)
  const statusColors = {
    "": "#cbd5e1",
    "Waiting": "#60a5fa", "Proposed": "#1d4ed8", "Later / Next": "#dc2626",
    "In Progress": "#f97316", "Under Review": "#7c3aed", "Completed": "#16a34a",
    "Archived": "#a98c5a", "Discarded": "#9a9a9a"
  };

  // Compute calendar range based on viewMode ('month', 'week', 'year', '6m').
  let viewMode = roadmapCalState.viewMode;
  if (viewMode !== 'week' && viewMode !== 'year' && viewMode !== '6m') viewMode = 'month';
  let firstOfMonth, lastOfMonth, gridStart, totalWeeks, startWeekday, lastWeekday;
  // halfYear range info used inside the year/6m rendering block
  let halfYearStartDate = null, halfYearMonthCount = 6;
  if (viewMode === 'week') {
    if (!roadmapCalState.weekStart) roadmapCalState.weekStart = bnMondayOf(new Date());
    const wkStart = bnMondayOf(roadmapCalState.weekStart);
    const wkEnd = new Date(wkStart); wkEnd.setDate(wkEnd.getDate() + 6); wkEnd.setHours(0,0,0,0);
    firstOfMonth = wkStart;
    lastOfMonth = wkEnd;
    gridStart = wkStart;
    startWeekday = 0;
    lastWeekday = 6;
    totalWeeks = 1;
  } else if (viewMode === 'year') {
    if (!roadmapCalState.year) {
      const start = parseDate(r.startDate);
      roadmapCalState.year = (start || new Date()).getFullYear();
    }
    const Y = roadmapCalState.year;
    firstOfMonth = new Date(Y, 0, 1);
    lastOfMonth = new Date(Y, 11, 31);
    gridStart = firstOfMonth;
    startWeekday = 0;
    lastWeekday = 6;
    totalWeeks = 0;   // year view doesn't render the weekly grid
  } else if (viewMode === '6m') {
    if (!roadmapCalState.halfYearAnchor) {
      const t = new Date();
      roadmapCalState.halfYearAnchor = new Date(t.getFullYear(), t.getMonth(), 1);
    }
    const anchor = new Date(roadmapCalState.halfYearAnchor);
    anchor.setDate(1); anchor.setHours(0,0,0,0);
    halfYearStartDate = anchor;
    firstOfMonth = anchor;
    const endMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 6, 0);   // last day of the 6th month
    endMonth.setHours(0,0,0,0);
    lastOfMonth = endMonth;
    gridStart = firstOfMonth;
    startWeekday = 0;
    lastWeekday = 6;
    totalWeeks = 0;   // 6m view doesn't render the weekly grid
  } else {
    firstOfMonth = new Date(ym.year, ym.month, 1);
    lastOfMonth = new Date(ym.year, ym.month + 1, 0);
    startWeekday = (firstOfMonth.getDay() + 6) % 7;
    gridStart = new Date(ym.year, ym.month, 1 - startWeekday);
    lastWeekday = (lastOfMonth.getDay() + 6) % 7;
    const totalGridDays = startWeekday + lastOfMonth.getDate() + (6 - lastWeekday);
    totalWeeks = totalGridDays / 7;
  }

  // Build summary
  const completedCount = events.filter(e => e.task.slackStatus === 'Completed').length;
  const dateRange = (r.startDate || r.endDate) ? (escapeHtml(r.startDate||'?') + ' → ' + escapeHtml(r.endDate||'?')) : 'no dates';
  const ownerHtml = owner
    ? '<div class="rm-owner-chip" data-owner="' + owner.id + '" title="Open ' + escapeHtml(owner.displayName) + ' in Team">' +
        '<span class="avatar" style="width:28px;height:28px;font-size:11px;background:' + owner.color + '">' +
          '<img src="' + owner.photo + '" alt="" onerror="this.remove()">' +
          '<span class="ini">' + initials(owner.name) + '</span>' +
        '</span>' +
        '<span class="rm-owner-name">' + escapeHtml(owner.name) + '</span>' +
      '</div>'
    : '<em>no owner</em>';
  // Clickable title that opens a roadmap picker popover (alphabetical, with search) — matches the Profile pattern.
  const rmOpen = !!window.__rmPickerOpen;
  let html = '<div class="rm-summary-card">' +
    '<div class="rm-name-wrapper" style="position:relative; display:inline-block">' +
      '<div class="rm-name-trigger' + (rmOpen ? ' open' : '') + '" id="rmNameTrigger" title="Switch roadmap">' +
        '<div class="rm-summary-name">' + escapeHtml(r.name||'(unnamed)') + '</div>' +
        '<span class="arrow">▾</span>' +
      '</div>' +
    '</div>' +
    '<div class="rm-summary-meta">' +
      ownerHtml +
      '<span class="sep">·</span>' +
      '<span>' + dateRange + '</span>' +
      '<span class="sep">·</span>' +
      '<span>' + (r.tasks||[]).length + ' tasks</span>' +
    '</div>' +
    '<div class="rm-summary-actions">' +
      '<button class="btn" id="rmEditBtn">Edit</button>' +
      '<button class="btn danger" id="rmDeleteBtn">Delete</button>' +
    '</div></div>';

  // Toolbar with navigation. The user can hide the side panel; when empty OR hidden we expand calendar full width.
  const hasSide = (unscheduled.length > 0 || archivedEntries.length > 0) && !roadmapCalState.sideHidden;
  const hasSideContent = unscheduled.length > 0 || archivedEntries.length > 0;
  html += '<div class="rm-content-row' + (hasSide ? '' : ' no-side') + '"><div class="rm-cal-area">';
  const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  let periodLabel;
  let atStart = false;
  const rmStart = parseDate(r.startDate);
  if (viewMode === 'week') {
    const wkStart = gridStart, wkEnd = new Date(gridStart); wkEnd.setDate(wkEnd.getDate() + 6);
    const sameMonth = wkStart.getMonth() === wkEnd.getMonth();
    if (sameMonth) {
      periodLabel = wkStart.getDate() + '–' + wkEnd.getDate() + ' ' + monthNames[wkStart.getMonth()] + ' ' + wkStart.getFullYear();
    } else {
      periodLabel = wkStart.getDate() + ' ' + monthNames[wkStart.getMonth()].slice(0,3) + '. – ' +
                    wkEnd.getDate() + ' ' + monthNames[wkEnd.getMonth()].slice(0,3) + '. ' + wkEnd.getFullYear();
    }
    if (rmStart) {
      const rmStartMonday = bnMondayOf(rmStart);
      atStart = wkStart.getTime() <= rmStartMonday.getTime();
    }
  } else if (viewMode === 'year') {
    periodLabel = String(roadmapCalState.year);
    atStart = rmStart ? (roadmapCalState.year <= rmStart.getFullYear()) : false;
  } else if (viewMode === '6m') {
    const a = halfYearStartDate;
    const endMonthIdx = (a.getMonth() + 5) % 12;
    const endYear = a.getFullYear() + Math.floor((a.getMonth() + 5) / 12);
    const sameYear = a.getFullYear() === endYear;
    if (sameYear) {
      periodLabel = monthNames[a.getMonth()].slice(0,3) + ' – ' + monthNames[endMonthIdx].slice(0,3) + ' ' + a.getFullYear();
    } else {
      periodLabel = monthNames[a.getMonth()].slice(0,3) + ' ' + a.getFullYear() + ' – ' + monthNames[endMonthIdx].slice(0,3) + ' ' + endYear;
    }
    if (rmStart) {
      const rmS = new Date(rmStart.getFullYear(), rmStart.getMonth(), 1);
      atStart = a.getTime() <= rmS.getTime();
    }
  } else {
    periodLabel = monthNames[ym.month] + ' ' + ym.year;
    atStart = rmStart ? (ym.year < rmStart.getFullYear() ||
                         (ym.year === rmStart.getFullYear() && ym.month <= rmStart.getMonth())) : false;
  }
  const prevTitle = atStart ? "At roadmap start — can't go further back" : (
    viewMode === 'week' ? 'Previous week' :
    viewMode === 'year' ? 'Previous year' :
    viewMode === '6m'   ? 'Previous month' :
    'Previous month'
  );
  const nextTitle = (
    viewMode === 'week' ? 'Next week' :
    viewMode === 'year' ? 'Next year' :
    viewMode === '6m'   ? 'Next month' :
    'Next month'
  );
  // "Collapse all / Expand all" — toggles every group's expansion in the global bn-group-expanded map
  function getAllGroupIds() { return (STORE.tasks||[]).filter(t => t.isGroup).map(g => g.id); }
  const anyGroupExpanded = getAllGroupIds().some(g => isGroupExpanded(g));
  const collapseAllLabel = anyGroupExpanded ? '⊟ Collapse all' : '⊞ Expand all';
  const collapseAllTitle = anyGroupExpanded ? 'Collapse every group' : 'Expand every group';
  // Toolbar order: nav (prev/today/next) → month label → view toggle (Week/Month/Year + 6m) on the left.
  // The cal-toggle (Hide weekends) has margin-left:auto in CSS to push everything after it to the right.
  html += '<div class="cal-toolbar">' +
    '<div class="cal-nav-group">' +
      '<button class="cal-nav-btn" id="calPrev" title="' + prevTitle + '"' + (atStart ? ' disabled' : '') + '>‹</button>' +
      '<button class="cal-today-btn" id="calToday">Today</button>' +
      '<button class="cal-nav-btn" id="calNext" title="' + nextTitle + '">›</button>' +
    '</div>' +
    '<div class="cal-month-label">' + periodLabel + '</div>' +
    '<div class="cal-view-toggle" role="group" aria-label="View mode">' +
      '<button type="button" class="cal-view-btn ' + (viewMode === 'week'  ? 'active' : '') + '" id="calViewWeek"  title="Week view">Week</button>' +
      '<button type="button" class="cal-view-btn ' + (viewMode === 'month' ? 'active' : '') + '" id="calViewMonth" title="Month view">Month</button>' +
      '<button type="button" class="cal-view-btn ' + (viewMode === 'year'  ? 'active' : '') + '" id="calViewYear"  title="Year view">Year</button>' +
    '</div>' +
    '<button type="button" class="cal-view-btn cal-view-6m' + (viewMode === '6m' ? ' active' : '') + '" id="calView6m" title="6-month rolling view" style="margin-left:4px">6 MFN</button>' +
    '<div class="cal-toolbar-spacer" style="margin-left:auto"></div>' +
    ((viewMode === 'year' || viewMode === '6m') ? '' : '<label class="cal-toggle"><input type="checkbox" id="calHideWeekends" ' + (roadmapCalState.hideWeekends ? "checked" : "") + '> <span>Hide weekends</span></label>') +
    '<button type="button" class="cal-view-btn" id="calCollapseAll" title="' + collapseAllTitle + '" style="margin-left:6px">' + collapseAllLabel + '</button>' +
    (hasSideContent
      ? '<button type="button" class="cal-side-toggle" id="calSideToggle" title="' + (roadmapCalState.sideHidden ? 'Show Unscheduled/Archived sidebar' : 'Hide sidebar (calendar full width)') + '">' + (roadmapCalState.sideHidden ? '⏴ Show side' : 'Hide side ⏵') + '</button>'
      : '') +
    '</div>';

  if (viewMode === 'year' || viewMode === '6m') {
    // Year/6m view: horizontal Gantt — rows of tasks against an N-month axis.
    const Y = roadmapCalState.year;
    const yearStartMs = firstOfMonth.getTime();
    const yearEndMs = lastOfMonth.getTime();
    const daysInYear = Math.round((yearEndMs - yearStartMs) / DAY_MS) + 1;
    // Number of month columns and their start dates (proportional widths by days-in-month)
    const monthCount = (viewMode === '6m') ? 6 : 12;
    const monthStarts = [];
    const monthDays   = [];
    for (let mi = 0; mi < monthCount; mi++) {
      const ms = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + mi, 1);
      const me = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + mi + 1, 0);
      monthStarts.push(ms);
      monthDays.push(me.getDate());   // days in this month
    }
    const monthsGridTemplate = monthDays.map(d => d + 'fr').join(' ');
    // Convert hex to translucent rgba
    function _toRgba(hex, a) {
      const h = (hex && hex.length === 4) ? ('#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3]) : hex;
      if (!h || h[0] !== '#') return 'rgba(217,119,6,' + a + ')';
      const r2 = parseInt(h.slice(1,3),16), g2 = parseInt(h.slice(3,5),16), b2 = parseInt(h.slice(5,7),16);
      return 'rgba(' + r2 + ',' + g2 + ',' + b2 + ',' + a + ')';
    }
    // Sort events: groups first (with their kids right after), then orphans (children whose parent is missing) and standalone tasks.
    const evByTaskId = {};
    eventsScheduled.forEach(e => { evByTaskId[e.task.id] = e; });
    const childrenByParent = {};
    eventsScheduled.forEach(e => {
      if (e.task.groupId && evByTaskId[e.task.groupId]) {
        (childrenByParent[e.task.groupId] = childrenByParent[e.task.groupId] || []).push(e);
      }
    });
    const orderedRows = [];
    const seen = new Set();
    // Recursive walk so groups nested ANY number of levels deep render their
    // children (and grandchildren) when expanded. Previously the loop only
    // descended one level, so a group-inside-a-group couldn't be expanded
    // (no grandchildren rows ever appeared).
    const _pushSubtree = (e, depth) => {
      if (seen.has(e.task.id)) return;
      orderedRows.push({ ev: e, depth });
      seen.add(e.task.id);
      if (!e.task.isGroup) return;
      // Respect the per-group collapsed state at every depth.
      if (!isGroupExpanded(e.task.id)) return;
      const kids = (childrenByParent[e.task.id] || []).slice().sort(
        (x, y) => (x.start - y.start) || (x.task.subject || '').localeCompare(y.task.subject || '')
      );
      kids.forEach(c => _pushSubtree(c, depth + 1));
    };
    eventsScheduled
      .filter(e => !e.task.groupId || !evByTaskId[e.task.groupId])
      .sort((a, b) => (a.start - b.start) || (a.task.subject || '').localeCompare(b.task.subject || ''))
      .forEach(e => _pushSubtree(e, 0));

    // Month header
    html += '<div class="cal-year">';
    html += '<div class="cal-year-headers">' +
              '<div class="cal-year-label-spacer"></div>' +
              '<div class="cal-year-months" style="grid-template-columns: ' + monthsGridTemplate + '">';
    for (let mi = 0; mi < monthCount; mi++) {
      const ms = monthStarts[mi];
      const lbl = monthNames[ms.getMonth()].slice(0,3) + (viewMode === '6m' ? ' ' + String(ms.getFullYear()).slice(2) : '');
      html += '<div class="cal-year-month-cell">' + lbl + '</div>';
    }
    html += '</div></div>';

    // Rows wrapper (today line spans full height absolutely INSIDE the months-bg so the % is relative to the months area only)
    let todayLineYearHtml = '';
    const yearToday = new Date(); yearToday.setHours(0,0,0,0);
    if (yearToday.getTime() >= yearStartMs && yearToday.getTime() <= yearEndMs) {
      const off = Math.round((yearToday.getTime() - yearStartMs) / DAY_MS);
      const leftPct = (off / daysInYear) * 100;
      todayLineYearHtml = '<div class="cal-year-today-line" style="left:calc(' + leftPct + '% )"></div>';
    }
    html += '<div class="cal-year-rows-wrap">';
    html += '<div class="cal-year-track-bg"><div class="cal-year-months-bg" style="grid-template-columns: ' + monthsGridTemplate + '">';
    for (let mi = 0; mi < monthCount; mi++) {
      html += '<div class="cal-year-month-bg' + (mi % 2 ? ' alt' : '') + '"></div>';
    }
    html += todayLineYearHtml + '</div></div>';
    html += '<div class="cal-year-rows">';

    if (orderedRows.length === 0) {
      html += '<div class="rm-empty" style="margin:14px">No scheduled tasks in ' + (viewMode === '6m' ? 'this range' : Y) + '.</div>';
    } else {
      orderedRows.forEach((row, _rowIdx) => {
        const ev = row.ev;
        const isG = !!ev.task.isGroup;
        const startMs = Math.max(ev.start.getTime(), yearStartMs);
        const endMs   = Math.min(ev.end.getTime(),   yearEndMs);
        if (endMs < startMs) return;
        const off = Math.round((startMs - yearStartMs) / DAY_MS);
        const span = Math.round((endMs - startMs) / DAY_MS) + 1;
        const leftPct  = (off  / daysInYear) * 100;
        const widthPct = (span / daysInYear) * 100;
        const stHex = statusColors[ev.task.slackStatus] || (isG ? '#d97706' : '#1a1a1a');
        let barStyle;
        if (isG) {
          barStyle = 'background:' + _toRgba(stHex, 0.18) + '; border:1.5px dashed ' + stHex + '; color:' + stHex + ';';
        } else {
          barStyle = 'background:' + stHex + '; color:#fff;';
        }
        const continuesLeft  = ev.start.getTime() < yearStartMs;
        const continuesRight = ev.end.getTime()   > yearEndMs;
        const labelText = ev.task.subject;
        // Group chevron toggle in the LABEL column (left), uses the global bn-group-expanded map
        const gExpanded = isG ? isGroupExpanded(ev.task.id) : false;
        const labelChev = isG
          ? '<button type="button" class="cal-group-toggle-y' + (gExpanded ? ' expanded' : '') + '" data-gid="' + ev.task.id + '" title="' + (gExpanded ? 'Collapse group' : 'Expand group') + '">▶</button>'
          : '';
        html += '<div class="cal-year-row' + (row.depth ? ' is-child' : '') + (isG ? ' is-group' : '') + '" data-tid="' + ev.task.id + '">' +
          '<div class="cal-year-label" title="' + escapeHtml(ev.task.subject) + '" style="padding-left:' + (8 + row.depth * 14) + 'px">' +
            labelChev +
            // Folder emoji only on depth-0 groups. Nested rows (including
            // nested groups) rely on padding-left for the indent — no '· '
            // prefix anymore, which used to clutter every child row label.
            (!row.depth && isG ? '<span class="folder-emoji">📁</span> ' : '') +
            // Render the FULL label text — the CSS .cal-year-label-text has
            // max-height: 3.6em + overflow: hidden, so long names wrap to ~3
            // lines instead of being truncated at 42 chars by JS.
            '<span class="cal-year-label-text">' + escapeHtml(labelText) + '</span>' +
          '</div>' +
          '<div class="cal-year-track">' +
            '<div class="cal-event cal-year-bar' + (isG ? ' cal-event-group' : '') + '" data-tid="' + ev.task.id + '" title="' + escapeHtml(ev.task.subject + ' — ' + (ev.entry.startDate||'?') + ' → ' + (ev.entry.endDate||'?')) + '" style="left:' + leftPct + '%; width:' + widthPct + '%; ' + barStyle + '">' +
              (continuesLeft ? '◂ ' : '') + escapeHtml(ev.task.subject) + (continuesRight ? ' ▸' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      });
    }
    html += '</div>';   // .cal-year-rows
    html += '</div>';   // .cal-year-rows-wrap
    html += '</div>';   // .cal-year
  } else
  {
    // Day headers (Mon-first) — always render the grid
    html += '<div class="cal-grid">';
    html += '<div class="cal-headers" style="grid-template-columns: repeat(' + (roadmapCalState.hideWeekends ? 5 : 7) + ', 1fr)">';
    const headerDays = roadmapCalState.hideWeekends ? ['Mon','Tue','Wed','Thu','Fri'] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    headerDays.forEach(d => {
      html += '<div class="cal-day-header">' + d + '</div>';
    });
    html += '</div>';

    // Day list invariant across weeks (depends only on hide-weekends toggle)
    const dayList = roadmapCalState.hideWeekends ? [0,1,2,3,4] : [0,1,2,3,4,5,6];
    const nDays = dayList.length;
    // If hiding weekends AND the month starts on Sat/Sun, the first row (Mon-Fri) is entirely
    // in the previous month — skip it. The last row is never empty even when the month ends
    // on a weekend, since the previous weekdays are still in the current month.
    let firstWeek = 0;
    const lastWeek = totalWeeks;
    if (roadmapCalState.hideWeekends && startWeekday >= 5) firstWeek = 1;
    // For each week, build day cells + event overlay
    for (let w = firstWeek; w < lastWeek; w++) {
      const weekStart = addDays(gridStart, w * 7);
      const weekEnd = addDays(weekStart, 6);
      // Find events that intersect this week
      const visibleEvents = eventsScheduled.filter(e => e.end >= weekStart && e.start <= weekEnd);
      // Compute segments: clipped to this week, mapped to visible columns (skip weekends if toggled)
      function dayToCol(idx) {
        // idx 0..6 (Mon..Sun)
        if (!roadmapCalState.hideWeekends) return idx;
        // When hidden, only Mon-Fri (0..4); Sat=5,Sun=6 don't exist
        return idx <= 4 ? idx : null;
      }
      const segments = [];
      // Clip each segment to the current month bounds so events don't bleed into other-month days
      const monthStartMs = firstOfMonth.getTime();
      const monthEndMs = lastOfMonth.getTime();
      visibleEvents.forEach(e => {
        const startMs = Math.max(e.start.getTime(), weekStart.getTime(), monthStartMs);
        const endMs   = Math.min(e.end.getTime(),   weekEnd.getTime(),   monthEndMs);
        if (endMs < startMs) return;   // segment is entirely outside the current month
        const segStart = new Date(startMs); segStart.setHours(0,0,0,0);
        const segEnd   = new Date(endMs);   segEnd.setHours(0,0,0,0);
        const rawStart = Math.round((segStart - weekStart) / DAY_MS);
        const rawEnd = Math.round((segEnd - weekStart) / DAY_MS);
        // Clamp to visible day range and translate to column
        let visStart = rawStart, visEnd = rawEnd;
        if (roadmapCalState.hideWeekends) {
          if (rawStart > 4 && rawEnd > 4) return; // entirely on weekend
          if (visStart > 4) visStart = 4; // shouldn't happen but safety
          if (visEnd > 4) visEnd = 4;
        }
        const startCol = visStart;
        const span = visEnd - visStart + 1;
        segments.push({
          event: e, startCol, span,
          // Show arrow if the original event extends past the (clipped) segment on either side
          continuesLeft:  e.start < segStart,
          continuesRight: e.end   > segEnd
        });
      });
      // Group containment: build a map "groupId on this roadmap" so child events
      // (with task.groupId pointing here) sit INSIDE the parent's lane instead of taking new ones.
      const groupTaskIdsOnRoadmap = new Set();
      eventsScheduled.forEach(e => { if (e.task.isGroup) groupTaskIdsOnRoadmap.add(e.task.id); });
      function isNestedChild(seg) {
        return seg.event.task.groupId && groupTaskIdsOnRoadmap.has(seg.event.task.groupId);
      }

      // Lane assignment: lanes only for parents/standalones. Each lane gets a height that
      // expands if there are nested children to fit inside.
      segments.sort((a,b) => a.startCol - b.startCol || b.span - a.span);
      const parentSegs = segments.filter(s => !isNestedChild(s));
      const childSegs  = segments.filter(s => isNestedChild(s));
      const lanes = [];
      parentSegs.forEach(s => {
        let lane = 0;
        while (lanes[lane] && lanes[lane].some(o => s.startCol < o.startCol + o.span && o.startCol < s.startCol + s.span)) lane++;
        if (!lanes[lane]) lanes[lane] = [];
        lanes[lane].push(s);
        s.lane = lane;
      });
      // Assign nested children to the same lane as their parent (find parent in this week)
      const parentSegByTaskId = {};
      parentSegs.forEach(p => { parentSegByTaskId[p.event.task.id] = p; });
      // Sub-lanes inside each parent lane (per parent task id this week)
      const subLanesByParent = {};
      childSegs.forEach(c => {
        const parentSeg = parentSegByTaskId[c.event.task.groupId];
        if (parentSeg) {
          c.lane = parentSeg.lane;
          const subLanes = subLanesByParent[c.event.task.groupId] = subLanesByParent[c.event.task.groupId] || [];
          let sub = 0;
          while (subLanes[sub] && subLanes[sub].some(o => c.startCol < o.startCol + o.span && o.startCol < c.startCol + c.span)) sub++;
          if (!subLanes[sub]) subLanes[sub] = [];
          subLanes[sub].push(c);
          c.subLane = sub;
        } else {
          // Parent isn't visible this week (segment doesn't intersect); treat as a normal segment
          let lane = 0;
          while (lanes[lane] && lanes[lane].some(o => c.startCol < o.startCol + o.span && o.startCol < c.startCol + c.span)) lane++;
          if (!lanes[lane]) lanes[lane] = [];
          lanes[lane].push(c);
          c.lane = lane;
        }
      });
      // Determine each lane's height. For a lane containing a group with N nested sub-lanes,
      // expand it so children fit INSIDE the group's bar (or collapse it to just the title strip
      // when the group is collapsed — no kids shown at all, no "+N more" pill).
      const SUB_H = 12;
      const SUB_GAP = 2;
      const TITLE_STRIP = 22;
      const normalLaneHeight = 22;
      // Group expansion state is the GLOBAL one (bn-group-expanded via isGroupExpanded) — same as year/6m and the task list.
      // Build a quick set for repeated lookups in this render pass.
      const expandedSet = new Set();
      (STORE.tasks || []).forEach(g => { if (g.isGroup && isGroupExpanded(g.id)) expandedSet.add(g.id); });
      function groupVisibleSubLanesCount(groupId) {
        const all = (subLanesByParent[groupId] || []).length;
        // Collapsed groups show 0 kids; expanded groups show ALL kids.
        if (!expandedSet.has(groupId)) return 0;
        return all;
      }
      const laneHeights = lanes.map(laneSegs => {
        let maxSub = 0;
        laneSegs.forEach(s => {
          if (!s.event.task.isGroup) return;
          const visibleSub = groupVisibleSubLanesCount(s.event.task.id);
          if (visibleSub > maxSub) maxSub = visibleSub;
        });
        if (maxSub === 0) return normalLaneHeight;
        return TITLE_STRIP + maxSub * (SUB_H + SUB_GAP) + 4;
      });
      // Pre-compute Y offset for each lane
      const laneTop = [];
      let acc = 0;
      laneHeights.forEach((h,i) => { laneTop[i] = acc; acc += h; });
      // No lane cap — day height grows to fit every visible task (no "+X more" overflow pill).
      const maxLanesShown = Infinity;
      const minHeight = 110;
      const calculatedHeight = Math.max(minHeight, 36 + acc);

      html += '<div class="cal-week" style="min-height:' + calculatedHeight + 'px; grid-template-columns: repeat(' + nDays + ', 1fr)">';
      // Day cells loop
      const nonWorkingCols = []; // [{col, type: "default" | "time-off"}]
      for (let di = 0; di < nDays; di++) {
        const d = dayList[di];
        const dayDate = addDays(weekStart, d);
        const dayKey = dateKey(dayDate);
        // In week view, every visible day belongs to "the week" — never treat any as other-month.
        const isOtherMonth = viewMode === 'week' ? false : (dayDate.getMonth() !== ym.month);
        const isToday = dayDate.getTime() === today.getTime();
        const isWknd = isWeekendDay(dayDate);
        const holName = holidayName(dayDate);
        const worked = isWorkedOverride(dayDate, personIdForOverrides);
        const timeOff = isTimeOff(dayDate, personIdForOverrides);
        const nonWorking = isNonWorkingDay(dayDate, personIdForOverrides);
        if (nonWorking && !isOtherMonth) nonWorkingCols.push({ col: di, type: timeOff ? 'time-off' : 'default' });
        const cls = ['cal-day'];
        if (isOtherMonth) cls.push('other-month');
        if (isToday) cls.push('today');
        if (isWknd) cls.push('weekend');
        if (holName) cls.push('holiday');
        if (worked) cls.push('worked');
        if (timeOff) cls.push('time-off');
        // Determine click behavior based on type
        let tooltip;
        if (timeOff) tooltip = 'Marked as time off — click to revert to working day';
        else if (isWknd || holName) tooltip = (worked ? 'Marked as worked — click to revert' : 'Click to mark as worked (no strikethrough)');
        else tooltip = 'Click to mark as time off (vacation, sick, etc.)';
        const labelExtra = timeOff ? '<span class="holiday-name" title="Time off">OFF</span>' : (holName ? '<span class="holiday-name" title="' + escapeHtml(holName) + '">' + escapeHtml(holName) + '</span>' : '');
        html += '<div class="' + cls.join(' ') + '" data-date="' + dayKey + '">' +
          '<span class="day-num toggle" data-toggle-date="' + dayKey + '" title="' + tooltip + '">' + dayDate.getDate() + '</span>' +
          labelExtra +
        '</div>';
      }
      // Event overlay
      html += '<div class="cal-events-overlay">';
      // Stripe overlay over non-working day columns
      // Gray for weekends/holidays (default), red for time-off
      nonWorkingCols.forEach(({col, type}) => {
        const left = (col / nDays) * 100;
        const cls = type === 'time-off' ? 'no-work-stripes time-off' : 'no-work-stripes';
        html += '<div class="' + cls + '" style="left:calc(' + left + '% + 1px); width:calc(' + (100/nDays) + '% - 2px)"></div>';
      });
      // Render parents (groups + standalone tasks) first, then nested children on top
      function renderSeg(s, opts) {
        opts = opts || {};
        if (s.lane >= maxLanesShown) return;
        const left = (s.startCol / nDays) * 100;
        const width = (s.span / nDays) * 100;
        const isGroupEvent = !!s.event.task.isGroup;
        const isNested = opts.nested;
        const cls = ['cal-event'];
        let top, height, color, fontSize, label, extraHtml = '', extraStyle = '';
        if (isNested && !isGroupEvent) {
          // LEAF child inside an expanded parent group → mini solid chip.
          // (Groups that are themselves nested fall through to the
          // isGroupEvent branch below so they get dashed + transparent like
          // the outer group, just positioned as a nested chip.)
          // Hide ALL children when group is collapsed (no "+N more" — kids vanish entirely).
          const parentId = s.event.task.groupId;
          const isParentExpanded = expandedSet.has(parentId);
          if (!isParentExpanded) return;
          // Mini chip inside the parent group's expanded lane
          const baseTop = laneTop[s.lane] + TITLE_STRIP;          // first 22px = the group title strip
          top = baseTop + (s.subLane * (SUB_H + SUB_GAP));
          height = SUB_H;
          color = statusColors[s.event.task.slackStatus] || '#1a1a1a';
          fontSize = 9.5;
          cls.push('cal-event-child');
          label = escapeHtml(s.event.task.subject);
        } else if (isNested && isGroupEvent) {
          // NESTED GROUP (group inside another group). Hide when the outer
          // parent is collapsed (same rule as leaf children).
          const parentId = s.event.task.groupId;
          const isParentExpanded = expandedSet.has(parentId);
          if (!isParentExpanded) return;
          // Render it WITH group styling (dashed + transparent) but sized like
          // a sub-lane row so it fits inside the parent's expanded container.
          const baseTop = laneTop[s.lane] + TITLE_STRIP;
          top = baseTop + (s.subLane * (SUB_H + SUB_GAP));
          height = SUB_H + 4;  // slightly taller than a leaf chip so the dashed border reads
          const stHex = statusColors[s.event.task.slackStatus] || '#d97706';
          const _h = stHex.length === 4 ? '#' + stHex[1]+stHex[1]+stHex[2]+stHex[2]+stHex[3]+stHex[3] : stHex;
          const _r = parseInt(_h.slice(1,3), 16), _g = parseInt(_h.slice(3,5), 16), _b = parseInt(_h.slice(5,7), 16);
          color = 'rgba(' + _r + ',' + _g + ',' + _b + ',0.18)';
          extraStyle = '; border:1.5px dashed ' + stHex + '; color:' + stHex;
          fontSize = 10;
          cls.push('cal-event-group');
          cls.push('cal-event-nested-group');
          const gid = s.event.task.id;
          const totalSubLanes = (subLanesByParent[gid] || []).length;
          const isExpanded = expandedSet.has(gid);
          if (isExpanded) cls.push('expanded');
          label = '📁 ' + escapeHtml(s.event.task.subject);
          if (totalSubLanes > 0) {
            const chev = isExpanded ? '▾' : '▸';
            const ttl = isExpanded ? 'Collapse group' : 'Expand group';
            label += ' <button type="button" class="cal-group-toggle" data-group-toggle="' + gid + '" title="' + ttl + '">' + chev + '</button>';
          }
        } else if (isGroupEvent) {
          // Group container bar — tinted by status (transparent backdrop, dashed status-colored border)
          const gid = s.event.task.id;
          top = laneTop[s.lane];
          const hasKids = (subLanesByParent[gid] && subLanesByParent[gid].length > 0);
          // Only stretch the bar when the group is EXPANDED with visible kids.
          // Collapsed groups (even with hidden kids) get a normal 22px bar so the dashed border
          // edges sit comfortably around the title text (line-height 22) instead of crossing it.
          const visibleSubLanes = groupVisibleSubLanesCount(gid);
          height = (hasKids && visibleSubLanes > 0) ? (laneHeights[s.lane] - 4) : 22;
          // Pick a status hex from the saturated map; fall back to amber for empty/unknown
          const stHex = statusColors[s.event.task.slackStatus] || '#d97706';
          // Convert hex to rgba with alpha — accepts #rgb or #rrggbb
          const _h = stHex.length === 4 ? '#' + stHex[1]+stHex[1]+stHex[2]+stHex[2]+stHex[3]+stHex[3] : stHex;
          const _r = parseInt(_h.slice(1,3), 16), _g = parseInt(_h.slice(3,5), 16), _b = parseInt(_h.slice(5,7), 16);
          color = 'rgba(' + _r + ',' + _g + ',' + _b + ',0.18)';
          // Inline-style overrides for border/text so each status looks distinct
          extraStyle = '; border-color:' + stHex + '; color:' + stHex;
          fontSize = 11;
          cls.push('cal-event-group');
          const totalSubLanes = (subLanesByParent[gid] || []).length;
          const canExpand = totalSubLanes > 0;
          const isExpanded = expandedSet.has(gid);
          if (isExpanded) cls.push('expanded');
          label = '📁 ' + escapeHtml(s.event.task.subject);
          if (canExpand) {
            // Chevron toggle inline with the title — appears on every week the group spans.
            // Always rendered when the group has kids (collapsed = no kids shown, expanded = all kids shown).
            const chev = isExpanded ? '▾' : '▸';
            const ttl = isExpanded ? 'Collapse group (hide all rows)' : 'Expand group (show all ' + totalSubLanes + ' rows)';
            label += ' <button type="button" class="cal-group-toggle" data-group-toggle="' + gid + '" title="' + ttl + '">' + chev + '</button>';
          }
        } else {
          // Normal task bar
          top = laneTop[s.lane];
          height = 20;
          color = statusColors[s.event.task.slackStatus] || '#1a1a1a';
          fontSize = 11;
          label = escapeHtml(s.event.task.subject);
        }
        if (s.continuesLeft) cls.push('continues-left');
        if (s.continuesRight) cls.push('continues-right');
        const tooltipText = s.event.task.subject + (isGroupEvent ? ' [Group]' : '') + ' — ' + (s.event.entry.startDate||'?') + ' → ' + (s.event.entry.endDate||'?');
        // Group bar: align title to left when there's a chevron so they don't collide
        const lineHeight = isGroupEvent ? 22 : (height - 2);
        html += '<div class="' + cls.join(' ') + '" data-tid="' + s.event.task.id + '"' +
          ' title="' + escapeHtml(tooltipText) + '"' +
          ' style="left:calc(' + left + '% + 4px); width:calc(' + width + '% - 8px);' +
          ' top:' + top + 'px; height:' + height + 'px; line-height:' + lineHeight + 'px;' +
          ' background:' + color + '; font-size:' + fontSize + 'px' + extraStyle + '">' +
          (s.continuesLeft ? '◂ ' : '') + label + (s.continuesRight ? ' ▸' : '') +
          extraHtml +
        '</div>';
      }
      // Render parents first (so children draw on top)
      parentSegs.forEach(s => renderSeg(s, { nested: false }));
      childSegs.forEach(s => renderSeg(s, { nested: !!parentSegByTaskId[s.event.task.groupId] }));
      // No "+N more" pills — collapsed groups hide kids entirely, day height grows to fit all visible lanes.
      html += '</div>'; // .cal-events-overlay
      html += '</div>'; // .cal-week
    }
    html += '</div>'; // .cal-grid
  }
  // Close cal-area
  html += '</div>';

  // Side-area only when there are unscheduled (or archived) tasks
  if (hasSide) {
    html += '<div class="rm-side-area">';
    const minDate = r.startDate ? r.startDate : '';
    const allGroups = (STORE.tasks || []).filter(t => t.isGroup);
    // Shared row builder so the same markup is used for active + archived rows.
    function buildSideRowHtml(entry) {
      const task = bnTaskById(entry.taskId);
      if (!task) return '';
      const eff = effectiveDatesFor(entry);
      const ready = !!parseDate(eff.startStr);
      const isThisAGroup = !!task.isGroup;
      const canAnchor = (r.tasks || []).filter(en => en.taskId !== task.id).length > 0;
      // Anchors are task-level now — read them from the task.
      const sA = task.startAnchor || '';
      const eA = task.endAnchor   || '';
      function anchorLabel(anchorVal) {
        const ref = parseAnchorRefGlobal({ taskId: task.id }, anchorVal);
        if (!ref) return '';
        const tt = bnTaskById(ref.taskId);
        if (!tt) return '';
        return (tt.subject || '(unnamed)') + ' — ' + ref.side;
      }
      function pinBtnHtml(cls, isActive, kind, anchorVal) {
        const label = anchorLabel(anchorVal);
        const tooltip = isActive
          ? 'Anchored to ' + (label || 'another task') + ' — click to change/unlock'
          : 'Click to anchor ' + kind + ' to another task on this roadmap';
        return '<button type="button" class="rmt-pin ' + cls + (isActive ? ' active' : '') + '" title="' + escapeHtml(tooltip) + '" data-kind="' + kind + '">📌</button>';
      }
      // Group picker — chip+dropdown styled like the task modal's group picker. Click chip → opens
      // searchable popover; selection writes task.groupId and re-renders.
      const groupPickerHtml = isThisAGroup ? '' : (() => {
        const currentG = task.groupId ? (STORE.tasks.find(x => x.isGroup && x.id === task.groupId) || null) : null;
        const status = currentG && currentG.slackStatus ? currentG.slackStatus : '';
        const chipInner = currentG
          ? '<span class="folder-emoji" style="font-size:13px">📁</span>' +
            '<span class="gp-name">' + escapeHtml(currentG.subject || '(unnamed)') + '</span>' +
            '<button type="button" class="gp-clear" title="Clear group">×</button>' +
            '<span class="gp-caret">▾</span>'
          : '<span class="gp-empty">— No group —</span><span class="gp-caret">▾</span>';
        return (
          '<div class="rmt-gp-box group-picker-box" data-tid="' + task.id + '">' +
            '<div class="rmt-gp-chip group-picker-chip"' + (status ? ' data-status="' + escapeHtml(status) + '"' : '') + ' tabindex="0">' +
              chipInner +
            '</div>' +
            '<div class="rmt-gp-dropdown group-picker-dropdown" style="display:none">' +
              '<input type="text" class="rmt-gp-search group-picker-search" placeholder="Search a group…" autocomplete="off">' +
              '<div class="rmt-gp-list group-picker-list"></div>' +
            '</div>' +
          '</div>'
        );
      })();
      // Sidebar reads dates from the TASK (task-level dates apply to every roadmap the task is in).
      const _storedDur = (typeof task.durationDays === 'number' && task.durationDays >= 1) ? task.durationDays : null;
      const _dur = _storedDur || ((task.startDate && task.endDate) ? bnDaysInclusive(task.startDate, task.endDate) : '');
      return '<div class="rm-task-row ' + (ready ? "ready" : "") + '" data-tid="' + task.id + '" data-pstatus="' + escapeHtml(task.slackStatus || '') + '">' +
        '<div class="rmt-head">' +
          '<button type="button" class="rmt-title-btn" data-tid="' + task.id + '" title="' + escapeHtml(task.subject) + ' — click to edit">' + (isThisAGroup ? '📁 ' : '') + escapeHtml(task.subject.slice(0,80)) + (task.subject.length>80?'…':'') + '</button>' +
          '<button class="rm-task-del danger" data-tid="' + task.id + '" title="Remove from roadmap">×</button>' +
        '</div>' +
        (groupPickerHtml ? '<div class="rmt-group-row">' + groupPickerHtml + '</div>' : '') +
        '<div class="rmt-dates-grid">' +
          '<div class="rmt-pair">' +
            '<span class="rmt-label">Start</span>' +
            '<div class="rmt-input-wrap">' +
              (canAnchor ? pinBtnHtml('rmt-pin-start', !!sA, 'start', sA) : '') +
              '<input type="date" class="rmt-start" value="' + escapeHtml(task.startDate||'') + '"' + (minDate ? ' min="' + escapeHtml(minDate) + '"' : '') + ' data-default-month="' + escapeHtml(minDate) + '"' + (sA ? ' disabled' : '') + ' title="Start (task-level — applies to all roadmaps)">' +
            '</div>' +
          '</div>' +
          '<div class="rmt-pair">' +
            '<span class="rmt-label">End</span>' +
            '<div class="rmt-input-wrap">' +
              '<input type="date" class="rmt-end" value="' + escapeHtml(task.endDate||'') + '"' + (minDate ? ' min="' + escapeHtml(minDate) + '"' : '') + ' data-default-month="' + escapeHtml(minDate) + '"' + (eA ? ' disabled' : '') + ' title="End (task-level — applies to all roadmaps)">' +
              (canAnchor ? pinBtnHtml('rmt-pin-end', !!eA, 'end', eA) : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="rmt-duration-row">' +
          '<span>or</span>' +
          '<input type="number" class="rmt-duration" min="1" step="1" value="' + (_dur || '') + '" placeholder="N" title="Duration in days (inclusive). Sets End = Start + N − 1 days."' + (eA ? ' disabled' : '') + '>' +
          '<span>days</span>' +
        '</div>' +
      '</div>';
    }
    // ---- Active unscheduled ----
    if (unscheduled.length > 0) {
      const pendingCount = unscheduled.filter(e => parseDate(effectiveDatesFor(e).startStr)).length;
      html += '<div class="rm-unscheduled" style="margin-top:14px; padding:12px; background:#fffbeb; border:1px solid #fde68a; border-radius:10px">' +
        '<div class="rm-unscheduled-head">' +
          '<strong style="font-size:13px">Unscheduled (' + unscheduled.length + ')</strong>' +
          '<button class="btn primary" id="rmApplyDatesBtn"' + (pendingCount === 0 ? ' disabled' : '') + '>Apply' + (pendingCount > 0 ? ' (' + pendingCount + ')' : '') + '</button>' +
        '</div>';
      unscheduled.forEach(entry => { html += buildSideRowHtml(entry); });
      html += '</div>';
    }
    // ---- Archived (own collapsible section below) ----
    if (archivedEntries.length > 0) {
      if (!window.__rmArchivedExpanded) window.__rmArchivedExpanded = {};
      const archExpanded = !!window.__rmArchivedExpanded[r.id];
      html += '<div class="rm-archived' + (archExpanded ? ' expanded' : '') + '" data-rmid="' + escapeHtml(r.id) + '" style="margin-top:14px; padding:0; background:#f5f5f4; border:1px solid #d8d6d1; border-radius:10px">' +
        '<button type="button" class="rm-archived-head" id="rmArchivedToggle">' +
          '<span class="rm-arch-caret">▶</span>' +
          '<strong style="font-size:13px; color:#64748b">📦 Archived (' + archivedEntries.length + ')</strong>' +
        '</button>' +
        '<div class="rm-archived-body" style="' + (archExpanded ? '' : 'display:none;') + ' padding:0 12px 12px">';
      archivedEntries.forEach(entry => { html += buildSideRowHtml(entry); });
      html += '</div></div>';
    }
    html += '</div>';
  }

  // Close row
  html += '</div>';
  cont.innerHTML = html;

  // Wire up navigation — behavior depends on viewMode
  document.getElementById('calPrev').addEventListener('click', () => {
    if (atStart) return;
    if (viewMode === 'week') {
      const next = new Date(gridStart); next.setDate(next.getDate() - 7);
      if (rmStart) {
        const minWk = bnMondayOf(rmStart);
        if (next.getTime() < minWk.getTime()) roadmapCalState.weekStart = minWk;
        else roadmapCalState.weekStart = next;
      } else roadmapCalState.weekStart = next;
    } else if (viewMode === 'year') {
      let y = roadmapCalState.year - 1;
      if (rmStart && y < rmStart.getFullYear()) y = rmStart.getFullYear();
      roadmapCalState.year = y;
    } else if (viewMode === '6m') {
      const a = new Date(halfYearStartDate);
      const next = new Date(a.getFullYear(), a.getMonth() - 1, 1);
      if (rmStart) {
        const rmFirst = new Date(rmStart.getFullYear(), rmStart.getMonth(), 1);
        if (next.getTime() < rmFirst.getTime()) roadmapCalState.halfYearAnchor = rmFirst;
        else roadmapCalState.halfYearAnchor = next;
      } else roadmapCalState.halfYearAnchor = next;
    } else {
      let m = ym.month - 1, y = ym.year;
      if (m < 0) { m = 11; y--; }
      if (rmStart && (y < rmStart.getFullYear() || (y === rmStart.getFullYear() && m < rmStart.getMonth()))) {
        y = rmStart.getFullYear(); m = rmStart.getMonth();
      }
      roadmapCalState.yearMonth = { year: y, month: m };
    }
    renderRoadmapCalendar(roadmapId);
  });
  document.getElementById('calNext').addEventListener('click', () => {
    if (viewMode === 'week') {
      const next = new Date(gridStart); next.setDate(next.getDate() + 7);
      roadmapCalState.weekStart = next;
    } else if (viewMode === 'year') {
      roadmapCalState.year = roadmapCalState.year + 1;
    } else if (viewMode === '6m') {
      const a = new Date(halfYearStartDate);
      roadmapCalState.halfYearAnchor = new Date(a.getFullYear(), a.getMonth() + 1, 1);
    } else {
      let m = ym.month + 1, y = ym.year;
      if (m > 11) { m = 0; y++; }
      roadmapCalState.yearMonth = { year: y, month: m };
    }
    renderRoadmapCalendar(roadmapId);
  });
  document.getElementById('calToday').addEventListener('click', () => {
    const t = new Date();
    if (viewMode === 'week') {
      roadmapCalState.weekStart = bnMondayOf(t);
    } else if (viewMode === 'year') {
      roadmapCalState.year = t.getFullYear();
    } else if (viewMode === '6m') {
      roadmapCalState.halfYearAnchor = new Date(t.getFullYear(), t.getMonth(), 1);
    } else {
      roadmapCalState.yearMonth = { year: t.getFullYear(), month: t.getMonth() };
    }
    renderRoadmapCalendar(roadmapId);
  });
  // View mode toggle (Month / Week)
  const vMonthBtn = document.getElementById('calViewMonth');
  const vWeekBtn  = document.getElementById('calViewWeek');
  if (vMonthBtn) vMonthBtn.addEventListener('click', () => {
    if (roadmapCalState.viewMode === 'month') return;
    const prev = roadmapCalState.viewMode;
    roadmapCalState.viewMode = 'month';
    localStorage.setItem('bookline-rm-view-mode', 'month');
    // Always snap to the current month when switching INTO month view from year/6m (parity with the week button)
    if (prev === 'year' || prev === '6m') {
      const t = new Date();
      roadmapCalState.yearMonth = { year: t.getFullYear(), month: t.getMonth() };
    } else if (gridStart) {
      // Coming from week view: anchor to the visible week's month
      roadmapCalState.yearMonth = { year: gridStart.getFullYear(), month: gridStart.getMonth() };
    }
    renderRoadmapCalendar(roadmapId);
  });
  if (vWeekBtn) vWeekBtn.addEventListener('click', () => {
    if (roadmapCalState.viewMode === 'week') return;
    roadmapCalState.viewMode = 'week';
    localStorage.setItem('bookline-rm-view-mode', 'week');
    // Anchor the week at the Monday of today (or current month's 1st week if today is outside the month)
    if (!roadmapCalState.weekStart) {
      const todayMon = bnMondayOf(new Date());
      const monthFirst = new Date(ym.year, ym.month, 1);
      const inMonth = todayMon.getFullYear() === ym.year && todayMon.getMonth() === ym.month;
      roadmapCalState.weekStart = inMonth ? todayMon : bnMondayOf(monthFirst);
    }
    renderRoadmapCalendar(roadmapId);
  });
  const vYearBtn = document.getElementById('calViewYear');
  if (vYearBtn) vYearBtn.addEventListener('click', () => {
    if (roadmapCalState.viewMode === 'year') return;
    roadmapCalState.viewMode = 'year';
    localStorage.setItem('bookline-rm-view-mode', 'year');
    if (!roadmapCalState.year) {
      roadmapCalState.year = (gridStart ? gridStart.getFullYear() : new Date().getFullYear());
    }
    renderRoadmapCalendar(roadmapId);
  });
  const v6mBtn = document.getElementById('calView6m');
  if (v6mBtn) v6mBtn.addEventListener('click', () => {
    if (roadmapCalState.viewMode === '6m') return;
    roadmapCalState.viewMode = '6m';
    localStorage.setItem('bookline-rm-view-mode', '6m');
    if (!roadmapCalState.halfYearAnchor) {
      const t = new Date();
      roadmapCalState.halfYearAnchor = new Date(t.getFullYear(), t.getMonth(), 1);
    }
    renderRoadmapCalendar(roadmapId);
  });
  // Collapse-all / Expand-all toggle — operates on the global bn-group-expanded map
  const collapseAllBtn = document.getElementById('calCollapseAll');
  if (collapseAllBtn) collapseAllBtn.addEventListener('click', () => {
    const allGids = (STORE.tasks || []).filter(t => t.isGroup).map(g => g.id);
    const anyExpanded = allGids.some(g => isGroupExpanded(g));
    const m = (function(){ try { return JSON.parse(localStorage.getItem('bn-group-expanded')) || {}; } catch(_) { return {}; } })();
    allGids.forEach(g => { m[g] = !anyExpanded; });
    localStorage.setItem('bn-group-expanded', JSON.stringify(m));
    renderRoadmapCalendar(roadmapId);
  });
  // Side toggle (hide/show Unscheduled + Archived sidebar)
  const sideToggleBtn = document.getElementById('calSideToggle');
  if (sideToggleBtn) sideToggleBtn.addEventListener('click', () => {
    roadmapCalState.sideHidden = !roadmapCalState.sideHidden;
    localStorage.setItem('bookline-rm-side-hidden', roadmapCalState.sideHidden ? 'true' : 'false');
    renderRoadmapCalendar(roadmapId);
  });
  // Event clicks → open a small popover to edit roadmap dates (and a link to open the task modal)
  function closeCalEventPopover() {
    const old = document.querySelector('.cal-event-edit-popover');
    if (old) old.remove();
  }
  // Chevron toggle inside group bars (month/week view) — uses the GLOBAL bn-group-expanded map
  // so the same state is shared with year/6m views and the task lists.
  cont.querySelectorAll('.cal-group-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const gid = btn.dataset.groupToggle;
      if (!gid) return;
      window.toggleGroupExpanded(gid);
      closeCalEventPopover();
      renderRoadmapCalendar(roadmapId);
    });
  });
  // Chevron toggle inside YEAR/6m group bars / labels — uses the GLOBAL bn-group-expanded map
  cont.querySelectorAll('.cal-event-group .cal-group-toggle-y, .cal-year-bar .cal-group-toggle-y, .cal-year-label .cal-group-toggle-y').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const gid = btn.dataset.gid || btn.closest('[data-tid]')?.dataset.tid;
      if (gid) { window.toggleGroupExpanded(gid); renderRoadmapCalendar(roadmapId); }
    });
  });
  // "+N more" pill — click to expand group
  cont.querySelectorAll('.cal-event-child-overflow[data-expand-group]').forEach(node => {
    node.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const gid = node.dataset.expandGroup;
      if (gid) { window.toggleGroupExpanded(gid); renderRoadmapCalendar(roadmapId); }
    });
  });
  // 6 MFN / Year view: clicking the LABEL TEXT in the left column opens the task modal.
  cont.querySelectorAll('.cal-year-label-text').forEach(node => {
    node.style.cursor = 'pointer';
    node.addEventListener('click', e => {
      e.stopPropagation();
      const row = node.closest('.cal-year-row');
      if (!row) return;
      const tid = row.dataset.tid;
      if (tid && typeof openModal === 'function') {
        try { openModal(tid); } catch(_) {}
      }
    });
  });
  cont.querySelectorAll('.cal-event').forEach(node => {
    node.addEventListener('click', e => {
      // Don't open the date popover if the chevron toggle was clicked
      if (e.target.closest('.cal-group-toggle')) return;
      if (e.target.closest('.cal-group-toggle-y')) return;
      e.stopPropagation();
      const tid = node.dataset.tid;
      // Restricted/preview users: skip the cal-event-edit-popover entirely.
      // That popover lets users edit Start/End dates AND "Remove from roadmap" —
      // both mutations that shouldn't be available to them. Fall through to
      // openModal, which is already gated (only opens for own/proposed tasks
      // and renders fully view-only).
      if (typeof bnIsRestrictedView === 'function' && bnIsRestrictedView()) {
        if (typeof openModal === 'function') openModal(tid);
        return;
      }
      const entry = (r.tasks || []).find(en => en.taskId === tid);
      if (!entry) { openModal(tid); return; }
      const task = bnTaskById(tid);
      if (!task) return;
      closeCalEventPopover();
      const pop = document.createElement('div');
      pop.className = 'cal-event-edit-popover';
      const isG = !!task.isGroup;
      // Read from the TASK (dates are task-level now and shared across all roadmaps).
      const _taskHere = (STORE.tasks || []).find(x => x.id === entry.taskId);
      const sAnchor = (_taskHere && _taskHere.startAnchor) || '';
      const eAnchor = (_taskHere && _taskHere.endAnchor) || '';
      const _tStart = (_taskHere && _taskHere.startDate) || '';
      const _tEnd   = (_taskHere && _taskHere.endDate) || '';
      const canAnchor = (STORE.tasks || []).filter(t => t.id !== entry.taskId).length > 0;
      function cepPinHtml(id, isActive, kind, anchorVal) {
        const ref = parseAnchorRef(entry, anchorVal);
        let labelHint = '';
        if (ref) {
          const tt = bnTaskById(ref.taskId);
          if (tt) labelHint = (tt.subject || '(unnamed)') + ' — ' + ref.side;
        }
        const tooltip = isActive
          ? 'Anchored to ' + (labelHint || 'another task') + ' — click to change/unlock'
          : 'Click to anchor ' + kind + ' to another task on this roadmap';
        return '<button type="button" id="' + id + '" class="cep-pin' + (isActive ? ' active' : '') + '" title="' + escapeHtml(tooltip) + '" data-kind="' + kind + '">📌</button>';
      }
      function cepAnchorHint(anchorVal, kind) {
        const ref = parseAnchorRef(entry, anchorVal);
        if (!ref) return '';
        const tt = bnTaskById(ref.taskId);
        if (!tt) return '';
        const icon = tt.isGroup ? '📁 ' : '';
        return '<div class="cep-anchor-hint">Linked to <strong>' + icon + escapeHtml(tt.subject || '(unnamed)') + '</strong> — ' + ref.side + '</div>';
      }
      pop.innerHTML =
        '<h4>' + (isG ? '📁 ' : '') + escapeHtml(task.subject) + '</h4>' +
        '<div class="cep-row"><label>Start</label>' +
          (canAnchor ? cepPinHtml('cepStartPin', !!sAnchor, 'start', sAnchor) : '') +
          '<input type="date" id="cepStart" value="' + escapeHtml(_tStart) + '"' + (r.startDate ? ' min="' + escapeHtml(r.startDate) + '"' : '') + (sAnchor ? ' disabled' : '') + '>' +
        '</div>' +
        '<div id="cepStartHint">' + cepAnchorHint(sAnchor, 'start') + '</div>' +
        '<div class="cep-row"><label>End</label>' +
          (canAnchor ? cepPinHtml('cepEndPin', !!eAnchor, 'end', eAnchor) : '') +
          '<input type="date" id="cepEnd" value="' + escapeHtml(_tEnd) + '"' + (r.startDate ? ' min="' + escapeHtml(r.startDate) + '"' : '') + (eAnchor ? ' disabled' : '') + '>' +
        '</div>' +
        '<div id="cepEndHint">' + cepAnchorHint(eAnchor, 'end') + '</div>' +
        '<div class="cep-actions">' +
          '<button type="button" class="cep-link" id="cepOpenTask">Open task →</button>' +
          '<button type="button" class="danger" id="cepRemove">Remove from roadmap</button>' +
        '</div>';
      document.body.appendChild(pop);
      // Position near the clicked node
      const rect = node.getBoundingClientRect();
      pop.style.left = (rect.left + window.scrollX) + 'px';
      pop.style.top = (rect.bottom + window.scrollY + 6) + 'px';
      // Flip if no room below
      setTimeout(() => {
        const pr = pop.getBoundingClientRect();
        if (pr.right > window.innerWidth - 8) {
          pop.style.left = Math.max(8, window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
        }
        if (pr.bottom > window.innerHeight - 8) {
          const above = rect.top - pr.height - 6;
          pop.style.top = (Math.max(8, above) + window.scrollY) + 'px';
        }
      }, 0);
      // The calendar popover edits the TASK's schedule directly (since dates are now task-level
      // and shared across all roadmaps the task is in).
      const _taskRef = (STORE.tasks || []).find(x => x.id === entry.taskId);
      pop.querySelector('#cepStart').addEventListener('change', ev => {
        if (!_taskRef) return;
        _taskRef.startDate = ev.target.value;
        _taskRef.startAnchor = '';   // setting a custom date clears the anchor
        const pin = pop.querySelector('#cepStartPin');
        if (pin) pin.classList.remove('active');
        const hintEl = pop.querySelector('#cepStartHint');
        if (hintEl) hintEl.innerHTML = '';
        saveAndSyncTaskDates();
        renderRoadmapCalendar(roadmapId);
      });
      pop.querySelector('#cepEnd').addEventListener('change', ev => {
        if (!_taskRef) return;
        _taskRef.endDate = ev.target.value;
        _taskRef.endAnchor = '';
        const pin = pop.querySelector('#cepEndPin');
        if (pin) pin.classList.remove('active');
        const hintEl = pop.querySelector('#cepEndHint');
        if (hintEl) hintEl.innerHTML = '';
        saveAndSyncTaskDates();
        renderRoadmapCalendar(roadmapId);
      });
      function wireCepPin(pinId, kind) {
        const pin = pop.querySelector('#' + pinId);
        if (!pin) return;
        pin.addEventListener('click', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          if (!_taskRef) return;
          const currentRaw = (kind === 'start' ? _taskRef.startAnchor : _taskRef.endAnchor) || '';
          const current = normalizeAnchorForSelect({ taskId: _taskRef.id }, currentRaw);
          openAnchorPicker(pin, entry, kind, current, (newVal) => {
            if (kind === 'start') _taskRef.startAnchor = newVal || '';
            else                  _taskRef.endAnchor   = newVal || '';
            // Update pin appearance
            pin.classList.toggle('active', !!newVal);
            // Update date input disabled state
            const inp = pop.querySelector(kind === 'start' ? '#cepStart' : '#cepEnd');
            if (inp) inp.disabled = !!newVal;
            // Update hint line
            const hintEl = pop.querySelector(kind === 'start' ? '#cepStartHint' : '#cepEndHint');
            if (hintEl) hintEl.innerHTML = cepAnchorHint(newVal, kind);
            // Update tooltip
            const ref = parseAnchorRef(entry, newVal);
            let labelHint = '';
            if (ref) {
              const tt = bnTaskById(ref.taskId);
              if (tt) labelHint = (tt.subject || '(unnamed)') + ' — ' + ref.side;
            }
            pin.title = newVal
              ? 'Anchored to ' + (labelHint || 'another task') + ' — click to change/unlock'
              : 'Click to anchor ' + kind + ' to another task on this roadmap';
            saveAndSyncTaskDates();
            renderRoadmapCalendar(roadmapId);
          });
        });
      }
      wireCepPin('cepStartPin', 'start');
      wireCepPin('cepEndPin', 'end');
      pop.querySelector('#cepRemove').addEventListener('click', () => {
        if (!confirm('Remove "' + (task.subject||'this task') + '" from this roadmap?')) return;
        r.tasks = (r.tasks || []).filter(en => en.taskId !== tid);
        saveAndSyncTaskDates();
        closeCalEventPopover();
        renderRoadmapCalendar(roadmapId);
      });
      pop.querySelector('#cepOpenTask').addEventListener('click', () => {
        closeCalEventPopover();
        openModal(tid);
      });
    });
  });
  // Click outside the popover or any event closes it
  document.addEventListener('click', e => {
    const pop = document.querySelector('.cal-event-edit-popover');
    if (!pop) return;
    if (pop.contains(e.target) || e.target.closest('.cal-event')) return;
    // Don't close when interacting with the anchor picker menu (lives in body)
    if (e.target.closest('.bn-anchor-menu')) return;
    pop.remove();
  });
  // Hide-weekends toggle
  const hwCb = document.getElementById('calHideWeekends');
  if (hwCb) {
    hwCb.addEventListener('change', () => {
      roadmapCalState.hideWeekends = hwCb.checked;
      localStorage.setItem('bookline-rm-hide-weekends', hwCb.checked ? 'true' : 'false');
      renderRoadmapCalendar(roadmapId);
    });
  }
  // Toggle worked / time-off based on day type
  cont.querySelectorAll('.day-num.toggle').forEach(node => {
    node.addEventListener('click', e => {
      e.stopPropagation();
      const ds = node.dataset.toggleDate;
      if (!ds) return;
      const d = parseDate(ds);
      if (!d) return;
      const isWknd = isWeekendDay(d);
      const holName = holidayName(d);
      if (isTimeOff(d, personIdForOverrides)) {
        // Already time-off → revert to working
        toggleTimeOff(ds, personIdForOverrides);
      } else if (isWknd || holName) {
        // Weekend/holiday → toggle worked override
        toggleWorkedOverride(ds, personIdForOverrides);
      } else {
        // Regular working day → mark as time-off
        toggleTimeOff(ds, personIdForOverrides);
      }
      renderRoadmapCalendar(roadmapId);
    });
  });
  // Roadmap picker trigger (alphabetical, with search) — matches the Profile pattern.
  wireRoadmapNamePicker(roadmapId);
  // Summary buttons
  const editBtn = document.getElementById('rmEditBtn');
  if (editBtn) editBtn.addEventListener('click', () => openRoadmapEdit(roadmapId));
  // Owner chip click → open the person modal (same UX as Team page)
  const ownerChip = cont.querySelector('.rm-owner-chip');
  if (ownerChip) ownerChip.addEventListener('click', () => {
    setProfilePerson(ownerChip.dataset.owner);
    switchView("profile");
  });
  const addTaskBtn = document.getElementById('rmAddTaskBtn');
  if (addTaskBtn) addTaskBtn.addEventListener('click', () => openRoadmapEdit(roadmapId));
  const delBtn = document.getElementById('rmDeleteBtn');
  if (delBtn) delBtn.addEventListener('click', () => {
    if (!confirm("Delete '" + (r.name||'this roadmap') + "'?")) return;
    STORE.roadmaps = getRoadmaps().filter(x => x.id !== roadmapId);
    saveStore(STORE);
    selectedRoadmapTimelineId = null;
    renderRoadmapsTimelinePage();
  });
  // Side-panel inline edits (covers both Unscheduled and Archived rows)
  cont.querySelectorAll('.rm-unscheduled .rm-task-row, .rm-archived-body .rm-task-row').forEach(node => {
    const tid = node.dataset.tid;
    const idx = (r.tasks||[]).findIndex(e => e.taskId === tid);
    // Click on the title → open the task modal for editing
    const titleBtn = node.querySelector('.rmt-title-btn');
    if (titleBtn) titleBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (typeof openModal === 'function') openModal(tid);
    });
    function refreshRowReadyState() {
      // "Ready" if this entry has an effective start date (custom or via anchor)
      const thisEntry = idx >= 0 ? r.tasks[idx] : null;
      const thisEff = thisEntry ? effectiveDatesFor(thisEntry) : { startStr: '' };
      node.classList.toggle('ready', !!parseDate(thisEff.startStr));
      // Update Apply button count
      let pendingReady = 0;
      cont.querySelectorAll('.rm-unscheduled .rm-task-row').forEach(n => {
        const tid2 = n.dataset.tid;
        const entry2 = (r.tasks||[]).find(en => en.taskId === tid2);
        if (!entry2) return;
        const eff = effectiveDatesFor(entry2);
        if (parseDate(eff.startStr)) pendingReady++;
      });
      const applyBtn = document.getElementById('rmApplyDatesBtn');
      if (applyBtn) {
        applyBtn.disabled = pendingReady === 0;
        applyBtn.textContent = pendingReady > 0 ? ('Apply (' + pendingReady + ')') : 'Apply';
      }
    }
    // Sidebar row writers now target the TASK directly. Dates are task-level: any change in this
    // row applies to ALL roadmaps the task is in (not just this roadmap entry).
    const _sideTask = bnTaskById(tid);
    // Helper: refresh duration input from task.durationDays or computed from Start/End
    function refreshDurInput() {
      const di = node.querySelector('.rmt-duration');
      if (!di || !_sideTask) return;
      if (typeof _sideTask.durationDays === 'number' && _sideTask.durationDays >= 1) {
        di.value = _sideTask.durationDays;
      } else if (_sideTask.startDate && _sideTask.endDate) {
        di.value = bnDaysInclusive(_sideTask.startDate, _sideTask.endDate) || '';
      } else {
        di.value = '';
      }
    }
    node.querySelector('.rmt-start').addEventListener('change', e => {
      if (!_sideTask) return;
      _sideTask.startDate = e.target.value;
      _sideTask.startAnchor = '';
      // If a stored duration exists, ALWAYS recompute end = start + (N − 1) days.
      const storedN = _sideTask.durationDays;
      if (typeof storedN === 'number' && storedN >= 1 && _sideTask.startDate) {
        const newEnd = bnEndFromStartAndDuration(_sideTask.startDate, storedN);
        if (newEnd) {
          _sideTask.endDate = newEnd;
          _sideTask.endAnchor = '';
          const eInp = node.querySelector('.rmt-end');
          if (eInp) eInp.value = newEnd;
        }
      }
      if (parseDate(_sideTask.startDate)) window.__rmPendingApply.add(tid);
      refreshDurInput();
      saveAndSyncTaskDates();
      refreshRowReadyState();
    });
    node.querySelector('.rmt-end').addEventListener('change', e => {
      if (!_sideTask) return;
      _sideTask.endDate = e.target.value;
      _sideTask.endAnchor = '';
      delete _sideTask.durationDays;
      if (parseDate(_sideTask.endDate)) window.__rmPendingApply.add(tid);
      refreshDurInput();
      saveAndSyncTaskDates();
      refreshRowReadyState();
    });
    // Duration input — stored on task.durationDays. Sets End = Start + (N − 1) days.
    const durInput = node.querySelector('.rmt-duration');
    if (durInput) {
      durInput.addEventListener('change', e => {
        if (!_sideTask) return;
        const n = parseInt(durInput.value, 10);
        const eff = effectiveDatesForTask(_sideTask);
        const startStr = eff.startStr || _sideTask.startDate || node.querySelector('.rmt-start')?.value || '';
        if (!Number.isFinite(n) || n < 1) {
          delete _sideTask.durationDays;
          _sideTask.endDate = '';
          _sideTask.endAnchor = '';
          const eInp = node.querySelector('.rmt-end');
          if (eInp) { eInp.value = ''; eInp.disabled = false; }
          const ePin = node.querySelector('.rmt-pin[data-kind="end"]');
          if (ePin) ePin.classList.remove('active');
        } else {
          _sideTask.durationDays = n;
          if (startStr) {
            const newEnd = bnEndFromStartAndDuration(startStr, n);
            if (newEnd) {
              _sideTask.endDate = newEnd;
              _sideTask.endAnchor = '';
              const eInp = node.querySelector('.rmt-end');
              if (eInp) { eInp.value = newEnd; eInp.disabled = false; }
              const ePin = node.querySelector('.rmt-pin[data-kind="end"]');
              if (ePin) ePin.classList.remove('active');
              window.__rmPendingApply.add(tid);
            }
          }
        }
        saveAndSyncTaskDates();
        refreshRowReadyState();
      });
    }
    // Anchor pin buttons → write to TASK anchors (task-level). Any change reflects in every roadmap.
    node.querySelectorAll('.rmt-pin').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!_sideTask) return;
        const kind = btn.dataset.kind;
        const currentRaw = (kind === 'start' ? _sideTask.startAnchor : _sideTask.endAnchor) || '';
        const current = normalizeAnchorForSelect({ taskId: _sideTask.id }, currentRaw);
        openAnchorPicker(btn, r.tasks[idx], kind, current, (newVal) => {
          if (kind === 'start') _sideTask.startAnchor = newVal || '';
          else                  _sideTask.endAnchor   = newVal || '';
          btn.classList.toggle('active', !!newVal);
          btn.title = newVal ? 'Anchored — click to change/unlock' : 'Click to anchor ' + kind + ' to another task';
          const inp = node.querySelector(kind === 'start' ? '.rmt-start' : '.rmt-end');
          if (inp) inp.disabled = !!newVal;
          if (kind === 'start') {
            const storedN = _sideTask.durationDays;
            if (typeof storedN === 'number' && storedN >= 1) {
              const eff = effectiveDatesForTask(_sideTask);
              if (eff.startStr) {
                const newEnd = bnEndFromStartAndDuration(eff.startStr, storedN);
                if (newEnd) {
                  _sideTask.endDate = newEnd;
                  _sideTask.endAnchor = '';
                  const eInp = node.querySelector('.rmt-end');
                  if (eInp) { eInp.value = newEnd; eInp.disabled = false; }
                  const ePin = node.querySelector('.rmt-pin[data-kind="end"]');
                  if (ePin) ePin.classList.remove('active');
                }
              }
            }
          }
          if (kind === 'end' && newVal) {
            delete _sideTask.durationDays;
            const di = node.querySelector('.rmt-duration');
            if (di) di.value = '';
          }
          const eff2 = effectiveDatesForTask(_sideTask);
          if (parseDate(eff2.startStr)) window.__rmPendingApply.add(tid);
          saveAndSyncTaskDates();
          refreshRowReadyState();
        });
      });
    });
    // Group assignment picker — chip + searchable dropdown (same style as the modal group picker).
    const gpBox = node.querySelector('.rmt-gp-box');
    if (gpBox) {
      const chip = gpBox.querySelector('.rmt-gp-chip');
      const dd   = gpBox.querySelector('.rmt-gp-dropdown');
      const inp  = gpBox.querySelector('.rmt-gp-search');
      const list = gpBox.querySelector('.rmt-gp-list');
      const taskId = gpBox.dataset.tid;
      function _rmtRenderGroupList(q) {
        const query = (q || '').trim().toLowerCase();
        const cands = (STORE.tasks || [])
          .filter(x => x.isGroup && x.id !== taskId)
          .filter(g => !query || (g.subject || '').toLowerCase().includes(query))
          .sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
        if (cands.length === 0) {
          list.innerHTML = '<div class="group-picker-empty-state">No matches</div>';
          return;
        }
        list.innerHTML = cands.map(g => {
          const st = g.slackStatus || '';
          return '<div class="group-picker-item" data-gid="' + escapeHtml(g.id) + '">' +
            '<span class="folder-emoji" style="font-size:14px">📁</span>' +
            '<span class="gpi-name">' + escapeHtml(g.subject || '(unnamed)') + '</span>' +
            (st ? '<span class="gpi-status" data-status="' + escapeHtml(st) + '">' + escapeHtml(st) + '</span>' : '') +
            '</div>';
        }).join('');
        list.querySelectorAll('.group-picker-item').forEach(it => {
          it.addEventListener('mousedown', e => e.preventDefault());
          it.addEventListener('click', () => {
            const task = bnTaskById(taskId);
            if (!task) return;
            task.groupId = it.dataset.gid;
            task._pendingSync = true;
            saveStore(STORE);
            renderRoadmapCalendar(roadmapId);
          });
        });
      }
      chip.addEventListener('click', e => {
        // Click on the inline × clears the assignment without opening the popover
        if (e.target && e.target.classList && e.target.classList.contains('gp-clear')) {
          e.stopPropagation();
          const task = bnTaskById(taskId);
          if (!task) return;
          task.groupId = '';
          task._pendingSync = true;
          saveStore(STORE);
          renderRoadmapCalendar(roadmapId);
          return;
        }
        // Close any other open chip dropdowns first (only one open at a time)
        document.querySelectorAll('.rmt-gp-dropdown').forEach(other => { if (other !== dd) other.style.display = 'none'; });
        if (dd.style.display === 'none' || !dd.style.display) {
          dd.style.display = '';
          inp.value = '';
          _rmtRenderGroupList('');
          inp.focus();
        } else {
          dd.style.display = 'none';
        }
      });
      chip.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); }
      });
      inp.addEventListener('input', () => _rmtRenderGroupList(inp.value));
      inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') { dd.style.display = 'none'; chip.focus(); }
      });
    }
    node.querySelector('.rm-task-del').addEventListener('click', () => {
      // Defense-in-depth: even though CSS hides the X button in restricted view,
      // also guard at the click handler so a leaked click doesn't visually splice
      // the row out (the saveStore wrapper would drop the write to disk, but the
      // user explicitly asked that the row not disappear even visually).
      if (typeof bnIsRestrictedView === 'function' && bnIsRestrictedView()) {
        console.info('[BN] rm-task-del blocked — restricted view.');
        return;
      }
      const task = bnTaskById(tid);
      const name = task ? task.subject : 'this task';
      if (!confirm("Remove '" + name + "' from this roadmap?\n\nThe task itself stays in your task list.")) return;
      if (idx >= 0) {
        window.__rmPendingApply.delete(tid);
        r.tasks.splice(idx, 1);
        saveStore(STORE);
        renderRoadmapCalendar(roadmapId);
      }
    });
  });
  // Apply button → flush pending tasks to the calendar
  const applyBtn = document.getElementById('rmApplyDatesBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      window.__rmPendingApply.clear();
      renderRoadmapCalendar(roadmapId);
    });
  }
  // Archived section: expand/collapse toggle (state per roadmap, in-memory)
  const archToggle = document.getElementById('rmArchivedToggle');
  if (archToggle) {
    archToggle.addEventListener('click', () => {
      if (!window.__rmArchivedExpanded) window.__rmArchivedExpanded = {};
      window.__rmArchivedExpanded[r.id] = !window.__rmArchivedExpanded[r.id];
      const wrap = archToggle.closest('.rm-archived');
      const body = wrap && wrap.querySelector('.rm-archived-body');
      if (wrap && body) {
        wrap.classList.toggle('expanded', !!window.__rmArchivedExpanded[r.id]);
        body.style.display = window.__rmArchivedExpanded[r.id] ? '' : 'none';
      }
    });
  }
}

// Roadmap name picker — clickable title in the summary card that drops down to switch roadmap.
// Same pattern as the Profile page's name picker.
window.__rmPickerOpen = window.__rmPickerOpen || false;
window.__rmPickerSearch = window.__rmPickerSearch || "";
function wireRoadmapNamePicker(currentRoadmapId) {
  const trigger = document.getElementById("rmNameTrigger");
  if (!trigger) return;
  // Open / close on click
  trigger.addEventListener("click", e => {
    e.stopPropagation();
    window.__rmPickerOpen = !window.__rmPickerOpen;
    window.__rmPickerSearch = "";
    renderRoadmapNamePopover(currentRoadmapId);
  });
  if (window.__rmPickerOpen) {
    renderRoadmapNamePopover(currentRoadmapId);
  } else {
    closeRoadmapNamePopover();
  }
}
function closeRoadmapNamePopover() {
  const existing = document.getElementById("rmNamePopover");
  if (existing) existing.remove();
  if (window.__rmPickerOutsideHandler) {
    document.removeEventListener("click", window.__rmPickerOutsideHandler);
    window.__rmPickerOutsideHandler = null;
  }
}
function renderRoadmapNamePopover(currentRoadmapId) {
  closeRoadmapNamePopover();
  const trigger = document.getElementById("rmNameTrigger");
  const wrap = trigger ? trigger.closest('.rm-name-wrapper') : null;
  if (!trigger || !wrap) return;
  const rms = (typeof getRoadmaps === 'function') ? getRoadmaps() : (STORE.roadmaps || []);
  const sorted = rms.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const q = (window.__rmPickerSearch || "").toLowerCase().trim();
  const list = sorted.filter(r => !q || (r.name || '').toLowerCase().includes(q));
  let html = '<div class="rm-name-popover" id="rmNamePopover">';
  html += '<div class="pp-search"><input id="rmNameSearchInput" placeholder="Search roadmaps…" value="' + escapeHtml(window.__rmPickerSearch || "") + '" autocomplete="off"></div>';
  html += '<div class="pp-list">';
  if (list.length === 0) {
    html += '<div class="pp-empty">No roadmaps match.</div>';
  } else {
    list.forEach(r => {
      const cnt = (r.tasks || []).length;
      const active = (r.id === currentRoadmapId) ? ' active' : '';
      html += '<div class="pp-row' + active + '" data-rm="' + escapeHtml(r.id) + '">';
      html += '<span class="nm">' + roadmapOwnerAvatarHtml(r, 20) + '<span class="nm-text">' + escapeHtml(r.name || '(unnamed)') + '</span></span>';
      html += '<span class="cnt">' + cnt + '</span>';
      html += '</div>';
    });
  }
  html += '</div></div>';
  wrap.insertAdjacentHTML('beforeend', html);
  trigger.classList.add('open');
  // Focus search
  setTimeout(() => {
    const inp = document.getElementById("rmNameSearchInput");
    if (inp) inp.focus();
  }, 0);
  // Search input
  const inp = document.getElementById("rmNameSearchInput");
  if (inp) {
    inp.addEventListener("input", e => {
      window.__rmPickerSearch = e.target.value;
      renderRoadmapNamePopover(currentRoadmapId);
    });
    inp.addEventListener("click", e => e.stopPropagation());
    inp.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        window.__rmPickerOpen = false;
        closeRoadmapNamePopover();
        const t = document.getElementById("rmNameTrigger");
        if (t) t.classList.remove('open');
      }
    });
  }
  // Row click → switch roadmap
  document.querySelectorAll("#rmNamePopover .pp-row").forEach(row => {
    row.addEventListener("click", () => {
      const rmId = row.dataset.rm;
      window.__rmPickerOpen = false;
      window.__rmPickerSearch = "";
      selectedRoadmapTimelineId = rmId;
      localStorage.setItem("bookline-selectedRoadmap", rmId);
      roadmapCalState.yearMonth = null;
      renderRoadmapsTimelinePage();
    });
  });
  // Click outside closes
  window.__rmPickerOutsideHandler = function(e) {
    const pop = document.getElementById("rmNamePopover");
    const trig = document.getElementById("rmNameTrigger");
    if (pop && !pop.contains(e.target) && trig && !trig.contains(e.target)) {
      window.__rmPickerOpen = false;
      closeRoadmapNamePopover();
      if (trig) trig.classList.remove('open');
    }
  };
  setTimeout(() => document.addEventListener("click", window.__rmPickerOutsideHandler), 0);
}

