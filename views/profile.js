// =============================================================================
// views/profile.js
// ---------------------------------------------------------------------------
// Profile page — per-person view with header, personal 6MFN gantt, tasks
// grouped by status/roadmap, and the person picker.  Includes all renders,
// helpers, wirings and module-level state for this view.
//
// Loaded AFTER the inline app script.  All references to STORE / TEAM /
// helpers (escapeHtml, parseDate, effectiveDatesForTask, openModal, …)
// resolve through the shared classic-script scope.  The inline render()
// dispatcher guards its renderProfilePage() call with typeof so an early
// render() during boot is a no-op.
// =============================================================================

// ---- Profile page ----
let profilePersonId = localStorage.getItem("bookline-profilePersonId") || null;
let profileGroupBy = localStorage.getItem("bookline-profileGroupBy") || "status";
let profileEditMode = false;
let profilePickerOpen = false;
let profilePickerSearch = "";
let profileTasksCollapsed = (localStorage.getItem("bookline-profileTasksCollapsed") !== "0"); // collapsed by default
let profileRoadmapsCollapsed = (localStorage.getItem("bookline-profileRoadmapsCollapsed") === "1");
// Personal "6 MFN" roadmap inside the profile — horizontal Gantt across 6 rolling months.
let profilePersonalRoadmapCollapsed = (localStorage.getItem("bookline-profilePersonalRoadmapCollapsed") === "1");
let profilePersonalRoadmapOffset = 0;  // months from "current month" (0 = starting at the month we're in)
// Group expansion state inside the personal roadmap — groups start collapsed by default.
// We store the SET of expanded group IDs so "not in set" === collapsed.
const profilePersonalRoadmapExpandedGroups = new Set(
  JSON.parse(localStorage.getItem("bookline-profilePersonalRoadmapExpandedGroups") || "[]")
);
function _persistProfilePrExpandedGroups() {
  localStorage.setItem(
    "bookline-profilePersonalRoadmapExpandedGroups",
    JSON.stringify([...profilePersonalRoadmapExpandedGroups])
  );
}
const profileCollapsedGroups = new Set(JSON.parse(localStorage.getItem("bookline-profileCollapsedGroups") || "[]"));

function setProfilePerson(id) {
  // For restricted_view users, the Profile page is locked to their own profile —
  // they cannot peek at colleagues. Admins (including when previewing as someone)
  // can navigate freely.
  if (typeof bnIsRestrictedView === 'function' ? bnIsRestrictedView() : (typeof bnUserPermission !== 'undefined' && bnUserPermission === 'restricted_view')) {
    const ownId = bnFindOwnTeamId();
    if (ownId) id = ownId;
  }
  profilePersonId = id;
  profileEditMode = false; // reset edit mode when switching person
  if (id) localStorage.setItem("bookline-profilePersonId", id);
  else localStorage.removeItem("bookline-profilePersonId");
  renderProfilePage();
}
// Helper: find the TEAM id matching the "effective" user's email. Used for
// restricted_view enforcement above (can only see own profile).
//
//   • If admin is previewing AS someone (bnPreviewAsEmail set), prefer that email
//     so the profile reflects the previewed user, not the admin.
//   • Otherwise, fall back to the signed-in user's email.
function bnFindOwnTeamId() {
  try {
    const previewEmail = (typeof bnPreviewAsEmail !== 'undefined' && bnPreviewAsEmail) ? String(bnPreviewAsEmail).toLowerCase() : '';
    const sessionEmail = (typeof bnSupabaseUser !== 'undefined' && bnSupabaseUser && bnSupabaseUser.email || '').toLowerCase();
    const email = previewEmail || sessionEmail;
    if (!email) return null;
    const rosters = [];
    try { if (typeof DEFAULT_TEAM !== 'undefined') rosters.push(DEFAULT_TEAM); } catch (_) {}
    try { if (typeof EXTERNAL_TEAM !== 'undefined') rosters.push(EXTERNAL_TEAM); } catch (_) {}
    try { if (typeof SLACK_DIRECTORY !== 'undefined') rosters.push(SLACK_DIRECTORY); } catch (_) {}
    // Also include the live STORE roster — admin may have added members not in the static rosters.
    try { if (typeof STORE !== 'undefined' && Array.isArray(STORE.team)) rosters.push(STORE.team); } catch (_) {}
    for (const roster of rosters) {
      const match = roster.find(p => p && p.email && p.email.toLowerCase() === email);
      if (match) return match.id;
    }
  } catch (_) {}
  return null;
}
function setProfileGroupBy(g) {
  profileGroupBy = g;
  localStorage.setItem("bookline-profileGroupBy", g);
  renderProfilePage();
}
function toggleProfileGroup(key) {
  if (profileCollapsedGroups.has(key)) profileCollapsedGroups.delete(key);
  else profileCollapsedGroups.add(key);
  localStorage.setItem("bookline-profileCollapsedGroups", JSON.stringify([...profileCollapsedGroups]));
}

function getRoadmapsForPerson(personId) {
  // Only roadmaps the person OWNS (is responsible for).
  return getRoadmaps().filter(r => r.responsibleId === personId);
}

function renderProfilePage() {
  const cont = document.getElementById("profilePageContent");
  if (!cont) return;

  // restricted_view users are locked to their own profile (no picker, no other people).
  const isRestricted = (typeof bnIsRestrictedView === 'function') ? bnIsRestrictedView() : (typeof bnUserPermission !== 'undefined' && bnUserPermission === 'restricted_view');
  if (isRestricted) {
    const ownId = bnFindOwnTeamId();
    if (ownId) profilePersonId = ownId;
    profilePickerOpen = false;
  }

  // Validate selection still exists
  if (profilePersonId && !findPerson(profilePersonId)) profilePersonId = null;

  let html = '';

  if (!profilePersonId) {
    // Empty state — render dropdown standalone
    html += '<div class="profile-empty" style="position:relative;display:flex;flex-direction:column;align-items:center;gap:12px">' +
      '<span>Pick a person to see their profile.</span>' +
      '<div style="position:relative">' +
      buildProfilePickerTrigger(null) +
      (profilePickerOpen ? buildProfilePickerPopover() : '') +
      '</div></div>';
    cont.innerHTML = html;
    wireProfilePicker();
    return;
  }

  const person = findPerson(profilePersonId);
  if (!person) {
    html += '<div class="profile-empty">Person not found.</div>';
    cont.innerHTML = html;
    wireProfilePicker();
    return;
  }

  const settings = getPersonSettings(person.id);
  const personTags = getTagsFor(person.id);
  const tagLib = getTagLibrary();
  // For the virtual Unassigned profile, "their" tasks are those without any responsibleId.
  const personTasks = person.isUnassigned
    ? STORE.tasks.filter(t => !t.responsibleId)
    : STORE.tasks.filter(t => t.responsibleId === person.id);
  const counts = {
    total:        personTasks.length,
    proposed:     personTasks.filter(t=>t.slackStatus === "Proposed").length,
    under_review: personTasks.filter(t=>t.slackStatus === "Under Review").length,
    in_progress:  personTasks.filter(t=>t.slackStatus === "In Progress").length,
    waiting:      personTasks.filter(t=>t.slackStatus === "Waiting").length,
    later_next:   personTasks.filter(t=>t.slackStatus === "Later / Next").length,
    completed:    personTasks.filter(t=>t.slackStatus === "Completed").length,
    archived:     personTasks.filter(t=>t.slackStatus === "Archived").length,
    discarded:    personTasks.filter(t=>t.slackStatus === "Discarded").length,
  };
  const personRoadmaps = getRoadmapsForPerson(person.id);
  const ini = initials(person.name);

  // Header card
  html += '<div class="profile-header">';
  html += '<div class="av-big" style="background:' + (person.color || '#9a9a9a') + ';display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700">';
  html += person.photo ? ('<img src="' + escapeHtml(person.photo) + '" alt="" onerror="this.remove()">') : escapeHtml(ini);
  html += '</div>';
  html += '<div>';
  // Name + arrow trigger that opens person picker
  html += '<div style="position:relative;display:inline-block">';
  html += buildProfilePickerTrigger(person);
  if (profilePickerOpen) html += buildProfilePickerPopover();
  html += '</div>';
  html += '<div class="meta-line">';
  if (person.email) html += '<span>' + escapeHtml(person.email) + '</span>';
  html += '</div>';
  // Tags row
  html += '<div class="tags-row">';
  if (personTags.length) {
    personTags.forEach(t => { html += tagBadgeHtml(t, profileEditMode); });
  } else {
    html += '<span style="color:#9a9a9a;font-size:12px">No tags</span>';
  }
  if (profileEditMode) {
    html += ' <select id="profileAddTag" style="border:1px solid #d8d6d1;border-radius:6px;padding:3px 6px;font-size:11px"><option value="">+ Add tag…</option>';
    tagLib.forEach(t => { if (!personTags.includes(t.name)) html += '<option value="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + '</option>'; });
    html += '</select>';
  }
  html += '</div>';
  // Fields (read-only or editable). Hours/week and Section are admin-only metadata —
  // restricted_view users (and admins previewing as a restricted user) should not see them.
  const hoursVal = (settings.availableWeekTime != null && settings.availableWeekTime !== "") ? settings.availableWeekTime : "";
  const sec = getPersonSection(person.id);
  function sectionLabelHtml(s) {
    if (s === "team")          return '<span style="color:#16a34a;font-weight:600">Team</span>';
    if (s === "supplementary") return '<span style="color:#7c3aed;font-weight:600">Supplementary</span>';
    if (s === "disabled")      return '<span style="color:#9a9a9a">Disabled</span>';
    return '<span style="color:#0F2A4F;font-weight:600">Bookline</span>';
  }
  if (!isRestricted) {
    html += '<div class="profile-fields-grid">';
    if (profileEditMode) {
      html += '<div class="profile-field"><label>Hours / week</label><input id="profileHoursInput" type="number" step="0.5" min="0" max="80" placeholder="—" value="' + hoursVal + '"></div>';
      html += '<div class="profile-field"><label>Section</label>' +
        '<select id="profileSectionSel">' +
          '<option value=""' + (sec === "" ? ' selected' : '') + '>— Bookline (default)</option>' +
          '<option value="team"' + (sec === "team" ? ' selected' : '') + '>Team</option>' +
          '<option value="supplementary"' + (sec === "supplementary" ? ' selected' : '') + '>Supplementary</option>' +
          '<option value="disabled"' + (sec === "disabled" ? ' selected' : '') + '>Disabled</option>' +
        '</select></div>';
    } else {
      html += '<div class="profile-field"><label>Hours / week</label><div style="font-size:13px;color:#1a1a1a;padding:0">' + (hoursVal !== "" ? escapeHtml(String(hoursVal)) + 'h' : '<span style="color:#9a9a9a">—</span>') + '</div></div>';
      html += '<div class="profile-field"><label>Section</label><div style="font-size:13px;padding:0">' + sectionLabelHtml(sec) + '</div></div>';
    }
    html += '</div>';
  }
  html += '</div>';
  // Actions (Edit / Done button) — hidden for restricted_view (they can't edit anything).
  html += '<div class="actions">';
  if (!isRestricted) {
    if (profileEditMode) {
      html += '<button class="btn primary" id="profileEditToggleBtn">Done</button>';
    } else {
      html += '<button class="btn" id="profileEditToggleBtn">Edit</button>';
    }
  }
  html += '</div>';
  html += '</div>';

  // Admin-only permissions panel for this profile (populated async after render).
  if (typeof bnUserPermission !== 'undefined' && bnUserPermission === 'admin') {
    const personEmail = (person.email || '').trim().toLowerCase();
    html += '<div id="bnProfilePermsPanel" data-person-email="' + escapeHtml(personEmail) + '" style="margin: 12px 0 20px; padding: 14px 16px; border: 1px solid #ececec; border-radius: 10px; background: #fafafa;">' +
      '<div style="font-weight: 600; font-size: 13px; margin-bottom: 8px;">⭐ Permissions (admin)</div>' +
      '<div style="font-size: 12.5px; color: #6b6b6b;">Loading…</div>' +
    '</div>';
  }

  // Stats — current statuses, ordered by STATUS_ORDER and colored from the status palette
  const STATUS_PALETTE = {
    "Waiting": "#60a5fa", "Proposed": "#1d4ed8", "Later / Next": "#dc2626",
    "In Progress": "#f97316", "Under Review": "#7c3aed", "Completed": "#16a34a",
    "Archived": "#a98c5a", "Discarded": "#9a9a9a"
  };
  // Ordered list (key = STATUS_ORDER); reads from counts above.
  const STATUS_CARDS = [
    { key: "Waiting",      label: "Waiting",      num: counts.waiting },
    { key: "Proposed",     label: "Proposed",     num: counts.proposed },
    { key: "Later / Next", label: "Later / Next", num: counts.later_next },
    { key: "In Progress",  label: "In Progress",  num: counts.in_progress },
    { key: "Under Review", label: "Under Review", num: counts.under_review },
    { key: "Completed",    label: "Completed",    num: counts.completed },
    { key: "Archived",     label: "Archived",     num: counts.archived },
    { key: "Discarded",    label: "Discarded",    num: counts.discarded },
  ];
  html += '<div class="profile-stats">';
  // Summary cards (dark) — total tasks + total roadmaps
  html += '<div class="profile-stat-card summary-card"><div class="num">' + counts.total + '</div><div class="lbl">Tasks</div><div class="sub">all time</div></div>';
  html += '<div class="profile-stat-card summary-card"><div class="num">' + personRoadmaps.length + '</div><div class="lbl">Roadmaps</div></div>';
  // Status cards in canonical STATUS_ORDER, colored by status palette
  STATUS_CARDS.forEach(s => {
    const color = STATUS_PALETTE[s.key] || '#cbd5e1';
    html += '<div class="profile-stat-card status-card" style="--status-color:' + color + '">' +
      '<div class="num">' + s.num + '</div>' +
      '<div class="lbl"><span class="lbl-dot"></span>' + escapeHtml(s.label) + '</div>' +
    '</div>';
  });
  html += '</div>';

  // Personal roadmap (6 MFN-style horizontal Gantt of this person's tasks, collapsible).
  // Counts only tasks that fall within the visible 6-month window.
  const _prCounts = renderProfilePersonalRoadmapCount(personTasks);
  html += '<div class="profile-section-title profile-section-toggle" id="profilePersonalRoadmapToggle">' +
    '<span><span class="caret">' + (profilePersonalRoadmapCollapsed ? '▸' : '▾') + '</span> Personal roadmap <span style="font-weight:500;color:#9a9a9a;font-size:11px;margin-left:6px">(6 months)</span></span>' +
    '<span class="count">' + _prCounts.visible + '</span>' +
    '</div>';
  if (!profilePersonalRoadmapCollapsed) {
    html += renderProfilePersonalRoadmap(personTasks);
  }

  // Roadmaps section (collapsible)
  html += '<div class="profile-section-title profile-section-toggle" id="profileRoadmapsToggle">' +
    '<span><span class="caret">' + (profileRoadmapsCollapsed ? '▸' : '▾') + '</span> Roadmaps</span>' +
    '<span class="count">' + personRoadmaps.length + '</span>' +
    '</div>';
  if (!profileRoadmapsCollapsed) {
    if (personRoadmaps.length === 0) {
      html += '<div class="profile-empty" style="padding:20px;background:#fff;border:1px dashed #ececea;border-radius:12px">Not in any roadmap yet.</div>';
    } else {
      html += '<div class="profile-rm-list">';
      personRoadmaps.forEach(rm => {
        html += renderProfileRoadmapCard(rm, person.id);
      });
      html += '</div>';
    }
  }

  // Tasks section (collapsible) — tasks where this person is the RESPONSIBLE.
  html += '<div class="profile-section-title profile-section-toggle" id="profileTasksToggle">' +
    '<span><span class="caret">' + (profileTasksCollapsed ? '▸' : '▾') + '</span> Tasks</span>' +
    '<span class="count">' + counts.total + '</span>' +
    '</div>';
  if (!profileTasksCollapsed) {
    html += '<div class="profile-tasks-toolbar">';
    html += '<label>Group by</label>';
    html += '<select id="profileGroupBySel">';
    ['none','status','priority','type','roadmap','tag','dueMonth'].forEach(opt => {
      const lblMap = {none:'None',status:'Status',priority:'Priority',type:'Type',roadmap:'Roadmap',tag:'Tag',dueMonth:'Due month'};
      html += '<option value="' + opt + '"' + (profileGroupBy === opt ? ' selected' : '') + '>' + lblMap[opt] + '</option>';
    });
    html += '</select>';
    html += '</div>';
    html += renderProfileTasks(personTasks, profileGroupBy);
  }

  // Proposed-by section: tasks where this person is in the proposedByIds list (or
  // proposedById fallback), excluding ones where they are also the responsible (those
  // already appear in the Tasks section above).
  if (!person.isUnassigned) {
    const proposedTasks = STORE.tasks.filter(t => {
      const isProposer = Array.isArray(t.proposedByIds)
        ? t.proposedByIds.includes(person.id)
        : (t.proposedById === person.id);
      return isProposer && t.responsibleId !== person.id;
    });
    if (proposedTasks.length > 0) {
      const proposedCollapsedKey = "bookline-profileProposedCollapsed";
      const proposedCollapsed = localStorage.getItem(proposedCollapsedKey) !== "0";
      html += '<div class="profile-section-title profile-section-toggle" id="profileProposedToggle" data-collapsed-key="' + proposedCollapsedKey + '">' +
        '<span><span class="caret">' + (proposedCollapsed ? '▸' : '▾') + '</span> Proposed by ' + escapeHtml(person.displayName || person.name || '?') + '</span>' +
        '<span class="count">' + proposedTasks.length + '</span>' +
      '</div>';
      if (!proposedCollapsed) {
        html += renderProfileTasks(proposedTasks, profileGroupBy);
      }
    }
  }

  cont.innerHTML = html;
  wireProfilePicker();
  wireProfileHeader(person);
  wireProfileTasks();
  wireProfilePersonalRoadmap(personTasks);
  // Populate the admin-only permissions panel for this profile (async).
  if (typeof bnPopulateProfilePermsPanel === 'function') {
    bnPopulateProfilePermsPanel().catch(e => console.warn('[BN] perms panel error:', e && e.message));
  }
}

// ===== Personal roadmap (6-month horizontal Gantt of the profile person's tasks) =====
// Returns the set of events visible in the current 6-month window.
function _profilePersonalRoadmapBuildEvents(personTasks) {
  const baseDate = new Date(); baseDate.setHours(0,0,0,0);
  const firstOfMonth = new Date(baseDate.getFullYear(), baseDate.getMonth() + profilePersonalRoadmapOffset, 1);
  const lastOfMonth  = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 6, 0);
  const yearStartMs = firstOfMonth.getTime();
  const yearEndMs   = lastOfMonth.getTime();
  const events = [];
  (personTasks || []).forEach(t => {
    let sStr = t.startDate || '';
    let eStr = t.endDate   || '';
    if ((!sStr || !eStr) && typeof effectiveDatesForTask === 'function') {
      try {
        const eff = effectiveDatesForTask(t);
        if (!sStr && eff.startStr) sStr = eff.startStr;
        if (!eStr && eff.endStr)   eStr = eff.endStr;
      } catch (_) {}
    }
    let sD = sStr ? parseDate(sStr) : null;
    let eD = eStr ? parseDate(eStr) : null;
    if (!sD && !eD) return;
    if (!sD) sD = eD;
    if (!eD) eD = sD;
    if (eD < sD) return;
    if (eD.getTime() < yearStartMs || sD.getTime() > yearEndMs) return;
    events.push({ task: t, start: sD, end: eD });
  });
  events.sort((a, b) => a.start - b.start || (a.task.subject || '').localeCompare(b.task.subject || ''));
  return { events, firstOfMonth, lastOfMonth, yearStartMs, yearEndMs };
}

function renderProfilePersonalRoadmapCount(personTasks) {
  const { events } = _profilePersonalRoadmapBuildEvents(personTasks);
  return { visible: events.length };
}

function renderProfilePersonalRoadmap(personTasks) {
  const { events, firstOfMonth, yearStartMs, yearEndMs } = _profilePersonalRoadmapBuildEvents(personTasks);
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
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const statusColors = {
    "": "#cbd5e1",
    "Waiting": "#38bdf8", "Proposed": "#1d4ed8", "Later / Next": "#dc2626",
    "In Progress": "#f97316", "Under Review": "#7c3aed", "Completed": "#16a34a",
    "Archived": "#a98c5a", "Discarded": "#9a9a9a"
  };
  function _toRgba(hex, a) {
    const h = (hex && hex.length === 4) ? ('#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3]) : hex;
    if (!h || h[0] !== '#') return 'rgba(217,119,6,' + a + ')';
    const r2 = parseInt(h.slice(1,3),16), g2 = parseInt(h.slice(3,5),16), b2 = parseInt(h.slice(5,7),16);
    return 'rgba(' + r2 + ',' + g2 + ',' + b2 + ',' + a + ')';
  }
  // Group → children index for nesting. Standalone tasks (or tasks whose group isn't in the window)
  // get rendered as top-level rows; group rows render their children only when expanded.
  const evByTaskId = {};
  events.forEach(e => { evByTaskId[e.task.id] = e; });
  const childrenByParent = {};
  events.forEach(e => {
    if (e.task.groupId && evByTaskId[e.task.groupId]) {
      (childrenByParent[e.task.groupId] = childrenByParent[e.task.groupId] || []).push(e);
    }
  });
  // Build the visible group ID set for the Expand-all/Collapse-all toggle.
  const visibleGroupIds = events.filter(e => e.task.isGroup).map(e => e.task.id);
  const anyExpanded = visibleGroupIds.some(gid => profilePersonalRoadmapExpandedGroups.has(gid));
  const expandAllLabel = anyExpanded ? '⊟ Collapse all' : '⊞ Expand all';
  const expandAllTitle = anyExpanded ? 'Collapse every group' : 'Expand every group';
  // Order rows: top-level events by start; under each group, its children when expanded.
  const orderedRows = [];
  const seen = new Set();
  events
    .filter(e => !e.task.groupId || !evByTaskId[e.task.groupId])
    .sort((a, b) => (a.start - b.start) || (a.task.subject || '').localeCompare(b.task.subject || ''))
    .forEach(e => {
      if (seen.has(e.task.id)) return;
      orderedRows.push({ ev: e, depth: 0 });
      seen.add(e.task.id);
      if (e.task.isGroup && profilePersonalRoadmapExpandedGroups.has(e.task.id)) {
        const kids = (childrenByParent[e.task.id] || []).slice()
          .sort((x, y) => (x.start - y.start) || (x.task.subject || '').localeCompare(y.task.subject || ''));
        kids.forEach(c => {
          if (!seen.has(c.task.id)) { orderedRows.push({ ev: c, depth: 1 }); seen.add(c.task.id); }
        });
      }
    });
  // Header label + nav controls (Expand-all sits next to the period label).
  const periodLabel = monthNames[firstOfMonth.getMonth()] + ' ' + firstOfMonth.getFullYear()
    + ' — ' + monthNames[monthStarts[monthCount-1].getMonth()] + ' ' + monthStarts[monthCount-1].getFullYear();
  let html = '<div class="profile-pr-wrap">';
  html += '<div class="profile-pr-toolbar">' +
    '<div class="profile-pr-nav">' +
      '<button type="button" class="profile-pr-btn" id="profilePrPrev" title="Previous month">‹</button>' +
      '<button type="button" class="profile-pr-btn profile-pr-today-btn" id="profilePrToday" title="Reset to current month">Today</button>' +
      '<button type="button" class="profile-pr-btn" id="profilePrNext" title="Next month">›</button>' +
    '</div>' +
    '<div class="profile-pr-period">' + escapeHtml(periodLabel) + '</div>' +
    (visibleGroupIds.length > 0
      ? '<button type="button" class="profile-pr-expand-btn" id="profilePrExpandAll" title="' + expandAllTitle + '">' + expandAllLabel + '</button>'
      : '') +
    '</div>';
  // Today line position (only visible if today falls inside the range)
  const today = new Date(); today.setHours(0,0,0,0);
  let todayLineHtml = '';
  if (today.getTime() >= yearStartMs && today.getTime() <= yearEndMs) {
    const off = Math.round((today.getTime() - yearStartMs) / DAY_MS);
    const leftPct = (off / daysInYear) * 100;
    todayLineHtml = '<div class="cal-year-today-line" style="left:calc(' + leftPct + '% )"></div>';
  }
  html += '<div class="cal-year profile-pr-gantt">';
  html += '<div class="cal-year-headers">' +
            '<div class="cal-year-label-spacer"></div>' +
            '<div class="cal-year-months" style="grid-template-columns: ' + monthsGridTemplate + '">';
  for (let mi = 0; mi < monthCount; mi++) {
    const ms = monthStarts[mi];
    const lbl = monthNames[ms.getMonth()] + ' ' + String(ms.getFullYear()).slice(2);
    html += '<div class="cal-year-month-cell">' + lbl + '</div>';
  }
  html += '</div></div>';
  html += '<div class="cal-year-rows-wrap">';
  html += '<div class="cal-year-track-bg"><div class="cal-year-months-bg" style="grid-template-columns: ' + monthsGridTemplate + '">';
  for (let mi = 0; mi < monthCount; mi++) {
    html += '<div class="cal-year-month-bg' + (mi % 2 ? ' alt' : '') + '"></div>';
  }
  html += todayLineHtml + '</div></div>';
  html += '<div class="cal-year-rows">';
  if (orderedRows.length === 0) {
    html += '<div class="rm-empty" style="margin:14px">No scheduled tasks in this range.</div>';
  } else {
    orderedRows.forEach(row => {
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
      const barStyle = isG
        ? 'background:' + _toRgba(stHex, 0.18) + '; border:1.5px dashed ' + stHex + '; color:' + stHex + ';'
        : 'background:' + stHex + '; color:#fff;';
      const continuesLeft  = ev.start.getTime() < yearStartMs;
      const continuesRight = ev.end.getTime()   > yearEndMs;
      const subj = ev.task.subject || '';
      const tooltip = subj + ' — ' + (ev.task.startDate || '?') + ' → ' + (ev.task.endDate || '?');
      const gExpanded = isG ? profilePersonalRoadmapExpandedGroups.has(ev.task.id) : false;
      const labelChev = isG
        ? '<button type="button" class="cal-group-toggle-y profile-pr-group-toggle' + (gExpanded ? ' expanded' : '') + '" data-gid="' + escapeHtml(ev.task.id) + '" title="' + (gExpanded ? 'Collapse group' : 'Expand group') + '">▶</button>'
        : '';
      html += '<div class="cal-year-row' + (row.depth ? ' is-child' : '') + (isG ? ' is-group' : '') + '" data-tid="' + escapeHtml(ev.task.id) + '">' +
        '<div class="cal-year-label" title="' + escapeHtml(subj) + '" style="padding-left:' + (8 + row.depth * 14) + 'px">' +
          labelChev +
          (row.depth ? '· ' : (isG ? '<span class="folder-emoji">📁</span> ' : '')) +
          '<button type="button" class="cal-year-label-text profile-pr-label-btn" data-tid="' + escapeHtml(ev.task.id) + '" title="' + escapeHtml(subj) + ' — click to edit">' + escapeHtml(subj) + '</button>' +
        '</div>' +
        '<div class="cal-year-track">' +
          '<div class="cal-event cal-year-bar profile-pr-bar' + (isG ? ' cal-event-group' : '') + '" data-tid="' + escapeHtml(ev.task.id) + '" title="' + escapeHtml(tooltip) + '" style="left:' + leftPct + '%; width:' + widthPct + '%; ' + barStyle + '">' +
            '<span class="profile-pr-bar-text">' + (continuesLeft ? '◂ ' : '') + escapeHtml(subj) + (continuesRight ? ' ▸' : '') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
  }
  html += '</div></div></div>';   // rows / wrap / cal-year
  html += '</div>';   // profile-pr-wrap
  return html;
}

function wireProfilePersonalRoadmap(personTasks) {
  const head = document.getElementById('profilePersonalRoadmapToggle');
  if (head) head.addEventListener('click', () => {
    profilePersonalRoadmapCollapsed = !profilePersonalRoadmapCollapsed;
    localStorage.setItem('bookline-profilePersonalRoadmapCollapsed', profilePersonalRoadmapCollapsed ? '1' : '0');
    renderProfilePage();
  });
  const prev  = document.getElementById('profilePrPrev');
  const next  = document.getElementById('profilePrNext');
  const today = document.getElementById('profilePrToday');
  if (prev)  prev.addEventListener('click', () => { profilePersonalRoadmapOffset -= 1; renderProfilePage(); });
  if (next)  next.addEventListener('click', () => { profilePersonalRoadmapOffset += 1; renderProfilePage(); });
  if (today) today.addEventListener('click', () => { profilePersonalRoadmapOffset = 0; renderProfilePage(); });
  // Expand all / Collapse all toggle (only present when the visible range has groups)
  const expandAllBtn = document.getElementById('profilePrExpandAll');
  if (expandAllBtn) expandAllBtn.addEventListener('click', () => {
    const { events } = _profilePersonalRoadmapBuildEvents(personTasks);
    const visibleGroupIds = events.filter(e => e.task.isGroup).map(e => e.task.id);
    const anyExpanded = visibleGroupIds.some(gid => profilePersonalRoadmapExpandedGroups.has(gid));
    if (anyExpanded) visibleGroupIds.forEach(gid => profilePersonalRoadmapExpandedGroups.delete(gid));
    else             visibleGroupIds.forEach(gid => profilePersonalRoadmapExpandedGroups.add(gid));
    _persistProfilePrExpandedGroups();
    renderProfilePage();
  });
  // Per-group chevron toggle (label column on each group row)
  document.querySelectorAll('#profilePageContent .profile-pr-group-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();   // don't double-trigger via the bar click
      const gid = btn.dataset.gid;
      if (!gid) return;
      if (profilePersonalRoadmapExpandedGroups.has(gid)) profilePersonalRoadmapExpandedGroups.delete(gid);
      else profilePersonalRoadmapExpandedGroups.add(gid);
      _persistProfilePrExpandedGroups();
      renderProfilePage();
    });
  });
  // Click on a bar OR on the label name → open the task modal
  document.querySelectorAll('#profilePageContent .profile-pr-bar, #profilePageContent .profile-pr-label-btn').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const tid = el.dataset.tid;
      if (tid && typeof openModal === 'function') openModal(tid);
    });
  });
}

function buildProfilePickerTrigger(person) {
  // restricted_view users can't switch people — render the name without the trigger.
  const isRestricted = (typeof bnIsRestrictedView === 'function') ? bnIsRestrictedView() : (typeof bnUserPermission !== 'undefined' && bnUserPermission === 'restricted_view');
  if (person) {
    if (isRestricted) {
      return '<h3 style="margin:0">' + escapeHtml(person.name || person.displayName || '?') + '</h3>';
    }
    return '<div class="profile-name-trigger' + (profilePickerOpen ? ' open' : '') + '" id="profilePickerTrigger">' +
      '<h3 style="margin:0">' + escapeHtml(person.name || person.displayName || '?') + '</h3>' +
      '<span class="arrow">▾</span>' +
      '</div>';
  }
  return '<button class="btn primary" id="profilePickerTrigger">Choose person ▾</button>';
}

function buildProfilePickerPopover() {
  const q = (profilePickerSearch || "").toLowerCase().trim();
  // Include both Team and Bookline (external) people in the picker
  const pool = (typeof allPeopleForPicker === 'function') ? allPeopleForPicker() : TEAM;
  const list = pool.filter(p => {
    if (!q) return true;
    return (p.name||"").toLowerCase().includes(q) || (p.displayName||"").toLowerCase().includes(q) || (p.email||"").toLowerCase().includes(q);
  });
  let html = '<div class="profile-picker-popover" id="profilePickerPopover">';
  html += '<div class="pp-search"><input id="profilePickerSearchInput" placeholder="Search people..." value="' + escapeHtml(profilePickerSearch || "") + '" autocomplete="off"></div>';
  html += '<div class="pp-list">';
  if (list.length === 0) {
    html += '<div class="pp-empty">No people match.</div>';
  } else {
    list.forEach(p => {
      const ini = initials(p.name);
      const active = (p.id === profilePersonId) ? ' active' : '';
      html += '<div class="pp-row' + active + '" data-pid="' + p.id + '">';
      html += '<span class="av" style="background:' + (p.color || '#9a9a9a') + '">';
      html += p.photo ? ('<img src="' + escapeHtml(p.photo) + '" alt="" onerror="this.remove()">') : escapeHtml(ini);
      html += '</span>';
      html += '<span class="nm">' + escapeHtml(p.displayName || p.name) + '</span>';
      html += '</div>';
    });
  }
  html += '</div></div>';
  return html;
}

function wireProfilePicker() {
  const trigger = document.getElementById("profilePickerTrigger");
  if (trigger) {
    trigger.addEventListener("click", e => {
      e.stopPropagation();
      profilePickerOpen = !profilePickerOpen;
      profilePickerSearch = "";
      renderProfilePage();
      // Auto-focus the search input when opening
      if (profilePickerOpen) {
        setTimeout(() => {
          const inp = document.getElementById("profilePickerSearchInput");
          if (inp) inp.focus();
        }, 0);
      }
    });
  }

  const searchInp = document.getElementById("profilePickerSearchInput");
  if (searchInp) {
    searchInp.addEventListener("input", e => {
      profilePickerSearch = e.target.value;
      // Re-render only the popover list to preserve focus
      const popover = document.getElementById("profilePickerPopover");
      if (popover) {
        const oldList = popover.querySelector(".pp-list");
        const q = (profilePickerSearch || "").toLowerCase().trim();
        const list = TEAM.filter(p => {
          if (!q) return true;
          return (p.name||"").toLowerCase().includes(q) || (p.displayName||"").toLowerCase().includes(q) || (p.email||"").toLowerCase().includes(q);
        });
        let listHtml = '';
        if (list.length === 0) {
          listHtml += '<div class="pp-empty">No people match.</div>';
        } else {
          list.forEach(p => {
            const ini = initials(p.name);
            const active = (p.id === profilePersonId) ? ' active' : '';
            listHtml += '<div class="pp-row' + active + '" data-pid="' + p.id + '">';
            listHtml += '<span class="av" style="background:' + (p.color || '#9a9a9a') + '">';
            listHtml += p.photo ? ('<img src="' + escapeHtml(p.photo) + '" alt="" onerror="this.remove()">') : escapeHtml(ini);
            listHtml += '</span>';
            listHtml += '<span class="nm">' + escapeHtml(p.displayName || p.name) + '</span>';
            listHtml += '</div>';
          });
        }
        oldList.innerHTML = listHtml;
        // Re-wire row clicks
        oldList.querySelectorAll(".pp-row").forEach(row => {
          row.addEventListener("click", () => {
            profilePickerOpen = false;
            setProfilePerson(row.dataset.pid);
          });
        });
      }
    });
    searchInp.addEventListener("click", e => e.stopPropagation());
    searchInp.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        profilePickerOpen = false;
        renderProfilePage();
      }
    });
  }

  document.querySelectorAll(".profile-picker-popover .pp-row").forEach(row => {
    row.addEventListener("click", () => {
      profilePickerOpen = false;
      setProfilePerson(row.dataset.pid);
    });
  });

  // Click outside closes
  if (profilePickerOpen && !window.__profilePickerOutsideHandler) {
    window.__profilePickerOutsideHandler = function(e) {
      const pop = document.getElementById("profilePickerPopover");
      const trig = document.getElementById("profilePickerTrigger");
      if (pop && !pop.contains(e.target) && trig && !trig.contains(e.target)) {
        profilePickerOpen = false;
        document.removeEventListener("click", window.__profilePickerOutsideHandler);
        delete window.__profilePickerOutsideHandler;
        renderProfilePage();
      }
    };
    setTimeout(() => document.addEventListener("click", window.__profilePickerOutsideHandler), 0);
  } else if (!profilePickerOpen && window.__profilePickerOutsideHandler) {
    document.removeEventListener("click", window.__profilePickerOutsideHandler);
    delete window.__profilePickerOutsideHandler;
  }
}

function wireProfileHeader(person) {
  // Tags are clickable to remove ONLY in edit mode (tagBadgeHtml builds them with the X)
  if (profileEditMode) {
    const tags = document.querySelectorAll('#profilePageContent .profile-header .tag');
    tags.forEach(node => {
      node.addEventListener("click", () => {
        const t = node.dataset.tag;
        setTagsFor(person.id, getTagsFor(person.id).filter(x => x !== t));
        renderProfilePage();
      });
    });
    const addSel = document.getElementById("profileAddTag");
    if (addSel) {
      addSel.addEventListener("change", e => {
        const v = e.target.value;
        if (!v) return;
        const cur = getTagsFor(person.id);
        if (!cur.includes(v)) setTagsFor(person.id, [...cur, v]);
        renderProfilePage();
      });
    }
    const hoursInput = document.getElementById("profileHoursInput");
    if (hoursInput) {
      hoursInput.addEventListener("change", e => {
        const v = e.target.value === "" ? null : parseFloat(e.target.value);
        setPersonSettings(person.id, { availableWeekTime: (isNaN(v) ? null : v) });
      });
    }
    const sectionSel = document.getElementById("profileSectionSel");
    if (sectionSel) {
      sectionSel.addEventListener("change", e => {
        setPersonSection(person.id, e.target.value);
        renderProfilePage();
      });
    }
  }
  const editBtn = document.getElementById("profileEditToggleBtn");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      profileEditMode = !profileEditMode;
      renderProfilePage();
    });
  }
}

function renderProfileRoadmapCard(rm, personId) {
  const personTaskEntries = (rm.tasks || []).filter(entry => {
    const t = bnTaskById(entry.taskId);
    return t && t.responsibleId === personId;
  });
  const today = new Date(); today.setHours(0,0,0,0);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(today, i));

  const statusColors = {
    "": "#cbd5e1",
    "Waiting": "#60a5fa", "Proposed": "#1d4ed8", "Later / Next": "#dc2626",
    "In Progress": "#f97316", "Under Review": "#7c3aed", "Completed": "#16a34a",
    "Archived": "#a98c5a", "Discarded": "#9a9a9a"
  };
  const wdLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  // Find groups owned by this person within this roadmap; expansion toggles add their kids' events.
  if (!window.__profileGroupExp) window.__profileGroupExp = {};
  const personGroupsInRm = personTaskEntries
    .map(en => bnTaskById(en.taskId))
    .filter(t => t && t.isGroup);
  // For each expanded group, collect entries of its CHILDREN in this roadmap (any responsible).
  const expandedKidEntries = [];
  personGroupsInRm.forEach(g => {
    const key = rm.id + '|' + g.id;
    if (!window.__profileGroupExp[key]) return;
    (rm.tasks || []).forEach(en => {
      const ct = bnTaskById(en.taskId);
      if (ct && !ct.isGroup && ct.groupId === g.id) {
        expandedKidEntries.push({ entry: en, task: ct, viaExpandedGroup: true });
      }
    });
  });

  let html = '<div class="profile-rm-card">';
  html += '<div class="rm-head">';
  html += '<div class="lhs">';
  html += '<span class="rm-name" data-rm="' + rm.id + '">' + escapeHtml(rm.name || '(unnamed)') + '</span>';
  html += '</div>';
  html += '<span class="rm-meta">' + personTaskEntries.length + ' task' + (personTaskEntries.length===1?'':'s') + '</span>';
  html += '</div>';
  // Mini 7-day calendar — wrapper holds day cells + absolute overlay so multi-day bars span continuously
  html += '<div class="mini-7day-wrap">';
  html += '<div class="mini-7day">';
  // Track non-working columns so we can render a stripes overlay ABOVE the task bars
  // (visible even when a bar crosses a weekend/holiday/time-off cell).
  const noWorkingCols = [];
  days.forEach((d, idx) => {
    const wd = d.getDay();
    const wdMon = (wd + 6) % 7;
    const isWeekend = (wdMon >= 5);
    const isToday = (d.getTime() === today.getTime());
    const worked = isWorkedOverride(d);
    const timeOff = isTimeOff(d);
    const hol = holidayName(d);
    const cls = ['mini-day'];
    if (isWeekend && !worked) cls.push('weekend');
    if (hol && !worked) cls.push('holiday');
    if (timeOff) cls.push('timeoff');
    if (isToday) cls.push('today');
    html += '<div class="' + cls.join(' ') + '">';
    html += '<div class="mini-dwd">' + wdLabels[wdMon] + '</div>';
    html += '<div class="mini-dnum">' + d.getDate() + '</div>';
    if (hol && !worked) {
      html += '<div class="mini-hol" title="' + escapeHtml(hol) + '">' + escapeHtml(hol) + '</div>';
    }
    html += '</div>';   // .mini-day
    if (timeOff)                     noWorkingCols.push({ idx, type: 'time-off' });
    else if ((isWeekend && !worked) || (hol && !worked)) noWorkingCols.push({ idx, type: 'weekend' });
  });
  html += '</div>';   // .mini-7day (grid of day cells)
  // ----- Continuous events overlay: spans days as single bars, no gap breaks -----
  // Build the list of (entry, task, isKid) tuples that should be drawn this week.
  // Hide tasks whose parent group is also in personTaskEntries AND that parent is COLLAPSED.
  // (When the parent is expanded, the kid is added via expandedKidEntries below — not here —
  //  so we never get duplicates.)
  const personGroupIdsInRm = new Set(personGroupsInRm.map(g => g.id));
  const overlayEvents = [];
  personTaskEntries.forEach(entry => {
    const t = bnTaskById(entry.taskId);
    if (!t) return;
    // If this task is a kid of a group also in personTaskEntries, only show it
    // when that group is expanded (we'll render it via expandedKidEntries instead).
    if (t.groupId && personGroupIdsInRm.has(t.groupId)) {
      // Skip — group will either be collapsed (hide kid) or expanded (kid added below as isKid).
      return;
    }
    overlayEvents.push({ entry, task: t, isKid: false });
  });
  expandedKidEntries.forEach(({ entry, task }) => overlayEvents.push({ entry, task, isKid: true }));
  // Compute each event's startIdx (0..6) and span (1..7) within the visible 7-day window.
  // Use effectiveDatesForInRoadmap to follow anchors (kids might only have anchored dates).
  const weekStartDay = days[0];
  const weekEndDay   = days[6];
  const positioned = [];
  overlayEvents.forEach(({ entry, task, isKid }) => {
    const dates = (typeof effectiveDatesForInRoadmap === 'function')
      ? effectiveDatesForInRoadmap(entry, rm)
      : { startStr: entry.startDate || '', endStr: entry.endDate || '' };
    const start = parseDate(dates.startStr);
    const end   = parseDate(dates.endStr) || (start ? new Date(2099,11,31) : null);
    if (!start) return;
    if (end < weekStartDay || start > weekEndDay) return;
    const clipStart = start < weekStartDay ? weekStartDay : start;
    const clipEnd   = end   > weekEndDay   ? weekEndDay   : end;
    const startIdx = Math.round((clipStart - weekStartDay) / DAY_MS);
    const span = Math.round((clipEnd - clipStart) / DAY_MS) + 1;
    if (span < 1) return;
    positioned.push({ entry, task, isKid, startIdx, span });
  });
  // Lane assignment — stack overlapping bars vertically.
  positioned.sort((a, b) => (a.startIdx - b.startIdx) || (b.span - a.span));
  const lanes = [];
  positioned.forEach(p => {
    let lane = 0;
    while (lanes[lane] && lanes[lane].some(o => p.startIdx < o.startIdx + o.span && o.startIdx < p.startIdx + p.span)) lane++;
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push(p);
    p.lane = lane;
  });
  const LANE_H = 20;
  const overlayHeight = lanes.length * LANE_H;
  // Make day cells tall enough to fit every event lane (header strip ~38px + overlay + 8px padding)
  const dayCellMinHeight = Math.max(70, 38 + overlayHeight + 10);
  // Inject style on every .mini-day inside this card via a CSS variable on the wrap
  html = html.replace(/<div class="mini-7day"/, '<div class="mini-7day" style="--day-min-h:' + dayCellMinHeight + 'px"');
  html += '<div class="mini-7day-events-overlay" style="height:' + overlayHeight + 'px">';
  positioned.forEach(p => {
    const { entry, task, isKid, startIdx, span, lane } = p;
    const color = statusColors[task.slackStatus] || '#94a3b8';
    const isG = !!task.isGroup;
    const cls = 'mini-event-bar' + (isG ? ' is-group' : '') + (isKid ? ' is-kid' : '');
    const leftPct  = (startIdx / 7) * 100;
    const widthPct = (span     / 7) * 100;
    const labelText = (isKid ? '· ' : '') + task.subject;
    const expandedKey = rm.id + '|' + task.id;
    const expanded = !!(window.__profileGroupExp && window.__profileGroupExp[expandedKey]);
    const chev = isG
      ? '<button type="button" class="mini-event-caret' + (expanded ? ' expanded' : '') + '" data-rmid="' + escapeHtml(rm.id) + '" data-gid="' + escapeHtml(task.id) + '" title="' + (expanded ? 'Collapse subtasks' : 'Expand subtasks') + '">▶</button>'
      : '';
    const top = lane * LANE_H;
    html += '<div class="' + cls + '" style="background:' + color + '; left:calc(' + leftPct + '% + 2px); width:calc(' + widthPct + '% - 4px); top:' + top + 'px" title="' + escapeHtml(labelText) + '" data-tid="' + task.id + '">' + chev + escapeHtml(labelText) + '</div>';
  });
  html += '</div>';   // .mini-7day-events-overlay
  // Stripes overlay — sits on top of the events overlay so weekends/holidays/time-off
  // patterns remain visible when task bars cross those day cells.
  if (noWorkingCols.length > 0) {
    html += '<div class="mini-7day-noworking-overlay">';
    noWorkingCols.forEach(({ idx, type }) => {
      const leftPct  = (idx / 7) * 100;
      const widthPct = (1   / 7) * 100;
      const cls = 'mini-noworking-stripe' + (type === 'time-off' ? ' time-off' : '');
      html += '<div class="' + cls + '" style="left:calc(' + leftPct + '% + 1px); width:calc(' + widthPct + '% - 2px)"></div>';
    });
    html += '</div>';
  }
  html += '</div>';   // .mini-7day-wrap
  html += '</div>';   // .profile-rm-card
  return html;
}

function renderProfileTasks(tasks, groupBy) {
  if (tasks.length === 0) {
    return '<div class="profile-empty" style="padding:20px;background:#fff;border:1px dashed #ececea;border-radius:12px">No tasks for this person.</div>';
  }
  // Build groups
  const groups = new Map(); // key -> {label, tasks, sortKey}
  const ungrouped = [];
  const STATUS_LABELS = {
    "Proposed":"Proposed","Under Review":"Under Review","In Progress":"In Progress",
    "Waiting":"Waiting","Later / Next":"Later / Next","Completed":"Completed",
    "Archived":"Archived","Discarded":"Discarded"
  };

  function pushGroup(key, label, t, sortKey) {
    if (!groups.has(key)) groups.set(key, { label, tasks: [], sortKey });
    groups.get(key).tasks.push(t);
  }

  if (groupBy === 'none') {
    pushGroup('all', 'All tasks', null, 0);
    tasks.forEach(t => groups.get('all').tasks.push(t));
  } else {
    tasks.forEach(t => {
      if (groupBy === 'status') {
        const k = t.slackStatus || 'Proposed';
        pushGroup(k, STATUS_LABELS[k] || k, t, STATUS_ORDER[k] != null ? STATUS_ORDER[k] : 99);
      } else if (groupBy === 'priority') {
        const k = t.priority || '__none';
        const lbl = t.priority || 'No priority';
        pushGroup(k, lbl, t, PRIORITY_ORDER[t.priority] != null ? PRIORITY_ORDER[t.priority] : 99);
      } else if (groupBy === 'type') {
        const k = t.type || '__none';
        const lbl = t.type || 'No type';
        pushGroup(k, lbl, t, 0);
      } else if (groupBy === 'roadmap') {
        const rms = getTaskRoadmaps(t.id);
        if (rms.length === 0) pushGroup('__none', 'No roadmap', t, 99);
        else rms.forEach(r => pushGroup(r.id, r.name || '(unnamed)', t, 0));
      } else if (groupBy === 'tag') {
        const tagsArr = (t.taskTags || []);
        if (tagsArr.length === 0) pushGroup('__none', 'No tags', t, 99);
        else tagsArr.forEach(tg => pushGroup(tg, tg, t, 0));
      } else if (groupBy === 'dueMonth') {
        if (!t.dueDate) pushGroup('__none', 'No due date', t, 99);
        else {
          const k = t.dueDate.slice(0,7);
          pushGroup(k, k, t, 0);
        }
      }
    });
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const sa = a[1].sortKey != null ? a[1].sortKey : 0;
    const sb = b[1].sortKey != null ? b[1].sortKey : 0;
    if (sa !== sb) return sa - sb;
    return a[1].label.localeCompare(b[1].label);
  });

  let html = '';
  sortedGroups.forEach(([key, g]) => {
    const collapsed = profileCollapsedGroups.has(groupBy + ':' + key);
    html += '<div class="profile-task-group' + (collapsed ? ' collapsed' : '') + '" data-gkey="' + escapeHtml(groupBy + ':' + key) + '">';
    html += '<div class="group-head">';
    html += '<span>' + escapeHtml(g.label) + '</span>';
    html += '<span class="gh-count">' + g.tasks.length + ' task' + (g.tasks.length===1?'':'s') + ' ' + (collapsed ? '▸' : '▾') + '</span>';
    html += '</div>';
    html += '<div class="group-body">';
    g.tasks.forEach(t => {
      const prioCls = "prio-" + (t.priority || "").replace(/\s+/g, '');
      const typeCls = "type-" + (t.type || "").replace(/\s+/g, '');
      const badges = [];
      if (t.priority) badges.push('<span class="badge ' + prioCls + '">' + escapeHtml(t.priority) + '</span>');
      if (t.type) badges.push('<span class="badge ' + typeCls + '">' + escapeHtml(t.type) + '</span>');
      if (t.dueDate) badges.push('<span class="badge due">' + escapeHtml(t.dueDate) + '</span>');
      const statusColors = { "": "#cbd5e1", "Waiting": "#60a5fa", "Proposed": "#1d4ed8", "Later / Next": "#dc2626", "In Progress": "#f97316", "Under Review": "#7c3aed", "Completed": "#16a34a", "Archived": "#a98c5a", "Discarded": "#9a9a9a" };
      const dotColor = statusColors[t.slackStatus] || '#94a3b8';
      html += '<div class="profile-task-row" data-tid="' + t.id + '">';
      html += '<span style="width:8px;height:8px;border-radius:50%;background:' + dotColor + '"></span>';
      html += '<span class="text">' + escapeHtml(t.subject) + '</span>';
      html += '<span class="badges">' + badges.join(' ') + '</span>';
      html += '</div>';
    });
    html += '</div></div>';
  });
  return html;
}

function wireProfileTasks() {
  const tasksToggle = document.getElementById("profileTasksToggle");
  if (tasksToggle) {
    tasksToggle.addEventListener("click", () => {
      profileTasksCollapsed = !profileTasksCollapsed;
      localStorage.setItem("bookline-profileTasksCollapsed", profileTasksCollapsed ? "1" : "0");
      renderProfilePage();
    });
  }
  const proposedToggle = document.getElementById("profileProposedToggle");
  if (proposedToggle) {
    proposedToggle.addEventListener("click", () => {
      const key = "bookline-profileProposedCollapsed";
      const cur = localStorage.getItem(key) !== "0";
      localStorage.setItem(key, cur ? "0" : "1");
      renderProfilePage();
    });
  }
  const rmToggle = document.getElementById("profileRoadmapsToggle");
  if (rmToggle) {
    rmToggle.addEventListener("click", () => {
      profileRoadmapsCollapsed = !profileRoadmapsCollapsed;
      localStorage.setItem("bookline-profileRoadmapsCollapsed", profileRoadmapsCollapsed ? "1" : "0");
      renderProfilePage();
    });
  }
  const sel = document.getElementById("profileGroupBySel");
  if (sel) sel.addEventListener("change", e => setProfileGroupBy(e.target.value));

  document.querySelectorAll('#profilePageContent .profile-task-group .group-head').forEach(node => {
    node.addEventListener("click", () => {
      const group = node.closest('.profile-task-group');
      const key = group.dataset.gkey;
      toggleProfileGroup(key);
      group.classList.toggle('collapsed');
      // Update arrow
      const arrow = node.querySelector('.gh-count');
      if (arrow) arrow.textContent = arrow.textContent.replace(/[▾▸]/, group.classList.contains('collapsed') ? '▸' : '▾');
    });
  });

  document.querySelectorAll('#profilePageContent .profile-task-row .text').forEach(node => {
    node.addEventListener("click", () => {
      const row = node.closest('.profile-task-row');
      if (row && row.dataset.tid) openModal(row.dataset.tid);
    });
  });

  document.querySelectorAll('#profilePageContent .profile-rm-card .rm-name').forEach(node => {
    node.addEventListener("click", () => {
      const rmId = node.dataset.rm;
      if (!rmId) return;
      selectedRoadmapTimelineId = rmId;
      localStorage.setItem("bookline-selectedRoadmap", rmId);
      switchView("roadmaps");
    });
  });

  // Mini event bars (continuous overlay) — click to open task; the chevron has its own handler below.
  document.querySelectorAll('#profilePageContent .profile-rm-card .mini-event-bar').forEach(node => {
    node.addEventListener("click", e => {
      if (e.target.closest('.mini-event-caret')) return;
      e.stopPropagation();
      if (node.dataset.tid) openModal(node.dataset.tid);
    });
  });
  // Inline group expand chevrons inside mini-event bars — toggle the per-roadmap profile-group expansion
  document.querySelectorAll('#profilePageContent .profile-rm-card .mini-event-caret').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!window.__profileGroupExp) window.__profileGroupExp = {};
      const k = btn.dataset.rmid + '|' + btn.dataset.gid;
      window.__profileGroupExp[k] = !window.__profileGroupExp[k];
      if (typeof renderProfilePage === 'function') renderProfilePage();
    });
  });
}

