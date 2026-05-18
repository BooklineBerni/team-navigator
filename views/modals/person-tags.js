// =============================================================================
// views/modals/person-tags.js
// ---------------------------------------------------------------------------
// Person tags modal — assign / remove tags from a person.
//
// Loaded AFTER inline. Wirings inside this block move together with their
// functions so DOM addEventListener calls resolve their references locally.
// References to STORE / TEAM / helpers resolve via the shared classic-script
// scope at runtime (when modal events fire).
// =============================================================================

// ---------- Person tags modal ----------
let editingPersonId = null;

function openPersonModal(personId) {
  editingPersonId = personId;
  const p = findPerson(personId);
  document.getElementById("personModalTitle").textContent = "Edit " + (p ? p.displayName : "person");
  // Pre-fill available week time and disabled checkbox
  const settings = getPersonSettings(personId);
  const awtInput = document.getElementById("f_availableWeekTime");
  awtInput.value = (settings.availableWeekTime != null && settings.availableWeekTime !== "") ? settings.availableWeekTime : "";
  const _personSectionEl = document.getElementById("f_personSection");
  if (_personSectionEl) _personSectionEl.value = getPersonSection(personId);
  renderPersonModal();
  document.getElementById("personModalBg").classList.add("show");
}
function closePersonModal() {
  document.getElementById("personModalBg").classList.remove("show");
  editingPersonId = null;
  render();
}
function renderPersonModal() {
  if (!editingPersonId) return;
  const tags = getTagsFor(editingPersonId);
  // Always show "remove from team" — for defaults we hide them via hiddenDefaultIds
  document.getElementById("removeMemberBtn").style.display = "inline-block";

  const cont = document.getElementById("personTagsContainer");
  cont.innerHTML = tags.length
    ? tags.map(t => tagBadgeHtml(t, true)).join("")
    : '<span style="color:#9a9a9a; font-size:12px">No tags assigned</span>';
  cont.querySelectorAll(".tag").forEach(node => {
    node.addEventListener("click", () => {
      const tag = node.dataset.tag;
      const newTags = getTagsFor(editingPersonId).filter(x => x !== tag);
      setTagsFor(editingPersonId, newTags);
      renderPersonModal();
    });
  });
  // Available tags from the library
  const presetCont = document.getElementById("presetTagsContainer");
  const lib = getTagLibrary();
  if (lib.length === 0) {
    presetCont.innerHTML = '<span style="color:#9a9a9a; font-size:12px">No tags yet. Create one with "Member Tags".</span>';
  } else {
    presetCont.innerHTML = lib.map(libTag => {
      const t = libTag.name;
      const inUse = tags.includes(t);
      return '<span class="preset-tag ' + (inUse ? "in-use" : "") + '">' + tagBadgeHtml(t, false) + '</span>';
    }).join("");
    presetCont.querySelectorAll(".preset-tag:not(.in-use)").forEach(node => {
      node.addEventListener("click", () => {
        const tag = node.querySelector(".tag").dataset.tag;
        const newTags = [...getTagsFor(editingPersonId), tag];
        setTagsFor(editingPersonId, newTags);
        renderPersonModal();
      });
    });
  }
}
document.getElementById("removeMemberBtn").addEventListener("click", () => {
  if (!editingPersonId) return;
  const p = findPerson(editingPersonId);
  const taskCount = STORE.tasks.filter(t => t.responsibleId === editingPersonId).length;
  const taskWarning = taskCount > 0 ? '\n\nThis person has ' + taskCount + ' task(s) assigned. The tasks will remain in storage, but they won\'t be visible until you re-add this member.' : '';
  if (!confirm('Remove ' + (p ? p.name : 'this person') + ' from the team?' + taskWarning)) return;
  // Custom member?
  const isCustom = (STORE.customMembers || []).some(m => m.id === editingPersonId);
  if (isCustom) {
    STORE.customMembers = (STORE.customMembers || []).filter(m => m.id !== editingPersonId);
  } else {
    // Default member → mark as hidden
    STORE.hiddenDefaultIds = STORE.hiddenDefaultIds || [];
    if (!STORE.hiddenDefaultIds.includes(editingPersonId)) STORE.hiddenDefaultIds.push(editingPersonId);
  }
  delete (STORE.personTags || {})[editingPersonId];
  saveStore(STORE);
  rebuildTeam();
  populateUserSelects();
  closePersonModal();
});

document.getElementById("f_availableWeekTime").addEventListener("change", e => {
  if (!editingPersonId) return;
  const v = e.target.value === "" ? null : parseFloat(e.target.value);
  setPersonSettings(editingPersonId, { availableWeekTime: (isNaN(v) ? null : v) });
});
const _f_personSection = document.getElementById("f_personSection");
if (_f_personSection) _f_personSection.addEventListener("change", e => {
  if (!editingPersonId) return;
  setPersonSection(editingPersonId, e.target.value);
  if (currentView === "members") render();
});

document.getElementById("addCustomTagBtn").addEventListener("click", () => {
  const input = document.getElementById("customTagInput");
  const val = input.value.trim();
  if (!val || !editingPersonId) return;
  // Auto-add to library if missing
  if (!findTag(val)) addTagToLibrary(val);
  const cur = getTagsFor(editingPersonId);
  if (cur.includes(val)) { input.value = ""; return; }
  setTagsFor(editingPersonId, [...cur, val]);
  input.value = "";
  renderPersonModal();
});
document.getElementById("customTagInput").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); document.getElementById("addCustomTagBtn").click(); }
});
document.getElementById("personModalBg").addEventListener("click", e => {
  if (e.target.id === "personModalBg") closePersonModal();
});

