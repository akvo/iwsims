# Dashboard Visualization Configs

JSON files in this directory drive the config-driven dashboards rendered at
`/dashboard/:formId`. Each file is a single dashboard definition keyed by the
parent form's ID. **No component code changes are required to add a new
dashboard** — drop a JSON file here, register it in [`index.js`](./index.js),
and visit `/dashboard/<formId>`.

## Quick start — add a new dashboard

### 1. Identify the form

The dashboard is keyed by the **registration (parent) form ID**. For a form
family with registration + monitoring forms, use the registration form's ID.

### 2. Create the config file

Create `<parent_form_id>.json` here, using an existing config as a template:

- Reference implementation: [`1749623934933.json`](./1749623934933.json) (EPS Overview)
- Full schema walkthrough: [`doc/claude/iwsims-dashboard-config-example.md`](../../../../doc/claude/iwsims-dashboard-config-example.md)
- Underlying API: [`doc/claude/generic-visualization-api-spec.md`](../../../../doc/claude/generic-visualization-api-spec.md)

Minimum required top-level keys:

```json
{
  "parent_form_id": 123,
  "name": "My Dashboard",
  "tabs": [{ "key": "overview", "label": "Overview" }],
  "filters": { "date": { ... }, "administration": { ... }, "custom": [] },
  "kpis": { ... },
  "charts": { ... },
  "layout": { "overview": { "sections": [ ... ] } }
}
```

Optional: `water_quality`, `progress`, `escalation`, `map` — include only
the sections your dashboard actually uses.

### 3. Register the config

Add the import + entry in [`index.js`](./index.js):

```js
import myDashboard from "./123.json";

const CONFIGS = {
  [epsOverview.parent_form_id]: epsOverview,
  [myDashboard.parent_form_id]: myDashboard,
};
```

### 4. Visit the route

`/dashboard/123` will render the new dashboard. No component or route code
changes required.

---

## Concepts

### Layout sections

The `layout` block maps each tab key to an ordered list of sections. Each
section is dispatched to a specific widget by the `type` field:

| `type` | Renders | Uses config keys |
|---|---|---|
| `kpi_row` | Row of KPI tiles | `kpis: string[]` |
| `map` | Map widget | `height?: number` |
| `chart` | Single chart | `chart_key: string` |
| `chart_row` \| `chart_grid` | Grid of charts | `charts: string[]`, `columns?: number` |
| `parameter_grid` | Water-quality parameter grid | `group: "microbial" \| "physical" \| "chemical"`, `columns?: number` |
| `escalation_table` | Escalation list table | `escalation_key: string` |
| `section_title` | Heading | `text: string` |

Any section (or KPI / chart / parameter / escalation definition) may set
`"hide": true` to skip it without deleting the entry.

### Chart types

`charts[*].chart_type` dispatches to an akvo-charts component:

- `bar`, `doughnut`, `line`, `pie`, `stack_bar`

Three data-source modes per chart:

1. **API-driven** — has an `api` block. `/visualization/values` is called
   with those params plus the dashboard's filter state.
2. **Cross-referenced** — has `source: "progress"` + `progress_ref`. Reuses
   the response from the named entry in `config.progress` (no extra fetch).
3. **Frontend-computed** — has `compute: "compliance"` + `compliance_params_ref`.
   The frontend fans out `/values` calls per referenced parameter and builds
   the chart data locally (used for the drinking-water compliance stacked
   bar).

### Filter hints (frontend-expanded)

These keys on an `api` block are expanded by the frontend before the request
is sent; the backend never sees them:

| Hint | Expansion |
|---|---|
| `rolling_months: N` | `from_date = today - N months`, `to_date = today` |
| `fiscal_year: true` | `from_date` / `to_date` set to the current fiscal year (anchored by `filters.date.fiscal_year_start_month`) |
| `past_due: true` | `question_id = completion_question_id`, `option_value = "no"`, `date_question_id = deadline_question_id`, `to_date = today - 1 day` |

### Custom filters — current limitation

Custom filters in `filters.custom[]` drive `<Select>` dropdowns in the filter
bar and write state, but they currently only narrow widgets whose `api.question_id`
already matches the filter's `question_id`. Global multi-question AND
filtering (e.g. "Rotary Pacific" + "Water Committee = Yes" as a cross-cut)
requires backend work tracked in beads epic `akvo-mis-2aj`.

The same limitation applies to `multiple_option` filters: the UI accepts
multiple selections but `/visualization/values` only honours the first
value (extra selections are silently dropped). Treat custom filters as
single-value until the epic lands.

### Escalation tables

Each entry under `escalation` has two halves:

**`api.criteria[]`** — list of `{ type, question_id, value }` rules. Rows
are included when **any** criterion matches (OR semantics). Supported
operator types:

| `type` | Example | Semantics |
|---|---|---|
| `option_equals` | `option_equals:{qid}:{value}` | Latest answer equals the option value |
| `threshold_gt` | `threshold_gt:{qid}:5` | Numeric answer `>` threshold |
| `threshold_lt` | `threshold_lt:{qid}:6.5` | Numeric answer `<` threshold |
| `overdue` | `overdue:{completion_qid}:{deadline_qid}` | Incomplete AND past deadline |

A two-sided range (e.g. pH should be in `[6.5, 8.5]`) is expressed as two
separate criteria — `threshold_lt:qid:6.5` and `threshold_gt:qid:8.5` —
combined naturally by the OR.

**`columns[]`** — what each cell renders. Backend-sourced column types:

| `source` | Yields |
|---|---|
| `parent_name` | Auto-generated parent datapoint name |
| `parent_answer` + `question_id` | Answer from the registration (parent) datapoint |
| `administration` | Administration hierarchy path |
| `answer` + `question_id` | Answer from the latest monitoring submission |
| `latest_date` + `question_id` | Date from the latest monitoring submission |

Mark a column with `"computed": true` (no `source`) when its value can't
come from the backend — e.g. an aggregated "critical issues" string built
from per-parameter compliance results. The page resolves these via a
`cellComputers` map keyed by the column's `key`. See the EPS dashboard's
`critical_issues` column for the reference wiring (joins
`config.water_quality.parameters` thresholds against the per-parameter
`/values` responses already fetched for the compliance chart).

---

### Empty-data behaviour

`<ChartRenderer>` renders a **"No data"** placeholder (instead of a broken
chart) when the underlying response has zero rows. `<EscalationTable>`
renders `"—"` for any cell whose value is `null` / missing, including
`computed: true` cells that don't have a registered `cellComputers` entry.
Both are intentional — they keep the dashboard usable while a form family
is still being seeded.

## Testing a new config

1. Start the stack: `./dc.sh up -d`
2. Open `http://localhost:3000/dashboard/<parent_form_id>`
3. Verify each tab renders without errors
4. Click through the filter bar — KPIs and charts should re-fetch and redraw
5. If a chart shows "No data", check that the corresponding backend response
   is non-empty (use the URLs in [`doc/claude/iwsims-dashboard-api-checklist.md`](../../../../doc/claude/iwsims-dashboard-api-checklist.md) as a reference)
6. If you swap `formId` in the URL, filter state resets to the new
   dashboard's shape — verified at the hook layer
   ([`useDashboardFilters`](../../util/hooks/useDashboardFilters.js))

## Related components

- [`ChartRenderer`](../../components/dashboard/ChartRenderer.jsx) — chart type → akvo-charts dispatch
- [`KPICardRow`](../../components/dashboard/KPICardRow.jsx) — KPI tiles
- [`DashboardFilters`](../../components/dashboard/DashboardFilters.jsx) — filter bar
- [`DashboardMap`](../../components/dashboard/DashboardMap.jsx) — map widget
- [`EscalationTable`](../../components/dashboard/EscalationTable.jsx) — escalation table
- Hooks: [`useDashboardConfig`](../../util/hooks/useDashboardConfig.js), [`useDashboardFilters`](../../util/hooks/useDashboardFilters.js), [`useDashboardValues`](../../util/hooks/useDashboardValues.js), [`useDashboardProgress`](../../util/hooks/useDashboardProgress.js), [`useDashboardEscalation`](../../util/hooks/useDashboardEscalation.js)
