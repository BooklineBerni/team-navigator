// =============================================================================
// lib/supabase-auth.js
// ---------------------------------------------------------------------------
// Auth gate + cloud sync layer for Berni Navigator.
//
//   - Loaded AFTER the Supabase SDK (so window.supabase exists) and BEFORE the
//     main app script. Every reference to STORE / saveStore / render happens
//     inside async callbacks that fire after the main script has run.
//   - All functions/variables stay on the global scope (same names as before
//     extraction) so existing call-sites keep working unchanged.
//
// Public surface (used by index.html and admin/permissions modules):
//   constants: BN_SUPABASE_URL, BN_SUPABASE_KEY, BN_ADMIN_EMAIL, BN_IS_LOCALHOST,
//              BN_AUTH_REQUIRED
//   state:     bnSupabase, bnSupabaseSession, bnSupabaseUser, bnUserPermission,
//              bnPreviewAsEmail, bnSyncPushTimer
//   funcs:     bnAuthShowGate, bnAuthSignInWithGoogle, bnAuthSignOut,
//              bnRedactStoreInPlace, bnSyncPullFromCloud, bnSyncPushToCloud,
//              bnFetchPermission, bnAuthResolveGate, bnDecodeJwtPayload,
//              bnHydrateSessionFromHashSync, bnAuthBoot
// =============================================================================

// ===========================================================================
// Supabase integration (sync + auth gate)
// ---------------------------------------------------------------------------
//   • Localhost: auth optional (you can still use the app without login).
//   • Web deploy: auth is REQUIRED before showing the app.
//   • Only `bernat@bookline.ai` can sign up (DB trigger enforces this).
//   • After login, user_stores.store_data is pulled into local STORE.
//   • On save, STORE is upserted to user_stores (debounced).
//
// The publishable key is safe in the browser — RLS policies do the protection.
// ===========================================================================
const BN_SUPABASE_URL = "https://xnbptxxumzigizgwegut.supabase.co";
const BN_SUPABASE_KEY = "sb_publishable_cBBoQ0is8uzF2cDIWOKiIg_-YyHb1Yh";
const BN_ADMIN_EMAIL = "bernat@bookline.ai"; // hard-coded fallback admin (seeded in user_permissions)
const BN_IS_LOCALHOST = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname || '');
const BN_AUTH_REQUIRED = !BN_IS_LOCALHOST;  // require auth only on the deployed site
let bnSupabase = null;
try {
  if (window.supabase && window.supabase.createClient) {
    bnSupabase = window.supabase.createClient(BN_SUPABASE_URL, BN_SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // IMPORTANT: force implicit flow. Supabase v2 defaults to PKCE which returns to the
        // callback URL with `?code=...` in the query string instead of `#access_token=...`
        // in the hash. PKCE requires an async code-for-token exchange that takes 1-3s — during
        // which we'd show the sign-in form to the user (because our pre-paint anti-flash logic
        // and `bnHydrateSessionFromHashSync` both only know how to recognise the hash form).
        // With implicit flow the tokens arrive in the hash and we can hydrate synchronously
        // before the gate ever has a chance to render. Trade-off: tokens appear in the URL
        // briefly (logged in history), but we wipe them with history.replaceState immediately.
        flowType: 'implicit'
      }
    });
  }
} catch (e) { console.warn('[BN] Supabase init failed:', e && e.message); }
// Stash session state for later sync logic
let bnSupabaseSession = null;
let bnSupabaseUser = null;
let bnSyncPushTimer = null;
// Permission state — populated from user_permissions via get_filtered_store RPC.
//   'admin'           → full access, can manage permissions
//   'restricted_view' → read-only; sees own + redacted-shared tasks; cannot push
//   'none' / null     → no access; shown "waiting for permission" screen
let bnUserPermission = null;
let bnPreviewAsEmail = null; // admin-only: when set, fetches store as if viewed by this user
window.__bnReadOnly = false; // true when current filtered store should NOT be pushed back
function bnAuthShowGate(show, options) {
  options = options || {};
  const gate = document.getElementById('bnAuthGate');
  if (!gate) return;
  // Any call to bnAuthShowGate happens AFTER we've finished evaluating OAuth state,
  // so the pre-paint anti-flash overlay should always come down at this point.
  try { document.documentElement.removeAttribute('data-bn-oauth-callback'); } catch (_) {}
  if (show) {
    gate.classList.remove('hidden');
    gate.setAttribute('aria-hidden', 'false');
    document.body.classList.add('bn-locked');
    // Mode: 'signin' (default) | 'waiting' (signed-in, no permission) | 'loading' (OAuth handoff in flight)
    const mode = options.mode || 'signin';
    const title = document.getElementById('bnAuthTitle');
    const subtitle = document.getElementById('bnAuthSubtitle');
    const body = document.getElementById('bnAuthBody');
    if (mode === 'waiting') {
      // User IS signed in but lacks permissions. Make it visually obvious that
      // they DON'T need to sign in again — the issue is on the admin's side.
      if (title) title.textContent = '✓ Signed in';
      if (subtitle) {
        const who = options.email ? (' as <strong>' + options.email + '</strong>') : '';
        subtitle.innerHTML =
          'You are signed in' + who + '.<br><br>' +
          '<span style="color:#fbbf24">⏳ Waiting for an admin to grant you access.</span><br><br>' +
          'Ask <strong>bernat@bookline.ai</strong> to add you from the <em>Admin</em> section. ' +
          'You don\'t need to sign in again — just refresh once they\'ve granted access.';
      }
      if (body) body.style.display = 'none';
    } else if (mode === 'loading') {
      if (title) title.textContent = 'Berni Navigator';
      if (subtitle) subtitle.textContent = 'Signing in…';
      if (body) body.style.display = 'none';
    } else {
      if (title) title.textContent = 'Berni Navigator';
      if (subtitle) subtitle.textContent = 'This app requires sign-in with your Google account.';
      if (body) body.style.display = '';
    }
    const err = document.getElementById('bnAuthError');
    if (err) {
      // If we're showing the sign-in form right after an OAuth callback, the user just went
      // through Google and is being asked to sign in AGAIN. Show a diagnostic so we (and
      // they) can see what broke without opening DevTools.
      const snap = window.__bnBootSnapshot || {};
      const cameFromCallback = !!(snap.hasHashToken || snap.hasQueryCode);
      const hydrateErr = window.__bnHydrateError || null;
      if (options.errorMsg) {
        err.textContent = options.errorMsg;
        err.style.display = '';
      } else if (mode === 'signin' && cameFromCallback) {
        const oauthErr = snap.oauthError;
        const reason = oauthErr
          ? ('OAuth provider error: ' + oauthErr.error + (oauthErr.description ? ' — ' + oauthErr.description : ''))
          : hydrateErr === 'localstorage-blocked'
              ? 'Your browser blocked saving the session (private/incognito mode or storage disabled). Sessions cannot persist here.'
              : hydrateErr === 'jwt-decode'
              ? 'The auth token returned by Google could not be decoded. Please try again or contact the admin.'
              : hydrateErr === 'pkce-timeout'
              ? 'The auth code exchange with Supabase timed out. Your browser may be blocking third-party storage for supabase.co. Try disabling tracking protection for this site, or use a different browser.'
              : hydrateErr === 'no-hash'
              ? 'Returned from Google but no auth tokens were in the URL. Supabase may have stripped them (third-party storage blocked) or the redirect URL is misconfigured.'
              : 'Sign-in did not complete. (hydrate=' + (hydrateErr || 'unknown') + ', hash=' + !!snap.hasHashToken + ', code=' + !!snap.hasQueryCode + ')';
        err.textContent = reason;
        err.style.display = '';
        console.warn('[BN] Showing sign-in form after OAuth callback. Diagnostic:', { snap, hydrateErr });
      } else {
        err.style.display = 'none';
      }
    }
    const out = document.getElementById('bnAuthSignOutBtn');
    if (out) out.style.display = options.showSignOut ? '' : 'none';
  } else {
    gate.classList.add('hidden');
    gate.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('bn-locked');
    // Lift BOTH anti-flash overlays:
    //   • data-bn-oauth-callback: set pre-paint when the URL had OAuth tokens
    //   • data-bn-needs-auth:     set pre-paint when production + no cached session
    // Now that auth has resolved (positively or by switching to localhost behaviour),
    // let the body paint normally.
    try { document.documentElement.removeAttribute('data-bn-oauth-callback'); } catch (_) {}
    try { document.documentElement.removeAttribute('data-bn-needs-auth'); } catch (_) {}
  }
}
async function bnAuthSignInWithGoogle() {
  if (!bnSupabase) { alert('Supabase SDK not loaded. Refresh the page.'); return; }
  try {
    const { error } = await bnSupabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + location.pathname,
        queryParams: { access_type: 'offline', prompt: 'select_account' }
      }
    });
    if (error) bnAuthShowGate(true, { errorMsg: 'Login failed: ' + (error.message||error) });
  } catch (e) {
    bnAuthShowGate(true, { errorMsg: 'Login failed: ' + (e && e.message || e) });
  }
}
async function bnAuthSignOut() {
  if (!bnSupabase) return;
  try { await bnSupabase.auth.signOut(); } catch(_) {}
  bnSupabaseSession = null; bnSupabaseUser = null;
  bnUserPermission = null;
  bnPreviewAsEmail = null;
  window.__bnReadOnly = false;
  // Clear locally cached store so the next user doesn't see the previous one's data
  // even momentarily before pull completes.
  try { localStorage.removeItem(STORE_KEY); } catch(_) {}
  if (BN_AUTH_REQUIRED) bnAuthShowGate(true, {});
}
// Pull store from cloud via the RPC `get_filtered_store(p_preview_email)`.
// Returns server-filtered JSONB based on the caller's permission row:
//   admin           → full store (or, if previewEmail set, filtered as that user)
//   restricted_view → own tasks + redacted shared tasks
//   none / no row   → {} (nothing visible)
function bnRedactStoreInPlace(store) {
  if (!store || !Array.isArray(store.tasks)) return store;
  // Tasks the server marked `_redacted: true` should appear as opaque cards: title and
  // body content blanked, but status/dates preserved so they still appear on calendars.
  for (const t of store.tasks) {
    if (t && t._redacted === true) {
      t.subject = '🔒 (hidden)';
      t.comments = '';
      t.details = '';
      t.description = '';
      // Strip free-text URLs/links and personal fields that could leak info.
      t.url = '';
      t.slackUrl = '';
      t.slackLink = '';
      // Keep status, startDate, endDate, roadmapIds, durationDays untouched.
      // We DO blank ownership so other names don't appear:
      t.responsible = '';
      t.responsibleRaw = '';
      t.proposedBy = '';
      t.proposedByRaw = '';
      t.tags = [];
      t.taskTags = [];
    }
  }
  return store;
}
async function bnSyncPullFromCloud() {
  if (!bnSupabase || !bnSupabaseUser) return;
  try {
    const args = bnPreviewAsEmail ? { p_preview_email: bnPreviewAsEmail } : {};
    const { data, error } = await bnSupabase.rpc('get_filtered_store', args);
    if (error) { console.warn('[BN] pull (rpc) failed:', error.message); return; }
    const filtered = !!(data && data._filtered);
    // A filtered payload should NEVER be pushed back — it's a view, not the source of truth.
    window.__bnReadOnly = filtered || !!bnPreviewAsEmail;
    if (!data || Object.keys(data).length === 0) {
      // No row yet for this admin → seed it with the local STORE.
      if (bnUserPermission === 'admin' && !bnPreviewAsEmail) {
        console.info('[BN] No cloud store yet; uploading local STORE as initial seed.');
        await bnSyncPushToCloud({ immediate: true });
      } else {
        console.info('[BN] Cloud returned no data and caller is not admin; nothing to load.');
      }
    } else {
      // Apply client-side redaction (defense in depth — the server already redacted, but
      // we rewrite to placeholder strings so the existing render code works untouched).
      bnRedactStoreInPlace(data);
      STORE = data;
      try { saveStore(STORE); } catch(_) {}
      if (typeof render === 'function') { try { render(); } catch(_) {} }
      console.info('[BN] Pulled cloud store · tasks:', (STORE.tasks||[]).length, '· filtered:', filtered, '· readOnly:', window.__bnReadOnly);
    }
    // Update read-only banner.
    const banner = document.getElementById('bnReadOnlyBanner');
    const msg = document.getElementById('bnReadOnlyMsg');
    if (banner) {
      if (window.__bnReadOnly) {
        banner.style.display = '';
        if (msg) {
          msg.textContent = bnPreviewAsEmail
            ? ('👁️ Previewing as ' + bnPreviewAsEmail + ' — changes will not be saved. (Exit from Admin to return to your view.)')
            : "Read-only view — your role is restricted_view. Changes don't sync.";
        }
      } else {
        banner.style.display = 'none';
      }
    }
  } catch (e) { console.warn('[BN] pull exception:', e && e.message); }
}
async function bnSyncPushToCloud(options) {
  options = options || {};
  if (!bnSupabase || !bnSupabaseUser || !STORE) return;
  // Block pushes when the local copy is a filtered view (would corrupt the master).
  if (window.__bnReadOnly) {
    console.info('[BN] push skipped — STORE is a filtered/preview copy.');
    return;
  }
  // Only admins write to user_stores.<admin_id>. Restricted users have no writable row.
  if (bnUserPermission && bnUserPermission !== 'admin') {
    console.info('[BN] push skipped — caller is not admin (permission:', bnUserPermission, ')');
    return;
  }
  const doPush = async () => {
    try {
      const { error } = await bnSupabase.from('user_stores').upsert({ user_id: bnSupabaseUser.id, store_data: STORE }, { onConflict: 'user_id' });
      if (error) console.warn('[BN] push failed:', error.message);
    } catch (e) { console.warn('[BN] push exception:', e && e.message); }
  };
  if (options.immediate) return doPush();
  // Debounce so a burst of saveStore calls only triggers one upload.
  if (bnSyncPushTimer) clearTimeout(bnSyncPushTimer);
  bnSyncPushTimer = setTimeout(doPush, 1200);
}
// Reads the caller's permission row. Returns 'admin' | 'restricted_view' | 'none' | null.
// IMPORTANT: BN_ADMIN_EMAIL is ALWAYS admin, regardless of what's in the DB. This avoids
// the failure mode where a stale/incorrect user_permissions row could lock the owner out
// of their own deploy (the DB is only a hint for non-bernat users).
async function bnFetchPermission() {
  if (!bnSupabase || !bnSupabaseUser) { bnUserPermission = null; return null; }
  const email = (bnSupabaseUser.email || '').toLowerCase();
  // Hard override for the owner: always admin.
  if (email === BN_ADMIN_EMAIL) { bnUserPermission = 'admin'; return 'admin'; }
  try {
    const { data, error } = await bnSupabase
      .from('user_permissions')
      .select('permission')
      .eq('user_id', bnSupabaseUser.id)
      .maybeSingle();
    if (error) { console.warn('[BN] permission lookup failed:', error.message); }
    const perm = (data && data.permission) || null;
    bnUserPermission = perm;
    return perm;
  } catch (e) {
    console.warn('[BN] permission lookup exception:', e && e.message);
    return null;
  }
}
// Gate logic in one place: decide what to show based on session + permission.
//   no session       → sign-in gate
//   session, perm=none/null → "waiting for permission" gate (no app data)
//   session, perm=restricted_view/admin → unlock app + pull filtered store (non-blocking)
async function bnAuthResolveGate() {
  const email = bnSupabaseUser && (bnSupabaseUser.email || '');
  if (BN_AUTH_REQUIRED && !bnSupabaseUser) {
    bnAuthShowGate(true, {});
    return;
  }
  if (!bnSupabaseUser) {
    bnAuthShowGate(false);
    return;
  }
  const perm = await bnFetchPermission();
  if (perm === 'admin' || perm === 'restricted_view') {
    // Unlock UI IMMEDIATELY — don't block on the cloud pull. The local STORE is already
    // available (either from a previous pull or as a deploy-seeded baseline), and the
    // background pull will refresh it without making the user wait.
    bnAuthShowGate(false);
    if (typeof bnUpdateAdminNavVisibility === 'function') bnUpdateAdminNavVisibility();
    if (typeof render === 'function') { try { render(); } catch(_) {} }
    // Fire-and-forget: pull from cloud in the background.
    bnSyncPullFromCloud().catch(e => console.warn('[BN] background pull error:', e && e.message));
  } else {
    bnAuthShowGate(true, { mode: 'waiting', email: email, showSignOut: true });
  }
}
// Decode a JWT payload (no signature verification — we trust the URL came from Supabase OAuth).
// Uses TextDecoder for UTF-8 safety (the legacy escape()/atob() pattern fails on some
// payloads, particularly when user_metadata contains non-ASCII characters).
function bnDecodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) { console.warn('[BN] JWT decode: token does not have 3 parts (got ' + parts.length + ')'); return null; }
    // base64url → base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(parts[1].length + (4 - parts[1].length % 4) % 4, '=');
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const text = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(text);
  } catch (e) {
    console.warn('[BN] JWT decode failed:', e && e.message);
    return null;
  }
}
// Synchronously parse OAuth tokens out of the URL hash, decode the JWT, and persist
// the Supabase session to localStorage. Returns the user object (or null).
// This runs BEFORE the SDK so we don't depend on `setSession()` (which has been observed
// to hang indefinitely on this project) and we don't pay the cost of an HTTP round trip.
function bnHydrateSessionFromHashSync() {
  // Capture WHY hydration failed so the auth gate can show a useful message.
  // Possible reasons: 'no-hash', 'no-token-param', 'jwt-decode', 'localstorage-blocked', 'exception'
  window.__bnHydrateError = null;
  try {
    if (!location.hash || location.hash.indexOf('access_token=') === -1) {
      window.__bnHydrateError = 'no-hash';
      console.info('[BN] sync hydrate: no access_token in URL hash');
      return null;
    }
    const params = new URLSearchParams(location.hash.slice(1));
    const access_token = params.get('access_token');
    if (!access_token) {
      window.__bnHydrateError = 'no-token-param';
      console.warn('[BN] sync hydrate: hash has access_token=... but URLSearchParams returned null');
      return null;
    }
    const refresh_token = params.get('refresh_token') || '';
    const expires_in = parseInt(params.get('expires_in') || '3600', 10);
    const token_type = params.get('token_type') || 'bearer';
    const provider_token = params.get('provider_token') || null;
    const payload = bnDecodeJwtPayload(access_token);
    if (!payload || !payload.sub) {
      window.__bnHydrateError = 'jwt-decode';
      console.warn('[BN] sync hydrate: JWT decode returned no payload or no sub');
      return null;
    }
    const user = {
      id: payload.sub,
      aud: payload.aud || 'authenticated',
      role: payload.role || 'authenticated',
      email: payload.email || '',
      phone: payload.phone || '',
      app_metadata: payload.app_metadata || { provider: 'google', providers: ['google'] },
      user_metadata: payload.user_metadata || {},
      identities: payload.identities || [],
      created_at: payload.created_at || new Date().toISOString(),
      updated_at: payload.updated_at || new Date().toISOString()
    };
    const session = {
      access_token,
      refresh_token,
      expires_in,
      expires_at: payload.exp || (Math.floor(Date.now() / 1000) + expires_in),
      token_type,
      provider_token,
      user
    };
    const m = BN_SUPABASE_URL.match(/^https?:\/\/([^.]+)\./);
    const ref = m ? m[1] : '';
    let storageWriteOK = false;
    try {
      localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify(session));
      // Verify the write actually persisted (Safari incognito/private mode reports success
      // but quota is 0; some privacy extensions intercept setItem silently).
      storageWriteOK = !!localStorage.getItem('sb-' + ref + '-auth-token');
    } catch (e) {
      console.warn('[BN] sync hydrate: localStorage.setItem threw:', e && e.message);
    }
    if (!storageWriteOK) {
      window.__bnHydrateError = 'localstorage-blocked';
      console.warn('[BN] sync hydrate: localStorage write FAILED — session will not persist across reloads. ' +
                   'Browser likely in private/incognito mode or has storage blocked.');
      // Still set in-memory user so the current page can work.
    }
    // Wipe tokens out of the URL so they don't linger in history.
    try { history.replaceState(null, '', location.pathname + location.search); } catch(_) {}
    bnSupabaseSession = session;
    bnSupabaseUser = user;
    console.info('[BN] ✓ Hydrated session synchronously from hash · user:', user.email, '· localStorage OK:', storageWriteOK);
    return user;
  } catch (e) {
    window.__bnHydrateError = 'exception';
    console.warn('[BN] sync hydrate exception:', e && e.message, e && e.stack);
    return null;
  }
}
// Parse any OAuth error returned in the callback URL (Supabase may redirect back with
// `#error=...&error_description=...` or `?error=...` when the OAuth flow failed).
function bnParseOAuthError() {
  try {
    const hash = location.hash || '';
    const search = location.search || '';
    let error = null;
    let description = null;
    if (hash.indexOf('error=') !== -1) {
      const p = new URLSearchParams(hash.slice(1));
      error = p.get('error') || p.get('error_code');
      description = p.get('error_description');
    } else if (search.indexOf('error=') !== -1) {
      const p = new URLSearchParams(search.slice(1));
      error = p.get('error') || p.get('error_code');
      description = p.get('error_description');
    }
    return error ? { error, description: description || '' } : null;
  } catch (_) { return null; }
}
async function bnAuthBoot() {
  if (!bnSupabase) {
    if (BN_AUTH_REQUIRED) bnAuthShowGate(true, { errorMsg: 'Could not load the Supabase SDK. Check your connection.' });
    return;
  }
  // If the callback came back as a PKCE code (`?code=...`), the SDK with
  // `detectSessionInUrl: true` will exchange it for a session asynchronously. We give it
  // up to 5s to fire SIGNED_IN, otherwise we surface a clear error to the user.
  // (We still default to implicit flow in createClient, so this path is mainly for
  // in-flight callbacks that started under the previous deploy.)
  if (!bnSupabaseUser && bnQueryHasOAuth) {
    console.info('[BN] auth boot: waiting for SDK to exchange PKCE code for session…');
    const exchanged = await new Promise(resolve => {
      let done = false;
      const finish = (val) => { if (!done) { done = true; resolve(val); } };
      try {
        const sub = bnSupabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session && session.user) {
            try { sub && sub.data && sub.data.subscription && sub.data.subscription.unsubscribe(); } catch (_) {}
            finish(session);
          }
        });
      } catch (e) { console.warn('[BN] onAuthStateChange subscribe failed:', e && e.message); }
      setTimeout(() => finish(null), 5000);
    });
    if (exchanged) {
      bnSupabaseSession = exchanged;
      bnSupabaseUser = exchanged.user;
      console.info('[BN] ✓ PKCE exchange completed · user:', bnSupabaseUser.email);
      // Wipe ?code= from URL so a refresh doesn't try to exchange again.
      try { history.replaceState(null, '', location.pathname); } catch (_) {}
    } else {
      console.warn('[BN] PKCE exchange timed out (5s). The Supabase SDK could not exchange the auth code.');
      window.__bnHydrateError = 'pkce-timeout';
    }
  }
  // FAST PATH: if we have OAuth tokens in the URL hash, we already hydrated them
  // synchronously above. Just resolve the gate immediately — no SDK round-trip needed.
  // SLOW PATH: no hash tokens → fall back to getSession (which reads localStorage).
  if (!bnSupabaseUser) {
    try {
      const session = await Promise.race([
        bnSupabase.auth.getSession().then(({ data }) => data && data.session || null),
        new Promise(resolve => setTimeout(() => resolve(null), 1500))
      ]);
      // Fallback: read localStorage directly if SDK still didn't yield a session.
      let resolved = session;
      if (!resolved) {
        try {
          const m = BN_SUPABASE_URL.match(/^https?:\/\/([^.]+)\./);
          const ref = m ? m[1] : '';
          const raw = localStorage.getItem('sb-' + ref + '-auth-token');
          if (raw) resolved = JSON.parse(raw);
        } catch (_) {}
      }
      bnSupabaseSession = resolved || null;
      bnSupabaseUser = (resolved && resolved.user) || null;
    } catch (e) {
      console.warn('[BN] auth boot error:', e && e.message);
      if (BN_AUTH_REQUIRED) bnAuthShowGate(true, { errorMsg: 'Auth boot error: ' + (e && e.message || e) });
      return;
    }
  }
  console.info('[BN] boot session resolved · user:', bnSupabaseUser && bnSupabaseUser.email);
  await bnAuthResolveGate();
  // Re-evaluate on session changes. We deduplicate by user-id so spurious
  // INITIAL_SESSION / TOKEN_REFRESHED events don't keep re-rendering the gate.
  try {
    bnSupabase.auth.onAuthStateChange(async (event, session) => {
      const newUid = (session && session.user && session.user.id) || null;
      const oldUid = (bnSupabaseUser && bnSupabaseUser.id) || null;
      console.info('[BN] auth event:', event, '· uid changed?', newUid !== oldUid);
      if (newUid === oldUid) return; // no state change, nothing to do
      bnSupabaseSession = session || null;
      bnSupabaseUser = (session && session.user) || null;
      await bnAuthResolveGate();
    });
  } catch (_) {}
}
// Hydrate session from OAuth hash AS EARLY AS POSSIBLE — before DOMContentLoaded — so the
// user never sees the sign-in form flash after a successful Google consent.
//   • Implicit flow → tokens in the hash. We can hydrate synchronously.
//   • PKCE flow     → only `?code=...` in the query. The SDK has to exchange the code for a
//                     session asynchronously (1-3s). We can't hydrate synchronously; we just
//                     record that we're in a callback so the gate stays in "loading" mode
//                     while the SDK's onAuthStateChange fires.
const bnHashHasOAuth = !!(location.hash && location.hash.indexOf('access_token=') !== -1);
const bnQueryHasOAuth = /[?&]code=/.test(location.search || '');
const bnIsOAuthCallback = bnHashHasOAuth || bnQueryHasOAuth;
// Capture the boot-time URL state so we can show it in the diagnostic panel if auth fails.
window.__bnBootSnapshot = {
  href: location.href,
  hasHashToken: bnHashHasOAuth,
  hasQueryCode: bnQueryHasOAuth,
  hashLen: (location.hash || '').length,
  searchLen: (location.search || '').length,
  oauthError: bnParseOAuthError(),
  userAgent: navigator.userAgent,
  startedAt: new Date().toISOString()
};
console.info('[BN] auth boot snapshot:', window.__bnBootSnapshot);
if (window.__bnBootSnapshot.oauthError) {
  console.warn('[BN] OAuth provider returned an error:', window.__bnBootSnapshot.oauthError);
}
if (bnHashHasOAuth && bnSupabase) {
  // Note: bnSupabaseUser and bnSupabaseSession will be set as a side effect.
  try { bnHydrateSessionFromHashSync(); } catch (_) {}
}
if (bnQueryHasOAuth) {
  // PKCE callback path. The SDK will do the code-for-token exchange because we passed
  // `detectSessionInUrl: true`. Just log this so we can correlate with onAuthStateChange.
  console.info('[BN] Detected PKCE auth code in URL — waiting for SDK to exchange it.');
}
// Also hydrate user from a non-expired cached session in localStorage. The pre-paint head
// script already set `data-bn-cached-session` so the CSS hides the gate. We just need to
// populate bnSupabaseUser now so bnAuthResolveGate doesn't fall through to "show sign-in".
const bnHasCachedSession = document.documentElement.getAttribute('data-bn-cached-session') === '1';
if (bnHasCachedSession && !bnSupabaseUser) {
  try {
    const m = BN_SUPABASE_URL.match(/^https?:\/\/([^.]+)\./);
    const ref = m ? m[1] : '';
    const raw = localStorage.getItem('sb-' + ref + '-auth-token');
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && cached.user) {
        bnSupabaseSession = cached;
        bnSupabaseUser = cached.user;
      }
    }
  } catch (_) {}
}
// Wire the gate buttons once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const inBtn = document.getElementById('bnAuthSignInBtn');
  if (inBtn) inBtn.addEventListener('click', bnAuthSignInWithGoogle);
  const outBtn = document.getElementById('bnAuthSignOutBtn');
  if (outBtn) outBtn.addEventListener('click', bnAuthSignOut);
  // Initial gate state. Three paths:
  //   • Cached valid session → don't show the gate at all; the app shell paints directly.
  //   • Just came back from OAuth → loading overlay (handled pre-paint by the head script).
  //   • Neither → sign-in form.
  if (BN_AUTH_REQUIRED) {
    if (bnHasCachedSession) {
      // CSS already hides the gate; just make sure the body isn't locked.
      document.body.classList.remove('bn-locked');
    } else if (bnIsOAuthCallback || bnSupabaseUser) {
      // Either the URL is mid-OAuth (hash tokens or PKCE ?code=) or we already have a user
      // (because bnHydrateSessionFromHashSync just populated it). Either way, show "loading"
      // instead of the sign-in form so the user doesn't think they need to click again.
      bnAuthShowGate(true, { mode: 'loading' });
    } else {
      bnAuthShowGate(true, {});
    }
  }
  bnAuthBoot();
});
