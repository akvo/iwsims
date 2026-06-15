# Claude Instructions for Materialized Views Implementation

When working on tasks in this folder, follow these guidelines.

## Context

This folder contains implementation tasks for adding materialized views to optimize the visualization API. Read the relevant task file before starting work.

## Task Execution Order

**IMPORTANT**: Tasks must be completed in order:

```
Task 1 → Task 2 → Task 3 → Task 4
```

Each task depends on the previous one being completed.

## Key Files to Understand

Before implementing, read these files:

1. **Backend visualization code**:
   - `backend/api/v1/v1_visualization/functions.py` - Core query functions
   - `backend/api/v1/v1_visualization/values_functions.py` - Value aggregation
   - `backend/api/v1/v1_visualization/models.py` - Existing MV model

2. **Existing migration pattern**:
   - `backend/api/v1/v1_visualization/migrations/0001_create_view_data_options.py`

3. **Reference docs in this folder**:
   - `materialized-views-reference.md` - Schema and query examples
   - `frontend-config-context.md` - Why we need these MVs

## Implementation Guidelines

### For Task 1 (Migration)

- Use `atomic = False` for the migration class
- Create indexes after each view
- Use `CASCADE` in reverse SQL
- Test with: `./dc.sh exec backend python manage.py migrate v1_visualization`

### For Task 2 (Models)

- All models must have `managed = False`
- Use `BigIntegerField` for IDs (not `IntegerField`)
- No ForeignKey relationships - use raw integer fields
- Match nullable fields to the SQL view

### For Task 3 (Refresh)

- Add logging with `logger.info()` for each view refresh
- Support both concurrent and regular refresh
- Fallback to regular refresh if concurrent fails

### For Task 4 (Query Optimization)

- Keep backward compatibility - don't break existing API
- Add MV-based functions alongside existing ones
- Use fallback pattern: try MV first, fall back to legacy if empty
- Don't modify function signatures that are used elsewhere

## Testing

After each task, verify:

```bash
# Run tests
./dc.sh exec backend python manage.py test api.v1.v1_visualization

# Check migrations
./dc.sh exec backend python manage.py showmigrations v1_visualization

# Verify views exist (after Task 1)
./dc.sh exec backend python manage.py dbshell -c "\dm+"

# Test refresh (after Task 3)
./dc.sh exec backend python manage.py shell -c "
from api.v1.v1_visualization.functions import refresh_materialized_data
refresh_materialized_data()
"
```

## Question Types Reference

When working with `question_type` field:

| Type | Name |
|------|------|
| 1 | input (text) |
| 2 | text (multiline) |
| 3 | date |
| 4 | number |
| 5 | option (single) |
| 6 | multiple_option |
| 7 | cascade |
| 8 | geo |
| 9 | photo |

## Common Patterns

### Filtering by administration hierarchy

```python
# For regular models
from api.v1.v1_visualization.functions import apply_administration_filter
qs = apply_administration_filter(qs, administration_id)

# For MV models (after Task 4)
from api.v1.v1_visualization.functions import apply_administration_filter_mv
qs = apply_administration_filter_mv(qs, administration_id, 'parent_administration_id')
```

### Checking option contains

```python
# JSONField contains check
qs.filter(answer_options__contains=['functional'])
```

## Do NOT

- Do not change the existing `view_data_options` materialized view
- Do not modify API response formats
- Do not remove existing functions - add alternatives
- Do not skip running tests after changes
