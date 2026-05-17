// =============================================================================
// views/home.js
// ---------------------------------------------------------------------------
// Home / Dashboard view. Loaded AFTER the inline app script so its references to STORE,
// helpers, escapeHtml, etc., are all resolved via the shared classic-script
// scope. The function name stays the same so call-sites in inline (e.g. the
// central render() dispatcher) keep working unchanged.
// =============================================================================

function renderHomePage() {
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
  const arcsG  = document.getElementById('dashBucketArcs');
  const legend = document.getElementById('dashBucketLegend');
  const totalEl = document.getElementById('dashTotalValue');
  if (totalEl) totalEl.textContent = total;
  if (arcsG) {
    const R = 80;
    const C = 2 * Math.PI * R;
    let cursor = 0; // cumulative length consumed
    arcsG.innerHTML = buckets4.map(b => {
      if (b.count <= 0 || total <= 0) return '';
      const frac = b.count / total;
      const arcLen = frac * C;
      // Tiny visual gap between segments — only when there are 2+ non-empty segments
      const gap = 2;
      const dashArray = Math.max(0, arcLen - gap) + ' ' + (C - Math.max(0, arcLen - gap));
      const dashOffset = -cursor;
      cursor += arcLen;
      return '<circle class="donut-bucket-arc" cx="100" cy="100" r="' + R + '" fill="none" ' +
        'stroke="' + b.color + '" stroke-width="22" ' +
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

  // Pipeline bars in the user-defined order, with the new colors
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
  const barsCont = document.getElementById("dashPipelineBars");
  barsCont.innerHTML = buckets.map(b => {
    const h = b.count > 0 ? Math.max(8, Math.round((b.count / maxCount) * 160)) : 4;
    return '<div class="pipeline-bar-col">' +
      '<div class="pipeline-bar-amount">' + b.count + '</div>' +
      '<div class="pipeline-bar" style="height:' + h + 'px; background:' + b.color + '"></div>' +
      '<div class="pipeline-bar-label">' + b.label + '</div>' +
      '</div>';
  }).join("");

  // Top contributors: top 5 people by task count — excluding deactivated members
  const counts = TEAM
    .filter(p => !isDeactivated(p.id))
    .map(p => ({ p, n: tasks.filter(t => t.responsibleId === p.id).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  document.getElementById("dashTopContributors").innerHTML = counts.length === 0
    ? '<div style="color:#6b6b6b; font-size:13px">No task assignments yet.</div>'
    : counts.map(({p, n}) => {
      const open = tasks.filter(t => t.responsibleId === p.id && openStatuses.indexOf(t.slackStatus) >= 0).length;
      return '<div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:#faf9f7; border:1px solid #ececea; border-radius:10px; min-width:200px">' +
        '<span class="avatar" style="width:36px; height:36px; flex-shrink:0; background:' + p.color + '; font-size:13px">' +
          '<img src="' + p.photo + '" alt="" onerror="this.remove()">' +
          '<span class="ini">' + initials(p.name) + '</span>' +
        '</span>' +
        '<div style="flex:1; min-width:0">' +
          '<div style="font-weight:600; font-size:13px; color:#1a1a1a">' + escapeHtml(p.displayName) + '</div>' +
          '<div style="font-size:11px; color:#6b6b6b">' + n + ' total · ' + open + ' open</div>' +
        '</div>' +
        '</div>';
    }).join("");

  // Activity by priority
  const priorities = ["Critical", "Alta", "Media", "Baja", "Muy Baja"];
  const prioColors = { "Critical": "#f87171", "Alta": "#fbbf24", "Media": "#34d399", "Baja": "#94a3b8", "Muy Baja": "#64748b" };
  document.getElementById("dashByPriority").innerHTML = priorities.map(p => {
    const n = tasks.filter(t => t.priority === p).length;
    return '<div class="activity-stat">' +
      '<div style="width:8px; height:30px; background:' + prioColors[p] + '; border-radius:4px"></div>' +
      '<div class="value">' + n + '</div>' +
      '<div class="label">' + p + '</div>' +
      '</div>';
  }).join("");

  // Activity by type
  const types = ["Project", "Responsability", "Request", "ERROR", "Infinite"];
  const typeColors = { "Project": "#a78bfa", "Responsability": "#60a5fa", "Request": "#34d399", "ERROR": "#f87171", "Infinite": "#fbbf24" };
  document.getElementById("dashByType").innerHTML = types.map(t => {
    const n = tasks.filter(x => x.type === t).length;
    return '<div class="activity-stat">' +
      '<div style="width:8px; height:30px; background:' + typeColors[t] + '; border-radius:4px"></div>' +
      '<div class="value">' + n + '</div>' +
      '<div class="label">' + t + '</div>' +
      '</div>';
  }).join("");
}

