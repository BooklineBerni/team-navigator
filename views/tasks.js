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
  // Filter groups + tasks together with the same predicate (groups are normal tiles now).
  const visibleAll = sortTaskList((STORE.tasks || []).filter(t => taskMatchesFilters(t, { allowGroups: true })));
  // Top-level items render at the root (no groupId). Children render indented inside their parent group.
  const topLevel = visibleAll.filter(t => !t.groupId);
  if ((STORE.tasks || []).length === 0) {
    cont.innerHTML = '<div class="rm-empty">No tasks yet. Click <strong>+ New task</strong> to create one. To make a task a parent of others, open it and toggle <em>Subtasks — this task contains other tasks</em>.</div>';
    return;
  }
  if (topLevel.length === 0) {
    cont.innerHTML = '<div class="rm-empty">No tasks match the current filters.</div>';
    return;
  }
  // Recursive renderer so that a subtask that is ITSELF a group expands its own children too.
  function renderNode(t, depth) {
    let h = flatTaskHtml(t);
    if (t.isGroup) {
      const expanded = isGroupExpanded(t.id);
      const kids = sortTaskList((STORE.tasks || []).filter(c => c.groupId === t.id && taskMatchesFilters(c, { allowGroups: true })));
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

