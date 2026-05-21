// =============================================================================
// lib/subtask-reorder.js
// ---------------------------------------------------------------------------
// Drag-reorder & cross-group move of subtasks. Used by:
//   - views/modals/subtasks-panel.js (intra-group reorder inside the modal)
//   - views/tasks.js (renderFlatTasks — list view)
//   - index.html's by-person renderer
//
// Two distinct behaviours, wired together:
//
//   • Within the same group's children container → reorder. The order is
//     persisted on the parent task as `parent.subtaskOrder` (array of IDs).
//     Children not present in `subtaskOrder` fall back to the caller's
//     default sort (usually sortTaskList).
//
//   • Drop on a group row (or into a different group's children area) →
//     move. The dragged task's `groupId` is set to the new parent. Cycles
//     are refused (you can't drop a group onto itself or onto one of its
//     own descendants). Dropping a child onto a NON-group row makes it a
//     sibling of that row (i.e. it adopts that row's groupId — possibly
//     empty, which detaches it to top-level).
//
// Loaded BEFORE any view that renders group children. No IIFE so functions
// land on `window`.
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
  return kids
    .map((k, i) => ({ k, i, r: rank.has(k.id) ? rank.get(k.id) : Number.POSITIVE_INFINITY }))
    .sort((a, b) => {
      if (a.r !== b.r) return a.r - b.r;
      return a.i - b.i;
    })
    .map(x => x.k);
}
window.bnApplySubtaskOrder = bnApplySubtaskOrder;

// Cycle check: would moving `child` into `newParent` create a loop?
// Returns true if newParentId is the child itself, or any descendant of child.
function bnWouldCreateGroupCycle(childId, newParentId) {
  if (!childId || !newParentId) return false;
  if (childId === newParentId) return true;
  // Walk DOWN from child collecting descendants.
  const descendants = new Set();
  const stack = [childId];
  const tasks = (typeof STORE !== 'undefined' && STORE && Array.isArray(STORE.tasks)) ? STORE.tasks : [];
  while (stack.length) {
    const cur = stack.pop();
    for (const t of tasks) {
      if (t && t.groupId === cur && !descendants.has(t.id)) {
        descendants.add(t.id);
        stack.push(t.id);
      }
    }
  }
  return descendants.has(newParentId);
}
window.bnWouldCreateGroupCycle = bnWouldCreateGroupCycle;

// State shared across all rows in a wirer call so dragstart on one row can
// be read by drop on another row in a DIFFERENT container (cross-group drag).
let bnDragSource = { tid: '', fromGroupId: '' };

// Lookup a task by id without depending on the inline bnTaskById helper
// (which isn't visible everywhere classic-script-wise during boot).
function _bnTaskByIdSafe(id) {
  if (typeof bnTaskById === 'function') {
    try { return bnTaskById(id); } catch (_) {}
  }
  if (typeof STORE !== 'undefined' && STORE && Array.isArray(STORE.tasks)) {
    return STORE.tasks.find(x => x && x.id === id) || null;
  }
  return null;
}

// Wire drag-source behaviour on `rows` (every task row that the user can
// drag). Each row must carry `data-tid="<taskId>"` and `data-gid` is read
// from the closest .group-children / .card-group-children ancestor's
// data-gid (the parent group ID). If the row isn't inside any children
// container, fromGroupId is '' (top-level item).
function _wireDragSource(row) {
  if (row._bnDragSrcWired) return;
  row._bnDragSrcWired = true;
  row.setAttribute('draggable', 'true');
  row.classList.add('bn-subtask-draggable');
  row.addEventListener('dragstart', e => {
    // Don't start a drag when the user is interacting with one of the row's
    // own controls (checkbox toggle, chevron, edit button, etc.).
    const tgt = e.target;
    if (tgt && tgt.closest && tgt.closest('button, input, textarea, select, .checkbox')) {
      e.preventDefault();
      return;
    }
    const tid = row.dataset.tid || '';
    // Determine the source group: nearest .group-children/.card-group-children's data-gid.
    const wrap = row.closest('.group-children, .card-group-children');
    const fromGid = wrap ? (wrap.dataset.gid || '') : '';
    bnDragSource = { tid, fromGroupId: fromGid };
    row.classList.add('subtask-dragging');
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tid);
    } catch (_) {}
  });
  row.addEventListener('dragend', () => {
    bnDragSource = { tid: '', fromGroupId: '' };
    row.classList.remove('subtask-dragging');
    document.querySelectorAll('.subtask-drag-over-before, .subtask-drag-over-after, .bn-drop-target-group')
      .forEach(el => el.classList.remove('subtask-drag-over-before', 'subtask-drag-over-after', 'bn-drop-target-group'));
  });
}

// Persist `child.groupId = newGroupId` (empty string detaches to top-level).
// Refuses no-op and cycle moves; returns true if a change was actually saved.
function bnMoveTaskToGroup(childId, newGroupId) {
  const child = _bnTaskByIdSafe(childId);
  if (!child) return false;
  const oldGid = child.groupId || '';
  const newGid = newGroupId || '';
  if (oldGid === newGid) return false;
  if (newGid && bnWouldCreateGroupCycle(childId, newGid)) {
    console.warn('[BN] cross-group drop refused — would create a cycle');
    return false;
  }
  // Drop the child from the old parent's subtaskOrder so a future re-attach
  // doesn't leave a phantom slot.
  if (oldGid) {
    const oldParent = _bnTaskByIdSafe(oldGid);
    if (oldParent && Array.isArray(oldParent.subtaskOrder)) {
      oldParent.subtaskOrder = oldParent.subtaskOrder.filter(id => id !== childId);
    }
  }
  // Append to the new parent's subtaskOrder so the moved child shows up at
  // the END of the destination (rather than alphabetised among existing kids).
  if (newGid) {
    const newParent = _bnTaskByIdSafe(newGid);
    if (newParent) {
      if (!Array.isArray(newParent.subtaskOrder)) newParent.subtaskOrder = [];
      if (!newParent.subtaskOrder.includes(childId)) newParent.subtaskOrder.push(childId);
    }
  }
  child.groupId = newGid;
  child._pendingSync = true;
  if (typeof saveAndSyncTaskDates === 'function') saveAndSyncTaskDates();
  else if (typeof saveStore === 'function') saveStore(STORE);
  return true;
}
window.bnMoveTaskToGroup = bnMoveTaskToGroup;

// Reorder a child within its parent's subtaskOrder relative to targetId.
function _bnReorderWithinGroup(parent, movedId, targetId, before) {
  if (!parent || !movedId || !targetId || movedId === targetId) return false;
  const allKids = (STORE.tasks || []).filter(x => x && x.groupId === parent.id && x.id !== parent.id);
  const existing = Array.isArray(parent.subtaskOrder) ? parent.subtaskOrder.slice() : [];
  const seen = new Set(existing);
  allKids.forEach(k => { if (!seen.has(k.id)) { existing.push(k.id); seen.add(k.id); } });
  const withoutMoved = existing.filter(id => id !== movedId);
  const idx = withoutMoved.indexOf(targetId);
  if (idx < 0) return false;
  withoutMoved.splice(before ? idx : idx + 1, 0, movedId);
  parent.subtaskOrder = withoutMoved;
  parent._pendingSync = true;
  if (typeof saveAndSyncTaskDates === 'function') saveAndSyncTaskDates();
  else if (typeof saveStore === 'function') saveStore(STORE);
  return true;
}

function _clearDropIndicators() {
  document.querySelectorAll('.subtask-drag-over-before, .subtask-drag-over-after, .bn-drop-target-group')
    .forEach(el => el.classList.remove('subtask-drag-over-before', 'subtask-drag-over-after', 'bn-drop-target-group'));
}

// Wire one task row as a DROP TARGET. The drop semantics:
//   • If the dropped task = this row → no-op.
//   • If both rows share the same parent group → reorder.
//   • Else if THIS row is a group → make dropped a CHILD of this group.
//   • Else → make dropped a sibling of this row (adopt this row's groupId).
function _wireDropTarget(row) {
  if (row._bnDropTgtWired) return;
  row._bnDropTgtWired = true;
  row.addEventListener('dragover', e => {
    const movedId = bnDragSource.tid;
    if (!movedId || row.dataset.tid === movedId) return;
    // Refuse drag-over on rows that would form a cycle when moved.
    const rowTid = row.dataset.tid;
    if (rowTid && bnWouldCreateGroupCycle(movedId, rowTid)) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    _clearDropIndicators();
    const rect = row.getBoundingClientRect();
    const isGroup = row.classList.contains('is-group');
    const isSibling = (() => {
      const wrap = row.closest('.group-children, .card-group-children');
      const myGid = wrap ? (wrap.dataset.gid || '') : '';
      return myGid === bnDragSource.fromGroupId;
    })();
    if (isGroup && !isSibling) {
      // Whole-row highlight = "drop INTO this group"
      row.classList.add('bn-drop-target-group');
    } else {
      // Top/bottom split = "reorder above/below this row"
      const before = (e.clientY - rect.top) < (rect.height / 2);
      row.classList.add(before ? 'subtask-drag-over-before' : 'subtask-drag-over-after');
    }
  });
  row.addEventListener('dragleave', e => {
    if (!row.contains(e.relatedTarget)) {
      row.classList.remove('subtask-drag-over-before', 'subtask-drag-over-after', 'bn-drop-target-group');
    }
  });
  row.addEventListener('drop', e => {
    const movedId = bnDragSource.tid;
    const targetTid = row.dataset.tid;
    _clearDropIndicators();
    if (!movedId || !targetTid || movedId === targetTid) return;
    e.preventDefault();
    e.stopPropagation();
    // Cycle guard (defensive — dragover blocked these already).
    if (bnWouldCreateGroupCycle(movedId, targetTid)) return;
    const isGroup = row.classList.contains('is-group');
    const wrap = row.closest('.group-children, .card-group-children');
    const targetParentGid = wrap ? (wrap.dataset.gid || '') : '';
    const isSibling = (targetParentGid === bnDragSource.fromGroupId);
    let changed = false;
    if (isGroup && !isSibling) {
      // Move into the group represented by this row.
      changed = bnMoveTaskToGroup(movedId, targetTid);
    } else if (isSibling) {
      // Reorder within the same parent group.
      const parent = _bnTaskByIdSafe(targetParentGid);
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < (rect.height / 2);
      if (parent) changed = _bnReorderWithinGroup(parent, movedId, targetTid, before);
      else changed = false;
    } else {
      // Different parent groups, target is NOT a group → adopt the target's groupId.
      changed = bnMoveTaskToGroup(movedId, targetParentGid);
    }
    if (changed && typeof render === 'function') {
      try { render(); } catch (_) {}
    }
  });
}

// Wire a children-container (the wrapper that holds subtask rows for an
// expanded group) as a drop target. Empty-area drops fall through to "move
// into this group". Each row inside is wired as both drag source and drop
// target.
//
// Signature is back-compat: `bnWireSubtaskReorder(container, parent, rowSelector)`.
function bnWireSubtaskReorder(container, parent, rowSelector, opts) {
  if (!container || !parent) return;
  opts = opts || {};
  const rows = Array.from(container.querySelectorAll(':scope > ' + rowSelector));
  rows.forEach(row => { _wireDragSource(row); _wireDropTarget(row); });
  // Container-level dragover: highlight when hovering empty space; drop = move into parent.
  if (!container._bnContWired) {
    container._bnContWired = true;
    container.addEventListener('dragover', e => {
      const movedId = bnDragSource.tid;
      if (!movedId) return;
      // Only react if the hover is over the container background (not over a row).
      if (e.target !== container) return;
      if (parent && bnWouldCreateGroupCycle(movedId, parent.id)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      _clearDropIndicators();
      container.classList.add('bn-drop-target-group');
    });
    container.addEventListener('dragleave', e => {
      if (!container.contains(e.relatedTarget)) {
        container.classList.remove('bn-drop-target-group');
      }
    });
    container.addEventListener('drop', e => {
      const movedId = bnDragSource.tid;
      _clearDropIndicators();
      if (!movedId) return;
      // Skip if a row inside already handled this drop.
      if (e.defaultPrevented) return;
      if (e.target !== container && container.contains(e.target)) return;
      e.preventDefault();
      if (!parent || parent.id === movedId) return;
      if (bnWouldCreateGroupCycle(movedId, parent.id)) return;
      const changed = bnMoveTaskToGroup(movedId, parent.id);
      if (changed && typeof render === 'function') {
        try { render(); } catch (_) {}
      }
    });
  }
}
window.bnWireSubtaskReorder = bnWireSubtaskReorder;

// Wire any top-level group row inside `scope` as a drop target. Lets users
// drag a subtask out of one group and drop it onto the row of another
// top-level group without that target group having to be expanded.
function bnWireTopLevelGroupDropTargets(scope, rowSelector) {
  if (!scope) return;
  const groupRows = Array.from(scope.querySelectorAll(rowSelector + '.is-group'));
  groupRows.forEach(row => _wireDropTarget(row));
}
window.bnWireTopLevelGroupDropTargets = bnWireTopLevelGroupDropTargets;

// Make EVERY task row in `scope` a drag source so users can pick up not just
// expanded-group children but also top-level orphans / collapsed groups.
function bnWireAllRowsAsDragSources(scope, rowSelector) {
  if (!scope) return;
  Array.from(scope.querySelectorAll(rowSelector)).forEach(row => _wireDragSource(row));
}
window.bnWireAllRowsAsDragSources = bnWireAllRowsAsDragSources;
