// =============================================================================
// lib/permissions.js
// ---------------------------------------------------------------------------
// Admin/permissions management UI for Berni Navigator.
//
//   - Sidebar nav item is only revealed when bnUserPermission === 'admin'.
//   - All mutations go through SECURITY DEFINER RPCs - SQL functions verify
//     is_admin() before doing anything, so a non-admin who patches the JS
//     still can't escalate.
//
// Loaded AFTER lib/supabase-auth.js (depends on bnSupabase, bnSupabaseUser,
// bnUserPermission, bnPreviewAsEmail) and BEFORE the main inline app script.
//
// Public surface:
//   funcs: bnUpdateAdminNavVisibility, bnAdminLoadAllowlist, bnAdminLoadPermissions,
//          bnIsValidEmail, bnAdminAddAllowlist, bnAdminSetAllowlistPermission,
//          bnAdminRemoveAllowlist, bnAdminGrantPermission, bnAdminPreviewAs,
//          bnPopulateProfilePermsPanel, bnRenderAdminPage
// =============================================================================

// ===========================================================================
// Admin section · permission management UI
// ---------------------------------------------------------------------------
//   • Sidebar nav item is only revealed when bnUserPermission === 'admin'.
//   • All mutations go through SECURITY DEFINER RPCs (admin_grant_permission,
//     admin_add_allowlist, admin_remove_allowlist) — the SQL functions verify
//     is_admin() before doing anything, so a non-admin who patches the JS
//     still can't escalate.
// ===========================================================================
// Cache of who we're previewing as, populated by bnAdminPreviewAs. Used to render the
// sidebar "preview-as" card (photo + email + permission) below the brand.
let bnPreviewAsInfo = null;

// Escape hatch — paste in the browser console if the UI gets stuck in preview mode:
//   bnForceRestoreAdminView()
// This wipes every piece of preview-as state, clears localStorage of the cached store,
// and reloads so the next boot starts clean.
window.bnForceRestoreAdminView = function bnForceRestoreAdminView() {
  try { bnPreviewAsEmail = null; } catch (_) {}
  try { bnPreviewAsInfo = null; } catch (_) {}
  try { window.__bnReadOnly = false; } catch (_) {}
  try { document.body.classList.remove('bn-read-only'); } catch (_) {}
  try { document.body.classList.remove('bn-preview-as'); } catch (_) {}
  try { localStorage.removeItem('bookline-store-v1'); } catch (_) {}
  try { localStorage.removeItem('bookline-store'); } catch (_) {}
  console.info('[BN] Forced admin-view restore — reloading.');
  setTimeout(() => location.reload(), 100);
};

function bnUpdateAdminNavVisibility() {
  const btn = document.getElementById('navAdminBtn');
  if (!btn) return;
  // Hide Admin tab whenever we're previewing as another user — the previewed user
  // would not see it themselves, so we hide it to make the preview faithful. Use the
  // brand "B" logo (top-left) to exit the preview.
  const isAdmin = (bnUserPermission === 'admin');
  const inPreview = !!bnPreviewAsEmail;
  btn.style.display = (isAdmin && !inPreview) ? '' : 'none';
  // Privacy: Requests are admin-only — hide for non-admins and during preview.
  const reqBtn = document.querySelector('.nav-item[data-view="requests"]');
  if (reqBtn) reqBtn.style.display = (isAdmin && !inPreview) ? '' : 'none';
  // Body class for CSS-driven preview behaviour (brand becomes a "back" button).
  try { document.body.classList.toggle('bn-preview-as', inPreview); } catch (_) {}
  // Brand becomes a back-button while previewing, and its visual identity changes:
  //   • Logo (B) → previewed user's photo (or coloured initials if no photo)
  //   • Name (Berni Navigator) → previewed user's name, in their signature colour
  //   • Below the name → permission level in small text
  const brand = document.getElementById('bnBrand');
  const logo = document.getElementById('bnBrandLogo');
  const nameEl = document.getElementById('bnBrandName');
  const permEl = document.getElementById('bnPreviewAsPerm');
  if (brand) {
    if (!brand._bnBackWired) {
      brand.addEventListener('click', () => {
        if (bnPreviewAsEmail && typeof bnAdminPreviewAs === 'function') bnAdminPreviewAs(null);
      });
      brand._bnBackWired = true;
    }
    // SECURITY: only the admin (the one with isAdmin === true and an active
    // bnPreviewAsEmail) ever sees their brand swapped. Restricted_view users
    // and signed-in non-admins always see the plain "B / Berni Navigator".
    if (inPreview && isAdmin && bnPreviewAsInfo) {
      brand.style.cursor = 'pointer';
      brand.title = 'Click to exit preview · back to my admin view';
      // Logo: replace "B" with the user's photo (or coloured initials).
      if (logo) {
        if (bnPreviewAsInfo.photo) {
          logo.innerHTML = '';
          const img = document.createElement('img');
          img.src = bnPreviewAsInfo.photo;
          img.alt = bnPreviewAsInfo.name || '';
          img.referrerPolicy = 'no-referrer';
          img.style.cssText = 'width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block;';
          logo.appendChild(img);
          logo.style.background = '';
          logo.style.color = '';
        } else {
          logo.innerHTML = '';
          logo.textContent = bnPreviewAsInfo.initials || '?';
          logo.style.background = bnPreviewAsInfo.color || '#9ca3af';
          logo.style.color = '#fff';
        }
      }
      // Name: replace "Berni Navigator" with the previewed user's name, in their colour.
      if (nameEl) {
        nameEl.textContent = bnPreviewAsInfo.name || bnPreviewAsInfo.email;
        nameEl.style.color = bnPreviewAsInfo.color || '';
      }
      // Permission line below the name.
      if (permEl) {
        permEl.textContent = bnPreviewAsInfo.permission || 'unknown';
        permEl.style.display = '';
      }
    } else {
      // Restore default brand.
      brand.style.cursor = '';
      brand.title = '';
      if (logo) {
        logo.innerHTML = '';
        logo.textContent = 'B';
        logo.style.background = '';
        logo.style.color = '';
      }
      if (nameEl) {
        nameEl.textContent = 'Berni Navigator';
        nameEl.style.color = '';
      }
      if (permEl) permEl.style.display = 'none';
    }
  }
}
// Resolve photo/name/permission for an email so the sidebar card can display it.
async function bnResolvePreviewInfo(email) {
  if (!email) return null;
  const lc = email.toLowerCase();
  // 1) Find a directory entry for photo + name (Slack/team rosters).
  const inDir = (arr) => Array.isArray(arr) ? arr.find(p => p && p.email && p.email.toLowerCase() === lc) : null;
  let person = null;
  try { if (typeof DEFAULT_TEAM !== 'undefined')    person = person || inDir(DEFAULT_TEAM); } catch (_) {}
  try { if (typeof EXTERNAL_TEAM !== 'undefined')   person = person || inDir(EXTERNAL_TEAM); } catch (_) {}
  try { if (typeof SLACK_DIRECTORY !== 'undefined') person = person || inDir(SLACK_DIRECTORY); } catch (_) {}
  // 2) Permission from user_permissions (then allowlist as fallback).
  let permission = null;
  try {
    const { data: p } = await bnSupabase.from('user_permissions').select('permission').eq('email', lc).maybeSingle();
    if (p && p.permission) permission = p.permission;
    if (!permission) {
      const { data: a } = await bnSupabase.from('signup_allowlist').select('permission').eq('email', lc).maybeSingle();
      if (a && a.permission) permission = a.permission;
    }
  } catch (_) {}
  const name = (person && (person.name || person.displayName)) || email;
  const initials = String(name || '').trim().split(/\s+/).slice(0,2).map(w => w.charAt(0).toUpperCase()).join('') || '?';
  return {
    email,
    name,
    photo: (person && person.photo) || '',
    color: (person && person.color) || '#9ca3af',
    initials,
    permission: permission || 'none'
  };
}
async function bnAdminLoadAllowlist() {
  if (!bnSupabase) return [];
  try {
    // permission column added by the pre_signup_permissions migration. Older DBs may not
    // have it yet — if the column doesn't exist we just degrade to undefined client-side.
    const { data, error } = await bnSupabase.from('signup_allowlist').select('email, notes, permission, added_at').order('added_at', { ascending: true });
    if (error) { console.warn('[BN] allowlist load failed:', error.message); return []; }
    return data || [];
  } catch (e) { return []; }
}
// Basic RFC-ish email validation. Refuses obvious typos / missing parts.
function bnIsValidEmail(s) {
  s = (s || '').trim().toLowerCase();
  if (s.length < 5 || s.length > 254) return false;
  // local@domain.tld — at least one dot in the domain, no spaces, no leading/trailing dots.
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s);
}
async function bnAdminLoadPermissions() {
  if (!bnSupabase) return [];
  try {
    const { data, error } = await bnSupabase.from('user_permissions').select('user_id, email, permission, updated_at').order('updated_at', { ascending: false });
    if (error) { console.warn('[BN] permissions load failed:', error.message); return []; }
    return data || [];
  } catch (e) { return []; }
}
async function bnAdminAddAllowlist(email, notes, permission) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return { ok: false, msg: 'Empty email' };
  if (!bnIsValidEmail(e)) return { ok: false, msg: 'Invalid email: ' + e };
  const perm = ['none','restricted_view','admin'].includes(permission) ? permission : 'restricted_view';
  try {
    // The RPC accepts 3 args after the migration; before the migration it ignores
    // target_permission silently (positional argument with default). Either way works.
    const { error } = await bnSupabase.rpc('admin_add_allowlist', { target_email: e, target_notes: notes || null, target_permission: perm });
    if (error) return { ok: false, msg: error.message };
    if (typeof bnRenderAdminPage === 'function') bnRenderAdminPage();
    return { ok: true };
  } catch (ex) { return { ok: false, msg: (ex && ex.message) || String(ex) }; }
}
async function bnAdminSetAllowlistPermission(email, newPermission) {
  if (!bnSupabase) return;
  try {
    const { error } = await bnSupabase.rpc('admin_set_allowlist_permission', { target_email: email, new_permission: newPermission });
    if (error) { alert('Error changing permission: ' + error.message); return; }
    if (typeof bnRenderAdminPage === 'function') bnRenderAdminPage();
  } catch (ex) { alert('Error: ' + (ex && ex.message || ex)); }
}
async function bnAdminRemoveAllowlist(email) {
  if (!confirm('Remove ' + email + ' from the allowlist? They will not be able to sign up again until you re-add them.')) return;
  try {
    const { error } = await bnSupabase.rpc('admin_remove_allowlist', { target_email: email });
    if (error) { alert('Error: ' + error.message); return; }
    if (typeof bnRenderAdminPage === 'function') bnRenderAdminPage();
  } catch (ex) { alert('Error: ' + (ex && ex.message || ex)); }
}
async function bnAdminGrantPermission(userId, permission) {
  try {
    const { error } = await bnSupabase.rpc('admin_grant_permission', { target_user_id: userId, new_permission: permission });
    if (error) { alert('Error: ' + error.message); return; }
    if (typeof bnRenderAdminPage === 'function') bnRenderAdminPage();
  } catch (ex) { alert('Error: ' + (ex && ex.message || ex)); }
}
async function bnAdminPreviewAs(email) {
  // EXITING PREVIEW: do a hard reset. Trying to surgically un-do every side-effect of
  // preview (stale STORE, lingering body classes, RPC-returned _filtered flag, etc.)
  // has proven fragile. Wiping the local STORE cache and reloading is the only way
  // to *guarantee* the admin lands back in full-control mode.
  if (!email) {
    bnPreviewAsEmail = null;
    bnPreviewAsInfo = null;
    window.__bnReadOnly = false;
    try { document.body.classList.remove('bn-read-only'); } catch (_) {}
    try { document.body.classList.remove('bn-preview-as'); } catch (_) {}
    // Wipe the cached STORE so the next boot pulls fresh from the cloud as the
    // (now non-preview) admin caller. Use the canonical STORE_KEY constant
    // (currently "bookline-team-panel-v2") + a few legacy names defensively.
    try { localStorage.removeItem(typeof STORE_KEY !== 'undefined' ? STORE_KEY : 'bookline-team-panel-v2'); } catch (_) {}
    try { localStorage.removeItem('bookline-store-v1'); } catch (_) {}
    try { localStorage.removeItem('bookline-store'); } catch (_) {}
    console.info('[BN] Exiting preview — clearing cached store and reloading.');
    setTimeout(() => location.reload(), 50);
    return;
  }
  // ENTERING PREVIEW: resolve identity, pull the filtered store, and refresh the
  // sidebar so the brand swaps to the previewed user's photo + name + permission.
  bnPreviewAsEmail = email;
  bnPreviewAsInfo = await bnResolvePreviewInfo(bnPreviewAsEmail);
  await bnSyncPullFromCloud();
  // Reset the profile selection so the Profile page picks the previewed user.
  // bnFindOwnTeamId() now resolves through bnPreviewAsEmail first, so clearing
  // profilePersonId here means the next renderProfilePage() lock-to-self path
  // (in setProfilePerson / renderProfilePage) lands on the previewed person,
  // not on a stale id from the admin's prior browsing.
  try { if (typeof profilePersonId !== 'undefined') profilePersonId = null; } catch (_) {}
  try { localStorage.removeItem('bookline-profilePersonId'); } catch (_) {}
  // Update sidebar visibility (hide Admin + Requests during preview) and brand
  // back-button affordance. This also fires the body.bn-preview-as class.
  if (typeof bnUpdateAdminNavVisibility === 'function') bnUpdateAdminNavVisibility();
  // Hop to Home — the previewed user wouldn't see Admin anyway. We use switchView()
  // (not just `currentView = 'home'; render()`) because the per-section display:none
  // toggling lives inside switchView — setting currentView alone leaves the prior
  // section visible.
  if (typeof switchView === 'function') {
    try { switchView('home'); } catch (_) {}
  } else if (typeof render === 'function') {
    try { render(); } catch (_) {}
  }
}
// Populates the per-profile permissions card (only rendered when the viewer is admin).
// Shows whether the person is in the signup allowlist, whether they've signed in, and
// their current permission level — with controls to change all three.
async function bnPopulateProfilePermsPanel() {
  const panel = document.getElementById('bnProfilePermsPanel');
  if (!panel || !bnSupabase) return;
  // Never render this panel during preview-as (the previewed user wouldn't see it).
  // Never render it on the admin's own profile (no one manages bernat's permission from there).
  if (typeof bnPreviewAsEmail !== 'undefined' && bnPreviewAsEmail) { panel.innerHTML = ''; panel.style.display = 'none'; return; }
  const myEmail = (typeof bnSupabaseUser !== 'undefined' && bnSupabaseUser && bnSupabaseUser.email || '').toLowerCase();
  const email = (panel.getAttribute('data-person-email') || '').trim().toLowerCase();
  if (email && email === myEmail) { panel.innerHTML = ''; panel.style.display = 'none'; return; }
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if (!email) {
    panel.innerHTML = '<div style="font-weight:600;font-size:13px;margin-bottom:6px">⭐ Permissions (admin)</div><div style="font-size:12.5px;color:#9b1c1c">This person has no email. Add an email in their profile to manage permissions.</div>';
    return;
  }
  // Look up allowlist + permission in parallel.
  let allowRow = null, permRow = null;
  try {
    const [a, p] = await Promise.all([
      bnSupabase.from('signup_allowlist').select('email,notes,added_at').eq('email', email).maybeSingle(),
      bnSupabase.from('user_permissions').select('user_id,permission,updated_at').eq('email', email).maybeSingle()
    ]);
    if (!a.error) allowRow = a.data;
    if (!p.error) permRow = p.data;
  } catch (e) { console.warn('[BN] profile perms lookup failed:', e && e.message); }
  // Render. Permission selector is always available now — if the user hasn't signed up
  // yet, we update signup_allowlist.permission and the trigger will copy it to
  // user_permissions on first sign-in.
  const inAllow = !!allowRow;
  const hasSignedUp = !!permRow;
  const currentPerm = hasSignedUp ? permRow.permission : (allowRow && allowRow.permission) || 'none';
  const opts = ['none','restricted_view','admin'].map(p => `<option value="${p}" ${currentPerm === p ? 'selected' : ''}>${p}</option>`).join('');
  const status = inAllow
    ? (hasSignedUp ? '<span style="color:#16a34a;font-weight:600">Active</span> · can sign in'
                   : "<span style=\"color:#d97706;font-weight:600\">Invited</span> · hasn't signed in yet")
    : "<span style=\"color:#9a9a9a\">Not invited</span> · can't sign up";
  panel.innerHTML =
    '<div style="font-weight:600;font-size:13px;margin-bottom:8px">⭐ Permissions (admin)</div>' +
    '<div style="font-size:12.5px;color:#6b6b6b;margin-bottom:10px">Email: <strong>' + escapeHtml(email) + '</strong> · ' + status + '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      (inAllow
        ? '<label style="font-size:12.5px;color:#6b6b6b">Permission:&nbsp;<select data-bn-perms-set>' + opts + '</select></label>' +
          (hasSignedUp ? '<button class="btn" data-bn-perms-preview type="button">👁️ Preview as</button>' : '') +
          '<button class="btn" data-bn-perms-remove-allow type="button" style="color:#9b1c1c">Revoke access</button>'
        : '<label style="font-size:12.5px;color:#6b6b6b">Permission on invite:&nbsp;<select data-bn-perms-set>' + opts + '</select></label>' +
          '<button class="btn primary" data-bn-perms-add-allow type="button">+ Invite</button>') +
    '</div>';
  // Wire actions
  const setSel = panel.querySelector('[data-bn-perms-set]');
  const addBtn = panel.querySelector('[data-bn-perms-add-allow]');
  if (addBtn) addBtn.addEventListener('click', async () => {
    const p = setSel ? setSel.value : 'restricted_view';
    const r = await bnAdminAddAllowlist(email, '', p);
    if (!r.ok) alert('Error: ' + r.msg);
    bnPopulateProfilePermsPanel();
  });
  const rmBtn = panel.querySelector('[data-bn-perms-remove-allow]');
  if (rmBtn) rmBtn.addEventListener('click', async () => {
    await bnAdminRemoveAllowlist(email);
    bnPopulateProfilePermsPanel();
  });
  if (setSel && inAllow) setSel.addEventListener('change', async () => {
    if (!confirm('Change permission for ' + email + ' to "' + setSel.value + '"?')) { bnPopulateProfilePermsPanel(); return; }
    // If already signed up, update user_permissions (active). Otherwise update allowlist row.
    if (hasSignedUp) {
      await bnAdminGrantPermission(permRow.user_id, setSel.value);
    } else {
      await bnAdminSetAllowlistPermission(email, setSel.value);
    }
    bnPopulateProfilePermsPanel();
  });
  const prevBtn = panel.querySelector('[data-bn-perms-preview]');
  if (prevBtn) prevBtn.addEventListener('click', () => bnAdminPreviewAs(email));
}
async function bnRenderAdminPage() {
  if (bnUserPermission !== 'admin') return;
  // Old preview banner removed — sidebar shows the preview-as card while previewing.
  // Allowlist + permissions load in parallel.
  const [allowlist, perms] = await Promise.all([bnAdminLoadAllowlist(), bnAdminLoadPermissions()]);
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // ---- Allowlist render ----
  const allowEl = document.getElementById('bnAdminAllowlist');
  if (allowEl) {
    if (!allowlist.length) {
      allowEl.innerHTML = '<div style="padding:14px; color:#888; text-align:center;">No one is in the allowlist yet.</div>';
    } else {
      allowEl.innerHTML = allowlist.map(row => {
        const perm = row.permission || 'none';
        const opts = ['none','restricted_view','admin'].map(p => `<option value="${p}" ${perm === p ? 'selected' : ''}>${p}</option>`).join('');
        return `
        <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid #f0f0f0;">
          <div style="flex:1;">
            <div style="font-weight:600;">${escapeHtml(row.email)}</div>
            ${row.notes ? `<div style="font-size:12px; color:#8a8a8a; margin-top:2px;">${escapeHtml(row.notes)}</div>` : ''}
          </div>
          <select data-bn-allow-perm="${escapeHtml(row.email)}" title="Permiso que se aplica al hacer sign in" style="padding:6px 8px; border:1px solid #d0d0d0; border-radius:6px;">${opts}</select>
          <button class="btn" data-bn-allow-remove="${escapeHtml(row.email)}" type="button" style="color:#9b1c1c;">Remove</button>
        </div>`;
      }).join('');
      allowEl.querySelectorAll('[data-bn-allow-remove]').forEach(b => {
        b.addEventListener('click', () => bnAdminRemoveAllowlist(b.getAttribute('data-bn-allow-remove')));
      });
      allowEl.querySelectorAll('[data-bn-allow-perm]').forEach(sel => {
        sel.addEventListener('change', () => bnAdminSetAllowlistPermission(sel.getAttribute('data-bn-allow-perm'), sel.value));
      });
    }
  }
  // ---- Permissions render: UNION of user_permissions + signup_allowlist ----
  // People who haven't signed up yet appear with status "Pending signup" — we can't grant
  // them a permission until they have a row in user_permissions (only created on first
  // sign-in), but they're surfaced here so the admin sees every person in one place.
  //
  // The signed-in admin themselves is rendered in a SEPARATE "Your profile" card above
  // (no picklist, no preview button), not in the per-user table — managing your own
  // permission from the same list as everyone else makes no sense.
  const permsEl = document.getElementById('bnAdminPermsList');
  const ownerEl = document.getElementById('bnAdminOwnerCard');
  const ownerEmail = (bnSupabaseUser && bnSupabaseUser.email || '').toLowerCase();
  // ---- Owner card: signed-in admin's own profile, separate from per-user table ----
  if (ownerEl) {
    const ownerPermRow = perms.find(p => (p.email || '').toLowerCase() === ownerEmail) || null;
    // Find directory entry for photo/name. Reuse the helpers below by building a small
    // local dir map first (kept inline so this block stays before the merged table).
    const dirLookup = new Map();
    const addAllOwner = (arr) => { if (Array.isArray(arr)) arr.forEach(p => { if (p && p.email) dirLookup.set(p.email.toLowerCase(), p); }); };
    try { if (typeof DEFAULT_TEAM !== 'undefined') addAllOwner(DEFAULT_TEAM); } catch (_) {}
    try { if (typeof EXTERNAL_TEAM !== 'undefined') addAllOwner(EXTERNAL_TEAM); } catch (_) {}
    try { if (typeof SLACK_DIRECTORY !== 'undefined') addAllOwner(SLACK_DIRECTORY); } catch (_) {}
    const ownerPerson = ownerEmail ? dirLookup.get(ownerEmail) : null;
    const ownerName = (ownerPerson && (ownerPerson.name || ownerPerson.displayName)) || ownerEmail || 'You';
    const ownerInitials = String(ownerName || '?').trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('') || '?';
    const avatarHtml = (ownerPerson && ownerPerson.photo)
      ? `<img src="${escapeHtml(ownerPerson.photo)}" alt="" referrerpolicy="no-referrer" style="width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;background:#eee;">`
      : `<div style="width:48px;height:48px;border-radius:50%;background:${(ownerPerson && ownerPerson.color) || '#0F2A4F'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0;">${escapeHtml(ownerInitials)}</div>`;
    const ownerPerm = (ownerPermRow && ownerPermRow.permission) || 'admin';
    ownerEl.innerHTML = `
      <h3 style="margin:0 0 8px; font-size:15px;">Your profile</h3>
      <div style="display:flex; align-items:center; gap:14px; padding:14px 16px; border:1px solid #ececec; border-radius:10px; background:#fafafa;">
        ${avatarHtml}
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; font-size:15px; color:#1e293b;">${escapeHtml(ownerName)} <span style="font-size:11px; color:#888; font-weight:normal;">(you)</span></div>
          <div style="font-size:12.5px; color:#6b7280; margin-top:2px;">${escapeHtml(ownerEmail)}</div>
        </div>
        <div style="font-size:12.5px; color:#16a34a; font-weight:600; padding:4px 10px; background:#dcfce7; border-radius:999px;">${escapeHtml(ownerPerm)}</div>
      </div>
    `;
  }
  if (permsEl) {
    const permByEmail = new Map();
    perms.forEach(p => { if (p.email) permByEmail.set(p.email.toLowerCase(), p); });
    // Combined list, dedupe by email, EXCLUDING the signed-in admin (rendered separately).
    const merged = [];
    perms.forEach(p => {
      if (!p.email) return;
      const e = p.email.toLowerCase();
      if (e === ownerEmail) return; // admin themselves → owner card
      merged.push({ kind: 'signed-in', email: e, user_id: p.user_id, permission: p.permission, notes: null });
    });
    allowlist.forEach(a => {
      const e = (a.email || '').toLowerCase();
      if (e === ownerEmail) return;
      if (!permByEmail.has(e)) merged.push({ kind: 'allowlist-pending', email: e, user_id: null, permission: null, notes: a.notes });
    });
    if (!merged.length) {
      permsEl.innerHTML = '<div style="padding:14px; color:#888; text-align:center;">No one yet. Add an email to the allowlist on the left.</div>';
    } else {
      // Sort: signed-in first, then pending, alphabetically within each group.
      merged.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'signed-in' ? -1 : 1;
        return a.email.localeCompare(b.email);
      });
      // Build a quick lookup from the Slack/team directories for photo + display name.
      // Falls back to email-based initials when the person isn't in any directory.
      const dirByEmail = new Map();
      const addAll = (arr) => { if (Array.isArray(arr)) arr.forEach(p => { if (p && p.email) dirByEmail.set(p.email.toLowerCase(), p); }); };
      try { if (typeof DEFAULT_TEAM !== 'undefined') addAll(DEFAULT_TEAM); } catch (_) {}
      try { if (typeof EXTERNAL_TEAM !== 'undefined') addAll(EXTERNAL_TEAM); } catch (_) {}
      try { if (typeof SLACK_DIRECTORY !== 'undefined') addAll(SLACK_DIRECTORY); } catch (_) {}
      function bnInitials(name) {
        return String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('') || '?';
      }
      function bnAvatarHtml(person, email) {
        const photo = person && person.photo;
        const name = (person && (person.name || person.displayName)) || email || '?';
        if (photo) {
          return `<img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" referrerpolicy="no-referrer"
                       style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;background:#eee;">`;
        }
        const bg = (person && person.color) || '#9ca3af';
        return `<div style="width:32px;height:32px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">${escapeHtml(bnInitials(name))}</div>`;
      }
      permsEl.innerHTML = merged.map(row => {
        const isSelf = row.email && (row.email === (bnSupabaseUser && bnSupabaseUser.email || '').toLowerCase());
        const opts = ['none','restricted_view','admin'].map(p => `<option value="${p}" ${row.permission === p ? 'selected' : ''}>${p}</option>`).join('');
        const pending = row.kind === 'allowlist-pending';
        const person = dirByEmail.get(row.email) || null;
        const displayName = (person && (person.name || person.displayName)) || row.email;
        const showEmail = (person && (person.name || person.displayName)) ? row.email : '';
        return `
          <div style="display:flex; align-items:center; gap:12px; padding:10px 14px; border-bottom:1px solid #f0f0f0; ${pending ? 'background:#fafafa;' : ''}">
            ${bnAvatarHtml(person, row.email)}
            <div style="flex:1; min-width:0;">
              <div style="font-weight:600; cursor:pointer; color:#1e293b;"
                   data-bn-perm-profile="${escapeHtml(row.email)}"
                   title="Open profile">
                ${escapeHtml(displayName)}${isSelf ? ' <span style="font-size:11px; color:#888; font-weight:normal;">(you)</span>' : ''}
              </div>
              ${showEmail ? `<div style="font-size:12px; color:#6b7280;">${escapeHtml(showEmail)}</div>` : ''}
              ${pending ? `<div style="font-size:11px; color:#d97706; margin-top:2px;">Pending sign in${row.notes ? ' · ' + escapeHtml(row.notes) : ''}</div>` : ''}
            </div>
            ${pending
              ? '<span style="font-size:12px; color:#888;">Available after sign in</span>'
              : `<select data-bn-perm-user="${escapeHtml(row.user_id)}" ${isSelf ? 'disabled title="You can\'t change your own permission"' : ''} style="padding:6px 8px; border:1px solid #d0d0d0; border-radius:6px;">${opts}</select>
                 <button class="btn" data-bn-perm-preview="${escapeHtml(row.email)}" ${isSelf ? 'disabled' : ''} type="button" title="View the app as this user (read-only)">👁️ Preview</button>`}
          </div>
        `;
      }).join('');
      // Click on the display name → jump to that person's Profile page.
      permsEl.querySelectorAll('[data-bn-perm-profile]').forEach(el => {
        el.addEventListener('click', () => {
          const email = el.getAttribute('data-bn-perm-profile');
          const person = dirByEmail.get(email);
          try {
            if (person && person.id && typeof setProfilePerson === 'function') {
              setProfilePerson(person.id);
            }
            currentView = 'profile';
            const wrap = document.getElementById('view-profile');
            if (wrap) wrap.style.display = '';
            if (typeof render === 'function') render();
          } catch (e) { console.warn('[BN] could not navigate to profile:', e && e.message); }
        });
      });
      permsEl.querySelectorAll('[data-bn-perm-user]').forEach(sel => {
        sel.addEventListener('change', () => {
          const uid = sel.getAttribute('data-bn-perm-user');
          if (confirm('Change this user\'s permission to "' + sel.value + '"?')) {
            bnAdminGrantPermission(uid, sel.value);
          } else {
            bnRenderAdminPage();
          }
        });
      });
      permsEl.querySelectorAll('[data-bn-perm-preview]').forEach(b => {
        b.addEventListener('click', () => bnAdminPreviewAs(b.getAttribute('data-bn-perm-preview')));
      });
    }
  }
}
// Wire admin form controls once the DOM exists.
document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('bnAdminAllowAddBtn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const emailEl = document.getElementById('bnAdminAllowEmail');
      const notesEl = document.getElementById('bnAdminAllowNotes');
      const permEl  = document.getElementById('bnAdminAllowPerm');
      const errEl   = document.getElementById('bnAdminAllowError');
      const email = (emailEl && emailEl.value || '').trim();
      const notes = (notesEl && notesEl.value || '').trim();
      const perm  = (permEl  && permEl.value)  || 'restricted_view';
      function showErr(msg) {
        if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
      }
      function clearErr() {
        if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      }
      clearErr();
      if (!email) { showErr('Enter an email'); return; }
      if (!bnIsValidEmail(email)) { showErr('Invalid email: "' + email + '". Expected format: user@domain.tld'); return; }
      const result = await bnAdminAddAllowlist(email, notes, perm);
      if (!result.ok) { showErr(result.msg || 'Unknown error'); return; }
      if (emailEl) emailEl.value = '';
      if (notesEl) notesEl.value = '';
      // keep the perm selector at whatever the admin had picked (sticky)
    });
  }
  // Old #bnAdminPreviewExit button removed — the brand "B" logo in the sidebar is now the exit affordance.
});
