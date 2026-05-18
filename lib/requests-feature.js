// =============================================================================
// lib/requests-feature.js
// ---------------------------------------------------------------------------
// Slack-ingest "Requests" feature: encrypted-blob fetch from the Pages
// repo, decryption, periodic refresh, notification trigger, badge update,
// and helpers used by the Requests page renderer.
//
// Loaded AFTER inline.  All references (STORE, openModal, switchView) are
// resolved at runtime via the shared classic-script scope.  The Requests
// boot lines at the bottom of this file run once when the script loads,
// which is after the DOM + STORE are ready.
// =============================================================================

// =================== REQUESTS FEATURE ===================
// Declarations must come BEFORE setTasksViewMode/switchView to avoid
// temporal-dead-zone errors when render() runs early on the requests view.
var incomingRequestsCache = [];
var requestsLastSyncedAt = null;
var requestsCollapsedHistory = (localStorage.getItem('bn-requests-history-collapsed') === '1');  // default: expanded
if (!STORE.requestActions) STORE.requestActions = {};

// Apply saved tasks view mode visually before first switchView
setTasksViewMode(tasksViewMode);

function bnGetPassphrase() { return localStorage.getItem('bn-requests-passphrase') || ''; }
function bnSavePassphrase(p) {
  if (p) localStorage.setItem('bn-requests-passphrase', p);
  else localStorage.removeItem('bn-requests-passphrase');
}

async function bnDecryptRequests(blob, passphrase) {
  const enc = new TextEncoder();
  const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const salt = fromB64(blob.salt);
  const iv = fromB64(blob.iv);
  const tag = fromB64(blob.tag);
  const ct = fromB64(blob.ct);
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct);
  combined.set(tag, ct.length);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
  return new TextDecoder().decode(pt);
}

async function bnLoadRequests(opts) {
  opts = opts || {};
  try {
    const res = await fetch('requests.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) { incomingRequestsCache = []; bnUpdateRequestsBadge(); return { ok: true, empty: true }; }
    const blob = await res.json();
    if (Array.isArray(blob)) { incomingRequestsCache = []; bnUpdateRequestsBadge(); return { ok: true, empty: true }; }
    if (!blob || !blob.encrypted) { bnUpdateRequestsBadge(); return { ok: false, reason: 'unknown-format' }; }
    const passphrase = bnGetPassphrase();
    if (!passphrase) { bnUpdateRequestsBadge(); return { ok: false, reason: 'no-passphrase' }; }
    const decrypted = await bnDecryptRequests(blob, passphrase);
    const store = JSON.parse(decrypted);
    incomingRequestsCache = store.items || [];
    requestsLastSyncedAt = (store._meta && store._meta.syncedAt) || null;
    bnUpdateRequestsBadge();
    if (!opts.skipNotify) bnMaybeNotifyNew();
    // If user is currently on the Requests page, refresh the cards now that data arrived.
    if (typeof currentView !== 'undefined' && currentView === 'requests') {
      try { renderRequestsPage(); } catch (_) {}
    }
    return { ok: true };
  } catch (e) {
    console.error('bnLoadRequests:', e);
    incomingRequestsCache = [];
    bnUpdateRequestsBadge();
    return { ok: false, reason: 'decrypt-failed' };
  }
}

function bnPendingRequests() {
  const actions = STORE.requestActions || {};
  return incomingRequestsCache.filter(r => !actions[r.ts]);
}
function bnHandledRequests() {
  const actions = STORE.requestActions || {};
  return incomingRequestsCache.filter(r => actions[r.ts]).sort((a, b) => (actions[b.ts].at || 0) - (actions[a.ts].at || 0));
}

function bnUpdateRequestsBadge() {
  const el = document.getElementById('nav-requests-count');
  if (!el) return;
  // Reset previous state
  el.classList.remove('nav-count-alert');
  const navBtn = el.closest('.nav-item');
  if (navBtn) navBtn.classList.remove('nav-item-alert');
  if (!bnGetPassphrase()) { el.textContent = '🔒'; el.title = 'Enter passphrase to unlock'; return; }
  // CRITICAL: hide the count until the cloud sync has populated STORE.requestActions.
  // Otherwise on boot we'd flash a red badge with the full request count (because
  // requestActions starts empty before the pull arrives — and bnPendingRequests filters
  // by !actions[r.ts]). The badge stays blank until __bnCloudSyncedAt is set; once the
  // pull completes, render() fires which re-renders the sidebar and calls us again.
  const needsCloud = (typeof bnSupabaseUser !== 'undefined' && bnSupabaseUser &&
                     typeof bnUserPermission !== 'undefined' && bnUserPermission === 'admin' &&
                     (typeof bnPreviewAsEmail === 'undefined' || !bnPreviewAsEmail));
  if (needsCloud && !window.__bnCloudSyncedAt) {
    el.textContent = '';
    el.title = 'Syncing…';
    return;
  }
  const n = bnPendingRequests().length;
  el.textContent = n > 0 ? n : '';
  el.title = n > 0 ? (n + ' pending request' + (n === 1 ? '' : 's')) : '';
  // When there are pending requests, paint the sidebar item red so it stands out.
  if (n > 0) {
    el.classList.add('nav-count-alert');
    if (navBtn) navBtn.classList.add('nav-item-alert');
  }
}

let bnLastSeenTs = parseFloat(localStorage.getItem('bn-requests-last-seen-ts') || '0');
function bnMaybeNotifyNew() {
  const newest = incomingRequestsCache.reduce((max, r) => Math.max(max, parseFloat(r.ts)), 0);
  if (newest > bnLastSeenTs) {
    const newOnes = incomingRequestsCache.filter(r => parseFloat(r.ts) > bnLastSeenTs && !(STORE.requestActions || {})[r.ts]);
    if (newOnes.length > 0 && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('Berni Navigator — nuevos requests', {
          body: newOnes.length === 1 ? newOnes[0].subject : (newOnes.length + ' nuevos requests pendientes'),
          tag: 'bn-requests'
        });
      } catch (_) {}
    }
    bnLastSeenTs = newest;
    localStorage.setItem('bn-requests-last-seen-ts', String(newest));
  }
}

function rqCardHtml(r, handled) {
  const submittedBy = findPerson(r.submittedById);
  // Submitter is rendered as the same chip used for proposed-by (clickable → profile)
  const subChip = submittedBy
    ? '<span class="chip" data-pid="' + submittedBy.id + '"><span class="av" style="background:' + (submittedBy.color || '#9a9a9a') + '">' +
        (submittedBy.photo ? '<img src="' + escapeHtml(submittedBy.photo) + '" alt="" onerror="this.remove()">' : escapeHtml(initials(submittedBy.name))) +
      '</span>' + escapeHtml(submittedBy.displayName || submittedBy.name) + '</span>'
    : '<span>' + escapeHtml(r.submittedById || '?') + '</span>';
  const dateStr = r.submittedAt ? new Date(r.submittedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const proposedHtml = (r.proposedByIds || []).map(pid => {
    const p = findPerson(pid);
    if (!p) return '<span class="chip"><span class="av" style="background:#9a9a9a;color:#fff">?</span>' + escapeHtml(pid) + '</span>';
    const ini = initials(p.name);
    return '<span class="chip" data-pid="' + p.id + '"><span class="av" style="background:' + (p.color || '#9a9a9a') + '">' +
      (p.photo ? '<img src="' + escapeHtml(p.photo) + '" alt="" onerror="this.remove()">' : escapeHtml(ini)) +
      '</span>' + escapeHtml(p.displayName || p.name) + '</span>';
  }).join('');
  const action = handled ? handled.action : null;
  let html = '<div class="rq-card' + (handled ? ' handled' : '') + '" data-ts="' + escapeHtml(r.ts) + '">';
  html += '<div class="rq-head">';
  html += '<h4>' + escapeHtml(r.subject) + '</h4>';
  if (action) html += '<span class="rq-handled-badge ' + action + '">' + action + '</span>';
  html += '</div>';
  html += '<div class="rq-meta">';
  html += subChip;
  if (dateStr) { html += '<span class="sep">·</span><span>' + escapeHtml(dateStr) + '</span>'; }
  if (r.privacyLevel) { html += '<span class="sep">·</span><span class="rq-privacy">' + escapeHtml(r.privacyLevel) + '</span>'; }
  html += '</div>';
  if (proposedHtml) html += '<div class="rq-section"><div class="rq-label">Proposed by</div><div class="rq-proposed">' + proposedHtml + '</div></div>';
  if (r.extraComments) html += '<div class="rq-section"><div class="rq-label">Comments</div><div class="rq-comments">' + escapeHtml(r.extraComments) + '</div></div>';
  html += '<div class="rq-actions">';
  if (handled) {
    html += '<button class="btn rq-undo-btn" data-act="undo" title="Move back to pending"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg> Undo</button>';
    if (handled.action === 'approved' && handled.taskId) html += '<a class="rq-link" href="#" data-open-task="' + escapeHtml(handled.taskId) + '">View created task →</a>';
  } else {
    html += '<button class="btn approve" data-act="approve">Approve</button>';
    html += '<button class="btn reject" data-act="reject">Reject</button>';
    html += '<button class="btn dismiss" data-act="dismiss">Dismiss</button>';
  }
  if (r.permalink) html += '<a class="rq-link" href="' + escapeHtml(r.permalink) + '" target="_blank" rel="noopener">View in Slack ↗</a>';
  html += '</div></div>';
  return html;
}

// Boot: load requests on page start and every 90s
bnLoadRequests({ skipNotify: true });
setInterval(() => bnLoadRequests(), 90 * 1000);
if (typeof Notification !== 'undefined' && Notification.permission === 'default' && bnGetPassphrase()) {
  document.addEventListener('click', function once() {
    document.removeEventListener('click', once);
    try { Notification.requestPermission(); } catch (_) {}
  });
}

