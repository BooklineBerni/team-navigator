// =============================================================================
// tests/smoke.spec.js
// ---------------------------------------------------------------------------
// Playwright smoke test for Berni Navigator.
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
    'lib/supabase-auth.js',
    'lib/permissions.js',
    'lib/filters.js',
    'lib/files-integration.js',
    'lib/requests-feature.js',
    'lib/date-picker.js',
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
    openPersonModal: typeof window.openPersonModal,
    openAddMember: typeof window.openAddMember,
    openFileModal: typeof window.openFileModal,
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

  // === Step 7: no console errors / page errors during the run. ===
  // We tolerate Supabase auth-related warnings (the test runs without auth).
  const interestingErrors = consoleErrors.filter(e =>
    !e.includes('supabase') &&
    !e.includes('Supabase') &&
    !e.includes('OAuth') &&
    !e.includes('Failed to fetch') &&
    !e.includes('chrome-extension')
  );
  expect(interestingErrors, 'console errors during smoke run').toEqual([]);
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
