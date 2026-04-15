# IWSIMS Dashboard Config Example

This document is the long-form companion to
[`frontend/src/config/visualizations/README.md`](../../frontend/src/config/visualizations/README.md).
It walks through the **flat-schema** format used by config-driven dashboards,
section by section, with JSON examples and cross-reference semantics spelled
out. The canonical live example is
[`1749623934933.json`](../../frontend/src/config/visualizations/1749623934933.json)
(EPS Overview).

> **Note on history.** The dashboard config used to be a deeply nested object
> with separate `filters`, `kpis`, `charts`, `water_quality`, `progress`,
> `escalation`, `map`, `layout`, and top-level `tabs` sub-trees. That format
> has been retired. A backup of the old file lives in
> [`doc/claude/dashboard-visualization-design/1749623934933.legacy.json`](./dashboard-visualization-design/1749623934933.legacy.json)
> purely for archaeological reference. See [Migration mapping](#migration-mapping)
> at the bottom of this doc.

## Overview

A dashboard config is a **flat array of self-describing items**. Every widget
on the page — KPI card, chart, escalation table, map, section heading, filter
control, tab container — is a single entry in `items[]` with a stable `id`, an
`order`, and a `chart_type` that tells the renderer how to draw it.

Layout emerges from two simple rules:

1. Siblings are sorted by `order` (ascending) and laid out with Ant Design
   `<Row gutter=[16,16]>` + `<Col span={col_span ?? 24}>`.
2. Two container types, `tabs` and `filter_bar`, recursively nest their own
   `items[]` to group children.

Widgets can reference each other by `id` — for example, a compliance stacked
bar chart references the `histogram` items it aggregates over (`params_ref`),
and an escalation column references a `progress_definition` item
(`progress_ref` + `component_key`). Hidden definitions (`progress_definition`,
`water_quality_globals`) never render — they exist only to be looked up via
`definitionsById`.

## Top-level shape

Only five top-level keys are allowed:

```json
{
  "parent_form_id": 1749623934933,
  "name": "EPS Overview",
  "description": "Overview of EPS sites monitoring, water quality and construction information.",
  "fiscal_year_start_month": 1,
  "items": []
}
```

| Field | Type | Notes |
|---|---|---|
| `parent_form_id` | number | Registration form ID; also the route param at `/dashboard/:formId` |
| `name` | string | Page title |
| `description` | string | Subtitle shown under the page title |
| `fiscal_year_start_month` | number (1–12) | Anchors the `fiscal_year: true` filter hint |
| `items` | array | The flat item tree; everything below |

## Common item fields

Every item in `items[]` (at any nesting level, including inside tab panes and
filter bars) shares this base shape:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | **Globally unique** across the entire tree. Used for cross-refs and renderer keys |
| `chart_type` | string | yes | Dispatches to the widget registry (see catalogue below) |
| `order` | number | yes | Sort key within siblings, ascending |
| `hide` | boolean | no | Default `false`. Hidden items are still indexed for cross-refs |
| `col_span` | number | no | 1–24 Ant grid, relative to the **nearest parent container**. Default `24` |
| `className` | string | no | CSS class passthrough on the `<Col>` wrapper |
| `label` | string | no | Widget title (cards, charts, tables, panes) |
| `description` | string | no | Helper text below the title |

`col_span` is relative to its nearest container (root, a tab pane, a
`filter_bar`). Two siblings with `col_span: 12` share a row regardless of
nesting depth.

## `chart_type` catalogue

Each subsection below shows a minimal valid example of the type.

### `card` — KPI tile

```json
{
  "id": "kpi_total_registered",
  "chart_type": "card",
  "order": 4,
  "col_span": 6,
  "label": "Total EPS registered",
  "color": "#1890ff",
  "api": { "form_id": 1749623934933 }
}
```

Extra fields:

| Field | Notes |
|---|---|
| `color` | Accent colour hex |
| `api` | Params merged into `/visualization/values`. Supports `value_type: "percentage"` for ratio tiles |

### `bar`, `line`, `doughnut`, `pie`, `stack_bar` — charts

Three data-source modes: API-driven, progress-sourced, or frontend-computed.
See [Chart data-source modes](#chart-data-source-modes) below.

```json
{
  "id": "chart_operational_status",
  "chart_type": "doughnut",
  "order": 7,
  "col_span": 8,
  "config": { "title": "Operational Status" },
  "api": {
    "form_id": 1749632545233,
    "question_id": 1749633373968,
    "group_by": "option",
    "monitoring": "latest"
  }
}
```

`config` is passed through to the akvo-charts component (`title`, axis labels,
colours, etc.).

### `histogram` — water-quality parameter

```json
{
  "id": "param_e_coli",
  "chart_type": "histogram",
  "order": 11,
  "col_span": 12,
  "group": "microbial",
  "label": "E-coli presence",
  "config": { "title": "E-coli presence", "xAxisLabel": "CFU/100mL", "yAxisLabel": "EPS count" },
  "display": { "mode": "histogram", "bin_width": 50 },
  "threshold": { "max": 0 },
  "api": {
    "form_id": 1749632545233,
    "question_id": 1749633220746,
    "group_by": "parent_id",
    "monitoring": "latest",
    "repeat_agg": "average"
  }
}
```

| Field | Notes |
|---|---|
| `group` | Logical grouping label (e.g. `microbial`, `physical`, `chemical`) — purely informational |
| `threshold` | `{ min, max }`. Values outside are highlighted as non-compliant |
| `display` | `mode`, `bin_width` for histogram binning |

A histogram item doubles as a "parameter definition" — compliance charts
reference it via `params_ref[]`.

### `table` — escalation / data table

```json
{
  "id": "esc_monitoring",
  "chart_type": "table",
  "order": 15,
  "col_span": 24,
  "label": "Escalation List",
  "api": {
    "form_id": 1749623934933,
    "monitoring_form_id": 1749632545233,
    "criteria": [
      { "type": "option_equals", "question_id": 1749632647507, "value": "no", "label": "No water sample" },
      { "type": "threshold_gt", "question_id": 1749633220746, "value": 0, "label": "E.coli above threshold" }
    ]
  },
  "columns": [
    { "key": "eps_name", "label": "EPS name", "source": "parent_answer", "question_id": 1749624452994 },
    { "key": "last_monitoring", "label": "Last Monitoring", "source": "latest_date", "question_id": 1749632545235 },
    { "key": "critical_issues", "label": "Critical water quality issues", "computed": true }
  ]
}
```

See [Escalation criteria](#escalation-criteria) for `criteria[].type` options
and [Table columns](#table-columns) for `columns[].source` options.

### `map` — Leaflet map

```json
{
  "id": "map_main",
  "chart_type": "map",
  "order": 8,
  "col_span": 24,
  "height": 400,
  "source_form_id": 1749623934933,
  "status_question_id": 1749633373968,
  "status_monitoring_form_id": 1749632545233,
  "status_colors": { "operational": "#64A73B", "issue_with_system": "#e41a1c" },
  "click_action": "navigate",
  "click_url_template": "/control-center/data/{parent_form_id}/monitoring/{data_id}"
}
```

### `section_title` — heading

```json
{
  "id": "title_microbial",
  "chart_type": "section_title",
  "order": 10,
  "col_span": 24,
  "text": "Microbial Parameters"
}
```

Renders as `<Typography.Title level={4}>`.

### `tabs` — container

Tab panes are plain config objects inside `items[]` — **no `chart_type` on
panes**. Each pane has its own `id`, `label`, and recursive `items[]`.

```json
{
  "id": "main_tabs",
  "chart_type": "tabs",
  "order": 9,
  "col_span": 24,
  "items": [
    {
      "id": "tab_monitoring_overview",
      "label": "Monitoring overview",
      "items": [ /* items ordered by `order` within this pane */ ]
    },
    {
      "id": "tab_water_quality",
      "label": "Water quality",
      "items": []
    }
  ]
}
```

Nested `tabs` items inside a pane are allowed — `id` just has to stay globally
unique.

### `filter_bar` — container

Wraps filter items into a single horizontal bar.

```json
{
  "id": "filters_main",
  "chart_type": "filter_bar",
  "order": 3,
  "col_span": 24,
  "items": [
    { "id": "filter_date", "chart_type": "filter_date", "order": 1, "label": "Monitoring Period",
      "date_question_ids": { "water_quality": 1749632545235, "construction": 1749624452911 } },
    { "id": "filter_administration", "chart_type": "filter_administration", "order": 2, "label": "Location" }
  ]
}
```

### `filter_date`

```json
{
  "id": "filter_date",
  "chart_type": "filter_date",
  "order": 1,
  "label": "Monitoring Period",
  "date_question_ids": {
    "water_quality": 1749632545235,
    "construction": 1749624452911
  }
}
```

`date_question_ids` is a map so different form families can bind to different
date questions when the filter is applied.

### `filter_administration`

```json
{
  "id": "filter_administration",
  "chart_type": "filter_administration",
  "order": 2,
  "label": "Location"
}
```

### `filter_option` and `filter_multi_option`

```json
{
  "id": "filter_water_committee",
  "chart_type": "filter_option",
  "order": 4,
  "key": "water_committee",
  "question_id": 1749624452105,
  "form_id": 1749623934933,
  "label": "Water Committee"
}
```

`filter_multi_option` has the same shape but renders a multi-select and emits
an array to downstream `/values` calls.

### `progress_definition` — hidden

Referenceable by other widgets via `progress_ref: "<id>"`.

```json
{
  "id": "progress_construction",
  "chart_type": "progress_definition",
  "hide": true,
  "order": 1,
  "key": "construction",
  "label": "Construction progress",
  "start_date_question_id": 1749624452910,
  "deadline_question_id": 1749630516825,
  "scope_question_id": 1749624505915,
  "api": {
    "form_id": 1749623934933,
    "monitoring_form_id": 1749624452908,
    "filter_question_id": 1749630516826,
    "filter_option_value": "no"
  },
  "components": [
    { "key": "concrete_base", "label": "Concrete Base Construction", "formula": "any_yes",
      "question_ids": [1849633499999, 1849633498888, 1849633497777] },
    { "key": "urf_tank", "label": "URF Tank", "formula": "completed_binary",
      "question_ids": [1849633720001] }
  ]
}
```

**Important:** `components[]` is a **sibling of `api`** on the
`progress_definition` item — not nested inside `api`. See
[Progress formulas](#progress-formulas) for the `formula` options.

### `water_quality_globals` — hidden

Shared settings referenced by compliance charts via `globals_ref: "<id>"`.

```json
{
  "id": "wq_globals",
  "chart_type": "water_quality_globals",
  "hide": true,
  "order": 2,
  "sample_question_id": 1749632647507,
  "test_method_question_id": 1749633001462,
  "monitoring_form_id": 1749632545233
}
```

## Cross-references

When the config loads, `useDashboardConfig` walks the tree once and builds
`definitionsById: Map<id, item>`. Consumers look up definitions by id:

| Consumer | Reference fields | Resolves to |
|---|---|---|
| Compliance `stack_bar` | `"compute": "compliance"`, `"params_ref": ["param_e_coli", ...]`, `"globals_ref": "wq_globals"` | Each referenced `histogram` item and the `water_quality_globals` item |
| Progress-sourced `bar` / `line` | `"source": "progress"`, `"progress_ref": "progress_construction"`, `"field": "histogram"` | The named `progress_definition` item |
| Escalation computed column | `"computed": true`, `"progress_ref": "progress_construction"`, `"component_key": "concrete_base"` | A component inside the referenced `progress_definition.components[]` |

IDs must be globally unique. The renderer validates this at load time and
throws with the offending id if it finds a collision.

## Chart data-source modes

### API-driven — `api` block

Most cards, charts, and histograms call `/visualization/values` directly with
their `api` params merged with current dashboard filter state.

### Cross-referenced — `source: "progress"`

```json
{
  "id": "chart_construction_progression",
  "chart_type": "bar",
  "source": "progress",
  "progress_ref": "progress_construction",
  "field": "histogram"
}
```

Reuses the response already fetched for the referenced `progress_definition`.
No extra API call.

### Frontend-computed — `compute: "compliance"`

```json
{
  "id": "chart_drinking_water_compliance",
  "chart_type": "stack_bar",
  "compute": "compliance",
  "params_ref": ["param_e_coli", "param_turbidity", "param_ph"],
  "globals_ref": "wq_globals"
}
```

The renderer fans out one `/values` request per referenced `histogram` and
computes a stacked-bar series client-side using each param's `threshold`.

## Filter hints (frontend-expanded)

These keys on any `api` block are expanded by the frontend before the request
is sent — the backend never sees them:

| Hint | Expansion |
|---|---|
| `rolling_months: N` | `from_date = today − N months`, `to_date = today` |
| `fiscal_year: true` | `from_date` / `to_date` set to the current fiscal year, anchored by `fiscal_year_start_month` |
| `past_due: true` | Sets `question_id = completion_question_id`, `option_value = "no"`, `date_question_id = deadline_question_id`, `to_date = today − 1 day` |

## Escalation criteria

A `table` item's rows are included when **any** (OR) of the `api.criteria[]`
entries match:

| `type` | Semantics |
|---|---|
| `option_equals` | Latest answer for `question_id` equals `value` |
| `threshold_gt` | Numeric answer for `question_id` is strictly greater than `value` |
| `threshold_lt` | Numeric answer for `question_id` is strictly less than `value` |
| `overdue` | Submission is incomplete (`completion_qid` != `yes`) AND past `deadline_qid` |

Each criterion also carries a `label` used for tooltips / legends, and may set
`hide: true` to be indexed but excluded from the active filter set.

## Table columns

Each entry in `columns[]` is either backend-sourced or `computed: true`:

| `source` | Yields |
|---|---|
| `parent_name` | Auto-generated parent datapoint name |
| `parent_answer` + `question_id` | Answer from the registration datapoint |
| `administration` | Administration hierarchy path |
| `answer` + `question_id` | Answer from the latest monitoring submission |
| `latest_date` + `question_id` | Date from the latest monitoring submission |

Built-in computed columns the renderer recognises:

| `key` | Resolved from |
|---|---|
| `critical_issues` | Compliance param responses (requires a `compute: "compliance"` chart in the same dashboard) |
| `overall_progress` | Progress response of the referenced `progress_ref` |
| `expected_progress` | Linear interpolation between `_start_date` and `deadline` backend columns |
| Any column with `progress_ref` + `component_key` | Component percentage from progress response |

## Progress formulas

Each entry in `progress_definition.components[]` carries a `formula` that
tells the progress hook how to translate the component's answers into a 0–100
percentage:

| `formula` | Semantics |
|---|---|
| `any_yes` | 100 if any listed `question_ids` answered `yes`, else 0 |
| `completed_binary` | 100 if the single listed question is answered `yes`, else 0 |
| `ratio` | `question_ids[0] / question_ids[1] * 100`, clamped to [0, 100] |
| `multi_select_proportion` | `selected_count / total_items * 100`. Uses `total_items` on the component |

A component's own `hide: true` excludes it from overall-progress averaging
while still allowing it to appear in escalation tables as a blank column (for
parity across dashboards).

## Example walkthrough — minimal two-tab dashboard

A full-enough example: two tabs, a global filter bar, two KPI cards, one
chart per tab, and one escalation table.

```json
{
  "parent_form_id": 99999,
  "name": "Site health",
  "description": "Minimal demo config.",
  "fiscal_year_start_month": 1,
  "items": [
    {
      "id": "wq_globals",
      "chart_type": "water_quality_globals",
      "hide": true,
      "order": 1,
      "sample_question_id": 111,
      "test_method_question_id": 112,
      "monitoring_form_id": 99998
    },
    {
      "id": "filters_main",
      "chart_type": "filter_bar",
      "order": 2,
      "items": [
        { "id": "filter_date", "chart_type": "filter_date", "order": 1,
          "label": "Period", "date_question_ids": { "monitoring": 113 } },
        { "id": "filter_administration", "chart_type": "filter_administration",
          "order": 2, "label": "Location" }
      ]
    },
    {
      "id": "kpi_registered",
      "chart_type": "card",
      "order": 3,
      "col_span": 12,
      "label": "Total sites",
      "api": { "form_id": 99999 }
    },
    {
      "id": "kpi_operational",
      "chart_type": "card",
      "order": 4,
      "col_span": 12,
      "label": "Operational sites",
      "color": "#64A73B",
      "api": { "form_id": 99998, "question_id": 200, "option_value": "yes",
        "monitoring": "latest", "sum_by": "parent_id" }
    },
    {
      "id": "main_tabs",
      "chart_type": "tabs",
      "order": 5,
      "items": [
        {
          "id": "tab_overview",
          "label": "Overview",
          "items": [
            {
              "id": "chart_status",
              "chart_type": "doughnut",
              "order": 1,
              "col_span": 24,
              "config": { "title": "Operational status" },
              "api": { "form_id": 99998, "question_id": 200,
                "group_by": "option", "monitoring": "latest" }
            }
          ]
        },
        {
          "id": "tab_issues",
          "label": "Issues",
          "items": [
            {
              "id": "esc_issues",
              "chart_type": "table",
              "order": 1,
              "col_span": 24,
              "label": "Sites with open issues",
              "api": {
                "form_id": 99999,
                "monitoring_form_id": 99998,
                "criteria": [
                  { "type": "option_equals", "question_id": 200, "value": "no",
                    "label": "Non-operational" }
                ]
              },
              "columns": [
                { "key": "site_name", "label": "Site", "source": "parent_name" },
                { "key": "last_check", "label": "Last check",
                  "source": "latest_date", "question_id": 113 }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## Migration mapping

For anyone still looking at legacy configs, this table maps each old
sub-tree to its flat-schema equivalent.

| Legacy path | Flat-schema equivalent |
|---|---|
| `config.tabs[]` (top-level) | One `{ chart_type: "tabs", items: [...] }` item at the root |
| `config.filters.date` | `{ chart_type: "filter_date", ... }` inside a `filter_bar` container |
| `config.filters.administration` | `{ chart_type: "filter_administration", ... }` |
| `config.filters.custom[]` | One `filter_option` or `filter_multi_option` item each |
| `config.kpis.<key>` | One `{ chart_type: "card", ... }` item; id prefixed `kpi_` |
| `config.charts.<key>` | One chart item (`bar` / `line` / `doughnut` / `pie` / `stack_bar`); id prefixed `chart_` |
| `config.water_quality.parameters[]` | One `{ chart_type: "histogram", ... }` item each; id prefixed `param_`; carries `group` |
| `config.water_quality.{sample_question_id, test_method_question_id, monitoring_form_id}` | One hidden `{ chart_type: "water_quality_globals", ... }` item (commonly `id: "wq_globals"`) |
| `config.progress.<key>` | One hidden `{ chart_type: "progress_definition", ... }` item; `components[]` sibling of `api` |
| `config.escalation.<key>` | One `{ chart_type: "table", ... }` item; id prefixed `esc_` |
| `config.map` | One `{ chart_type: "map", ... }` item |
| `config.layout.<tab>.sections[]` | Dissolved — each section's items become pane `items[]` of the matching tab; layout inferred from `col_span` |
| Legacy section type `kpi_row` | n/a — cards with matching `col_span` share a row automatically |
| Legacy section types `chart_grid` / `chart_row` | n/a — same mechanism |
| Legacy section type `parameter_grid` | n/a — list the referenced `param_*` items directly with appropriate `col_span` |
| Legacy section type `escalation_table` | Replaced by `chart_type: "table"` |
| Legacy section type `section_title` | Promoted to a top-level item `chart_type: "section_title"` |
| Reference `"compliance_params_ref": "water_quality.parameters"` | `"params_ref": ["param_e_coli", ...]` (array of item ids) + `"globals_ref": "wq_globals"` |
| Reference `"progress_ref": "construction"` (key) | `"progress_ref": "progress_construction"` (item id) |

The legacy renderer's responsibilities (matching section types to layout
components, looking up definitions by path strings) are all folded into the
new `DashboardRenderer` + `definitionsById` lookup. See
[`DashboardRenderer`](../../frontend/src/components/dashboard/DashboardRenderer.jsx)
and [`useDashboardConfig`](../../frontend/src/util/hooks/useDashboardConfig.js)
for the implementation.
