// =============================================================================
// lib/roadmap-task-modal.js
// ---------------------------------------------------------------------------
// "Roadmaps assignment inside Task modal" — the per-roadmap dates rows that
// appear when you open a task and want to see/edit which roadmaps it's in
// (and its start/end inside each).
//
//   renderRoadmapsInModal(t)   — builds the list of roadmap rows in the modal
//   roadmapOwnerAvatarHtml(rm) — small 18px owner avatar used in roadmap pills
//
// Loaded AFTER inline. References STORE / findRoadmap / getRoadmaps /
// parseDate / addDays / dateKey / etc. through the shared classic-script
// scope at runtime — these helpers all live in inline and are accessed via
// window when these functions fire from openModal().
// =============================================================================

// ---- Roadmaps assignment inside Task modal ----
function renderRoadmapsInModal(t) {
  const cont = document.getElementById("f_roadmapsContainer");
  // sel is now a hidden input; the picker chip/dropdown drive Add-to-roadmap.
  const sel = document.getElementById("f_addRoadmapSel");
  if (!cont) return;
  const allRoadmaps = (typeof getRoadmaps === 'function') ? getRoadmaps() : [];
  const assigned = allRoadmaps.filter(r => (r.tasks || []).some(e => e.taskId === t.id))
    .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  // Source labels per row. Persisted on the entry (entry.startSrcLabel / entry.endSrcLabel) so
  // they survive Save + reopen. Also mirrored to a transient in-memory cache for fast reads.
  if (!window.__rmRowSrc) window.__rmRowSrc = {};
  function srcKey(rmId, side) { return t.id + '|' + rmId + '|' + side; }
  function entryForRm(rmId) {
    const rm = findRoadmap(rmId);
    if (!rm) return null;
    return (rm.tasks || []).find(en => en.taskId === t.id) || null;
  }
  function getRowSrc(rmId, side) {
    // Read from entry first (persisted source); fall back to the transient cache.
    const e = entryForRm(rmId);
    if (e) {
      const k = side === 'start' ? 'startSrcLabel' : 'endSrcLabel';
      if (e[k]) return e[k];
      // Fallback: derive from per-roadmap anchor if it was set via the calendar's pin picker.
      const derived = bnDeriveSrcLabel(e, side);
      if (derived) return derived;
    }
    return window.__rmRowSrc[srcKey(rmId, side)] || '';
  }
  function setRowSrc(rmId, side, lbl) {
    const e = entryForRm(rmId);
    if (e) {
      const kLbl = side === 'start' ? 'startSrcLabel' : 'endSrcLabel';
      const kTid = side === 'start' ? 'startSrcTaskId' : 'endSrcTaskId';
      if (lbl) e[kLbl] = lbl;
      else { delete e[kLbl]; delete e[kTid]; }
    }
    // Keep the transient cache in sync (mostly for clarity; the entry is canonical now).
    if (lbl) window.__rmRowSrc[srcKey(rmId, side)] = lbl;
    else delete window.__rmRowSrc[srcKey(rmId, side)];
  }
  if (assigned.length === 0) {
    cont.innerHTML = '<span style="color:#9a9a9a; font-size:12px">Not in any roadmap</span>';
  } else {
    // Each roadmap chip is now JUST the link + × delete. Dates are task-level (set above in the
    // "Apply to all roadmaps" component) and shared across every assigned roadmap, so there's no
    // longer any per-roadmap date editor here.
    cont.innerHTML = '<div class="rm-modal-list">' + assigned.map(r => {
      return '<div class="rm-modal-row" data-rmid="' + escapeHtml(r.id) + '">' +
        '<button type="button" class="rm-modal-link" data-rmid="' + escapeHtml(r.id) + '" title="Open this roadmap">' +
          roadmapOwnerAvatarHtml(r, 18) +
          '<span>' + escapeHtml(r.name || '(unnamed)') + '</span>' +
        '</button>' +
        '<button type="button" class="rm-modal-x" data-rmid="' + escapeHtml(r.id) + '" title="Remove from this roadmap">×</button>' +
      '</div>';
    }).join('') + '</div>';
    // Click on roadmap name → navigate to roadmaps page with that roadmap selected
    cont.querySelectorAll('.rm-modal-link').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const rmId = btn.dataset.rmid;
        if (!rmId) return;
        if (typeof closeModal === 'function') closeModal();
        selectedRoadmapTimelineId = rmId;
        localStorage.setItem("bookline-selectedRoadmap", rmId);
        if (typeof switchView === 'function') switchView('roadmaps');
      });
    });
    // Helper: find entry for a given roadmap row
    function entryFor(rmId) {
      const rm = findRoadmap(rmId);
      if (!rm) return { rm: null, entry: null };
      const entry = (rm.tasks || []).find(en => en.taskId === t.id);
      return { rm, entry };
    }
    // Recompute end from start + (durationDays − 1)
    function recomputeEndFromDays(rmId) {
      const { entry } = entryFor(rmId);
      if (!entry) return;
      const n = entry.durationDays;
      if (typeof n !== 'number' || n < 1 || !entry.startDate) return;
      const newEnd = bnEndFromStartAndDuration(entry.startDate, n);
      if (newEnd) {
        entry.endDate = newEnd;
        entry.endAnchor = '';
      }
    }
    // Date inputs — editable per-roadmap; saving an explicit date clears any anchor on that side
    cont.querySelectorAll('.rm-modal-start').forEach(inp => {
      inp.addEventListener('change', () => {
        const rmId = inp.dataset.rmid;
        const { entry } = entryFor(rmId);
        if (!entry) return;
        entry.startDate = inp.value || '';
        if (entry.startAnchor) entry.startAnchor = '';
        setRowSrc(rmId, 'start', '');
        // If duration is set, recompute end (chip "N days" remains)
        if (entry.durationDays) recomputeEndFromDays(rmId);
        saveAndSyncTaskDates();
        renderRoadmapsInModal(t);
      });
    });
    cont.querySelectorAll('.rm-modal-end').forEach(inp => {
      inp.addEventListener('change', () => {
        const rmId = inp.dataset.rmid;
        const { entry } = entryFor(rmId);
        if (!entry) return;
        entry.endDate = inp.value || '';
        if (entry.endAnchor) entry.endAnchor = '';
        // Manual end edit clears duration AND end source chip
        delete entry.durationDays;
        setRowSrc(rmId, 'end', '');
        saveAndSyncTaskDates();
        renderRoadmapsInModal(t);
      });
    });
    // Duration days — drives end = start + (N − 1) days. Empty → clears stored days + end.
    cont.querySelectorAll('.rm-modal-days').forEach(inp => {
      inp.addEventListener('change', () => {
        const rmId = inp.dataset.rmid;
        const { entry } = entryFor(rmId);
        if (!entry) return;
        const n = parseInt(inp.value, 10);
        if (!Number.isFinite(n) || n < 1) {
          delete entry.durationDays;
          // If end source chip was the "N days" label, clear the end too
          entry.endDate = '';
          entry.endAnchor = '';
          setRowSrc(rmId, 'end', '');
        } else {
          entry.durationDays = n;
          setRowSrc(rmId, 'end', '');  // days chip takes over (rendered from durationDays)
          if (entry.startDate) {
            const newEnd = bnEndFromStartAndDuration(entry.startDate, n);
            if (newEnd) {
              entry.endDate = newEnd;
              entry.endAnchor = '';
            }
          }
        }
        saveAndSyncTaskDates();
        renderRoadmapsInModal(t);
      });
    });
    // Pin buttons → pick another task's aggregated start/end, fill date input behind, show source chip
    cont.querySelectorAll('.rm-modal-pin').forEach(pin => {
      pin.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const rmId = pin.dataset.rmid;
        const side = pin.dataset.side;
        bnOpenAggregatedPicker(pin, t.id, side, (absDate, label, srcTaskId) => {
          const { entry } = entryFor(rmId);
          if (!entry) return;
          if (side === 'start') {
            entry.startDate = absDate;
            entry.startAnchor = '';
            if (srcTaskId) entry.startSrcTaskId = srcTaskId;
            else delete entry.startSrcTaskId;
            setRowSrc(rmId, 'start', label);
            if (entry.durationDays) recomputeEndFromDays(rmId);
          } else {
            entry.endDate = absDate;
            entry.endAnchor = '';
            delete entry.durationDays;
            if (srcTaskId) entry.endSrcTaskId = srcTaskId;
            else delete entry.endSrcTaskId;
            setRowSrc(rmId, 'end', label);
          }
          saveAndSyncTaskDates();
          renderRoadmapsInModal(t);
        });
      });
    });
    // Clicking ANYWHERE on the pill (or on the resolved-date row below) clears the source for that
    // side and restores the date input — so the user can pick a date directly. The underlying date
    // value is preserved (it remains in entry.startDate / entry.endDate), so the date input loads
    // with that value pre-filled. For end-via-days, clearing also drops entry.durationDays.
    function clearSideSource(rmId, side) {
      const { entry } = entryFor(rmId);
      if (!entry) return;
      setRowSrc(rmId, side, '');
      // End cleared while duration-driven? Drop the duration so the date input takes over.
      if (side === 'end' && entry.durationDays) delete entry.durationDays;
      saveAndSyncTaskDates();
      renderRoadmapsInModal(t);
    }
    cont.querySelectorAll('.rm-modal-pill-btn').forEach(pill => {
      pill.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        clearSideSource(pill.dataset.rmid, pill.dataset.side);
      });
    });
    cont.querySelectorAll('.rm-modal-date-display').forEach(disp => {
      disp.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        clearSideSource(disp.dataset.rmid, disp.dataset.side);
      });
    });
    cont.querySelectorAll('.rm-modal-x').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const rmId = btn.dataset.rmid;
        const rm = findRoadmap(rmId);
        if (!rm) return;
        rm.tasks = (rm.tasks || []).filter(entry => entry.taskId !== t.id);
        saveAndSyncTaskDates();
        renderRoadmapsInModal(t);
      });
    });
  }
  // Fill the picker (chip + dropdown) with un-assigned roadmaps (alphabetical)
  const unassigned = allRoadmaps.filter(r => !assigned.some(a => a.id === r.id))
    .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const chip = document.getElementById('f_addRoadmapChip');
  const dd = document.getElementById('f_addRoadmapDropdown');
  const inp = document.getElementById('f_addRoadmapInput');
  const list = document.getElementById('f_addRoadmapList');
  if (chip && dd && inp && list) {
    if (unassigned.length === 0) {
      chip.style.opacity = '0.5';
      chip.style.cursor = 'not-allowed';
      chip.textContent = '+ No more roadmaps to add';
    } else {
      chip.style.opacity = '';
      chip.style.cursor = '';
      chip.textContent = '+ Add to roadmap…';
    }
    function _rmAddRenderList(query) {
      const q = (query || '').trim().toLowerCase();
      const cands = unassigned.filter(r => !q || (r.name || '').toLowerCase().includes(q));
      if (cands.length === 0) {
        list.innerHTML = '<div class="rm-add-empty-state">No matches</div>';
      } else {
        list.innerHTML = cands.map(r => {
          const owner = (typeof roadmapOwnerAvatarHtml === 'function') ? roadmapOwnerAvatarHtml(r, 18) : '';
          return '<div class="rm-add-item" data-rmid="' + escapeHtml(r.id) + '">' +
            owner +
            '<span class="rm-add-item-name">' + escapeHtml(r.name || '(unnamed)') + '</span>' +
            '</div>';
        }).join('');
        list.querySelectorAll('.rm-add-item').forEach(it => {
          it.addEventListener('mousedown', e => e.preventDefault());
          it.addEventListener('click', () => {
            const rmId = it.dataset.rmid;
            const rm = findRoadmap(rmId);
            if (!rm) return;
            if (!Array.isArray(rm.tasks)) rm.tasks = [];
            if (!rm.tasks.some(e => e.taskId === t.id)) {
              const newEntry = { taskId: t.id };
              if (t.startDate) newEntry.startDate = t.startDate;
              if (t.endDate)   newEntry.endDate   = t.endDate;
              rm.tasks.push(newEntry);
              saveAndSyncTaskDates();
            }
            dd.style.display = 'none';
            renderRoadmapsInModal(t);
          });
        });
      }
    }
    // Reset state for this open
    inp.value = '';
    dd.style.display = 'none';
    chip.onclick = (e) => {
      if (unassigned.length === 0) return;
      if (dd.style.display === 'none' || !dd.style.display) {
        dd.style.display = '';
        inp.value = '';
        _rmAddRenderList('');
        inp.focus();
      } else {
        dd.style.display = 'none';
      }
    };
    chip.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } };
    inp.oninput = () => _rmAddRenderList(inp.value);
    inp.onkeydown = (e) => { if (e.key === 'Escape') { dd.style.display = 'none'; chip.focus(); } };
    if (!chip.__bnOutsideWired) {
      chip.__bnOutsideWired = true;
      document.addEventListener('click', (e) => {
        const box = document.getElementById('f_addRoadmapBox');
        if (!box) return;
        if (!box.contains(e.target)) dd.style.display = 'none';
      });
    }
  }
  // After every render, also refresh the aggregated visual (pills + dates) so it stays in sync.
  if (typeof window.__renderTaskAggregatedSchedule === 'function') {
    window.__renderTaskAggregatedSchedule(t);
  }
}

// Small avatar (18px) for a roadmap owner — used wherever we previously showed 📍.
function roadmapOwnerAvatarHtml(roadmap, size) {
  const px = (typeof size === 'number') ? size : 18;
  const owner = roadmap && roadmap.responsibleId ? findPerson(roadmap.responsibleId) : null;
  if (!owner) {
    // Fallback to a neutral folder/dot when there's no owner
    return '<span class="rm-owner-mini empty" style="width:' + px + 'px; height:' + px + 'px; font-size:' + Math.max(8, px - 8) + 'px">·</span>';
  }
  const fontSize = Math.max(8, px - 10);
  return '<span class="rm-owner-mini avatar" title="' + escapeHtml(owner.displayName || owner.name || '') + '" style="width:' + px + 'px; height:' + px + 'px; background:' + (owner.color || '#9a9a9a') + '; font-size:' + fontSize + 'px">' +
    (owner.photo ? '<img src="' + escapeHtml(owner.photo) + '" alt="" onerror="this.remove()">' : '') +
    '<span class="ini">' + escapeHtml(initials(owner.name || '')) + '</span>' +
  '</span>';
}

