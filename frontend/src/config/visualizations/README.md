# Dashboard Visualization Configs

JSON files in this directory drive the config-driven dashboards rendered at
`/dashboard/:slug`. Each file is a single dashboard definition identified by a
kebab-case `slug`. **No component code changes are required to add a new
dashboard** — drop a JSON file here, register it in [`index.js`](./index.js),
and visit `/dashboard/<slug>`.

## Quick start — add a new dashboard

### 1. Identify the form

The dashboard is keyed by the **registration (parent) form ID**. For a form
family with registration + monitoring forms, use the registration form's ID.

### 2. Create the config file

Create `<parent_form_id>.json` here using the flat-schema format described
below. Use [`1749623934933.json`](./1749623934933.json) (EPS Overview) as the
reference implementation.

Minimum required top-level keys:

```json
{
  "parent_form_id": 123,
  "slug": "my-dashboard",
  "name": "My Dashboard",
  "description": "Optional subtitle shown on the page.",
  "fiscal_year_start_month": 1,
  "items": []
}
```

`slug` is the public route identifier. It must be unique across all
dashboards and match `^[a-z0-9]+(-[a-z0-9]+)*$` (kebab-case). Everything else
— filters, KPIs, charts, tables, maps — is an **item** inside `items[]`.

### 3. Register the config

Add the import + entry in [`index.js`](./index.js):

```js
import myDashboard from "./123.json";

const RAW_CONFIGS = [epsOverview, myDashboard];
```

Configs with a missing, invalid, or duplicate slug are warned in the dev
console and skipped; the app still boots. Navigation to an unresolved slug
redirects to `/control-center`.

### 4. Visit the route

`/dashboard/my-dashboard` will render the new dashboard. No component or route
code changes required.

---

## Schema reference

### Top-level

```json
{
  "parent_form_id": 123,
  "slug": "my-dashboard",
  "name": "My Dashboard",
  "description": "...",
  "fiscal_year_start_month": 1,
  "items": [ /* flat array of items */ ]
}
```

Only these six keys at the top level. Everything else is an item.

### Common item fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Globally unique across the entire item tree |
| `chart_type` | string | yes | See catalogue below |
| `order` | number | yes | Sort key within siblings (ascending) |
| `hide` | boolean | no | Default `false`. Hidden items are still indexed for cross-refs |
| `col_span` | number | no | 1–24 Ant Design grid, relative to nearest parent container. Default `24` |
| `className` | string | no | CSS class passthrough |
| `label` | string | no | Widget title |
| `description` | string | no | Helper text shown below the title |

### `chart_type` catalogue

| `chart_type` | Renders | Key extra fields |
|---|---|---|
| `card` | KPI tile | `color`, `api`, `api.value_type` |
| `bar`, `line`, `doughnut`, `pie`, `stack_bar` | akvo-charts component | `config`, and one of: `api` / (`source`+`progress_ref`+`field`) / (`compute`+`params_ref`+`globals_ref`) |
| `histogram` | Bar chart with binned water-quality data | `group`, `threshold`, `display`, `api` |
| `table` | Escalation / data table | `api` (with `criteria[]`), `columns[]` |
| `map` | Leaflet map | `source_form_id`, `status_question_id`, `status_monitoring_form_id`, `status_colors`, `click_url_template` |
| `section_title` | `<h4>` heading | `text` |
| `tabs` | Container | `items[]` of pane objects (no `chart_type`) |
| `filter_bar` | Container | `items[]` of filter items |
| `filter_date` | Date-range picker | `date_question_ids` |
| `filter_administration` | Administration dropdown | — |
| `filter_option` | Single-select dropdown | `key`, `question_id`, `form_id` |
| `filter_multi_option` | Multi-select dropdown | `key`, `question_id`, `form_id` |
| `progress_definition` | Hidden definition | `key`, `components[]`, `api`, `start_date_question_id`, `deadline_question_id`, `scope_question_id` |
| `water_quality_globals` | Hidden definition | `sample_question_id`, `test_method_question_id`, `monitoring_form_id` |
| `custom_component` | Arbitrary React component from the custom-components registry | `component` (string, registry key) — see "Custom component escape hatch" below |

`progress_definition` and `water_quality_globals` items must have `"hide": true`.
The renderer always skips them; they exist solely to be resolved by id via
`definitionsById`.

### Tab pane shape

Tab panes are plain objects inside a `tabs` item's `items[]`. They have no
`chart_type`:

```json
{ "id": "tab_monitoring", "label": "Monitoring overview", "items": [ /* items */ ] }
```

**`is_public`** (optional, defaults to `true`) — when set to `false`, the tab
is rendered **disabled** for anonymous viewers and only becomes clickable
when `UIState.isLoggedIn` is `true`. Use this for tabs whose children fetch
authenticated endpoints. Combined with `destroyInactiveTabPane`, the disabled
tab's children never mount — no requests fire from anonymous sessions.

```json
{
  "id": "tab_individual_overview",
  "is_public": false,
  "label": "Individual Overview",
  "items": [ /* items */ ]
}
```

### `col_span` semantics

`col_span` is relative to the **nearest parent container** (a tab pane or the
root level), not the page. Two siblings with `col_span: 12` will share a row
inside their pane regardless of how deeply nested the pane is.

Example — two KPI tiles side by side inside a tab pane:

```json
{
  "id": "tab_construction",
  "label": "Construction",
  "items": [
    { "id": "kpi_a", "chart_type": "card", "order": 1, "col_span": 12, ... },
    { "id": "kpi_b", "chart_type": "card", "order": 2, "col_span": 12, ... }
  ]
}
```

### Cross-references by id

At load time `useDashboardConfig` builds `definitionsById: Map<id, item>` by
walking the entire tree. Consumers reference definitions by id:

| Use case | Fields |
|---|---|
| Compliance chart | `"compute": "compliance"`, `"params_ref": ["param_e_coli", ...]`, `"globals_ref": "wq_globals"` |
| Construction-progression bar | `"source": "progress"`, `"progress_ref": "progress_construction"`, `"field": "histogram"` |
| Escalation column sourced from progress | `"computed": true`, `"progress_ref": "progress_construction"`, `"component_key": "concrete_base"` |

---

## Chart data-source modes

### 1. API-driven (`api` block)

Hit `/visualization/values` with the chart's `api` params plus dashboard filter
state. Used by most cards, charts, and histograms.

```json
{
  "id": "chart_status",
  "chart_type": "doughnut",
  "api": {
    "form_id": 123,
    "question_id": 456,
    "group_by": "option",
    "monitoring": "latest"
  }
}
```

### 2. Cross-referenced (`source: "progress"`)

Reuses the response from a `progress_definition` item already fetched in the
background. No extra API call.

```json
{
  "id": "chart_construction_progress",
  "chart_type": "bar",
  "source": "progress",
  "progress_ref": "progress_construction",
  "field": "histogram"
}
```

### 3. Frontend-computed (`compute: "compliance"`)

Fans out `/values` calls per referenced `histogram` item (via `params_ref[]`)
and builds a stacked-bar chart client-side.

```json
{
  "id": "chart_compliance",
  "chart_type": "stack_bar",
  "compute": "compliance",
  "params_ref": ["param_e_coli", "param_turbidity"],
  "globals_ref": "wq_globals"
}
```

---

## Custom component escape hatch

Some dashboard tabs follow a **record-centric** pattern that does not fit the
aggregate chart paradigm — the user picks one record and downstream widgets
render details for that single record. Rather than extending the JSON schema
with primitives that only make sense for these tabs (token templates,
component dependencies, custom endpoints, named render registries), use the
`custom_component` chart_type to delegate rendering to a freely authored React
component.

### When to reach for it

- The interaction model is **record-centric**, not aggregate.
- The tab needs internal state that is not expressible as a global filter.
- The behavior is unique enough that no other dashboard would reuse it today.

### When NOT to reach for it

- The widget can be expressed as `card` / `bar` / `doughnut` / `table` etc.
  with an `api` block — extend the existing schema instead.
- Two or three other dashboards would benefit from the same widget — promote
  it to a first-class `chart_type` rather than copying components.

### Adding a custom component

1. Create `frontend/src/components/dashboard/custom-components/<Name>.jsx`.
2. Add a named export in [`custom-components/index.js`](../../components/dashboard/custom-components/index.js).
3. Reference it from JSON:

```json
{
  "id": "individual_overview_component",
  "chart_type": "custom_component",
  "order": 1,
  "component": "<Name>"
}
```

Unknown component names are not fatal — the renderer logs `console.error` and
displays an `<Alert>` placeholder, so the rest of the dashboard keeps working.

### What the component owns

- Data fetching, including auth-aware error handling.
- Loading, empty, and error UI states.
- Internal selection state, drill-downs, sub-tabs.
- Any internal filters (the dashboard's global filter bar is **not** piped in).

### Stay specific until rule-of-three

Do not generalize prematurely. The first per-dashboard custom component is
fine as a one-off. When a third dashboard needs a similar pattern, refactor
the common pieces into shared building-block components
(`<RecordSelectorBar>`, `<RegistrationDetailTable>`, etc.) — not into a single
mega-component driven by yet another schema.

---

## Filter hints (frontend-expanded)

These keys on an `api` block are expanded by the frontend before the request is
sent; the backend never sees them:

| Hint | Expansion |
|---|---|
| `rolling_months: N` | `from_date = today − N months`, `to_date = today` |
| `fiscal_year: true` | `from_date` / `to_date` set to the current fiscal year (anchored by `fiscal_year_start_month`) |
| `past_due: true` | `question_id = completion_question_id`, `option_value = "no"`, `date_question_id = deadline_question_id`, `to_date = today − 1 day` |

---

## Escalation tables

`table` items contain two halves:

**`api.criteria[]`** — rows are included when **any** criterion matches (OR):

| `type` | Semantics |
|---|---|
| `option_equals` | Latest answer equals the option value |
| `threshold_gt` | Numeric answer `>` threshold |
| `threshold_lt` | Numeric answer `<` threshold |
| `overdue` | Incomplete AND past deadline |

**`columns[]`** — backend-sourced column types:

| `source` | Yields |
|---|---|
| `parent_name` | Auto-generated parent datapoint name |
| `parent_answer` + `question_id` | Answer from the registration datapoint |
| `administration` | Administration hierarchy path |
| `answer` + `question_id` | Answer from the latest monitoring submission |
| `latest_date` + `question_id` | Date from the latest monitoring submission |

Columns with `"computed": true` are rendered client-side. Built-in computed
columns resolved by the renderer:

| `key` | Resolved from |
|---|---|
| `critical_issues` | Compliance param responses (requires a `compute: "compliance"` chart in the same dashboard) |
| `overall_progress` | Progress definition response (`progress_ref` required) |
| `expected_progress` | Computed from `_start_date` and `deadline` backend columns |
| Any column with `progress_ref` + `component_key` | Component percentage from progress response |

---

## Empty-data behaviour

- `<ChartRenderer>` renders a **"No data"** placeholder when the underlying
  response has zero rows.
- `<EscalationTable>` renders `"—"` for any cell whose value is null/missing,
  including `computed: true` cells that don't have a registered computer.

---

## Testing a new config

1. Start the stack: `./dc.sh up -d`
2. Open `http://localhost:3000/dashboard/<slug>`
3. Verify each tab renders without console errors
4. Click through the filter bar — KPIs and charts should re-fetch and redraw
5. If a chart shows "No data", check that the corresponding backend response
   is non-empty
6. Toggle `"hide": true` on one item in JSON → it should disappear on reload
7. Swap two `order` values → layout order should flip accordingly

---

## Related components

- [`DashboardRenderer`](../../components/dashboard/DashboardRenderer.jsx) — recursive item dispatcher
- [`ChartRenderer`](../../components/dashboard/ChartRenderer.jsx) — chart type → akvo-charts dispatch
- [`widgets/KPICard`](../../components/dashboard/widgets/KPICard.jsx) — single KPI tile
- [`widgets/TabsWidget`](../../components/dashboard/widgets/TabsWidget.jsx) — tabs container
- [`widgets/FilterBarWidget`](../../components/dashboard/widgets/FilterBarWidget.jsx) — filter bar container
- [`widgets/SectionTitleWidget`](../../components/dashboard/widgets/SectionTitleWidget.jsx) — section heading
- [`widgets/CustomComponentWidget`](../../components/dashboard/widgets/CustomComponentWidget.jsx) — registry-backed escape hatch (see "Custom component escape hatch")
- [`DashboardFilters`](../../components/dashboard/DashboardFilters.jsx) — individual filter controls
- [`DashboardMap`](../../components/dashboard/DashboardMap.jsx) — map widget
- [`EscalationTable`](../../components/dashboard/EscalationTable.jsx) — escalation table
- Hooks: [`useDashboardConfig`](../../util/hooks/useDashboardConfig.js), [`useDashboardFilters`](../../util/hooks/useDashboardFilters.js), [`useDashboardValues`](../../util/hooks/useDashboardValues.js), [`useDashboardProgress`](../../util/hooks/useDashboardProgress.js), [`useDashboardEscalation`](../../util/hooks/useDashboardEscalation.js)
