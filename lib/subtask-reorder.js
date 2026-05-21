// =============================================================================
// lib/subtask-reorder.js
// ---------------------------------------------------------------------------
// Shared helpers for drag-reordering subtasks of a group. Used by:
//   - views/modals/subtasks-panel.js (the subtasks panel inside the task modal)
//   - views/tasks.js (renderFlatTasks — list view)
//   - index.html's by-person renderer
//
// The persisted order lives on the parent task as `parent.subtaskOrder`
// (array of child IDs). Children not present in `subtaskOrder` fall back
// to the caller's default sort (usually sortTaskList).
//
// Loaded BEFORE views that use it; no IIFE so functions land on `window`.
// =============================================================================

// Reorder a list of children according to parent.subtaskOrder. Children not
// in the order array keep their incoming relative position (which is typically
// the caller's default sort, e.g. sortTaskList output). Pure function.
function bnApplySubtaskOrder(parent, kids) {
  if (!parent || !Array.isArray(kids) || kids.length <= 1) return kids;
  const order = Array.isArray(parent.subtaskOrder) ? parent.subtaskOrder : [];
  if (order.length === 0) return kids;
  const rank = new Map();
  order.forEach((id, i) => rank.set(id, i));
  // Stable sort: ranked items by rank, unranked items keep their relative position by index.
  return kids
    .map((k, i) => ({ k, i, r: rank.has(k.id) ? rank.get(k.id) : Number.POSITIVE_INFINITY }))
    .sort((a, b) => {
      if (a.r !== b.r) return a.r - b.r;
      return a.i - b.i; // preserve incoming order for ties / unranked
    })
    .map(x => x.k);
}
window.bnApplySubtaskOrder = bnApplySubtaskOrder;

// Wires drag-and-drop reorder for every direct-child row in `container` whose
// row element matches `rowSelector`. Each row must carry `data-tid="<childId>"`.
// `parent` is the parent group task whose subtaskOrder gets mutated on drop.
//
// Behaviour:
//   - Dragging any row over another row in the same container shows a top/bottom
//     drop indicator and, on drop, splices the dragged row into that position.
//   - Cross-container drops are ignored (we don't currently support moving a
//     subtask to a different parent via drag — use the picker for that).
//   - On a successful drop we persist `parent.subtaskOrder`, call
//     saveAndSyncTaskDates (or saveStore) and re-render the whole app so the
//     change is visible everywhere at once.
//
// `onAfter` is an optional callback fired after the reorder is persisted (used
// e.g. by the subtasks-panel to also re-render the modal panel).
function bnWireSubtaskReorder(container, parent, rowSelector, opts) {
  if (!container || !parent) return;
  opts = opts || {};
  const onAfter = typeof opts.onAfter === 'function' ? opts.onAfter : null;
  const rows = Array.from(container.querySelectorAll(':scope > ' + rowSelector));
  if (rows.length === 0) return;
  let draggingId = '';
  let dropIndicatorBefore = false;
  function _clearOverState() {
    rows.forEach(r => r.classList.remove('subtask-drag-over-before', 'subtask-drag-over-after'));
  }
  rows.forEach(row => {
    if (row._bnDragWired) return;
    row._bnDragWired = true;
    row.setAttribute('draggable', 'true');
    row.classList.add('bn-subtask-draggable');
    row.addEventListener('dragstart', e => {
      // Don't start a drag when the user is grabbing one of the row's own
      // interactive controls (checkbox toggle, chevron, edit button, etc.) —
      // their own pointer handlers should run as clicks instead.
      const tgt = e.target;
      if (tgt && tgt.closest && tgt.closest('button, input, textarea, select, .checkbox')) {
        e.preventDefault();
        return;
      }
      draggingId = row.dataset.tid || '';
      row.classList.add('subtask-dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        // Firefox needs SOMETHING set on dataTransfer for the drag to begin.
        e.dataTransfer.setData('text/plain', draggingId);
      } catch (_) {}
    });
    row.addEventListener('dragend', () => {
      draggingId = '';
      row.classList.remove('subtask-dragging');
      _clearOverState();
    });
    row.addEventListener('dragover', e => {
      if (!draggingId || row.dataset.tid === draggingId) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < (rect.height / 2);
      dropIndicatorBefore = before;
      _clearOverState();
      row.classList.add(before ? 'subtask-drag-over-before' : 'subtask-drag-over-after');
    });
    row.addEventListener('dragleave', e => {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('subtask-drag-over-before', 'subtask-drag-over-after');
      }
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      const targetId = row.dataset.tid;
      const movedId = draggingId;
      _clearOverState();
      if (!movedId || !targetId || movedId === targetId) return;
      // Build the new order from the children of `parent` currently in the
      // STORE (not just the rows in the DOM, which may be filtered). We want
      // the persisted order to remain coherent regardless of active filters.
      const allKids = (STORE.tasks || []).filter(x => x && x.groupId === parent.id && x.id !== parent.id);
      // Seed order from existing rank, then any kids not yet ranked tacked on
      // alphabetically (matches the picker-add behaviour).
      const existing = Array.isArray(parent.subtaskOrder) ? parent.subtaskOrder.slice() : [];
      const seen = new Set(existing);
      allKids.forEach(k => { if (!seen.has(k.id)) { existing.push(k.id); seen.add(k.id); } });
      // Remove the moved id and reinsert it relative to targetId.
      const withoutMoved = existing.filter(id => id !== movedId);
      const idx = withoutMoved.indexOf(targetId);
      if (idx < 0) return;
      const insertAt = dropIndicatorBefore ? idx : idx + 1;
      withoutMoved.splice(insertAt, 0, movedId);
      parent.subtaskOrder = withoutMoved;
      parent._pendingSync = true;
      if (typeof saveAndSyncTaskDates === 'function') saveAndSyncTaskDates();
      else if (typeof saveStore === 'function') saveStore(STORE);
      if (onAfter) {
        try { onAfter(); } catch (_) {}
      }
      // Full re-render so every view reflects the new order at once.
      if (typeof render === 'function') { try { render(); } catch (_) {} }
    });
  });
}
window.bnWireSubtaskReorder = bnWireSubtaskReorder;
