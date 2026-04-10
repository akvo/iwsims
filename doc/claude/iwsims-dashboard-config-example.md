# IWSIMS Dashboard Config — EPS Example

Frontend dashboard configuration for the IWSIMS EPS form family. Consumes the generic visualization API defined in [generic-visualization-api-spec.md](generic-visualization-api-spec.md).

**Form family**: EPS (Effective Protection System)
- Registration form: `1749623934933`
- Water Quality monitoring: `1749632545233`
- Construction monitoring: `1749624452908`

**Target route**: `/dashboard/1749623934933`

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
