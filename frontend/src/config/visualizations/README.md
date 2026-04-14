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
requires backend work tracked in [beads epic `akvo-mis-2aj`](../../../../.beads/).

---

## Testing a new config

1. Start the stack: `./dc.sh up -d`
2. Open `http://localhost:3000/dashboard/<parent_form_id>`
3. Verify each tab renders without errors
4. Click through the filter bar — KPIs and charts should re-fetch and redraw
5. If a chart shows "No data", check that the corresponding backend response
   is non-empty (use the URLs in [`doc/claude/iwsims-dashboard-api-checklist.md`](../../../../doc/claude/iwsims-dashboard-api-checklist.md) as a reference)

## Related components

- [`ChartRenderer`](../../components/dashboard/ChartRenderer.jsx) — chart type → akvo-charts dispatch
- [`KPICardRow`](../../components/dashboard/KPICardRow.jsx) — KPI tiles
- [`DashboardFilters`](../../components/dashboard/DashboardFilters.jsx) — filter bar
- [`DashboardMap`](../../components/dashboard/DashboardMap.jsx) — map widget
- [`EscalationTable`](../../components/dashboard/EscalationTable.jsx) — escalation table
- Hooks: [`useDashboardConfig`](../../util/hooks/useDashboardConfig.js), [`useDashboardFilters`](../../util/hooks/useDashboardFilters.js), [`useDashboardValues`](../../util/hooks/useDashboardValues.js), [`useDashboardProgress`](../../util/hooks/useDashboardProgress.js), [`useDashboardEscalation`](../../util/hooks/useDashboardEscalation.js)
