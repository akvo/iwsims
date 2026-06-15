# Task 5: Implement question_name API Parameter

## Overview

Add a new `question_name` parameter to the visualization API that allows querying by question name instead of `form_id` + `question_id`. This uses the `mv_cross_form_latest` materialized view to return the latest value across ALL monitoring forms.

## Use Case

A registration can have multiple monitoring forms (e.g., "Quick Monitoring" + "Comprehensive Monitoring"). Both forms might have a question named `ph`. When querying "latest pH status", we want the most recent value from ANY monitoring form.

**Before** (must know exact IDs):
```
GET /visualization/values?form_id=123&question_id=456&monitoring=latest
```

**After** (human-readable):
```
GET /visualization/values?question_name=ph&monitoring=latest
```

## Files to Modify

1. `backend/api/v1/v1_visualization/views.py` - Add parameter handling
2. `backend/api/v1/v1_visualization/functions.py` - Add query function
3. `backend/api/v1/v1_visualization/serializers.py` - Add parameter validation (if exists)

---

## Part A: Add Query Function

**File**: `backend/api/v1/v1_visualization/functions.py`

Add this function (after the existing MV helper functions):

```python
def get_values_by_question_name(question_name, params):
    """Get visualization values using question_name across all monitoring forms.

    Uses mv_cross_form_latest to find the latest value for each parent,
    regardless of which monitoring form the answer came from.

    Args:
        question_name: The question name/identifier (e.g., "ph", "status")
        params: Dict with optional filters:
            - administration_id: Filter by administration
            - group_by: How to group results ("option", "parent_id")
            - value_type: "number" or "percentage"

    Returns:
        Tuple of (data, labels) matching existing API response format
    """
    from .models import MVCrossFormLatest

    administration_id = params.get("administration_id")
    group_by = params.get("group_by", "option")
    value_type = params.get("value_type", "number")

    # Base query
    qs = MVCrossFormLatest.objects.filter(question_name=question_name)

    # Apply administration filter
    if administration_id:
        qs = apply_administration_filter_mv(
            qs, administration_id, field='administration_id'
        )

    # Get question type from first result
    first = qs.first()
    if not first:
        return [], []

    question_type = first.question_type

    # Handle based on question type
    if question_type == 4:  # number
        return _values_by_qname_number(qs, group_by, value_type, params)
    elif question_type in (5, 6):  # option, multiple_option
        return _values_by_qname_option(qs, question_name, group_by, value_type, params)
    else:
        # Text/date questions - return raw values grouped by parent
        return _values_by_qname_text(qs, group_by)


def _values_by_qname_number(qs, group_by, value_type, params):
    """Handle number question aggregation by question_name."""
    from django.db.models import Avg, Sum, Count

    if group_by == "parent_id":
        data = [
            {
                "value": round(row.latest_numeric_value, 2) if row.latest_numeric_value else 0,
                "label": str(row.parent_id),  # TODO: fetch parent name
                "group": str(row.parent_id),
            }
            for row in qs.filter(latest_numeric_value__isnull=False)
        ]
    else:
        # Aggregate all values
        result = qs.filter(latest_numeric_value__isnull=False).aggregate(
            avg_value=Avg('latest_numeric_value'),
            total=Count('id'),
        )
        value = round(result['avg_value'], 2) if result['avg_value'] else 0
        data = [{"value": value, "label": "Total"}]

    if value_type == "percentage" and data:
        total = sum(d["value"] for d in data)
        if total > 0:
            for d in data:
                d["value"] = round(d["value"] / total * 100, 2)

    labels = [d["label"] for d in data]
    return data, labels


def _values_by_qname_option(qs, question_name, group_by, value_type, params):
    """Handle option question aggregation by question_name."""
    from api.v1.v1_forms.models import QuestionOptions, Questions
    from collections import defaultdict

    # Get all possible options for this question name
    # (assumes same options across forms with same question name)
    question = Questions.objects.filter(name=question_name).first()
    if not question:
        return [], []

    options = QuestionOptions.objects.filter(
        question__name=question_name
    ).order_by('order').distinct('value', 'order')

    if group_by == "option":
        # Count each option value across all parents
        tallies = defaultdict(int)
        total_parents = 0

        for row in qs:
            opts = row.latest_option_values or []
            for opt_value in opts:
                tallies[opt_value] += 1
            if opts:
                total_parents += 1

        data = []
        for opt in options:
            count = tallies.get(opt.value, 0)
            if value_type == "percentage" and total_parents > 0:
                value = round(count / total_parents * 100, 2)
            else:
                value = count
            data.append({
                "value": value,
                "label": opt.label,
                "group": opt.value,
                "color": opt.color,
            })

    elif group_by == "parent_id":
        # Return option values per parent
        data = [
            {
                "value": row.latest_option_values or [],
                "label": str(row.parent_id),
                "group": str(row.parent_id),
            }
            for row in qs
        ]

    else:
        # Simple count of parents with any value
        count = qs.filter(latest_option_values__isnull=False).count()
        data = [{"value": count, "label": "Total"}]

    labels = [d["label"] for d in data]
    return data, labels


def _values_by_qname_text(qs, group_by):
    """Handle text/date question by question_name."""
    data = [
        {
            "value": row.latest_text_value or "",
            "label": str(row.parent_id),
            "group": str(row.parent_id),
        }
        for row in qs.filter(latest_text_value__isnull=False)
    ]
    labels = [d["label"] for d in data]
    return data, labels
```

---

## Part B: Update View to Accept question_name

**File**: `backend/api/v1/v1_visualization/views.py`

Find the `values` view/endpoint and add handling for `question_name` parameter.

Look for the view that handles `/visualization/values` (likely a function or class-based view).

Add this logic at the beginning of the handler:

```python
def values(request):
    # ... existing parameter extraction ...

    # NEW: Check for question_name parameter
    question_name = request.query_params.get("question_name")

    if question_name:
        # Use cross-form query by question name
        from .functions import get_values_by_question_name

        params = {
            "administration_id": request.query_params.get("administration_id"),
            "group_by": request.query_params.get("group_by"),
            "value_type": request.query_params.get("value_type", "number"),
            # Add other relevant params
        }

        try:
            administration_id = params.get("administration_id")
            if administration_id:
                params["administration_id"] = int(administration_id)
        except (ValueError, TypeError):
            pass

        data, labels = get_values_by_question_name(question_name, params)

        return Response({
            "data": data,
            "labels": labels,
        })

    # ... rest of existing logic for form_id + question_id ...
```

---

## Part C: Add Validation (Optional)

If the project uses serializers for request validation, add `question_name` to the serializer.

**File**: `backend/api/v1/v1_visualization/serializers.py` (if exists)

```python
class ValuesRequestSerializer(serializers.Serializer):
    # Existing fields
    form_id = serializers.IntegerField(required=False)
    question_id = serializers.IntegerField(required=False)

    # NEW field
    question_name = serializers.CharField(required=False, max_length=255)

    def validate(self, data):
        # Either (form_id + question_id) OR question_name must be provided
        has_ids = data.get('form_id') and data.get('question_id')
        has_name = data.get('question_name')

        if not has_ids and not has_name:
            raise serializers.ValidationError(
                "Either (form_id + question_id) or question_name is required"
            )

        return data
```

---

## API Specification

### Request

```
GET /api/v1/visualization/values?question_name=ph&monitoring=latest&group_by=option
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question_name` | string | Yes* | Question name to query across forms |
| `administration_id` | int | No | Filter by administration |
| `group_by` | string | No | `option`, `parent_id` |
| `value_type` | string | No | `number`, `percentage` |

*Either `question_name` OR (`form_id` + `question_id`) is required.

### Response

Same format as existing `/values` endpoint:

```json
{
  "data": [
    { "value": 45, "label": "Functional", "group": "functional", "color": "#52c41a" },
    { "value": 30, "label": "Needs Repair", "group": "needs_repair", "color": "#faad14" },
    { "value": 25, "label": "Non-functional", "group": "non_functional", "color": "#ff4d4f" }
  ],
  "labels": ["Functional", "Needs Repair", "Non-functional"]
}
```

---

## Frontend Config Example

After this task, frontend configs can use:

```json
{
  "id": "water-status",
  "chart_type": "doughnut",
  "api": {
    "question_name": "functionality_status",
    "monitoring": "latest",
    "group_by": "option"
  }
}
```

Instead of:

```json
{
  "id": "water-status",
  "chart_type": "doughnut",
  "api": {
    "form_id": 1749621962296,
    "question_id": 1749621851234,
    "monitoring": "latest",
    "group_by": "option"
  }
}
```

---

## Verification

1. Run tests:
   ```bash
   ./dc.sh exec backend python manage.py test api.v1.v1_visualization
   ```

2. Manual API test:
   ```bash
   # Get status by question name
   curl "http://localhost:8000/api/v1/visualization/values?question_name=functionality_status&group_by=option"

   # Compare with existing ID-based query
   curl "http://localhost:8000/api/v1/visualization/values?form_id=123&question_id=456&group_by=option"
   ```

3. Verify cross-form behavior:
   - Create two monitoring forms with same question name
   - Submit data to both forms for same parent
   - Query by `question_name` - should return latest from either form

---

## Dependencies

- Requires Task 1-4 to be completed (MVs must exist and be populated)
- `mv_cross_form_latest` must have data (run `refresh_materialized_data()`)

---

## Edge Cases to Handle

1. **Question name not found**: Return empty data with 200 (not 404)
2. **Multiple questions with same name but different types**: Use the most common type or return error
3. **No data for question**: Return empty `{"data": [], "labels": []}`
4. **Administration filter with no matches**: Return empty data
