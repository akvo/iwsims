# IWSIMS Dashboard Config — EPS Example

Frontend dashboard configuration for the IWSIMS EPS form family. Consumes the generic visualization API defined in [generic-visualization-api-spec.md](generic-visualization-api-spec.md).

**Form family**: EPS (Effective Protection System)
- Registration form: `1749623934933`
- Water Quality monitoring: `1749632545233`
- Construction monitoring: `1749624452908`

**Target route**: `/dashboard/1749623934933`

---

## Config Walkthrough (for reviewers & new teammates)

This section explains, top-to-bottom, what each block does and why it is shaped that way. Share this with anyone onboarding to the dashboard.

### 1. The mental model

The config is a **pure-frontend description of a dashboard**. The backend has three generic endpoints (`/values`, `/escalation/{form_id}`, `/progress/{form_id}`) that take query parameters. This JSON tells the frontend:

- which **form family** the dashboard belongs to,
- which **widgets** (KPIs, charts, tables, maps) to render,
- what **query parameters** to send for each widget,
- how to **lay them out** per tab,
- and which items are currently **hidden** (`hide: true`).

**Zero backend changes** are required to add, remove, or reshape widgets. Adding a dashboard for a new form family means creating a new JSON file and registering it.

### 2. Top-level keys

```
parent_form_id           // Anchors the dashboard to a registration form
name, description        // Display metadata
tabs[]                   // Top nav tabs
filters{}                // Filter bar (date, administration, custom)
kpis{}                   // KPI tile definitions
charts{}                 // Chart definitions
water_quality{}          // Parameters block (shared by microbial/physical/chemical sections)
progress{}               // Progress histograms (bucketed percentages)
escalation{}             // Escalation tables
map{}                    // Map widget
layout{}                 // Per-tab ordering: which KPIs/charts/tables appear where
```

Everything under `kpis`, `charts`, `water_quality.parameters`, `progress`, `escalation`, `map`, and `layout.sections` is a **definition** that is rendered only when referenced by `layout` — definitions and layout are separate on purpose. This way you can define a KPI once and reuse it across multiple tabs.

### 3. `tabs` — top navigation

```json
"tabs": [
  { "key": "monitoring_overview", "label": "Monitoring overview", "hide": false },
  { "key": "water_quality",        "label": "Water quality",        "hide": false },
  { "key": "construction_monitoring","label": "Construction monitoring","hide": false }
]
```

Each tab `key` must have a matching entry under `layout.{key}.sections`. Setting `hide: true` removes a tab entirely without touching its layout.

### 4. `filters` — the filter bar

Three parts: `date`, `administration`, `custom[]`.

#### 4.1 `filters.date`

```json
"date": {
  "label": "Monitoring Period",
  "date_question_ids": {
    "water_quality": 1749632545235,
    "construction":  1749624452911
  },
  "fiscal_year_start_month": 7,
  "hide": false
}
```

- `date_question_ids` maps a monitoring form family to the **question** that holds its "inspection date" (or equivalent). The dashboard has two monitoring forms, so each has its own date question. When a KPI/chart queries the water-quality form it sends `date_question_id=1749632545235`; construction queries send `date_question_id=1749624452911`.
- `fiscal_year_start_month: 7` defines July as the fiscal-year anchor for presets like "This fiscal year" (FY runs Jul → Jun). Set it to `1` for calendar-year accounting (Jan → Dec), `4` for India/UK tax year, `10` for US federal fiscal year. This is **frontend-only** — the backend only speaks in absolute `from_date`/`to_date`, so the frontend resolves the preset label into concrete dates before calling the API.

#### 4.2 `filters.administration`

Global admin-hierarchy filter that resolves to an `administration_id` query param sent to every API call. No IDs needed — uses the global admin tree.

#### 4.3 `filters.custom[]`

Free-form filters specific to this dashboard:

```json
{
  "key": "implementing_agency",
  "question_id": 1749624452993,
  "form_id": 1749623934933,
  "label": "Implementing Agency",
  "type": "multiple_option",
  "hide": false
}
```

Custom filters have a `form_id` because they only apply to API calls targeting that form (see "Filter propagation" below).

### 5. `kpis` — tile definitions

Each KPI is a named entry whose `api` block is the exact query-param payload passed to `/visualization/values`. For example:

```json
"under_construction": {
  "label": "Total EPS under construction",
  "color": "#fa8c16",
  "hide": false,
  "api": {
    "form_id": 1749624452908,
    "question_id": 1749630516826,
    "option_value": "no",
    "monitoring": "latest",
    "sum_by": "parent_id"
  }
}
```

Translated: "Hit `/visualization/values?form_id=1749624452908&question_id=1749630516826&option_value=no&monitoring=latest&sum_by=parent_id` and render the single returned number as a tile." The backend logic: count distinct parents whose latest construction answer is `no`.

A few KPIs use frontend-computed extensions (`fiscal_year: true`, `past_due: true`). These are **hints** that the frontend expands into concrete `from_date`/`to_date` or additional filters before calling the API. They are not understood by the backend directly.

### 6. `charts` — chart definitions

Same shape as `kpis` but with a `chart_type` (`doughnut`, `bar`, `line`) and a `config` block that passes through to akvo-charts as chart props. Three variants you will see:

1. **API-driven** (`operational_status`) — has an `api` block; the response is rendered directly.
2. **Composed** (`drinking_water_compliance`) — has `compute: "compliance"` + `compliance_params_ref: "water_quality.parameters"`. The frontend **does not** hit the backend for this chart; it runs each parameter's query and combines results locally.
3. **Cross-referenced** (`construction_progression`) — has `source: "progress"` + `progress_ref: "construction"`, meaning "reuse the histogram computed by `/visualization/progress`, no extra API call."

The chart system uses a **"define once, reference anywhere"** pattern so one computation can drive multiple widgets.

### 7. `water_quality.parameters`

A **list** of water-quality parameters grouped by `microbial` | `physical` | `chemical`. Each parameter is a self-contained bar-chart definition:

```json
{
  "key": "ph",
  "label": "pH",
  "group": "chemical",
  "chart_type": "bar",
  "threshold": { "min": 6.5, "max": 8.5 },
  "api": { ... }
}
```

`threshold` is used in two places:
- **Chart rendering** — draws a threshold line on the bar.
- **Compliance computation** — each parameter contributes to the "drinking water compliance" doughnut (rule: all parameters within threshold = compliant).

Layout sections reference groups via `parameter_grid.group = "microbial"`, which expands into all parameters with matching `group`.

### 8. `progress` — configurable histograms

```json
"progress": {
  "construction": {
    "api": {
      "form_id": 1749623934933,
      "monitoring_form_id": 1749624452908,
      "filter_question_id": 1749630516826,
      "filter_option_value": "no",
      "components": [
        { "key": "concrete_base", "formula": "any_yes", "question_ids": [...] },
        { "key": "urf_tank",      "formula": "completed_binary", "question_ids": [...] },
        { "key": "standpipes",    "formula": "ratio", "question_ids": [...] },
        { "key": "site_security", "formula": "multi_select_proportion", "total_items": 3, "question_ids": [...] },
        { "key": "drainage",      "formula": "completed_binary", "hide": true, "question_ids": [] }
      ]
    }
  }
}
```

This maps directly to `/visualization/progress/{form_id}`. Each component declares a formula:

| Formula | Meaning |
|---|---|
| `any_yes` | 100% if any of the listed questions answered "yes" |
| `completed_binary` | 100% if the single question equals "completed" |
| `ratio` | Percentage from a numeric answer (e.g., implemented/planned) |
| `multi_select_proportion` | Count of selected options ÷ `total_items` × 100 |

The backend loops over the components per parent EPS, averages the enabled ones, and buckets the overall percentage into ten 10% bins. The `drainage` component is `hide: true` because its formula is still being finalized — it stays in the config so it's obvious what's pending without losing the placeholder.

### 9. `escalation` — criteria-driven tables

Two tables (`monitoring` and `construction`), each a declarative list of `criteria` (rows to include) and `columns` (what to render per row).

```json
"criteria": [
  { "type": "option_equals", "question_id": 1749632647507, "value": "no", "label": "No water sample" },
  { "type": "threshold_gt",  "question_id": 1749633220746, "value": 0,    "label": "E.coli above threshold" },
  { "type": "threshold_gt",  "question_id": 1749633220745, "value": 5,    "label": "Turbidity above threshold" }
]
```

The frontend **serializes this list** into the `criteria=` query-param format the backend expects:

```
criteria=option_equals:1749632647507:no,threshold_gt:1749633220746:0,threshold_gt:1749633220745:5
```

A row appears in the table if **any** criterion matches (inclusive OR). Each criterion can carry its own `hide: true` to drop a rule without deleting it — handy for "temporarily relax turbidity threshold during the rainy season".

Columns work the same way: a list of `{ key, source, question_id? }` serialized into a comma-colon string. Supported `source` values: `parent_name`, `administration`, `answer`, `latest_date` (backend), plus frontend-computed sources like `violations`, `computed_progress`, `expected_progress`, `answer_date`.

### 10. `map`

Single-entry block with:
- `source_form_id` — the registration form whose datapoints are plotted (each has `geo` coords),
- `status_question_id` / `status_monitoring_form_id` — the monitoring answer used to color markers,
- `status_colors` — option-value → hex mapping,
- `click_url_template` — where to route on marker click. `{parent_form_id}` and `{data_id}` are replaced at render time.

### 11. `layout` — what shows up and in what order

`layout.{tab_key}.sections[]` is a flat list of section objects. Section `type` values drive a small frontend component registry:

| `type` | What it renders |
|---|---|
| `kpi_row` | A horizontal row of KPI tiles referenced by `kpis[]` string keys |
| `chart_grid` | An N-column grid of charts referenced by `charts[]` string keys |
| `chart` | A single chart referenced by `chart_key` |
| `map` | The map widget |
| `section_title` | A text heading |
| `parameter_grid` | All water-quality parameters matching `group`, laid out in `columns` columns |
| `escalation_table` | Renders `escalation[escalation_key]` |
| `progress_breakdown` | Renders per-component progress bars for a `progress_ref` |

A section's `hide: true` drops it without affecting the underlying definitions — and definitions in `kpis`/`charts`/etc. that nothing references are never rendered. This means you can experiment by adding/removing one string from a layout list instead of touching the definition blocks.

### 12. Filter propagation (how the pieces fit together at runtime)

This is the load-bearing bit. The frontend maintains a global `filterState`:

```js
const filterState = {
  dateRange: [from, to],
  administrationId: 12,
  custom: { implementing_agency: "ngo_a", water_committee: "active" }
};
```

For **every API call**, it builds `params = { ...widget.api, ...commonFilters }`, where `commonFilters` comes from `filterState`. So changing the date picker refetches every widget with the new `from_date`/`to_date`. Custom filters are only merged into calls whose `form_id` matches `filters.custom[].form_id`.

This means: **a widget's `api` block is not a request — it's a template.** The runtime request is `api + commonFilters`.

### 13. The `hide` flag, recap

`hide: true` is the recommended way to disable anything. It is cheap, reversible, and shows intent (e.g., "drainage component is known-missing"). Prefer it over deleting blocks during development or gradual rollout. Per the Known Gaps table at the bottom of this doc, drainage is the current canonical example.

### 14. Adding a new widget — checklist

1. **Pick the API shape** (`/values`, `/escalation/{form_id}`, or `/progress/{form_id}`).
2. **Define it** under the matching top-level key (`kpis`, `charts`, `progress`, `escalation`).
3. **Reference it** in the right `layout.{tab}.sections[]`.
4. **Ship with `hide: true`** if it's experimental.
5. **Remove `hide`** when ready.

No backend work unless the widget genuinely needs a new formula or data source that the generic API can't express — at which point the decision point is either (a) add a new `formula` to `progress_functions.py` + `VALID_PROGRESS_FORMULAS`, or (b) compute it in the frontend using existing API responses.

### 15. What the config does **not** own

- **The data model.** All question IDs must exist in the referenced forms. The config is not a schema.
- **Permissions.** Admin-hierarchy filtering is enforced by the visualization endpoints based on user role, not by the config.
- **Form definitions.** If a question ID changes (e.g., a form is re-seeded), the config must be updated.

---

## Base Requirements Source

This config implements the metrics and queries from the original dashboard plan:

### Common Filters

| Filter | Question ID |
|--------|------------|
| Location | `1749624452990` |
| Monitoring Period | `1749632545235` / `1749624452911` |
| Implementing Agency | `1749624452993` |
| Water Committee | `1749624452105` |

### Key Identifiers

| Field | Question ID |
|-------|------------|
| EPS Name | `1749624452994` |
| Village Name | `1749624452990` |

### Monitoring Overview Metrics

| Metric | Query |
|--------|-------|
| Total EPS Registered | `COUNT(UNIQUE 1749624452994)` |
| EPS Under Construction | `COUNT(UNIQUE 1749630516826 == 'No')` |
| EPS Operational | `COUNT(UNIQUE 1749633373968 == 'Operational')` |
| EPS with Critical Issues | `COUNT(UNIQUE 1749633373968 == 'Issue with the system')` |
| Lab Tested | `COUNT(UNIQUE WHERE 1749633001462 == 'Lab Test')` |
| CBT Tested | `COUNT(UNIQUE WHERE 1749633001462 == 'CBT Test')` |
| EPS Monitored (Last 12 Months) | `COUNT(UNIQUE WHERE 1749632545235 within last 12 months)` |
| No Water Sample | `COUNT(UNIQUE WHERE 1749632647507 == 'No')` |

### EPS at a Glance — Status & Compliance

- **Operational Status**: `1749633373968`
- **Test Type**: `1749633001462`
- **Water Committee**: `1749624452105`
- **Implementing Authority**: `1749624452993`

**Drinking Water Compliance** (all conditions must be met):
- E. coli (`1749633220746`) ≤ 0
- Turbidity (`1749633220745`) ≤ 5
- Coliform (`1749633259392`) ≤ 0
- Fecal coliform (`1749633295165`) ≤ 0
- Temperature (`1797307852531`) ≤ 30
- pH (`1797307852532`): 6.5 ≤ value ≤ 8.5
- Conductivity (`1797307852533`) ≤ 1000
- Salinity (`1797307852534`) ≤ 1 ppt

### Escalation List (Monitoring Tab)

**Inclusion** (any true):
- `1749632647507` == 'No' (no water sample)
- `1749633373968` == 'Issue with the system'
- Any water quality parameter outside threshold

**Columns**: EPS Name, Village Name, Last Monitoring, Operational Status, Water Collection Ability, Critical Quality Issue

### Construction Progress Formulas

| Component | Question IDs | Formula |
|-----------|-------------|---------|
| Concrete Base Construction | `1849633499999`, `1849633498888`, `1849633497777` | 100% if ANY == 'YES' |
| URF Tank | `1849633720001` | 100% if 'Completed', else 0% |
| EPS Tank Installation | `1849633900003` | 100% if 'Completed', else 0% |
| Balance Tank | `1849634300002` | 100% if 'Completed', else 0% |
| Storage Tank | `1849634690001` | 100% if 'Completed', else 0% |
| Standpipes | `1849634900001` | (Implemented ÷ Planned) × 100% |
| Drainage | — | *Pending definition, skip for now* |
| Site Security & Perimeter | `1849635500001` | 33% per item (3 items max) |

**Overall Progress**: Average of enabled components. Scope defined by `1749624505915`.

**Expected Progress**: `(days_elapsed / total_planned_days) × 100`, where elapsed = TODAY − `1749624452910`, total = `1749630516825` − `1749624452910`

### Construction Escalation

**Inclusion**: `1749630516826 == 'No'` AND `1749630516825 < TODAY()`

---

## Design Principles

1. **Frontend-owned config** — no backend config files
2. **Pass-through rendering** — API response matches akvo-charts props
3. **Reusable** — swap JSON to build a dashboard for any form family
4. **Filter propagation** — common filters apply to all API calls
5. **`hide` flag everywhere** — toggle items on/off without removing config entries

---

## The `hide` Property

Every top-level config item (tabs, KPIs, charts, parameters, escalations, layout sections) supports a `hide` boolean. The frontend renders only items where `hide !== true` (default: visible).

**Why**:
- Temporarily disable an item without deleting its definition
- Roll out new metrics gradually (hidden in production until ready)
- A/B test layouts
- Keep historical config while changing what's shown

**Example**:

```json
{
  "kpis": {
    "total_registered": { "hide": false, "label": "...", "api": {...} },
    "experimental_kpi": { "hide": true, "label": "Beta metric", "api": {...} }
  }
}
```

`hide` also works in layout `sections[]`, so you can hide an entire row/table without unregistering the underlying definitions.

---

## Config Structure Overview

```
{
  parent_form_id, name, description,
  tabs: [ { key, label, hide? }, ... ],
  filters: { date, administration, custom: [...] },
  kpis: { [key]: { label, api, hide? } },
  charts: { [key]: { chart_type, config, api, hide? } },
  water_quality: { parameters: [ { ..., hide? } ] },
  progress: { [key]: { api, hide? } },
  escalation: { [tab_key]: { api, columns, hide? } },
  map: { ..., hide? },
  layout: { [tab_key]: { sections: [ { type, ..., hide? }, ... ] } }
}
```

---

## Complete EPS Config

```json
{
  "parent_form_id": 1749623934933,
  "name": "EPS Overview",
  "description": "Overview of EPS sites monitoring, water quality and construction information.",

  "tabs": [
    {
      "key": "monitoring_overview",
      "label": "Monitoring overview",
      "hide": false
    },
    {
      "key": "water_quality",
      "label": "Water quality",
      "hide": false
    },
    {
      "key": "construction_monitoring",
      "label": "Construction monitoring",
      "hide": false
    }
  ],

  "filters": {
    "date": {
      "label": "Monitoring Period",
      "date_question_ids": {
        "water_quality": 1749632545235,
        "construction": 1749624452911
      },
      "fiscal_year_start_month": 7,
      "hide": false
    },
    "administration": {
      "label": "Location",
      "hide": false
    },
    "custom": [
      {
        "key": "implementing_agency",
        "question_id": 1749624452993,
        "form_id": 1749623934933,
        "label": "Implementing Agency",
        "type": "multiple_option",
        "hide": false
      },
      {
        "key": "water_committee",
        "question_id": 1749624452105,
        "form_id": 1749623934933,
        "label": "Water Committee",
        "type": "option",
        "hide": false
      }
    ]
  },

  "kpis": {
    "total_registered": {
      "label": "Total EPS registered",
      "color": "#1890ff",
      "hide": false,
      "api": {
        "form_id": 1749623934933
      }
    },
    "under_construction": {
      "label": "Total EPS under construction",
      "color": "#fa8c16",
      "hide": false,
      "api": {
        "form_id": 1749624452908,
        "question_id": 1749630516826,
        "option_value": "no",
        "monitoring": "latest",
        "sum_by": "parent_id"
      }
    },
    "operational": {
      "label": "Total EPS operational",
      "color": "#64A73B",
      "hide": false,
      "api": {
        "form_id": 1749632545233,
        "question_id": 1749633373968,
        "option_value": "operational",
        "monitoring": "latest",
        "sum_by": "parent_id"
      }
    },
    "critical_issues": {
      "label": "Total EPS with critical issues",
      "color": "#e41a1c",
      "hide": false,
      "api": {
        "form_id": 1749632545233,
        "question_id": 1749633373968,
        "option_value": "issue_with_system",
        "monitoring": "latest",
        "sum_by": "parent_id"
      }
    },
    "monitored_fiscal_year": {
      "label": "EPS monitored last 12 months",
      "hide": false,
      "api": {
        "form_id": 1749632545233,
        "monitoring": "latest",
        "sum_by": "parent_id",
        "value_type": "percentage",
        "date_question_id": 1749632545235,
        "fiscal_year": true
      }
    },
    "no_water_sample": {
      "label": "EPS where water sample collection was not possible",
      "hide": false,
      "api": {
        "form_id": 1749632545233,
        "question_id": 1749632647507,
        "option_value": "no",
        "monitoring": "latest",
        "sum_by": "parent_id"
      }
    },
    "water_sample_fiscal_year": {
      "label": "EPS with water sample taken last 12 months",
      "hide": false,
      "api": {
        "form_id": 1749632545233,
        "question_id": 1749632647507,
        "option_value": "yes",
        "monitoring": "latest",
        "sum_by": "parent_id",
        "value_type": "percentage",
        "fiscal_year": true
      }
    },
    "lab_tested": {
      "label": "Lab tested EPS",
      "hide": false,
      "api": {
        "form_id": 1749632545233,
        "question_id": 1749633001462,
        "option_value": "lab_test",
        "monitoring": "latest",
        "sum_by": "parent_id"
      }
    },
    "cbt_tested": {
      "label": "CBT tested EPS",
      "hide": false,
      "api": {
        "form_id": 1749632545233,
        "question_id": 1749633001462,
        "option_value": "cbt_test",
        "monitoring": "latest",
        "sum_by": "parent_id"
      }
    },
    "construction_past_due": {
      "label": "EPS with a past-due completion date",
      "hide": false,
      "api": {
        "form_id": 1749624452908,
        "monitoring": "latest",
        "sum_by": "parent_id",
        "past_due": true,
        "completion_question_id": 1749630516826,
        "deadline_question_id": 1749630516825
      }
    }
  },

  "charts": {
    "operational_status": {
      "chart_type": "doughnut",
      "hide": false,
      "config": { "title": "Operational Status" },
      "api": {
        "form_id": 1749632545233,
        "question_id": 1749633373968,
        "group_by": "option",
        "monitoring": "latest"
      }
    },
    "drinking_water_compliance": {
      "chart_type": "doughnut",
      "hide": false,
      "config": {
        "title": "Drinking Water Compliance",
        "color": ["#64A73B", "#e41a1c", "#cccccc"]
      },
      "compute": "compliance",
      "compliance_params_ref": "water_quality.parameters"
    },
    "water_committee": {
      "chart_type": "doughnut",
      "hide": false,
      "config": { "title": "Water Committee" },
      "api": {
        "form_id": 1749623934933,
        "question_id": 1749624452105,
        "group_by": "option"
      }
    },
    "implementing_authority": {
      "chart_type": "doughnut",
      "hide": false,
      "config": { "title": "Implementing Authority" },
      "api": {
        "form_id": 1749623934933,
        "question_id": 1749624452993,
        "group_by": "option"
      }
    },
    "test_method": {
      "chart_type": "doughnut",
      "hide": false,
      "config": { "title": "Lab tested vs CBT tested" },
      "api": {
        "form_id": 1749632545233,
        "question_id": 1749633001462,
        "group_by": "option",
        "monitoring": "latest"
      }
    },
    "inspections_per_month": {
      "chart_type": "bar",
      "hide": false,
      "config": {
        "title": "Inspections per Month over Last Year",
        "xAxisLabel": "Month",
        "yAxisLabel": "Count"
      },
      "api": {
        "form_id": 1749632545233,
        "group_by": "month",
        "date_question_id": 1749632545235,
        "monitoring": "all",
        "fiscal_year": true
      }
    },
    "construction_progression": {
      "chart_type": "bar",
      "hide": false,
      "config": {
        "title": "Percentage of projects completed",
        "xAxisLabel": "Progress",
        "yAxisLabel": "Number of EPS"
      },
      "source": "progress",
      "progress_ref": "construction",
      "field": "histogram"
    },
    "proposed_completion_timeline": {
      "chart_type": "bar",
      "hide": false,
      "config": {
        "title": "Proposed completion date",
        "xAxisLabel": "Month",
        "yAxisLabel": "Number of EPS"
      },
      "api": {
        "form_id": 1749624452908,
        "group_by": "month",
        "date_question_id": 1749630516825,
        "monitoring": "latest"
      },
      "raw_config": {
        "series": [{
          "type": "bar",
          "markLine": {
            "silent": true,
            "data": [{ "xAxis": "TODAY", "name": "Today" }],
            "lineStyle": { "color": "#1890ff", "width": 2 }
          }
        }]
      }
    }
  },

  "water_quality": {
    "sample_question_id": 1749632647507,
    "test_method_question_id": 1749633001462,
    "monitoring_form_id": 1749632545233,
    "parameters": [
      {
        "key": "e_coli",
        "label": "E-coli presence",
        "group": "microbial",
        "chart_type": "bar",
        "hide": false,
        "config": {
          "title": "E-coli presence",
          "xAxisLabel": "EPS",
          "yAxisLabel": "CFU/100ml"
        },
        "threshold": { "max": 0 },
        "api": {
          "form_id": 1749632545233,
          "question_id": 1749633220746,
          "group_by": "parent_id",
          "monitoring": "latest",
          "repeat_agg": "average"
        }
      },
      {
        "key": "total_coliform",
        "label": "Total coliform presence",
        "group": "microbial",
        "chart_type": "bar",
        "hide": false,
        "config": {
          "title": "Total coliform presence",
          "xAxisLabel": "EPS",
          "yAxisLabel": "CFU/100ml"
        },
        "threshold": { "max": 0 },
        "api": {
          "form_id": 1749632545233,
          "question_id": 1749633259392,
          "group_by": "parent_id",
          "monitoring": "latest",
          "repeat_agg": "average"
        }
      },
      {
        "key": "fecal_coliform",
        "label": "Fecal coliform presence",
        "group": "microbial",
        "chart_type": "bar",
        "hide": false,
        "config": {
          "title": "Fecal coliform presence",
          "xAxisLabel": "EPS",
          "yAxisLabel": "CFU/100ml"
        },
        "threshold": { "max": 0 },
        "api": {
          "form_id": 1749632545233,
          "question_id": 1749633295165,
          "group_by": "parent_id",
          "monitoring": "latest",
          "repeat_agg": "average"
        }
      },
      {
        "key": "turbidity",
        "label": "Turbidity",
        "group": "physical",
        "chart_type": "bar",
        "hide": false,
        "config": {
          "title": "Turbidity",
          "xAxisLabel": "EPS",
          "yAxisLabel": "NTU"
        },
        "threshold": { "max": 5 },
        "api": {
          "form_id": 1749632545233,
          "question_id": 1749633220745,
          "group_by": "parent_id",
          "monitoring": "latest",
          "repeat_agg": "average"
        }
      },
      {
        "key": "temperature",
        "label": "Water Temperature",
        "group": "physical",
        "chart_type": "bar",
        "hide": false,
        "config": {
          "title": "Water Temperature",
          "xAxisLabel": "EPS",
          "yAxisLabel": "°C"
        },
        "threshold": { "max": 30 },
        "api": {
          "form_id": 1749632545233,
          "question_id": 1797307852531,
          "group_by": "parent_id",
          "monitoring": "latest",
          "repeat_agg": "average"
        }
      },
      {
        "key": "ph",
        "label": "pH",
        "group": "chemical",
        "chart_type": "bar",
        "hide": false,
        "config": {
          "title": "pH",
          "xAxisLabel": "EPS",
          "yAxisLabel": ""
        },
        "threshold": { "min": 6.5, "max": 8.5 },
        "api": {
          "form_id": 1749632545233,
          "question_id": 1797307852532,
          "group_by": "parent_id",
          "monitoring": "latest",
          "repeat_agg": "average"
        }
      },
      {
        "key": "conductivity",
        "label": "Conductivity",
        "group": "chemical",
        "chart_type": "bar",
        "hide": false,
        "config": {
          "title": "Conductivity",
          "xAxisLabel": "EPS",
          "yAxisLabel": "µS/cm"
        },
        "threshold": { "max": 1000 },
        "api": {
          "form_id": 1749632545233,
          "question_id": 1797307852533,
          "group_by": "parent_id",
          "monitoring": "latest",
          "repeat_agg": "average"
        }
      },
      {
        "key": "salinity",
        "label": "Salinity",
        "group": "chemical",
        "chart_type": "bar",
        "hide": false,
        "config": {
          "title": "Salinity",
          "xAxisLabel": "EPS",
          "yAxisLabel": "PPT"
        },
        "threshold": { "max": 1 },
        "api": {
          "form_id": 1749632545233,
          "question_id": 1797307852534,
          "group_by": "parent_id",
          "monitoring": "latest",
          "repeat_agg": "average"
        }
      }
    ]
  },

  "progress": {
    "construction": {
      "label": "Construction progress",
      "hide": false,
      "start_date_question_id": 1749624452910,
      "deadline_question_id": 1749630516825,
      "scope_question_id": 1749624505915,
      "api": {
        "form_id": 1749623934933,
        "monitoring_form_id": 1749624452908,
        "filter_question_id": 1749630516826,
        "filter_option_value": "no",
        "components": [
          {
            "key": "concrete_base",
            "label": "Concrete Base Construction",
            "formula": "any_yes",
            "hide": false,
            "question_ids": [1849633499999, 1849633498888, 1849633497777]
          },
          {
            "key": "urf_tank",
            "label": "URF Tank",
            "formula": "completed_binary",
            "hide": false,
            "question_ids": [1849633720001]
          },
          {
            "key": "eps_tank",
            "label": "EPS Tank Installation",
            "formula": "completed_binary",
            "hide": false,
            "question_ids": [1849633900003]
          },
          {
            "key": "balance_tank",
            "label": "Balance Tank",
            "formula": "completed_binary",
            "hide": false,
            "question_ids": [1849634300002]
          },
          {
            "key": "storage_tank",
            "label": "Storage Tank",
            "formula": "completed_binary",
            "hide": false,
            "question_ids": [1849634690001]
          },
          {
            "key": "standpipes",
            "label": "Standpipes",
            "formula": "ratio",
            "hide": false,
            "question_ids": [1849634900001]
          },
          {
            "key": "drainage",
            "label": "Drainage",
            "formula": "completed_binary",
            "hide": true,
            "question_ids": [],
            "note": "Formula pending definition"
          },
          {
            "key": "site_security",
            "label": "Site Security & Perimeter",
            "formula": "multi_select_proportion",
            "total_items": 3,
            "hide": false,
            "question_ids": [1849635500001]
          }
        ]
      }
    }
  },

  "escalation": {
    "monitoring": {
      "label": "Escalation List",
      "description": "This table shows all EPS where water quality variables are not within the acceptable range or issues with the system were found.",
      "hide": false,
      "api": {
        "form_id": 1749623934933,
        "monitoring_form_id": 1749632545233,
        "criteria": [
          {
            "type": "option_equals",
            "question_id": 1749632647507,
            "value": "no",
            "label": "No water sample",
            "hide": false
          },
          {
            "type": "option_equals",
            "question_id": 1749633373968,
            "value": "issue_with_system",
            "label": "System issue",
            "hide": false
          },
          {
            "type": "threshold_gt",
            "question_id": 1749633220746,
            "value": 0,
            "label": "E.coli above threshold",
            "hide": false
          },
          {
            "type": "threshold_gt",
            "question_id": 1749633259392,
            "value": 0,
            "label": "Total coliform above threshold",
            "hide": false
          },
          {
            "type": "threshold_gt",
            "question_id": 1749633295165,
            "value": 0,
            "label": "Fecal coliform above threshold",
            "hide": false
          },
          {
            "type": "threshold_gt",
            "question_id": 1749633220745,
            "value": 5,
            "label": "Turbidity above threshold",
            "hide": false
          },
          {
            "type": "threshold_gt",
            "question_id": 1797307852531,
            "value": 30,
            "label": "Temperature above threshold",
            "hide": false
          },
          {
            "type": "threshold_gt",
            "question_id": 1797307852533,
            "value": 1000,
            "label": "Conductivity above threshold",
            "hide": false
          },
          {
            "type": "threshold_gt",
            "question_id": 1797307852534,
            "value": 1,
            "label": "Salinity above threshold",
            "hide": false
          }
        ]
      },
      "columns": [
        { "key": "eps_name", "label": "EPS name", "source": "answer", "question_id": 1749624452994, "hide": false },
        { "key": "village_name", "label": "Village Name", "source": "answer", "question_id": 1749624452990, "hide": false },
        { "key": "last_monitoring", "label": "Last Monitoring", "source": "latest_date", "question_id": 1749632545235, "hide": false },
        { "key": "operational_status", "label": "Operational Status", "source": "answer", "question_id": 1749633373968, "hide": false },
        { "key": "water_collection", "label": "Not able to collect the water sample", "source": "answer", "question_id": 1749632647507, "hide": false },
        { "key": "critical_issues", "label": "Critical water quality issues", "source": "violations", "hide": false }
      ]
    },
    "construction": {
      "label": "Overdue Construction List",
      "description": "This table shows all EPS where the percentage of project completion is not in line with the expected project progress.",
      "hide": false,
      "api": {
        "form_id": 1749623934933,
        "monitoring_form_id": 1749624452908,
        "criteria": [
          {
            "type": "overdue",
            "completion_qid": 1749630516826,
            "deadline_qid": 1749630516825,
            "hide": false
          }
        ]
      },
      "columns": [
        { "key": "eps_name", "label": "EPS name", "source": "answer", "question_id": 1749624452994, "hide": false },
        { "key": "last_monitoring", "label": "Last Monitoring", "source": "latest_date", "question_id": 1749624452911, "hide": false },
        { "key": "overall_progress", "label": "Progress", "source": "computed_progress", "progress_ref": "construction", "hide": false },
        { "key": "expected_progress", "label": "Expected progress", "source": "expected_progress", "progress_ref": "construction", "hide": false },
        { "key": "deadline", "label": "Deadline", "source": "answer_date", "question_id": 1749630516825, "hide": false }
      ]
    }
  },

  "map": {
    "hide": false,
    "source_form_id": 1749623934933,
    "status_question_id": 1749633373968,
    "status_monitoring_form_id": 1749632545233,
    "status_colors": {
      "operational": "#64A73B",
      "issue_with_system": "#e41a1c"
    },
    "click_action": "navigate",
    "click_url_template": "/control-center/data/{parent_form_id}/monitoring/{data_id}"
  },

  "layout": {
    "monitoring_overview": {
      "sections": [
        {
          "type": "kpi_row",
          "hide": false,
          "kpis": [
            "total_registered",
            "under_construction",
            "operational",
            "critical_issues"
          ]
        },
        { "type": "map", "height": 400, "hide": false },
        {
          "type": "section_title",
          "text": "EPS at-a-glance: Status and Compliance",
          "hide": false
        },
        {
          "type": "chart_grid",
          "columns": 3,
          "hide": false,
          "charts": [
            "operational_status",
            "drinking_water_compliance",
            "water_committee",
            "implementing_authority",
            "test_method"
          ]
        },
        {
          "type": "kpi_row",
          "hide": false,
          "kpis": [
            "monitored_fiscal_year",
            "critical_issues",
            "no_water_sample"
          ]
        },
        {
          "type": "escalation_table",
          "escalation_key": "monitoring",
          "hide": false
        },
        {
          "type": "chart",
          "chart_key": "inspections_per_month",
          "hide": false
        }
      ]
    },
    "water_quality": {
      "sections": [
        {
          "type": "kpi_row",
          "hide": false,
          "kpis": [
            "water_sample_fiscal_year",
            "lab_tested",
            "cbt_tested"
          ]
        },
        {
          "type": "section_title",
          "text": "Microbial Parameters",
          "hide": false
        },
        {
          "type": "parameter_grid",
          "group": "microbial",
          "columns": 2,
          "hide": false
        },
        {
          "type": "section_title",
          "text": "Physical Parameters",
          "hide": false
        },
        {
          "type": "parameter_grid",
          "group": "physical",
          "columns": 2,
          "hide": false
        },
        {
          "type": "section_title",
          "text": "Chemical Parameters",
          "hide": false
        },
        {
          "type": "parameter_grid",
          "group": "chemical",
          "columns": 3,
          "hide": false
        }
      ]
    },
    "construction_monitoring": {
      "sections": [
        {
          "type": "kpi_row",
          "hide": false,
          "kpis": ["under_construction", "construction_past_due"]
        },
        {
          "type": "chart_row",
          "hide": false,
          "charts": [
            "construction_progression",
            "proposed_completion_timeline"
          ]
        },
        {
          "type": "escalation_table",
          "escalation_key": "construction",
          "hide": false
        }
      ]
    }
  }
}
```

---

## Frontend Rendering Rules

### Hide Logic

Before rendering, the frontend filters out any item with `hide === true`:

```js
// Tabs
const visibleTabs = config.tabs.filter(t => !t.hide);

// KPIs referenced in a section
const renderKpi = (key) => {
  const kpi = config.kpis[key];
  if (!kpi || kpi.hide) return null;
  return <KPICard config={kpi} />;
};

// Charts
const renderChart = (key) => {
  const chart = config.charts[key];
  if (!chart || chart.hide) return null;
  return <ChartRenderer config={chart} />;
};

// Water quality parameters by group
const renderParamGrid = (group) => {
  const params = config.water_quality.parameters
    .filter(p => p.group === group && !p.hide);
  return params.map(p => <ParameterChart config={p} />);
};

// Layout sections
const renderSection = (section) => {
  if (section.hide) return null;
  switch (section.type) { /* ... */ }
};

// Escalation criteria — only active ones go into the URL
const activeCriteria = esc.api.criteria
  .filter(c => !c.hide)
  .map(formatCriterion)
  .join(",");

// Escalation columns — only visible ones
const visibleColumns = esc.columns.filter(c => !c.hide);

// Progress components — only enabled ones counted in overall
const activeComponents = prog.api.components.filter(c => !c.hide);
```

---

## How the Frontend Consumes This Config

### 1. KPI Card — `total_registered`

```
const kpi = config.kpis.total_registered;
if (kpi.hide) return null;

const params = { ...kpi.api, ...commonFilters };
const url = buildQueryString("/api/v1/visualization/values", params);

fetch(url) → { data: [{ value: 150, label: "Total" }], labels: ["Total"] }

render: <Statistic title={kpi.label} value={response.data[0].value} />
```

### 2. Doughnut Chart — `operational_status`

```
const chart = config.charts.operational_status;
if (chart.hide) return null;

const params = { ...chart.api, ...commonFilters };
const url = buildQueryString("/api/v1/visualization/values", params);

fetch(url) → {
  data: [
    { value: 90, label: "Operational", group: "operational", color: "#64A73B" },
    { value: 20, label: "Issue with the system", group: "issue_with_system", color: "#e41a1c" }
  ],
  labels: ["Operational", "Issue with the system"]
}

render:
  <Doughnut
    config={{
      ...chart.config,
      color: response.data.map(d => d.color)
    }}
    data={response.data.map(d => ({ name: d.label, value: d.value }))}
  />
```

### 3. Water Quality Parameter — `e_coli`

```
const param = config.water_quality.parameters.find(p => p.key === "e_coli");
if (!param || param.hide) return null;

const params = { ...param.api, ...commonFilters };
const url = buildQueryString("/api/v1/visualization/values", params);

fetch(url) → {
  data: [
    { value: 0, label: "EPS Navua", group: "245170944" },
    { value: 3.5, label: "EPS Sigatoka", group: "245170945" }
  ],
  labels: ["EPS Navua", "EPS Sigatoka"]
}

const rawConfig = buildThresholdRawConfig(param.threshold, param.config.yAxisLabel);

render:
  <Bar
    config={param.config}
    data={response.data.map(d => ({ eps: d.label, value: d.value }))}
    rawConfig={rawConfig}
  />
```

### 4. Escalation Table — `monitoring` tab

```
const esc = config.escalation.monitoring;
if (esc.hide) return null;

// Only active criteria go to the API
const criteriaStr = esc.api.criteria
  .filter(c => !c.hide)
  .map(formatCriterion)
  .join(",");

// Only visible columns
const visibleColumns = esc.columns.filter(c => !c.hide);
const columnsStr = visibleColumns.map(formatColumn).join(",");

const url = buildQueryString(
  `/api/v1/visualization/escalation/${esc.api.form_id}`,
  {
    monitoring_form_id: esc.api.monitoring_form_id,
    criteria: criteriaStr,
    columns: columnsStr,
    page: currentPage,
    page_size: 20,
    ...commonFilters
  }
);

fetch(url) → { count, next, previous, results: [...] }

render:
  <Table
    columns={visibleColumns.map(c => ({ title: c.label, dataIndex: c.key }))}
    dataSource={response.results}
    pagination={{ total: response.count, pageSize: 20 }}
  />
```

### 5. Construction Progress

```
const prog = config.progress.construction;
if (prog.hide) return null;

// Only active components go into the API call
const activeComponents = prog.api.components.filter(c => !c.hide);
const componentsStr = activeComponents.map(formatComponent).join(",");

const url = buildQueryString(
  `/api/v1/visualization/progress/${prog.api.form_id}`,
  {
    monitoring_form_id: prog.api.monitoring_form_id,
    components: componentsStr,
    filter_question_id: prog.api.filter_question_id,
    filter_option_value: prog.api.filter_option_value,
    ...commonFilters
  }
);

fetch(url) → { histogram: [...], details: [...] }

// Histogram chart
<Bar
  config={config.charts.construction_progression.config}
  data={response.histogram.map(h => ({ bucket: h.progress, count: h.count }))}
/>
```

### 6. Compliance Doughnut (frontend computed)

```
// Fetch all non-hidden water quality parameter values in parallel
const params = config.water_quality.parameters.filter(p => !p.hide);
const allResponses = await Promise.all(
  params.map(p => fetch(
    buildQueryString("/api/v1/visualization/values", {
      ...p.api,
      ...commonFilters
    })
  ))
);

// Group by EPS, check each parameter against its threshold
const epsCompliance = {};
allResponses.forEach((response, idx) => {
  const param = params[idx];
  response.data.forEach(row => {
    const epsId = row.group;
    if (!epsCompliance[epsId]) {
      epsCompliance[epsId] = { compliant: true, violations: [] };
    }
    if (!checkThreshold(row.value, param.threshold)) {
      epsCompliance[epsId].compliant = false;
      epsCompliance[epsId].violations.push(param.label);
    }
  });
});

const counts = {
  compliant: Object.values(epsCompliance).filter(e => e.compliant).length,
  non_compliant: Object.values(epsCompliance).filter(e => !e.compliant).length,
  no_data: totalRegistered - Object.keys(epsCompliance).length
};

render:
  <Doughnut
    config={config.charts.drinking_water_compliance.config}
    data={[
      { name: "Compliant", value: counts.compliant },
      { name: "Non-compliant", value: counts.non_compliant },
      { name: "No data", value: counts.no_data }
    ]}
  />
```

### 7. Expected Progress (frontend computed)

For each EPS row in the construction escalation list:

```
const today = new Date();
const startDate = new Date(startDateAnswer);  // from 1749624452910
const deadline = new Date(deadlineAnswer);    // from 1749630516825

const daysElapsed = (today - startDate) / (1000 * 60 * 60 * 24);
const totalPlannedDays = (deadline - startDate) / (1000 * 60 * 60 * 24);
const expectedProgress = Math.min(
  (daysElapsed / totalPlannedDays) * 100,
  100
);
```

---

## Filter Propagation

All API calls automatically include common filters from the filter bar:

```
const commonFilters = {
  from_date: filterState.dateRange[0],
  to_date: filterState.dateRange[1],
  administration_id: filterState.administrationId,
};

// For each API call:
const params = { ...chart.api, ...commonFilters };
```

**Custom filters** (`implementing_agency`, `water_committee`) only apply to API calls where the `form_id` matches `filters.custom[].form_id`. The frontend config layer handles this mapping.

---

## File Location

```
frontend/src/pages/dashboard/configs/
└── 1749623934933.json
```

Registry:

```
// frontend/src/pages/dashboard/configs/index.js
import epsConfig from "./1749623934933.json";

export const dashboardConfigs = {
  1749623934933: epsConfig,
};

export const getDashboardConfig = (formId) =>
  dashboardConfigs[formId] || null;
```

---

## Reusability

To add a dashboard for a new form family:

1. Create `frontend/src/pages/dashboard/configs/{formId}.json`
2. Copy the EPS config as a template
3. Replace `parent_form_id`, monitoring form IDs, and all question IDs
4. Adjust `tabs`, `kpis`, `charts`, `progress`, `escalation`, and `layout` sections
5. Use `hide: true` to temporarily disable items during incremental rollout
6. Register in `configs/index.js`

**Zero backend code changes** — the generic API serves any form family.

---

## Known Gaps

| Item | Status |
|------|--------|
| Drainage component progress formula | **Pending definition** — `hide: true` in config until spec is final |
| "Fiscal year" exact start month | **Configurable** via `filters.date.fiscal_year_start_month` (default July) |
| Compliance doughnut colors | Derived from config; validate against design mockup on implementation |
| EPS name column source | Uses answer to `1749624452994` rather than parent datapoint name |
