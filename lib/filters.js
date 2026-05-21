/* ===========================================================================
 * BERNI NAVIGATOR — lib/filters.js
 * ---------------------------------------------------------------------------
 * Single source of truth for task-filter predicates.
 *
 * Why this file exists:
 *   The inline app script declares filter state with `let` (statusInclude,
 *   personInclude, teamOnly, searchQuery, …), so those bindings live in the
 *   inline-script scope and are NOT on `window`. Each predicate here therefore
 *   takes a `state` snapshot returned by `bnGetFilterState()` in the inline
 *   script. Functions that ARE on window (personMatchesTagFilter,
 *   taskMatchesRoadmapFilter, taskMatchesDateStatusFilter, isTeamMember,
 *   isDeactivated, taskRoadmapIds, taskDateStatus) are referenced via window.
 *
 * Before this file, the same filter logic was copy-pasted across:
 *   - taskMatchesFilters
 *   - countTasksMatchingExcept
 *   - renderTeamStrip's `totalContextual`
 *   - countTasksForPersonContextual
 * Adding the "Type" filter required touching all four; missing one was a
 * silent bug. Now: add a predicate here, compose it where needed.
 *
 * Public surface (window.BNFilters):
 *   • allFiltersOK(t, state, opts?)  — composite gate
 *       opts = { skip: 'status' | ['status','person'], strictTeamOnly: bool }
 *       'strictTeamOnly' hides unassigned (used by pill counts).
 *       Default keeps unassigned visible (used by main task list).
 *   • Per-dim predicates: teamOnlyOK, teamOnlyOKKeepUnassigned, personOK,
 *     personTagOK, statusOK, prioOK, typeOK, taskTagOK, searchOK, roadmapOK,
 *     dateStatusOK.  All take (t, state).
 *
 * Skip-dim names (passed via opts.skip):
 *   'teamOnly', 'person', 'personTag', 'status', 'prio', 'type', 'taskTag',
 *   'search', 'roadmap', 'dateStatus'
 *
 * IMPORTANT: keep behaviour byte-identical to the original inline code.
 * Tests live by Chrome verification — refactor steps are committed atomically
 * so any divergence shows up as a count mismatch in the UI.
 * =========================================================================== */
(function () {
  'use strict';

  // -- atomic predicates -----------------------------------------------------

  // teamOnly variant that HIDES unassigned tasks too.
  // Used by countTasksMatchingExcept so pill totals exclude unassigned.
  function teamOnlyOK(t, s) {
    if (!s.teamOnly) return true;
    if (!t.responsibleId) return false;
    if (typeof window.isTeamMember === 'function' && !window.isTeamMember(t.responsibleId)) return false;
    if (typeof window.isDeactivated === 'function' && window.isDeactivated(t.responsibleId)) return false;
    return true;
  }

  // teamOnly variant that KEEPS unassigned visible (so the Unassigned card
  // still renders in by-person view).  Used by taskMatchesFilters.
  function teamOnlyOKKeepUnassigned(t, s) {
    if (!s.teamOnly) return true;
    if (!t.responsibleId) return true; // unassigned stays visible
    if (typeof window.isTeamMember === 'function' && !window.isTeamMember(t.responsibleId)) return false;
    if (typeof window.isDeactivated === 'function' && window.isDeactivated(t.responsibleId)) return false;
    return true;
  }

  function personOK(t, s) {
    const pid = t.responsibleId ? t.responsibleId : '__unassigned';
    if (s.personInclude.size > 0 && !s.personInclude.has(pid)) return false;
    if (s.personExclude.has(pid)) return false;
    return true;
  }

  // activeOnly: when the "Active only" toggle is on (and it defaults to on), hide tasks
  // whose responsible person is in the Disabled section. Unassigned tasks stay visible —
  // they don't belong to a person at all, so the "inactive person" rule doesn't apply.
  function activeOnlyOK(t, s) {
    if (!s.activeOnly) return true;
    if (!t.responsibleId) return true; // unassigned stays visible
    if (typeof window.isDeactivated === 'function' && window.isDeactivated(t.responsibleId)) return false;
    return true;
  }

  function personTagOK(t /* , s */) {
    if (typeof window.personMatchesTagFilter === 'function') {
      return window.personMatchesTagFilter(t.responsibleId);
    }
    return true;
  }

  function statusOK(t, s) {
    if (s.statusInclude.size > 0 && !s.statusInclude.has(t.slackStatus)) return false;
    if (s.statusExclude.has(t.slackStatus)) return false;
    return true;
  }

  function prioOK(t, s) {
    const k = t.priority || '__none';
    if (s.prioInclude.size > 0 && !s.prioInclude.has(k)) return false;
    if (s.prioExclude.has(k)) return false;
    return true;
  }

  function typeOK(t, s) {
    const k = t.type || '__none';
    if (s.typeInclude.size > 0 && !s.typeInclude.has(k)) return false;
    if (s.typeExclude.has(k)) return false;
    return true;
  }

  function shareWithOK(t, s) {
    // Tristate Include/Exclude on the task's `shareWith` field (Private / Team /
    // Everyone / (empty)). Missing sets in the state snapshot mean the filter is
    // effectively off (used by older callers).
    if (!s.shareWithInclude || !s.shareWithExclude) return true;
    const k = t.shareWith || '__none';
    if (s.shareWithInclude.size > 0 && !s.shareWithInclude.has(k)) return false;
    if (s.shareWithExclude.has(k)) return false;
    return true;
  }

  function taskTagOK(t, s) {
    const tt = Array.isArray(t.taskTags) ? t.taskTags : [];
    if (s.taskTagInclude.has('__none')) {
      if (tt.length !== 0) return false;
    } else if (s.taskTagInclude.size > 0) {
      let hasAny = false;
      for (const tag of s.taskTagInclude) if (tt.includes(tag)) { hasAny = true; break; }
      if (!hasAny) return false;
    }
    if (s.taskTagExclude.has('__none') && tt.length === 0) return false;
    for (const tag of s.taskTagExclude) if (tag !== '__none' && tt.includes(tag)) return false;
    return true;
  }

  function searchOK(t, s) {
    if (!s.searchQuery) return true;
    const q = s.searchQuery.toLowerCase();
    const hay = (t.subject + ' ' + (t.extraComments || '') + ' ' + (t.slackStatus || '')).toLowerCase();
    return hay.includes(q);
  }

  function roadmapOK(t /* , s */) {
    if (typeof window.taskMatchesRoadmapFilter === 'function') {
      return window.taskMatchesRoadmapFilter(t);
    }
    return true;
  }

  function dateStatusOK(t /* , s */) {
    if (typeof window.taskMatchesDateStatusFilter === 'function') {
      return window.taskMatchesDateStatusFilter(t);
    }
    return true;
  }

  // Global visibility rule based on the task's `shareWith` value:
  //   • 'Private'  → only the responsible person sees the task (no one else,
  //                  not even admins, not even proposed-by users).
  //   • 'Team'     → responsible + every proposed-by user sees it.
  //   • 'Everyone' / empty / anything else → no restriction, visible to all.
  // Admins do NOT get a bypass — Private means private, even from admins.
  // (The user explicitly asked for this. If we ever want an admin god-view
  // back, gate it on a separate flag.)
  function shareWithVisibilityOK(t, s) {
    const sw = t && t.shareWith;
    if (!sw || sw === 'Everyone') return true;
    const myPid = s && s.myPid;
    if (!myPid) return false;
    // Responsible always sees their own tasks.
    if (t.responsibleId && t.responsibleId === myPid) return true;
    if (sw === 'Team') {
      // Proposed-by users see Team-scoped tasks. proposedByIds (plural) is
      // the source of truth; proposedById is the legacy single-id field.
      if (Array.isArray(t.proposedByIds)) return t.proposedByIds.includes(myPid);
      return t.proposedById === myPid;
    }
    // 'Private' (or any other restrictive bucket) → only the responsible.
    return false;
  }

  // Global visibility rule for UNASSIGNED tasks (no responsibleId AND no roadmap):
  //   - Admins (NOT in preview-as) see everything.
  //   - Tasks attached to ≥1 roadmap stay visible to everyone — they're part of
  //     team-wide planning, not personal scratch tasks.
  //   - For "truly orphan" unassigned tasks (no responsible AND no roadmap),
  //     non-admins only see ones they themselves proposed.
  // Applies to EVERY view through allFiltersOK / taskMatchesFilters.
  function unassignedVisibilityOK(t, s) {
    if (t && t.responsibleId) return true;          // assigned: not our concern
    if (s && s.isAdminLive) return true;            // admin (not previewing) sees all
    // Tasks attached to a roadmap stay visible even when unassigned: a roadmap
    // task with no owner is a planning placeholder that the team should see.
    let inAnyRoadmap = false;
    try {
      if (typeof window.getTaskRoadmaps === 'function') {
        const rms = window.getTaskRoadmaps(t) || [];
        inAnyRoadmap = rms.length > 0;
      } else if (Array.isArray(t.roadmaps)) {
        inAnyRoadmap = t.roadmaps.length > 0;
      } else if (t.roadmapId) {
        inAnyRoadmap = true;
      }
    } catch (_) {}
    if (inAnyRoadmap) return true;
    const myPid = s && s.myPid;
    if (!myPid) return false;
    if (Array.isArray(t.proposedByIds)) return t.proposedByIds.includes(myPid);
    return t.proposedById === myPid;
  }

  // -- composite gate --------------------------------------------------------

  function _skipSet(skip) {
    if (!skip) return null;
    if (Array.isArray(skip)) return new Set(skip);
    return new Set([skip]);
  }

  // allFiltersOK(t, state, opts?)
  //   opts.skip            — string | string[] of dims to skip (see header)
  //   opts.strictTeamOnly  — when true, use teamOnlyOK (hides unassigned);
  //                          when false/absent, use teamOnlyOKKeepUnassigned.
  function allFiltersOK(t, s, opts) {
    const skip = _skipSet(opts && opts.skip);
    const has = (dim) => !!(skip && skip.has(dim));
    const strict = !!(opts && opts.strictTeamOnly);
    if (!has('teamOnly')) {
      if (strict ? !teamOnlyOK(t, s) : !teamOnlyOKKeepUnassigned(t, s)) return false;
    }
    if (!has('activeOnly') && !activeOnlyOK(t, s)) return false;
    if (!has('person')     && !personOK(t, s))     return false;
    if (!has('personTag')  && !personTagOK(t, s))  return false;
    if (!has('status')     && !statusOK(t, s))     return false;
    if (!has('prio')       && !prioOK(t, s))       return false;
    if (!has('type')       && !typeOK(t, s))       return false;
    if (!has('shareWith')  && !shareWithOK(t, s))  return false;
    if (!has('taskTag')    && !taskTagOK(t, s))    return false;
    if (!has('search')     && !searchOK(t, s))     return false;
    if (!has('roadmap')    && !roadmapOK(t, s))    return false;
    if (!has('dateStatus') && !dateStatusOK(t, s)) return false;
    if (!has('unassignedVisibility') && !unassignedVisibilityOK(t, s)) return false;
    if (!has('shareWithVisibility') && !shareWithVisibilityOK(t, s)) return false;
    return true;
  }

  // -- expose ----------------------------------------------------------------

  window.BNFilters = {
    // composite
    allFiltersOK,
    // atomic
    teamOnlyOK,
    teamOnlyOKKeepUnassigned,
    activeOnlyOK,
    personOK,
    personTagOK,
    statusOK,
    prioOK,
    typeOK,
    shareWithOK,
    taskTagOK,
    searchOK,
    roadmapOK,
    dateStatusOK,
    unassignedVisibilityOK,
    shareWithVisibilityOK,
  };
})();
