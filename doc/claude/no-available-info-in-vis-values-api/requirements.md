# "No information available" bucket — Requirements

Locked functional and non-functional requirements for the opt-in `_no_info` bucket on `/api/v1/visualization/values`.

For architecture, SQL, and the implementation plan, see [design.md](./design.md). For the rationale behind each decision, see the "Decisions locked from brainstorm" table in [README.md](./README.md).

---

## Problem statement

The visualization API exposes two endpoints whose outputs do not reconcile when monitoring data is incomplete:

- `GET /api/v1/visualization/values?form_id=<registration_form>` returns the total number of registered datapoints (e.g. **104** EPS).
- `GET /api/v1/visualization/values?form_id=<monitoring_form>&group_by=option&question_id=<status_question>` returns counts per option that sum to **≤ 104** because only datapoints with a monitoring submission contribute.

The donut chart at [`frontend/src/config/visualizations/1749623934933.json:216`](../../../frontend/src/config/visualizations/1749623934933.json#L216) shows 80 EPS by status while the KPIs above it claim 104 EPS exist. The 24 un-monitored EPS disappear, hiding both a data-quality gap and the correct denominator from the dashboard reader.

**Goal**: surface the gap as a single, clearly-labelled bucket so totals reconcile and the data-quality issue is visible.

---

## Functional requirements

### FR-1 — Synthetic bucket emission (backend)

When `/api/v1/visualization/values` receives `include_unanswered=true` and the response shape is one of the supported variants (see FR-7), append one extra row to the response:

```json
{
  "value": <count>,
  "label": "No information available",
  "group": "_no_info",
  "color": "#bfbfbf"
}
```

The bucket appears at the **end** of the response array so existing consumers reading by index do not break.

### FR-2 — Definition of "no information available"

A parent registration contributes to the bucket when, **after applying every filter on the request** (administration, date range, criteria, monitoring scope), one of the following holds:

- The parent has no submission on the monitoring form for the question, **or**
- The parent's qualifying monitoring submission has a null/empty answer for the question.

Both cases collapse to the single `_no_info` bucket. Splitting them is explicitly deferred (see [README.md "Out of scope"](./README.md#out-of-scope-explicitly-deferred)).

### FR-3 — Filter parity

The bucket count and the option counts are computed against the **same filtered parent universe**. This is what makes the totals reconcile under filtering — administration drilldown, date range, and criteria filters must all narrow the bucket the same way they narrow the option counts.

### FR-4 — Multiple-option semantics

For `multiple_option` questions a single record may answer multiple options, so `total_parents − sum(option_counts)` over-counts the gap. The bucket count is computed as:

> the count of **distinct parents** in the filtered universe whose qualifying monitoring submission answered **none** of the question's options.

For single-choice `option` questions, the same definition is equivalent to `total_parents − sum(option_counts)`, but the implementation uses the distinct-parent query uniformly so behavior is consistent across question types.

### FR-5 — Opt-in only

Default behavior is unchanged. The bucket only appears when the request explicitly includes `include_unanswered=true`. Without the flag, every existing consumer (`stack_bar cross_tab`, `kpi_stack`, `share_card`, KPI tiles, etc.) gets byte-identical output.

### FR-6 — Percentages stay coherent

When `value_type=percentage` AND `include_unanswered=true`, the synthetic bucket participates in the denominator. The N+1 rows of the response sum to 100%. Without the flag, percentages are computed as today (over the answered universe only).

### FR-7 — Supported endpoint shapes

The bucket is emitted when **all** of the following hold:

- The request specifies a `question_id` whose form is a **monitoring form** (i.e. `Forms.parent` is not null).
- The question type is `option` or `multiple_option`.
- The request shape matches one of:
  - `group_by=option` (donut / single-axis bar chart)
  - `share_card` semantics (single-fetch share KPI — see [README.md:372 "Share KPI cards"](../../../frontend/src/config/visualizations/README.md#L372))

The bucket is **not** emitted (flag is silently ignored) for:

- Registration-form questions — every row in the registration form is a registration; there is no gap to surface.
- Count mode (no `question_id`) — there is no per-option breakdown to compare against.
- `option_value=X` scalar / KPI mode — already serviceable via `denominator_api`.
- `stack_by=option` with `group_by=parent_id` — the per-parent row layout makes the gap implicit.
- `group_by=month` / `group_by=date` time-series shapes — the gap concept is not well-defined per time bucket in v1.

### FR-8 — Soft-deleted parents excluded

The un-monitored count uses `FormData.objects` (the default manager that filters soft-deletes via the `SoftDeletes` mixin per the backend conventions in [`CLAUDE.md`](../../../CLAUDE.md)). A parent that has been soft-deleted is not counted, even if a stale monitoring record orphaned by it still exists.

### FR-9 — Frontend label is i18n-ready

The frontend labels the bucket using a single string constant in [`frontend/src/lib/ui-text.js`](../../../frontend/src/lib/ui-text.js):

```js
// Charts
showEmpty: "Show empty values",
noInformationAvailable: "No information available",
```

Consumers ([`ChartRenderer.jsx`](../../../frontend/src/components/dashboard/ChartRenderer.jsx), [`DashboardMap.jsx`](../../../frontend/src/components/dashboard/DashboardMap.jsx), and any future widget) reference `uiText.en.noInformationAvailable`. The German locale `de` already exists as an empty map and will pick up translations when populated.

### FR-10 — Map widget opts in via `status_colors._no_info`

[`DashboardMap.jsx`](../../../frontend/src/components/dashboard/DashboardMap.jsx) renders un-monitored parents in the dashboard's chosen gray when (and only when) the map item config defines `status_colors._no_info`:

```json
"status_colors": {
  "operational": "#64A73B",
  "issue_with_system": "#e41a1c",
  "_no_info": "#bfbfbf"
}
```

The map legend gains a corresponding "No information available" entry under the same condition. When the key is absent, behavior is unchanged: un-monitored EPS render with whatever the current default is.

### FR-11 — `share_card` honors the flag

When a `share_card`'s `api` block includes `include_unanswered: true`:

- Numerator (the row whose `group` matches `target_group`) is unchanged.
- Denominator (sum of every row's `value`) now includes the `_no_info` row.

The visible effect is that "Operational EPS share" reads as a share of **all registered EPS**, not just monitored EPS. Dashboards that prefer the legacy "share of monitored" framing simply omit the flag.

### FR-12 — Existing dashboards opt in

The locked-in scope of this work flips two existing donuts on:

- Operational status donut at [`1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json) (EPS Overview): add `"include_unanswered": true` to the donut's `api` block.
- Operational status donut at [`1749621221728.json`](../../../frontend/src/config/visualizations/1749621221728.json) (RWS Overview): same change.

Each dashboard's map widget MAY also opt in by adding `status_colors._no_info` — discussed in [design.md "Frontend wiring"](./design.md#frontend-wiring).

---

## Non-functional requirements

### NFR-1 — Backwards compatible

Every existing test, dashboard, mobile-app fetch, and undocumented external integration that reads `/visualization/values` continues to receive byte-identical responses unless they explicitly send `include_unanswered=true`.

### NFR-2 — Single round trip

The bucket count is computed inside the same backend request as the rest of the response. The frontend never makes a second fetch to derive the gap.

### NFR-3 — Performance

The bucket adds at most one `COUNT(DISTINCT parent_id)` query over the already-filtered parent set. No N+1 query patterns. For typical dashboards (≤ 1000 registered parents) the added latency is negligible.

### NFR-4 — Documented

The dashboard config README at [`frontend/src/config/visualizations/README.md`](../../../frontend/src/config/visualizations/README.md) gains a paragraph in the "Empty-data behaviour" section ([README.md:613](../../../frontend/src/config/visualizations/README.md#L613)) describing:

- The opt-in `include_unanswered=true` flag.
- The reserved `_no_info` group key and its single-bucket multi-option semantics.
- The opt-in `status_colors._no_info` for maps.

### NFR-5 — i18n-ready

All user-visible strings introduced by this work flow through [`ui-text.js`](../../../frontend/src/lib/ui-text.js) per FR-9. No hard-coded English strings in JSX or chart configs.

### NFR-6 — Tested

Backend test coverage matches the existing pattern at [`tests_values_option.py`](../../../backend/api/v1/v1_visualization/tests/tests_values_option.py): one test per supported shape, plus negative tests confirming the flag has no effect on out-of-scope shapes (FR-7).

---

## Scope matrix

| Endpoint shape | `include_unanswered=true` effect |
|---|---|
| `group_by=option` (donut/single-axis bar) | N+1 rows; bucket appended |
| `group_by=option, value_type=percentage` | N+1 rows; percentages sum to 100% |
| `share_card` (no explicit `group_by`, `target_group` set) | N+1 rows; denominator includes bucket |
| `option_value=X, sum_by=parent_id` (scalar KPI) | flag ignored — use `denominator_api` |
| `stack_by=option, group_by=parent_id` (per-parent stack) | flag ignored — gap is implicit |
| `group_by=month` / `group_by=date` (time series) | flag ignored — out of scope v1 |
| Registration-form question | flag ignored — no gap |
| Count mode (no `question_id`) | flag ignored — no per-option breakdown |

---

## Open questions / risks

None — all open questions from the brainstorm round have been resolved (see [README.md "Decisions locked"](./README.md#decisions-locked-from-brainstorm)).

A risk worth flagging in the PR description: when [`1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json) and [`1749621221728.json`](../../../frontend/src/config/visualizations/1749621221728.json) flip the flag on, the visible numbers in the donut change. This is the **correct** number, but it's a **changed** number — a stakeholder note should accompany the merge.
