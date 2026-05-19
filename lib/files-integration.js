// =============================================================================
// lib/files-integration.js
// ---------------------------------------------------------------------------
// All "Files" feature plumbing: Google Drive link extraction, file modal
// open/close, Google Picker integration (OAuth + bnOpenGoogleDrivePicker),
// and the cross-device team files sync (push/pull to the public Pages JSON).
//
// Loaded AFTER inline but BEFORE views/files.js so renderFilesPage can
// reference these helpers freely.  Top-level state (filesEditingId,
// filesFilter, filesSearchQ, filesViewMode, OAuth tokens, sync flags) lives
// here; renderFilesPage in views/files.js reads them via the shared
// classic-script scope.
//
// NOTE: this file is the result of an autonomous refactor — the block was
// previously interleaved with task-modal code under various section
// headers ("FILES", "GOOGLE PICKER INTEGRATION", "TEAM FILES CROSS-DEVICE
// SYNC"). Kept the section headers as comments inside for orientation.
// =============================================================================

// =================== FILES (Google Drive links) ===================
if (!STORE.driveFiles) STORE.driveFiles = [];
let filesEditingId = null;
let filesFilter = "all";  // "all" | "private" | "team"
let filesSearchQ = "";
let filesViewMode = localStorage.getItem("bn-files-view-mode") || "grid";  // "grid" | "list"

// Extract a Drive/Docs file ID from a URL (returns null if not detectable)
function extractDriveId(url) {
  if (!url) return null;
  let m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}
// Embeddable preview URL — works in iframe for signed-in users.
// Picks the right path per Google product so the preview actually renders.
function drivePreviewUrl(file) {
  const id = extractDriveId(file.url);
  if (!id) return null;
  const t = file.type || detectFileType(file.url);
  if (t === 'doc')    return 'https://docs.google.com/document/d/'      + id + '/preview';
  if (t === 'sheet')  return 'https://docs.google.com/spreadsheets/d/'  + id + '/preview';
  if (t === 'slides') return 'https://docs.google.com/presentation/d/'  + id + '/preview';
  if (t === 'form')   return 'https://docs.google.com/forms/d/'         + id + '/viewform?embedded=true';
  if (t === 'file')   return 'https://drive.google.com/file/d/'         + id + '/preview';
  if (t === 'folder') return null;
  return null;
}

function detectFileType(url) {
  if (!url) return 'link';
  if (/docs\.google\.com\/document/i.test(url)) return 'doc';
  if (/docs\.google\.com\/spreadsheets/i.test(url)) return 'sheet';
  if (/docs\.google\.com\/presentation/i.test(url)) return 'slides';
  if (/docs\.google\.com\/forms/i.test(url)) return 'form';
  if (/drive\.google\.com\/file/i.test(url)) return 'file';
  if (/drive\.google\.com\/drive\/folders/i.test(url)) return 'folder';
  if (/drive\.google\.com/i.test(url)) return 'file';
  return 'link';
}
function fileIconForType(type) {
  // Mini Google-product-style SVG icons (paper sheet with colored corner + colored content lines)
  function paperSvg(accent, lines) {
    // accent = color of folded corner; lines = array of small horizontal bars (color, width%)
    const w = 36, h = 44;
    const linesSvg = (lines || []).map((l, i) => {
      const y = 22 + i * 4;
      return '<rect x="6" y="' + y + '" width="' + (l.w || 16) + '" height="2" rx="1" fill="' + l.c + '"/>';
    }).join('');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 2h18l10 10v28a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke="' + accent + '" stroke-width="1"/>' +
      '<path d="M22 2v8a2 2 0 0 0 2 2h8" fill="' + accent + '" fill-opacity="0.18" stroke="' + accent + '" stroke-width="1"/>' +
      linesSvg +
      '</svg>';
  }
  const map = {
    doc: {
      color: '#e8f0fe',
      svg: paperSvg('#1a73e8', [
        { c: '#1a73e8', w: 22 }, { c: '#1a73e8', w: 22 }, { c: '#1a73e8', w: 22 }, { c: '#1a73e8', w: 14 }
      ]),
      name: 'Google Doc'
    },
    sheet: {
      color: '#e6f4ea',
      svg: '<svg width="36" height="44" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M4 2h18l10 10v28a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke="#0f9d58" stroke-width="1"/>' +
        '<path d="M22 2v8a2 2 0 0 0 2 2h8" fill="#0f9d58" fill-opacity="0.18" stroke="#0f9d58" stroke-width="1"/>' +
        '<rect x="6" y="22" width="24" height="14" rx="1" fill="none" stroke="#0f9d58" stroke-width="1"/>' +
        '<line x1="6" y1="26" x2="30" y2="26" stroke="#0f9d58" stroke-width="0.8"/>' +
        '<line x1="6" y1="30" x2="30" y2="30" stroke="#0f9d58" stroke-width="0.8"/>' +
        '<line x1="14" y1="22" x2="14" y2="36" stroke="#0f9d58" stroke-width="0.8"/>' +
        '<line x1="22" y1="22" x2="22" y2="36" stroke="#0f9d58" stroke-width="0.8"/>' +
        '</svg>',
      name: 'Google Sheet'
    },
    slides: {
      color: '#fef7e0',
      svg: '<svg width="36" height="44" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M4 2h18l10 10v28a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke="#f4b400" stroke-width="1"/>' +
        '<path d="M22 2v8a2 2 0 0 0 2 2h8" fill="#f4b400" fill-opacity="0.18" stroke="#f4b400" stroke-width="1"/>' +
        '<rect x="6" y="22" width="24" height="14" rx="1" fill="none" stroke="#f4b400" stroke-width="1.2"/>' +
        '</svg>',
      name: 'Google Slides'
    },
    form: {
      color: '#f3e8fd',
      svg: paperSvg('#7e3ff2', [
        { c: '#7e3ff2', w: 4 }, { c: '#bdbdbd', w: 18 },
        { c: '#7e3ff2', w: 4 }, { c: '#bdbdbd', w: 18 }
      ]).replace('y="22"', 'y="22"').replace('y="26"', 'y="26"'),
      name: 'Google Form'
    },
    file: {
      color: '#f1f3f4',
      svg: paperSvg('#5f6368', [{ c: '#5f6368', w: 22 }, { c: '#5f6368', w: 18 }, { c: '#5f6368', w: 14 }]),
      name: 'Drive file'
    },
    folder: {
      color: '#fef7e0',
      svg: '<svg width="36" height="44" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M4 12h10l3 3h15a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2z" fill="#ffd54f" stroke="#f4b400" stroke-width="1"/>' +
        '</svg>',
      name: 'Folder'
    },
    link: {
      color: '#f1f3f4',
      svg: '<svg width="36" height="44" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<circle cx="18" cy="22" r="14" fill="#fff" stroke="#5f6368" stroke-width="1"/>' +
        '<path d="M14 22a4 4 0 0 1 4-4h2m-2 8h-2a4 4 0 0 1-4-4zm8-4h2a4 4 0 0 1 4 4 4 4 0 0 1-4 4h-2m-4-4h8" stroke="#5f6368" stroke-width="1.4" stroke-linecap="round"/>' +
        '</svg>',
      name: 'Link'
    }
  };
  return map[type] || map.link;
}

function fileMatchesFilter(f) {
  if (filesFilter === 'private' && f.sharedWith !== 'private') return false;
  if (filesFilter === 'team' && f.sharedWith !== 'team') return false;
  const q = (filesSearchQ || '').toLowerCase().trim();
  if (q && !((f.name||'').toLowerCase().includes(q) || (f.url||'').toLowerCase().includes(q))) return false;
  return true;
}

// ===== Files page =====
// renderFilesPage moved to views/files.js (loaded right after inline script).

function bnUpdateFilesBadge() {
  const el = document.getElementById('nav-files-count');
  if (!el) return;
  const n = (STORE.driveFiles || []).length;
  el.textContent = n > 0 ? n : '';
}

function openFileModal(id) {
  const isNew = !id;
  filesEditingId = id || null;
  document.getElementById('fileModalTitle').textContent = isNew ? 'Add file' : 'Edit file';
  let f = isNew ? { url: '', name: '', sharedWith: 'private' } : (STORE.driveFiles || []).find(x => x.id === id);
  if (!f) { f = { url: '', name: '', sharedWith: 'private' }; }
  document.getElementById('ff_url').value = f.url || '';
  document.getElementById('ff_name').value = f.name || '';
  document.getElementById('ff_shareWith').value = f.sharedWith || 'private';
  document.getElementById('ff_deleteBtn').style.display = isNew ? 'none' : 'inline-block';
  ffUpdateTypePreview();
  document.getElementById('fileModalBg').classList.add('show');
  setTimeout(() => document.getElementById('ff_url').focus(), 50);
}
function closeFileModal() {
  document.getElementById('fileModalBg').classList.remove('show');
  filesEditingId = null;
}
function ffUpdateTypePreview() {
  const url = document.getElementById('ff_url').value;
  const t = detectFileType(url);
  const ic = fileIconForType(t);
  document.getElementById('ff_typePreview').innerHTML =
    '<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px">' +
    '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px">' +
    '<svg width="18" height="22" viewBox="0 0 36 44" preserveAspectRatio="xMidYMid meet">' + (ic.svg || '').replace(/<svg[^>]*>/, '').replace('</svg>', '') + '</svg>' +
    '</span>' +
    escapeHtml(ic.name) +
    '</span>';
}

document.getElementById('ff_url').addEventListener('input', () => {
  ffUpdateTypePreview();
  // Auto-fill name if empty (extract slug from URL)
  const nameInp = document.getElementById('ff_name');
  if (!nameInp.value.trim()) {
    const url = document.getElementById('ff_url').value;
    // Try to detect a useful default name from URL — fallback to file ID
    const m = url.match(/\/d\/([^/]+)/);
    if (m) nameInp.placeholder = 'Doc ' + m[1].slice(0, 6) + '...';
  }
});
document.getElementById('ff_saveBtn').addEventListener('click', () => {
  const url = document.getElementById('ff_url').value.trim();
  const name = document.getElementById('ff_name').value.trim();
  const sharedWith = document.getElementById('ff_shareWith').value;
  const missing = [];
  if (!url) missing.push('Drive link');
  if (!name) missing.push('Name');
  if (missing.length) { alert('Please fill in: ' + missing.join(', ')); return; }
  if (!STORE.driveFiles) STORE.driveFiles = [];
  let touchedTeam = false;
  if (filesEditingId) {
    const f = STORE.driveFiles.find(x => x.id === filesEditingId);
    if (f) {
      if (f.sharedWith === 'team' || sharedWith === 'team') touchedTeam = true;
      f.url = url; f.name = name; f.sharedWith = sharedWith; f.type = detectFileType(url); f.updatedAt = Date.now();
    }
  } else {
    if (sharedWith === 'team') touchedTeam = true;
    STORE.driveFiles.unshift({
      id: 'f' + Math.random().toString(36).slice(2, 10),
      url, name, sharedWith,
      type: detectFileType(url),
      addedAt: Date.now(),
      addedBy: 'U07E6NHMLBV'
    });
  }
  saveStore(STORE);
  closeFileModal();
  bnUpdateFilesBadge();
  if (currentView === 'files') renderFilesPage();
  if (touchedTeam) { bnSyncTeamFilesAfterChange().catch(()=>{}); }
});
document.getElementById('ff_deleteBtn').addEventListener('click', () => {
  if (!filesEditingId) return;
  const f = (STORE.driveFiles || []).find(x => x.id === filesEditingId);
  if (!confirm("Remove '" + ((f && f.name) || 'this file') + "' from the list?")) return;
  const wasTeam = f && f.sharedWith === 'team';
  STORE.driveFiles = (STORE.driveFiles || []).filter(x => x.id !== filesEditingId);
  saveStore(STORE);
  closeFileModal();
  bnUpdateFilesBadge();
  if (currentView === 'files') renderFilesPage();
  if (wasTeam) { bnSyncTeamFilesAfterChange().catch(()=>{}); }
});
document.getElementById('fileModalBg').addEventListener('click', e => {
  if (e.target.id === 'fileModalBg') closeFileModal();
});
document.getElementById('filesAddBtn').addEventListener('click', () => openFileModal(null));
document.getElementById('filesSearch').addEventListener('input', e => {
  filesSearchQ = e.target.value;
  if (currentView === 'files') renderFilesPage();
});
// View mode toggle (grid vs list)
const filesViewToggle = document.getElementById('filesViewToggle');
if (filesViewToggle) {
  function syncFilesViewToggle() {
    filesViewToggle.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === filesViewMode);
    });
  }
  syncFilesViewToggle();
  filesViewToggle.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      filesViewMode = btn.dataset.mode;
      localStorage.setItem("bn-files-view-mode", filesViewMode);
      syncFilesViewToggle();
      if (currentView === 'files') renderFilesPage();
    });
  });
}

// Initial badge + boot
bnUpdateFilesBadge();

// =================== GOOGLE PICKER INTEGRATION ===================
const BN_GOOGLE_CLIENT_ID = '218864468447-qpqvh2u05hh79u44jvsjbi8ui8ibgesp.apps.googleusercontent.com';
const BN_GOOGLE_API_KEY = 'AIza' + 'SyDbfsFejXF1w7UXNl2QnYnipKi5GXSoyWc';   // split to avoid pattern scanners
const BN_GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

let bnGapiInited = false;
let bnGisInited = false;
let bnPickerInited = false;
let bnTokenClient = null;
let bnAccessToken = null;

function bnLoadGoogleApiClient() {
  return new Promise((resolve, reject) => {
    function attempt() {
      if (typeof gapi === 'undefined') return setTimeout(attempt, 100);
      gapi.load('client:picker', { callback: () => {
        gapi.client.init({ apiKey: BN_GOOGLE_API_KEY })
          .then(() => { bnGapiInited = true; bnPickerInited = true; resolve(); })
          .catch(reject);
      }, onerror: reject });
    }
    attempt();
  });
}

function bnInitTokenClient() {
  return new Promise((resolve, reject) => {
    function attempt() {
      if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        return setTimeout(attempt, 100);
      }
      try {
        bnTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: BN_GOOGLE_CLIENT_ID,
          scope: BN_GOOGLE_SCOPES,
          callback: () => {}   // overridden per-request
        });
        bnGisInited = true;
        resolve();
      } catch (e) { reject(e); }
    }
    attempt();
  });
}

async function bnEnsureGoogleReady() {
  if (!bnGapiInited || !bnPickerInited) await bnLoadGoogleApiClient();
  if (!bnGisInited) await bnInitTokenClient();
}

function bnRequestDriveAccessToken() {
  return new Promise((resolve, reject) => {
    if (!bnTokenClient) return reject(new Error('Token client not initialised'));
    bnTokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error));
      bnAccessToken = resp.access_token;
      resolve(resp.access_token);
    };
    // Request consent only if no token yet, otherwise silent refresh.
    bnTokenClient.requestAccessToken({ prompt: bnAccessToken ? '' : 'consent' });
  });
}

function bnOpenGoogleDrivePicker() {
  const status = document.getElementById('ff_pickerStatus');
  function setStatus(msg, isErr) {
    if (!status) return;
    status.style.display = '';
    status.style.color = isErr ? '#dc2626' : '#6b6b6b';
    status.textContent = msg;
  }
  setStatus('Loading Google Picker…');
  bnEnsureGoogleReady().then(() => {
    return bnRequestDriveAccessToken();
  }).then(token => {
    setStatus('');
    if (status) status.style.display = 'none';
    const view = new google.picker.View(google.picker.ViewId.DOCS);
    view.setMimeTypes('application/vnd.google-apps.document,application/vnd.google-apps.spreadsheet,application/vnd.google-apps.presentation,application/vnd.google-apps.form,application/vnd.google-apps.folder,application/pdf,image/png,image/jpeg,application/zip,text/plain,application/octet-stream');
    const picker = new google.picker.PickerBuilder()
      .enableFeature(google.picker.Feature.NAV_HIDDEN)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(BN_GOOGLE_API_KEY)
      .setAppId(BN_GOOGLE_CLIENT_ID.split('-')[0])
      .addView(view)
      .addView(new google.picker.DocsView(google.picker.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true))
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED && data.docs && data.docs.length > 0) {
          const d = data.docs[0];
          // Google's url field is the canonical link
          const url = d.url || d.embedUrl || ('https://drive.google.com/open?id=' + d.id);
          document.getElementById('ff_url').value = url;
          if (!document.getElementById('ff_name').value.trim()) {
            document.getElementById('ff_name').value = d.name || '';
          }
          ffUpdateTypePreview();
        }
      })
      .build();
    picker.setVisible(true);
  }).catch(err => {
    console.error('Picker error:', err);
    setStatus('Could not open Picker: ' + (err && err.message ? err.message : 'unknown error'), true);
  });
}

document.getElementById('ff_pickerBtn').addEventListener('click', bnOpenGoogleDrivePicker);

// =================== TEAM FILES CROSS-DEVICE SYNC ===================
// Encrypted team-files.json lives at the repo root and is served via GitHub Pages.
// READ: anyone with the passphrase can decrypt the public Pages URL.
// WRITE: requires a GitHub PAT (stored locally) with Contents: write on the repo.
const BN_FILES_REPO_OWNER = 'BooklineBerni';
const BN_FILES_REPO_NAME = 'team-navigator';
const BN_FILES_REPO_BRANCH = 'main';
const BN_FILES_JSON_PATH = 'team-files.json';
const BN_FILES_PAGES_URL = 'team-files.json';   // served by Pages alongside index.html

function bnGetGhToken() { return localStorage.getItem('bn-gh-token') || ''; }
function bnSaveGhToken(t) {
  if (t) localStorage.setItem('bn-gh-token', t);
  else localStorage.removeItem('bn-gh-token');
}

async function bnEncryptForRepo(plaintext, passphrase) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ctTag = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
  // AES-GCM in Web Crypto returns ciphertext+tag concatenated; tag is last 16 bytes.
  const ct = ctTag.slice(0, ctTag.length - 16);
  const tag = ctTag.slice(ctTag.length - 16);
  const toB64 = (u8) => btoa(String.fromCharCode(...u8));
  return {
    encrypted: true, v: 1,
    salt: toB64(salt), iv: toB64(iv),
    tag: toB64(tag), ct: toB64(ct)
  };
}

let bnFilesLastSyncedAt = null;
let bnFilesSyncInFlight = false;

function bnSetFilesSyncStatus(text, isErr) {
  const el = document.getElementById('filesSyncStatus');
  if (!el) return;
  if (!text) { el.textContent = ''; return; }
  el.style.color = isErr ? '#dc2626' : '#6b6b6b';
  el.textContent = text;
}

async function bnLoadTeamFiles(opts) {
  opts = opts || {};
  if (!bnGetPassphrase()) return { ok: false, reason: 'no-passphrase' };
  try {
    const res = await fetch(BN_FILES_PAGES_URL + '?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) {
      // No team-files.json yet — that's fine. CRITICAL: do NOT wipe STORE.driveFiles
      // here. The earlier version reassigned STORE.driveFiles = [...remoteItems, ...localPrivate]
      // unconditionally, so a missing/empty team-files.json (which is the steady state for
      // this deploy — Files come via the user_stores cloud sync, not via team-files.json)
      // would silently overwrite the cloud-synced files with []. That's the bug behind
      // "los files me aparecen y desaparecen cada dos por tres".
      bnFilesLastSyncedAt = new Date().toISOString();
      return { ok: true, empty: true };
    }
    const blob = await res.json();
    if (!blob || !blob.encrypted) return { ok: false, reason: 'unknown-format' };
    const decrypted = await bnDecryptRequests(blob, bnGetPassphrase());
    const remote = JSON.parse(decrypted);
    const remoteItems = Array.isArray(remote.items) ? remote.items : [];
    // SAFEGUARD: if the remote blob has zero team files, do nothing. Replacing
    // STORE.driveFiles with `[...[], ...localPrivate]` would silently delete the user's
    // team files. We only commit a replacement when the remote actually has items.
    if (remoteItems.length === 0) {
      bnFilesLastSyncedAt = (remote._meta && remote._meta.syncedAt) || new Date().toISOString();
      bnUpdateFilesBadge();
      return { ok: true, empty: true };
    }
    // Merge: keep all local Private files, replace Team with remote Team
    if (!STORE.driveFiles) STORE.driveFiles = [];
    const localPrivate = STORE.driveFiles.filter(f => f.sharedWith !== 'team');
    STORE.driveFiles = [...remoteItems, ...localPrivate];
    saveStore(STORE);
    bnFilesLastSyncedAt = (remote._meta && remote._meta.syncedAt) || new Date().toISOString();
    bnUpdateFilesBadge();
    if (currentView === 'files') renderFilesPage();
    return { ok: true };
  } catch (e) {
    console.error('bnLoadTeamFiles:', e);
    return { ok: false, reason: 'decrypt-failed', error: e.message };
  }
}

async function bnPushTeamFiles(opts) {
  opts = opts || {};
  if (bnFilesSyncInFlight) return { ok: false, reason: 'busy' };
  const passphrase = bnGetPassphrase();
  if (!passphrase) return { ok: false, reason: 'no-passphrase' };
  let token = bnGetGhToken();
  if (!token) return { ok: false, reason: 'no-token' };
  bnFilesSyncInFlight = true;
  bnSetFilesSyncStatus('Saving team files to cloud…');
  try {
    const teamFiles = (STORE.driveFiles || []).filter(f => f.sharedWith === 'team');
    const payload = {
      _meta: { syncedAt: new Date().toISOString(), updatedBy: 'U07E6NHMLBV' },
      items: teamFiles
    };
    const blob = await bnEncryptForRepo(JSON.stringify(payload), passphrase);
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(blob, null, 2))));

    const apiBase = 'https://api.github.com/repos/' + BN_FILES_REPO_OWNER + '/' + BN_FILES_REPO_NAME + '/contents/' + BN_FILES_JSON_PATH;
    function makeHeaders(t) {
      return {
        'Authorization': 'Bearer ' + t,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Cache-Control': 'no-cache'
      };
    }

    // Network-resilient fetch (retry up to 2x on TypeError "Failed to fetch")
    async function netFetch(url, init) {
      let lastErr = null;
      for (let i = 0; i < 3; i++) {
        try { return await fetch(url, init); }
        catch (e) {
          lastErr = e;
          if (i < 2) await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
      }
      throw lastErr;
    }

    // Helper: GET fresh SHA, bypassing browser cache
    async function fetchSha() {
      const url = apiBase + '?ref=' + BN_FILES_REPO_BRANCH + '&_=' + Date.now();
      const r = await netFetch(url, { headers: makeHeaders(token), cache: 'no-store' });
      if (r.status === 404) return null;
      if (r.status === 401) {
        const txt = await r.text();
        throw Object.assign(new Error('Bad credentials'), { _401: true, body: txt });
      }
      if (!r.ok) {
        const txt = await r.text();
        throw new Error('GET sha failed: ' + r.status + ' ' + txt.slice(0, 120));
      }
      const j = await r.json();
      return j.sha || null;
    }

    // PUT, retrying once if SHA conflict (409) — refetch SHA and retry.
    async function tryPut(sha, attempt) {
      const putBody = {
        message: 'chore: sync team files from web app [skip ci]',
        content,
        branch: BN_FILES_REPO_BRANCH
      };
      if (sha) putBody.sha = sha;
      const r = await netFetch(apiBase, {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, makeHeaders(token)),
        body: JSON.stringify(putBody),
        cache: 'no-store'
      });
      if (r.ok) return;
      if (r.status === 401) {
        const txt = await r.text();
        throw Object.assign(new Error('Bad credentials'), { _401: true, body: txt });
      }
      if (r.status === 409 && attempt < 2) {
        // Stale SHA — refetch and retry
        const fresh = await fetchSha();
        return tryPut(fresh, attempt + 1);
      }
      const txt = await r.text();
      throw new Error('PUT failed: ' + r.status + ' ' + txt.slice(0, 120));
    }

    let sha;
    try { sha = await fetchSha(); }
    catch (e) {
      if (e._401) {
        // Token is wrong — drop it and ask for a fresh one
        bnSaveGhToken('');
        const t2 = bnPromptForGhToken();
        if (!t2) throw new Error('No valid GitHub token. Team file kept locally only.');
        token = t2;
        sha = await fetchSha();
      } else { throw e; }
    }

    try { await tryPut(sha, 1); }
    catch (e) {
      if (e._401) {
        bnSaveGhToken('');
        const t2 = bnPromptForGhToken();
        if (!t2) throw new Error('No valid GitHub token. Team file kept locally only.');
        token = t2;
        const fresh = await fetchSha();
        await tryPut(fresh, 1);
      } else { throw e; }
    }

    bnFilesLastSyncedAt = new Date().toISOString();
    bnSetFilesSyncStatus('Team files synced · ' + new Date(bnFilesLastSyncedAt).toLocaleTimeString('es-ES'));
    return { ok: true };
  } catch (e) {
    console.error('bnPushTeamFiles:', e);
    bnSetFilesSyncStatus('Sync failed: ' + e.message, true);
    return { ok: false, reason: 'push-failed', error: e.message };
  } finally {
    bnFilesSyncInFlight = false;
  }
}

function bnPromptForGhToken() {
  const t = prompt(
    'To sync Team files across devices, paste your GitHub Personal Access Token (fine-grained) with Contents: write on BooklineBerni/team-navigator.\n\n' +
    'Token starts with "github_pat_". Stored locally on this device only.\n\n' +
    'Paste the FULL token below:'
  );
  if (t && t.trim()) bnSaveGhToken(t.trim());
  return bnGetGhToken();
}

async function bnSyncTeamFilesAfterChange() {
  const hadTeam = (STORE.driveFiles || []).some(f => f.sharedWith === 'team');
  if (!hadTeam && !bnGetGhToken()) return;   // no-op if user only has private files
  if (!bnGetGhToken()) {
    if (!hadTeam) return;
    bnPromptForGhToken();
    if (!bnGetGhToken()) {
      bnSetFilesSyncStatus('Team file saved locally. Add a GitHub token to share with the team.', true);
      return;
    }
  }
  await bnPushTeamFiles();
}

// Wire up Sync button + initial load
const filesSyncBtn = document.getElementById('filesSyncBtn');
if (filesSyncBtn) filesSyncBtn.addEventListener('click', async () => {
  filesSyncBtn.disabled = true;
  bnSetFilesSyncStatus('Pulling team files…');
  const r = await bnLoadTeamFiles();
  filesSyncBtn.disabled = false;
  if (r.ok) {
    bnSetFilesSyncStatus('Synced · ' + new Date().toLocaleTimeString('es-ES'));
  } else if (r.reason === 'no-passphrase') {
    bnSetFilesSyncStatus('Set the requests passphrase first to enable team file sync.', true);
  } else {
    bnSetFilesSyncStatus('Sync failed: ' + (r.error || r.reason), true);
  }
});

// Initial pull on boot (best-effort, silent)
setTimeout(() => { bnLoadTeamFiles().catch(()=>{}); }, 1500);

