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
  // Reset custom fields
  ['customMemberName','customMemberDisplayName','customMemberEmail','customMemberPhoto'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const errEl = document.getElementById('customMemberError'); if (errEl) errEl.style.display = 'none';
  // Default to Slack mode
  _setAddMemberMode('slack');
  document.getElementById("addMemberBg").classList.add("show");
  setTimeout(() => document.getElementById("memberSearchInput").focus(), 50);
}
function closeAddMember() {
  document.getElementById("addMemberBg").classList.remove("show");
}
// Switch between "search Bookline Slack" and "create custom" modes.
function _setAddMemberMode(mode) {
  const slackPanel  = document.getElementById('addMemberSlackMode');
  const customPanel = document.getElementById('addMemberCustomMode');
  const createBtn   = document.getElementById('customMemberCreateBtn');
  const toggle      = document.getElementById('addMemberModeToggle');
  if (!slackPanel || !customPanel) return;
  const isCustom = (mode === 'custom');
  slackPanel.style.display  = isCustom ? 'none' : '';
  customPanel.style.display = isCustom ? '' : 'none';
  if (createBtn) createBtn.style.display = isCustom ? '' : 'none';
  if (toggle) toggle.querySelectorAll('button[data-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  if (isCustom) {
    setTimeout(() => { const n = document.getElementById('customMemberName'); if (n) n.focus(); }, 30);
  }
}
// Generate a unique id for a custom member (no Slack U-prefix collision).
function _bnNewCustomMemberId() {
  const base = 'cust_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  return base;
}
function _bnCreateCustomMember() {
  const errEl = document.getElementById('customMemberError');
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } };
  const name = (document.getElementById('customMemberName').value || '').trim();
  if (!name) { showErr('Name is required.'); return; }
  const email = (document.getElementById('customMemberEmail').value || '').trim();
  const photo = (document.getElementById('customMemberPhoto').value || '').trim();
  const displayInput = (document.getElementById('customMemberDisplayName').value || '').trim();
  const displayName = displayInput || (name.split(/\s+/)[0] || name);
  // Reject duplicates by email (if provided) or by name
  const all = (typeof TEAM !== 'undefined' ? TEAM : []).concat(
    typeof EXTERNAL_TEAM !== 'undefined' ? EXTERNAL_TEAM : []
  );
  if (email && all.some(p => (p.email || '').toLowerCase() === email.toLowerCase())) {
    showErr('A member with that email already exists.'); return;
  }
  if (!email && all.some(p => (p.name || '').toLowerCase() === name.toLowerCase())) {
    showErr('A member with that exact name already exists. Add an email to disambiguate, or rename.'); return;
  }
  const id = _bnNewCustomMemberId();
  const member = {
    id, name, displayName,
    email,
    role: 'External',
    photo,
    color: pickColorForNewMember(),
    defaultTags: [],
    isCustom: true
  };
  STORE.customMembers = STORE.customMembers || [];
  STORE.customMembers.push(member);
  saveStore(STORE);
  rebuildTeam();
  populateUserSelects();
  closeAddMember();
  render();
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

// Wire the Slack / Custom mode toggle.
(function wireAddMemberModeToggle(){
  const toggle = document.getElementById('addMemberModeToggle');
  if (!toggle) return;
  toggle.querySelectorAll('button[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => _setAddMemberMode(btn.dataset.mode));
  });
})();

// Wire the Create custom member button + Enter-to-submit in the form.
(function wireCreateCustomMember(){
  const btn = document.getElementById('customMemberCreateBtn');
  if (btn) btn.addEventListener('click', _bnCreateCustomMember);
  ['customMemberName','customMemberDisplayName','customMemberEmail','customMemberPhoto'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _bnCreateCustomMember(); }
    });
  });
})();

