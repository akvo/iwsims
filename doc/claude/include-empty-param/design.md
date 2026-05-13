# Design: `include_empty` parameter

For requirements, see [requirements.md](./requirements.md).  
For the step-by-step implementation, see [implementation-plan.md](./implementation-plan.md).

---

## Data model recap

```
FormData (registration)  ← parent
  id = 1 … 105           ← 105 registered EPS

FormData (monitoring)    ← child (form.parent = registration form)
  parent_id → FormData.id
  13 of the 105 parents have at least one monitoring submission

Answers
  data_id → FormData.id (monitoring submission)
  question_id, options (JSON array)
```

`data_ids` (produced by `get_monitoring_data_ids`) = IDs of the latest monitoring submissions for each of the 13 monitored parents when `monitoring=latest`.

---

## Core computation

### Step 1 — Count of answered parents (unchanged)

```python
count_qs = Answers.objects.filter(
    data_id__in=data_ids,
    question_id=question.id,
    options__contains=[option_value],   # e.g. "no"
)
if sum_by == "parent_id":
    count = count_qs.values("data__parent_id").distinct().count()
else:
    count = count_qs.count()
# count = 3  (parents whose latest monitoring says "no")
```

### Step 2 — Count of never-monitored parents (new, when `include_empty=True`)

```python
is_monitoring = form is not None and form.parent is not None

if include_empty and is_monitoring:
    # Derive the set of parent IDs that DO have a monitoring submission in scope.
    # data_ids = latest monitoring submission IDs → each maps to one parent_id.
    monitored_parent_ids = set(
        FormData.objects.filter(id__in=data_ids)
        .values_list("parent_id", flat=True)
        .distinct()
    )
    # empty = total_registered − monitored_parents (respects admin/criteria filters)
    empty_count = _count_no_info_parents(form, params or {}, monitored_parent_ids)
    # empty_count = 105 − 13 = 92
```

### Step 3 — Combine

```python
if include_empty and is_monitoring:
    value = count + empty_count          # number mode: 3 + 92 = 95

    if value_type == "percentage":
        total = _total_parents_in_scope(form, params or {})   # 105
        value = round((count + empty_count) / total * 100, 2) # 90.48%
else:
    # existing path (unchanged)
    value = count
    if value_type == "percentage":
        total = qs.count() if is_latest else len(data_ids)
        value = round(count / total * 100, 2) if total > 0 else 0
```

---

## Why `monitored_parent_ids` (not `all_answered_ids`)

`include_unanswered` uses `all_answered_ids` — parents whose submission has a non-null options field for this question. In the construction data, the 10 "yes" parents appear to have null options (or a different question path), so `all_answered_ids.size = 3`, leading to `unanswered = 102` and a wrong total of 105.

`include_empty` bypasses the answer lookup entirely. It asks: "which parents have *any* monitoring submission?" — a `FormData` lookup, not an `Answers` lookup. This gives exactly the 13 monitored parents, independent of whether they answered the specific question.

```
include_unanswered path              include_empty path
────────────────────────             ──────────────────────────
Answers(data_id__in=data_ids,        FormData(id__in=data_ids)
  options__isnull=False)               .values_list("parent_id")
→ only 3 parents (bug)               → 13 parents (correct)
unanswered = 105 − 3 = 102           empty = 105 − 13 = 92
value = 3 + 102 = 105 ✗              value = 3 + 92 = 95 ✓
```

---

## Query cost

| Stage | Queries |
|-------|---------|
| Baseline (no flag) | 1 Answers COUNT |
| `include_empty=true` | +1 FormData VALUES (get parent_ids from data_ids) |
| Percentage mode | +1 FormData COUNT (already paid by `_total_parents_in_scope`) |

Total overhead: **at most 2 extra queries**. Both are simple indexed lookups on `id` / `parent_id`.

---

## API parameter spec

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `include_empty` | bool | `false` | When `true` on a monitoring form with `option_value`, adds the count of registered parents that have zero monitoring submissions to the result value. Denominator for percentage mode becomes `total_registered`. |

### View-layer parsing (views.py)

```python
include_empty = (
    request.GET.get("include_empty", "false").lower() == "true"
)
```

Passed into `handle_option_question` → forwarded to `_option_value_filter`.

---

## Function signature change

```python
# Before
def _option_value_filter(
    question, data_ids, qs, is_latest,
    option_value, sum_by, value_type,
    include_unanswered=False, form=None, params=None,
):

# After
def _option_value_filter(
    question, data_ids, qs, is_latest,
    option_value, sum_by, value_type,
    include_unanswered=False, form=None, params=None,
    include_empty=False,     # NEW
):
```

And in `handle_option_question`:

```python
if option_value:
    return _option_value_filter(
        question, data_ids, qs, is_latest,
        option_value, sum_by, value_type,
        include_unanswered=params.get("include_unanswered", False),
        form=form,
        params=params,
        include_empty=params.get("include_empty", False),   # NEW
    )
```

---

## Behaviour matrix

| `value_type` | `include_empty` | numerator | denominator |
|---|---|---|---|
| `number` | `false` | `count(option_value)` | — |
| `number` | `true` | `count(option_value) + never_monitored` | — |
| `percentage` | `false` | `count(option_value)` | `monitored_count` (qs.count() or len(data_ids)) |
| `percentage` | `true` | `count(option_value) + never_monitored` | `total_parents_in_scope` |

---

## Dashboard JSON config

```jsonc
// kpi_under_construction  (count)
"api": {
  "form_id": 1749624452908,
  "question_id": 1749630516826,
  "option_value": "no",
  "monitoring": "latest",
  "sum_by": "parent_id",
  "include_empty": true          // replaces include_unanswered: true
}

// kpi_under_construction_pct  (percentage)
"api": {
  "form_id": 1749624452908,
  "question_id": 1749630516826,
  "option_value": "no",
  "monitoring": "latest",
  "sum_by": "parent_id",
  "value_type": "percentage",
  "include_empty": true          // NEW
}
```

---

## Files changed

| File | Change |
|------|--------|
| `backend/api/v1/v1_visualization/values_functions.py` | Add `include_empty` param to `_option_value_filter`; new branch in count + percentage paths |
| `backend/api/v1/v1_visualization/views.py` | Parse `include_empty` from query string and pass to params |
| `backend/api/v1/v1_visualization/tests/tests_values_option.py` | Add 4 new test cases |
| `frontend/src/config/visualizations/1749623934933.json` | Swap `include_unanswered` → `include_empty` on both construction KPI cards |
