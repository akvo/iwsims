# Implementation Plan — Filters for Dashboard Map View

Sequenced, checklisted tasks ready for execution. Companion to
[design.md](./design.md) and [requirements.md](./requirements.md).
Read those first — this doc is the *how* and *in what order*; the
others are the *what* and *why*.

**Branch:** `feature/209-visualization-adjust-legend-of-map-based-on-filter`
**Issue:** #209

---

## Pre-flight

- [x] Confirm working directory is on
      `feature/209-visualization-adjust-legend-of-map-based-on-filter`
- [x] Pull latest from origin to ensure no upstream changes since the
      design was approved
- [x] Run `./dc.sh up -d` so backend, frontend, db, and worker are
      reachable
- [x] Open
      [`backend/api/v1/v1_visualization/views.py:248`](../../../backend/api/v1/v1_visualization/views.py#L248)
      — confirm `GeolocationListView` matches the design's §3.1.1
      sketch (current behaviour: `from_date` / `to_date` filter the
      datapoint's own `created`)
- [x] Open
      [`frontend/src/components/dashboard/DashboardMap.jsx`](../../../frontend/src/components/dashboard/DashboardMap.jsx)
      — confirm the legacy `status_colors` / `status_question_id` /
      `status_monitoring_form_id` reads exist (the dead code we are
      removing)

---

## Phase 1 — Backend: extend the geolocation endpoint ✅

Goal: `GET /api/v1/maps/geolocation/{form_id}` accepts
`include_monitoring=true` and returns
`administration_full_name` + `updated` per point.

- [x] **Modify** [`backend/api/v1/v1_visualization/serializers.py`](../../../backend/api/v1/v1_visualization/serializers.py)
  - Add `include_monitoring = serializers.BooleanField(required=False, default=False)` to `GeoLocationFilterSerializer`
  - Extend `GeoLocationListSerializer` (or whichever serializer
    renders points) with `administration_full_name` and `updated`
    fields. `administration_full_name` is computed from
    `obj.administration.full_name`; `updated` is the model field
- [x] **Modify** [`backend/api/v1/v1_visualization/views.py:248`](../../../backend/api/v1/v1_visualization/views.py#L248)
  - Add the `include_monitoring` `OpenApiParameter` to
    `GeolocationListView.get`'s `@extend_schema`
  - Replace the existing `from_date` / `to_date` filter block with
    the branched version from design.md §3.1.1
  - **Bonus:** added `_build_admin_full_name_map` helper (2 queries
    regardless of point count) to avoid N+1 on
    `administration.full_name`
- [x] **Add tests** in
      [`backend/api/v1/v1_visualization/tests/tests_geolocation_include_monitoring.py`](../../../backend/api/v1/v1_visualization/tests/tests_geolocation_include_monitoring.py)
      *(new file using `VisualizationValuesTestMixin`)*
  - [x] Test 1: `include_monitoring` absent → date filter applies to
    registration's own `created` (current behaviour, regression
    guard)
  - [x] Test 2: `include_monitoring=true` + `from_date` → only datapoints
    with at least one monitoring child whose `created >= from_date`
    are returned
  - [x] Test 3: `include_monitoring=true` + both `from_date` and
    `to_date` → window is inclusive on both ends
  - [x] Test 4: `include_monitoring=true` excludes pending and draft
    monitoring children
  - [x] Test 5: response payload now contains
    `administration_full_name` and `updated` for each point
  - Existing `tests_geolocation_list.py` updated to assert the new
    response keys
- [x] **Verify**: `./dc.sh exec backend python manage.py test api.v1.v1_visualization.tests.tests_geolocation_list api.v1.v1_visualization.tests.tests_geolocation_criteria api.v1.v1_visualization.tests.tests_geolocation_include_monitoring`
      → 20/20 green

---

## Phase 2 — Backend: formula evaluator endpoint ✅

Goal: `GET /api/v1/visualization/values/formula` returns
`[{ group: parent_id, label: bucket_value }]` for the
configured formula, latest-repeat semantics, and the same auth /
admin-scope rules as `/visualization/values`.

- [x] **Create** [`backend/api/v1/v1_visualization/formula.py`](../../../backend/api/v1/v1_visualization/formula.py)
      containing pure helpers:
  - [x] `pick_latest_repeat(answers) → dict[int, answer_row]` — keyed
        by `question_id`, picks the row with the highest `index` per
        question. Accepts both ORM instances and `.values()` dicts.
  - [x] `_match(condition, answers_by_qid) → bool` — implements the
        Phase-1 operator set: `<`, `<=`, `>`, `>=`, `==`, `!=`,
        `between`, `option_equals`, `option_in`
  - [x] `evaluate(formula, answers_by_qid) → str` — iterates buckets
        in declared order, returns the first match's `value`, falls
        back to `formula["default"]["value"]`
  - [x] `validate_shape(formula)` — structural validator used by the
        request serializer to reject malformed input early
  - [x] Pure functions, no Django imports
- [x] **Add** a request serializer
      `FormulaValuesSerializer` to
      [`backend/api/v1/v1_visualization/serializers.py`](../../../backend/api/v1/v1_visualization/serializers.py)
      that validates the §3.2 query params:
  - [x] `form_id: int` (required) — the monitoring form
  - [x] `group_by: str` (required, must be `"parent_id"`)
  - [x] `monitoring: str` (default `"latest"`)
  - [x] `formula: str` (required) — URL-encoded JSON; the serializer
        parses it via `json.loads` in `validate_formula` and validates
        the shape (`buckets[]` and `default`)
  - [x] `criteria: str` (optional)
  - [x] `from_date`, `to_date` (optional, ISO date)
- [x] **Create** `visualization_values_formula` view in
      [`backend/api/v1/v1_visualization/views.py`](../../../backend/api/v1/v1_visualization/views.py)
      *(implemented as a `@api_view(["GET"])` function to match the
      existing `visualization_values` pattern)*
  - [x] Permission class: same as `visualization_values`
  - [x] Method: `GET` (consistent with `/visualization/values`)
  - [x] Query params validated by `FormulaValuesSerializer` against
        `request.query_params`
  - [x] For each `parent_id` in scope:
        1. Pick the latest monitoring child
           (ordered `parent_id, -created`, deduped) filtered by
           `is_pending=False, is_draft=False`
        2. Build `answers_by_qid` via `pick_latest_repeat`
        3. Call `formula.evaluate(...)`
        4. Append `{ group: parent_id, label: bucket_value }` to the
           result
  - [x] Reuses `apply_criteria_to_monitoring_qs` for the `criteria`
        param
- [x] **Wire URL** in
      [`backend/api/v1/v1_visualization/urls.py`](../../../backend/api/v1/v1_visualization/urls.py)
      under `^(?P<version>(v1))/visualization/values/formula$`
      *(placed before the `/visualization/values` route so the more
      specific pattern wins)*
- [x] **Add tests** — split into pure-function and view test files:
  - [x] [`tests_formula_pure.py`](../../../backend/api/v1/v1_visualization/tests/tests_formula_pure.py)
        — 28 tests covering all operators, missing-answer failure,
        latest-repeat selection, and `validate_shape` rejections
  - [x] [`tests_formula_values.py`](../../../backend/api/v1/v1_visualization/tests/tests_formula_values.py)
        — 9 view tests: AND-of-conditions, between bounds,
        latest-repeat in the live endpoint, default bucket, parent
        with no monitoring child omitted, pending exclusion,
        criteria composition, missing required param (400),
        malformed JSON (400)
  - Note: explicit "admin-scope auth" test deferred — the view
        currently mirrors `visualization_values` which has no
        permission class set (`# permission_classes = [IsAuthenticated]`
        commented out at the existing geolocation view too). Auth
        scoping can be tightened in a follow-up across all
        `/visualization/*` endpoints together.
- [x] **Verify**: `./dc.sh exec backend python manage.py test api.v1.v1_visualization`
      → 214/214 green

---

## Phase 3 — Frontend: refactor `DashboardMap` into a module ✅

Goal: replace the single `DashboardMap.jsx` file with a small folder,
drop the legacy `status_*` reads, render the new header layout.

- [x] **Create** [`frontend/src/components/dashboard/DashboardMap/index.jsx`](../../../frontend/src/components/dashboard/DashboardMap/index.jsx)
  - Moves and rewrites the current `DashboardMap.jsx` body
  - Drops all reads of `item.status_colors`,
    `item.status_question_id`, `item.status_monitoring_form_id`
  - Uses `useMapFilters` and `useMapByParent` hooks
  - Adds `className="dashboard-map-popup"` to `MapContainer` for
    scoped popup CSS
- [x] **Create** [`DashboardMap/DashboardMapHeader.jsx`](../../../frontend/src/components/dashboard/DashboardMap/DashboardMapHeader.jsx)
  - Renders title → `Select` per select filter → legend chips →
    `Switch` per toggle filter
  - Question-id select options come from `window.forms` via the
    new `getQuestionOptions` util
  - Formula select options come from `filter.formula.buckets[]`
  - Switch wraps in `Tooltip` "Cleared by date filter" when
    disabled
- [x] **Create** [`DashboardMap/MapPopupCard.jsx`](../../../frontend/src/components/dashboard/DashboardMap/MapPopupCard.jsx)
  - 4-row card: Name, Location, Last update, `<active filter>: <value>`
  - Question-id filter: looks up option label via `window.forms`
  - Formula filter: resolves bucket value to its declared `label`
  - "No monitoring data" when `byParent` has no entry for the
    clicked datapoint
  - "View details" link resolved from `click_url_template`,
    target `_blank`
- [x] **Create** [`DashboardMap/getQuestionOptions.js`](../../../frontend/src/components/dashboard/DashboardMap/getQuestionOptions.js)
  - Module-local util that mirrors the inlined helper in
    `DashboardFilters.jsx` (kept local to avoid scope-creep
    extraction across the dashboard tree in this PR)
- [x] **Create** [`DashboardMap/styles.scss`](../../../frontend/src/components/dashboard/DashboardMap/styles.scss)
  - Header layout, legend chips, popup card, popup tail/pointer
    hidden via the `.dashboard-map-popup` class scope
- [x] **Replace** [`frontend/src/components/dashboard/DashboardMap.jsx`](../../../frontend/src/components/dashboard/DashboardMap.jsx)
      contents with a re-export so existing
      `import DashboardMap from ".../DashboardMap"` callers keep
      working: `export { default } from "./DashboardMap/index";`
- [x] **Verify (lint + tests)**:
  - `./dc.sh exec -T frontend npx eslint src/components/dashboard/DashboardMap.jsx src/components/dashboard/DashboardMap/`
    → clean (one prettier issue auto-fixed)
  - `npm test -- --watchAll=false --testPathPattern='dashboard'`
    → 184/184 green

---

## Phase 4 — Frontend: hooks for state and per-parent values ✅

Goal: extract two well-tested hooks so `index.jsx` stays thin.

- [x] **Create** [`DashboardMap/useMapFilters.js`](../../../frontend/src/components/dashboard/DashboardMap/useMapFilters.js)
  - Signature:
    `useMapFilters(itemFilters, filterState) → { values, setValue, queryParams, toggleDisabled, activeFilter }`
  - Initialises `values` keyed by `filter.key`; `select` → `null`,
    `toggle` → `filter.default ?? false`
  - `queryParams` composes `criteria=` from active question-id
    selects plus an active toggle's
    `include_monitoring=true` + rolling window
  - `toggleDisabled` is `true` when `filterState.from_date` or
    `filterState.to_date` is set; toggle params are then
    suppressed regardless of the switch position
  - `activeFilter` is the most-recently-changed select filter, or
    the first declared select filter if none changed yet
- [x] **Create** [`DashboardMap/useMapByParent.js`](../../../frontend/src/components/dashboard/DashboardMap/useMapByParent.js)
  - Signature:
    `useMapByParent({ activeFilter, filterState }) → { byParent, loading, error }`
  - Question-id filter →
    `GET /visualization/values?form_id=...&question_id=...&group_by=parent_id&monitoring=latest`
  - Formula filter →
    `GET /visualization/values/formula` with URL-encoded `formula`
    JSON
  - Empty `byParent` when no select filter is active
  - Re-fetches when `activeFilter` or `filterState` changes
  - Per-key debouncing deferred — relies on React's natural
    re-render batching for now; revisit if integration tests show
    double-fetches.
- [ ] Hook-only unit tests deferred to Phase 5; the hooks are
      exercised through `DashboardMap.test.jsx` (lower test cost,
      same coverage).

---

## Phase 5 — Frontend: integration tests for `DashboardMap`

Goal: enough automated coverage that the locked behaviour cannot
silently regress.

- [ ] **Create**
      `frontend/src/components/dashboard/DashboardMap/__test__/DashboardMap.test.jsx`
  - Test 1: `filters[]` absent → header row is not rendered
  - Test 2: `filters[]` with one question-id select → header renders
    a `Select` with options pulled from `window.forms`
  - Test 3: changing the select fires a geolocation refetch with
    `criteria=option_equals:<qid>:<value>`
  - Test 4: `filters[]` with one formula select → header renders a
    `Select` with bucket labels from
    `filter.formula.buckets[]` + `default.label`
  - Test 5: changing a formula select narrows visible markers
    client-side using `byParent`
  - Test 6: `filters[]` with a toggle → ON sends
    `include_monitoring=true` + rolling window
  - Test 7: dashboard-level date filter active → toggle is disabled
    and contributes no params even when ON
  - Test 8: marker click renders `MapPopupCard` with 4 rows
  - Test 9: marker click on a datapoint with no monitoring entry in
    `byParent` → fourth row reads "No monitoring data"
  - Test 10: "View details" link renders the substituted
    `click_url_template`
- [ ] **Verify**: `cd frontend && npm test -- --watchAll=false
      DashboardMap` → all green

---

## Phase 6 — Config migration

Goal: both existing dashboard configs use the new schema and render
correctly in the browser.

- [ ] **Read** the source forms to find the right `question_id`s and
      `form_id`s:
  - [`backend/source/forms/2_1749632545233.monitoring.prod.json`](../../../backend/source/forms/2_1749632545233.monitoring.prod.json)
    (EPS Water Quality Testing — Monitoring)
  - The corresponding monitoring form for `1749621221728`'s
    registration (look in `backend/source/forms/`)
- [ ] **Modify**
      [`frontend/src/config/visualizations/1749621221728.json`](../../../frontend/src/config/visualizations/1749621221728.json)
  - Update the `chart_type: "map"` item:
    - Remove `status_colors`, `status_question_id`,
      `status_monitoring_form_id` (if present)
    - Add `title`, `filters[]` (the relevant `select`s + the
      `monitored_last_year` toggle), and confirm
      `click_action: "popup"`
- [ ] **Modify**
      [`frontend/src/config/visualizations/1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json)
  - Same edits as above
  - Use the formula example from design §1 for the "Drinking water
    compliance" filter (with the actual question IDs from the form
    JSON, not the placeholder IDs in the brainstorm transcript)
- [ ] **Verify (manual)** in the browser:
  - Load both dashboards as a signed-in user
  - Header renders title, dropdowns, legend chips, toggle
  - Switching the select dropdown narrows markers and recolours
  - Toggle ON sends `include_monitoring=true` (verify in DevTools
    Network)
  - Toggle is disabled when the dashboard date filter is set
  - Marker click opens the 4-row popup
  - Datapoint with no monitoring → fourth row reads "No monitoring
    data"

---

## Phase 7 — Verification

- [ ] `cd frontend && yarn lint` — no new warnings
- [ ] `cd frontend && yarn prettier` — formatting clean
- [ ] `./dc.sh exec -T frontend npx eslint src/components/dashboard/DashboardMap`
      — zero errors (enforces `curly`, `no-undefined`,
      `prefer-arrow-callback`)
- [ ] `cd frontend && npm test -- --watchAll=false` — all green
- [ ] `./dc.sh exec backend python manage.py test api.v1.v1_visualization`
      — all green
- [ ] Manual smoke per Phase 6 verification steps

---

## Phase 8 — Commit & PR

- [ ] `git status` — confirm only the expected files changed
- [ ] `git diff` — re-skim each diff
- [ ] Commit message format per project convention:
  ```
  [#209] feat(dashboard): configurable filter dropdown and filter-aware popup for map widget

  - Add filters[] schema on chart_type "map" supporting question-id and formula select modes plus rolling-window toggle
  - Replace static popup with 3 fixed FormData rows + 1 dynamic row tied to the active filter's value
  - Backend: add include_monitoring param and per-point administration_full_name/updated to GeolocationListView
  - Backend: add GET /api/v1/visualization/values/formula evaluator with latest-repeat semantics
  - Drop unused legacy fields status_colors, status_question_id, status_monitoring_form_id
  - Refactor DashboardMap.jsx into a small module with header, popup card, and dedicated hooks
  - Migrate the two existing dashboard configs to the new schema

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
- [ ] **Wait for user confirmation before push** (per project memory —
      git push always requires confirmation)
- [ ] After confirmation: push and open PR titled
      `[#209] feat(dashboard): configurable filter dropdown and filter-aware popup for map widget`

---

## Out of scope for this PR (do not bundle)

These belong in separate follow-up work, not this implementation:

- Cross-widget filter propagation (decision #7 — local-only chosen)
- Multi-language labels for `filter.label` and bucket labels
- Per-repeat answer rendering inside the popup (decision #14)
- Aggregating across repeats (sum, average, all-must-pass)
- Marker clustering for very dense forms
- A configurable basemap selector
- Frontend formula evaluation (decision #13 — Phase 1 is backend)
- Tile provider migration away from OSM (decision #6)

If you find yourself touching any of the above while implementing,
stop and split it into a follow-up issue.

---

## Rollback plan

The change is additive on the backend and a clean refactor on the
frontend. To rollback:

1. Revert the commits.
2. The two migrated dashboard JSONs need to be reverted in the same
   commit set since they reference the new schema fields. If they are
   not reverted, the un-rolled-back frontend will simply ignore the
   new fields and render the bare map (the legacy `status_colors`
   reads are gone, but no production config relied on them).
3. The new backend endpoint and the `include_monitoring` param are
   additive — leaving them in place after a frontend rollback is
   harmless.

No database migrations, no shared-component changes outside the
dashboard subtree.
