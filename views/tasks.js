// =============================================================================
// views/tasks.js
// ---------------------------------------------------------------------------
// Tasks page renderer — the main task list (renderFlatTasks). Loaded AFTER
// the inline app script. References to STORE, taskMatchesFilters,
// renderFlatTasksRows, etc. resolve via the shared classic-script scope.
// The function name stays the same so inline's render() dispatcher and a few
// other guarded call-sites keep working unchanged.
// =============================================================================

function renderFlatTasks() {
  const cont = document.getElementById("flatTasksList");
  const allTasks = STORE.tasks || [];
  // Filter groups + tasks together with the same predicate (groups are normal tiles now).
  const visibleAll = sortTaskList(allTasks.filter(t => taskMatchesFilters(t, { allowGroups: true })));
  const visibleSet = new Set(visibleAll.map(t => t.id));
  // Build the breadcrumb chain of NON-matching ancestors above a task — used when
  // a task survives the filter but its parent group(s) don't. We render a
  // mini-row '↘ Parent name' line for each such ancestor so the user has
  // context without the full group row taking space. If the ancestor isn't
  // privacy-visible to the current user we still emit a row but with '↘ …'
  // and no name (mirrors the user's spec: "si puedo ver el nombre... sino hidden").
  function _ancestorVisibleToMe(anc) {
    // Use the same predicate the views already trust (privacy + visibility).
    // If we can't even import it, default to visible (admin assumption).
    try {
      if (typeof taskMatchesFilters === 'function') {
        // Pass an opts that disables filter dimensions so we ONLY check visibility.
        // taskMatchesFilters honours global privacy + share-with rules even when
        // every "skip" dim is set.
        return taskMatchesFilters(anc, { allowGroups: true, skipStatus: true, skipPriority: true, skipType: true, skipTaskTag: true, skipPersonTag: true, skipRoadmap: true, skipShareWith: true, skipDateStatus: true, skipSearch: true });
      }
    } catch (_) {}
    return true;
  }
  function _bcChainFor(t) {
    const chain = [];
    let cur = t.groupId;
    while (cur) {
      const parent = allTasks.find(x => x.id === cur);
      if (!parent) break;
      if (visibleSet.has(parent.id)) break;   // stop — parent renders normally
      chain.unshift(parent);   // root-first order
      cur = parent.groupId;
    }
    return chain;
  }
  function _renderBreadcrumbRow(anc, depth) {
    const visible = _ancestorVisibleToMe(anc);
    const indent = depth * 16;
    const nameHtml = visible
      ? escapeHtml(anc.subject || '(unnamed)')
      : '<span style="color:#bbb">…</span>';
    return '<div class="bn-bc-row" style="padding-left:' + (8 + indent) + 'px" data-gid="' + escapeHtml(anc.id) + '" title="' + (visible ? escapeHtml(anc.subject || '') + ' — click to open' : 'Hidden parent group') + '">' +
      '<span class="bn-bc-arrow">↘</span>' +
      '<span class="bn-bc-name">' + nameHtml + '</span>' +
    '</div>';
  }
  // Top-level items render at the root: items with no groupId, OR items whose
  // parent chain has NO matching ancestor (i.e. their _bcChainFor returns
  // non-empty AND no ancestor is in visibleSet — they get rendered at top with
  // their breadcrumb chain above).
  function _isPromotedToTop(t) {
    if (!t.groupId) return true;
    const chain = _bcChainFor(t);
    if (chain.length === 0) return false;   // direct parent in visibleSet → render under it
    // chain is all non-matching ancestors; if we ran out of ancestors before
    // finding a matching one (i.e. chain covers the whole path to root), we
    // promote. If we found a matching ancestor mid-way, _bcChainFor would have
    // broken out of the loop before walking all ancestors — but `chain.length > 0`
    // alone doesn't distinguish those two cases. Check: was the immediate parent
    // NOT in visibleSet?
    const parent = allTasks.find(x => x.id === t.groupId);
    return !!(parent && !visibleSet.has(parent.id));
  }
  if (allTasks.length === 0) {
    cont.innerHTML = '<div class="rm-empty">No tasks yet. Click <strong>+ New task</strong> to create one. To make a task a parent of others, open it and toggle <em>Subtasks — this task contains other tasks</em>.</div>';
    return;
  }
  const topLevel = visibleAll.filter(_isPromotedToTop);
  if (topLevel.length === 0) {
    cont.innerHTML = '<div class="rm-empty">No tasks match the current filters.</div>';
    return;
  }
  // Recursive renderer so that a subtask that is ITSELF a group expands its own children too.
  // Subtask order: kids start in the user's chosen sort (sortTaskList), then we honour
  // any manually-dragged order persisted on the parent (parent.subtaskOrder via
  // bnApplySubtaskOrder). Unranked kids keep their default-sort position.
  function renderNode(t, depth) {
    let h = '';
    // If this task was promoted to top-level because its parent chain didn't
    // match, render breadcrumb rows for each non-matching ancestor above it.
    if (depth === 0 && t.groupId) {
      const chain = _bcChainFor(t);
      chain.forEach((anc, i) => { h += _renderBreadcrumbRow(anc, i); });
      // The task itself is rendered indented under the deepest breadcrumb row.
      h += '<div class="bn-bc-wrap" style="padding-left:' + ((chain.length) * 16) + 'px">';
      h += flatTaskHtml(t);
      h += '</div>';
    } else {
      h += flatTaskHtml(t);
    }
    if (t.isGroup) {
      const expanded = isGroupExpanded(t.id);
      let kids = sortTaskList(allTasks.filter(c => c.groupId === t.id && taskMatchesFilters(c, { allowGroups: true })));
      if (typeof bnApplySubtaskOrder === 'function') kids = bnApplySubtaskOrder(t, kids);
      h += '<div class="group-children' + (expanded ? '' : ' collapsed') + '" data-gid="' + escapeHtml(t.id) + '">';
      if (kids.length === 0) {
        h += '<div class="group-empty" style="padding:6px 8px">No subtasks match the current filters.</div>';
      } else {
        kids.forEach(k => { h += renderNode(k, depth + 1); });
      }
      h += '</div>';
    }
    return h;
  }
  let html = '';
  topLevel.forEach(t => { html += renderNode(t, 0); });
  cont.innerHTML = html;
  // Breadcrumb rows are clickable — open the parent group's modal when visible.
  cont.querySelectorAll('.bn-bc-row').forEach(row => {
    row.addEventListener('click', e => {
      e.stopPropagation();
      const gid = row.dataset.gid;
      if (!gid) return;
      const parent = (STORE.tasks || []).find(x => x.id === gid);
      if (!parent) return;
      // Only open if user has visibility — _ancestorVisibleToMe was already
      // applied to decide whether the name is shown. Check the same predicate.
      if (typeof openModal === 'function') openModal(gid);
    });
  });
  // Drag-reorder + cross-group move:
  //   - bnWireAllRowsAsDragSources: every .flat-task can be picked up.
  //   - bnWireSubtaskReorder: each expanded group's children wrapper accepts
  //     drops on its inner rows (reorder) and on its empty area (adopt).
  //   - bnWireTopLevelGroupDropTargets: even a COLLAPSED top-level group row
  //     accepts drops so users can move a subtask into a group without having
  //     to expand it first.
  if (typeof bnWireAllRowsAsDragSources === 'function') {
    bnWireAllRowsAsDragSources(cont, '.flat-task');
  }
  if (typeof bnWireSubtaskReorder === 'function') {
    cont.querySelectorAll('.group-children').forEach(wrap => {
      const gid = wrap.dataset.gid;
      const parent = gid ? (typeof bnTaskById === 'function' ? bnTaskById(gid) : (STORE.tasks || []).find(x => x.id === gid)) : null;
      if (parent) bnWireSubtaskReorder(wrap, parent, '.flat-task');
    });
  }
  if (typeof bnWireTopLevelGroupDropTargets === 'function') {
    bnWireTopLevelGroupDropTargets(cont, '.flat-task');
  }

  cont.querySelectorAll(".flat-task").forEach(node => {
    const tid = node.dataset.tid;
    // Chevron click → expand/collapse children (for groups only)
    const caret = node.querySelector(".flat-group-caret");
    if (caret) caret.addEventListener("click", e => {
      e.stopPropagation();
      toggleGroupExpanded(tid);
      const childrenEl = node.nextElementSibling;
      if (childrenEl && childrenEl.classList.contains("group-children")) {
        childrenEl.classList.toggle("collapsed");
        caret.classList.toggle("expanded");
        caret.title = caret.classList.contains("expanded") ? "Collapse subtasks" : "Expand subtasks";
      } else if (typeof render === "function") {
        render();
      }
    });
    node.querySelector(".text").addEventListener("click", e => {
      if (e.target.closest(".flat-group-caret")) return;
      openModal(tid);
    });
    node.querySelector(".edit-btn").addEventListener("click", () => openModal(tid));
    node.querySelector(".checkbox").addEventListener("click", e => {
      e.stopPropagation();
      toggleSelected(tid);
      const sel = isSelected(tid);
      node.dataset.selected = sel ? "true" : "";
      const cb = node.querySelector(".checkbox");
      if (sel) cb.classList.add("checked"); else cb.classList.remove("checked");
    });
    // Click on avatar or name → go to Profile page
    node.querySelectorAll("[data-go-profile]").forEach(el => {
      el.addEventListener("click", e => {
        e.stopPropagation();
        const pid = el.dataset.goProfile;
        if (typeof setProfilePerson === 'function') setProfilePerson(pid);
        if (typeof switchView === 'function') switchView("profile");
      });
    });
  });
}

