# Frontend Visualization Config Context

This document explains how the frontend uses visualization configs and how the new materialized views enable simpler, more readable configurations.

---

## Current Dashboard Config Structure

Dashboards are defined in `frontend/src/config/visualizations/` as JSON files.

### Basic Structure

```json
{
  "parent_form_id": 1749623934933,
  "slug": "eps-overview",
  "name": "EPS Overview",
  "items": [
    {
      "id": "unique-chart-id",
      "chart_type": "card|doughnut|bar|table|...",
      "api": {
        "form_id": 1749621962296,
        "question_id": 1749621851234,
        "monitoring": "latest",
        "group_by": "option"
      }
    }
  ]
}
```

### Common API Parameters

| Parameter | Values | Description |
|-----------|--------|-------------|
| `form_id` | number | Target form (registration or monitoring) |
| `question_id` | number | Question to aggregate |
| `group_by` | `option`, `parent_id`, `month`, `date` | How to group results |
| `stack_by` | `option`, `parent_id` | How to stack bar charts |
| `monitoring` | `latest`, `all` | Use latest submission or all |
| `sum_by` | `id`, `parent_id` | Count submissions or unique parents |
| `include_unanswered` | boolean | Include "No info" bucket |
| `include_empty` | boolean | Include parents with no monitoring |

---

## Frontend Compute Patterns

The frontend uses these patterns to combine multiple API calls:

### 1. cross_tab (Joins two questions)

Joins data from two different questions/forms by `parent_id`.

```json
{
  "id": "project-type-by-agency",
  "chart_type": "bar",
  "compute": "cross_tab",
  "category_api": {
    "form_id": 1749621962296,
    "question_id": 1749621851234,
    "monitoring": "latest",
    "group_by": "parent_id",
    "stack_by": "option"
  },
  "series_api": {
    "form_id": 1749621221728,
    "question_id": 1749622571775,
    "group_by": "parent_id",
    "stack_by": "option"
  }
}
```

**How it works**: Frontend calls both APIs, joins results on `parent_id`, creates cross-tabulation.

### 2. compliance (Water quality params)

Fans out to multiple questions with threshold checks.

```json
{
  "id": "water-quality-compliance",
  "chart_type": "compliance",
  "compute": "compliance",
  "params_ref": ["param_e_coli", "param_turbidity", "param_ph"],
  "globals_ref": "wq_globals",
  "include_unanswered": true
}
```

Where `wq_globals` defines thresholds:

```json
{
  "wq_globals": {
    "param_e_coli": {
      "form_id": 123,
      "question_id": 456,
      "threshold": 0,
      "operator": "lte"
    },
    "param_ph": {
      "form_id": 123,
      "question_id": 789,
      "min": 6.5,
      "max": 8.5
    }
  }
}
```

### 3. kpi_stack (Independent metrics)

Multiple independent metrics displayed together.

```json
{
  "id": "key-metrics",
  "chart_type": "kpi_stack",
  "items": [
    { "api": { "form_id": 123, "question_id": 456, "option_value": "yes" } },
    { "api": { "form_id": 123, "question_id": 789, "option_value": "functional" } }
  ]
}
```

### 4. progress_definition (Multi-component formulas)

Complex formulas combining multiple questions.

```json
{
  "id": "construction-progress",
  "chart_type": "progress_definition",
  "components": [
    {
      "key": "concrete_base",
      "formula": "any_yes",
      "question_ids": [101, 102, 103]
    },
    {
      "key": "standpipes",
      "formula": "ratio",
      "question_ids": [201, 202]
    },
    {
      "key": "site_security",
      "formula": "multi_select_proportion",
      "total_items": 3,
      "question_ids": [301]
    }
  ]
}
```

---

## Problem: Hard-to-Read Configs

Current configs use numeric IDs that are difficult to understand:

```json
{
  "form_id": 1749621962296,
  "question_id": 1749621851234,
  "monitoring": "latest"
}
```

**Issues**:
1. Developers can't tell what `1749621851234` means without looking it up
2. If a question is renamed or recreated, config breaks
3. Can't easily query across forms with same-named questions

---

## Future: question_name Parameter

With `mv_cross_form_latest`, we can support human-readable configs:

```json
{
  "question_name": "ph",
  "monitoring": "latest"
}
```

**Benefits**:
1. Instantly readable - everyone knows what "ph" means
2. Works across multiple monitoring forms automatically
3. More resilient to form changes

### How It Works

1. Registration "Water Point Alpha" has two monitoring forms:
   - Quick Monitoring (form_id=10): has `ph` question
   - Comprehensive Monitoring (form_id=11): has `ph` question

2. Query: `question_name=ph&monitoring=latest`

3. Backend uses `mv_cross_form_latest`:
   ```sql
   SELECT parent_id, latest_numeric_value as ph
   FROM mv_cross_form_latest
   WHERE question_name = 'ph';
   ```

4. Returns most recent pH from ANY form, not a specific form

### Migration Path

| Phase | Config Style | Backend Support |
|-------|--------------|-----------------|
| Current | `form_id` + `question_id` | Existing queries |
| Phase 1 | Both supported | MVs + fallback |
| Future | `question_name` preferred | MV-only for cross-form |

---

## Key Insight for MV Design

**Most aggregations use `group_by=parent_id`**

This is why the MVs are designed to pre-compute at the parent level:

- `mv_latest_monitoring`: indexed by `parent_id`
- `mv_cross_form_latest`: grouped by `(parent_id, question_name)`
- `mv_parent_aggregates`: grouped by `(parent_id, form_id, question_id)`

---

## Example: Simplifying a Real Config

### Before (current)

```json
{
  "id": "ph-compliance",
  "chart_type": "doughnut",
  "api": {
    "form_id": 1749621962296,
    "question_id": 1749621851234,
    "monitoring": "latest",
    "group_by": "option",
    "criteria": "threshold_gte:1749621851234:6.5,threshold_lte:1749621851234:8.5"
  }
}
```

### After (with question_name support)

```json
{
  "id": "ph-compliance",
  "chart_type": "doughnut",
  "api": {
    "question_name": "ph",
    "monitoring": "latest",
    "group_by": "option",
    "threshold": { "min": 6.5, "max": 8.5 }
  }
}
```

---

## Reference: Config File Locations

```
frontend/src/config/visualizations/
├── README.md                 # Config documentation
├── eps-overview.json         # EPS dashboard
├── rws-overview.json         # RWS dashboard
└── ...
```

Each JSON file defines one dashboard with multiple chart items.
