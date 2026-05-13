# Implementation Plan: `include_empty` parameter

For requirements, see [requirements.md](./requirements.md).
For technical design, see [design.md](./design.md).

---

## Overview

4 phases, ~6 file touches, no new React components.

```
Phase 1: Backend logic   → values_functions.py + views.py
Phase 2: Tests (TDD)     → tests_values_option.py (RED → GREEN)
Phase 3: Config update   → 1749623934933.json
Phase 4: Verify          → curl + backend test run
```

---

## Phase 1 — Backend logic

### 1a. `values_functions.py` — extend `_option_value_filter`

File: `backend/api/v1/v1_visualization/values_functions.py`

Add `include_empty=False` parameter and a new branch that counts never-monitored parents.

```python
# Full updated signature
def _option_value_filter(
    question, data_ids, qs, is_latest,
    option_value, sum_by, value_type,
    include_unanswered=False, form=None, params=None,
    include_empty=False,        # NEW
):
```

Inside the function, after the existing `count` calculation:

```python
# ── include_empty branch (new) ─────────────────────────────────
is_monitoring = form is not None and form.parent is not None
empty_count = 0
if include_empty and is_monitoring:
    # Which parent IDs already have a monitoring submission in scope?
    monitored_parent_ids = set(
        FormData.objects.filter(id__in=data_ids)
        .values_list("parent_id", flat=True)
        .distinct()
    )
    # never-monitored = total_in_scope − monitored
    empty_count = _count_no_info_parents(form, params or {}, monitored_parent_ids)

# ── include_unanswered branch (existing, unchanged) ─────────────
unanswered = 0
if include_unanswered and is_monitoring and not include_empty:
    all_answered_ids = set(
        Answers.objects.filter(
            data_id__in=data_ids,
            question_id=question.id,
            options__isnull=False,
        ).values_list("data__parent_id", flat=True).distinct()
    )
    unanswered = _count_no_info_parents(form, params or {}, all_answered_ids)

# ── Percentage / count mode ──────────────────────────────────────
extra = empty_count if include_empty else unanswered

if value_type == "percentage":
    if (include_empty or include_unanswered) and is_monitoring:
        total = _total_parents_in_scope(form, params or {})
        numerator = count + extra
    else:
        total = qs.count() if is_latest else len(data_ids)
        numerator = count
    value = round((numerator / total * 100), 2) if total > 0 else 0
else:
    value = count + extra
```

> **Note**: The `and not include_empty` guard prevents the `include_unanswered` branch from running when `include_empty=True`, avoiding a double-add. When both flags are set, `include_empty` wins.

### 1b. `handle_option_question` — forward the new param

Same file. In the `if option_value:` block:

```python
if option_value:
    return _option_value_filter(
        question, data_ids, qs, is_latest,
        option_value, sum_by, value_type,
        include_unanswered=params.get("include_unanswered", False),
        form=form,
        params=params,
        include_empty=params.get("include_empty", False),   # ADD
    )
```

### 1c. `views.py` — parse query param

File: `backend/api/v1/v1_visualization/views.py`

Find where `include_unanswered` is parsed and add the new param alongside it:

```python
include_empty = (
    request.GET.get("include_empty", "false").lower() == "true"
)
# Add to params dict passed to handlers:
params["include_empty"] = include_empty
```

---

## Phase 2 — Tests (TDD)

File: `backend/api/v1/v1_visualization/tests/tests_values_option.py`

Write tests BEFORE running (RED phase), then make them pass (GREEN).

### Test setup

The existing mixin gives:
- 2 registered parents (`reg1`, `reg2`), both monitored
- Latest: reg1→active, reg2→pending

For `include_empty` tests we need **unmonitored** registrations. Add them in each test method (not in setUp) to avoid breaking existing tests:

```python
def _make_unmonitored_regs(self, n=2):
    """Create n registered parents with zero monitoring submissions."""
    created = []
    for i in range(n):
        fd = FormData.objects.create(
            form=self.registration,
            name=f"unreg_{i}",
            administration=self.administration,
        )
        created.append(fd)
    return created
```

### Test cases to add

```
test_include_empty_count_adds_never_monitored
  Setup: 2 extra unmonitored regs → total=4, monitored=2, answered "active"=1
  GET option_value=active, monitoring=latest, sum_by=parent_id, include_empty=true
  Expected value = 1 (answered) + 2 (never monitored) = 3

test_include_empty_percentage_uses_total_registered
  Same setup (4 total, 1 answered active, 2 never monitored)
  GET option_value=active, value_type=percentage, monitoring=latest,
      sum_by=parent_id, include_empty=true
  Expected value = (1+2)/4 × 100 = 75.0

test_include_empty_no_unmonitored
  No extra regs → total=2, monitored=2, answered "active"=1
  GET include_empty=true
  Expected value = 1 + 0 = 1  (no empty parents → same as without flag)

test_include_empty_backward_compat
  2 extra unmonitored regs present but flag NOT set
  GET include_empty=false (or absent)
  Expected value = 1  (only answered count, unmonitored ignored)
```

---

## Phase 3 — Frontend config

File: `frontend/src/config/visualizations/1749623934933.json`

### Change 1: `kpi_under_construction` (lines ~148–162)

```jsonc
// Before
"api": {
  "form_id": 1749624452908,
  "question_id": 1749630516826,
  "option_value": "no",
  "monitoring": "latest",
  "sum_by": "parent_id",
  "include_unanswered": true    // ← remove
}

// After
"api": {
  "form_id": 1749624452908,
  "question_id": 1749630516826,
  "option_value": "no",
  "monitoring": "latest",
  "sum_by": "parent_id",
  "include_empty": true         // ← add
}
```

### Change 2: `kpi_under_construction_pct` (lines ~884–892)

```jsonc
// Before
"api": {
  "form_id": 1749624452908,
  "question_id": 1749630516826,
  "option_value": "no",
  "monitoring": "latest",
  "sum_by": "parent_id",
  "value_type": "percentage"
  // may have include_unanswered: true incorrectly added
}

// After
"api": {
  "form_id": 1749624452908,
  "question_id": 1749630516826,
  "option_value": "no",
  "monitoring": "latest",
  "sum_by": "parent_id",
  "value_type": "percentage",
  "include_empty": true         // ← add
}
```

---

## Phase 4 — Verify

### Backend tests

```bash
./dc.sh exec backend python manage.py test \
  api.v1.v1_visualization.tests.tests_values_option -v 2
```

All tests must pass (green).

### Manual API check

```bash
# Without flag (baseline): should return 3
curl 'http://localhost:3000/api/v1/visualization/values?\
form_id=1749624452908&question_id=1749630516826\
&option_value=no&monitoring=latest&sum_by=parent_id'

# With include_empty: should return 95 (3 + 92)
curl 'http://localhost:3000/api/v1/visualization/values?\
form_id=1749624452908&question_id=1749630516826\
&option_value=no&monitoring=latest&sum_by=parent_id&include_empty=true'

# Percentage: should return 90.48 (95/105 × 100)
curl 'http://localhost:3000/api/v1/visualization/values?\
form_id=1749624452908&question_id=1749630516826\
&option_value=no&monitoring=latest&sum_by=parent_id\
&value_type=percentage&include_empty=true'
```

### Dashboard visual check

Open http://localhost:3000 → EPS Overview dashboard.

| Card | Expected |
|------|----------|
| "Total EPS under construction" | 95 |
| "Total EPS under construction" (%) | 90.48% |
| Other KPI cards | Unchanged |

---

## Checklist

```
[ ] Phase 1a: _option_value_filter — include_empty branch added
[ ] Phase 1b: handle_option_question — include_empty forwarded
[ ] Phase 1c: views.py — include_empty parsed from query string
[ ] Phase 2:  Tests written (RED), then pass (GREEN)
[ ] Phase 3:  JSON config swapped on both construction KPIs
[ ] Phase 4:  curl baseline = 3, with flag = 95, pct = 90.48
[ ] Phase 4:  Dashboard cards show correct values
[ ] Session close: git add + bd sync + git commit
```
