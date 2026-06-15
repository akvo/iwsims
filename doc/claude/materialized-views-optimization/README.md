# Materialized Views for Visualization API Optimization

## Problem Statement

The visualization API (`v1_visualization`) has expensive query patterns:

| Issue | Impact | Current Behavior |
|-------|--------|------------------|
| Latest monitoring subquery | CRITICAL | Correlated subquery runs for every parent registration |
| Multi-criteria filtering | HIGH | Each criterion requires separate Answers query + Python set intersection |
| Stack by parent | HIGH | N+1 pattern: P parents × M options = many queries |

## Solution

Add 4 new materialized views that pre-compute expensive operations:

| View | Purpose | Speedup |
|------|---------|---------|
| `mv_latest_monitoring` | Pre-compute latest monitoring per parent | 10-50x |
| `mv_answer_denormalized` | Pre-join answers with data/question | 5-20x |
| `mv_cross_form_latest` | Cross-form aggregation by question name | New feature |
| `mv_parent_aggregates` | Pre-aggregate option counts per parent | 5-10x |

## Task Execution Order

```
Task 1 ──→ Task 2 ──→ Task 3 ──→ Task 4
(Migration)  (Models)  (Refresh)  (Queries)
```

**Important**: Tasks must be done in order. Each task depends on the previous one.

## Tasks

| Task | File | Description | Effort |
|------|------|-------------|--------|
| [Task 1](./task-1-create-migration.md) | `migrations/0002_*.py` | Create materialized views with SQL | Medium |
| [Task 2](./task-2-add-django-models.md) | `models.py` | Add Django ORM models for MVs | Easy |
| [Task 3](./task-3-update-refresh-function.md) | `functions.py` | Update refresh to include all views | Easy |
| [Task 4](./task-4-optimize-query-functions.md) | `functions.py`, `values_functions.py` | Rewrite queries to use MVs | Medium |

## Reference Documentation

| Document | Description |
|----------|-------------|
| [Materialized Views Reference](./materialized-views-reference.md) | Schema, example data, queries, and Django ORM usage for each view |

## Quick Start

After completing all tasks:

```bash
# 1. Run migration
./dc.sh exec backend python manage.py migrate v1_visualization

# 2. Refresh views (populate with data)
./dc.sh exec backend python manage.py shell -c "
from api.v1.v1_visualization.functions import refresh_materialized_data
refresh_materialized_data()
"

# 3. Run tests
./dc.sh exec backend python manage.py test api.v1.v1_visualization

# 4. Verify views have data
./dc.sh exec backend python manage.py dbshell -c "
SELECT 'mv_latest_monitoring' as view, COUNT(*) FROM mv_latest_monitoring
UNION ALL SELECT 'mv_answer_denormalized', COUNT(*) FROM mv_answer_denormalized
UNION ALL SELECT 'mv_cross_form_latest', COUNT(*) FROM mv_cross_form_latest
UNION ALL SELECT 'mv_parent_aggregates', COUNT(*) FROM mv_parent_aggregates;
"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API Request                              │
│   GET /visualization/values?monitoring=latest&...           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Query Layer                                │
│   Before: latest_monitoring_subquery() [correlated]         │
│   After:  MVLatestMonitoring.objects.filter() [indexed]     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               Materialized Views                             │
│   ┌─────────────────┐  ┌─────────────────────────────┐      │
│   │mv_latest_       │  │mv_answer_denormalized       │      │
│   │monitoring       │  │(pre-joined answer+question) │      │
│   └─────────────────┘  └─────────────────────────────┘      │
│   ┌─────────────────┐  ┌─────────────────────────────┐      │
│   │mv_cross_form_   │  │mv_parent_aggregates         │      │
│   │latest           │  │(pre-computed counts)        │      │
│   └─────────────────┘  └─────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Base Tables                                │
│   data, answer, question, form                               │
└─────────────────────────────────────────────────────────────┘
```

## Refresh Strategy

Views are refreshed:
- After data approval (`seed_approved_data()` in `tasks.py`)
- Can be manually triggered via management command or shell

```python
# Non-blocking refresh (production)
refresh_materialized_data(concurrent=True)

# Refresh specific view only
refresh_materialized_data(views=['mv_latest_monitoring'])
```

## Trade-offs

| Aspect | Benefit | Cost |
|--------|---------|------|
| Query Performance | 10-100x faster | Slight overhead on write path |
| Data Freshness | Updated after approval | Up to seconds stale during traffic |
| Storage | N/A | ~10-20% additional for MVs + indexes |
| Code Complexity | Simpler query logic | Additional migration/maintenance |

## Future Enhancements

1. **`question_name` API parameter**: Allow queries by question name instead of ID
   ```
   GET /visualization/values?question_name=ph&monitoring=latest
   ```

2. **Cross-form aggregation**: Use `mv_cross_form_latest` to get latest value across ALL monitoring forms

3. **Replace remaining subqueries**: Update `get_base_monitoring_qs()` to use MVs entirely

## Related Files

```
backend/api/v1/v1_visualization/
├── migrations/
│   ├── 0001_create_view_data_options.py  # Existing
│   └── 0002_add_optimized_*.py           # Task 1 (new)
├── models.py                              # Task 2 (modify)
├── functions.py                           # Task 3 & 4 (modify)
└── values_functions.py                    # Task 4 (modify)
```
