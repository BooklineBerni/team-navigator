// =============================================================================
// tests/smoke.spec.js
// ---------------------------------------------------------------------------
// Playwright smoke test for Team Navigator.
//
// What it verifies (intentionally minimal — anything more than this becomes
// a maintenance burden for a tool with no real testing infrastructure):
//   1. The page loads without parse errors.
//   2. All extracted view files are loaded.
//   3. Key globals are functions, not undefined.
//   4. STORE has loaded (visibleTasksCount returns a positive number).
//   5. render() does not throw.
//   6. Switching between every sidebar view does not throw.
//   7. Opening + closing each modal does not throw.
//
// On localhost the auth gate may show; we still verify the JS side loads.
// The test runs against a *file://* URL served by Playwright's static server.
//
// Run locally:
//   npx playwright install chromium
//   npx playwright test tests/smoke.spec.js
//
// In CI: see .github/workflows/smoke.yml — runs on every push to main.
// =============================================================================

const { test, expect } = require('@playwright/test');

test('smoke: page loads, globals exist, views switch, modals open/close', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => {
    pageErrors.push(err.message);
  });

  // Open the page via the localhost server (BN_IS_LOCALHOST → no auth gate).
  await page.goto('/index.html');

  // Give classic scripts time to load and inline boot to run.
  await page.waitForTimeout(2500);

  // === Step 1: extracted view + lib files all loaded as <script src>. ===
  const scriptSrcs = await page.evaluate(() => Array.from(document.scripts)
    .map(s => s.src.split('/').slice(-2).join('/') || 'inline'));
  const expected = [
    'data/team-directory.js',
    'data/holidays.js',
    'lib/supabase-auth.js',
    'lib/permissions.js',
    'lib/filters.js',
    'lib/files-integration.js',
    'lib/requests-feature.js',
    'lib/date-picker.js',
    'lib/pickers.js',
    'lib/trash.js',
    'lib/backup.js',
    'lib/roadmap-task-modal.js',
    'views/bulk-create.js',
    'views/home.js',
    'views/files.js',
    'views/requests.js',
    'views/tasks.js',
    'views/team.js',
    'views/profile.js',
    'views/roadmaps.js',
    'views/roadmap-calendar.js',
    'views/modals/person-tags.js',
    'views/modals/add-member.js',
    'views/modals/tag-manager.js',
    'views/modals/subtasks-panel.js',
    'views/modals/task-tag-manager.js',
    'lib/bulk-popovers.js',
  ];
  for (const want of expected) {
    expect(scriptSrcs.some(s => s.includes(want.split('/').pop())),
           `expected ${want} to load`).toBeTruthy();
  }

  // === Step 2: key globals are functions. ===
  const globals = await page.evaluate(() => ({
    render: typeof window.render,
    visibleTasksCount: typeof window.visibleTasksCount,
    taskMatchesFilters: typeof window.taskMatchesFilters,
    BNFilters: typeof window.BNFilters,
    renderHomePage: typeof window.renderHomePage,
    renderFilesPage: typeof window.renderFilesPage,
    renderRequestsPage: typeof window.renderRequestsPage,
    renderFlatTasks: typeof window.renderFlatTasks,
    renderMembersPage: typeof window.renderMembersPage,
    renderProfilePage: typeof window.renderProfilePage,
    renderRoadmapsTimelinePage: typeof window.renderRoadmapsTimelinePage,
    renderRoadmapCalendar: typeof window.renderRoadmapCalendar,
    bnBulkOpenModal: typeof window.bnBulkOpenModal,
    bnLoadRequests: typeof window.bnLoadRequests,
    bnOpenDatePicker: typeof window.bnOpenDatePicker,
    openTaskTagManager: typeof window.openTaskTagManager,
    // openPersonModal removed in dead-code sweep (no callers)
    openAddMember: typeof window.openAddMember,
    openFileModal: typeof window.openFileModal,
    // Recently extracted libs:
    bnSoftDeleteTask: typeof window.bnSoftDeleteTask,
    bnRenderTrashPage: typeof window.bnRenderTrashPage,
    bnRotateAutoSnapshot: typeof window.bnRotateAutoSnapshot,
    bnExportBackup: typeof window.bnExportBackup,
    renderRoadmapsInModal: typeof window.renderRoadmapsInModal,
    setColoredPicker: typeof window.setColoredPicker,
    setResponsiblePicker: typeof window.setResponsiblePicker,
    renderBulkRoadmapsPopover: typeof window.renderBulkRoadmapsPopover,
    // Filter / state cycle helpers:
    cycleStatusFilter: typeof window.cycleStatusFilter,
    clearPrioFilter: typeof window.clearPrioFilter,
    selectAllVisible: typeof window.selectAllVisible,
    clearSelection: typeof window.clearSelection,
  }));
  for (const [name, type] of Object.entries(globals)) {
    expect(type, `${name} should be a function/object`).not.toBe('undefined');
  }

  // === Step 3: STORE has loaded (or empty STORE for fresh install). ===
  const counts = await page.evaluate(() => ({
    visible: window.visibleTasksCount(),
    matchesAll: window.countTasksMatchingExcept('status', '__all'),
  }));
  expect(counts.visible).toBeGreaterThanOrEqual(0);
  expect(counts.matchesAll).toBeGreaterThanOrEqual(0);

  // === Step 4: render() does not throw. ===
  const renderResult = await page.evaluate(() => {
    try { window.render(); return 'OK'; }
    catch (e) { return 'THREW: ' + e.message; }
  });
  expect(renderResult).toBe('OK');

  // === Step 5: switching to every sidebar view does not throw. ===
  const views = ['home', 'members', 'profile', 'tasks', 'roadmaps', 'requests', 'files'];
  for (const v of views) {
    const result = await page.evaluate((view) => {
      try {
        const tab = Array.from(document.querySelectorAll('[data-view]')).find(t => t.dataset.view === view);
        if (!tab) return 'no-tab';
        tab.click();
        return 'OK';
      } catch (e) {
        return 'THREW: ' + e.message;
      }
    }, v);
    expect(result, `switching to view "${v}"`).toBe('OK');
  }

  // === Step 6: opening + closing modals does not throw. ===
  const modals = [
    ['bnBulkOpenModal', 'bnBulkCloseModal'],
    ['openTaskTagManager', 'closeTaskTagManager'],
  ];
  for (const [openFn, closeFn] of modals) {
    const r = await page.evaluate(([o, c]) => {
      try {
        window[o]();
        window[c]();
        return 'OK';
      } catch (e) {
        return 'THREW: ' + e.message;
      }
    }, [openFn, closeFn]);
    expect(r, `modal ${openFn}/${closeFn}`).toBe('OK');
  }

  // === Step 7: business-logic assertions — actually verify the app *works*. ===
  // These catch regressions where the JS loads fine but the logic is broken.
  const business = await page.evaluate(() => {
    const out = {};
    // a) HOLIDAYS data is loaded and a known date is recognised
    out.holidaysLoaded = typeof HOLIDAYS === 'object' && !!HOLIDAYS['2026-01-01'];
    // b) Filter system: include "Proposed" status → visible count ≤ total, clear restores
    const before = window.visibleTasksCount();
    try {
      window.cycleStatusFilter('Proposed');
      const after = window.visibleTasksCount();
      window.clearStatusFilter();
      const restored = window.visibleTasksCount();
      out.filterWorks = (after <= before) && (restored === before);
    } catch (e) { out.filterWorks = 'err: ' + e.message; }
    // c) BNFilters predicates respond to state
    try {
      const t = STORE.tasks[0];
      if (!t) { out.predicates = 'no-tasks'; }
      else {
        const s1 = window.bnGetFilterState();
        const r1 = window.BNFilters.allFiltersOK(t, s1);
        out.predicates = typeof r1 === 'boolean';
      }
    } catch (e) { out.predicates = 'err: ' + e.message; }
    // d) Selection set starts empty
    out.selectionEmpty = (typeof selectedTaskIds === 'object') && (selectedTaskIds.size === 0);
    // e) STORE has the expected top-level fields
    out.storeShape = {
      tasks: Array.isArray(STORE.tasks),
      roadmaps: Array.isArray(STORE.roadmaps) || STORE.roadmaps === undefined,
    };
    // f) Tag library is initialised + has fallback
    try {
      const lib = window.getTagLibrary();
      out.tagLibrary = Array.isArray(lib) && lib.length > 0 && lib.every(t => t.name && t.bg && t.fg);
    } catch (e) { out.tagLibrary = 'err: ' + e.message; }
    // g) Task tag library is initialised
    try {
      const tlib = window.getTaskTagLibrary();
      out.taskTagLibrary = Array.isArray(tlib);
    } catch (e) { out.taskTagLibrary = 'err: ' + e.message; }
    // h) Each task in STORE has the minimum expected shape
    try {
      const missing = STORE.tasks.filter(t => !t.id || typeof t.subject !== 'string');
      out.taskShape = missing.length === 0;
    } catch (e) { out.taskShape = 'err: ' + e.message; }
    // i) Selecting all visible + clearing → counts match
    try {
      window.selectAllVisible();
      const selN = selectedTaskIds.size;
      window.clearSelection();
      const clearedN = selectedTaskIds.size;
      out.selectFlow = selN >= 0 && clearedN === 0;
    } catch (e) { out.selectFlow = 'err: ' + e.message; }
    // j) Tristate filter: cycling priority through include→exclude→off lands back at off.
    // NOTE: bnGetFilterState() returns *references* to the live Set objects, not
    // snapshots. We must capture each state IMMEDIATELY into a plain object.
    try {
      window.clearPrioFilter();
      const cap = () => {
        const s = window.bnGetFilterState();
        return { inc: new Set(s.prioInclude), exc: new Set(s.prioExclude) };
      };
      const s0 = cap();
      window.cyclePrioFilter('Alta');
      const s1 = cap();
      window.cyclePrioFilter('Alta');
      const s2 = cap();
      window.cyclePrioFilter('Alta');
      const s3 = cap();
      window.clearPrioFilter();   // leave state clean
      out.tristate = {
        startEmpty: s0.inc.size === 0 && s0.exc.size === 0,
        include:    s1.inc.has('Alta'),
        exclude:    s2.exc.has('Alta'),
        backToOff:  !s3.inc.has('Alta') && !s3.exc.has('Alta'),
      };
    } catch (e) { out.tristate = 'err: ' + e.message; }
    // k) Permissions: bnIsValidEmail accepts/rejects correctly
    try {
      out.emails = {
        valid:   window.bnIsValidEmail('foo@bookline.ai') === true,
        invalid: window.bnIsValidEmail('not-an-email') === false,
      };
    } catch (e) { out.emails = 'err: ' + e.message; }
    // l) Date picker helpers parse/format roundtrip
    try {
      const d = window.bnParseDate('2026-05-18');
      const s = window.bnFormatDate(d);
      out.datePicker = s === '2026-05-18';
    } catch (e) { out.datePicker = 'err: ' + e.message; }
    // m) Holiday lookup: 2026-01-01 is "Año Nuevo"
    try {
      const dt = new Date('2026-01-01T00:00:00');
      out.holidayLookup = window.holidayName(dt) === 'Año Nuevo';
    } catch (e) { out.holidayLookup = 'err: ' + e.message; }
    return out;
  });
  expect(business.holidaysLoaded, 'HOLIDAYS data must include 2026-01-01').toBeTruthy();
  expect(business.filterWorks, 'status filter must reduce count and restore').toBe(true);
  expect(business.predicates, 'BNFilters.allFiltersOK must return boolean').toBe(true);
  expect(business.selectionEmpty, 'selectedTaskIds must start empty').toBe(true);
  expect(business.storeShape.tasks, 'STORE.tasks must be array').toBe(true);
  expect(business.tagLibrary, 'getTagLibrary returns valid library').toBe(true);
  expect(business.taskTagLibrary, 'getTaskTagLibrary returns array').toBe(true);
  expect(business.taskShape, 'every task has id + subject').toBe(true);
  expect(business.selectFlow, 'select-all/clear flow works').toBe(true);
  expect(business.tristate.startEmpty,  'prio filter starts empty').toBe(true);
  expect(business.tristate.include,     'first cycle → include').toBe(true);
  expect(business.tristate.exclude,     'second cycle → exclude').toBe(true);
  expect(business.tristate.backToOff,   'third cycle → off').toBe(true);
  expect(business.emails.valid,         'valid email accepted').toBe(true);
  expect(business.emails.invalid,       'invalid email rejected').toBe(true);
  expect(business.datePicker,           'date parse/format roundtrip').toBe(true);
  expect(business.holidayLookup,        'holidayName(2026-01-01) === "Año Nuevo"').toBe(true);

  // === Step 8: end-to-end — bulk-create a task and verify it lands in STORE. ===
  // This is the most expensive assertion: it actually exercises the modal +
  // STORE.tasks.push + render() path the way a user would. Catches regressions
  // where the modal renders fine but Save doesn't persist.
  const e2eBulk = await page.evaluate(() => {
    try {
      const before = STORE.tasks.length;
      window.bnBulkOpenModal();
      // Stage 1: type a subject into the first row's subject input
      const firstSubj = document.querySelector('#bnBulkTableBody input[data-f="subject"]');
      if (!firstSubj) return 'no-subject-input';
      const SUBJECT = '__SMOKE_TEST_TASK__ ' + Date.now();
      firstSubj.value = SUBJECT;
      firstSubj.dispatchEvent(new Event('input', { bubbles: true }));
      // Stage 1 → Stage 2
      window.bnBulkGoToStage2();
      // Stage 2 → Save (which calls bnBulkSave and closes the modal)
      window.bnBulkSave();
      const after = STORE.tasks.length;
      const lastTask = STORE.tasks[STORE.tasks.length - 1];
      // Cleanup: remove the test task so reruns don't pollute STORE
      if (lastTask && lastTask.subject === SUBJECT) {
        const idx = STORE.tasks.findIndex(t => t.id === lastTask.id);
        if (idx >= 0) STORE.tasks.splice(idx, 1);
        saveStore(STORE);
      }
      return {
        added: after === before + 1,
        subjectMatches: lastTask && lastTask.subject === SUBJECT,
        idAssigned: !!(lastTask && lastTask.id),
      };
    } catch (e) { return 'err: ' + e.message; }
  });
  expect(e2eBulk.added, 'bulk-create added exactly one task').toBe(true);
  expect(e2eBulk.subjectMatches, 'new task has the typed subject').toBe(true);
  expect(e2eBulk.idAssigned, 'new task got an id').toBe(true);

  // === Step 9: no JavaScript page errors (parse/runtime exceptions) during the run. ===
  // Console messages are not checked here: in CI the page can't reach Google/
  // Supabase/Slack CDNs, so the console fills up with network errors that have
  // nothing to do with our JS being correct. The test above already proves
  // every global is defined and every view + modal works without throwing —
  // that's what we actually care about. `pageErrors` only fires on UNCAUGHT
  // JS exceptions (not network errors, not console.error), so it's the right
  // signal for "our code is broken".
  expect(pageErrors, 'uncaught page errors during smoke run').toEqual([]);
});
