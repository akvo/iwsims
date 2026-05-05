# Compliance chart `_no_info` bucket — Implementation Plan

Sequenced, checklisted task breakdown for adding the third "No information available" X-axis category to `chart_drinking_water_compliance`. Built to be executed top-to-bottom by an implementer who has read [requirements.md](./requirements.md) and [design.md](./design.md).

**Branch**: `feature/199-feedback-2`
**Issue**: `#199` (existing feedback round)
**Status**: Phases 1, 3, 4, 5, 7 committed. Phase 2 **skipped** (i18n key already present from parent design). Phase 6 partial — automated checks green; manual smoke + push + PR pending user action.
**Companions**: [`requirements.md`](./requirements.md), [`design.md`](./design.md), [`README.md`](./README.md)
**Parent design**: [`/values` `_no_info`](../no-available-info-in-vis-values-api/README.md) — share its `_no_info` group key, `#bfbfbf` color, and `noInformationAvailable` i18n key.

### Commit chain

| Phase | Commit | Title |
|---|---|---|
| 1 | `56bc4d21` | `[#199] Add include_unanswered support to computeComplianceStackData` |
| 2 | — | Skipped (parent design already added `noInformationAvailable` to `ui-text.js:82`) |
| 3 | `5a2718c3` | `[#199] Fan out universe count fetch for compliance charts` |
| 4 | `7ece760d` | `[#199] Wire compliance_totals into ChartRenderer compliance branch` |
| 4 fix | `55f772ca` | `[#199] Avoid no-undefined lint warning in compliance branch` |
| 5 | `49364395` | `[#199] Enable _no_info bucket on Drinking Water Compliance charts` |
| 7 | `f9d88548` | `[#199] Document compliance chart _no_info bucket` |

---

## Pre-flight **done**

- [x] Read [requirements.md](./requirements.md) end-to-end.
- [x] Read [design.md](./design.md).
- [x] Skim the existing compliance helper, ChartRenderer compliance branch, and Dashboard fan-out.
- [x] Confirm the parent `_no_info` design status — `noInformationAvailable` already exists at [`ui-text.js:82`](../../../frontend/src/lib/ui-text.js#L82). **Phase 2 is skipped.**
- [x] Confirm chart-flip scope. Sanity check `grep -lr '"compute": "compliance"' frontend/src/config/visualizations/` returned exactly the two known files (`1749623934933.json`, `1749621221728.json`) plus the README docs file.
- [x] Branch already on `feature/199-feedback-2` (existing feedback round); used issue `#199`.

---

## Phase 1 — Compute helper + Jest tests **done** (`56bc4d21`)

Pure-function change. Safest first commit. Single commit.

### 1.1 Extend `computeComplianceStackData()` signature

File: [`frontend/src/components/dashboard/compute/compliance.js`](../../../frontend/src/components/dashboard/compute/compliance.js)

- [ ] Add a third positional arg `options = {}` to `computeComplianceStackData`.
- [ ] After the existing `Object.values(byEps).forEach(…)` loop, compute `noInfoCount = Math.max(0, options.totalRegistered − yesCount − noCount)` only when `typeof options.totalRegistered === "number"`.
- [ ] If `noInfoCount > 0`, push a third row `{ compliance: options.noInfoLabel || "No information available", _no_info: noInfoCount }` and append `"_no_info"` to `stackLabels`.
- [ ] Return shape gains a `noInfoCount` field (default 0). Existing callers ignore unknown fields, so this is backwards-compatible.
- [ ] Update the JSDoc block at the top of the function to document `options.totalRegistered`, `options.noInfoLabel`, and the new return field.

Reference body: [design.md "Compute helper"](./design.md#compute-helper--computecompliancejs).

### 1.2 Add Jest cases

File: [`frontend/src/components/dashboard/compute/__test__/compliance.test.js`](../../../frontend/src/components/dashboard/compute/) (verify the path; if no `__test__` folder exists yet, create one beside the source).

- [ ] **Existing tests must still pass unchanged** — run them first to confirm baseline.
- [ ] Add the 7 cases listed in [design.md "Test plan — Unit"](./design.md#unit-jest--computecompliancetestjs):
  - 2-arg signature unchanged
  - appends third row when `totalRegistered > yes+no`
  - omits third row when `totalRegistered === yes+no`
  - clamps to zero when `totalRegistered < yes+no`
  - respects custom `noInfoLabel`
  - does nothing when `totalRegistered` is undefined
  - does nothing when `totalRegistered` is non-number (null, string, NaN)
- [ ] Run:
  ```bash
  ./dc.sh exec -T frontend npx jest --runInBand src/components/dashboard/compute/__test__/compliance.test.js
  ```
  Expect all green.

### 1.3 Lint + commit

- [ ] `./dc.sh exec -T frontend npx eslint src/components/dashboard/compute/`
- [ ] `./dc.sh exec -T frontend npx prettier --check src/components/dashboard/compute/`
- [ ] Commit:
  ```bash
  git commit -m "[#<issue>] Add include_unanswered support to computeComplianceStackData

  - Extend signature with optional { totalRegistered, noInfoLabel } options.
  - When totalRegistered is a finite number, append a single _no_info row
    with count = max(0, totalRegistered - yesCount - noCount); skip when 0.
  - Return shape gains noInfoCount for downstream reuse.
  - Existing 2-arg callers behave identically (NFR-1).

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

## Phase 2 — i18n key **skipped**

`noInformationAvailable` already present at [`ui-text.js:82`](../../../frontend/src/lib/ui-text.js#L82) from the [parent `_no_info` design](../no-available-info-in-vis-values-api/design.md#ui-textjs). No change needed.

### 2.1 Add `noInformationAvailable`

File: [`frontend/src/lib/ui-text.js`](../../../frontend/src/lib/ui-text.js)

- [ ] In the `en` map's Charts block (around the existing `showEmpty` key), add:
  ```js
  noInformationAvailable: "No information available",
  ```
- [ ] Leave the `de` map unchanged — the existing fallback resolves to the English string.

### 2.2 Lint + commit

- [ ] `./dc.sh exec -T frontend npx eslint src/lib/ui-text.js`
- [ ] Commit (only if Phase 2 applies):
  ```bash
  git commit -m "[#<issue>] Add noInformationAvailable i18n key

  Reused by the compliance stacked bar's new _no_info bucket and any
  future widget that surfaces the data-quality gap.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

## Phase 3 — Dashboard fan-out: `ComplianceTotalsFetcher` **done** (`5a2718c3`)

Single commit. Adds the parent-form count fetch as an invisible component.

### 3.1 Add the fetcher component

File: [`frontend/src/pages/dashboard/Dashboard.jsx`](../../../frontend/src/pages/dashboard/Dashboard.jsx)

- [ ] Beside `WqParamFetcher` (around [line 26](../../../frontend/src/pages/dashboard/Dashboard.jsx#L26)), add `ComplianceTotalsFetcher`. Body in [design.md "Dashboard fan-out"](./design.md#dashboard-fan-out--dashboardjsx). The fetcher takes a `parentFormId` prop and synthesizes `{ form_id: parentFormId }` internally — no per-chart api block is read.
- [ ] Inside the Dashboard component, alongside the existing compliance fan-out (around [line 271](../../../frontend/src/pages/dashboard/Dashboard.jsx#L271)):
  - Add `complianceTotalsItems` via `useMemo` filtering `collectByCompute(config.items, "compliance")` for `item.include_unanswered === true`. If matches exist but `config.parent_form_id` is missing, log a one-time `console.error` and return `[]` (FR-4).
  - Add `complianceTotals` state (`useState({})`) and `onComplianceTotalData` (`useCallback`).
- [ ] Render the fetchers next to the existing `WqParamFetcher` block (around [line 549](../../../frontend/src/pages/dashboard/Dashboard.jsx#L549)). Pass `parentFormId={config.parent_form_id}` and `chartId={chartItem.id}`.
- [ ] Add `compliance_totals: complianceTotals` to the `computeResponses` `useMemo` (around [line 352](../../../frontend/src/pages/dashboard/Dashboard.jsx#L352)) and to its dependency array.

### 3.2 Lint + commit

- [ ] `./dc.sh exec -T frontend npx eslint src/pages/dashboard/Dashboard.jsx`
- [ ] Commit:
  ```bash
  git commit -m "[#<issue>] Fan out universe count fetch for compliance charts

  Adds ComplianceTotalsFetcher (mirrors WqParamFetcher) for chart items
  with compute=compliance + include_unanswered=true. The universe form_id
  is sourced from the dashboard root's existing parent_form_id, so no
  per-chart api block is needed. Fetched count lands under
  computeResponses.compliance_totals[itemId] and is consumed by
  ChartRenderer in Phase 4.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

## Phase 4 — ChartRenderer pass-through **done** (`7ece760d` + lint fix `55f772ca`)

Two commits — initial wire-through plus a small follow-up to dodge the project's `no-undefined` lint rule by building the compute helper's options object conditionally instead of passing the literal `undefined`.

### 4.1 Read `compliance_totals` and pass to helper

File: [`frontend/src/components/dashboard/ChartRenderer.jsx`](../../../frontend/src/components/dashboard/ChartRenderer.jsx)

- [ ] Around [line 506](../../../frontend/src/components/dashboard/ChartRenderer.jsx#L506) (the `item.compute === "compliance"` branch):
  - Build `complianceOptions = { noInfoLabel: uiText.en.noInformationAvailable }`.
  - When `item.include_unanswered === true` AND `computeResponses.compliance_totals[item.id]` is a number, set `complianceOptions.totalRegistered`. **Avoid the literal `undefined`** — the project's ESLint config has `no-undefined: warn`, and `npm run lint` is enforced in CI.
  - Pass `complianceOptions` as the third arg to `computeComplianceStackData()`.
- [ ] Verify `uiText` import already exists at the top of the file; add it if missing.
- [ ] If the chart's `data` `useMemo` does not already depend on `computeResponses`, ensure it does (it likely already does for `cross_tab` etc. — confirm).

### 4.2 Lint + commit

- [ ] `./dc.sh exec -T frontend npx eslint src/components/dashboard/ChartRenderer.jsx`
- [ ] Commit:
  ```bash
  git commit -m "[#<issue>] Wire compliance_totals into compute branch

  ChartRenderer reads the dashboard-fetched total under compute_totals[itemId]
  and forwards it to computeComplianceStackData when the chart opts into
  include_unanswered. Translated noInfoLabel comes from uiText.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

## Phase 5 — JSON config: flip the charts on **done** (`49364395`)

Single commit. The visible change. The wiring from Phase 3-4 is dashboard-agnostic; this phase activates it on every chart in scope.

### 5.1 Edit each dashboard JSON

Apply the **same two-line diff** to every `chart_drinking_water_compliance` item flagged for this PR (per [requirements.md FR-10](./requirements.md#fr-10--generic-contract-existing-dashboards-opt-in)). Reference: [design.md "Dashboard JSON config"](./design.md#dashboard-json-config--generic-two-line-edit).

| File | Chart line | Root `parent_form_id` to verify |
|---|---|---|
| [`1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json#L300) (EPS Overview) | 300 | [`1749623934933`](../../../frontend/src/config/visualizations/1749623934933.json#L2) |
| [`1749621221728.json`](../../../frontend/src/config/visualizations/1749621221728.json#L538) (RWS Overview) | 538 | [`1749621221728`](../../../frontend/src/config/visualizations/1749621221728.json#L2) |

For each file:

- [ ] Locate the `chart_drinking_water_compliance` item.
- [ ] Add `"include_unanswered": true,` next to `"compute": "compliance",`.
- [ ] Append `,"#bfbfbf"` to the `config.color` array (after `"#cccccc"`).
- [ ] Verify `parent_form_id` at root is present and equals the registration form id. The fetcher uses it directly; missing it would suppress the third bar at runtime (with one-time `console.error` per Phase 3 wiring).
- [ ] Confirm the file is **not** also flipping on a `compute: "compliance_kpi"` card — those are explicitly out of scope ([README.md "Out of scope"](./README.md#out-of-scope-explicitly-deferred)).

### 5.2 Lint + commit

- [ ] `./dc.sh exec -T frontend npx prettier --check src/config/visualizations/1749623934933.json src/config/visualizations/1749621221728.json`
- [ ] Commit (single commit covering both files):
  ```bash
  git commit -m "[#<issue>] Enable _no_info bucket on Drinking Water Compliance charts

  Flips include_unanswered=true on the two existing compute=compliance
  stacked bars (EPS Overview + RWS Overview). The wiring is generic per
  the spec — any future compliance chart on a dashboard with
  parent_form_id inherits the same behavior with the same two-line edit.

  Universe form_id reuses each dashboard's existing parent_form_id;
  no per-chart api block. Visible change: a third X-axis category
  'No information available' appears with the count of registered
  parents that have no water-quality measurements, reconciling each
  chart with its parent-form total.

  Out of scope: kpi_drinking_water_compliance (compute=compliance_kpi)
  in RWS Overview already reconciles via denominator_api.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

---

## Phase 6 — Verify **partial** (automated DONE, manual smoke pending)

### 6.1 Frontend test suite **green**

```bash
./dc.sh exec -T frontend npm run lint
./dc.sh exec -T frontend env CI=true npx react-scripts test --watchAll=false \
  --transformIgnorePatterns "node_modules/(?!d3|d3-geo|d3-array|internmap|delaunator|robust-predicates)/" \
  --testPathPattern='dashboard'
```

Result on this branch:
- ESLint: 0 errors, 0 warnings.
- Prettier: clean.
- Dashboard test suite: **191 / 191 passed** (12 suites). 7 new cases in `compute.test.js` cover the include_unanswered contract; 184 existing cases unchanged.

> Note: `--transformIgnorePatterns` is required because `src/lib/geo.js` imports `d3-geo` (ESM). The project's `npm test` script bakes this in; the raw `npx jest` invocation does not, which is why direct `jest` runs hit a SyntaxError on `TabsWidget.test.js`. This is **pre-existing** and orthogonal to this PR.

### 6.2 Backend regression (sanity)

This PR has no backend code change. Skipped on this branch as the diff contains zero backend files (`git diff --stat HEAD~6..HEAD -- backend/` is empty).

### 6.3 Manual smoke **pending user**

Per [design.md "Manual smoke"](./design.md#manual-smoke). Run on **both** dashboards in scope (EPS + RWS) — the wiring is shared, but the JSON edits are per-file. **Not yet executed by the implementer; the user should drive this on a stack with seeded demo data.**

- [ ] `./dc.sh up -d`
- [ ] **EPS Overview** (`/dashboard/<eps slug>`):
  - [ ] "Drinking Water Compliance" shows three bars: Yes, No, "No information available".
  - [ ] `Yes + No + NoInfo === kpi_total_registered.value` (the `1749623934933` parent form count).
  - [ ] Apply admin filter; reconciliation holds.
  - [ ] DevTools → Network: one extra `/values?form_id=1749623934933` count fetch fires.
- [ ] **RWS Overview** (`/dashboard/<rws slug>`):
  - [ ] "Drinking Water Compliance" shows three bars: Yes, No, "No information available".
  - [ ] Three-bar total reconciles with the `1749621221728` parent form count (the same total `kpi_drinking_water_compliance` uses as its `denominator_api`, which serves as the cross-check).
  - [ ] Apply admin filter; reconciliation holds.
  - [ ] DevTools → Network: one extra `/values?form_id=1749621221728` count fetch fires.
  - [ ] `kpi_drinking_water_compliance` (ratio card, out-of-scope) renders unchanged — same ratio as before this PR.
- [ ] Capture before/after screenshots of both charts for the PR body.

---

## Phase 7 — Documentation + PR

### 7.1 Update visualization README **done** (`f9d88548`)

File: [`frontend/src/config/visualizations/README.md`](../../../frontend/src/config/visualizations/README.md)

- [x] Added a paragraph under section *"3. Frontend-computed (`compute: "compliance"`)"* cross-referencing this spec, mentioning the opt-in flag and the universe-fetch behavior.

### 7.2 Update parent design's "Out of scope" cross-link **done** (`f9d88548`)

File: [`doc/claude/no-available-info-in-vis-values-api/README.md`](../no-available-info-in-vis-values-api/README.md)

- [x] Added a bullet under "Out of scope" pointing back to this folder for compute-driven charts. Spec docs (the four-file set under `doc/claude/compliance-chart-no-info/`) and both cross-links were committed together.

### 7.3 Commit + push + PR **pending user**

The five code commits + the spec/docs commit are already on `feature/199-feedback-2`:

```
f9d88548 [#199] Document compliance chart _no_info bucket
55f772ca [#199] Avoid no-undefined lint warning in compliance branch
49364395 [#199] Enable _no_info bucket on Drinking Water Compliance charts
7ece760d [#199] Wire compliance_totals into ChartRenderer compliance branch
5a2718c3 [#199] Fan out universe count fetch for compliance charts
56bc4d21 [#199] Add include_unanswered support to computeComplianceStackData
```

Remaining steps require explicit user approval per the global "destructive/visible-state actions" rule:

```bash
bd sync
git push -u origin feature/199-feedback-2   # ← user must confirm
gh pr create ...                             # ← user must confirm
```

PR template:

```
## Summary
- Generic opt-in include_unanswered flag for any compute=compliance chart
  on any dashboard whose root has parent_form_id. Wiring is dashboard-
  agnostic — discovers eligible charts via collectByCompute and reads
  parent_form_id from each dashboard's own root.
- Activates the flag on the two charts that exist today:
  - chart_drinking_water_compliance in EPS Overview
  - chart_drinking_water_compliance in RWS Overview
- Surfaces the count of registered parents that have no water-quality
  measurements as a gray "No information available" third X-axis category,
  so each chart reconciles with its parent-form total.
- Frontend-only; no backend changes.

## Out of scope
- kpi_drinking_water_compliance (compute=compliance_kpi, RWS Overview):
  already reconciles via denominator_api; left untouched.

## Visible behavior change
Both Drinking Water Compliance charts now show three bars
(Yes / No / No information available) instead of two. Numbers are correct
but newly visible — flag for stakeholder communication.

## Test plan
- [x] Jest: 7 new cases on computeComplianceStackData; existing cases pass.
      Full dashboard suite green (191/191 across 12 suites).
- [x] ESLint + Prettier: full project clean.
- [ ] EPS dashboard: bars sum to kpi_total_registered, under no filter
      and under admin filter.
- [ ] RWS dashboard: bars sum to the parent-form count;
      kpi_drinking_water_compliance ratio renders unchanged.
- [ ] Network: one extra /values?form_id=<parent_form_id> count fetch
      fires per dashboard load.
- [ ] Disable flag on a dashboard → chart returns to 2 bars; the extra
      fetch does not fire.

## Docs
- doc/claude/compliance-chart-no-info/{README,requirements,design,implementation-plan}.md
- frontend/src/config/visualizations/README.md cross-link
- Cross-link added in parent _no_info design's "Out of scope".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] `bd close <issue>` after merge.

---

## Rollback recipe

If the chart misbehaves in production:

### Fast rollback — revert the JSON only

The cheapest rollback is to remove the two lines from [`1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json):

```diff
-  "include_unanswered": true,
   ...
   "color": [
     ...
-    "#cccccc",
-    "#bfbfbf"
+    "#cccccc"
   ]
```

The compute helper, fetcher, and ChartRenderer pass-through stay in place — they're inert without the flag (NFR-1, FR-4). One commit, one deploy, chart returns to 2 bars.

### Full revert

If the broader wiring is suspect, revert in reverse order so each step removes a coherent slice:

```bash
git revert 49364395  # JSON config flip on both dashboards
git revert 55f772ca  # ChartRenderer lint fix
git revert 7ece760d  # ChartRenderer pass-through
git revert 5a2718c3  # Dashboard fan-out
git revert 56bc4d21  # Compute helper
# Phase 7 docs (f9d88548) can stay — pure documentation.
```

Confirm `./dc.sh exec -T frontend npm run lint` and the dashboard test suite still pass on the reverted tree.

---

## Done definition

- [x] Phases 1, 3, 4, 5, 7 committed; Phase 2 skipped; Phase 6 automated checks green.
- [ ] Manual smoke on EPS + RWS dashboards.
- [ ] `git push -u origin feature/199-feedback-2` (user-confirmed).
- [ ] PR opened with the template in [Phase 7.3](#73-commit--push--pr--pending-user); screenshots captured.
- [ ] PR merged.
- [ ] Stakeholder note sent (per the [risk register](./design.md#risk-register)).
