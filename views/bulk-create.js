// =============================================================================
// views/bulk-create.js
// ---------------------------------------------------------------------------
// "Bulk Create tasks" two-stage modal (Stage 1: subjects + comments rows or
// paste; Stage 2: full task editor per row with anchors / dates / pickers).
//
//   - Loaded AFTER the inline app script. All references to STORE, saveStore,
//     render, escapeHtml, findPerson, getRoadmaps, etc. resolve through the
//     shared classic-script scope; they're invoked from event handlers so
//     timing is not an issue.
//   - `bnInitBulkCreateUI()` is called from inline's bnInitBackupUI() on
//     DOMContentLoaded — by then this file has finished loading.
//   - State and functions are declared at top level (no IIFE wrapper) so they
//     stay accessible by the same names that the inline script used pre-split.
//
// Public surface (callable from inline and from this file's own event wiring):
//   state:   bnBulkRows, bnBulkDrafts, bnBulkDefaultsDraft, bnBulkVisibleFields
//   funcs:   bnBulkResetDefaultsDraft, bnBulkOpenModal, bnBulkCloseModal,
//            bnBulkShowStage, bnBulkSetMode, bnBulkAddRow,
//            bnBulkUpdateStage1Count, bnBulkParsePasteToRows,
//            bnBulkGetPeopleList, bnBulkPopulateApplyDropdowns,
//            bnBulkRenderRows, bnBulkGoToStage2,
//            bnBulkRenderFieldToggles, bnBulkApplyFieldVisibility,
//            bnBulkRenderStage2, bnBulkBackToStage1,
//            bnBulkApplyDefaultsToAll, bnBulkParseDate, bnBulkFmtDate,
//            bnBulkAddDays, bnBulkDaysBetween, bnBulkRecalcDates,
//            bnBulkAnchorLabel, bnBulkOpenAnchorPicker, bnBulkAnchorRow,
//            bnBulkSave, bnInitBulkCreateUI
// =============================================================================

// ===== Bulk Create tasks =====
// Each row in stage 1 = {subject, extraComments}. After Next, each becomes a full task draft in stage 2.
let bnBulkRows = [];     // stage 1 data: [{subject, extraComments}]
let bnBulkDrafts = [];   // stage 2 data: full task draft per row
let bnBulkDefaultsDraft = { _tmpId:'_defaults', subject:'', extraComments:'', type:'', slackStatus:'', priority:'', responsibleId:'', proposedById:'', proposedByIds:[], shareWith:'', estimatedHours:'', dedicatedHours:'', startDate:'', endDate:'', durationDays:'', startAnchor:'', endAnchor:'', parentGroupId:'', roadmapId:'', roadmapIds:[], taskTag:'', taskTags:[], isGroup:false };
function bnBulkResetDefaultsDraft(){ bnBulkDefaultsDraft = { _tmpId:'_defaults', subject:'', extraComments:'', type:'', slackStatus:'', priority:'', responsibleId:'', proposedById:'', proposedByIds:[], shareWith:'', estimatedHours:'', dedicatedHours:'', startDate:'', endDate:'', durationDays:'', startAnchor:'', endAnchor:'', parentGroupId:'', roadmapId:'', roadmapIds:[], taskTag:'', taskTags:[], isGroup:false }; }

function bnBulkOpenModal(){
  const m = document.getElementById('bnBulkCreateModal');
  if (!m) return;
  m.classList.add('open');
  bnBulkRows = [
    { subject: '', extraComments: '' },
    { subject: '', extraComments: '' },
    { subject: '', extraComments: '' },
  ];
  bnBulkDrafts = [];
  bnBulkShowStage(1);
  bnBulkSetMode('rows');
  bnBulkRenderRows();
  // Reset paste textareas
  const sa = document.getElementById('bnBulkPasteSubjects'); if (sa) sa.value = '';
  const ca = document.getElementById('bnBulkPasteComments'); if (ca) ca.value = '';
  setTimeout(()=>{
    try {
      const first = document.querySelector('#bnBulkTableBody input[data-f="subject"]');
      if (first) first.focus();
    } catch(_){}
  }, 80);
}

function bnBulkCloseModal(){
  const m = document.getElementById('bnBulkCreateModal');
  if (m) m.classList.remove('open');
}

function bnBulkShowStage(n){
  document.getElementById('bnBulkStage1').style.display = (n===1) ? '' : 'none';
  document.getElementById('bnBulkStage2').style.display = (n===2) ? '' : 'none';
}

function bnBulkSetMode(mode){
  const rb1 = document.querySelector('input[name="bnBulkMode"][value="rows"]');
  const rb2 = document.querySelector('input[name="bnBulkMode"][value="paste"]');
  if (rb1 && mode==='rows') rb1.checked = true;
  if (rb2 && mode==='paste') rb2.checked = true;
  document.getElementById('bnBulkRowsMode').style.display = mode==='rows' ? '' : 'none';
  document.getElementById('bnBulkPasteMode').style.display = mode==='paste' ? '' : 'none';
}

function bnBulkAddRow(){
  bnBulkRows.push({ subject: '', extraComments: '' });
  bnBulkRenderRows();
  setTimeout(()=>{
    try {
      const inputs = document.querySelectorAll('#bnBulkTableBody input[data-f="subject"]');
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.scrollIntoView({block:'nearest'}); }
    } catch(_){}
  }, 30);
}

function bnBulkUpdateStage1Count(){
  const n = bnBulkRows.filter(r => (r.subject||'').trim()).length;
  const a = document.getElementById('bnBulkCount'); if (a) a.textContent = n;
  const b = document.getElementById('bnBulkS1Count'); if (b) b.textContent = n;
}

function bnBulkParsePasteToRows(){
  const sa = document.getElementById('bnBulkPasteSubjects');
  const ca = document.getElementById('bnBulkPasteComments');
  if (!sa) return [];
  const subs = (sa.value||'').split(/\r?\n/);
  const cmts = ((ca && ca.value) || '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < subs.length; i++) {
    const s = (subs[i]||'').trim();
    if (!s) continue;
    out.push({ subject: s, extraComments: (cmts[i]||'').trim() });
  }
  return out;
}

function bnBulkGetPeopleList(){
  let list = [];
  if (typeof TEAM !== 'undefined' && Array.isArray(TEAM)) list = list.concat(TEAM);
  if (typeof EXTERNAL_TEAM !== 'undefined' && Array.isArray(EXTERNAL_TEAM)) list = list.concat(EXTERNAL_TEAM);
  // Dedupe by id
  const seen = new Set();
  return list.filter(p => p && p.id && !seen.has(p.id) && (seen.add(p.id), true))
             .sort((a,b)=> (a.name||a.email||'').localeCompare(b.name||b.email||''));
}

// Kept as a stable entry-point. The Apply-all panel is rendered as a draft-style card
// by bnBulkRenderStage2 (since v13), so the only job here is resetting the defaults draft.
function bnBulkPopulateApplyDropdowns(){
  bnBulkResetDefaultsDraft();
}

function bnBulkRenderRows(){
  const tbody = document.getElementById('bnBulkTableBody');
  if (!tbody) return;
  const esc = s => String(s==null?'':s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  let html = '';
  bnBulkRows.forEach((r, idx) => {
    html += '<tr data-idx="' + idx + '">';
    html += '<td style="text-align:center; color:#9a9a9a; font-size:11px;">' + (idx+1) + '</td>';
    html += '<td><input type="text" data-f="subject" placeholder="Subject…" value="' + esc(r.subject) + '"></td>';
    html += '<td><input type="text" data-f="extraComments" placeholder="(optional) Extra comments…" value="' + esc(r.extraComments) + '"></td>';
    html += '<td style="text-align:center;"><button class="bn-bulk-row-del" data-action="del" title="Remove this row">✕</button></td>';
    html += '</tr>';
  });
  tbody.innerHTML = html;
  bnBulkUpdateStage1Count();

  tbody.querySelectorAll('tr').forEach(tr => {
    const idx = parseInt(tr.dataset.idx, 10);
    tr.querySelectorAll('input[data-f]').forEach(el => {
      const f = el.dataset.f;
      el.addEventListener('input', () => { bnBulkRows[idx][f] = el.value; bnBulkUpdateStage1Count(); });
    });
    const delBtn = tr.querySelector('button[data-action="del"]');
    if (delBtn) delBtn.addEventListener('click', () => {
      bnBulkRows.splice(idx, 1);
      if (bnBulkRows.length === 0) bnBulkRows.push({ subject: '', extraComments: '' });
      bnBulkRenderRows();
    });
  });
}

function bnBulkGoToStage2(){
  // Collect rows: from current mode
  const modeRadio = document.querySelector('input[name="bnBulkMode"]:checked');
  const mode = modeRadio ? modeRadio.value : 'rows';
  let rows = [];
  if (mode === 'paste') {
    rows = bnBulkParsePasteToRows();
  } else {
    rows = bnBulkRows.filter(r => (r.subject||'').trim()).map(r => ({
      subject: (r.subject||'').trim(),
      extraComments: (r.extraComments||'').trim(),
    }));
  }
  if (rows.length === 0) { alert('No subjects filled in. Type at least one before continuing.'); return; }

  // Build drafts for stage 2 (one per row, with default field values + _tmpId for cross-anchoring)
  bnBulkDrafts = rows.map((r, i) => ({
    _tmpId: 'bndraft_' + Date.now().toString(36) + '_' + i,
    subject: r.subject,
    extraComments: r.extraComments,
    type: '',
    slackStatus: '',
    priority: '',
    responsibleId: '',
    proposedById: '',
    shareWith: '',
    estimatedHours: '',
    dedicatedHours: '',
    roadmapId: '',
    taskTag: '',
    parentGroupId: '',
    startDate: '',
    endDate: '',
    durationDays: '',
    startAnchor: '',
    endAnchor: '',
    isGroup: false,
  }));

  bnBulkShowStage(2);
  bnBulkPopulateApplyDropdowns();
  bnBulkRenderFieldToggles();
  bnBulkRenderStage2();
}

// Field definitions: key, label, kind, classFlag (for CSS visibility)
const BN_BULK_FIELDS = [
  { key:'type',            label:'Type',         kind:'colored' },
  { key:'slackStatus',     label:'Status',       kind:'colored' },
  { key:'priority',        label:'Priority',     kind:'colored' },
  { key:'responsibleId',   label:'Responsible',  kind:'person' },
  { key:'proposedById',    label:'Proposed by',  kind:'person' },
  { key:'shareWith',       label:'Share with',   kind:'colored' },
  { key:'estimatedHours',  label:'Est. h.',      kind:'number' },
  { key:'dedicatedHours',  label:'Ded. h.',      kind:'number' },
  { key:'dates',           label:'Dates',        kind:'dates' },
  { key:'parentGroupId',   label:'Parent group', kind:'group' },
  { key:'taskTag',         label:'Task tag',     kind:'tasktag' },
  { key:'roadmapId',       label:'Roadmap',      kind:'roadmap' },
  { key:'isGroup',         label:'Group', kind:'checkbox' },
  { key:'comments',        label:'Comments',     kind:'view-only' },
];
let bnBulkVisibleFields = {};
BN_BULK_FIELDS.forEach(f => { if (bnBulkVisibleFields[f.key] === undefined) bnBulkVisibleFields[f.key] = true; });

function bnBulkRenderFieldToggles(){
  const bar = document.getElementById('bnBulkFieldToggles');
  if (!bar) return;
  // Inline SVG for eye on/off — one icon with optional slash overlay
  const EYE_SVG = '<svg class="eye-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path>' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '<line class="eye-slash" x1="3" y1="3" x2="21" y2="21" stroke-width="2.4"></line>' +
    '</svg>';
  let html = '<span class="toggles-label">Visible fields</span>';
  BN_BULK_FIELDS.forEach(f => {
    const on = bnBulkVisibleFields[f.key] !== false;
    html += '<button type="button" class="bn-eye-toggle' + (on ? '' : ' is-off') + '" data-vis="' + f.key + '" title="' + (on ? 'Click to hide' : 'Click to show') + ' ' + f.label + '">' +
      EYE_SVG +
      '<span class="label-text">' + f.label + '</span>' +
      '</button>';
  });
  const collapsed = window._bnBulkTogglesCollapsed === true;
  html += '<button type="button" class="toggles-collapse-btn" id="bnBulkTogglesCollapse">' + (collapsed ? 'Show ▾' : 'Hide ▴') + '</button>';
  bar.innerHTML = html;
  if (collapsed) bar.classList.add('collapsed'); else bar.classList.remove('collapsed');
  const collBtn = bar.querySelector('#bnBulkTogglesCollapse');
  if (collBtn) collBtn.addEventListener('click', () => {
    window._bnBulkTogglesCollapsed = !window._bnBulkTogglesCollapsed;
    bnBulkRenderFieldToggles();
  });
  bar.querySelectorAll('button[data-vis]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.vis;
      bnBulkVisibleFields[key] = !(bnBulkVisibleFields[key] !== false);
      btn.classList.toggle('is-off', bnBulkVisibleFields[key] === false);
      btn.title = (bnBulkVisibleFields[key] !== false ? 'Click to hide' : 'Click to show') + ' ' + key;
      bnBulkApplyFieldVisibility();
    });
  });
  bnBulkApplyFieldVisibility();
}

function bnBulkApplyFieldVisibility(){
  const list = document.getElementById('bnBulkStage2List');
  if (!list) return;
  BN_BULK_FIELDS.forEach(f => {
    const cls = 'bn-bulk-hide-' + f.key;
    if (bnBulkVisibleFields[f.key] === false) list.classList.add(cls);
    else list.classList.remove(cls);
  });
}

function bnBulkRenderStage2(){
  const list = document.getElementById('bnBulkStage2List');
  if (!list) return;
  const esc = s => String(s==null?'':s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  const TYPES = ['','Project','Responsability','Request','ERROR','Infinite'];
  const PRIOS = ['','Critical','Alta','Media','Baja','Muy Baja'];
  const SHARES = ['','Private','Team','Everyone'];
  const STATUSES = Object.keys(STATUS_ORDER || {"":0,"Waiting":1,"Proposed":2,"Later / Next":3,"In Progress":4,"Under Review":5,"Completed":6,"Archived":7,"Discarded":8});
  const people = bnBulkGetPeopleList();
  const roadmaps = STORE.roadmaps || [];
  const taskTags = STORE.taskTagLibrary || [];

  function selectOpts(values, selected){
    return values.map(v => {
      const val = (typeof v === 'object') ? v.value : v;
      const lab = (typeof v === 'object') ? v.label : v;
      return '<option value="' + esc(val) + '"' + (val === selected ? ' selected' : '') + '>' + esc(lab || '— (empty) —') + '</option>';
    }).join('');
  }

  // Build per-card HTML — used for actual drafts AND for the apply-all defaults pseudo-draft (idx=-1).
  function buildCardHtml(d, idx) {
    const isDefaults = (idx === -1);
    let html = '';
    html += '<div class="bn-bulk-task-card' + (isDefaults?' bn-bulk-defaults-card':'') + '" data-idx="' + idx + '">';
    html += '<div class="card-head">';
    if (isDefaults) {
      html += '<span class="idx" style="background:#1a1a1a;color:#fff">Default</span>';
      html += '<div class="subject" style="color:#6b6b6b;font-style:italic">Apply these defaults to every task below</div>';
      html += '<button class="card-del primary apply-btn" data-action="apply-defaults" title="Apply" style="background:#1a1a1a;color:#fff;border:1px solid #1a1a1a;border-radius:6px;padding:4px 12px;font-weight:600">Apply</button>';
    } else {
      html += '<span class="idx">#' + (idx+1) + '</span>';
      html += '<div class="subject">' + esc(d.subject) + '</div>';
      html += '<button class="card-del" data-action="del" title="Remove this task">Remove</button>';
    }
    html += '</div>';
    if (!isDefaults && d.extraComments) html += '<div class="comments">' + esc(d.extraComments) + '</div>';

    html += '<div class="bn-bulk-fields-row">';
    // Colored pickers (Status/Priority/Type/ShareWith) — clone of task modal's bn-cp-box
    function cpBox(fkey, fieldKey){
      const opts = COLORED_PICKLIST_OPTIONS[fkey] || [];
      const cur = d[fieldKey] || '';
      const curOpt = opts.find(o => o.value === cur) || opts[0] || { value:'', label:'—', bg:'#fff', fg:'#1a1a1a', border:'#ececea' };
      const cpId = 'bnbk_' + idx + '_' + fieldKey;
      let h = '<div class="bn-cp-box" data-cp-id="' + cpId + '" data-bdraft="' + idx + '" data-bfkey="' + fieldKey + '" data-boptkey="' + fkey + '">';
      h += '<div class="bn-cp-chip" tabindex="0" style="background:' + curOpt.bg + '; color:' + curOpt.fg + '; border-color:' + curOpt.border + '; border-style:solid; border-width:1px;">';
      h += '<span class="bn-cp-label">' + esc(curOpt.label || '—') + '</span>';
      h += '<span class="bn-cp-caret">▾</span>';
      h += '</div>';
      h += '<div class="bn-cp-dropdown" style="display:none">';
      h += opts.map(o => '<div class="bn-cp-item" data-value="' + esc(o.value) + '" style="background:' + o.bg + '; color:' + o.fg + '"><span class="bn-cp-check">' + (o.value === cur ? '✓' : '') + '</span><span>' + esc(o.label) + '</span></div>').join('');
      h += '</div>';
      h += '</div>';
      return h;
    }
    // type
    html += '<div class="bnf bnf-type"><span class="bnf-label">Type</span>' + cpBox('f_type', 'type') + '</div>';
    // status
    html += '<div class="bnf bnf-slackStatus"><span class="bnf-label">Status</span>' + cpBox('f_slackStatus', 'slackStatus') + '</div>';
    // priority
    html += '<div class="bnf bnf-priority"><span class="bnf-label">Priority</span>' + cpBox('f_priority', 'priority') + '</div>';
    // Person picker (responsibleId, proposedById) — replicates task modal's resp-picker-box exactly.
    // Source: TEAM + EXTERNAL_TEAM; grouped by section (team / supplementary); disabled excluded.
    function bulkAvHtml(p){
      const ini = (typeof initials === 'function') ? initials(p.name||'') : (p.name||'?').slice(0,1).toUpperCase();
      const color = p.color || '#9a9a9a';
      const photo = p.photo || p.imageUrl || '';
      const photoImg = photo ? '<img src="'+esc(photo)+'" alt="" onerror="this.remove()">' : '';
      return '<span class="av-mini" style="background:'+color+'">'+photoImg+'<span class="ini">'+esc(ini)+'</span></span>';
    }
    function bulkSectionClass(p){
      try { const sec = (typeof getPersonSection === 'function') ? getPersonSection(p.id) : ''; if (sec === 'team') return 'psec-team'; if (sec === 'supplementary') return 'psec-supplementary'; if (sec === 'disabled') return 'psec-disabled'; return 'psec-bookline'; } catch(_) { return 'psec-bookline'; }
    }
    function personBox(fieldKey, currentId, emptyLabel){
      const cur = currentId ? findPerson(currentId) : null;
      const pid = 'bnbk_p_' + idx + '_' + fieldKey;
      const isProposed = (fieldKey === 'proposedById');
      const chipExtra = (cur && isProposed) ? ' ' + bulkSectionClass(cur) : '';
      let h = '<div class="bn-bulk-resp-box resp-picker-box" data-brp-id="' + pid + '" data-bdraft="' + idx + '" data-bfkey="' + fieldKey + '"' + (isProposed?' data-proposed="1"':'') + '>';
      h += '<div class="bn-bulk-resp-chip resp-picker-chip' + chipExtra + '" tabindex="0">';
      if (cur) {
        h += bulkAvHtml(cur) + '<span class="resp-picker-name">' + esc(cur.displayName||cur.name||'?') + '</span><button type="button" class="resp-picker-clear" title="Clear">×</button>';
      } else {
        h += '<span class="resp-picker-empty">' + esc(emptyLabel) + '</span>';
      }
      h += '<span class="resp-picker-caret">▾</span>';
      h += '</div>';
      h += '<div class="bn-bulk-resp-dd resp-picker-dropdown" style="display:none">';
      h += '<input type="text" class="bn-bulk-resp-search resp-picker-search" placeholder="Search team…" autocomplete="off">';
      h += '<div class="bn-bulk-resp-list resp-picker-list" data-empty-label="' + esc(emptyLabel) + '"></div>';
      h += '</div>';
      h += '</div>';
      return h;
    }
    // responsible
    html += '<div class="bnf bnf-responsibleId"><span class="bnf-label">Responsible</span>' + personBox('responsibleId', d.responsibleId, '— Unassigned —') + '</div>';
    // proposedBy — MULTI-SELECT chips with searcher (mimics task modal proposed-box)
    if (!Array.isArray(d.proposedByIds)) d.proposedByIds = d.proposedById ? [d.proposedById] : [];
    function proposedMultiBox(){
      let h = '<div class="bn-bulk-proposed-box proposed-box" data-bdraft="' + idx + '">';
      // Chips
      h += '<div class="bn-bulk-proposed-chips proposed-chips">';
      (d.proposedByIds||[]).forEach(pid => {
        const p = findPerson(pid);
        const sc = p ? bulkSectionClass(p) : 'psec-bookline';
        const ini = p ? ((typeof initials === 'function') ? initials(p.name||'') : (p.name||'?').slice(0,1).toUpperCase()) : '?';
        const color = (p && p.color) || '#9a9a9a';
        const photo = p ? (p.photo || p.imageUrl || '') : '';
        const photoImg = photo ? '<img src="'+esc(photo)+'" alt="" onerror="this.remove()">' : '';
        const name = p ? (p.displayName || p.name || p.id) : pid;
        h += '<span class="proposed-chip ' + sc + '" data-pid="' + esc(pid) + '">' +
          '<span class="av-mini" style="background:'+color+'">'+photoImg+'<span class="ini">'+esc(ini)+'</span></span>' +
          '<span class="proposed-chip-name">' + esc(name) + '</span>' +
          '<button type="button" class="proposed-chip-x" title="Remove">×</button>' +
        '</span>';
      });
      h += '</div>';
      // Add chip — opens search dropdown
      h += '<span class="bn-bulk-proposed-add" tabindex="0">+ Add</span>';
      h += '<div class="bn-bulk-proposed-dd resp-picker-dropdown" style="display:none">';
      h += '<input type="text" class="bn-bulk-proposed-search resp-picker-search" placeholder="Search…" autocomplete="off">';
      h += '<div class="bn-bulk-proposed-list resp-picker-list"></div>';
      h += '</div>';
      h += '</div>';
      return h;
    }
    html += '<div class="bnf bnf-proposedById"><span class="bnf-label">Proposed by</span>' + proposedMultiBox() + '</div>';
    // shareWith
    html += '<div class="bnf bnf-shareWith"><span class="bnf-label">Share with</span>' + cpBox('f_shareWith', 'shareWith') + '</div>';
    // hours
    html += '<div class="bnf bnf-estimatedHours bn-bulk-hours"><span class="bnf-label">Est. h.</span><input type="number" min="0" step="0.5" data-f="estimatedHours" value="' + esc(d.estimatedHours||'') + '"></div>';
    html += '<div class="bnf bnf-dedicatedHours bn-bulk-hours"><span class="bnf-label">Ded. h.</span><input type="number" min="0" step="0.5" data-f="dedicatedHours" value="' + esc(d.dedicatedHours||'') + '"></div>';
    // dates
    const sAnchor = d.startAnchor || '';
    const eAnchor = d.endAnchor || '';
    const sLabel = sAnchor ? bnBulkAnchorLabel(sAnchor) : '';
    const eLabel = eAnchor ? bnBulkAnchorLabel(eAnchor) : '';
    html += '<div class="bnf bnf-dates"><span class="bnf-label">Dates</span>';
    html += '<div class="bn-bulk-date-cells">';
    html += '<button type="button" class="pin' + (sAnchor?' has-anchor':'') + '" data-act="anchor-start" title="Anclar start">📌</button>';
    html += '<input type="date" data-f="startDate" value="' + esc(d.startDate||'') + '">';
    html += '<div class="days-wrap"><input type="number" data-f="durationDays" min="1" step="1" placeholder="N" value="' + esc(d.durationDays||'') + '"></div>';
    html += '<input type="date" data-f="endDate" value="' + esc(d.endDate||'') + '">';
    html += '<button type="button" class="pin' + (eAnchor?' has-anchor':'') + '" data-act="anchor-end" title="Anclar end">📌</button>';
    html += '</div>';
    if (sLabel || eLabel) {
      html += '<div class="bn-bulk-anchor-info">';
      if (sLabel) html += '<span>↳ start: ' + esc(sLabel) + ' <span class="clear-anchor" data-act="clear-anchor-start">clear</span></span>';
      if (sLabel && eLabel) html += ' &nbsp;·&nbsp; ';
      if (eLabel) html += '<span>↳ end: ' + esc(eLabel) + ' <span class="clear-anchor" data-act="clear-anchor-end">clear</span></span>';
      html += '</div>';
    }
    html += '</div>';
    // parent group — group-picker-box style with search
    const existingGroups = (STORE.tasks||[]).filter(t => t.isGroup && !t._deletedAt).map(t => ({ id: t.id, label: t.subject||'(unnamed group)' }));
    const draftGroups = bnBulkDrafts.filter((x,i) => x.isGroup && i !== idx).map(x => ({ id: x._tmpId, label: '🆕 ' + (x.subject||'(new draft)') }));
    const allGroups = draftGroups.concat(existingGroups);
    const curGroup = allGroups.find(g => g.id === d.parentGroupId);
    html += '<div class="bnf bnf-parentGroupId bn-bulk-pg"><span class="bnf-label">Parent group</span>';
    html += '<div class="bn-bulk-group-box group-picker-box" data-bdraft="' + idx + '" data-groups-json="' + esc(JSON.stringify(allGroups)) + '">';
    html += '<div class="bn-bulk-group-chip group-picker-chip" tabindex="0">';
    if (curGroup) {
      html += '<span class="gp-name">' + esc(curGroup.label) + '</span><button type="button" class="gp-clear" title="Clear">×</button>';
    } else {
      html += '<span class="gp-empty">— No group —</span>';
    }
    html += '<span class="gp-caret">▾</span></div>';
    html += '<div class="bn-bulk-group-dd group-picker-dropdown" style="display:none">';
    html += '<input type="text" class="bn-bulk-group-search group-picker-search" placeholder="Search a group…" autocomplete="off">';
    html += '<div class="bn-bulk-group-list group-picker-list"></div>';
    html += '</div></div></div>';
    // Stash groups list as JSON on the box for wiring
    // (we'll attach it via JS below after innerHTML)
    // Task tags as chip+search multi-picker
    if (!Array.isArray(d.taskTags)) d.taskTags = d.taskTag ? [d.taskTag] : [];
    html += '<div class="bnf bnf-taskTag"><span class="bnf-label">Task tags</span>';
    html += '<div class="bn-bulk-multi-box bn-bulk-tag-box" data-bdraft="' + idx + '" data-bfkey="taskTags">';
    html += '<div class="bn-bulk-multi-chips">';
    (d.taskTags||[]).forEach(tn => {
      html += '<span class="bn-bulk-multi-chip" data-val="' + esc(tn) + '"><span>' + esc(tn) + '</span><button type="button" class="bn-bulk-multi-x" title="Remove">×</button></span>';
    });
    html += '</div>';
    html += '<span class="bn-bulk-multi-add" tabindex="0">+ Add</span>';
    html += '<div class="bn-bulk-multi-dd" style="display:none">';
    html += '<input type="text" class="bn-bulk-multi-search" placeholder="Search task tags…" autocomplete="off">';
    html += '<div class="bn-bulk-multi-list"></div>';
    html += '</div>';
    html += '</div></div>';
    // Roadmaps as chip+search multi-picker
    if (!Array.isArray(d.roadmapIds)) d.roadmapIds = d.roadmapId ? [d.roadmapId] : [];
    html += '<div class="bnf bnf-roadmapId"><span class="bnf-label">Roadmaps</span>';
    html += '<div class="bn-bulk-multi-box bn-bulk-rm-box" data-bdraft="' + idx + '" data-bfkey="roadmapIds">';
    html += '<div class="bn-bulk-multi-chips">';
    (d.roadmapIds||[]).forEach(rid => {
      const r = roadmaps.find(x => x.id === rid);
      const name = r ? (r.name||r.id) : rid;
      html += '<span class="bn-bulk-multi-chip" data-val="' + esc(rid) + '"><span>' + esc(name) + '</span><button type="button" class="bn-bulk-multi-x" title="Remove">×</button></span>';
    });
    html += '</div>';
    html += '<span class="bn-bulk-multi-add" tabindex="0">+ Add roadmap</span>';
    html += '<div class="bn-bulk-multi-dd" style="display:none">';
    html += '<input type="text" class="bn-bulk-multi-search" placeholder="Search roadmaps…" autocomplete="off">';
    html += '<div class="bn-bulk-multi-list"></div>';
    html += '</div>';
    html += '</div></div>';
    // isGroup
    html += '<div class="bnf bnf-isGroup bnf-isgroup"><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-f="isGroup"' + (d.isGroup?' checked':'') + '> <span class="bnf-label" style="margin:0">Group</span></label></div>';
    html += '</div></div>';
    return html;
  } // end buildCardHtml

  // Render defaults card into apply-all host
  const defHost = document.getElementById('bnBulkApplyDefaultsHost');
  if (defHost) defHost.innerHTML = buildCardHtml(bnBulkDefaultsDraft, -1);

  // Render real drafts
  let html = '';
  bnBulkDrafts.forEach((d, idx) => { html += buildCardHtml(d, idx); });
  list.innerHTML = html;
  const cnt = document.getElementById('bnBulkS2Count'); if (cnt) cnt.textContent = bnBulkDrafts.length;
  bnBulkApplyFieldVisibility();

  // Unified accessor: any wiring code that needs the draft for an idx uses this.
  const draftAt = (i) => i === -1 ? bnBulkDefaultsDraft : bnBulkDrafts[i];
  // Wiring scope covers both the defaults host and the list (so apply-all uses identical wiring as cards).
  const wireScope = {
    querySelectorAll: (sel) => {
      const out = [];
      if (defHost) defHost.querySelectorAll(sel).forEach(n => out.push(n));
      list.querySelectorAll(sel).forEach(n => out.push(n));
      return out;
    }
  };

  // Helper: position a bulk dropdown as fixed so it escapes modal overflow
  function bnBulkPositionDD(anchorEl, ddEl, minWidth) {
    const r = anchorEl.getBoundingClientRect();
    // Reset coords + offscreen measure
    ddEl.style.top = '-9999px';
    ddEl.style.left = '-9999px';
    ddEl.style.right = '';
    ddEl.style.bottom = '';
    ddEl.style.position = 'fixed';
    ddEl.style.visibility = 'hidden';
    ddEl.style.display = '';
    const ddH = ddEl.offsetHeight || 280;
    const ddW = ddEl.offsetWidth || (minWidth || r.width);
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    let top = r.bottom + 4;
    if (top + ddH > vh - 8) top = Math.max(8, r.top - ddH - 4);
    let left = r.left;
    if (left + ddW > vw - 8) left = Math.max(8, vw - ddW - 8);
    ddEl.style.top = top + 'px';
    ddEl.style.left = left + 'px';
    ddEl.style.visibility = '';
  }
  function bnBulkCloseAllDDs(except) {
    document.querySelectorAll('.bn-cp-box[data-bdraft] .bn-cp-dropdown, .bn-bulk-resp-dd, .bn-bulk-group-dd, .bn-bulk-proposed-dd, .bn-bulk-multi-dd').forEach(o => {
      if (o !== except) { o.style.display = 'none'; o.style.position = ''; o.style.top = o.style.left = o.style.right = o.style.bottom = ''; }
    });
  }
  // Reposition open dropdowns on scroll/resize
  if (!window._bnBulkReposWired) {
    const reposAll = () => {
      document.querySelectorAll('.bn-cp-box[data-bdraft] .bn-cp-dropdown, .bn-bulk-resp-dd, .bn-bulk-group-dd, .bn-bulk-proposed-dd, .bn-bulk-multi-dd').forEach(dd => {
        if (dd.style.display === 'none') return;
        const box = dd.closest('.bn-cp-box, .bn-bulk-resp-box, .bn-bulk-group-box, .bn-bulk-proposed-box, .bn-bulk-multi-box');
        if (!box) return;
        const anchor = box.querySelector('.bn-cp-chip, .bn-bulk-resp-chip, .bn-bulk-group-chip, .bn-bulk-proposed-add, .bn-bulk-multi-add');
        const mw = (dd.classList.contains('bn-bulk-resp-dd') || dd.classList.contains('bn-bulk-proposed-dd')) ? 280 : (dd.classList.contains('bn-bulk-group-dd') ? 240 : (dd.classList.contains('bn-bulk-multi-dd') ? 260 : 180));
        if (anchor) bnBulkPositionDD(anchor, dd, mw);
      });
    };
    document.addEventListener('scroll', reposAll, true);
    window.addEventListener('resize', reposAll);
    window._bnBulkReposWired = true;
  }
  // Wire colored picker boxes (Status/Priority/Type/ShareWith)
  wireScope.querySelectorAll('.bn-cp-box[data-bdraft]').forEach(box => {
    const dIdx = parseInt(box.dataset.bdraft, 10);
    const fKey = box.dataset.bfkey;
    const optKey = box.dataset.boptkey;
    const opts = COLORED_PICKLIST_OPTIONS[optKey] || [];
    const chip = box.querySelector('.bn-cp-chip');
    const dd = box.querySelector('.bn-cp-dropdown');
    chip.addEventListener('click', e => {
      e.stopPropagation();
      const wasOpen = !(dd.style.display === 'none' || !dd.style.display);
      // Close other open dropdowns/popovers in bulk
      bnBulkCloseAllDDs(dd);
      if (wasOpen) { dd.style.display = 'none'; dd.style.position = ''; dd.style.top = dd.style.left = ''; }
      else { bnBulkPositionDD(chip, dd, 180); }
    });
    chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } else if (e.key === 'Escape') dd.style.display = 'none'; });
    dd.querySelectorAll('.bn-cp-item').forEach(it => {
      it.addEventListener('click', e => {
        e.stopPropagation();
        const v = it.dataset.value;
        const opt = opts.find(o => o.value === v);
        draftAt(dIdx)[fKey] = v;
        if (opt) {
          chip.style.background = opt.bg;
          chip.style.color = opt.fg;
          chip.style.borderColor = opt.border;
          chip.querySelector('.bn-cp-label').textContent = opt.label || '—';
        }
        dd.querySelectorAll('.bn-cp-item').forEach(other => { const ck = other.querySelector('.bn-cp-check'); if (ck) ck.textContent = other.dataset.value === v ? '✓' : ''; });
        dd.style.display = 'none';
        dd.style.position = ''; dd.style.top = dd.style.left = '';
      });
    });
  });

  // Wire responsible / proposed-by pickers — replicate resp-picker behavior.
  // Source: TEAM + EXTERNAL_TEAM. Filter: team / supplementary (disabled excluded). Section labels in dropdown.
  function bulkRenderRespList(box, query){
    const listEl = box.querySelector('.bn-bulk-resp-list');
    const fKey = box.dataset.bfkey;
    const dIdx = parseInt(box.dataset.bdraft, 10);
    const curId = draftAt(dIdx)[fKey] || '';
    const emptyLabel = listEl.dataset.emptyLabel || '— Unassigned —';
    const q = (query||'').trim().toLowerCase();
    // Same candidate logic as _respPickerCandidates: only team + supplementary
    const all = [...TEAM, ...((typeof EXTERNAL_TEAM !== 'undefined') ? EXTERNAL_TEAM : [])];
    const team = [], supp = [];
    const seen = new Set();
    all.forEach(p => {
      if (!p || seen.has(p.id)) return;
      seen.add(p.id);
      const sec = (typeof getPersonSection === 'function') ? getPersonSection(p.id) : '';
      if (sec === 'team') team.push(p);
      else if (sec === 'supplementary') supp.push(p);
    });
    const byName = (a,b) => (a.displayName||a.name||'').localeCompare(b.displayName||b.name||'');
    team.sort(byName); supp.sort(byName);
    const matches = p => !q || (p.name||'').toLowerCase().includes(q) ||
                                (p.displayName||'').toLowerCase().includes(q) ||
                                (p.email||'').toLowerCase().includes(q);
    const tM = team.filter(matches); const sM = supp.filter(matches);
    const esc = s => String(s==null?'':s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    let html = '';
    // Clear-row at the top
    html += '<div class="resp-picker-item bn-bulk-resp-clear" data-pid=""><span class="av-mini" style="background:#e0e0de;color:#6b6b6b">∅</span><div class="resp-picker-item-meta"><div class="resp-picker-item-name" style="color:#6b6b6b">' + esc(emptyLabel) + '</div></div></div>';
    if (tM.length === 0 && sM.length === 0) {
      html += '<div class="resp-picker-empty-state">No matches</div>';
    } else {
      if (tM.length > 0) {
        html += '<div class="resp-picker-section-label">Team</div>';
        tM.forEach(p => {
          const ini = (typeof initials === 'function') ? initials(p.name||'') : (p.name||'?').slice(0,1).toUpperCase();
          const color = p.color || '#9a9a9a';
          const photo = p.photo || p.imageUrl || '';
          const photoImg = photo ? '<img src="'+esc(photo)+'" alt="" onerror="this.remove()">' : '';
          const active = p.id === curId ? ' active' : '';
          html += '<div class="resp-picker-item' + active + '" data-pid="' + esc(p.id) + '">' +
            '<span class="av-mini" style="background:'+color+'">'+photoImg+'<span class="ini">'+esc(ini)+'</span></span>' +
            '<div class="resp-picker-item-meta"><div class="resp-picker-item-name">' + esc(p.displayName || p.name || '?') + '</div>' +
            (p.email ? '<div class="resp-picker-item-email">' + esc(p.email) + '</div>' : '') + '</div>' +
            '</div>';
        });
      }
      if (sM.length > 0) {
        html += '<div class="resp-picker-section-label">Supplementary</div>';
        sM.forEach(p => {
          const ini = (typeof initials === 'function') ? initials(p.name||'') : (p.name||'?').slice(0,1).toUpperCase();
          const color = p.color || '#9a9a9a';
          const photo = p.photo || p.imageUrl || '';
          const photoImg = photo ? '<img src="'+esc(photo)+'" alt="" onerror="this.remove()">' : '';
          const active = p.id === curId ? ' active' : '';
          html += '<div class="resp-picker-item' + active + '" data-pid="' + esc(p.id) + '">' +
            '<span class="av-mini" style="background:'+color+'">'+photoImg+'<span class="ini">'+esc(ini)+'</span></span>' +
            '<div class="resp-picker-item-meta"><div class="resp-picker-item-name">' + esc(p.displayName || p.name || '?') + '</div>' +
            (p.email ? '<div class="resp-picker-item-email">' + esc(p.email) + '</div>' : '') + '</div>' +
            '</div>';
        });
      }
    }
    listEl.innerHTML = html;
    // Wire item click
    listEl.querySelectorAll('.resp-picker-item').forEach(it => {
      it.addEventListener('mousedown', e => e.preventDefault());
      it.addEventListener('click', e => {
        e.stopPropagation();
        const pid = it.dataset.pid || '';
        draftAt(dIdx)[fKey] = pid;
        bnBulkRebuildRespChip(box);
        const dd = box.querySelector('.bn-bulk-resp-dd');
        dd.style.display = 'none';
        dd.style.position = ''; dd.style.top = dd.style.left = '';
      });
    });
  }
  function bulkRenderSectionClass(p){
    try { const sec = (typeof getPersonSection === 'function') ? getPersonSection(p.id) : ''; if (sec === 'team') return 'psec-team'; if (sec === 'supplementary') return 'psec-supplementary'; if (sec === 'disabled') return 'psec-disabled'; return 'psec-bookline'; } catch(_) { return 'psec-bookline'; }
  }
  function bnBulkRebuildRespChip(box){
    const fKey = box.dataset.bfkey;
    const dIdx = parseInt(box.dataset.bdraft, 10);
    const curId = draftAt(dIdx)[fKey] || '';
    const p = curId ? findPerson(curId) : null;
    const chip = box.querySelector('.bn-bulk-resp-chip');
    const isProposed = box.dataset.proposed === '1';
    const esc = s => String(s==null?'':s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    // Strip prior psec-* classes
    chip.className = chip.className.split(' ').filter(c => !/^psec-/.test(c)).join(' ');
    if (isProposed && p) chip.classList.add(bulkRenderSectionClass(p));
    const emptyLabel = (fKey === 'proposedById') ? '— Nobody —' : '— Unassigned —';
    if (!p) {
      chip.innerHTML = '<span class="resp-picker-empty">' + esc(emptyLabel) + '</span><span class="resp-picker-caret">▾</span>';
    } else {
      const ini = (typeof initials === 'function') ? initials(p.name||'') : (p.name||'?').slice(0,1).toUpperCase();
      const color = p.color || '#9a9a9a';
      const photo = p.photo || p.imageUrl || '';
      const photoImg = photo ? '<img src="'+esc(photo)+'" alt="" onerror="this.remove()">' : '';
      chip.innerHTML = '<span class="av-mini" style="background:'+color+'">'+photoImg+'<span class="ini">'+esc(ini)+'</span></span>' +
        '<span class="resp-picker-name">' + esc(p.displayName||p.name||'?') + '</span>' +
        '<button type="button" class="resp-picker-clear" title="Clear">×</button>' +
        '<span class="resp-picker-caret">▾</span>';
    }
    // Wire clear button (if present)
    const clr = chip.querySelector('.resp-picker-clear');
    if (clr) clr.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); draftAt(dIdx)[fKey] = ''; bnBulkRebuildRespChip(box); });
  }
  wireScope.querySelectorAll('.bn-bulk-resp-box').forEach(box => {
    const chip = box.querySelector('.bn-bulk-resp-chip');
    const dd = box.querySelector('.bn-bulk-resp-dd');
    const search = box.querySelector('.bn-bulk-resp-search');
    // Wire clear button on initial chip too
    const clr = chip.querySelector('.resp-picker-clear');
    if (clr) clr.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); const fKey = box.dataset.bfkey; const dIdx = parseInt(box.dataset.bdraft, 10); draftAt(dIdx)[fKey] = ''; bnBulkRebuildRespChip(box); });
    chip.addEventListener('click', e => {
      if (e.target && e.target.classList && e.target.classList.contains('resp-picker-clear')) return;
      e.stopPropagation();
      const wasOpen = !(dd.style.display === 'none' || !dd.style.display);
      bnBulkCloseAllDDs(dd);
      if (wasOpen) { dd.style.display = 'none'; dd.style.position = ''; dd.style.top = dd.style.left = ''; }
      else {
        bulkRenderRespList(box, '');
        bnBulkPositionDD(chip, dd, 300);
        if (search) { search.value = ''; setTimeout(() => { try { search.focus(); } catch(_) {} }, 30); }
      }
    });
    chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } else if (e.key === 'Escape') dd.style.display = 'none'; });
    if (search) search.addEventListener('input', () => bulkRenderRespList(box, search.value));
  });

  // Wire generic multi-select boxes (task tags, roadmaps)
  wireScope.querySelectorAll('.bn-bulk-multi-box').forEach(box => {
    const dIdx = parseInt(box.dataset.bdraft, 10);
    const fKey = box.dataset.bfkey; // 'taskTags' or 'roadmapIds'
    const addChip = box.querySelector('.bn-bulk-multi-add');
    const dd = box.querySelector('.bn-bulk-multi-dd');
    const search = box.querySelector('.bn-bulk-multi-search');
    const listEl = box.querySelector('.bn-bulk-multi-list');
    const chipsCont = box.querySelector('.bn-bulk-multi-chips');
    const esc = s => String(s==null?'':s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    function getDraft(){ return dIdx === -1 ? bnBulkDefaultsDraft : bnBulkDrafts[dIdx]; }
    function getAllItems(){
      if (fKey === 'taskTags') return (STORE.taskTagLibrary||[]).map(t => ({ val: (t.name||t), label: (t.name||t) }));
      if (fKey === 'roadmapIds') return (STORE.roadmaps||[]).map(r => ({ val: r.id, label: r.name||r.id }));
      return [];
    }
    function refreshChips(){
      const d = getDraft();
      const ids = Array.isArray(d[fKey]) ? d[fKey] : [];
      const allItems = getAllItems();
      let h = '';
      ids.forEach(v => {
        const item = allItems.find(x => x.val === v);
        const label = item ? item.label : v;
        h += '<span class="bn-bulk-multi-chip" data-val="' + esc(v) + '"><span>' + esc(label) + '</span><button type="button" class="bn-bulk-multi-x" title="Remove">×</button></span>';
      });
      chipsCont.innerHTML = h;
      wireChipX();
    }
    function wireChipX(){
      chipsCont.querySelectorAll('.bn-bulk-multi-x').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation(); e.preventDefault();
          const chip = btn.closest('.bn-bulk-multi-chip');
          const v = chip.dataset.val;
          const d = getDraft();
          d[fKey] = (d[fKey]||[]).filter(x => x !== v);
          // Keep legacy single fields in sync where applicable
          if (fKey === 'roadmapIds') d.roadmapId = d.roadmapIds[0] || '';
          if (fKey === 'taskTags')   d.taskTag = d.taskTags[0] || '';
          refreshChips();
        });
      });
    }
    wireChipX();
    function renderList(query){
      const q = (query||'').trim().toLowerCase();
      const d = getDraft();
      const selected = new Set(d[fKey]||[]);
      const allItems = getAllItems();
      const matches = allItems.filter(it => !selected.has(it.val) && (!q || (it.label||'').toLowerCase().includes(q)));
      let h = '';
      if (matches.length === 0) {
        h += '<div class="resp-picker-empty-state">No matches</div>';
      } else {
        matches.forEach(it => {
          h += '<div class="bn-bulk-multi-item" data-val="' + esc(it.val) + '">' + esc(it.label) + '</div>';
        });
      }
      listEl.innerHTML = h;
      listEl.querySelectorAll('.bn-bulk-multi-item').forEach(itEl => {
        itEl.addEventListener('mousedown', e => e.preventDefault());
        itEl.addEventListener('click', e => {
          e.stopPropagation();
          const v = itEl.dataset.val;
          const d = getDraft();
          if (!Array.isArray(d[fKey])) d[fKey] = [];
          if (!d[fKey].includes(v)) d[fKey].push(v);
          if (fKey === 'roadmapIds') d.roadmapId = d.roadmapIds[0] || '';
          if (fKey === 'taskTags')   d.taskTag = d.taskTags[0] || '';
          refreshChips();
          if (search) { search.value = ''; search.focus(); }
          renderList('');
        });
      });
    }
    addChip.addEventListener('click', e => {
      e.stopPropagation();
      const wasOpen = dd.style.display !== 'none';
      bnBulkCloseAllDDs(dd);
      if (wasOpen) { dd.style.display = 'none'; dd.style.position = ''; dd.style.top = dd.style.left = ''; }
      else {
        renderList('');
        bnBulkPositionDD(addChip, dd, 260);
        if (search) { search.value = ''; setTimeout(() => { try { search.focus(); } catch(_) {} }, 30); }
      }
    });
    addChip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addChip.click(); } else if (e.key === 'Escape') dd.style.display = 'none'; });
    if (search) search.addEventListener('input', () => renderList(search.value));
  });

  // Wire proposed-by multi-select boxes
  wireScope.querySelectorAll('.bn-bulk-proposed-box').forEach(box => {
    const dIdx = parseInt(box.dataset.bdraft, 10);
    const addChip = box.querySelector('.bn-bulk-proposed-add');
    const dd = box.querySelector('.bn-bulk-proposed-dd');
    const search = box.querySelector('.bn-bulk-proposed-search');
    const listEl = box.querySelector('.bn-bulk-proposed-list');
    const chipsCont = box.querySelector('.bn-bulk-proposed-chips');
    const esc = s => String(s==null?'':s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    function getDraft(){ return draftAt(dIdx); }
    function refreshChips(){
      const d = getDraft();
      const ids = Array.isArray(d.proposedByIds) ? d.proposedByIds : [];
      let h = '';
      ids.forEach(pid => {
        const p = findPerson(pid);
        const sc = p ? (function(){try{const s=getPersonSection(p.id); if(s==='team')return 'psec-team'; if(s==='supplementary')return 'psec-supplementary'; if(s==='disabled')return 'psec-disabled'; return 'psec-bookline';}catch(_){return 'psec-bookline';}})() : 'psec-bookline';
        const ini = p ? ((typeof initials === 'function') ? initials(p.name||'') : (p.name||'?').slice(0,1).toUpperCase()) : '?';
        const color = (p && p.color) || '#9a9a9a';
        const photo = p ? (p.photo || p.imageUrl || '') : '';
        const photoImg = photo ? '<img src="'+esc(photo)+'" alt="" onerror="this.remove()">' : '';
        const name = p ? (p.displayName || p.name || p.id) : pid;
        h += '<span class="proposed-chip ' + sc + '" data-pid="' + esc(pid) + '">' +
          '<span class="av-mini" style="background:'+color+'">'+photoImg+'<span class="ini">'+esc(ini)+'</span></span>' +
          '<span class="proposed-chip-name">' + esc(name) + '</span>' +
          '<button type="button" class="proposed-chip-x" title="Remove">×</button>' +
        '</span>';
      });
      chipsCont.innerHTML = h;
      wireChipX();
    }
    function wireChipX(){
      chipsCont.querySelectorAll('.proposed-chip-x').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation(); e.preventDefault();
          const chip = btn.closest('.proposed-chip');
          const pid = chip.dataset.pid;
          const d = getDraft();
          d.proposedByIds = (d.proposedByIds||[]).filter(x => x !== pid);
          d.proposedById = d.proposedByIds[0] || '';
          refreshChips();
        });
      });
    }
    wireChipX();
    function renderList(query){
      const q = (query||'').trim().toLowerCase();
      const d = getDraft();
      const selected = new Set(d.proposedByIds||[]);
      // Source: TEAM + EXTERNAL_TEAM + entire Bookline SLACK_DIRECTORY. _slackOnly people
      // appear in a dedicated section "Bookline · No tasks yet".
      const allList = (typeof bnAllPeopleForProposedBy === 'function')
        ? bnAllPeopleForProposedBy()
        : (typeof allPeopleForPicker === 'function' ? allPeopleForPicker() : [...TEAM, ...((typeof EXTERNAL_TEAM !== 'undefined') ? EXTERNAL_TEAM : [])]);
      const team = [], supp = [], book = [], slack = [];
      const seen = new Set();
      allList.forEach(p => {
        if (!p || seen.has(p.id) || selected.has(p.id)) return;
        seen.add(p.id);
        if (p._slackOnly) { slack.push(p); return; }
        let sec = '';
        try { sec = (typeof getPersonSection === 'function') ? getPersonSection(p.id) : ''; } catch(_) {}
        if (sec === 'team') team.push(p);
        else if (sec === 'supplementary') supp.push(p);
        else if (sec === 'disabled') return; // skip deactivated
        else book.push(p); // empty section / bookline default
      });
      const byName = (a,b) => (a.displayName||a.name||'').localeCompare(b.displayName||b.name||'');
      team.sort(byName); supp.sort(byName); book.sort(byName); slack.sort(byName);
      const matches = p => !q || (p.name||'').toLowerCase().includes(q) ||
                                  (p.displayName||'').toLowerCase().includes(q) ||
                                  (p.email||'').toLowerCase().includes(q);
      const tM = team.filter(matches); const sM = supp.filter(matches); const bM = book.filter(matches); const slM = slack.filter(matches);
      let h = '';
      if (tM.length === 0 && sM.length === 0 && bM.length === 0 && slM.length === 0) {
        h += '<div class="resp-picker-empty-state">No matches</div>';
      } else {
        function row(p){
          const ini = (typeof initials === 'function') ? initials(p.name||'') : (p.name||'?').slice(0,1).toUpperCase();
          const color = p.color || '#9a9a9a';
          const photo = p.photo || p.imageUrl || '';
          const photoImg = photo ? '<img src="'+esc(photo)+'" alt="" onerror="this.remove()">' : '';
          return '<div class="resp-picker-item" data-pid="' + esc(p.id) + '">' +
            '<span class="av-mini" style="background:'+color+'">'+photoImg+'<span class="ini">'+esc(ini)+'</span></span>' +
            '<div class="resp-picker-item-meta"><div class="resp-picker-item-name">' + esc(p.displayName || p.name || '?') + '</div>' +
            (p.email ? '<div class="resp-picker-item-email">' + esc(p.email) + '</div>' : '') + '</div>' +
            '</div>';
        }
        if (tM.length > 0)  { h += '<div class="resp-picker-section-label">Team</div>' + tM.map(row).join(''); }
        if (sM.length > 0)  { h += '<div class="resp-picker-section-label">Supplementary</div>' + sM.map(row).join(''); }
        if (bM.length > 0)  { h += '<div class="resp-picker-section-label">Bookline</div>' + bM.map(row).join(''); }
        if (slM.length > 0) { h += '<div class="resp-picker-section-label">Bookline · No tasks yet</div>' + slM.map(row).join(''); }
      }
      listEl.innerHTML = h;
      listEl.querySelectorAll('.resp-picker-item').forEach(it => {
        it.addEventListener('mousedown', e => e.preventDefault());
        it.addEventListener('click', e => {
          e.stopPropagation();
          const pid = it.dataset.pid;
          // Auto-promote Slack-only people so chip + downstream rendering work.
          try { if (typeof bnEnsurePersonExists === 'function') bnEnsurePersonExists(pid); } catch(_) {}
          const d = getDraft();
          if (!Array.isArray(d.proposedByIds)) d.proposedByIds = [];
          if (!d.proposedByIds.includes(pid)) d.proposedByIds.push(pid);
          d.proposedById = d.proposedByIds[0] || '';
          refreshChips();
          if (search) { search.value = ''; search.focus(); }
          renderList(''); // refresh list (exclude the newly selected)
        });
      });
    }
    addChip.addEventListener('click', e => {
      e.stopPropagation();
      const wasOpen = !(dd.style.display === 'none' || !dd.style.display);
      bnBulkCloseAllDDs(dd);
      if (wasOpen) { dd.style.display = 'none'; dd.style.position = ''; dd.style.top = dd.style.left = ''; }
      else {
        renderList('');
        bnBulkPositionDD(addChip, dd, 280);
        if (search) { search.value = ''; setTimeout(() => { try { search.focus(); } catch(_) {} }, 30); }
      }
    });
    addChip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addChip.click(); } else if (e.key === 'Escape') dd.style.display = 'none'; });
    if (search) search.addEventListener('input', () => renderList(search.value));
  });

  // Wire parent-group picker (group-picker-box)
  wireScope.querySelectorAll('.bn-bulk-group-box').forEach(box => {
    const dIdx = parseInt(box.dataset.bdraft, 10);
    const chip = box.querySelector('.bn-bulk-group-chip');
    const dd = box.querySelector('.bn-bulk-group-dd');
    const search = box.querySelector('.bn-bulk-group-search');
    const listEl = box.querySelector('.bn-bulk-group-list');
    let groups = [];
    try { groups = JSON.parse(box.dataset.groupsJson || '[]'); } catch(_) { groups = []; }
    const esc = s => String(s==null?'':s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    function renderList(q){
      q = (q||'').trim().toLowerCase();
      const matches = groups.filter(g => !q || (g.label||'').toLowerCase().includes(q));
      let h = '<div class="group-picker-item bn-bulk-group-clear" data-gid=""><span style="color:#9a9a9a">— No group —</span></div>';
      if (matches.length === 0) {
        h += '<div class="resp-picker-empty-state">No matches</div>';
      } else {
        matches.forEach(g => {
          const active = g.id === draftAt(dIdx).parentGroupId ? ' active' : '';
          h += '<div class="group-picker-item' + active + '" data-gid="' + esc(g.id) + '">' + esc(g.label) + (active?'<span class="check" style="margin-left:auto">✓</span>':'') + '</div>';
        });
      }
      listEl.innerHTML = h;
      listEl.querySelectorAll('.group-picker-item').forEach(it => {
        it.addEventListener('mousedown', e => e.preventDefault());
        it.addEventListener('click', e => {
          e.stopPropagation();
          const gid = it.dataset.gid || '';
          draftAt(dIdx).parentGroupId = gid;
          const g = groups.find(x => x.id === gid);
          if (g) {
            chip.innerHTML = '<span class="gp-name">' + esc(g.label) + '</span><button type="button" class="gp-clear" title="Clear">×</button><span class="gp-caret">▾</span>';
          } else {
            chip.innerHTML = '<span class="gp-empty">— No group —</span><span class="gp-caret">▾</span>';
          }
          wireGpClear();
          dd.style.display = 'none'; dd.style.position = ''; dd.style.top = dd.style.left = '';
        });
      });
    }
    function wireGpClear(){
      const c = chip.querySelector('.gp-clear');
      if (c) c.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); draftAt(dIdx).parentGroupId = ''; chip.innerHTML = '<span class="gp-empty">— No group —</span><span class="gp-caret">▾</span>'; });
    }
    wireGpClear();
    chip.addEventListener('click', e => {
      if (e.target && e.target.classList && e.target.classList.contains('gp-clear')) return;
      e.stopPropagation();
      const wasOpen = !(dd.style.display === 'none' || !dd.style.display);
      bnBulkCloseAllDDs(dd);
      if (wasOpen) { dd.style.display = 'none'; dd.style.position = ''; dd.style.top = dd.style.left = ''; }
      else { renderList(''); bnBulkPositionDD(chip, dd, 240); if (search) { search.value=''; setTimeout(() => { try { search.focus(); } catch(_) {} }, 30); } }
    });
    chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } else if (e.key === 'Escape') dd.style.display = 'none'; });
    if (search) search.addEventListener('input', () => renderList(search.value));
  });

  // Global outside-click closes any open bulk dropdown
  if (!window._bnBulkOutsideWired) {
    document.addEventListener('click', e => {
      document.querySelectorAll('.bn-cp-box[data-bdraft] .bn-cp-dropdown, .bn-bulk-resp-dd, .bn-bulk-group-dd, .bn-bulk-proposed-dd, .bn-bulk-multi-dd').forEach(dd => {
        if (dd.style.display === 'none') return;
        const box = dd.closest('.bn-cp-box, .bn-bulk-resp-box, .bn-bulk-group-box, .bn-bulk-proposed-box, .bn-bulk-multi-box');
        if (dd.contains(e.target)) return;
        if (box && box.contains(e.target)) return;
        dd.style.display = 'none'; dd.style.position = ''; dd.style.top = dd.style.left = '';
      });
    }, true);
    window._bnBulkOutsideWired = true;
  }

  // Wire field changes + delete + anchor pins
  wireScope.querySelectorAll('.bn-bulk-task-card').forEach(card => {
    const idx = parseInt(card.dataset.idx, 10);
    card.querySelectorAll('select[data-f], input[data-f]').forEach(el => {
      const f = el.dataset.f;
      const handler = () => {
        if (el.type === 'checkbox') draftAt(idx)[f] = !!el.checked;
        else draftAt(idx)[f] = el.value;
        if (el.tagName === 'SELECT' && el.classList.contains('bnf-colored')) {
          el.setAttribute('data-cv', el.value || '');
        }
        if (f === 'startDate' || f === 'endDate' || f === 'durationDays') {
          bnBulkRecalcDates(draftAt(idx), f, true);
          bnBulkRenderStage2();
        }
        if (f === 'isGroup' && idx !== -1) bnBulkRenderStage2();
      };
      el.addEventListener('change', handler);
      if (el.tagName === 'INPUT' && el.type !== 'date' && el.type !== 'number') el.addEventListener('input', handler);
    });
    // Anchor pins
    card.querySelectorAll('button[data-act]').forEach(btn => {
      const act = btn.getAttribute('data-act');
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        if (act === 'anchor-start') bnBulkOpenAnchorPicker(btn, idx, 'start');
        else if (act === 'anchor-end') bnBulkOpenAnchorPicker(btn, idx, 'end');
        else if (act === 'clear-anchor-start') { draftAt(idx).startAnchor=''; bnBulkRenderStage2(); }
        else if (act === 'clear-anchor-end')   { draftAt(idx).endAnchor='';   bnBulkRenderStage2(); }
        else if (act === 'apply-defaults') { bnBulkApplyDefaultsToAll(); }
        else if (act === 'del') { bnBulkDrafts.splice(idx, 1); bnBulkRenderStage2(); }
      });
    });
    card.querySelectorAll('.clear-anchor').forEach(span => {
      span.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const act = span.getAttribute('data-act');
        if (act === 'clear-anchor-start') { draftAt(idx).startAnchor=''; bnBulkRenderStage2(); }
        else if (act === 'clear-anchor-end')   { draftAt(idx).endAnchor='';   bnBulkRenderStage2(); }
      });
    });
    const del = card.querySelector('.card-del');
    if (del && idx !== -1) del.addEventListener('click', () => {
      bnBulkDrafts.splice(idx, 1);
      bnBulkRenderStage2();
    });
    if (del && idx === -1) del.addEventListener('click', () => {
      bnBulkApplyDefaultsToAll();
    });
  });
}

function bnBulkBackToStage1(){
  // Sync drafts back to rows (preserve user-typed subject+comments)
  if (bnBulkDrafts.length > 0) {
    bnBulkRows = bnBulkDrafts.map(d => ({ subject: d.subject, extraComments: d.extraComments }));
  }
  bnBulkShowStage(1);
  bnBulkSetMode('rows');
  bnBulkRenderRows();
}

function bnBulkApplyDefaultsToAll(){
  const D = bnBulkDefaultsDraft;
  if (!D) return;
  const scalarKeys = ['type','slackStatus','priority','responsibleId','shareWith','startDate','endDate','durationDays','estimatedHours','dedicatedHours','parentGroupId'];
  let changes = 0;
  scalarKeys.forEach(k => {
    if (D[k] !== '' && D[k] != null) {
      bnBulkDrafts.forEach(d => { d[k] = D[k]; changes++; });
    }
  });
  // Multi-merge: union of arrays
  if (Array.isArray(D.proposedByIds) && D.proposedByIds.length) {
    bnBulkDrafts.forEach(d => {
      if (!Array.isArray(d.proposedByIds)) d.proposedByIds = d.proposedById ? [d.proposedById] : [];
      D.proposedByIds.forEach(pid => { if (!d.proposedByIds.includes(pid)) { d.proposedByIds.push(pid); changes++; } });
      d.proposedById = d.proposedByIds[0] || '';
    });
  }
  if (Array.isArray(D.roadmapIds) && D.roadmapIds.length) {
    bnBulkDrafts.forEach(d => {
      if (!Array.isArray(d.roadmapIds)) d.roadmapIds = d.roadmapId ? [d.roadmapId] : [];
      D.roadmapIds.forEach(rid => { if (!d.roadmapIds.includes(rid)) { d.roadmapIds.push(rid); changes++; } });
      d.roadmapId = d.roadmapIds[0] || '';
    });
  }
  if (Array.isArray(D.taskTags) && D.taskTags.length) {
    bnBulkDrafts.forEach(d => {
      if (!Array.isArray(d.taskTags)) d.taskTags = d.taskTag ? [d.taskTag] : [];
      D.taskTags.forEach(t => { if (!d.taskTags.includes(t)) { d.taskTags.push(t); changes++; } });
      d.taskTag = d.taskTags[0] || '';
    });
  }
  if (D.isGroup) {
    bnBulkDrafts.forEach(d => { d.isGroup = true; });
    changes++;
  }
  if (changes === 0) {
    alert('Fill in some value in the Default row before clicking Apply.');
    return;
  }
  bnBulkRenderStage2();
}

// ---- Date math helpers ----
function bnBulkParseDate(s){
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}
function bnBulkFmtDate(dt){
  if (!dt || isNaN(dt.getTime())) return '';
  return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
}
function bnBulkAddDays(dt, n){ const d = new Date(dt.getTime()); d.setDate(d.getDate() + n); return d; }
function bnBulkDaysBetween(a, b){ if (!a||!b) return null; return Math.round((b.getTime()-a.getTime())/86400000) + 1; }

// Recalculate: if user set start+days, compute end; if user set start+end, compute days; etc.
// `clearAnchors`: if true (manual user edit), clear stale anchors. If false (anchor picker just set the date), keep them.
function bnBulkRecalcDates(draft, changedField, clearAnchors){
  const sd = bnBulkParseDate(draft.startDate);
  const ed = bnBulkParseDate(draft.endDate);
  const days = draft.durationDays ? parseInt(draft.durationDays, 10) : null;
  if (changedField === 'startDate' && sd && days && days >= 1) {
    draft.endDate = bnBulkFmtDate(bnBulkAddDays(sd, days-1));
  } else if (changedField === 'endDate' && ed && days && days >= 1) {
    draft.startDate = bnBulkFmtDate(bnBulkAddDays(ed, -(days-1)));
  } else if (changedField === 'durationDays' && days && days >= 1) {
    if (sd) draft.endDate = bnBulkFmtDate(bnBulkAddDays(sd, days-1));
    else if (ed) draft.startDate = bnBulkFmtDate(bnBulkAddDays(ed, -(days-1)));
  } else if ((changedField === 'startDate' || changedField === 'endDate') && sd && ed) {
    const n = bnBulkDaysBetween(sd, ed);
    if (n && n >= 1) draft.durationDays = String(n);
  }
  if (clearAnchors) {
    if (changedField === 'startDate' && draft.startAnchor) draft.startAnchor = '';
    if (changedField === 'endDate' && draft.endAnchor) draft.endAnchor = '';
  }
}

// Build readable label for an anchor reference like "slk004|end" or "bndraft_xxx|start"
function bnBulkAnchorLabel(anchorStr){
  if (!anchorStr) return '';
  const [id, side] = anchorStr.split('|');
  let name = '';
  // Check existing tasks
  const t = (STORE.tasks||[]).find(x => x.id === id);
  if (t) name = t.subject || id;
  else {
    // Check drafts
    const d = bnBulkDrafts.find(x => x._tmpId === id);
    if (d) name = '(new) ' + (d.subject || '(unnamed draft)');
  }
  if (!name) name = id;
  return (side === 'start' ? 'start' : 'end') + ' of ' + name;
}

// Open the anchor picker for a given draft + side ('start' or 'end' = which side of THIS draft we're anchoring)
function bnBulkOpenAnchorPicker(anchorBtn, draftIdx, mySide){
  // Close any existing
  document.querySelectorAll('.bn-bulk-anchor-pop').forEach(n => n.remove());
  const self = bnBulkDrafts[draftIdx];
  if (!self) return;

  // Candidates: existing tasks WITH dates + other drafts
  const existing = (STORE.tasks||[]).filter(t => !t._deletedAt).map(t => {
    const sv = (typeof bnAggregatedDateForTask === 'function') ? bnAggregatedDateForTask(t.id, 'start') : (t.startDate||'');
    const ev = (typeof bnAggregatedDateForTask === 'function') ? bnAggregatedDateForTask(t.id, 'end')   : (t.endDate||'');
    return { kind: 'task', id: t.id, name: t.subject||'(unnamed)', startVal: sv, endVal: ev, isGroup: !!t.isGroup };
  }).filter(x => x.startVal || x.endVal);

  const drafts = bnBulkDrafts
    .filter((d, i) => i !== draftIdx)
    .map(d => ({ kind: 'draft', id: d._tmpId, name: d.subject || '(new draft)', startVal: d.startDate||'', endVal: d.endDate||'', isGroup: !!d.isGroup }))
    .filter(x => x.startVal || x.endVal || true);  // include drafts even without dates yet — useful for relative ordering later

  const all = existing.concat(drafts);

  const pop = document.createElement('div');
  pop.className = 'bn-bulk-anchor-pop';
  let html = '<div class="head"><strong>Anclar ' + (mySide==='start'?'start':'end') + ' a…</strong><button type="button" class="close">✕</button></div>';
  html += '<input type="text" class="search" placeholder="Search tasks…" autocomplete="off">';
  if (drafts.length > 0) {
    html += '<div class="group-label">In this batch (' + drafts.length + ')</div>';
    drafts.forEach(c => {
      html += bnBulkAnchorRow(c);
    });
  }
  if (existing.length > 0) {
    html += '<div class="group-label">Existing tasks (' + existing.length + ')</div>';
    existing.forEach(c => {
      html += bnBulkAnchorRow(c);
    });
  }
  if (all.length === 0) html += '<div class="empty">No tasks with dates to anchor yet.</div>';
  pop.innerHTML = html;
  document.body.appendChild(pop);

  const rect = anchorBtn.getBoundingClientRect();
  pop.style.left = (rect.left + window.scrollX) + 'px';
  pop.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
  setTimeout(() => {
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = Math.max(8, window.innerWidth - pr.width - 8 + window.scrollX) + 'px';
    if (pr.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, rect.top - pr.height - 6 + window.scrollY) + 'px';
  }, 0);

  // Search filter
  const search = pop.querySelector('.search');
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    pop.querySelectorAll('.row').forEach(r => {
      const n = (r.querySelector('.name')||{}).textContent || '';
      r.style.display = n.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  setTimeout(()=>search.focus(), 30);

  // Close button + outside click
  pop.querySelector('.close').addEventListener('click', () => pop.remove());
  setTimeout(() => {
    const closer = ev => { if (pop.contains(ev.target) || ev.target === anchorBtn) return; pop.remove(); document.removeEventListener('click', closer, true); };
    document.addEventListener('click', closer, true);
  }, 0);

  // Pick buttons
  pop.querySelectorAll('button[data-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const side = btn.getAttribute('data-pick'); // 'start' or 'end' of the TARGET
      const dateVal = btn.getAttribute('data-date');
      // Save anchor reference + set the date input
      const anchorStr = id + '|' + side;
      if (mySide === 'start') {
        self.startAnchor = anchorStr;
        if (dateVal) self.startDate = dateVal;
      } else {
        self.endAnchor = anchorStr;
        if (dateVal) self.endDate = dateVal;
      }
      // If both start and end are set now, also update durationDays (don't clear anchors — we just set one)
      bnBulkRecalcDates(self, mySide==='start' ? 'startDate' : 'endDate', false);
      // Re-render
      pop.remove();
      bnBulkRenderStage2();
    });
  });
}

function bnBulkAnchorRow(c){
  const esc = s => String(s==null?'':s).replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
  const ico = c.kind === 'draft' ? '🆕' : (c.isGroup ? '📁' : '·');
  return '<div class="row">' +
    '<span class="name"><span class="ico">'+ico+'</span>' + esc(c.name) + '</span>' +
    (c.startVal
      ? '<button type="button" data-pick="start" data-id="' + esc(c.id) + '" data-date="' + esc(c.startVal) + '" title="' + esc(c.startVal) + '">start</button>'
      : '<button type="button" class="disabled" title="Sin start date">start</button>') +
    (c.endVal
      ? '<button type="button" data-pick="end" data-id="' + esc(c.id) + '" data-date="' + esc(c.endVal) + '" title="' + esc(c.endVal) + '">end</button>'
      : '<button type="button" class="disabled" title="Sin end date">end</button>') +
    '</div>';
}

function bnBulkSave(){
  if (bnBulkDrafts.length === 0) { alert('No tasks to create.'); return; }
  if (typeof bnRotateAutoSnapshot === 'function') bnRotateAutoSnapshot('pre-bulk-create');

  // Auto-merge defaults into each draft on Save. Previously this only happened
  // when the user explicitly clicked "Apply to all" — users (including me)
  // expect that values typed in the defaults panel automatically apply to
  // every draft when Save is clicked, especially for proposed_by which is a
  // required field downstream. We preserve any value the user already set
  // ON a specific row (defaults DON'T overwrite a row-level value).
  {
    const D = bnBulkDefaultsDraft || {};
    const scalarKeys = ['type','slackStatus','priority','responsibleId','shareWith',
                        'startDate','endDate','durationDays','estimatedHours',
                        'dedicatedHours','parentGroupId','startAnchor','endAnchor'];
    scalarKeys.forEach(k => {
      if (D[k] !== '' && D[k] != null) {
        bnBulkDrafts.forEach(d => { if (d[k] === '' || d[k] == null) d[k] = D[k]; });
      }
    });
    // Arrays: union (defaults UNION row-level). This matches "Apply to all"
    // semantics, which adds defaults' proposers/roadmaps/tags on top of any
    // the user already picked per row.
    if (Array.isArray(D.proposedByIds) && D.proposedByIds.length) {
      bnBulkDrafts.forEach(d => {
        if (!Array.isArray(d.proposedByIds)) d.proposedByIds = d.proposedById ? [d.proposedById] : [];
        D.proposedByIds.forEach(pid => { if (!d.proposedByIds.includes(pid)) d.proposedByIds.push(pid); });
        d.proposedById = d.proposedByIds[0] || '';
      });
    }
    if (Array.isArray(D.roadmapIds) && D.roadmapIds.length) {
      bnBulkDrafts.forEach(d => {
        if (!Array.isArray(d.roadmapIds)) d.roadmapIds = d.roadmapId ? [d.roadmapId] : [];
        D.roadmapIds.forEach(rid => { if (!d.roadmapIds.includes(rid)) d.roadmapIds.push(rid); });
        d.roadmapId = d.roadmapIds[0] || '';
      });
    }
    if (Array.isArray(D.taskTags) && D.taskTags.length) {
      bnBulkDrafts.forEach(d => {
        if (!Array.isArray(d.taskTags)) d.taskTags = d.taskTag ? [d.taskTag] : [];
        D.taskTags.forEach(t => { if (!d.taskTags.includes(t)) d.taskTags.push(t); });
        d.taskTag = d.taskTags[0] || '';
      });
    }
    // isGroup: if defaults set true, propagate to drafts that didn't override.
    if (D.isGroup) {
      bnBulkDrafts.forEach(d => { if (!d.isGroup) d.isGroup = true; });
    }
  }

  // Step 1: pre-generate real IDs for each draft, so cross-draft anchors can resolve.
  const tmpToReal = {};
  bnBulkDrafts.forEach(d => { tmpToReal[d._tmpId] = uid(); });

  // Helper: translate "tmpId|side" → "realId|side" or pass through if already a real task ID
  const resolveAnchor = (anchorStr) => {
    if (!anchorStr) return '';
    const [id, side] = anchorStr.split('|');
    if (tmpToReal[id]) return tmpToReal[id] + (side ? '|' + side : '');
    return anchorStr;  // already a real ID
  };

  // Resolve parentGroupId for each draft (translate tmpId → real id if needed)
  const resolveParent = (pid) => {
    if (!pid) return '';
    return tmpToReal[pid] || pid;
  };

  const now = Date.now();
  const createdIds = [];
  // Convert bulk anchor "ID|side" → task-level anchor format "task:ID:side"
  const toTaskAnchor = (anchorStr) => {
    if (!anchorStr) return '';
    const resolved = resolveAnchor(anchorStr);
    const [id, side] = resolved.split('|');
    if (!id) return '';
    const s = (side === 'end') ? 'end' : 'start';
    return 'task:' + id + ':' + s;
  };
  for (const d of bnBulkDrafts) {
    const tid = tmpToReal[d._tmpId];
    const respPerson = d.responsibleId ? findPerson(d.responsibleId) : null;
    const propPerson = d.proposedById ? findPerson(d.proposedById) : null;
    const saTaskAnchor = toTaskAnchor(d.startAnchor);
    const eaTaskAnchor = toTaskAnchor(d.endAnchor);
    const parentId = resolveParent(d.parentGroupId);
    const t = {
      id: tid,
      subject: (d.subject||'').trim(),
      completed: false,
      responsibleId: d.responsibleId || '',
      responsibleRaw: respPerson ? (respPerson.email||'') : '',
      proposedById: d.proposedById || (Array.isArray(d.proposedByIds) && d.proposedByIds[0]) || '',
      proposedByRaw: propPerson ? (propPerson.email||'') : '',
      // Preserve ALL selected proposers, not just the first one.
      proposedByIds: Array.isArray(d.proposedByIds) && d.proposedByIds.length > 0
        ? d.proposedByIds.slice()
        : (d.proposedById ? [d.proposedById] : []),
      priority: d.priority || '',
      type: d.type || '',
      dueDate: '',
      slackStatus: d.slackStatus || '',
      slackStatusRaw: '',
      panelStatus: '',
      dedicatedHours: '',
      estimatedHours: '',
      shareWith: d.shareWith || '',
      extraComments: (d.extraComments||'').trim(),
      sharing: false,
      isGroup: !!d.isGroup,
      groupId: parentId,
      taskTags: Array.isArray(d.taskTags) ? d.taskTags.slice() : (d.taskTag ? [d.taskTag] : []),
      startDate: d.startDate || '',
      endDate: d.endDate || '',
      startAnchor: saTaskAnchor,
      endAnchor: eaTaskAnchor,
      _createdLocal: now,
    };
    if (d.estimatedHours) t.estimatedHours = d.estimatedHours;
    if (d.dedicatedHours) t.dedicatedHours = d.dedicatedHours;
    if (d.durationDays && parseInt(d.durationDays,10) >= 1) t.durationDays = parseInt(d.durationDays,10);
    STORE.tasks.push(t);
    // Multi-roadmap support: use roadmapIds[] if present, fall back to roadmapId
    const rmIds = Array.isArray(d.roadmapIds) && d.roadmapIds.length > 0 ? d.roadmapIds : (d.roadmapId ? [d.roadmapId] : []);
    rmIds.forEach(rid => {
      const rm = (STORE.roadmaps||[]).find(x => x.id === rid);
      if (rm) {
        if (!Array.isArray(rm.tasks)) rm.tasks = [];
        if (!rm.tasks.some(e => e.taskId === tid)) {
          rm.tasks.push({ taskId: tid, startDate: d.startDate || '', endDate: d.endDate || '' });
        }
      }
    });
    createdIds.push(tid);
  }
  saveStore(STORE);
  bnBulkCloseModal();
  if (typeof render === 'function') try { render(); } catch (_) {}
  console.log('[bulk-create] created', createdIds.length, 'tasks:', createdIds);
  try {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#1a1a1a; color:#fff; padding:10px 18px; border-radius:8px; z-index:99999; font-size:14px; font-weight:600;';
    toast.textContent = '✓ ' + createdIds.length + ' tasks created';
    document.body.appendChild(toast);
    setTimeout(()=>{ try{toast.remove();}catch(_){} }, 2500);
  } catch (_) {}
}

// Wire bulk-create UI when ready
function bnInitBulkCreateUI(){
  const openBtn = document.getElementById('tasksBulkAddBtn');
  if (openBtn && !openBtn._wired) {
    openBtn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      bnBulkOpenModal();
    });
    openBtn._wired = true;
  }
  const c1 = document.getElementById('bnBulkCancelBtn1');
  if (c1 && !c1._wired) { c1.addEventListener('click', bnBulkCloseModal); c1._wired = true; }
  const c2 = document.getElementById('bnBulkCancelBtn2');
  if (c2 && !c2._wired) { c2.addEventListener('click', bnBulkCloseModal); c2._wired = true; }
  const nextBtn = document.getElementById('bnBulkNextBtn');
  if (nextBtn && !nextBtn._wired) { nextBtn.addEventListener('click', bnBulkGoToStage2); nextBtn._wired = true; }
  const backBtn = document.getElementById('bnBulkBackBtn');
  if (backBtn && !backBtn._wired) { backBtn.addEventListener('click', bnBulkBackToStage1); backBtn._wired = true; }
  // Legacy Apply-all button (pre-v13). Element is gone; the no-op `if (apply && …)` keeps it
  // safe for any future re-introduction. The card-level Apply button is wired inside bnBulkRenderStage2.
  const apply = document.getElementById('bnBulkApplyAllBtn');
  if (apply && !apply._wired) { apply.addEventListener('click', bnBulkApplyDefaultsToAll); apply._wired = true; }
  const save = document.getElementById('bnBulkSaveBtn');
  if (save && !save._wired) { save.addEventListener('click', bnBulkSave); save._wired = true; }
  const addRowBtn = document.getElementById('bnBulkAddRowBtn');
  if (addRowBtn && !addRowBtn._wired) { addRowBtn.addEventListener('click', () => { bnBulkAddRow(); }); addRowBtn._wired = true; }
  // Mode radios
  document.querySelectorAll('input[name="bnBulkMode"]').forEach(r => {
    if (r._wired) return;
    r.addEventListener('change', () => bnBulkSetMode(r.value));
    r._wired = true;
  });
  // Paste textareas → live count update + line numbers gutter
  function updateGutter(taId, gutterId){
    const t = document.getElementById(taId); const g = document.getElementById(gutterId);
    if (!t || !g) return;
    const lines = (t.value || '').split('\n');
    const total = Math.max(lines.length, 1);
    let html = '';
    for (let i = 0; i < total; i++){
      const empty = !lines[i] || !lines[i].trim();
      html += '<span class="num' + (empty ? ' empty' : '') + '">' + (empty ? '·' : (i+1)) + '</span>';
    }
    g.innerHTML = html;
  }
  ['bnBulkPasteSubjects','bnBulkPasteComments'].forEach(id => {
    const t = document.getElementById(id);
    const gutterId = id + 'Gutter';
    const g = document.getElementById(gutterId);
    if (t && !t._wired) {
      const refresh = () => {
        updateGutter(id, gutterId);
        const n = bnBulkParsePasteToRows().length;
        const e = document.getElementById('bnBulkS1Count'); if (e) e.textContent = n;
      };
      t.addEventListener('input', refresh);
      t.addEventListener('scroll', () => { if (g) g.scrollTop = t.scrollTop; });
      t._wired = true;
      updateGutter(id, gutterId);
    }
  });
  const modal = document.getElementById('bnBulkCreateModal');
  if (modal && !modal._wired) {
    modal.addEventListener('click', e => { if (e.target === modal) bnBulkCloseModal(); });
    modal._wired = true;
  }
}
