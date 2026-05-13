# Requirements: `include_empty` parameter for `/api/v1/visualization/values`

For design and SQL, see [design.md](./design.md).  
For the step-by-step implementation, see [implementation-plan.md](./implementation-plan.md).

---

## Problem statement

The `kpi_under_construction` KPI cards on the EPS dashboard produce wrong numbers:

| Card | Current value | Expected value | Why wrong |
|------|--------------|----------------|-----------|
| `kpi_under_construction` (count) | 105 | 95 | `include_unanswered=true` adds 102 never-monitored EPS to count of 3, giving 105 |
| `kpi_under_construction_pct` (%) | 23.08% | 90.48% | Denominator is 13 (monitored EPS count) instead of 105 (total registered) |

**Observed data facts** (EPS construction monitoring form):

| Group | Count |
|-------|-------|
| Total registered EPS | 105 |
| EPS with at least one monitoring submission | 13 |
| EPS with latest monitoring answer = "no" (under construction) | 3 |
| EPS with latest monitoring answer = "yes" (completed) | 10 |
| EPS with **zero** monitoring submissions (never visited) | 92 |

**What the KPI should express:**  
"How many EPS are still under construction?" → answered "no" (3) + never monitored (92, assumed still under construction) = **95**

**Percentage:** 95 / 105 total registered × 100 = **90.48%**

---

## Why `include_unanswered=true` is the wrong tool here

`include_unanswered` (implemented in the previous feature cycle) was designed for the **donut / group_by_option** use case: it appends a `_no_info` bucket for parents that lack any qualifying answer. Its "unanswered" count is:

```
unanswered = total_parents − parents_who_answered_this_question_with_any_option
```

When applied to the construction KPI with `option_value=no`:
- `all_answered_ids` = parents whose latest monitoring submission has `options IS NOT NULL` for this question
- In the actual data, only 3 parents have a non-null options field → `all_answered_ids.size = 3`
- `unanswered = 105 − 3 = 102`
- `value = 3 + 102 = 105` ← wrong; this accidentally double-counts EPS that answered "yes"

The root cause: `include_unanswered` measures **answer completeness within monitored parents**, not **monitoring coverage** of the full registered universe.

---

## `include_empty` — the correct concept

`include_empty` explicitly counts registered parents with **zero monitoring submissions** — i.e., parents that never appear in `data_ids` at all.

| Concept | "Empty" definition | What it measures |
|---------|-------------------|-----------------|
| `include_unanswered` | Parent has a monitoring submission but the specific question has null options | Data quality gaps within monitored EPS |
| `include_empty` | Parent has **no monitoring submission** | Coverage gaps — EPS never visited |

For the construction use case, the logical rule is:
> "An EPS is 'under construction' if its latest monitoring says 'no', OR it has never been monitored (so we have no evidence it is complete)."

---

## Functional requirements

### FR-1 — New `include_empty` flag

`GET /api/v1/visualization/values` accepts a new boolean parameter `include_empty`.

When `include_empty=true`, the count of registered parents with **zero monitoring submissions** is added to the result value.

### FR-2 — Applies to `option_value` mode only

`include_empty=true` is meaningful only when `option_value` is also provided (single-value filter mode). For all other modes (`group_by=option`, count mode, etc.) the flag is ignored with no error.

### FR-3 — Monitoring forms only

The flag is silently ignored when the requested form has no parent (registration-only forms). The same scope guard as `include_unanswered`.

### FR-4 — Count mode behaviour

```
value = count(option_value answers) + count(parents with zero monitoring submissions)
      = 3 + 92 = 95
```

### FR-5 — Percentage mode behaviour

```
numerator   = count(option_value answers) + count(never-monitored parents)
            = 3 + 92 = 95
denominator = total_parents_in_scope (all registered, respecting admin filter)
            = 105
value       = 95 / 105 × 100 = 90.48%
```

The denominator is `_total_parents_in_scope` — **not** the monitored EPS count.

### FR-6 — Filter parity

`include_empty` respects `administration_id` and `parent_criteria` filters. The "never monitored" pool is narrowed to the same parent universe as the option count.

### FR-7 — `include_unanswered` unchanged

No changes to `include_unanswered` semantics. Both flags can coexist; `include_empty` takes precedence when both are supplied for `option_value` mode.

### FR-8 — No frontend React changes

Only the JSON config (`api` block) and backend need to change. No new React components or hooks are required.

---

## Dashboard config changes required

File: `frontend/src/config/visualizations/1749623934933.json`

| Item id | Current api params | Required change |
|---------|-------------------|----------------|
| `kpi_under_construction` | `include_unanswered: true` | Replace with `include_empty: true` |
| `kpi_under_construction_pct` | (was incorrectly set in prev session) | Replace with `include_empty: true` |

The two `kpi_under_construction_*` cards share the same underlying query (construction monitoring form, `option_value=no`, `sum_by=parent_id`). Only the `value_type` differs (`number` vs `percentage`).

---

## Out of scope

- `include_empty` for `group_by=option` / donut charts → use existing `include_unanswered`
- `include_empty` for registration forms → guard in place, flag silently ignored
- `include_empty` + `group_by=month` time series → deferred
- Splitting "never visited" vs "visited but skipped" into separate buckets → deferred
