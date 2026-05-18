// =============================================================================
// lib/bulk-popovers.js
// ---------------------------------------------------------------------------
// Popovers that the bulk-action bar opens when the user has multiple tasks
// selected:
//
//   • bnRenderBulkProposedByPopover  — multi-select "Proposed by" picker
//   • renderBulkRoadmapsPopover      — multi-select roadmap add/remove
//   • toggleBulkRoadmapsPopover      — show/hide that popover
//   • renderBulkSetParentPopover     — pick a parent group for the selection
//
// Loaded AFTER inline. Their addEventListener wirings (bulkProposedByBtn,
// bulkRoadmapsBtn, etc.) STAY in inline because they sit next to similar
// bulk-bar wirings; they call these functions at click-time so late-binding
// resolves the references correctly.
// =============================================================================

// ---- bnRenderBulkProposedByPopover ----
function bnRenderBulkProposedByPopover() {
  const pop = document.getElementById("bulkProposedByPopover");
  if (!pop) return;
  const N = selectedTaskIds.size;
  if (N === 0) { pop.style.display = "none"; return; }
  const candidates = (typeof bnAllPeopleForProposedBy === 'function') ? bnAllPeopleForProposedBy() : [];
  if (candidates.length === 0) {
    pop.innerHTML = '<div class="bulk-rm-empty">No Bookline directory loaded.</div>';
    return;
  }
  // Bucket counts: how many of the selected tasks have each candidate in their proposedByIds
  const tasksSel = (STORE.tasks || []).filter(t => selectedTaskIds.has(t.id));
  function countTasksWith(pid) {
    return tasksSel.filter(t => Array.isArray(t.proposedByIds) && t.proposedByIds.includes(pid)).length;
  }
  // Group by section so the UI mirrors the picker
  const buckets = { team: [], supp: [], book: [], slack: [] };
  const seen = new Set();
  candidates.forEach(p => {
    if (!p || seen.has(p.id)) return;
    seen.add(p.id);
    if (p._slackOnly) { buckets.slack.push(p); return; }
    let sec = '';
    try { sec = (typeof getPersonSection === 'function') ? getPersonSection(p.id) : ''; } catch(_) {}
    if (sec === 'team') buckets.team.push(p);
    else if (sec === 'supplementary') buckets.supp.push(p);
    else if (sec === 'disabled') return;
    else buckets.book.push(p);
  });
  const byName = (a,b) => (a.displayName||a.name||'').localeCompare(b.displayName||b.name||'');
  Object.keys(buckets).forEach(k => buckets[k].sort(byName));

  let html = '<div class="bulk-rm-header">Click to add or remove all <strong>' + N + '</strong> selected task(s) from each proposer. <span style="color:#dc2626">−</span> = some, <span style="color:#1a1a1a">✓</span> = all, empty = none.</div>';
  html += '<input type="text" id="bulkProposedBySearch" placeholder="Search…" autocomplete="off" style="width:100%; padding:6px 8px; border:1px solid #d8d6d1; border-radius:6px; margin-bottom:8px; font-size:13px;">';
  html += '<div id="bulkProposedByList">';
  function section(label, arr) {
    if (arr.length === 0) return '';
    let h = '<div class="bulk-rm-section">' + escapeHtml(label) + '</div>';
    arr.forEach(p => {
      const cnt = countTasksWith(p.id);
      const state = cnt === 0 ? 'none' : (cnt === N ? 'all' : 'some');
      const mark = state === 'all' ? '✓' : (state === 'some' ? '−' : '');
      const cls = state === 'all' ? 'all' : (state === 'some' ? 'some' : 'none');
      const name = escapeHtml(p.displayName || p.name || p.id);
      const email = p.email ? '<span style="color:#9a9a9a;font-size:11px">' + escapeHtml(p.email) + '</span>' : '';
      h += '<div class="bulk-rm-row ' + cls + '" data-pid="' + escapeHtml(p.id) + '" data-name="' + name + '">' +
        '<span class="bulk-rm-mark">' + mark + '</span>' +
        '<span style="flex:1; display:flex; flex-direction:column; min-width:0">' +
          '<span class="bulk-rm-name">' + name + '</span>' +
          email +
        '</span>' +
      '</div>';
    });
    return h;
  }
  html += section('Team',                    buckets.team);
  html += section('Supplementary',           buckets.supp);
  html += section('Bookline',                buckets.book);
  html += section('Bookline · No tasks yet', buckets.slack);
  html += '</div>';
  pop.innerHTML = html;

  function applyFilter(q) {
    q = (q||'').trim().toLowerCase();
    pop.querySelectorAll('.bulk-rm-row').forEach(r => {
      const n = (r.getAttribute('data-name') || '').toLowerCase();
      r.style.display = (!q || n.includes(q)) ? '' : 'none';
    });
    // hide section headers whose all rows are hidden
    pop.querySelectorAll('.bulk-rm-section').forEach(h => {
      let next = h.nextElementSibling;
      let visible = false;
      while (next && !next.classList.contains('bulk-rm-section')) {
        if (next.classList.contains('bulk-rm-row') && next.style.display !== 'none') { visible = true; break; }
        next = next.nextElementSibling;
      }
      h.style.display = visible ? '' : 'none';
    });
  }
  const sb = pop.querySelector('#bulkProposedBySearch');
  if (sb) sb.addEventListener('input', () => applyFilter(sb.value));

  pop.querySelectorAll('.bulk-rm-row').forEach(row => {
    row.addEventListener('click', () => {
      const pid = row.getAttribute('data-pid');
      // CRITICAL: re-read the live selection at click time. The user may have
      // (de)selected tasks AFTER the popover was rendered, and we must not apply
      // changes to tasks that are no longer selected.
      const liveSel = (STORE.tasks || []).filter(t => selectedTaskIds.has(t.id));
      const liveN = liveSel.length;
      if (liveN === 0) { bnRenderBulkProposedByPopover(); return; }
      const cnt = liveSel.filter(t => Array.isArray(t.proposedByIds) && t.proposedByIds.includes(pid)).length;
      const wasState = cnt === 0 ? 'none' : (cnt === liveN ? 'all' : 'some');
      // Toggle: none/some → add to all; all → remove from all
      const addToAll = wasState !== 'all';
      liveSel.forEach(t => {
        if (!Array.isArray(t.proposedByIds)) t.proposedByIds = t.proposedById ? [t.proposedById] : [];
        const has = t.proposedByIds.includes(pid);
        if (addToAll && !has) t.proposedByIds.push(pid);
        if (!addToAll && has) t.proposedByIds = t.proposedByIds.filter(x => x !== pid);
        t.proposedById = t.proposedByIds[0] || '';
        // Sync the *raw email (legacy field) with the first proposer for compatibility.
        const firstP = t.proposedById ? findPerson(t.proposedById) : null;
        t.proposedByRaw = firstP ? (firstP.email || firstP.name || '') : '';
        t._pendingSync = true;
      });
      saveStore(STORE);
      bnRenderBulkProposedByPopover();
      if (typeof render === 'function') try { render(); } catch(_) {}
    });
  });
}

// ---- renderBulkRoadmapsPopover ----
function renderBulkRoadmapsPopover() {
  const pop = document.getElementById("bulkRoadmapsPopover");
  if (!pop) return;
  const rms = (typeof getRoadmaps === 'function') ? getRoadmaps() : [];
  const N = selectedTaskIds.size;
  if (N === 0) { pop.style.display = "none"; return; }
  if (rms.length === 0) {
    pop.innerHTML = '<div class="bulk-rm-empty">No roadmaps yet. Create one from the Roadmaps page.</div>';
    return;
  }
  let html = '<div class="bulk-rm-header">Click to add or remove all <strong>' + N + '</strong> selected task(s) from a roadmap. <span style="color:#dc2626">−</span> = some, <span style="color:#1a1a1a">✓</span> = all, empty = none.</div>';
  rms.forEach(rm => {
    const inRm = (rm.tasks || []).filter(e => selectedTaskIds.has(e.taskId)).length;
    let state = 'none';
    if (inRm === N) state = 'all';
    else if (inRm > 0) state = 'partial';
    const cls = state === 'all' ? 'checked' : (state === 'partial' ? 'partial' : '');
    html += '<div class="bulk-rm-row ' + cls + '" data-rmid="' + escapeHtml(rm.id) + '" data-state="' + state + '">' +
      '<span class="bulk-rm-cb"></span>' +
      '<span class="bulk-rm-name">' + escapeHtml(rm.name || '(unnamed)') + '</span>' +
      '<span class="bulk-rm-counter">' + inRm + '/' + N + '</span>' +
    '</div>';
  });
  pop.innerHTML = html;
  pop.querySelectorAll(".bulk-rm-row").forEach(row => {
    row.addEventListener("click", ev => {
      // Stop propagation so the outside-click listener doesn't close the popover
      // (its e.target would be detached after innerHTML refresh)
      ev.stopPropagation();
      const rmId = row.dataset.rmid;
      const rm = findRoadmap(rmId);
      if (!rm) return;
      if (!Array.isArray(rm.tasks)) rm.tasks = [];
      const state = row.dataset.state;
      if (state === 'all') {
        rm.tasks = rm.tasks.filter(e => !selectedTaskIds.has(e.taskId));
      } else {
        selectedTaskIds.forEach(tid => {
          if (!rm.tasks.some(e => e.taskId === tid)) rm.tasks.push({ taskId: tid });
        });
      }
      saveStore(STORE);
      // Refresh popover contents in place (do NOT call render() — that would reset things)
      renderBulkRoadmapsPopover();
      // Update task badges/list visually without full re-render
      if (typeof renderFlatTasks === 'function' && tasksViewMode === 'list') renderFlatTasks();
      else if (typeof render === 'function') {
        // Light re-render — note the popover stays open because we already stopped propagation
        render();
      }
    });
  });
}

// ---- toggleBulkRoadmapsPopover ----
function toggleBulkRoadmapsPopover(forceOpen) {
  const pop = document.getElementById("bulkRoadmapsPopover");
  if (!pop) return;
  const isOpen = pop.style.display !== "none";
  if (forceOpen === false || (forceOpen === undefined && isOpen)) { pop.style.display = "none"; return; }
  renderBulkRoadmapsPopover();
  pop.style.display = "";
}

// ---- renderBulkSetParentPopover ----
function renderBulkSetParentPopover() {
  const pop = document.getElementById("bulkSetParentPopover");
  if (!pop) return;
  const N = selectedTaskIds.size;
  if (N === 0) { pop.style.display = "none"; return; }
  // Candidates = every task with isGroup=true, EXCLUDING any task that is itself selected
  // (otherwise you could create a cycle by parenting a selected group to itself).
  const q = (__bulkParentSearch || "").toLowerCase().trim();
  const candidates = (STORE.tasks || []).filter(t => {
    if (!t.isGroup) return false;
    if (selectedTaskIds.has(t.id)) return false;
    if (!q) return true;
    return (t.subject || '').toLowerCase().indexOf(q) >= 0;
  }).sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
  // Header text
  let html = '<div class="bulk-rm-header">Pick a parent task. <strong>' + N + '</strong> selected task(s) will be nested under it. Click a parent to apply, or "Detach" to remove their current parent.</div>';
  // Search box
  html += '<div class="bulk-rm-search-wrap"><input type="text" id="bulkParentSearchInput" placeholder="Search parent tasks…" value="' + escapeHtml(__bulkParentSearch || '') + '" autocomplete="off"></div>';
  // Detach option (clears groupId on all selected)
  html += '<div class="bulk-rm-row bulk-parent-detach" data-action="detach">' +
    '<span class="bulk-rm-cb">×</span>' +
    '<span class="bulk-rm-name">Detach from any parent</span>' +
  '</div>';
  if (candidates.length === 0) {
    html += '<div class="bulk-rm-empty">No parent tasks match.' + (q ? '' : ' Open a task and toggle "Subtasks — this task contains other tasks" to make one.') + '</div>';
  } else {
    candidates.slice(0, 50).forEach(g => {
      // Indicate how many of the selected are already under this parent
      let already = 0;
      selectedTaskIds.forEach(tid => {
        const c = STORE.tasks.find(x => x.id === tid);
        if (c && c.groupId === g.id) already++;
      });
      const state = (already === N) ? 'all' : (already > 0 ? 'partial' : 'none');
      const cls = state === 'all' ? 'checked' : (state === 'partial' ? 'partial' : '');
      html += '<div class="bulk-rm-row ' + cls + '" data-gid="' + escapeHtml(g.id) + '" data-state="' + state + '">' +
        '<span class="bulk-rm-cb"></span>' +
        '<span class="bulk-rm-name">📁 ' + escapeHtml(g.subject || '(unnamed)') + '</span>' +
        '<span class="bulk-rm-counter">' + already + '/' + N + '</span>' +
      '</div>';
    });
    if (candidates.length > 50) {
      html += '<div class="bulk-rm-empty" style="font-size:11px">… and ' + (candidates.length - 50) + ' more. Refine the search.</div>';
    }
  }
  pop.innerHTML = html;
  // Search input
  const inp = document.getElementById("bulkParentSearchInput");
  if (inp) {
    inp.addEventListener("input", e => {
      __bulkParentSearch = e.target.value;
      renderBulkSetParentPopover();
      // Re-focus the input after re-render
      const newInp = document.getElementById("bulkParentSearchInput");
      if (newInp) { newInp.focus(); newInp.setSelectionRange(newInp.value.length, newInp.value.length); }
    });
    inp.addEventListener("click", e => e.stopPropagation());
    inp.addEventListener("keydown", e => {
      if (e.key === "Escape") { pop.style.display = "none"; }
    });
    setTimeout(() => inp.focus(), 0);
  }
  // Row clicks
  pop.querySelectorAll(".bulk-rm-row").forEach(row => {
    row.addEventListener("click", ev => {
      ev.stopPropagation();
      if (row.dataset.action === "detach") {
        let changed = 0;
        selectedTaskIds.forEach(tid => {
          const t = STORE.tasks.find(x => x.id === tid);
          if (t && t.groupId) { t.groupId = ""; t._pendingSync = true; changed++; }
        });
        if (changed === 0) return;
        saveStore(STORE);
      } else {
        const gid = row.dataset.gid;
        const parent = STORE.tasks.find(x => x.id === gid);
        if (!parent) return;
        const state = row.dataset.state;
        if (state === 'all') {
          // Toggle off — detach all selected from this parent
          selectedTaskIds.forEach(tid => {
            const t = STORE.tasks.find(x => x.id === tid);
            if (t && t.groupId === gid) { t.groupId = ""; t._pendingSync = true; }
          });
        } else {
          // Nest all selected under this parent (skipping itself just in case)
          selectedTaskIds.forEach(tid => {
            if (tid === gid) return;
            const t = STORE.tasks.find(x => x.id === tid);
            if (!t) return;
            t.groupId = gid;
            t._pendingSync = true;
          });
        }
        saveStore(STORE);
      }
      renderBulkSetParentPopover();
      if (typeof renderFlatTasks === 'function' && typeof tasksViewMode !== 'undefined' && tasksViewMode === 'list') renderFlatTasks();
      else if (typeof render === 'function') render();
    });
  });
}

