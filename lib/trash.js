// =============================================================================
// lib/trash.js
// ---------------------------------------------------------------------------
// Soft-delete (Trash) for tasks. Deleted tasks live in STORE._trash with
// deletion metadata; restore puts them back into STORE.tasks; permanent
// delete drops them.  The Trash view (bnRenderTrashPage) lives here too —
// the central render() dispatcher calls it with a typeof guard.
//
// Loaded AFTER inline. References STORE / saveStore / render through the
// shared classic-script scope at runtime (all callers fire from event
// handlers or the render() dispatcher, never at parse time).
// =============================================================================

// ===== Trash (soft-delete) =====
// Soft-deleted tasks live in STORE._trash with _deletedAt + (a copy of) original fields.
// They are removed from STORE.tasks so existing render code doesn't see them.
// The Trash view lists them with Restore / Delete-permanently actions.

function bnSoftDeleteTask(t) {
  if (!t || !t.id) return;
  if (!STORE || !Array.isArray(STORE.tasks)) return; // defensive: never crash if STORE.tasks missing
  if (!Array.isArray(STORE._trash)) STORE._trash = [];
  // Clone the task with deletion metadata
  const snapshot = Object.assign({}, t, {
    _deletedAt: new Date().toISOString(),
    _deletedAtMs: Date.now(),
  });
  STORE._trash.unshift(snapshot);  // most recent first
  // Remove from STORE.tasks (note: caller is responsible for saveStore so batch deletes
  // don't write to localStorage on every iteration).
  STORE.tasks = STORE.tasks.filter(x => x.id !== t.id);
}

function bnRestoreFromTrash(taskId) {
  if (!Array.isArray(STORE._trash)) return false;
  const idx = STORE._trash.findIndex(x => x.id === taskId);
  if (idx < 0) return false;
  const t = STORE._trash[idx];
  // If a task with the same id was created since deletion, abort
  if (STORE.tasks.some(x => x.id === t.id)) {
    alert("Cannot restore: an active task with id " + t.id + " already exists.");
    return false;
  }
  // Strip deletion metadata
  const restored = Object.assign({}, t);
  delete restored._deletedAt;
  delete restored._deletedAtMs;
  STORE._trash.splice(idx, 1);
  STORE.tasks.push(restored);
  saveStore(STORE);
  if (typeof render === 'function') try { render(); } catch (_) {}
  return true;
}

function bnPermanentlyDelete(taskId) {
  if (!Array.isArray(STORE._trash)) return false;
  const idx = STORE._trash.findIndex(x => x.id === taskId);
  if (idx < 0) return false;
  const t = STORE._trash[idx];
  if (!confirm("Permanently delete '" + (t.subject || t.id) + "'?\n\nThis CANNOT be undone (except by rolling back to a snapshot in localStorage).")) return false;
  STORE._trash.splice(idx, 1);
  saveStore(STORE);
  if (typeof render === 'function') try { render(); } catch (_) {}
  return true;
}

function bnEmptyTrash() {
  if (!Array.isArray(STORE._trash) || STORE._trash.length === 0) return;
  if (!confirm("Permanently delete ALL " + STORE._trash.length + " items in Trash?\n\nThis CANNOT be undone (except by rolling back to a snapshot).")) return;
  STORE._trash = [];
  saveStore(STORE);
  if (typeof render === 'function') try { render(); } catch (_) {}
}

function bnRenderTrashPage() {
  const container = document.getElementById('bnTrashContent');
  if (!container) return;
  const trash = Array.isArray(STORE._trash) ? STORE._trash : [];
  if (trash.length === 0) {
    container.innerHTML =
      '<div class="bn-trash-empty">' +
      '<div style="font-size:48px; margin-bottom:12px;">🗑️</div>' +
      '<div style="font-weight:600; color:#6b6b6b; margin-bottom:4px;">Trash is empty</div>' +
      '<div style="font-size:12px; color:#9a9a9a;">When you delete a task it lands here and you can restore it.</div>' +
      '</div>';
    return;
  }

  const esc = s => String(s || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  const fmtDate = iso => {
    try { const d = new Date(iso); return d.toLocaleString(); } catch (_) { return iso || ''; }
  };

  let html = '';
  html += '<div class="bn-trash-toolbar">';
  html += '<span class="count"><strong>' + trash.length + '</strong> deleted item' + (trash.length===1?'':'s') + '</span>';
  html += '<span class="spacer"></span>';
  html += '<button class="btn danger" id="bnEmptyTrashBtn" title="Permanently delete all items in Trash">Empty trash</button>';
  html += '</div>';

  html += '<div class="bn-trash-table">';
  html += '<div class="bn-trash-row header">' +
          '<div>Subject</div>' +
          '<div>Type</div>' +
          '<div>Status</div>' +
          '<div>Deleted</div>' +
          '<div style="text-align:right;">Actions</div>' +
          '</div>';
  for (const t of trash) {
    const isGroup = !!t.isGroup;
    const subj = esc(t.subject || '(no subject)');
    const groupCls = isGroup ? ' is-group' : '';
    html += '<div class="bn-trash-row" data-id="' + esc(t.id) + '">' +
            '<div class="subj' + groupCls + '" title="' + esc(t.id) + '">' + subj + '</div>' +
            '<div class="meta">' + esc(t.type || '—') + '</div>' +
            '<div class="meta">' + esc(t.slackStatus || '—') + '</div>' +
            '<div class="meta" title="' + esc(t._deletedAt || '') + '">' + esc(fmtDate(t._deletedAt)) + '</div>' +
            '<div class="actions">' +
            '<button class="restore" data-action="restore" data-id="' + esc(t.id) + '">Restore</button>' +
            '<button class="permanent" data-action="permanent" data-id="' + esc(t.id) + '">Delete forever</button>' +
            '</div>' +
            '</div>';
  }
  html += '</div>';

  container.innerHTML = html;

  // Wire actions
  const empty = document.getElementById('bnEmptyTrashBtn');
  if (empty) empty.addEventListener('click', bnEmptyTrash);
  container.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (action === 'restore') bnRestoreFromTrash(id);
      else if (action === 'permanent') bnPermanentlyDelete(id);
    });
  });
}

