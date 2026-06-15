# Task 4: Optimize Query Functions to Use Materialized Views

## Overview

Update the visualization query functions to use the new materialized views instead of running expensive queries on each request. This task has the highest impact on performance.

## Files to Modify

1. `backend/api/v1/v1_visualization/functions.py` - Add MV-based helper functions
2. `backend/api/v1/v1_visualization/values_functions.py` - Update `_stack_option_by_parent()`

---

## Part A: Add MV Helper Functions

**File**: `backend/api/v1/v1_visualization/functions.py`

Add these new functions after the existing `apply_administration_filter` function (after line 40):

```python
def apply_administration_filter_mv(qs, administration_id, field='parent_administration_id'):
    """Filter MV queryset by administration hierarchy.

    Similar to apply_administration_filter but works with MV models
    that have denormalized administration fields.

    Args:
        qs: QuerySet of MV model
        administration_id: Target administration ID
        field: Name of administration field to filter on
    """
    try:
        adm = Administration.objects.get(pk=administration_id)
    except Administration.DoesNotExist:
        return qs.none()

    adm_path = (
        f"{adm.path}{adm.id}." if adm.path
        else f"{adm.id}."
    )
    # MVs store administration_id directly, not as FK
    # We need to look up child administrations
    from api.v1.v1_profile.models import Administration as Adm
    child_admin_ids = list(
        Adm.objects.filter(
            Q(pk=administration_id) |
            Q(path__startswith=adm_path)
        ).values_list('pk', flat=True)
    )
    return qs.filter(**{f'{field}__in': child_admin_ids})


def get_latest_monitoring_from_mv(form_id, administration_id=None, date_filters=None):
    """Get latest monitoring data using materialized view.

    Replaces the expensive correlated subquery in latest_monitoring_subquery().
    Returns QuerySet of MVLatestMonitoring rows.

    Args:
        form_id: Monitoring form ID
        administration_id: Optional administration filter
        date_filters: Optional dict with from_date, to_date, date_question_id

    Returns:
        QuerySet of MVLatestMonitoring objects
    """
    from .models import MVLatestMonitoring, MVAnswerDenormalized

    qs = MVLatestMonitoring.objects.filter(form_id=form_id)

    if administration_id:
        qs = apply_administration_filter_mv(
            qs, administration_id, 'parent_administration_id'
        )

    if date_filters:
        from_date = date_filters.get("from_date")
        to_date = date_filters.get("to_date")
        date_qid = date_filters.get("date_question_id")

        if date_qid:
            # Filter by custom date question using denormalized answers
            matching = MVAnswerDenormalized.objects.filter(
                question_id=date_qid,
                answer_name__isnull=False,
            )
            if from_date:
                matching = matching.filter(answer_name__gte=str(from_date))
            if to_date:
                matching = matching.filter(
                    answer_name__lte=_to_date_upper_bound(to_date)
                )
            qs = qs.filter(latest_data_id__in=matching.values("data_id"))
        else:
            if from_date:
                qs = qs.filter(created__date__gte=from_date)
            if to_date:
                qs = qs.filter(created__date__lte=to_date)

    return qs


def get_latest_data_ids_from_mv(form_id, administration_id=None, date_filters=None):
    """Get list of latest monitoring data IDs using MV.

    Convenience wrapper that returns just the IDs for use with
    existing Answers queries.
    """
    qs = get_latest_monitoring_from_mv(form_id, administration_id, date_filters)
    return list(qs.values_list('latest_data_id', flat=True))
```

---

## Part B: Update _stack_option_by_parent

**File**: `backend/api/v1/v1_visualization/values_functions.py`

Replace the `_stack_option_by_parent` function (lines 972-1036) with this optimized version:

```python
def _stack_option_by_parent(
    question, options, data_ids,
    qs, is_latest, opt_labels, opt_colors
):
    """Stack by option, grouped by parent_id.

    OPTIMIZED: Uses mv_parent_aggregates when available to avoid N+1 queries.
    Falls back to original implementation if MV is empty or unavailable.

    Handles three data shapes:
      - is_latest=True: qs rows are parent FormData with a `latest_id`
      - is_latest=False, monitoring-form: data_ids reference monitoring submissions
      - is_latest=False, registration-form: data_ids ARE registration submissions
    """
    from api.v1.v1_visualization.models import MVParentAggregates

    # Try MV-based approach first
    if is_latest and data_ids:
        # Get form_id from first data
        first_data = FormData.objects.filter(
            id__in=data_ids[:1]
        ).values('form_id').first()

        if first_data:
            form_id = first_data['form_id']
            # Get parent IDs from qs
            parent_ids = list(qs.values_list('id', flat=True))

            # Query MV for pre-aggregated data
            agg_data = MVParentAggregates.objects.filter(
                form_id=form_id,
                question_id=question.id,
                parent_id__in=parent_ids,
            ).values('parent_id', 'option_values')

            if agg_data.exists():
                return _stack_option_by_parent_from_mv(
                    agg_data, parent_ids, qs, options, opt_labels, opt_colors
                )

    # Fallback to original implementation
    return _stack_option_by_parent_legacy(
        question, options, data_ids, qs, is_latest, opt_labels, opt_colors
    )


def _stack_option_by_parent_from_mv(
    agg_data, parent_ids, qs, options, opt_labels, opt_colors
):
    """Build stack data from materialized view aggregates.

    Single query approach - O(1) instead of O(P * M) queries.
    """
    # Build lookup: {parent_id: [option_values]}
    parent_options = {}
    for row in agg_data:
        parent_options[row['parent_id']] = row['option_values'] or []

    # Get parent names from qs
    parent_names = {p.id: p.name for p in qs.only('id', 'name')}

    data = []
    for parent_id in parent_ids:
        opts_for_parent = parent_options.get(parent_id, [])
        p_name = parent_names.get(parent_id, "")
        row = {"label": p_name, "group": parent_id}
        for opt in options:
            # Count occurrences of this option value
            row[opt.label] = opts_for_parent.count(opt.value)
        data.append(row)

    labels = [d["label"] for d in data]
    return {
        "data": data,
        "labels": labels,
        "stack_labels": opt_labels,
        "colors": opt_colors,
    }


def _stack_option_by_parent_legacy(
    question, options, data_ids,
    qs, is_latest, opt_labels, opt_colors
):
    """Original _stack_option_by_parent implementation.

    Used as fallback when MV is not available or empty.
    """
    # Distinguish monitoring vs registration by probing for a parent_id.
    is_registration_form = False
    if is_latest:
        parents = qs
    else:
        parent_ids = list(FormData.objects.filter(
            id__in=data_ids,
            parent__isnull=False,
        ).values_list("parent_id", flat=True).distinct())
        if parent_ids:
            parents = FormData.objects.filter(id__in=parent_ids)
        else:
            # Registration-form path: qs IS the list of registrations.
            parents = qs
            is_registration_form = True

    data = []
    for parent in parents:
        if is_latest:
            p_data_ids = [parent.latest_id]
            p_name = parent.name
        elif is_registration_form:
            p_data_ids = [parent.id]
            p_name = parent.name
        else:
            p_data_ids = list(FormData.objects.filter(
                id__in=data_ids,
                parent_id=parent.id,
            ).values_list("id", flat=True))
            p_name = parent.name

        row = {"label": p_name, "group": parent.id}
        for opt in options:
            count = Answers.objects.filter(
                data_id__in=p_data_ids,
                question_id=question.id,
                options__contains=[opt.value],
            ).count()
            row[opt.label] = count
        data.append(row)

    labels = [d["label"] for d in data]
    return {
        "data": data,
        "labels": labels,
        "stack_labels": opt_labels,
        "colors": opt_colors,
    }
```

---

## Part C: Add Import for Models

At the top of `values_functions.py`, add import for MV models (if not already done in function):

No change needed - we import inside the function to avoid circular imports.

---

## Performance Impact

| Function | Before | After | Improvement |
|----------|--------|-------|-------------|
| `_stack_option_by_parent` | P parents × M options queries | 1 query | 10-100x |
| `get_latest_monitoring` | Correlated subquery per row | Single MV lookup | 10-50x |
| Criteria filtering | Multiple Answers queries | Pre-joined MV | 5-20x |

## Verification

1. Run existing visualization tests:
   ```bash
   ./dc.sh exec backend python manage.py test api.v1.v1_visualization
   ```

2. Manual API testing:
   ```bash
   # Test /visualization/values endpoint
   curl "http://localhost:8000/api/v1/visualization/values?form_id=<ID>&question_id=<QID>&monitoring=latest&group_by=parent_id&stack_by=option"
   ```

3. Check query count with Django Debug Toolbar or:
   ```python
   from django.db import connection, reset_queries
   from django.conf import settings
   settings.DEBUG = True
   reset_queries()

   # Run your visualization code here

   print(f"Queries: {len(connection.queries)}")
   for q in connection.queries:
       print(q['sql'][:100])
   ```

## Dependencies

- Requires Task 1 (migration) and Task 2 (models) to be completed first
- Task 3 should also be done to ensure views are refreshed

## Future Optimization Opportunities

1. **Replace `get_base_monitoring_qs`**: The main `get_base_monitoring_qs` function still uses the old correlated subquery. Consider creating an MV-based alternative:

   ```python
   def get_base_monitoring_qs_from_mv(form, monitoring_form_id, params):
       """MV-based version of get_base_monitoring_qs."""
       # Implementation using MVLatestMonitoring
       pass
   ```

2. **Cross-form queries**: Use `MVCrossFormLatest` for queries that need the latest value across multiple monitoring forms by question name.

3. **Criteria optimization**: Use `MVAnswerDenormalized` for faster criteria filtering instead of joining Answer with FormData on each request.
