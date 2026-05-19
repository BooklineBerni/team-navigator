// =============================================================================
// views/home.js
// ---------------------------------------------------------------------------
// Home / Dashboard view. Loaded AFTER the inline app script so its references to STORE,
// helpers, escapeHtml, etc., are all resolved via the shared classic-script
// scope. The function name stays the same so call-sites in inline (e.g. the
// central render() dispatcher) keep working unchanged.
// =============================================================================

// Returns the display name (first name) for the currently logged-in user.
// Honors preview-as (admin previewing as another user). Falls back to
// capitalizing the email prefix when the email isn't in TEAM.
function _bnHomeUserDisplayName() {
  let email = '';
  if (typeof bnPreviewAsEmail !== 'undefined' && bnPreviewAsEmail) email = bnPreviewAsEmail;
  else if (typeof bnSupabaseUser !== 'undefined' && bnSupabaseUser && bnSupabaseUser.email) email = bnSupabaseUser.email;
  email = (email || '').toLowerCase();
  if (!email) return '';
  const list = (typeof TEAM !== 'undefined' ? TEAM : []).concat(typeof EXTERNAL_TEAM !== 'undefined' ? EXTERNAL_TEAM : []);
  const m = list.find(p => (p.email || '').toLowerCase() === email);
  if (m) return m.displayName || (m.name || '').split(' ')[0] || '';
  const pfx = email.split('@')[0].split('.')[0];
  return pfx.charAt(0).toUpperCase() + pfx.slice(1);
}

function renderHomePage() {
  // Personalised greeting — runs every time Home is rendered so it stays in
  // sync with auth state / preview-as.
  const greetEl = document.getElementById('homeGreeting');
  if (greetEl) {
    const name = _bnHomeUserDisplayName();
    const wave = '<span style="display:inline-block; transform: rotate(15deg)">👋</span>';
    greetEl.innerHTML = (name ? '¡Hola, ' + escapeHtml(name) + '! ' : '¡Hola! ') + wave;
  }
  const tasks = STORE.tasks;
  const total = tasks.length;
  // "Open" = any status that's not a terminal state (Completed/Archived/Discarded) and not empty
  const openStatuses = ["Waiting", "Proposed", "Later / Next", "In Progress", "Under Review"];
  const open = tasks.filter(t => openStatuses.indexOf(t.slackStatus) >= 0).length;
  const completed = tasks.filter(t => t.slackStatus === "Completed").length;
  const archived = tasks.filter(t => t.slackStatus === "Archived").length;
  const discarded = tasks.filter(t => t.slackStatus === "Discarded").length;

  // ===== 4-bucket donut (Solved / Doing / To do / Idle) =====
  // Buckets sum to `total`. Each bucket draws an arc on the ring; empty buckets are skipped.
  const buckets4 = [
    { key: 'solved', label: 'Solved',  color: '#16a34a',
      hint: 'Completed + Discarded',
      count: tasks.filter(t => t.slackStatus === 'Completed' || t.slackStatus === 'Discarded').length },
    { key: 'doing',  label: 'Doing',   color: '#f97316',
      hint: 'In Progress + Under Review',
      count: tasks.filter(t => t.slackStatus === 'In Progress' || t.slackStatus === 'Under Review').length },
    { key: 'todo',   label: 'To do',   color: '#1d4ed8',
      hint: 'Proposed + Later / Next',
      count: tasks.filter(t => t.slackStatus === 'Proposed' || t.slackStatus === 'Later / Next').length },
    { key: 'idle',   label: 'Idle',    color: '#a8a29e',
      hint: 'Waiting + Archived + (empty)',
      count: tasks.filter(t => t.slackStatus === 'Waiting' || t.slackStatus === 'Archived' || !t.slackStatus).length },
  ];
  // KPI hero row
  const _pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
  const _set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const _setBar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = pct + '%'; };
  _set('kpiTotal', total);
  _set('kpiDoing',  buckets4[1].count);  _set('kpiDoingPct',  _pct(buckets4[1].count) + '%'); _setBar('kpiDoingFill',  _pct(buckets4[1].count));
  _set('kpiTodo',   buckets4[2].count);  _set('kpiTodoPct',   _pct(buckets4[2].count) + '%'); _setBar('kpiTodoFill',   _pct(buckets4[2].count));
  _set('kpiSolved', buckets4[0].count);  _set('kpiSolvedPct', _pct(buckets4[0].count) + '%'); _setBar('kpiSolvedFill', _pct(buckets4[0].count));

  const arcsG  = document.getElementById('dashBucketArcs');
  const legend = document.getElementById('dashBucketLegend');
  const totalEl = document.getElementById('dashTotalValue');
  if (totalEl) totalEl.textContent = total;
  if (arcsG) {
    const R = 86;
    const C = 2 * Math.PI * R;
    let cursor = 0; // cumulative length consumed
    arcsG.innerHTML = buckets4.map(b => {
      if (b.count <= 0 || total <= 0) return '';
      const frac = b.count / total;
      const arcLen = frac * C;
      // Slightly larger gap between segments for a more modern, "pill"-style look
      const gap = 3;
      const dashArray = Math.max(0, arcLen - gap) + ' ' + (C - Math.max(0, arcLen - gap));
      const dashOffset = -cursor;
      cursor += arcLen;
      return '<circle class="donut-bucket-arc" cx="110" cy="110" r="' + R + '" fill="none" ' +
        'stroke="' + b.color + '" stroke-width="18" stroke-linecap="round" ' +
        'stroke-dasharray="' + dashArray + '" ' +
        'stroke-dashoffset="' + dashOffset + '">' +
        '<title>' + escapeHtml(b.label) + ' — ' + b.count + ' (' + escapeHtml(b.hint) + ')</title>' +
        '</circle>';
    }).join('');
  }
  if (legend) {
    legend.innerHTML = buckets4.map(b => {
      const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
      return '<div class="leg-row" title="' + escapeHtml(b.hint) + '">' +
        '<span class="leg-dot" style="background:' + b.color + '"></span>' +
        '<span class="leg-name">' + escapeHtml(b.label) + '</span>' +
        '<span class="leg-num">' + b.count + '</span>' +
        '<span class="leg-pct">(' + pct + '%)</span>' +
      '</div>';
    }).join('');
  }

  // Pipeline by status — horizontal rows with mini progress bars (modern, info-dense).
  const buckets = [
    { key: "",             label: "(empty)",      color: "#cbd5e1", count: tasks.filter(t => !t.slackStatus).length },
    { key: "Waiting",      label: "Waiting",      color: "#60a5fa", count: tasks.filter(t => t.slackStatus === "Waiting").length },
    { key: "Proposed",     label: "Proposed",     color: "#1d4ed8", count: tasks.filter(t => t.slackStatus === "Proposed").length },
    { key: "Later / Next", label: "Later / Next", color: "#dc2626", count: tasks.filter(t => t.slackStatus === "Later / Next").length },
    { key: "In Progress",  label: "In Progress",  color: "#f97316", count: tasks.filter(t => t.slackStatus === "In Progress").length },
    { key: "Under Review", label: "Under Review", color: "#7c3aed", count: tasks.filter(t => t.slackStatus === "Under Review").length },
    { key: "Completed",    label: "Completed",    color: "#16a34a", count: completed },
    { key: "Archived",     label: "Archived",     color: "#a98c5a", count: archived },
    { key: "Discarded",    label: "Discarded",    color: "#9a9a9a", count: discarded }
  ];
  const maxCount = Math.max(1, ...buckets.map(b => b.count));
  const rowsCont = document.getElementById("dashPipelineRows");
  if (rowsCont) {
    rowsCont.innerHTML = buckets.map(b => {
      const pct  = total > 0 ? Math.round((b.count / total) * 100) : 0;
      const fill = b.count > 0 ? Math.max(2, Math.round((b.count / maxCount) * 100)) : 0;
      return '<div class="pipeline-row" title="' + escapeHtml(b.label) + ' — ' + b.count + ' tasks (' + pct + '%)">' +
        '<span class="pr-dot" style="background:' + b.color + '"></span>' +
        '<span class="pr-name">' + escapeHtml(b.label) + '</span>' +
        '<div class="pr-bar"><div class="pr-fill" style="width:' + fill + '%; background:' + b.color + '"></div></div>' +
        '<span class="pr-num">' + b.count + '</span>' +
        '<span class="pr-pct">' + pct + '%</span>' +
      '</div>';
    }).join("");
  }

  // Top contributors: top 6 people by task count — excluding deactivated members
  const counts = TEAM
    .filter(p => !isDeactivated(p.id))
    .map(p => ({ p, n: tasks.filter(t => t.responsibleId === p.id).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  const contribMax = counts[0] ? counts[0].n : 1;
  document.getElementById("dashTopContributors").innerHTML = counts.length === 0
    ? '<div style="color:#6b6b6b; font-size:13px">No task assignments yet.</div>'
    : counts.map(({p, n}, i) => {
      const open  = tasks.filter(t => t.responsibleId === p.id && openStatuses.indexOf(t.slackStatus) >= 0).length;
      const done  = tasks.filter(t => t.responsibleId === p.id && (t.slackStatus === 'Completed' || t.slackStatus === 'Discarded')).length;
      const fill  = Math.max(4, Math.round((n / contribMax) * 100));
      return '<div class="contrib-card" data-rank="' + (i + 1) + '">' +
        '<span class="contrib-rank">#' + (i + 1) + '</span>' +
        '<span class="avatar contrib-av" style="background:' + p.color + '">' +
          '<img src="' + p.photo + '" alt="" onerror="this.remove()">' +
          '<span class="ini">' + initials(p.name) + '</span>' +
        '</span>' +
        '<div class="contrib-body">' +
          '<div class="contrib-name">' + escapeHtml(p.displayName) + '</div>' +
          '<div class="contrib-stats">' +
            '<span class="contrib-total">' + n + '</span>' +
            '<span class="contrib-sep">·</span>' +
            '<span class="contrib-open">' + open + ' open</span>' +
            '<span class="contrib-sep">·</span>' +
            '<span class="contrib-done">' + done + ' done</span>' +
          '</div>' +
          '<div class="contrib-bar"><div class="contrib-fill" style="width:' + fill + '%; background:' + p.color + '"></div></div>' +
        '</div>' +
        '</div>';
    }).join("");

  // Activity by priority
  const priorities = ["Critical", "High", "Medium", "Low", "Very Low"];
  const prioColors = { "Critical": "#ef4444", "High": "#f59e0b", "Medium": "#10b981", "Low": "#3b82f6", "Very Low": "#1e3a8a" };
  document.getElementById("dashByPriority").innerHTML = priorities.map(p => {
    const n = tasks.filter(t => t.priority === p).length;
    return '<div class="activity-card" style="--c:' + prioColors[p] + '">' +
      '<div class="activity-card-value">' + n + '</div>' +
      '<div class="activity-card-label">' + p + '</div>' +
      '</div>';
  }).join("");

  // Activity by type
  const types = ["Project", "Responsability", "Request", "ERROR", "Infinite"];
  const typeColors = { "Project": "#8b5cf6", "Responsability": "#3b82f6", "Request": "#10b981", "ERROR": "#ef4444", "Infinite": "#f59e0b" };
  document.getElementById("dashByType").innerHTML = types.map(t => {
    const n = tasks.filter(x => x.type === t).length;
    return '<div class="activity-card" style="--c:' + typeColors[t] + '">' +
      '<div class="activity-card-value">' + n + '</div>' +
      '<div class="activity-card-label">' + t + '</div>' +
      '</div>';
  }).join("");
}

