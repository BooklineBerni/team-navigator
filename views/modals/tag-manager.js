// =============================================================================
// views/modals/tag-manager.js
// ---------------------------------------------------------------------------
// Task-tag rendering inside the task modal (renderTaskTagsInModal).
//
// Loaded AFTER inline. Wirings inside this block move together with their
// functions so DOM addEventListener calls resolve their references locally.
// References to STORE / TEAM / helpers resolve via the shared classic-script
// scope at runtime (when modal events fire).
// =============================================================================

// ---------- Tag Manager modal ----------

function renderTaskTagsInModal(t) {
  // Single wrap row: applied tags (full color, with ×) | divider | available tags (outline, faded).
  const cont = document.getElementById("f_taskTagsContainer");
  const tags = (t.taskTags || []).slice();
  const lib = getTaskTagLibrary();
  function tagHtml(name, applied) {
    const style = (typeof getTaskTagStyle === 'function') ? getTaskTagStyle(name) : '';
    const cls = 'task-tag ' + (applied ? 'applied' : 'suggest');
    const inner = applied
      ? (escapeHtml(name) + ' <span class="tag-remove">&times;</span>')
      : escapeHtml(name);
    return '<span class="' + cls + '" style="' + style + '" data-tag="' + escapeHtml(name) + '">' + inner + '</span>';
  }
  // Free-text tags (assigned but not in library) — keep first so they're not lost.
  const extraApplied = tags.filter(n => !lib.some(x => x.name === n));
  // Library tags split by applied/available, preserving library order.
  const libApplied   = lib.filter(x => tags.includes(x.name)).map(x => x.name);
  const libAvailable = lib.filter(x => !tags.includes(x.name)).map(x => x.name);
  let html = '';
  const appliedAll = [...libApplied, ...extraApplied];
  if (appliedAll.length === 0 && libAvailable.length === 0) {
    html = '<span class="task-tags-empty">No task tags in the library yet — create some with the "Task Tags" button.</span>';
  } else {
    if (appliedAll.length === 0) {
      html += '<span class="task-tags-empty">No tags applied</span>';
    } else {
      html += appliedAll.map(n => tagHtml(n, true)).join('');
    }
    if (libAvailable.length > 0) {
      html += '<span class="task-tags-divider"></span>';
      html += '<span class="task-tags-mini-label">Add</span>';
      html += libAvailable.map(n => tagHtml(n, false)).join('');
    }
  }
  cont.innerHTML = html;
  // Applied → click removes
  cont.querySelectorAll('.task-tag.applied').forEach(node => {
    node.addEventListener('click', () => {
      const n = node.dataset.tag;
      t.taskTags = (t.taskTags || []).filter(x => x !== n);
      const stored = STORE.tasks.find(x => x.id === t.id);
      if (stored) { stored.taskTags = t.taskTags; stored._pendingSync = true; saveStore(STORE); }
      renderTaskTagsInModal(t);
    });
  });
  // Suggested → click adds
  cont.querySelectorAll('.task-tag.suggest').forEach(node => {
    node.addEventListener('click', () => {
      const n = node.dataset.tag;
      t.taskTags = t.taskTags || [];
      if (!t.taskTags.includes(n)) t.taskTags.push(n);
      const stored = STORE.tasks.find(x => x.id === t.id);
      if (stored) { stored.taskTags = t.taskTags; stored._pendingSync = true; saveStore(STORE); }
      renderTaskTagsInModal(t);
    });
  });
}

