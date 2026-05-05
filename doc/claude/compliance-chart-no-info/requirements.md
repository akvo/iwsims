# Compliance chart `_no_info` bucket — Requirements

Locked functional and non-functional requirements for the third "No information available" X-axis category on `chart_drinking_water_compliance`.

For architecture, fetcher fan-out, and the implementation plan, see [design.md](./design.md). For the rationale behind each decision, see the "Decisions locked from brainstorm" table in [README.md](./README.md). For the broader API-driven `_no_info` work this builds on, see the [parent design](../no-available-info-in-vis-values-api/README.md).

---

## Problem statement

The dashboard at [`frontend/src/config/visualizations/1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json) (EPS Overview) shows two reconciliation-violating numbers in the same view:

- KPI tile [`kpi_total_registered`](../../../frontend/src/config/visualizations/1749623934933.json#L137) reads **105 EPS registered** — the universe.
- Stacked bar [`chart_drinking_water_compliance`](../../../frontend/src/config/visualizations/1749623934933.json#L300) reads **Yes (7) + No (17) = 24 EPS** — the monitored subset.

The 81-EPS gap is silent: nothing in the chart hints that 77% of registered EPS have no water-quality measurements. This violates the same data-quality reconciliation principle that motivates the [parent `/values` `_no_info` design](../no-available-info-in-vis-values-api/requirements.md#problem-statement), but the parent design's mechanism (synthetic row in the `/values` response) does not apply to compute-driven charts.

**Goal**: surface the gap as a third X-axis category labelled "No information available" so the bars sum to the registered total.

---

## Functional requirements

### FR-1 — Third X-axis category

When the chart's `include_unanswered` flag is set, the stacked bar renders **three** X-axis categories:

1. `"Yes"` (existing) — count of EPS whose every active parameter passed its threshold.
2. `"No"` (existing) — count of EPS where at least one parameter failed; segments stacked by failing parameter.
3. `"No information available"` (new) — count of EPS that contributed to neither Yes nor No, rendered as a single `_no_info` stack.

The new category is positioned **after** Yes and No (rightmost). The translation comes from [`uiText.en.noInformationAvailable`](../../../frontend/src/lib/ui-text.js) (added by the parent design).

### FR-2 — Definition of "no information available"

An EPS contributes to the bucket when, **after applying every dashboard filter** (administration, date, custom filters), it appears in the registered universe but does **not** appear as a row in any of the per-parameter `/values` responses keyed to a `params_ref[]` item.

Concretely, given:
- `totalRegistered` — count of distinct registered EPS in the filtered universe, fetched from `/values` with `form_id = config.parent_form_id` (the dashboard root field) and the same filter pipeline as the parameter fetches.
- `yesCount` + `noCount` — outputs of the existing `computeComplianceStackData()`.

```
noInfoCount = max(0, totalRegistered − yesCount − noCount)
```

The clamp to zero is a race-defensive guard for the transient state where one fetch resolves before the other (see [NFR-3](#nfr-3--race-defensive)).

### FR-3 — Filter parity

The totals fetch consumes the same `filterState`, `fiscalYearStartMonth`, and `customFilterDefs` that the per-parameter (`params_ref`) fetches consume. This is what makes the bars reconcile under filtering — narrowing to a single administration narrows both the universe and the monitored counts identically.

### FR-4 — Opt-in only

Default behavior is unchanged. The bucket only appears when the chart item has `include_unanswered: true` AND the dashboard root has a `parent_form_id`. Without the flag, the chart renders today's two-category output byte-for-byte. If the flag is set on a dashboard whose root is missing `parent_form_id`, the implementation logs a one-time warning and falls back to two-category output.

### FR-5 — Empty bucket suppression

When `noInfoCount === 0`, the third X-axis category is **omitted entirely** — the chart degrades gracefully to two bars when the data quality is perfect. No empty bar, no visual noise.

### FR-6 — Reuse parent design's vocabulary

The implementation reuses three artefacts from the [parent `_no_info` design](../no-available-info-in-vis-values-api/README.md):

| Artefact | Source | Reuse |
|---|---|---|
| Group key `"_no_info"` | [Parent README — Decisions](../no-available-info-in-vis-values-api/README.md#decisions-locked-from-brainstorm) | Same string; cannot collide with a real `QuestionOptions.value` (slug-cased) |
| Default color `#bfbfbf` | Parent design | Same hex |
| i18n key `noInformationAvailable` | [Parent FR-9](../no-available-info-in-vis-values-api/requirements.md#fr-9--frontend-label-is-i18n-ready) | Same key in `ui-text.js`; no new translation surface |

If the parent design has not yet landed when this work starts, this spec adds the `noInformationAvailable` key as a side-effect of FR-1.

### FR-7 — Universe source

The fetcher derives `form_id` from the dashboard root's existing [`parent_form_id`](../../../frontend/src/config/visualizations/1749623934933.json#L2) field. No per-chart `total_api` block is added in v1 — three places carrying the same fact (root, KPI, chart) creates drift risk for zero benefit. An optional per-chart `total_api` override can be added later if a chart ever needs a different universe form than the dashboard's parent.

The synthesized fetch shape matches [`kpi_total_registered.api`](../../../frontend/src/config/visualizations/1749623934933.json#L143):

```jsonc
{ "form_id": <parent_form_id> }
```

### FR-8 — Frontend-only

This spec introduces no backend code change. The fetch rides the existing count-mode `/values` endpoint (same path used by `kpi_total_registered` today).

### FR-9 — Color array extension

When `include_unanswered: true`, the chart's `config.color` array gains one trailing entry `#bfbfbf` so ECharts has a color for the new `_no_info` stack. This is done explicitly in the JSON config edit, not by the renderer — keeping the chart's color resolution under the dashboard author's control.

### FR-10 — Generic contract; existing dashboards opt in

The behavior defined by FR-1 through FR-9 is a **generic contract** for any chart item satisfying:

```
item.chart_type === "stack_bar"
&& item.compute === "compliance"
&& item.include_unanswered === true
&& config.parent_form_id is set on the dashboard root
```

Any current or future dashboard whose configuration matches that predicate inherits the third "No information available" category automatically — no per-dashboard code change. The implementation discovers matches dynamically via `collectByCompute(config.items, "compliance")` (already used by the existing param fetcher fan-out) and consumes `config.parent_form_id` directly.

The locked-in scope of this PR flips the flag on for the two charts that exist today; both edits are identical and dashboard-agnostic:

| Dashboard | Chart item path | Dashboard `parent_form_id` |
|---|---|---|
| EPS Overview | [`1749623934933.json:300`](../../../frontend/src/config/visualizations/1749623934933.json#L300) | [`1749623934933`](../../../frontend/src/config/visualizations/1749623934933.json#L2) |
| RWS Overview | [`1749621221728.json:538`](../../../frontend/src/config/visualizations/1749621221728.json#L538) | [`1749621221728`](../../../frontend/src/config/visualizations/1749621221728.json#L2) |

Each receives the same two-line diff: add `"include_unanswered": true` and append `"#bfbfbf"` to `config.color`. No per-chart `total_api`, no dashboard-specific code branch.

The RWS dashboard's [`kpi_drinking_water_compliance`](../../../frontend/src/config/visualizations/1749621221728.json#L266) (`compute: "compliance_kpi"`) is **explicitly out of scope** — its `denominator_api` already counts the parent universe, so the data-quality gap is already implicit in the displayed percentage. Adding `include_unanswered` to a ratio KPI is redundant. See [README.md "Out of scope"](./README.md#out-of-scope-explicitly-deferred).

---

## Non-functional requirements

### NFR-1 — Backwards compatible

Every existing dashboard, chart, and Jest test that touches `computeComplianceStackData()` or the dashboard fetch fan-out continues to render byte-identical output unless the chart explicitly sets `include_unanswered: true`. The compute helper's existing 2-arg signature must still work — the new `options` arg is positional-3 and defaulted.

### NFR-2 — Single round trip per dashboard load

The chart adds at most **one** `/values` count call per dashboard load (the universe count, derived from `config.parent_form_id`). It does not call per-EPS endpoints, does not subscribe to a stream, and does not poll.

### NFR-3 — Race-defensive

The compute helper must produce a sensible chart at every intermediate state of fetch resolution:

| State | Render |
|---|---|
| Param fetches loading, total fetch loading | Existing loading shimmer / empty (today's behavior) |
| Param fetches resolved, total fetch loading | Yes + No only (no third bar yet) |
| Param fetches loading, total fetch resolved | Yes + No only (no third bar yet — `yesCount/noCount` are still 0) |
| Both resolved, `totalRegistered ≥ yesCount + noCount` | Three bars |
| Both resolved, `totalRegistered < yesCount + noCount` | Three bars; `_no_info` clamped to 0 → effectively two bars (FR-5) |
| Universe fetch errors | Yes + No only; error logged; chart does not block |

### NFR-4 — Tested

Jest coverage extends [`compute/compliance.js`](../../../frontend/src/components/dashboard/compute/compliance.js)'s existing test file:

- Without the new `options.totalRegistered` arg → existing test cases continue to pass unchanged.
- With it → new cases per [design.md "Test plan"](./design.md#test-plan).

### NFR-5 — i18n-ready

The new bucket label flows through [`ui-text.js`](../../../frontend/src/lib/ui-text.js). No hard-coded English strings in JSX, JSON config, or the compute helper.

### NFR-6 — Documented

The dashboard config README at [`frontend/src/config/visualizations/README.md`](../../../frontend/src/config/visualizations/README.md) gains a sentence cross-referencing this doc under the section that documents `compute: "compliance"`. The reverse cross-link from the parent `_no_info` design's "Out of scope" list is also updated to point here.

### NFR-7 — ESLint + Prettier clean

All new JS code passes `npm run lint` and `npm run prettier` in the frontend container, per [CLAUDE.md](../../../CLAUDE.md). No `// eslint-disable-next-line`; no `console.log`; arrow callbacks; braced single-line bodies.

---

## Scope matrix

| Chart item shape | `include_unanswered: true` effect |
|---|---|
| `compute: "compliance"` + dashboard root has `parent_form_id` | Three X-axis categories; `_no_info` count via clamp formula |
| `compute: "compliance"` + dashboard root missing `parent_form_id` | Flag ignored; warning logged once; chart renders existing two categories |
| `compute: "compliance"` + universe fetch errors | Flag effectively off; chart renders two categories; error logged |
| `compute: "compliance"` + flag absent | No change (today's behavior) |
| Any non-compliance chart with the flag | Flag ignored (validated at config-read time; not a crash) |

---

## Open questions / risks

None — all open questions from the brainstorm round have been resolved:

1. ~~Where does the 105 KPI come from?~~ → `kpi_total_registered` at [line 137](../../../frontend/src/config/visualizations/1749623934933.json#L137); the same `{ form_id }` fetch shape is reused, deriving `form_id` from the dashboard root's `parent_form_id` (no new config block).
2. ~~Third X-axis category vs sub-stack of "No"?~~ → Third X-axis category. Unmonitored ≠ failing.
3. ~~Should the universe fetch respect chart filters?~~ → Yes, identical filter pipeline as the parameter fetches.
4. ~~Add a per-chart `total_api` to override the universe form?~~ → No in v1. Three places carrying the same fact creates drift risk. Override hook can be added later if a real use case appears.

A risk worth flagging in the PR description: when the chart flips on, a previously-clean two-bar chart starts showing a large gray bar. This is the **correct** picture, but it's a **changed** picture — a stakeholder note should accompany the merge, mirroring the parent design's release-note posture.
