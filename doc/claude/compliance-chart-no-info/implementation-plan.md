# Compliance chart `_no_info` bucket — Implementation Plan

Sequenced, checklisted task breakdown for adding the third "No information available" X-axis category to `chart_drinking_water_compliance`. Built to be executed top-to-bottom by an implementer who has read [requirements.md](./requirements.md) and [design.md](./design.md).

**Branch**: TBD (suggest `feature/<issue>-compliance-no-info`)
**Issue**: TBD — file via `bd create --title="Add 'No information available' bucket to compliance stacked bar" --type=feature --priority=2`
**Companions**: [`requirements.md`](./requirements.md), [`design.md`](./design.md), [`README.md`](./README.md)
**Parent design**: [`/values` `_no_info`](../no-available-info-in-vis-values-api/README.md) — share its `_no_info` group key, `#bfbfbf` color, and `noInformationAvailable` i18n key.

---

## Pre-flight

Before touching code:

- [ ] Read [requirements.md](./requirements.md) end-to-end. The 10 FRs + 7 NFRs are the contract.
- [ ] Read [design.md](./design.md) — especially the [Edge cases table](./design.md#edge-cases) and the [race-defensive note](./requirements.md#nfr-3--race-defensive).
- [ ] Skim the existing compliance helper at [`compute/compliance.js`](../../../frontend/src/components/dashboard/compute/compliance.js), the ChartRenderer compliance branch at [`ChartRenderer.jsx:506`](../../../frontend/src/components/dashboard/ChartRenderer.jsx#L506), and the Dashboard fan-out at [`Dashboard.jsx:271`](../../../frontend/src/pages/dashboard/Dashboard.jsx#L271).
- [ ] Confirm the parent `_no_info` design status:
  - If [parent design](../no-available-info-in-vis-values-api/) has shipped → reuse its `noInformationAvailable` key in `ui-text.js`; skip Phase 2.
  - If not → this PR adds the i18n key as part of Phase 2.
- [ ] Confirm the chart-flip scope. The wiring is generic; it applies to every `compute: "compliance"` chart on every dashboard whose root has `parent_form_id`. This PR locks in **two** charts (EPS + RWS Overview) per [requirements.md FR-10](./requirements.md#fr-10--generic-contract-existing-dashboards-opt-in). If you discover a third matching chart in `frontend/src/config/visualizations/`, either add it to FR-10 before starting **or** explicitly defer it in the PR body — don't silently flip it on. Run a sanity check: `grep -lr '"compute": "compliance"' frontend/src/config/visualizations/` should return at most the two known files.
- [ ] Create the beads issue and `bd update <id> --status=in_progress`.
- [ ] Create the feature branch: `git checkout -b feature/<issue>-compliance-no-info`.

---

## Phase 1 — Compute helper + Jest tests

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

## Phase 2 — i18n key (skip if parent design already landed)

Single commit. Skip entirely if [`uiText.en.noInformationAvailable`](../../../frontend/src/lib/ui-text.js) already exists from the [parent `_no_info` design](../no-available-info-in-vis-values-api/design.md#ui-textjs).

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

## Phase 3 — Dashboard fan-out: `ComplianceTotalsFetcher`

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

## Phase 4 — ChartRenderer pass-through

Single commit. Wires the new compute-helper option into the existing compliance branch.

### 4.1 Read `compliance_totals` and pass to helper

File: [`frontend/src/components/dashboard/ChartRenderer.jsx`](../../../frontend/src/components/dashboard/ChartRenderer.jsx)

- [ ] Around [line 506](../../../frontend/src/components/dashboard/ChartRenderer.jsx#L506) (the `item.compute === "compliance"` branch):
  - Read `totalRegistered = item.include_unanswered === true ? computeResponses?.compliance_totals?.[item.id] : undefined`.
  - Pass `{ totalRegistered, noInfoLabel: uiText.en.noInformationAvailable }` as the third arg to `computeComplianceStackData()`.
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

## Phase 5 — JSON config: flip the charts on

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

## Phase 6 — Verify

### 6.1 Frontend test suite

```bash
cd frontend
npm run lint
npm run prettier
./dc.sh exec -T frontend npx jest --runInBand src/components/dashboard
```

All green expected. If any test fails, halt and root-cause — don't disable.

### 6.2 Backend regression (sanity)

This PR has no backend code change, but confirm no test depends on the chart producing 2 rows specifically:

```bash
./dc.sh exec backend python manage.py test api.v1.v1_visualization
```

### 6.3 Manual smoke

Per [design.md "Manual smoke"](./design.md#manual-smoke). Run on **both** dashboards in scope (EPS + RWS) — the wiring is shared, but the JSON edits are per-file.

- [ ] `./dc.sh up -d`
- [ ] **EPS Overview**:
  - [ ] "Drinking Water Compliance" shows three bars: Yes, No, "No information available".
  - [ ] `Yes + No + NoInfo === kpi_total_registered.value` (the `1749623934933` parent form count).
  - [ ] Apply admin filter; reconciliation holds.
  - [ ] DevTools → Network: one extra `/values?form_id=1749623934933` count fetch fires.
- [ ] **RWS Overview**:
  - [ ] "Drinking Water Compliance" shows three bars: Yes, No, "No information available".
  - [ ] Three-bar total reconciles with the `1749621221728` parent form count (the same total `kpi_drinking_water_compliance` uses as its `denominator_api`, which serves as the cross-check).
  - [ ] Apply admin filter; reconciliation holds.
  - [ ] DevTools → Network: one extra `/values?form_id=1749621221728` count fetch fires.
  - [ ] `kpi_drinking_water_compliance` (ratio card, out-of-scope) renders unchanged — same ratio as before this PR.
- [ ] Capture before/after screenshots of both charts for the PR body.

---

## Phase 7 — Documentation + PR

### 7.1 Update visualization README

File: [`frontend/src/config/visualizations/README.md`](../../../frontend/src/config/visualizations/README.md)

- [ ] Find the section that documents `compute: "compliance"` and add a paragraph cross-referencing this design:
  > Chart items with `compute: "compliance"` may opt into a third "No information available" X-axis category by setting `include_unanswered: true`. The chart reuses the dashboard root's `parent_form_id` for the universe count — no per-chart api block is required. See [`doc/claude/compliance-chart-no-info/`](../../../../doc/claude/compliance-chart-no-info/README.md) for the design.

### 7.2 Update parent design's "Out of scope" cross-link

File: [`doc/claude/no-available-info-in-vis-values-api/README.md`](../no-available-info-in-vis-values-api/README.md)

- [ ] If the "Out of scope" line about compute-driven charts still exists, add a cross-link:
  > Compute-driven charts (e.g. compliance) — covered separately in [`doc/claude/compliance-chart-no-info/`](../compliance-chart-no-info/README.md).

### 7.3 Commit + push + PR

```bash
git commit -m "[#<issue>] Cross-link compliance chart _no_info design

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

bd sync
git push -u origin feature/<issue>-compliance-no-info  # confirm with user before pushing
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
- [ ] Jest: 7 new cases on computeComplianceStackData; existing cases pass.
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

If the broader wiring is suspect:

```bash
git revert <commit-5>  # JSON
git revert <commit-4>  # ChartRenderer
git revert <commit-3>  # Dashboard fan-out
git revert <commit-2>  # i18n (skip if shared with parent design)
git revert <commit-1>  # compute helper
```

Confirm `npm test` and `./dc.sh exec backend python manage.py test` still pass on the reverted tree.

---

## Done definition

- [ ] All 7 phases checked off.
- [ ] PR merged to develop / main.
- [ ] `bd close <issue>`.
- [ ] Stakeholder note sent (per the [risk register](./design.md#risk-register)).
- [ ] Screenshot in the PR body shows three bars summing to the KPI.
