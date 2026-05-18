// =============================================================================
// views/requests.js
// ---------------------------------------------------------------------------
// Requests page view. Loaded AFTER the inline app script so its references to STORE,
// helpers, escapeHtml, etc., are all resolved via the shared classic-script
// scope. The function name stays the same so call-sites in inline (e.g. the
// central render() dispatcher) keep working unchanged.
// =============================================================================

function renderRequestsPage() {
  const cont = document.getElementById('requestsPageContent');
  if (!cont) return;
  if (!bnGetPassphrase()) {
    cont.innerHTML =
      '<div class="rq-locked-card">' +
        '<h3>🔒 Unlock requests</h3>' +
        '<p>Enter the passphrase to decrypt the request feed. Stored locally on this device — only asked once.</p>' +
        '<input type="password" id="bnPpInput" class="search-input" placeholder="Passphrase">' +
        '<button class="btn primary" id="bnPpBtn" style="margin-top:8px">Unlock</button>' +
        '<div class="rq-pp-err" id="bnPpErr">Wrong passphrase. Try again.</div>' +
      '</div>';
    document.getElementById('bnPpBtn').addEventListener('click', async () => {
      const v = document.getElementById('bnPpInput').value.trim();
      if (!v) return;
      bnSavePassphrase(v);
      const result = await bnLoadRequests();
      if (result.ok) {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          try { Notification.requestPermission(); } catch (_) {}
        }
        renderRequestsPage();
      } else {
        bnSavePassphrase('');
        document.getElementById('bnPpErr').style.display = '';
      }
    });
    document.getElementById('bnPpInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('bnPpBtn').click();
    });
    setTimeout(() => document.getElementById('bnPpInput')?.focus(), 0);
    return;
  }

  // Guard: if the admin just came back from a preview-as session (page was reloaded with
  // localStorage cleared), STORE.requestActions starts as {} and incomingRequestsCache is
  // populated independently from the network. Without a sync flag, every cached request
  // would render as "pending" until bnSyncPullFromCloud arrives. Show a quiet loading
  // state until the cloud sync completes — render() is called from bnSyncPullFromCloud's
  // success path, so we'll be re-invoked automatically.
  const adminOwnView = (typeof bnUserPermission !== 'undefined' && bnUserPermission === 'admin' &&
                       (typeof bnPreviewAsEmail === 'undefined' || !bnPreviewAsEmail));
  if (adminOwnView && typeof bnSupabaseUser !== 'undefined' && bnSupabaseUser && !window.__bnCloudSyncedAt) {
    cont.innerHTML = '<div class="rq-empty">Syncing requests…</div>';
    return;
  }

  const pending = bnPendingRequests();
  const handled = bnHandledRequests();
  let html = '';
  const lastSync = requestsLastSyncedAt ? new Date(requestsLastSyncedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  html += '<div class="rq-toolbar">' +
    '<div class="rq-sync-info">Last synced: <strong>' + escapeHtml(lastSync) + '</strong></div>' +
    '<button class="btn" id="bnSyncNowBtn">⟳ Sync now</button>' +
    '</div>';
  html += '<div class="rq-section-title"><span>Pending</span><span class="count">' + pending.length + '</span></div>';
  if (pending.length === 0) html += '<div class="rq-empty">No pending requests. New requests posted to #berni will appear here.</div>';
  else html += '<div class="rq-list">' + pending.map(r => rqCardHtml(r, null)).join('') + '</div>';
  html += '<div class="rq-section-title rq-section-toggle" id="rqHistoryToggle">' +
    '<span><span class="caret">' + (requestsCollapsedHistory ? '▸' : '▾') + '</span> History</span>' +
    '<span class="count">' + handled.length + '</span>' +
    '</div>';
  if (!requestsCollapsedHistory && handled.length > 0) {
    html += '<div class="rq-list">' + handled.map(r => rqCardHtml(r, STORE.requestActions[r.ts])).join('') + '</div>';
  } else if (!requestsCollapsedHistory) {
    html += '<div class="rq-empty">No handled requests yet.</div>';
  }
  cont.innerHTML = html;
  const syncBtn = document.getElementById('bnSyncNowBtn');
  if (syncBtn) syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true; syncBtn.textContent = '… loading';
    await bnLoadRequests();
    renderRequestsPage();
  });
  const histToggle = document.getElementById('rqHistoryToggle');
  if (histToggle) histToggle.addEventListener('click', () => {
    const v = !requestsCollapsedHistory;
    localStorage.setItem('bn-requests-history-collapsed', v ? '1' : '0');
    location.reload();
  });
  cont.querySelectorAll('.rq-card').forEach(card => {
    const ts = card.dataset.ts;
    card.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const act = btn.dataset.act;
        const r = incomingRequestsCache.find(x => x.ts === ts);
        if (!r) return;
        if (act === 'approve') {
          // Open the standard New Task modal pre-filled with this request's defaults.
          // Saving the modal will create the task AND mark the request as approved.
          openModal('new', {
            subject: r.subject || '',
            extraComments: r.extraComments || '',
            responsibleId: null,           // sin responsable por defecto
            responsibleRaw: '',
            priority: '',
            type: '',
            slackStatus: 'Proposed',
            shareWith: r.privacyLevel || '',
            taskTags: [],
            _fromRequestTs: ts             // backlink — saveBtn marks request approved
          });
        } else if (act === 'reject' || act === 'dismiss') {
          STORE.requestActions[ts] = { action: (act === 'reject' ? 'rejected' : 'dismissed'), at: Date.now() };
          saveStore(STORE);
          bnUpdateRequestsBadge();
          renderRequestsPage();
        } else if (act === 'undo') {
          delete STORE.requestActions[ts];
          saveStore(STORE);
          bnUpdateRequestsBadge();
          renderRequestsPage();
        }
      });
    });
    // Both proposed-by chips and the submitter chip (in .rq-meta) navigate to Profile
    card.querySelectorAll('.chip[data-pid]').forEach(chip => {
      chip.addEventListener('click', e => {
        e.stopPropagation();
        if (typeof setProfilePerson === 'function') setProfilePerson(chip.dataset.pid);
        switchView('profile');
      });
    });
    card.querySelectorAll('a[data-open-task]').forEach(a => {
      a.addEventListener('click', e => { e.preventDefault(); if (typeof openModal === 'function') openModal(a.dataset.openTask); });
    });
  });
}

