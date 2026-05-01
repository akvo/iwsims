# "No information available" bucket — Implementation Plan

Sequenced, checklisted task breakdown for landing the opt-in `_no_info` bucket on `/api/v1/visualization/values`. Built to be executed top-to-bottom by an implementer who has read [requirements.md](./requirements.md) and [design.md](./design.md).

**Branch**: TBD (suggest `feature/<issue>-no-info-bucket`)
**Issue**: TBD — file via `bd create --title="Add include_unanswered flag to /visualization/values" --type=feature --priority=2`
**Companions**: [`requirements.md`](./requirements.md), [`design.md`](./design.md), [`README.md`](./README.md)

---

## Pre-flight

Before touching code:

- [ ] Read [requirements.md](./requirements.md) end-to-end. The 12 FRs are the contract.
- [ ] Read [design.md](./design.md) — especially the [Edge cases table](./design.md#edge-cases) and the [multi-choice percentage note](./design.md#modify-_option_group_by_option) (single-choice sums to 100%, multi-choice may exceed).
- [ ] Skim the existing donut handler at [`values_functions.py:474`](../../../backend/api/v1/v1_visualization/values_functions.py#L474) and the option-question dispatch at [`values_functions.py:292`](../../../backend/api/v1/v1_visualization/values_functions.py#L292).
- [ ] Confirm the two target dashboard configs ([`1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json), [`1749621221728.json`](../../../frontend/src/config/visualizations/1749621221728.json)) are the only consumers that will be flipped on in this PR. If a third dashboard wants in, list it under FR-12 in [requirements.md](./requirements.md#fr-12--existing-dashboards-opt-in) before starting.
- [ ] Create the beads issue and `bd update <id> --status=in_progress`.
- [ ] Create the feature branch: `git checkout -b feature/<issue>-no-info-bucket`.

---

## Phase 1 — Backend: serializer + helper + handler change

Single commit. All changes live in [`backend/api/v1/v1_visualization/`](../../../backend/api/v1/v1_visualization/).

### 1.1 Add the serializer field

File: [`backend/api/v1/v1_visualization/dashboard_serializers.py`](../../../backend/api/v1/v1_visualization/dashboard_serializers.py)

- [ ] Inside `ValuesFilterSerializer` (the class body around [line 18](../../../backend/api/v1/v1_visualization/dashboard_serializers.py#L18)), add the new field next to the other booleans/choices:

  ```python
  include_unanswered = serializers.BooleanField(
      required=False,
      default=False,
  )
  ```

- [ ] No extra `validate_*` method needed — DRF's `BooleanField` parses `"true"`, `"1"`, `"yes"`, etc. natively.
- [ ] Run a one-off sanity check that the field reaches `validated_data`:
  ```bash
  ./dc.sh exec backend python manage.py shell -c "from api.v1.v1_visualization.dashboard_serializers import ValuesFilterSerializer; s = ValuesFilterSerializer(data={'form_id': 1, 'include_unanswered': 'true'}); s.is_valid(); print(s.validated_data)"
  ```
  Expect to see `'include_unanswered': True` in the output (after a real `form_id`).

### 1.2 Add the `_count_no_info_parents` helper

File: [`backend/api/v1/v1_visualization/values_functions.py`](../../../backend/api/v1/v1_visualization/values_functions.py)

- [ ] At the top, ensure `apply_administration_filter` and `apply_parent_criteria_to_qs` are importable from `.functions`. They already exist (see [`functions.py:25`](../../../backend/api/v1/v1_visualization/functions.py#L25), [`functions.py:252`](../../../backend/api/v1/v1_visualization/functions.py#L252)) — add to the existing import block:

  ```python
  from api.v1.v1_visualization.functions import (
      get_base_monitoring_qs,
      get_monitoring_data_ids,
      apply_administration_filter,
      apply_parent_criteria_to_qs,
      ...
  )
  ```

- [ ] Add the helper near the top of the file (above `handle_count_mode`), see the full body in [design.md "New helper"](./design.md#new-helper-_count_no_info_parents). Returns 0 for registration forms, otherwise `max(0, total_in_scope − len(qualifying_parent_ids))`.

### 1.3 Modify `_option_group_by_option`

File: [`values_functions.py:474`](../../../backend/api/v1/v1_visualization/values_functions.py#L474)

- [ ] Extend the signature to accept four new kwargs (all defaulted so existing internal calls keep working):
  ```python
  def _option_group_by_option(
      question, options, data_ids, qs,
      is_latest, value_type, restricted_values=None,
      include_unanswered=False, form=None, params=None,
  ):
  ```

- [ ] Replace the `rows = …values_list("options", flat=True)` loop with a tuple-yielding loop over `("data__parent_id", "options")` so we can collect `qualifying_parents: set[int]` in the same pass. Full body in [design.md "Modify _option_group_by_option"](./design.md#modify-_option_group_by_option).

- [ ] Compute `bucket_count` only when `include_unanswered=True`. When the flag is off, the function must return byte-identical output to today (NFR-1).

- [ ] When `value_type == "percentage"` AND `include_unanswered`, set the denominator to `len(qualifying_parents) + bucket_count` so single-choice totals sum to 100% exactly. Multi-choice may exceed 100% — that's documented.

- [ ] Append the `_no_info` row only when `bucket_count > 0` (don't pollute the response with a zero-count row).

### 1.4 Wire the flag through `handle_option_question`

File: [`values_functions.py:292`](../../../backend/api/v1/v1_visualization/values_functions.py#L292)

- [ ] In the `if group_by == "option":` branch (around [line 327](../../../backend/api/v1/v1_visualization/values_functions.py#L327)), pass the four new kwargs:
  ```python
  return _option_group_by_option(
      question, options, data_ids, qs,
      is_latest, value_type, restricted,
      include_unanswered=params.get("include_unanswered", False),
      form=form,
      params=params,
  )
  ```

- [ ] Do **not** wire it into the other branches in `handle_option_question` (`option_value`, `stack_by`, `option_value + group_by=month`). FR-7 says they ignore the flag.

### 1.5 Backend tests

File: [`backend/api/v1/v1_visualization/tests/tests_values_option.py`](../../../backend/api/v1/v1_visualization/tests/tests_values_option.py)

Add ten tests inside the existing `ValuesOptionTestCases` class. Use the existing `VisualizationValuesTestMixin` (check [`tests/mixins.py`](../../../backend/api/v1/v1_visualization/tests/mixins.py) for the registration + monitoring fixture helpers).

- [ ] `test_include_unanswered_appends_no_info_row` — 5 parents registered, 3 monitored with answers `(a, a, b)`. Assert response = `[{a:2}, {b:1}, {_no_info:2}]`.
- [ ] `test_include_unanswered_default_false_unchanged` — same dataset, no flag. Assert response identical to the existing `test_option_group_by_option_latest` baseline.
- [ ] `test_include_unanswered_multiple_option_distinct_parents` — parent A `["x","y"]`, B `["x"]`, C no submission. Assert `_no_info=1`, `x=2`, `y=1`.
- [ ] `test_include_unanswered_percentage_sums_100_single_choice` — 4 parents, answers `(a, a, b)`, 1 unanswered. Assert percentages `a=50, b=25, _no_info=25`, sum exactly 100.
- [ ] `test_include_unanswered_percentage_multi_choice_may_exceed_100` — multi-choice setup; assert percentages reflect distinct-parent denominator and document that sum may exceed 100. (Sanity-check, not a contract.)
- [ ] `test_include_unanswered_respects_administration_filter` — 10 parents in 2 admins; filter to admin A (5 parents, 3 monitored). Assert bucket = 2.
- [ ] `test_include_unanswered_zero_bucket_emits_no_row` — every parent monitored. Assert no `_no_info` row appended.
- [ ] `test_include_unanswered_excludes_soft_deleted_parents` — soft-delete one parent; assert bucket count drops by 1.
- [ ] `test_include_unanswered_ignored_on_registration_form` — request a registration-form `option` question with the flag. Assert response unchanged (FR-7).
- [ ] `test_include_unanswered_ignored_on_count_mode` — no `question_id`, flag set. Assert response unchanged (FR-7).

- [ ] Run the test file: `./dc.sh exec backend python manage.py test api.v1.v1_visualization.tests.tests_values_option`. Green.
- [ ] Run the full visualization suite: `./dc.sh exec backend python manage.py test api.v1.v1_visualization`. Green.

### 1.6 Lint + commit

- [ ] `./dc.sh exec backend flake8 api/v1/v1_visualization/dashboard_serializers.py api/v1/v1_visualization/values_functions.py api/v1/v1_visualization/tests/tests_values_option.py`. Clean.
- [ ] `git add backend/api/v1/v1_visualization/dashboard_serializers.py backend/api/v1/v1_visualization/values_functions.py backend/api/v1/v1_visualization/tests/tests_values_option.py`.
- [ ] Commit:
  ```
  [#<issue>] feat(visualization): opt-in _no_info bucket on /values

  - Add `include_unanswered` boolean to ValuesFilterSerializer.
  - Add _count_no_info_parents helper for distinct-parent gap math.
  - Append synthetic _no_info row to group_by=option responses when
    the flag is on; respects administration + parent_criteria filters.
  - Adjust value_type=percentage denominator to include the bucket
    so single-choice rows sum to 100%.
  - 10 new tests covering single/multi choice, filters, soft-deletes,
    out-of-scope shapes (registration form, count mode).
  ```

---

## Phase 2 — Frontend: i18n + ChartRenderer label swap

### 2.1 Add the translation key

File: [`frontend/src/lib/ui-text.js`](../../../frontend/src/lib/ui-text.js)

- [ ] At [line 80-81](../../../frontend/src/lib/ui-text.js#L80-L81) (the `// Charts` block), add one key:

  ```diff
     // Charts
     showEmpty: "Show empty values",
  +  noInformationAvailable: "No information available",
  ```

- [ ] No change to the `de` map at [line 1024](../../../frontend/src/lib/ui-text.js#L1024) — it stays empty and falls through to English.

### 2.2 Swap the label in ChartRenderer

File: [`frontend/src/components/dashboard/ChartRenderer.jsx`](../../../frontend/src/components/dashboard/ChartRenderer.jsx)

- [ ] Add the import at the top of the file:
  ```jsx
  import uiText from "../../lib/ui-text";
  ```

- [ ] Find the row-mapping block that converts API rows into akvo-charts data. Wrap the `label` resolution to swap for `_no_info`:
  ```jsx
  const resolvedLabel = row.group === "_no_info"
    ? uiText.en.noInformationAvailable
    : row.label;
  ```
  Use `resolvedLabel` everywhere the old `row.label` was used in the `data` shape passed to `<Doughnut>`/`<Bar>`/etc.

- [ ] Verify the synthetic row's `color` from the backend (`"#bfbfbf"`) flows through. If the chart's JSON config defines a `color` array, it overrides per-slice — that's existing precedence, leave alone.

### 2.3 Lint + commit

- [ ] Run lint inside the container (per the [feedback memory](../../../.claude/projects/-home-iwan-Akvo-akvo-mis/memory/feedback_lint_before_commit.md) and [CLAUDE.md ESLint rules](../../../CLAUDE.md)):
  ```bash
  ./dc.sh exec -T frontend npx eslint src/components/dashboard/ChartRenderer.jsx src/lib/ui-text.js
  ```
- [ ] Run prettier:
  ```bash
  cd frontend && yarn prettier --check src/components/dashboard/ChartRenderer.jsx src/lib/ui-text.js
  ```
- [ ] Commit:
  ```
  [#<issue>] feat(dashboard): translate _no_info label via ui-text

  - Add noInformationAvailable key to ui-text.js Charts block.
  - ChartRenderer swaps backend label for the i18n string when
    row.group === "_no_info".
  ```

---

## Phase 3 — Frontend: DashboardMap opt-in

### 3.1 Wire `status_colors._no_info`

File: [`frontend/src/components/dashboard/DashboardMap.jsx`](../../../frontend/src/components/dashboard/DashboardMap.jsx)

- [ ] Add the `uiText` import.
- [ ] In the marker-color resolution (look for `status_colors[answer]` or equivalent), add a fallback to `status_colors._no_info` when the answer is missing/null:
  ```jsx
  const colorFor = (answer) => {
    if (answer && status_colors?.[answer]) {
      return status_colors[answer];
    }
    if (status_colors?._no_info) {
      return status_colors._no_info;
    }
    return undefined;
  };
  ```
  Keep the existing brace style (CLAUDE.md: `curly: error`).

- [ ] In the legend rendering, iterate every key of `status_colors` and translate `_no_info` to the i18n string:
  ```jsx
  const legendLabel = (key) =>
    key === "_no_info" ? uiText.en.noInformationAvailable : labelFor(key);
  ```

### 3.2 Lint + commit

- [ ] `./dc.sh exec -T frontend npx eslint src/components/dashboard/DashboardMap.jsx`
- [ ] `cd frontend && yarn prettier --check src/components/dashboard/DashboardMap.jsx`
- [ ] Commit:
  ```
  [#<issue>] feat(map): support _no_info color and legend entry

  - DashboardMap honors status_colors._no_info as fallback color
    for un-monitored markers.
  - Legend renders _no_info entry with translated label.
  - Behavior unchanged when status_colors._no_info is absent.
  ```

---

## Phase 4 — Flip the existing dashboards on

### 4.1 EPS Overview donut

File: [`frontend/src/config/visualizations/1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json)

- [ ] Locate the operational-status donut item at [line 216](../../../frontend/src/config/visualizations/1749623934933.json#L216) (`"id": "chart_operational_status"`).
- [ ] Add `"include_unanswered": true` to its `api` block:
  ```diff
   "api": {
     "form_id": 1749632545233,
     "question_id": 1749633373968,
     "group_by": "option",
  -  "monitoring": "latest"
  +  "monitoring": "latest",
  +  "include_unanswered": true
   }
  ```

- [ ] (Optional) Extend `status_colors` on the map item at [line 193](../../../frontend/src/config/visualizations/1749623934933.json#L193) with `"_no_info": "#bfbfbf"` if the dashboard owner wants the gray map markers + legend.

### 4.2 RWS Overview donut

File: [`frontend/src/config/visualizations/1749621221728.json`](../../../frontend/src/config/visualizations/1749621221728.json)

- [ ] Find the equivalent operational-status donut (search for `"chart_type": "doughnut"` near the operational-status section).
- [ ] Add `"include_unanswered": true` to its `api` block.
- [ ] (Optional) Add `"_no_info"` to the map's `status_colors`.

### 4.3 Manual smoke

- [ ] `./dc.sh up -d`
- [ ] Open `http://localhost:3000/dashboard/eps-overview`. Verify:
  - Donut "Operational Status" shows a gray slice at the end.
  - Legend entry reads "No information available".
  - Sum of donut slice values equals the "Total EPS registered" KPI above.
  - Hover tooltip shows `"No information available: <count> (<percent>%)"`.
- [ ] Apply an administration filter (drill into a sub-region):
  - KPI total drops.
  - Donut total drops in lockstep — slice count should remain consistent with the new KPI value.
- [ ] Open `http://localhost:3000/dashboard/rws-overview`. Repeat the checks above.
- [ ] Open browser DevTools → Network. Confirm the donut's `/visualization/values` request URL contains `include_unanswered=true`.
- [ ] Confirm a chart on the same dashboard that does NOT have the flag (e.g. drinking-water compliance) renders byte-identically to before — no surprise regressions.
- [ ] If `_no_info` color was added to the map: confirm un-monitored EPS render gray and the legend gains the new entry.

### 4.4 Commit

- [ ] Commit:
  ```
  [#<issue>] chore(dashboards): opt EPS + RWS donuts into _no_info bucket

  Operational Status donut on both dashboards now reconciles with the
  registration-total KPI. Map widgets gain the optional gray-marker
  treatment when status_colors._no_info is set.
  ```

---

## Phase 5 — Documentation

### 5.1 Update visualization README

File: [`frontend/src/config/visualizations/README.md`](../../../frontend/src/config/visualizations/README.md)

- [ ] In the "Empty-data behaviour" section starting at [line 613](../../../frontend/src/config/visualizations/README.md#L613), add a paragraph after the existing `<EscalationTable>` line:

  > **Un-monitored datapoints** — when an `api` block on a `group_by=option` chart sets `"include_unanswered": true`, the backend appends one synthetic row to the response: `{ value, label: "No information available", group: "_no_info", color: "#bfbfbf" }`. The bucket counts **distinct parent registrations** that have no qualifying answer for the question after all filters are applied; for `multiple_option` questions this is correctly computed as a distinct-parent count, not `total − sum`. The bucket joins the denominator when `value_type=percentage`, so single-choice rows sum to 100%. Map widgets opt in independently by adding `"_no_info": "<color>"` to their `status_colors` block.

- [ ] Verify the README links resolve (relative paths still valid).

### 5.2 Commit

- [ ] Commit:
  ```
  [#<issue>] docs(dashboards): document include_unanswered flag
  ```

---

## Phase 6 — Verify and PR

### 6.1 Final verification

- [ ] Backend full suite:
  ```bash
  ./dc.sh exec backend python manage.py test
  ```
- [ ] Backend lint:
  ```bash
  ./dc.sh exec backend flake8
  ```
- [ ] Frontend lint + prettier:
  ```bash
  cd frontend && npm run lint && npm run prettier
  ```
- [ ] Frontend tests:
  ```bash
  cd frontend && npm run test:ci
  ```
- [ ] `git status` — confirm only the expected files are modified.
- [ ] `git log --oneline` — five commits present, all prefixed with `[#<issue>]`.

### 6.2 Beads + PR

- [ ] `bd close <issue>` (or do this after PR merge — team convention).
- [ ] `bd sync --from-main`.
- [ ] Push and open the PR. Body checklist:
  - **Summary**: Adds opt-in `include_unanswered=true` flag to `/visualization/values` so dashboards can reconcile per-option totals with their parent-registration totals.
  - **Behavior change note** (visible to stakeholders): the operational-status donut on `/dashboard/eps-overview` and `/dashboard/rws-overview` will now show a "No information available" slice. The number of *operational* and *issue_with_system* slices does not change; what changes is that the visible total now equals the registered EPS total. This is the correct number — no underlying data has changed.
  - **Migration**: none.
  - **Test plan**: backend tests + manual smoke per Phase 4.3.
  - **Out of scope**: see [README.md "Out of scope"](./README.md#out-of-scope-explicitly-deferred).

---

## Files touched (summary)

Backend:
- [`backend/api/v1/v1_visualization/dashboard_serializers.py`](../../../backend/api/v1/v1_visualization/dashboard_serializers.py) — new field
- [`backend/api/v1/v1_visualization/values_functions.py`](../../../backend/api/v1/v1_visualization/values_functions.py) — new helper, modified `_option_group_by_option`, wired in `handle_option_question`
- [`backend/api/v1/v1_visualization/tests/tests_values_option.py`](../../../backend/api/v1/v1_visualization/tests/tests_values_option.py) — 10 new tests

Frontend:
- [`frontend/src/lib/ui-text.js`](../../../frontend/src/lib/ui-text.js) — new key
- [`frontend/src/components/dashboard/ChartRenderer.jsx`](../../../frontend/src/components/dashboard/ChartRenderer.jsx) — label swap
- [`frontend/src/components/dashboard/DashboardMap.jsx`](../../../frontend/src/components/dashboard/DashboardMap.jsx) — color + legend opt-in

Configs:
- [`frontend/src/config/visualizations/1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json) — donut + (optional) map opts in
- [`frontend/src/config/visualizations/1749621221728.json`](../../../frontend/src/config/visualizations/1749621221728.json) — donut + (optional) map opts in
- [`frontend/src/config/visualizations/README.md`](../../../frontend/src/config/visualizations/README.md) — new paragraph

Total: **9 files**, ~6 commits, no migrations, no new dependencies.

---

## Rollback

If a regression is reported post-merge:

1. Quick mitigation: revert the two dashboard JSON changes (Phase 4) only. The donuts go back to the legacy "answered universe" view; backend and shared frontend code stay deployed but inert until any chart re-opts in.
2. Full rollback: `git revert` the merge commit. No DB migration to reverse.

The opt-in design means a regression cannot reach a dashboard that didn't explicitly enable the flag.
