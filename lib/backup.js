// =============================================================================
// lib/backup.js
// ---------------------------------------------------------------------------
// Local backup + restore for the in-browser STORE:
//
//   • bnRotateAutoSnapshot — rotating snapshots in localStorage (3 slots)
//   • bnExportBackup       — downloads a JSON of STORE for the user
//   • bnImportBackupClick  — file-picker → bnShowImportPreview
//   • bnShowImportPreview  — diff modal before applying the import
//
// Loaded AFTER inline. References STORE / saveStore / render through the
// shared classic-script scope at runtime.  Inline's bnInitBackupUI wires
// the buttons + calls bnRotateAutoSnapshot in setTimeout(0) so this script
// is available by then.
// =============================================================================

// ===== Rolling auto-snapshots =====
// Keeps up to BN_AUTO_SNAP_KEEP previous STORE versions in localStorage under
// bn-auto-snapshot-{1..N}. #1 = most recent, #N = oldest. Each has a sibling
// "-meta" key with timestamp + counts. Safe against quota errors.
function bnRotateAutoSnapshot(reason) {
  try {
    const cur = localStorage.getItem(STORE_KEY);
    if (!cur) return;
    // Skip if identical to most recent snapshot
    const top = localStorage.getItem(BN_AUTO_SNAP_PREFIX + "1");
    if (top === cur) return;
    // Shift older snapshots down (oldest dropped)
    for (let i = BN_AUTO_SNAP_KEEP; i >= 2; i--) {
      const prevK = BN_AUTO_SNAP_PREFIX + (i - 1);
      const dstK = BN_AUTO_SNAP_PREFIX + i;
      const prev = localStorage.getItem(prevK);
      if (prev !== null) { try { localStorage.setItem(dstK, prev); } catch (_) {} }
      else localStorage.removeItem(dstK);
      const prevMeta = localStorage.getItem(prevK + "-meta");
      if (prevMeta !== null) { try { localStorage.setItem(dstK + "-meta", prevMeta); } catch (_) {} }
      else localStorage.removeItem(dstK + "-meta");
    }
    try { localStorage.setItem(BN_AUTO_SNAP_PREFIX + "1", cur); }
    catch (_) { return; }
    let counts = null;
    try {
      const p = JSON.parse(cur);
      counts = {
        tasks: (p.tasks || []).length,
        groups: (p.tasks || []).filter(t => t.isGroup).length,
        children: (p.tasks || []).filter(t => t.groupId).length,
        roadmaps: (p.roadmaps || []).length,
        tags: (p.tagLibrary || []).length,
      };
    } catch (_) {}
    try {
      localStorage.setItem(BN_AUTO_SNAP_PREFIX + "1-meta", JSON.stringify({
        capturedAt: new Date().toISOString(),
        reason: reason || "auto",
        sizeBytes: cur.length,
        counts: counts,
        schema: (counts ? "2.0" : "?"),
      }));
    } catch (_) {}
  } catch (_) {}
}

// ===== Export Backup =====
function bnExportBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const payload = {
    __exported_at: new Date().toISOString(),
    __schema_version: (STORE && STORE.__schema_version) || BN_SCHEMA_VERSION,
    __app: "team-navigator",
    __origin: location.origin,
    __counts: {
      tasks: (STORE.tasks || []).length,
      groups: (STORE.tasks || []).filter(t => t.isGroup).length,
      children: (STORE.tasks || []).filter(t => t.groupId).length,
      roadmaps: (STORE.roadmaps || []).length,
      tagLibrary: (STORE.tagLibrary || []).length,
      taskTagLibrary: (STORE.taskTagLibrary || []).length,
      personSettings: Object.keys(STORE.personSettings || {}).length,
      personTags: Object.keys(STORE.personTags || {}).length,
    },
    store: STORE,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bn-backup-${ts}.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { a.remove(); } catch (_) {} URL.revokeObjectURL(url); }, 2000);
  console.log('[backup] exported', a.download, payload.__counts);
}

// ===== Import Backup with preview + diff =====
function bnImportBackupClick() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  input.onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    let text;
    try { text = await file.text(); }
    catch (err) { alert('Error reading file: ' + err.message); return; }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (err) { alert('Invalid JSON: ' + err.message); return; }
    const newStore = (parsed && parsed.store && typeof parsed.store === 'object') ? parsed.store : parsed;
    if (!newStore || !Array.isArray(newStore.tasks) || !Array.isArray(newStore.roadmaps)) {
      alert("Doesn't look like a valid backup (missing tasks or roadmaps).");
      return;
    }
    bnShowImportPreview(newStore, file.name, parsed);
  };
  document.body.appendChild(input);
  input.click();
  setTimeout(() => { try { input.remove(); } catch (_) {} }, 5000);
}

function bnShowImportPreview(newStore, fileName, fullPayload) {
  const cur = STORE || { tasks: [], roadmaps: [], tagLibrary: [], taskTagLibrary: [], personSettings: {}, personTags: {} };
  const curIds = new Set((cur.tasks || []).map(t => t.id));
  const newIds = new Set((newStore.tasks || []).map(t => t.id));
  let onlyCur = 0, onlyNew = 0, common = 0;
  for (const id of curIds) { if (!newIds.has(id)) onlyCur++; else common++; }
  for (const id of newIds) { if (!curIds.has(id)) onlyNew++; }

  const rows = [
    ['Tasks total',         (cur.tasks || []).length,                              (newStore.tasks || []).length],
    ['Groups (isGroup)',    (cur.tasks || []).filter(t => t.isGroup).length,       (newStore.tasks || []).filter(t => t.isGroup).length],
    ['Children (groupId)',  (cur.tasks || []).filter(t => t.groupId).length,       (newStore.tasks || []).filter(t => t.groupId).length],
    ['Roadmaps',            (cur.roadmaps || []).length,                            (newStore.roadmaps || []).length],
    ['tagLibrary',          (cur.tagLibrary || []).length,                          (newStore.tagLibrary || []).length],
    ['taskTagLibrary',      (cur.taskTagLibrary || []).length,                      (newStore.taskTagLibrary || []).length],
    ['personSettings',      Object.keys(cur.personSettings || {}).length,           Object.keys(newStore.personSettings || {}).length],
    ['personTags',          Object.keys(cur.personTags || {}).length,               Object.keys(newStore.personTags || {}).length],
  ];

  const rowsHTML = rows.map(([label, a, b]) => {
    const changed = a !== b;
    return `<div class="bn-bup-diff-row${changed ? ' changed' : ''}">
      <div class="label">${label}</div>
      <div class="v cur">${a}</div>
      <div class="v new"><span class="arrow">→</span>${b}</div>
    </div>`;
  }).join('');

  const meta = (fullPayload && fullPayload.__exported_at) ?
    `<div class="bn-bup-info">Exported: ${fullPayload.__exported_at}${fullPayload.__schema_version ? ' · schema ' + fullPayload.__schema_version : ''}${fullPayload.__origin ? ' · ' + fullPayload.__origin : ''}</div>` : '';

  const safeName = String(fileName).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  const modal = document.createElement('div');
  modal.className = 'bn-bup-modal';
  modal.id = 'bnImportPreviewModal';
  modal.innerHTML = `
    <div class="bn-bup-modal-content">
      <h2>Import Backup — Preview</h2>
      <div class="bn-bup-info">File: <strong>${safeName}</strong></div>
      ${meta}
      <div style="margin:14px 0;">${rowsHTML}</div>
      <div class="bn-bup-warning">
        <strong>Task ID diff:</strong> ${common} shared · <strong>${onlyCur}</strong> only in CURRENT (would be lost) · <strong>${onlyNew}</strong> only in IMPORT (would be added)
      </div>
      <div class="bn-bup-info">
        Before importing, an auto-snapshot of your CURRENT data will be saved to <code>localStorage["${BN_AUTO_SNAP_PREFIX}1"]</code> for rollback.
      </div>
      <div class="bn-bup-modal-actions">
        <button class="btn" id="bnImportCancelBtn">Cancel</button>
        <button class="btn primary" id="bnImportConfirmBtn" style="background:#dc2626;border-color:#dc2626;">Replace my data</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const cancelBtn = document.getElementById('bnImportCancelBtn');
  const confirmBtn = document.getElementById('bnImportConfirmBtn');
  cancelBtn.onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  confirmBtn.onclick = () => {
    const phrase = prompt('To confirm replacing your data, type IMPORT:');
    if (phrase !== 'IMPORT') { modal.remove(); return; }
    try {
      bnRotateAutoSnapshot('pre-import');
      STORE = newStore;
      if (!STORE.__schema_version) STORE.__schema_version = BN_SCHEMA_VERSION;
      saveStore(STORE);
      modal.remove();
      if (typeof render === 'function') { try { render(); } catch (_) {} }
      alert('Backup imported. Previous version preserved in bn-auto-snapshot-1 for rollback.');
    } catch (err) {
      alert('Error applying import: ' + err.message + '\nNothing was changed.');
      console.error('[import] failed', err);
    }
  };
}

// ===== Rollback helper (exposed in console) =====
window.bnRollbackToSnapshot = function(n) {
  n = n || 1;
  const k = BN_AUTO_SNAP_PREFIX + n;
  const v = localStorage.getItem(k);
  if (!v) return 'No snapshot at ' + k;
  if (!confirm('This will replace your current data with snapshot ' + k + '. Are you sure?')) return 'aborted';
  // Save current to bn-auto-snapshot-0 (rescue) before rollback
  const cur = localStorage.getItem(STORE_KEY);
  if (cur) localStorage.setItem(BN_AUTO_SNAP_PREFIX + '0', cur);
  localStorage.setItem(STORE_KEY, v);
  location.reload();
  return 'rolling back...';
};

window.bnListSnapshots = function() {
  const out = [];
  for (let i = 0; i <= BN_AUTO_SNAP_KEEP; i++) {
    const v = localStorage.getItem(BN_AUTO_SNAP_PREFIX + i);
    const m = localStorage.getItem(BN_AUTO_SNAP_PREFIX + i + "-meta");
    if (v) {
      let meta = null; try { meta = JSON.parse(m); } catch (_) {}
      out.push({ slot: i, sizeBytes: v.length, meta: meta });
    }
  }
  console.table(out.map(s => ({ slot: s.slot, sizeKB: Math.round(s.sizeBytes / 1024), capturedAt: s.meta && s.meta.capturedAt, reason: s.meta && s.meta.reason, tasks: s.meta && s.meta.counts && s.meta.counts.tasks, roadmaps: s.meta && s.meta.counts && s.meta.counts.roadmaps })));
  return out;
};

