// =============================================================================
// lib/date-picker.js
// ---------------------------------------------------------------------------
// Custom date-picker popover that hijacks any `<input type="date">` on the
// page (focus-in opens the popover, ESC/scroll/resize/click-outside closes).
//
// Loaded AFTER the inline app script.  Self-contained: all state (BN_DP),
// helpers (bnParseDate, bnFormatDate, bnRenderDatePicker, bnSelectDate,
// bnOpenDatePicker, bnCloseDatePicker) and the document-level event wirings
// live here so the inline never needs to know about them.
// =============================================================================

// ===== Custom date picker =====
// Replaces the browser's native date popup with a styled one matching the app's aesthetics.
const BN_DP = {
  popover: null,
  input: null,
  view: 'days',  // 'days' | 'months' | 'years'
  cursor: null,  // {year, month}
  monthNames: ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
  weekdayNames: ['L','M','X','J','V','S','D'],
};

function bnParseDate(str) {
  if (!str) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}
function bnFormatDate(d) {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + "-" + m + "-" + day;
}

function bnRenderDatePicker() {
  if (!BN_DP.popover || !BN_DP.input) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const selected = bnParseDate(BN_DP.input.value);
  const cur = BN_DP.cursor;
  let html = '';
  if (BN_DP.view === 'days') {
    html += '<div class="bn-dp-head">' +
      '<div class="bn-dp-nav" data-act="prev">‹</div>' +
      '<div class="bn-dp-month" data-act="months">' + BN_DP.monthNames[cur.month] + ' ' + cur.year + '</div>' +
      '<div class="bn-dp-nav" data-act="next">›</div>' +
      '</div>';
    html += '<div class="bn-dp-weekdays">';
    BN_DP.weekdayNames.forEach(w => { html += '<div class="bn-dp-wd">' + w + '</div>'; });
    html += '</div>';
    html += '<div class="bn-dp-grid">';
    const firstOfMonth = new Date(cur.year, cur.month, 1);
    const startWd = (firstOfMonth.getDay() + 6) % 7;  // 0=Mon
    const daysInMonth = new Date(cur.year, cur.month + 1, 0).getDate();
    const daysInPrev = new Date(cur.year, cur.month, 0).getDate();
    // Previous month tail
    for (let i = startWd - 1; i >= 0; i--) {
      const d = daysInPrev - i;
      const py = cur.month === 0 ? cur.year - 1 : cur.year;
      const pm = cur.month === 0 ? 12 : cur.month;
      const dt = new Date(py, pm - 1, d);
      const beforeMin = BN_DP.minDate && dt < BN_DP.minDate;
      const afterMax = BN_DP.maxDate && dt > BN_DP.maxDate;
      const cls = ['bn-dp-day','other-month'];
      if (beforeMin || afterMax) cls.push('disabled');
      html += '<div class="' + cls.join(' ') + '" data-d="' + py + '-' + String(pm).padStart(2,'0') + '-' + String(d).padStart(2,'0') + '">' + d + '</div>';
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(cur.year, cur.month, d);
      const isToday = dt.getTime() === today.getTime();
      const isSelected = selected && dt.getTime() === selected.getTime();
      const beforeMin = BN_DP.minDate && dt < BN_DP.minDate;
      const afterMax = BN_DP.maxDate && dt > BN_DP.maxDate;
      const disabled = beforeMin || afterMax;
      const cls = ['bn-dp-day'];
      if (isToday) cls.push('today');
      if (isSelected) cls.push('selected');
      if (disabled) cls.push('disabled');
      html += '<div class="' + cls.join(' ') + '" data-d="' + bnFormatDate(dt) + '"' + (disabled ? ' data-disabled="1"' : '') + '>' + d + '</div>';
    }
    // Next month head
    const totalCells = startWd + daysInMonth;
    const tail = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= tail; i++) {
      const ny = cur.month === 11 ? cur.year + 1 : cur.year;
      const nm = cur.month === 11 ? 0 : cur.month + 1;
      const dt = new Date(ny, nm, i);
      const beforeMin = BN_DP.minDate && dt < BN_DP.minDate;
      const afterMax = BN_DP.maxDate && dt > BN_DP.maxDate;
      const cls = ['bn-dp-day','other-month'];
      if (beforeMin || afterMax) cls.push('disabled');
      html += '<div class="' + cls.join(' ') + '" data-d="' + ny + '-' + String(nm + 1).padStart(2,'0') + '-' + String(i).padStart(2,'0') + '">' + i + '</div>';
    }
    html += '</div>';
    html += '<div class="bn-dp-foot">' +
      '<button class="bn-dp-clear" data-act="clear">Clear</button>' +
      '<button class="bn-dp-today" data-act="today">Today</button>' +
      '</div>';
  } else if (BN_DP.view === 'months') {
    html += '<div class="bn-dp-head">' +
      '<div class="bn-dp-nav" data-act="yprev">‹</div>' +
      '<div class="bn-dp-month" data-act="years">' + cur.year + '</div>' +
      '<div class="bn-dp-nav" data-act="ynext">›</div>' +
      '</div>';
    html += '<div class="bn-dp-monthpicker">';
    for (let i = 0; i < 12; i++) {
      const cls = ['bn-dp-mo'];
      if (i === cur.month) cls.push('selected');
      html += '<div class="' + cls.join(' ') + '" data-mo="' + i + '">' + BN_DP.monthNames[i].slice(0,3) + '</div>';
    }
    html += '</div>';
  } else if (BN_DP.view === 'years') {
    const startYear = Math.floor(cur.year / 12) * 12;
    html += '<div class="bn-dp-head">' +
      '<div class="bn-dp-nav" data-act="yrange-prev">‹</div>' +
      '<div class="bn-dp-month">' + startYear + ' – ' + (startYear + 11) + '</div>' +
      '<div class="bn-dp-nav" data-act="yrange-next">›</div>' +
      '</div>';
    html += '<div class="bn-dp-yearpicker">';
    for (let i = 0; i < 12; i++) {
      const y = startYear + i;
      const cls = ['bn-dp-year'];
      if (y === cur.year) cls.push('selected');
      html += '<div class="' + cls.join(' ') + '" data-y="' + y + '">' + y + '</div>';
    }
    html += '</div>';
  }
  BN_DP.popover.innerHTML = html;
  // Wire up
  BN_DP.popover.querySelectorAll('.bn-dp-day').forEach(node => {
    node.addEventListener('click', e => {
      e.stopPropagation();
      if (node.classList.contains('disabled')) return;
      bnSelectDate(node.dataset.d);
    });
  });
  BN_DP.popover.querySelectorAll('[data-act]').forEach(node => {
    node.addEventListener('click', e => {
      e.stopPropagation();
      const act = node.dataset.act;
      if (act === 'prev') { if (cur.month === 0) { cur.month = 11; cur.year--; } else cur.month--; bnRenderDatePicker(); }
      else if (act === 'next') { if (cur.month === 11) { cur.month = 0; cur.year++; } else cur.month++; bnRenderDatePicker(); }
      else if (act === 'months') { BN_DP.view = 'months'; bnRenderDatePicker(); }
      else if (act === 'years') { BN_DP.view = 'years'; bnRenderDatePicker(); }
      else if (act === 'yprev') { cur.year--; bnRenderDatePicker(); }
      else if (act === 'ynext') { cur.year++; bnRenderDatePicker(); }
      else if (act === 'yrange-prev') { cur.year -= 12; bnRenderDatePicker(); }
      else if (act === 'yrange-next') { cur.year += 12; bnRenderDatePicker(); }
      else if (act === 'clear') { bnSelectDate(""); }
      else if (act === 'today') { bnSelectDate(bnFormatDate(today)); }
    });
  });
  BN_DP.popover.querySelectorAll('.bn-dp-mo').forEach(node => {
    node.addEventListener('click', e => {
      e.stopPropagation();
      cur.month = parseInt(node.dataset.mo);
      BN_DP.view = 'days';
      bnRenderDatePicker();
    });
  });
  BN_DP.popover.querySelectorAll('.bn-dp-year').forEach(node => {
    node.addEventListener('click', e => {
      e.stopPropagation();
      cur.year = parseInt(node.dataset.y);
      BN_DP.view = 'months';
      bnRenderDatePicker();
    });
  });
}

function bnSelectDate(value) {
  if (!BN_DP.input) return;
  BN_DP.input.value = value;
  BN_DP.input.dispatchEvent(new Event('change', { bubbles: true }));
  BN_DP.input.dispatchEvent(new Event('input', { bubbles: true }));
  bnCloseDatePicker();
}

function bnOpenDatePicker(input) {
  bnCloseDatePicker();
  BN_DP.input = input;
  BN_DP.view = 'days';
  BN_DP.minDate = bnParseDate(input.getAttribute('min'));
  BN_DP.maxDate = bnParseDate(input.getAttribute('max'));
  const sel = bnParseDate(input.value);
  const today = new Date();
  // If no value yet, prefer data-default-month, then min, then today
  const defaultBase = sel
    || bnParseDate(input.getAttribute('data-default-month'))
    || BN_DP.minDate
    || today;
  BN_DP.cursor = { year: defaultBase.getFullYear(), month: defaultBase.getMonth() };
  const popover = document.createElement('div');
  popover.className = 'bn-datepicker';
  document.body.appendChild(popover);
  BN_DP.popover = popover;
  // Position relative to input
  const rect = input.getBoundingClientRect();
  popover.style.left = (rect.left + window.scrollX) + 'px';
  popover.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  bnRenderDatePicker();
  // Fix overflow off-right and flip-up if no room below
  setTimeout(() => {
    const pr = popover.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) {
      popover.style.left = Math.max(8, (window.innerWidth - pr.width - 8 + window.scrollX)) + 'px';
    }
    if (pr.bottom > window.innerHeight - 8) {
      // Try flipping above the input. If there's not enough space above either, clamp inside viewport.
      const spaceAbove = rect.top;
      const popHeight = pr.height;
      if (spaceAbove >= popHeight + 8) {
        popover.style.top = (rect.top + window.scrollY - popHeight - 4) + 'px';
      } else {
        // Clamp inside viewport (top edge)
        popover.style.top = (window.scrollY + Math.max(8, window.innerHeight - popHeight - 8)) + 'px';
      }
    }
  }, 0);
}
function bnCloseDatePicker() {
  if (BN_DP.popover) {
    BN_DP.popover.remove();
    BN_DP.popover = null;
    BN_DP.input = null;
  }
}

document.addEventListener('focusin', e => {
  const el = e.target;
  if (el && el.tagName === 'INPUT' && el.type === 'date') {
    bnOpenDatePicker(el);
  }
});
document.addEventListener('mousedown', e => {
  if (BN_DP.popover && !BN_DP.popover.contains(e.target) && e.target !== BN_DP.input) {
    bnCloseDatePicker();
  }
});
window.addEventListener('scroll', bnCloseDatePicker, true);
window.addEventListener('resize', bnCloseDatePicker);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') bnCloseDatePicker();
});

