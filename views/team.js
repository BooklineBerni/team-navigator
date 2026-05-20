// =============================================================================
// views/team.js
// ---------------------------------------------------------------------------
// Team (Members) page renderer. Loaded AFTER the inline app script. The
// search-input wiring (memberPageSearchEl) stays in inline, but its
// setTimeout(renderMembersPage,…) was converted to an arrow wrapper so the
// reference is resolved when the timer fires, after this file loads.
// =============================================================================

function renderMembersPage() {
  const grid = document.getElementById("membersGrid");
  const q = (membersPageQuery || "").toLowerCase();
  // For restricted_view users: show ALL active people in a single "bookline" section,
  // no tags, no disabled section. (Admins see the full structured page.)
  const isRestricted = (typeof bnIsRestrictedView === 'function') ? bnIsRestrictedView() : (typeof bnUserPermission !== 'undefined' && bnUserPermission === 'restricted_view');
  function matchesQuery(p) {
    if (!q) return true;
    return (p.name + " " + (p.email||"") + " " + (p.displayName||"") + " " + getTagsFor(p.id).join(" ")).toLowerCase().includes(q);
  }
  // Build a unified pool of all known people. Sources:
  //   TEAM (active team + customMembers)
  //   EXTERNAL_TEAM (extended Bookline)
  //   Every proposer id referenced in tasks
  //   The ENTIRE SLACK_DIRECTORY — so the People page surfaces all Bookline Slack users
  //   even before they have any activity. New people land in "Bookline · Sin tasks" by
  //   default; admin can edit their profile to move them to Team / Supplementary / Disabled.
  const pool = [];
  const seen = new Set();
  function addToPool(p){ if (!p || seen.has(p.id)) return; seen.add(p.id); pool.push(p); }
  TEAM.forEach(addToPool);
  if (typeof EXTERNAL_TEAM !== 'undefined') EXTERNAL_TEAM.forEach(addToPool);
  getAllProposerIds().forEach(id => { const p = findPerson(id); if (p) addToPool(p); });
  if (typeof SLACK_DIRECTORY !== 'undefined' && Array.isArray(SLACK_DIRECTORY)) {
    SLACK_DIRECTORY.forEach(u => { const p = findPerson(u.id); if (p) addToPool(p); });
  }

  // Section-based grouping (single-choice picklist):
  //   team / supplementary / disabled / "" (Bookline = empty + has tasks OR proposals)
  function ownsTasks(pid) {
    // Groups count as tasks too.
    return (STORE.tasks || []).some(t => t.responsibleId === pid);
  }
  // Build the set of people who live inside a custom group. They're rendered
  // as chips under the group's card, not as their own card. Also build a
  // lookup so we can determine the "effective section" of group members —
  // adding someone to a group that lives in Team puts them in Team too.
  const groupMemberIdsSet = new Set();
  const groupOf = new Map(); // memberId → group person id
  ((STORE && STORE.customMembers) || []).forEach(m => {
    if (m && m.isPeopleGroup && Array.isArray(m.memberIds)) {
      m.memberIds.forEach(id => { groupMemberIdsSet.add(id); groupOf.set(id, m.id); });
    }
  });
  // Effective section for placement: if the person is in a group, use the
  // group's section. Otherwise their own explicit section.
  function effectiveSection(pid) {
    const grpId = groupOf.get(pid);
    if (grpId) return getPersonSection(grpId) || '';
    return getPersonSection(pid);
  }
  // The classify pass uses effectiveSection so members follow their group,
  // but the actual rendering filters them out (they get nested under the
  // group's card via memberCardHtml).
  // Team: ONLY people whose effective section is "team"
  const teamActive    = pool.filter(p => effectiveSection(p.id) === "team" && matchesQuery(p) && !groupMemberIdsSet.has(p.id));
  const supplementary = pool.filter(p => effectiveSection(p.id) === "supplementary" && matchesQuery(p) && !groupMemberIdsSet.has(p.id));
  const proposerIds = getAllProposerIds();
  // Bookline: section is empty AND (has proposals OR owns tasks)
  const bookline = [];
  // Bookline · Sin tasks: section is empty AND NOT in proposerIds AND NOT ownsTasks.
  // These are people who exist in the directory (TEAM/EXTERNAL/customMembers) but
  // have no activity yet — typically users auto-promoted from SLACK_DIRECTORY.
  const booklineNoTasks = [];
  for (const p of pool) {
    if (groupMemberIdsSet.has(p.id)) continue;
    if (effectiveSection(p.id) !== "") continue;
    if (!matchesQuery(p)) continue;
    if (proposerIds.has(p.id) || ownsTasks(p.id)) bookline.push(p);
    else booklineNoTasks.push(p);
  }
  bookline.sort((a, b) => countProposerTasks(b.id) - countProposerTasks(a.id) || (a.name||'').localeCompare(b.name||''));
  booklineNoTasks.sort((a, b) => (a.name||'').localeCompare(b.name||''));
  supplementary.sort((a, b) => (a.name||'').localeCompare(b.name||''));
  // Disabled: everyone whose section is "disabled"
  const disabled = pool.filter(p => effectiveSection(p.id) === "disabled" && matchesQuery(p) && !groupMemberIdsSet.has(p.id));

  // Sort team using existing sort
  const teamSorted = sortPersons(teamActive.map(p => p.id), STORE.tasks).map(id => findPerson(id)).filter(Boolean);

  if (teamSorted.length === 0 && supplementary.length === 0 && bookline.length === 0 && booklineNoTasks.length === 0 && disabled.length === 0) {
    grid.innerHTML = '<div class="rm-empty">No people match.</div>';
    return;
  }

  function memberCardHtml(p, mode) {
    const tags = isRestricted ? [] : getTagsFor(p.id);
    const tagsHtml = isRestricted
      ? ''
      : (tags.length
          ? '<div class="person-tags-line">' + tags.map(t => tagBadgeHtml(t, false)).join("") + '</div>'
          : '<div class="person-tags-line" style="color:#bbb">No tags</div>');
    const settings = getPersonSettings(p.id);
    // Hours are admin-only metadata; restricted/preview users never see them.
    const awt = (!isRestricted && settings.availableWeekTime != null && settings.availableWeekTime !== "")
      ? '<div class="role bn-person-hours" style="color:#0891b2; font-weight:600">Available: ' + settings.availableWeekTime + 'h/week</div>' : "";

    let statsHtml = '';
    let roadmapsHtml = '';
    if (mode === 'team') {
      // Groups ARE tasks — include them in every people-card count.
      const taskCount = STORE.tasks.filter(t => t.responsibleId === p.id).length;
      const pendingCount = STORE.tasks.filter(t => t.responsibleId === p.id && t.slackStatus === "Proposed").length;
      const inProgressCount = STORE.tasks.filter(t => t.responsibleId === p.id && t.slackStatus === "In Progress").length;
      // Roadmaps shown on People cards: only the ones this person OWNS (is responsible for).
      const personRoadmaps = getRoadmapsForPerson(p.id);
      roadmapsHtml = personRoadmaps.length
        ? '<div class="person-roadmaps-line" data-uid="' + p.id + '">' +
            personRoadmaps.map(r => '<span class="rm-mini-badge" data-rm="' + r.id + '" title="Open ' + escapeHtml(r.name||'') + '">' + escapeHtml((r.name||'').slice(0,22)) + (r.responsibleId === p.id ? ' <span class="rm-mini-owner" title="Owner">●</span>' : '') + '</span>').join('') +
          '</div>'
        : '';
      statsHtml = '<span class="stat" title="Total tasks">' + taskCount + ' tasks</span>' +
        (pendingCount > 0 ? '<span class="stat" title="Proposed"><span class="dot proposed"></span>' + pendingCount + '</span>' : '') +
        (inProgressCount > 0 ? '<span class="stat" title="In Progress"><span class="dot in-progress"></span>' + inProgressCount + '</span>' : '');
    } else {
      // Bookline / disabled-non-team: show task phase counts (where they are proposer)
      const isProposer = (t) => Array.isArray(t.proposedByIds) ? t.proposedByIds.includes(p.id) : t.proposedById === p.id;
      const all = STORE.tasks.filter(t => isProposer(t));
      const counts = {
        proposed:     all.filter(t => t.slackStatus === "Proposed").length,
        under_review: all.filter(t => t.slackStatus === "Under Review").length,
        in_progress:  all.filter(t => t.slackStatus === "In Progress").length,
        waiting:      all.filter(t => t.slackStatus === "Waiting").length,
        later_next:   all.filter(t => t.slackStatus === "Later / Next").length,
        completed:    all.filter(t => t.slackStatus === "Completed").length,
        archived:     all.filter(t => t.slackStatus === "Archived").length,
        discarded:    all.filter(t => t.slackStatus === "Discarded").length
      };
      statsHtml = '<span class="stat" title="Tasks where they are a proposer"><strong>' + all.length + '</strong> proposed</span>';
      if (counts.proposed > 0)     statsHtml += '<span class="stat" title="Proposed"><span class="dot proposed"></span>' + counts.proposed + '</span>';
      if (counts.under_review > 0) statsHtml += '<span class="stat" title="Under Review"><span class="dot under-review"></span>' + counts.under_review + '</span>';
      if (counts.in_progress > 0)  statsHtml += '<span class="stat" title="In Progress"><span class="dot in-progress"></span>' + counts.in_progress + '</span>';
      if (counts.waiting > 0)      statsHtml += '<span class="stat" title="Waiting"><span class="dot waiting"></span>' + counts.waiting + '</span>';
      if (counts.later_next > 0)   statsHtml += '<span class="stat" title="Later / Next"><span class="dot later-next"></span>' + counts.later_next + '</span>';
      if (counts.completed > 0)    statsHtml += '<span class="stat" title="Completed"><span class="dot completed"></span>' + counts.completed + '</span>';
      if (counts.archived > 0)     statsHtml += '<span class="stat" title="Archived"><span class="dot archived"></span>' + counts.archived + '</span>';
      if (counts.discarded > 0)    statsHtml += '<span class="stat" title="Discarded"><span class="dot discarded"></span>' + counts.discarded + '</span>';
    }

    // Custom members can be fully edited (name/email/photo). Slack-imported
    // members cannot — their data comes from Slack and is read-only here.
    const isCustomPerson = !!(p.isCustom) ||
      ((STORE && Array.isArray(STORE.customMembers)) ? STORE.customMembers.some(m => m.id === p.id && m.isCustom) : false);
    const editBtn = isCustomPerson
      ? '<button type="button" class="member-edit-btn" data-edit-uid="' + escapeHtml(p.id) + '" title="Edit this custom member">✎</button>'
      : '';

    // If this is a "people group", build a small chip list of its members to
    // render INSIDE the card. The members themselves are filtered out of the
    // section lists above so they only appear here.
    const groupRecord = (STORE && Array.isArray(STORE.customMembers))
      ? STORE.customMembers.find(m => m.id === p.id && m.isPeopleGroup)
      : null;
    let groupMembersHtml = '';
    if (groupRecord) {
      const memberIds = Array.isArray(groupRecord.memberIds) ? groupRecord.memberIds : [];
      const members = memberIds.map(id => findPerson(id)).filter(Boolean);
      groupMembersHtml = '<div class="member-group-chips" data-group-uid="' + escapeHtml(p.id) + '">';
      if (members.length === 0) {
        groupMembersHtml += '<span class="member-group-empty">No members yet</span>';
      } else {
        groupMembersHtml += members.map(mm =>
          '<span class="member-group-chip" data-go-profile="' + escapeHtml(mm.id) + '" title="Open ' + escapeHtml(mm.displayName || mm.name || '') + '">' +
            '<span class="av-mini" style="background:' + (mm.color || '#9a9a9a') + '">' +
              (mm.photo ? '<img src="' + escapeHtml(mm.photo) + '" alt="" onerror="this.remove()">' : '') +
              '<span class="ini">' + escapeHtml(initials(mm.name || '')) + '</span>' +
            '</span>' +
            '<span>' + escapeHtml(mm.displayName || mm.name || '') + '</span>' +
          '</span>'
        ).join('');
      }
      groupMembersHtml += '</div>';
    }

    const cls = 'member-card' +
      (isDeactivated(p.id) ? ' deactivated' : '') +
      (mode === 'bookline' ? ' member-bookline' : '') +
      (isCustomPerson ? ' member-custom' : '') +
      (groupRecord ? ' member-people-group' : '');
    return '<div class="' + cls + '" data-uid="' + p.id + '">' +
      '<div class="person-row">' +
        '<span class="avatar" style="background:' + (p.color || '#9a9a9a') + '">' +
          (p.photo ? '<img src="' + escapeHtml(p.photo) + '" alt="" onerror="this.remove()">' : '') +
          '<span class="ini">' + escapeHtml(initials(p.name||'')) + '</span>' +
        '</span>' +
        '<div class="meta">' +
          '<div class="name">' + escapeHtml(p.name||'') + '</div>' +
          '<div class="email">' + escapeHtml(p.email || "") + '</div>' +
          awt +
        '</div>' +
        editBtn +
      '</div>' +
      tagsHtml +
      roadmapsHtml +
      groupMembersHtml +
      '<div class="stats" style="margin-top:auto; padding-top:6px; border-top:1px solid #f0efeb">' + statsHtml + '</div>' +
    '</div>';
  }

  // Collapsible section state
  function getSectionCollapsed(key) {
    return localStorage.getItem('bn-people-section-collapsed-' + key) === '1';
  }
  function makeSectionHtml(key, headingInner, gridInner, gridExtraClass) {
    const collapsed = getSectionCollapsed(key);
    const caret = '<span class="members-section-caret">' + (collapsed ? '▸' : '▾') + '</span>';
    const cls = 'members-section-heading members-section-toggle' + (key === 'bookline' ? ' members-section-bookline' : '');
    let html = '<h3 class="' + cls + '" data-section="' + key + '">' + caret + headingInner + '</h3>';
    html += '<div class="members-grid ' + (gridExtraClass || '') + (collapsed ? ' members-grid-collapsed' : '') + '" data-section-grid="' + key + '">' + gridInner + '</div>';
    return html;
  }

  let html = '';
  if (isRestricted) {
    // Restricted_view collapses all active people (team + supplementary + bookline with
    // tasks + bookline without tasks) into a single "Bookline" section. Disabled is hidden.
    const allActive = [...teamSorted, ...supplementary, ...bookline, ...booklineNoTasks];
    const dedup = [];
    const seenIds = new Set();
    allActive.forEach(p => { if (p && !seenIds.has(p.id)) { seenIds.add(p.id); dedup.push(p); } });
    dedup.sort((a, b) => (a.name||'').localeCompare(b.name||''));
    const heading = '<img class="bookline-logo-img" src="https://framerusercontent.com/images/uTJVj3ufTlg1OOblrAuZMyDSHOA.png" alt="Bookline">' +
      ' <span style="color:#9a9a9a;font-weight:400;font-size:13px">(' + dedup.length + ')</span>';
    html += makeSectionHtml('bookline', heading, dedup.map(p => memberCardHtml(p, 'bookline')).join(""));
  } else {
    if (teamSorted.length > 0) {
      const inner = 'Team <span style="color:#9a9a9a;font-weight:400;font-size:13px">(' + teamSorted.length + ')</span>';
      html += makeSectionHtml('team', inner, teamSorted.map(p => memberCardHtml(p, 'team')).join(""));
    }
    if (supplementary.length > 0) {
      const inner = 'Supplementary <span style="color:#9a9a9a;font-weight:400;font-size:13px">(' + supplementary.length + ')</span> <span style="color:#9a9a9a;font-weight:400;font-size:11.5px;margin-left:6px">— people you collaborate with, not on your direct team</span>';
      html += makeSectionHtml('supplementary', inner, supplementary.map(p => memberCardHtml(p, 'supplementary')).join(""));
    }
    // Bookline: single section with two collapsible sub-groups — "Con tasks" and "Sin tasks".
    if (bookline.length > 0 || booklineNoTasks.length > 0) {
      const total = bookline.length + booklineNoTasks.length;
      const heading = '<img class="bookline-logo-img" src="https://framerusercontent.com/images/uTJVj3ufTlg1OOblrAuZMyDSHOA.png" alt="Bookline">' +
        ' <span style="color:#9a9a9a;font-weight:400;font-size:13px">(' + total + ')</span>';
      function renderSub(subKey, label, items) {
        const collapsed = localStorage.getItem('bn-people-subsection-collapsed-' + subKey) === '1';
        const caret = '<span class="members-subsection-caret">' + (collapsed ? '▸' : '▾') + '</span>';
        return '<div class="members-subsection-label" data-subsection="' + subKey + '">' + caret + label + ' <span style="color:#9a9a9a;font-weight:400">(' + items.length + ')</span></div>' +
          '<div class="members-subsection-grid' + (collapsed ? ' members-grid-collapsed' : '') + '" data-subsection-grid="' + subKey + '">' +
            items.map(p => memberCardHtml(p, 'bookline')).join('') +
          '</div>';
      }
      let inner = '';
      if (bookline.length > 0)        inner += renderSub('bookline-with',    'With tasks',    bookline);
      if (booklineNoTasks.length > 0) inner += renderSub('bookline-without', 'Without tasks', booklineNoTasks);
      html += makeSectionHtml('bookline', heading, inner, 'members-grid-bookline-with-subs');
    }
    if (disabled.length > 0) {
      const inner = 'Disabled <span style="color:#9a9a9a;font-weight:400;font-size:13px">(' + disabled.length + ')</span>';
      html += makeSectionHtml('disabled', inner, disabled.map(p => memberCardHtml(p, 'disabled')).join(""), 'members-grid-disabled');
    }
  }
  grid.innerHTML = html;
  // Wire collapse toggles
  grid.querySelectorAll('.members-section-toggle').forEach(h => {
    h.addEventListener('click', () => {
      const key = h.dataset.section;
      const wasCollapsed = getSectionCollapsed(key);
      localStorage.setItem('bn-people-section-collapsed-' + key, wasCollapsed ? '0' : '1');
      // Toggle visually + flip caret
      const gridEl = grid.querySelector('[data-section-grid="' + key + '"]');
      if (gridEl) gridEl.classList.toggle('members-grid-collapsed');
      const caret = h.querySelector('.members-section-caret');
      if (caret) caret.textContent = !wasCollapsed ? '▸' : '▾';
    });
  });
  // Wire subsection toggles (Bookline's Con/Sin tasks subgroups)
  grid.querySelectorAll('.members-subsection-label[data-subsection]').forEach(h => {
    h.addEventListener('click', () => {
      const k = h.dataset.subsection;
      const wasCollapsed = localStorage.getItem('bn-people-subsection-collapsed-' + k) === '1';
      localStorage.setItem('bn-people-subsection-collapsed-' + k, wasCollapsed ? '0' : '1');
      const subGrid = grid.querySelector('[data-subsection-grid="' + k + '"]');
      if (subGrid) subGrid.classList.toggle('members-grid-collapsed');
      const caret = h.querySelector('.members-subsection-caret');
      if (caret) caret.textContent = !wasCollapsed ? '▸' : '▾';
    });
  });

  document.querySelectorAll("#membersGrid .member-card").forEach(node => {
    node.addEventListener("click", e => {
      // Edit button on custom members — open Add Member modal in edit mode.
      const editBtn = e.target.closest('.member-edit-btn');
      if (editBtn) {
        e.stopPropagation();
        const uid = editBtn.dataset.editUid;
        if (uid && typeof openEditCustomMember === 'function') openEditCustomMember(uid);
        return;
      }
      const badge = e.target.closest('.rm-mini-badge');
      if (badge) {
        e.stopPropagation();
        const rmId = badge.dataset.rm;
        if (rmId) {
          selectedRoadmapTimelineId = rmId;
          localStorage.setItem("bookline-selectedRoadmap", rmId);
          switchView("roadmaps");
        }
        return;
      }
      // Group-member chip → navigate to that person's profile.
      const memberChip = e.target.closest('[data-go-profile]');
      if (memberChip) {
        e.stopPropagation();
        const uid = memberChip.dataset.goProfile;
        if (uid) {
          setProfilePerson(uid);
          switchView("profile");
        }
        return;
      }
      // Open Profile page (which has full edit mode for tags, disable, etc.)
      setProfilePerson(node.dataset.uid);
      switchView("profile");
    });
  });
}

