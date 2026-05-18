// =============================================================================
// views/modals/add-member.js
// ---------------------------------------------------------------------------
// Add Member modal — search Slack users and add to team.
//
// Loaded AFTER inline. Wirings inside this block move together with their
// functions so DOM addEventListener calls resolve their references locally.
// References to STORE / TEAM / helpers resolve via the shared classic-script
// scope at runtime (when modal events fire).
// =============================================================================

// ---------- Add Member modal ----------
function openAddMember() {
  document.getElementById("memberSearchInput").value = "";
  document.getElementById("memberSearchResults").innerHTML = '<div style="color:#9a9a9a; font-size:12px; padding:12px; text-align:center">Start typing to search the Bookline directory...</div>';
  document.getElementById("addMemberBg").classList.add("show");
  setTimeout(() => document.getElementById("memberSearchInput").focus(), 50);
}
function closeAddMember() {
  document.getElementById("addMemberBg").classList.remove("show");
}


function renderMemberSearchResults(results) {
  const cont = document.getElementById("memberSearchResults");
  if (!results || results.length === 0) {
    cont.innerHTML = '<div style="color:#9a9a9a; font-size:12px; padding:12px; text-align:center">No results</div>';
    return;
  }
  cont.innerHTML = results.map(r => {
    const inTeam = TEAM.some(p => p.id === r.userId);
    const ini = (r.name || "?").split(/\s+/).filter(Boolean).slice(0,2).map(s => s[0]).join("").toUpperCase();
    const color = "#" + (parseInt(r.userId.slice(-6), 36) & 0xAAAAAA).toString(16).padStart(6, '0').slice(0,6);
    return '<div class="member-result ' + (inTeam ? 'in-team' : '') + '">' +
      '<span class="av" style="background:' + color + '"><img src="' + escapeHtml(r.photo) + '" alt="" onerror="this.remove()"><span class="ini">' + escapeHtml(ini) + '</span></span>' +
      '<div class="info"><div class="name">' + escapeHtml(r.name) + '</div><div class="email">' + escapeHtml(r.email || r.userId) + '</div></div>' +
      (inTeam
        ? '<button class="btn" disabled style="opacity:0.6">Already in team</button>'
        : '<button class="btn primary" data-add-uid="' + escapeHtml(r.userId) + '" data-add-name="' + escapeHtml(r.name) + '" data-add-email="' + escapeHtml(r.email) + '" data-add-photo="' + escapeHtml(r.photo) + '">Add</button>'
      ) +
    '</div>';
  }).join("");

  cont.querySelectorAll("button[data-add-uid]").forEach(btn => {
    btn.addEventListener("click", () => addMemberToTeam({
      id: btn.dataset.addUid,
      name: btn.dataset.addName,
      email: btn.dataset.addEmail,
      photo: btn.dataset.addPhoto
    }));
  });
}

function addMemberToTeam({id, name, email, photo}) {
  if (TEAM.some(p => p.id === id)) return;
  const displayName = (name || "").split(/\s+/)[0] || name || id;
  const member = {
    id, name, displayName,
    email: email || "",
    role: "Bookline",
    photo: photo || "",
    color: pickColorForNewMember(),
    defaultTags: []
  };
  STORE.customMembers = STORE.customMembers || [];
  STORE.customMembers.push(member);
  saveStore(STORE);
  rebuildTeam();
  populateUserSelects();
  closeAddMember();
  render();
}

let memberSearchTimer = null;
document.getElementById("memberSearchInput").addEventListener("input", e => {
  const q = e.target.value.trim();
  if (memberSearchTimer) clearTimeout(memberSearchTimer);
  if (!q) {
    document.getElementById("memberSearchResults").innerHTML = '<div style="color:#9a9a9a; font-size:12px; padding:12px; text-align:center">Start typing to search the Bookline directory...</div>';
    return;
  }
  document.getElementById("memberSearchResults").innerHTML = '<div style="color:#9a9a9a; font-size:12px; padding:12px; text-align:center">Searching...</div>';
  memberSearchTimer = setTimeout(() => {
    // Filter the embedded Slack directory locally — no bridge needed
    const ql = q.toLowerCase();
    const matches = SLACK_DIRECTORY
      .filter(u => u.name.toLowerCase().includes(ql) || (u.email||"").toLowerCase().includes(ql) || u.id.toLowerCase().includes(ql))
      .slice(0, 15)
      .map(u => ({ name: u.name, userId: u.id, email: u.email, photo: u.photo }));
    renderMemberSearchResults(matches);
  }, 200);
});

document.getElementById("addMemberBtn").addEventListener("click", openAddMember);
const teamAddMemberBtnEl = document.getElementById("teamAddMemberBtn");
if (teamAddMemberBtnEl) teamAddMemberBtnEl.addEventListener("click", openAddMember);


document.getElementById("addMemberBg").addEventListener("click", e => { if (e.target.id === "addMemberBg") closeAddMember(); });

