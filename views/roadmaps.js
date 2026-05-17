// =============================================================================
// views/roadmaps.js
// ---------------------------------------------------------------------------
// "Roadmaps" tab: the Gantt timeline view of each roadmap (renderGantt) plus
// the page wrapper (renderRoadmapsTimelinePage) which is then reassigned to
// route through renderRoadmapCalendar (kept in inline because of its deep
// dependencies on date helpers and anchors).
//
// Loaded AFTER the inline app script. The function declarations end up on
// the shared classic-script scope (= window). The inline render() dispatcher
// guards renderRoadmapsTimelinePage() with typeof.
//
// Things deliberately NOT moved here: parseDate, addDays, DAY_MS — those are
// utility helpers used in many other places and must stay accessible from
// inline at parse-time.
// =============================================================================

// ---- renderRoadmapsTimelinePage (original; reassigned below) ----
function renderRoadmapsTimelinePage() {
  const sel = document.getElementById("rmSelector");
  const cont = document.getElementById("rmPageContent");
  const rms = getRoadmaps();
  if (rms.length === 0) {
    sel.innerHTML = "";
    cont.innerHTML = '<div class="rm-empty">No roadmaps yet. Click "+ New roadmap" to create one.</div>';
    return;
  }
  // Selector pills
  if (!selectedRoadmapTimelineId || !rms.some(r => r.id === selectedRoadmapTimelineId)) {
    selectedRoadmapTimelineId = rms[0].id;
    localStorage.setItem("bookline-selectedRoadmap", selectedRoadmapTimelineId);
  }
  sel.innerHTML = rms.map(r => {
    const cnt = (r.tasks || []).length;
    return '<div class="rm-tab ' + (selectedRoadmapTimelineId === r.id ? "active" : "") + '" data-rm="' + r.id + '" draggable="true" title="Drag to reorder · click to select" role="button" tabindex="0">' + escapeHtml(r.name||"(unnamed)") + ' <span style="opacity:.7">(' + cnt + ')</span></div>';
  }).join("");
  sel.querySelectorAll(".rm-tab").forEach(node => {
    node.addEventListener("click", e => {
      // Avoid select-on-drop confusion: ignore if a drag just ended
      if (node.dataset.justDragged === "1") { delete node.dataset.justDragged; return; }
      selectedRoadmapTimelineId = node.dataset.rm;
      localStorage.setItem("bookline-selectedRoadmap", selectedRoadmapTimelineId);
      renderRoadmapsTimelinePage();
    });
    // Drag-to-reorder
    node.addEventListener("dragstart", e => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", node.dataset.rm);
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", () => {
      node.classList.remove("dragging");
      // Mark as just dragged so the click handler doesn't fire selection
      node.dataset.justDragged = "1";
      setTimeout(() => { delete node.dataset.justDragged; }, 100);
      sel.querySelectorAll(".rm-tab").forEach(n => n.classList.remove("drop-before","drop-after"));
    });
    node.addEventListener("dragover", e => {
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      const isAfter = (e.clientX - rect.left) > rect.width / 2;
      sel.querySelectorAll(".rm-tab").forEach(n => n.classList.remove("drop-before","drop-after"));
      node.classList.add(isAfter ? "drop-after" : "drop-before");
    });
    node.addEventListener("dragleave", () => {
      node.classList.remove("drop-before","drop-after");
    });
    node.addEventListener("drop", e => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData("text/plain");
      const targetId = node.dataset.rm;
      if (!draggedId || draggedId === targetId) return;
      const rect = node.getBoundingClientRect();
      const isAfter = (e.clientX - rect.left) > rect.width / 2;
      reorderRoadmap(draggedId, targetId, isAfter);
    });
  });
  renderGantt(selectedRoadmapTimelineId);
}

// ---- reorderRoadmap (helper for drag-reorder) ----
function reorderRoadmap(draggedId, targetId, dropAfter) {
  const arr = getRoadmaps();
  const fromIdx = arr.findIndex(r => r.id === draggedId);
  if (fromIdx < 0) return;
  const [moved] = arr.splice(fromIdx, 1);
  let toIdx = arr.findIndex(r => r.id === targetId);
  if (toIdx < 0) { arr.push(moved); }
  else {
    if (dropAfter) toIdx += 1;
    arr.splice(toIdx, 0, moved);
  }
  saveStore(STORE);
  renderRoadmapsTimelinePage();
}

// ---- renderGantt (per-roadmap timeline cell) ----
function renderGantt(roadmapId) {
  const cont = document.getElementById("rmPageContent");
  const r = findRoadmap(roadmapId);
  if (!r) { cont.innerHTML = ""; return; }
  const owner = findPerson(r.responsibleId);
  const tasks = (r.tasks || []).map(entry => ({
    entry,
    task: STORE.tasks.find(t => t.id === entry.taskId)
  })).filter(x => x.task);

  // Compute date range
  let rangeStart = parseDate(r.startDate);
  let rangeEnd = parseDate(r.endDate);
  tasks.forEach(({entry}) => {
    const s = parseDate(entry.startDate);
    const e = parseDate(entry.endDate);
    if (s && (!rangeStart || s < rangeStart)) rangeStart = s;
    if (e && (!rangeEnd || e > rangeEnd)) rangeEnd = e;
    if (s && (!rangeEnd || s > rangeEnd)) rangeEnd = s;
    if (e && (!rangeStart || e < rangeStart)) rangeStart = e;
  });
  // Default range if nothing set
  if (!rangeStart || !rangeEnd) {
    const today = new Date(); today.setHours(0,0,0,0);
    rangeStart = rangeStart || new Date(today.getTime() - 14*DAY_MS);
    rangeEnd = rangeEnd || new Date(today.getTime() + 60*DAY_MS);
  }
  // Pad a bit
  rangeStart = new Date(rangeStart.getTime() - 3*DAY_MS);
  rangeEnd = new Date(rangeEnd.getTime() + 3*DAY_MS);
  const totalDays = Math.max(1, Math.round((rangeEnd - rangeStart) / DAY_MS));
  // Adapt zoom: aim at min ~700px wide
  const pxPerDay = Math.max(6, Math.min(30, Math.round(900 / totalDays)));
  const totalWidth = totalDays * pxPerDay;

  // Summary card
  const dateRange = (r.startDate || r.endDate) ? (escapeHtml(r.startDate||"?") + " → " + escapeHtml(r.endDate||"?")) : "no dates";
  const completedCount = tasks.filter(({task}) => task.slackStatus === "Completed").length;
  const pct = tasks.length > 0 ? Math.round(100 * completedCount / tasks.length) : 0;
  let html = '<div class="rm-summary-card">';
  html += '<div><div class="rm-summary-name">' + escapeHtml(r.name||"(unnamed)") + '</div>' +
          '<div class="rm-summary-meta">' + (owner ? escapeHtml(owner.name) : "<em>no owner</em>") + ' &middot; ' + dateRange + ' &middot; ' + tasks.length + ' tasks &middot; ' + pct + '% complete</div></div>';
  html += '<div class="rm-summary-actions">' +
          '<button class="btn" id="rmEditBtn">Edit</button>' +
          '<button class="btn" id="rmAddTaskBtn">+ Assign Tasks</button>' +
          '<button class="btn danger" id="rmDeleteBtn">Delete</button>' +
          '</div>';
  html += '</div>';

  // Gantt
  const scheduled = tasks.filter(({entry}) => parseDate(entry.startDate) && parseDate(entry.endDate));
  const unscheduled = tasks.filter(({entry}) => !(parseDate(entry.startDate) && parseDate(entry.endDate)));
  // Time axis: month tick marks
  const monthTicks = [];
  let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  if (cursor < rangeStart) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor < rangeEnd) {
    const offsetDays = Math.round((cursor - rangeStart) / DAY_MS);
    const left = offsetDays * pxPerDay;
    const label = cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    monthTicks.push('<div class="gantt-month-tick" style="left:' + left + 'px">' + label + '</div>');
    cursor.setMonth(cursor.getMonth() + 1);
  }
  // Today line
  const today = new Date(); today.setHours(0,0,0,0);
  let todayLine = "";
  if (today >= rangeStart && today <= rangeEnd) {
    const offset = Math.round((today - rangeStart) / DAY_MS) * pxPerDay;
    todayLine = '<div class="gantt-today-line" style="left:' + offset + 'px"></div>';
  }

  // Status colors for bars
  const statusColors = {
    "Proposed": "#d1a300",
    "Under Review": "#b45309",
    "In Progress": "#2563eb",
    "Waiting": "#ea580c",
    "Later / Next": "#7c3aed",
    "Completed": "#16a34a",
    "Archived": "#92400e",
    "Discarded": "#64748b"
  };

  if (scheduled.length === 0 && unscheduled.length === 0) {
    html += '<div class="rm-empty">No tasks assigned to this roadmap yet. Click "+ Assign task".</div>';
  } else {
    html += '<div class="gantt-container">';
    if (scheduled.length > 0) {
      html += '<div class="gantt-time-axis" style="grid-template-columns: 220px ' + totalWidth + 'px">' +
              '<div class="gantt-corner">Task</div>' +
              '<div class="gantt-months" style="width:' + totalWidth + 'px">' + monthTicks.join("") + '</div>' +
              '</div>';
      scheduled.forEach(({entry, task}) => {
        const s = parseDate(entry.startDate);
        const e = parseDate(entry.endDate);
        const left = Math.max(0, Math.round((s - rangeStart) / DAY_MS) * pxPerDay);
        const width = Math.max(pxPerDay, Math.round(((e - s)/DAY_MS + 1) * pxPerDay));
        const color = statusColors[task.slackStatus] || "#1a1a1a";
        const owner = findPerson(task.responsibleId);
        const tooltipText = task.subject + " — " + (entry.startDate||"?") + " to " + (entry.endDate||"?") + (owner ? " ("+owner.displayName+")" : "");
        html += '<div class="gantt-row" data-tid="' + task.id + '" style="grid-template-columns: 220px ' + totalWidth + 'px">' +
                '<div class="gantt-task-label" title="' + escapeHtml(task.subject) + '">' + escapeHtml(task.subject) + '</div>' +
                '<div class="gantt-bar-area" style="width:' + totalWidth + 'px">' + todayLine +
                '<div class="gantt-bar" data-tid="' + task.id + '" title="' + escapeHtml(tooltipText) + '" style="left:' + left + 'px; width:' + width + 'px; background:' + color + '">' +
                  '<span class="bar-text">' + escapeHtml(task.subject) + '</span>' +
                '</div>' +
                '</div>' +
                '</div>';
      });
    }
    html += '</div>';
  }

  if (unscheduled.length > 0) {
    html += '<div class="rm-unscheduled"><strong style="font-size:13px">Unscheduled (' + unscheduled.length + ')</strong>' +
            '<div style="font-size:12px; color:#6b6b6b; margin:4px 0 8px">These tasks don\'t have both start and end dates set yet.</div>';
    unscheduled.forEach(({entry, task}) => {
      html += '<div class="rm-task-row" data-tid="' + task.id + '">' +
              '<span title="' + escapeHtml(task.subject) + '">' + escapeHtml(task.subject.slice(0,80)) + (task.subject.length>80?"...":"") + '</span>' +
              '<input type="date" class="rmt-start" value="' + escapeHtml(entry.startDate||"") + '" title="Start">' +
              '<input type="date" class="rmt-end" value="' + escapeHtml(entry.endDate||"") + '" title="End">' +
              '<button class="rm-task-del" data-tid="' + task.id + '" title="Remove">&times;</button>' +
              '</div>';
    });
    html += '</div>';
  }

  cont.innerHTML = html;

  // Wire up
  document.getElementById("rmEditBtn").addEventListener("click", () => openRoadmapEdit(roadmapId));
  document.getElementById("rmDeleteBtn").addEventListener("click", () => {
    if (!confirm("Delete '" + (r.name||"this roadmap") + "'?")) return;
    STORE.roadmaps = getRoadmaps().filter(x => x.id !== roadmapId);
    saveStore(STORE);
    selectedRoadmapTimelineId = null;
    renderRoadmapsTimelinePage();
  });
  document.getElementById("rmAddTaskBtn").addEventListener("click", () => openRoadmapEdit(roadmapId));

  cont.querySelectorAll(".gantt-bar").forEach(node => {
    node.addEventListener("click", () => openModal(node.dataset.tid));
  });
  cont.querySelectorAll(".gantt-task-label").forEach(node => {
    node.addEventListener("click", () => {
      const row = node.closest(".gantt-row");
      if (row) openModal(row.dataset.tid);
    });
  });
  cont.querySelectorAll(".rm-unscheduled .rm-task-row").forEach(node => {
    const tid = node.querySelector(".rm-task-del").dataset.tid;
    const idx = (r.tasks||[]).findIndex(e => e.taskId === tid);
    node.querySelector(".rmt-start").addEventListener("change", e => {
      if (idx >= 0) { r.tasks[idx].startDate = e.target.value; saveAndSyncTaskDates(); renderGantt(roadmapId); }
    });
    node.querySelector(".rmt-end").addEventListener("change", e => {
      if (idx >= 0) { r.tasks[idx].endDate = e.target.value; saveAndSyncTaskDates(); renderGantt(roadmapId); }
    });
    node.querySelector(".rm-task-del").addEventListener("click", () => {
      if (idx >= 0) { r.tasks.splice(idx, 1); saveStore(STORE); renderGantt(roadmapId); }
    });
  });
}

// ---- Reassignment: route renderRoadmapsTimelinePage to renderRoadmapCalendar ----
// Replace the existing renderGantt usage with the new calendar.
// The selector is now inline in the summary-card title — see renderRoadmapCalendar.
const _origRenderRoadmapsTimelinePage = renderRoadmapsTimelinePage;
renderRoadmapsTimelinePage = function() {
  const sel = document.getElementById("rmSelector");
  const cont = document.getElementById("rmPageContent");
  const rms = getRoadmaps();
  if (rms.length === 0) {
    if (sel) sel.innerHTML = "";
    cont.innerHTML = '<div class="rm-empty">No roadmaps yet. Click "+ New roadmap" to create one.</div>';
    return;
  }
  if (!selectedRoadmapTimelineId || !rms.some(r => r.id === selectedRoadmapTimelineId)) {
    selectedRoadmapTimelineId = rms[0].id;
    localStorage.setItem("bookline-selectedRoadmap", selectedRoadmapTimelineId);
  }
  // Hide the standalone selector strip — the picker now lives inline with the roadmap title
  if (sel) sel.innerHTML = "";
  renderRoadmapCalendar(selectedRoadmapTimelineId);
};

