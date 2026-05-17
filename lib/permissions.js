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
function bnUpdateAdminNavVisibility() {
  const btn = document.getElementById('navAdminBtn');
  if (!btn) return;
  btn.style.display = (bnUserPermission === 'admin') ? '' : 'none';
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
  bnPreviewAsEmail = email || null;
  // Re-pull the store as the preview user (or back to admin view if null).
  await bnSyncPullFromCloud();
  if (typeof bnRenderAdminPage === 'function') bnRenderAdminPage();
}
// Populates the per-profile permissions card (only rendered when the viewer is admin).
// Shows whether the person is in the signup allowlist, whether they've signed in, and
// their current permission level — with controls to change all three.
async function bnPopulateProfilePermsPanel() {
  const panel = document.getElementById('bnProfilePermsPanel');
  if (!panel || !bnSupabase) return;
  const email = (panel.getAttribute('data-person-email') || '').trim().toLowerCase();
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
  // Preview banner
  const banner = document.getElementById('bnAdminPreviewBanner');
  const who = document.getElementById('bnAdminPreviewWho');
  if (banner && who) {
    if (bnPreviewAsEmail) {
      banner.style.display = '';
      who.textContent = bnPreviewAsEmail;
    } else {
      banner.style.display = 'none';
    }
  }
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
  const permsEl = document.getElementById('bnAdminPermsList');
  if (permsEl) {
    const permByEmail = new Map();
    perms.forEach(p => { if (p.email) permByEmail.set(p.email.toLowerCase(), p); });
    // Combined list, dedupe by email.
    const merged = [];
    perms.forEach(p => { if (p.email) merged.push({ kind: 'signed-in', email: p.email.toLowerCase(), user_id: p.user_id, permission: p.permission, notes: null }); });
    allowlist.forEach(a => {
      const e = (a.email || '').toLowerCase();
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
      permsEl.innerHTML = merged.map(row => {
        const isSelf = row.email && (row.email === (bnSupabaseUser && bnSupabaseUser.email || '').toLowerCase());
        const opts = ['none','restricted_view','admin'].map(p => `<option value="${p}" ${row.permission === p ? 'selected' : ''}>${p}</option>`).join('');
        const pending = row.kind === 'allowlist-pending';
        return `
          <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid #f0f0f0; ${pending ? 'background:#fafafa;' : ''}">
            <div style="flex:1;">
              <div style="font-weight:600;">${escapeHtml(row.email)} ${isSelf ? '<span style="font-size:11px; color:#888;">(tú)</span>' : ''}</div>
              ${pending
                ? `<div style="font-size:11px; color:#d97706;">Pending sign in${row.notes ? ' · ' + escapeHtml(row.notes) : ''}</div>`
                : `<div style="font-size:11px; color:#aaa; font-family:monospace;">${escapeHtml(row.user_id || '')}</div>`}
            </div>
            ${pending
              ? '<span style="font-size:12px; color:#888;">Available after sign in</span>'
              : `<select data-bn-perm-user="${escapeHtml(row.user_id)}" ${isSelf ? 'disabled title="No puedes cambiar tu propio nivel"' : ''} style="padding:6px 8px; border:1px solid #d0d0d0; border-radius:6px;">${opts}</select>
                 <button class="btn" data-bn-perm-preview="${escapeHtml(row.email)}" ${isSelf ? 'disabled' : ''} type="button" title="Ver la app como este usuario (read-only)">👁️ Preview</button>`}
          </div>
        `;
      }).join('');
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
  const exitBtn = document.getElementById('bnAdminPreviewExit');
  if (exitBtn) exitBtn.addEventListener('click', () => bnAdminPreviewAs(null));
});
