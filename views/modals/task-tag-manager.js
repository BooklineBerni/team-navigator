// =============================================================================
// views/modals/task-tag-manager.js
// ---------------------------------------------------------------------------
// Task Tag Manager modal + global Tag Manager modal.
//
// Loaded AFTER inline. Wirings inside this block move together with their
// functions so DOM addEventListener calls resolve their references locally.
// References to STORE / TEAM / helpers resolve via the shared classic-script
// scope at runtime (when modal events fire).
// =============================================================================

// ---- Task Tag Manager modal ----
function openTaskTagManager() {
  renderTaskTagManager();
  document.getElementById("taskTagManagerBg").classList.add("show");
}
function closeTaskTagManager() {
  document.getElementById("taskTagManagerBg").classList.remove("show");
  render();
  updateBulkBar();
}
function renderTaskTagManager() {
  const list = document.getElementById("taskTagManagerList");
  const lib = getTaskTagLibrary();
  if (lib.length === 0) {
    list.innerHTML = '<div style="color:#9a9a9a; font-size:13px; padding:12px">No task tags. Create one below.</div>';
    return;
  }
  list.innerHTML = lib.map((t, i) => {
    return '<div class="tag-manager-row" draggable="true" data-name="' + escapeHtml(t.name) + '" data-idx="' + i + '">' +
      '<span class="drag-handle" title="Drag to reorder">&#9776;</span>' +
      '<input type="color" class="tm-bg" value="' + t.bg + '" title="Background color">' +
      '<input type="text" class="tm-name" value="' + escapeHtml(t.name) + '">' +
      '<input type="color" class="tm-fg" value="' + t.fg + '" title="Text color">' +
      '<span class="preview-pill" style="background:' + t.bg + ';color:' + t.fg + '">' + escapeHtml(t.name) + '</span>' +
      '<button class="del-tag" title="Delete tag">&times;</button>' +
    '</div>';
  }).join("");
  list.querySelectorAll(".tag-manager-row").forEach(row => {
    const oldName = row.dataset.name;
    const update = () => {
      const newName = row.querySelector(".tm-name").value.trim();
      const bg = row.querySelector(".tm-bg").value;
      const fg = row.querySelector(".tm-fg").value;
      if (!newName) return;
      const ok = updateTaskTagInLibrary(oldName, newName, bg, fg);
      if (ok) {
        const prev = row.querySelector(".preview-pill");
        prev.style.background = bg; prev.style.color = fg; prev.textContent = newName;
        row.dataset.name = newName;
      }
    };
    row.querySelector(".tm-bg").addEventListener("input", update);
    row.querySelector(".tm-fg").addEventListener("input", update);
    row.querySelector(".tm-name").addEventListener("change", update);
    row.querySelector(".del-tag").addEventListener("click", () => {
      const cur = row.dataset.name;
      const inUse = STORE.tasks.filter(t => Array.isArray(t.taskTags) && t.taskTags.includes(cur)).length;
      const msg = inUse > 0
        ? "This task tag is on " + inUse + " task(s). Delete from library and from all tasks?"
        : "Delete this task tag?";
      if (!confirm(msg)) return;
      deleteTaskTagFromLibrary(cur);
      renderTaskTagManager();
    });
    row.addEventListener("dragstart", e => {
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", row.dataset.idx);
    });
    row.addEventListener("dragend", () => {
      list.querySelectorAll(".tag-manager-row").forEach(r => r.classList.remove("dragging", "drag-over"));
    });
    row.addEventListener("dragover", e => {
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      list.querySelectorAll(".tag-manager-row").forEach(r => r.classList.remove("drag-over"));
      row.classList.add("drag-over");
    });
    row.addEventListener("drop", e => {
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
      const toIdx = parseInt(row.dataset.idx, 10);
      if (!isNaN(fromIdx) && !isNaN(toIdx) && fromIdx !== toIdx) {
        reorderTaskTagInLibrary(fromIdx, toIdx);
        renderTaskTagManager();
      }
    });
  });
}

function openTagManager() {
  renderTagManager();
  document.getElementById("tagManagerBg").classList.add("show");
}
function closeTagManager() {
  document.getElementById("tagManagerBg").classList.remove("show");
  render();
  if (editingPersonId) renderPersonModal();
}
function reorderTagInLibrary(fromIdx, toIdx) {
  const lib = getTagLibrary();
  if (fromIdx < 0 || fromIdx >= lib.length || toIdx < 0 || toIdx >= lib.length) return;
  const [moved] = lib.splice(fromIdx, 1);
  lib.splice(toIdx, 0, moved);
  saveStore(STORE);
}

function renderTagManager() {
  const list = document.getElementById("tagManagerList");
  const lib = getTagLibrary();
  if (lib.length === 0) {
    list.innerHTML = '<div style="color:#9a9a9a; font-size:13px; padding:12px">No tags. Create one below.</div>';
    return;
  }
  list.innerHTML = lib.map((t, i) => {
    return '<div class="tag-manager-row" draggable="true" data-name="' + escapeHtml(t.name) + '" data-idx="' + i + '">' +
      '<span class="drag-handle" title="Drag to reorder">&#9776;</span>' +
      '<input type="color" class="tm-bg" value="' + t.bg + '" title="Background color">' +
      '<input type="text" class="tm-name" value="' + escapeHtml(t.name) + '">' +
      '<input type="color" class="tm-fg" value="' + t.fg + '" title="Text color">' +
      '<span class="preview-pill" style="background:' + t.bg + ';color:' + t.fg + '">' + escapeHtml(t.name) + '</span>' +
      '<button class="del-tag" title="Delete tag">&times;</button>' +
    '</div>';
  }).join("");

  list.querySelectorAll(".tag-manager-row").forEach(row => {
    const oldName = row.dataset.name;
    const update = () => {
      const newName = row.querySelector(".tm-name").value.trim();
      const bg = row.querySelector(".tm-bg").value;
      const fg = row.querySelector(".tm-fg").value;
      if (!newName) return;
      const ok = updateTagInLibrary(oldName, newName, bg, fg);
      if (ok) {
        const prev = row.querySelector(".preview-pill");
        prev.style.background = bg;
        prev.style.color = fg;
        prev.textContent = newName;
        row.dataset.name = newName;
      }
    };
    row.querySelector(".tm-bg").addEventListener("input", update);
    row.querySelector(".tm-fg").addEventListener("input", update);
    row.querySelector(".tm-name").addEventListener("change", update);
    row.querySelector(".del-tag").addEventListener("click", () => {
      const cur = row.dataset.name;
      const inUse = Object.values(STORE.personTags || {}).flat().filter(t => t === cur).length;
      const msg = inUse > 0
        ? "This tag is assigned to " + inUse + " person(s). Delete from library and from everyone?"
        : "Delete this tag?";
      if (!confirm(msg)) return;
      deleteTagFromLibrary(cur);
      renderTagManager();
    });
    // Drag and drop reordering
    row.addEventListener("dragstart", e => {
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", row.dataset.idx);
    });
    row.addEventListener("dragend", () => {
      list.querySelectorAll(".tag-manager-row").forEach(r => r.classList.remove("dragging", "drag-over"));
    });
    row.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      list.querySelectorAll(".tag-manager-row").forEach(r => r.classList.remove("drag-over"));
      row.classList.add("drag-over");
    });
    row.addEventListener("drop", e => {
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
      const toIdx = parseInt(row.dataset.idx, 10);
      if (!isNaN(fromIdx) && !isNaN(toIdx) && fromIdx !== toIdx) {
        reorderTagInLibrary(fromIdx, toIdx);
        renderTagManager();
      }
    });
  });
}
document.getElementById("manageTagsBtn").addEventListener("click", openTagManager);
const teamManageTagsBtnEl = document.getElementById("teamManageTagsBtn");
if (teamManageTagsBtnEl) teamManageTagsBtnEl.addEventListener("click", openTagManager);
document.getElementById("tagManagerBg").addEventListener("click", e => {
  if (e.target.id === "tagManagerBg") closeTagManager();
});
document.getElementById("newTagBtn").addEventListener("click", () => {
  const name = document.getElementById("newTagName").value.trim();
  const bg = document.getElementById("newTagBg").value;
  const fg = document.getElementById("newTagFg").value;
  if (!name) return;
  if (!addTagToLibrary(name, bg, fg)) {
    alert("A tag with that name already exists.");
    return;
  }
  document.getElementById("newTagName").value = "";
  renderTagManager();
});
document.getElementById("newTagName").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); document.getElementById("newTagBtn").click(); }
});

// Seed tag library on first load
getTagLibrary();

const _origSaveRender = render;
render = function() { _origSaveRender(); try { saveFilterState(); } catch {} updateBulkBar(); };

function updateRestoreHiddenButton() {
  const n = (STORE.hiddenDefaultIds || []).length;
  const btn = document.getElementById("restoreHiddenBtn");
  if (n > 0) {
    btn.style.display = "inline-block";
    document.getElementById("restoreHiddenCount").textContent = n;
  } else {
    btn.style.display = "none";
  }
}
document.getElementById("restoreHiddenBtn").addEventListener("click", () => {
  const hidden = STORE.hiddenDefaultIds || [];
  if (hidden.length === 0) return;
  const names = hidden.map(id => DEFAULT_TEAM.find(p => p.id === id)?.name || id).join("\n  • ");
  if (!confirm("Restore these hidden members?\n  • " + names)) return;
  STORE.hiddenDefaultIds = [];
  saveStore(STORE);
  rebuildTeam();
  populateUserSelects();
  render();
});

const _origRender = render;
render = function() {
  _origRender();
  updateRestoreHiddenButton();
};

loadFilterState();
// Restore search input value if any
document.getElementById("searchInput").value = searchQuery || "";

