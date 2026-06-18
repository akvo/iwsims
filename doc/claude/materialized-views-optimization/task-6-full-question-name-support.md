# Task 6: Full `question_name` Support Across All Dashboard Endpoints

## Context — why this change

Task 5 added `question_name` to **one** code path only: `/visualization/values?question_name=…`,
served by `get_values_by_question_name()` over `mv_cross_form_latest`. That path is
**global (cross-form)** but **feature-poor** — it supports only basic number/option/text
aggregation, `group_by=option|parent_id`, count mode, and a recency/date-window filter on
the submission timestamp. It does **not** support: `group_by=month|date`, `stack_by`,
`date_question` bucketing, `criteria`, `repeat_agg`, etc.

Every other dashboard surface is **`question_id`-only, end to end** (serializer → function →
MV/Answers query → frontend hook):

| Endpoint / surface | Function | Question ref today |
|---|---|---|
| `/values` (rich path) | `values_functions.handle_count_mode / handle_option_question / handle_number_question` | `question_id` (+ `date_question_id`) |
| `/escalation/{form_id}` | `escalation_functions.handle_escalation` | criteria/columns carry `qid` |
| `/progress/{form_id}` | `progress_functions.handle_progress` | components/filter/scope carry `qid` |
| `/values/formula` (map) | `views.visualization_values_formula` + `formula.py` | conditions carry `question_id` |

**Consequence:** the config generator (`scripts/visualization-config/visualization_config.ipynb`)
**cannot** emit pure `question_name` configs — any chart needing a rich feature (notably
`metric_card`, which uses a date question / rich aggregation) falls back to emitting
`question_id`. This is the observed "metric_card still produces question_id" symptom.

**Goal of this task:** make **all** dashboard endpoints accept `question_name`, so the
generator and frontend configs can be pure-global-`question_name`, while keeping every JSON
response shape **byte-identical** (frontend display/render components must not change — only
the request-builder hooks change). Reduce duplication along the way.

**Non-goal:** changing response envelopes, chart rendering, or the meaning of "global"
question_name (still resolved per the notebook's pure-global convention).

---

## Key enabler

`mv_answer_denormalized` carries **both** `question_id` **and** `question_name`
(see `models.py:50-72`, column `question_name` at line 59). Every existing MV filter of the
form `question_id=<qid>` is always scoped by `data_id__in=<one form's data ids>`. Within a
single form, `question_name` is unique and maps 1:1 to `question_id`. Therefore:

> Replacing `question_id=<qid>` with `question_name=<qname>` on `mv_answer_denormalized`
> (and `mv_parent_aggregates`, which also has `question_name`) is **behaviour-preserving**
> inside the form-scoped data_id sets these functions already use.

`mv_cross_form_latest` is already keyed by `question_name`. `Answers` (base table) has no
`question_name`, but supports the FK join `question__name=<qname>`. `QuestionOptions`
supports `question__name=<qname>` (already used by `_values_by_qname_option`).

---

## Design principle: **name-only** grammars (no qid↔name resolver)

> **Decision (revised):** the dashboard grammar endpoints (escalation / progress / formula)
> and the cross-form `/values` path are **name-only** — they accept `question_name` strings
> and **do not** accept legacy integer `question_id`. We therefore **do not build the
> qid→name resolver (`qname_functions.py` / Part A)**.
>
> **Why this is safe here:** these endpoints have **no external or mobile callers** — every
> consumer is an in-repo `frontend/src` dashboard hook, and all configs are being converted to
> `question_name`. With no legacy `qid` traffic to support, the dual-accept resolver buys
> nothing and adds cost (an `lru_cache` with staleness/test-flakiness/cold-N+1 baggage).
> See **Performance considerations** below and the **Testing** section for what replaces the
> id↔name parity net.

All grammars (criteria / columns / components / formula conditions) and scalar question params
carry a **`question_name` string directly**. Downstream code only ever deals with names and
filters the **indexed** MV columns by `question_name`.

This gives:
- **Simplicity:** no resolver module, no `lru_cache`, no name-vs-id forks — serializers read
  the name string and pass it through.
- **Full `question_name` support:** every endpoint is name-native.
- **One guard, not a resolver:** the serializer **rejects a digits-only `question_name`** with
  a 400 (a numeric token almost certainly means a caller still sending a legacy `question_id`),
  so a stray id can never be silently treated as a literal name that matches nothing.

**Performance considerations**

- **No id→name lookups at all** — names are used as-is, so none of the resolver's caching
  concerns (staleness, `cache_clear` in tests, cold-cache N+1) exist.
- **Filter MVs, not base `Answers`, by name.** `Questions.name` is unindexed (`CharField`, no
  `db_index`); always filter the **indexed** MV columns (`idx_mv_answer_question_name`,
  `idx_mv_cross_form_qname`, `idx_mv_parent_agg_question_name`) — see Part C item 1 / Part H
  item 2. This is the one mandatory perf rule regardless of the name-only decision.

**Trade-off accepted (breaking change):** any request still carrying an integer `question_id`
on these endpoints will **400** (via the numeric-token guard). That is intentional and only
acceptable because no external caller exists; **all** configs must be name-only before deploy
(Part J), and the id↔name parity tests are replaced by direct name-correctness tests
(Testing section).

---

## Part A — name validation guard (NEW, tiny) — **no resolver**

We do **not** add `qname_functions.py` / `to_qname`. Instead, a one-function guard rejects a
legacy `question_id` slipping in as a `question_name`. Put it wherever the serializers live
(e.g. top of `dashboard_serializers.py`):

```python
from rest_framework import serializers


def validate_qname(token):
    """A grammar/scalar question token must be a question_name string, not a
    legacy question_id. Reject digits-only tokens with a clear 400 so a stray
    id is never silently treated as a literal name that matches nothing."""
    if token is None:
        return None
    s = str(token)
    if s.isdigit():
        raise serializers.ValidationError(
            f"Expected a question_name, got a numeric id '{s}'. "
            "Dashboard endpoints are question_name-only."
        )
    return s
```

> No `lru_cache`, no DB lookup, no caching/staleness/test-flakiness concerns — names are used
> as-is. The only DB-perf rule is "filter the indexed MV columns by `question_name`, never the
> unindexed `Questions.name` on base `Answers`" (Part C item 1 / Part H item 2).

---

## Part B — serializers: name-only grammars + scalar params

**File:** `backend/api/v1/v1_visualization/dashboard_serializers.py`

Today the grammars hard-cast the question segment with `int(parts[1])` / `int(parts[2])`.
Change them to **take the question segment as a `question_name` string**, passing each through
`validate_qname()` (Part A) so a stray numeric id is rejected with a 400.

1. `parse_criteria_string` (lives in `functions.py:308`, used by `ValuesFilterSerializer`,
   `EscalationFilterSerializer.validate_filter_criteria`, `ProgressFilterSerializer`, **and the
   two map serializers `GeoLocationFilterSerializer.validate_criteria` and
   `FormulaValuesSerializer.validate_criteria`**): change `qid = int(parts[1])` →
   `qname = validate_qname(parts[1])`; each parsed criterion's question segment is a **name
   string**. `overdue` keeps two question segments, both validated as names. Because this parser
   is shared, the **map view** (`GeolocationListView`) and the **map formula endpoint**
   (`visualization_values_formula`) become name-only automatically — their `criteria` param must
   now carry `question_name`.
2. `EscalationFilterSerializer.validate_criteria` (lines 214-252): same — store names in
   `parts`.
3. `EscalationFilterSerializer.validate_columns` (lines 254-288): `col["question_id"] =
   int(parts[2])` → `col["question_name"] = validate_qname(parts[2])`.
4. `ProgressFilterSerializer.validate_components` (lines 333-410): `question_ids = [int(q)…]`
   → `question_names = [validate_qname(q) …]`. **Rename the key to `question_names`** and update
   the formula handlers (Part F).
5. Scalar params — **rename id params to name params** (name-only):
   - `ValuesFilterSerializer`: replace `date_question_id` with `date_question_name`
     (CharField). Also add an **optional** `parent_form_id` (IntegerField, `required=False`) —
     passed straight to `get_values_by_question_name` to scope the cross-form query to one
     registration family; when omitted the query stays national / cross-family (Part C item 5).
   - `EscalationFilterSerializer`: `date_question_name`,
     `completion_question_name`/`deadline_question_name`.
   - `ProgressFilterSerializer`: `filter_question_name`, `scope_question_name`,
     `date_question_name`.
6. `ValuesFilterSerializer.validate()` (lines 84-174): the same-form/parent-form criteria
   split currently matches by `Questions.pk`. Match by `Questions.name` instead (see Part C
   `split_criteria_by_form`). Two name-keyed `/values` routes coexist: **global / cross-form**
   (`question_name`, no `form_id`, optionally `parent_form_id`) → `get_values_by_question_name`
   (Part C); and **form-scoped** (`form_id` + `question_name`) → resolve the question within the
   form and route to the rich handlers (Part D), which key off `question.name`/`question.type`.

> All consumers (configs + frontend hooks) emit names. There is **no** `question_id` accept
> path on these endpoints — a numeric token is a 400 (Part A guard). Existing tests that sent
> ids must be rewritten to names (Testing section).

---

## Part C — `functions.py`: criteria matching, split, date subqueries by name

**File:** `backend/api/v1/v1_visualization/functions.py`

1. `_criterion_matching_ids` (line 367): the `parts` question segment is now a **name**.
   **Route this through `mv_answer_denormalized` (which has `idx_mv_answer_question_name`),
   not the base `Answers` table** — `Questions.name` is **unindexed** (`CharField`, no
   `db_index`), so `Answers.objects.filter(question__name=…)` would add a join + a seq-scan
   on `question.name`. Use
   `MVAnswerDenormalized.objects.filter(data_id__in=…, question_name=qname, answer_options__contains=[v])`
   (and `answer_value__gt`/`__lt` for thresholds). The MV is form-scoped by `data_id__in`, so
   results are identical to the old `question_id` filter — and this is also Part H item 2
   (one indexed MV path for all criteria matching). The AND-narrowing semantics are unchanged.
2. `split_criteria_by_form` (line 468): match by name instead of pk:
   `Questions.objects.filter(name__in=qnames, form_id=form_id)` → build the on-form / on-parent
   sets of **names**; compare `c["parts"][0]` against those name sets.
3. Date subqueries — `date_question_id` is now `date_question_name`:
   - `latest_monitoring_subquery` (line 262): `Answers.objects.filter(data=…,
     question__name=date_qname)`.
   - `get_base_monitoring_qs` date branch (lines 547-564): `Answers.objects.filter(
     data__form_id=…, question__name=date_qname, …)`.
   - `get_latest_monitoring_from_mv` date branch (lines 150-171): filter
     `MVAnswerDenormalized.objects.filter(question_name=date_qname, …)`.
   - `build_date_filters` (line 208): collect `date_question_name` instead of
     `date_question_id`.
4. `get_values_by_question_name` (lines 685-745) — **keep** as the global (no-`form_id`)
   path. Optionally extract its option-dedup block into a shared helper reused by Part D
   (see Part H). No behavioural change.
5. **Parent-family scoping (new `parent_form_id` column).** `mv_cross_form_latest` now
   carries `parent_form_id` (the parent's registration form) + index
   `idx_mv_cross_form_parent_form_qname (parent_form_id, question_name)`. Add an **optional**
   `parent_form_id` to the params of `get_values_by_question_name`; when present,
   `qs = qs.filter(parent_form_id=parent_form_id)`. This scopes a cross-form `question_name`
   query to a single registration family. **Omit it for a national / cross-family overview**
   — the filter is additive, so the existing global behaviour is the default. Required because
   colliding names (e.g. `ph` lives in 4+ forms across families) would otherwise aggregate
   every family's parents. Plumb the param through the serializer + endpoint (Part B) and emit
   it from the generator (Part J); configs already carry `parent_form_id` at the top level.

---

## Part D — `values_functions.py`: rich handlers by `question_name`

**File:** `backend/api/v1/v1_visualization/values_functions.py`

The three handlers currently receive a `question` (Questions instance) and filter
`mv_answer_denormalized` by `question.id`. Change them to operate on `question_name`
(+ `question_type` for routing):

1. Signatures: `handle_option_question(form, question_name, question_type, params)` and
   `handle_number_question(form, question_name, params)` (count mode already has no question).
   The view (Part G) passes `question.name`/`question.type`.
2. Replace **every** `question_id=question.id` on `MVAnswerDenormalized` with
   `question_name=question_name` (≈ lines 146-150, 167, 184-188, 289-297, 307, 406-409,
   432-436, 473-477, 482-486, 510, 597-601, 691-695, 709-713, 761-771, 784-788, 822-833,
   927-937, 1040-1043, 1066-1086, 1112-1125, 1151-1170, 1211-1235, 1284-1303).
3. `date_question_id` param → `date_question_name` everywhere it is read
   (`_count_group_by_month/date`, `_number_group_by_*`, `_stack_*`).
4. Option metadata: `handle_option_question` builds `options` via
   `QuestionOptions.objects.filter(question=question)` (line 346). Replace with a
   **dedup-by-value** fetch over `question__name=question_name` (reuse the dedup logic from
   `_values_by_qname_option`, `functions.py:846-857`). Extract that into a shared
   `get_options_by_qname(question_name)` helper (Part H) returning ordered, de-duplicated
   options with `value/label/color/order`.
5. `_extract_criteria_option_values(params, question.id)` (line 374 call, def line 540):
   change the parameter to `question_name` and compare `parts[0] == question_name`.
6. `_stack_option_by_parent` (line 1099): `MVParentAggregates.objects.filter(form_id=…,
   question_id=question.id, …)` → `question_name=question_name`. (`mv_parent_aggregates`
   has `question_name`.)

> All these queries are already scoped by `data_id__in=data_ids` (one form), so name↔id is
> 1:1 → identical output.

---

## Part E — `escalation_functions.py`: criteria/columns/caches by name

**File:** `backend/api/v1/v1_visualization/escalation_functions.py`

1. `build_escalation_criteria_filter` (line 19): `parts` segments are now names. Replace
   `question_id=qid` with `question_name=qname` for `option_equals`, `threshold_gt`,
   `threshold_lt`, and the two `overdue` segments (completion/deadline).
2. `build_column_caches` (line 107): collect **names** (`answer_qnames`,
   `parent_answer_qnames`, `latest_date_qnames`) from `col["question_name"]`; key the caches
   by `(data_id, question_name)`; filter `MVAnswerDenormalized` with
   `question_name__in=…`.
3. `extract_column_value` (line 180): read `col.get("question_name")` and look up
   `caches[...].get((latest_id, qname))`.

Response (`{count,next,previous,results}` with column keys from `columns=`) is unchanged.

---

## Part F — `progress_functions.py`: components/filter/scope by name

**File:** `backend/api/v1/v1_visualization/progress_functions.py`

1. `FORMULA_HANDLERS` (`compute_any_yes` etc., lines 17-90): iterate `question_names`,
   look up `answers_map.get((latest_data_id, qname))`. (Rename the `question_ids` arg to
   `question_names` to match Part B item 4.)
2. `build_progress_answers_map` (line 128): gather `qnames` from
   `c.get("question_names", [])`; filter `MVAnswerDenormalized.objects.filter(
   data_id__in=…, question_name__in=qnames)`; key the returned map by
   `(data_id, question_name)`.
3. `handle_progress` (line 179): `filter_qid`→`filter_qname`, `scope_qid`→`scope_qname`;
   the `filter_question` and `scope` `MVAnswerDenormalized` filters use `question_name=…`.

Response (`{histogram, details}`) unchanged.

---

## Part G — `formula.py` + map view by name

**Files:** `backend/api/v1/v1_visualization/formula.py`, `views.py`

1. `formula.py` — flip the evaluator from `question_id`-keyed to `question_name`-keyed
   (it's currently `qid` end to end). Per-function checklist:
   - **`_match` (line 42-48):** `qid = condition.get("question_id")` →
     `qname = condition.get("question_name")`; `answers_by_qid.get(qid)` →
     `answers_by_qname.get(qname)`. The op handling (numeric / `between` / `option_equals` /
     `option_in`) is **unchanged** — only the lookup key changes. (This grammar uses `==`/`!=`,
     a JSON map-filter grammar independent of VizCalc — leave the ops alone.)
   - **`evaluate` (line 72):** rename the param `answers_by_qid` → `answers_by_qname`
     (pass-through to `_match`).
   - **`pick_latest_repeat` (line 92-117):** key the returned map by **`question_name`** — read
     `ans.question_name` (attr) or dict `"question_name"` instead of
     `question_id`/`"question"`/`"question_id"`; returns `dict[question_name -> row]`.
     ⚠️ **Coupled with item 2:** the rows fed in must *carry* `question_name`, so the rows must
     come from `mv_answer_denormalized` (base `Answers.values("question_id", …)` has no name).
   - **`validate_shape` (line 148-152):** require `"question_name"` (not `"question_id"`) in
     each condition; update the error message string. This is what rejects un-migrated
     `question_id` map-filter formulas (consistent with the name-only breaking change).
   - **Docstrings (lines 8-11 + `pick_latest_repeat`):** they describe `answers_by_qid` /
     `question_id` — update to `question_name`. No new imports (keep the file Django-free).
   - **`FormulaValuesSerializer` (`serializers.py`):** require `question_name` in conditions;
     run each through `validate_qname` so a numeric id is a 400.
2. `views.visualization_values_formula` (line 487): the answers map is built from `Answers`
   keyed by `question_id` (lines 551-557). Build it keyed by **`question_name`** instead —
   read from `mv_answer_denormalized` (has indexed `question_name`); **avoid the base `Answers`
   join on the unindexed `question__name`** (Part H item 2). `pick_latest_repeat` then produces
   `{question_name: row}`.
3. **`GeolocationListView` (map markers, `views.py:316`).** It consumes the **same `criteria`
   grammar** via `GeoLocationFilterSerializer.validate_criteria` → `parse_criteria_string`
   (Part B item 1) → `apply_criteria_to_monitoring_qs` → `_criterion_matching_ids` (Part C item
   1, now MV-indexed). So it becomes name-only automatically — no separate code change — **but**:
   - The map's `criteria` param must carry `question_name` (frontend map builder, Part I) and
     the map-filter `formula.buckets[].…question_id` in the configs must become `question_name`
     (Part J).
   - ⚠️ **Silent-empty caveat:** `GeolocationListView` returns `[]` with **HTTP 200** when the
     serializer is invalid (`views.py:320-325`), not a 400. So a stale **numeric** criterion
     rejected by `validate_qname` yields a **blank map with no error**. Migrate the frontend map
     criteria in lockstep; consider surfacing/logging the validation error instead of swallowing
     it so a misconfigured map fails loudly.
   - Its `from_date`/`to_date` filter `children__created`/`created` (real timestamps), **not** a
     date question — so the `date_question_name` rename (Part C item 3) does **not** affect it.

Response (`{data:[{group,label}]}`) unchanged.

---

## Part H — consolidation / functions to simplify (reduce complexity)

> **Reality check (updated after implementation).** The MV optimization's *core* goal —
> eliminating query complexity (N+1 / correlated-subquery aggregation → single MV reads) — is
> **already achieved**. Measured MV-vs-base-table usage: `values_functions.py` 36:4,
> `functions.py` 12:7, `escalation_functions.py` 8:2, `progress_functions.py` 7:1. The residual
> line count is **feature breadth** (value-type × group-dimension × latest-mode × date-source),
> **not** removable duplication. The aggressive `−40%` collapse below turned out **not** to be a
> safe mechanical merge — see "What is NOT a safe win". Do not treat the original targets as a
> backlog; treat this section as the record of what was done and why the rest was deliberately
> deferred.

### Status (implemented)

- ✅ **Item 2 — one indexed MV path for criteria matching (CHOSEN, done).**
  `_criterion_matching_ids` now matches `mv_answer_denormalized` by `question_name`
  (`idx_mv_answer_question_name`), not base `Answers` (unindexed `Questions.name` → seq scan).
  Escalation already did. (Commit: criteria grammar; see Part C item 1.)
- ✅ **`utils/functions.py` — `_typed_value` extracted.** `get_answer_value` /
  `get_answer_history` now share one type-branch helper (geo/option/multi→options, number→value,
  else→name); the administration branch stays per-function (they differ on webform/None).
  +6 unit tests; 425 caller tests green.
- ✅ **`values_functions.py` — safe extractions.** `_date_answer_sq(date_qname)` (the OuterRef
  date subquery, 3→1) and `_finalize_month` / `_finalize_date` (the gap-fill + labels + return
  tail). Behaviour-preserving; suite green. (1341→1334 ln — small, because the rest is *not*
  safely mergeable.)

### Item 3 — KEEP the global path (still true)

**Keep** `get_values_by_question_name` + `_count_parents_by_qname` /
`_values_by_qname_number|option|text` / `_apply_qname_date_filter`: they serve the genuine
**global (no-`form_id`)** case the form-scoped handlers can't. Reinforced by the
`parent_form_id` family-scope filter (Part C item 5), which makes this path *more* capable.

### What is NOT a safe win (investigated, deferred)

- ❌ **Item 1 — `get_options_by_qname` shared option-dedup: not a trivial extraction.** The two
  impls return **different shapes**: `functions.py:_values_by_qname_option` yields dicts
  `{value,label,color}`; `values_functions.py:handle_option_question` yields `QuestionOptions`
  **model instances** (downstream uses `opt.label`/`opt.value` attribute access across the stack
  functions). Unifying them requires changing option access throughout `values_functions.py` —
  real churn/risk for little gain. Deferred.
- ❌ **The `−40%` `values_functions.py` matrix collapse is not a mechanical merge.** The
  `_{count,number,option,stack}_group_by_{month,parent,date,id}` cells differ **intentionally**:
  (a) **data source** — e.g. `_count_group_by_month` not-latest+no-date counts the **FormData**
  qs (`count(id)`, includes answerless submissions) while other branches read the MV
  (`count(distinct data_id)`); (b) **aggregation** — count uses `Count(distinct)`, number uses
  `Avg/Sum/agg_func`; (c) **edge branches** — `_stack_option_by_parent_legacy` registration-form
  fallback; (d) **dynamic date windows** — non-materializable. A genuine collapse needs a careful
  generic-helper *redesign* (`group_rows(qs, value_type, dimension, value_extractor)`), the
  highest-risk change in the task — deferred to a dedicated, reviewed pass, not rushed.
- ❌ **"Extend MV coverage to delete the fallbacks" — bad tradeoff.** Investigated: the residual
  fallbacks are mostly **non-materializable** (`latest_monitoring_subquery` / `get_base_monitoring_qs`
  date-window paths — arbitrary `from_date..to_date` can't be pre-materialized) or **necessary**
  (`_stack_option_by_parent_legacy` is the all-submissions path; `mv_parent_aggregates` is
  latest-only by design). The only deletable target (~80 ln of `_legacy`, which already queries
  `mv_answer_denormalized`) would require a **new all-submissions aggregate MV** — adding refresh
  cost on every write + a migration/model/refresh-path — to remove working code. Net: *more* MV
  surface to maintain. Not worth it.

> Per this folder's CLAUDE.md, prefer additive/consolidating changes; do not delete a function
> unless its callers are all migrated and tests stay green. List any removal explicitly in the
> PR description.

### Impact of the `mv_cross_form_latest.parent_form_id` column

Adding `parent_form_id` to the cross-form view changes the view's **capability**, not the
consolidation math — this section stays as written, with two clarifications:

- **It does *not* make `values_functions.py` simpler, and the two value paths still cannot
  merge.** They differ in the *shape* of data, not in form-scoping: `mv_cross_form_latest` is
  **pre-collapsed to `rn=1`** (exactly one latest row per `(parent_id, question_name)`), so it
  can never serve `group_by=month|date`, `stack_by`, `criteria`, or `repeat_agg` — those need
  the full per-answer rows in `mv_answer_denormalized`. The `_{count,number,option,stack}_
  group_by_{month,parent,date,id}` matrix therefore still exists — and (per "What is NOT a safe
  win") its branches differ intentionally, so the `−40%` figure is a **redesign** estimate, not
  a mechanical target; deferred.
- **It slightly *grows* the kept global path** (item 3), so the `functions.py` reduction is a
  hair smaller: `get_values_by_question_name` gains an optional `parent_form_id` param + one
  `.filter()` (Part C item 5). This also **reinforces "keep"** — the path is now the
  *family-scoped* global path and is more capable, so folding/deprecating it is even less
  attractive.
- **Runtime opportunity (not a line-count cut):** most generated configs are "latest-per-parent
  within a family" semantics (`COUNTDISTINCT`/`RECENT`/`PERCENT`/`COMPLIANT`/`DISTRIBUTION`),
  which `mv_cross_form_latest` + `parent_form_id` now serves natively. More charts can be
  *routed* to this lean path instead of the heavy handlers — a performance/clarity win, but it
  does not delete the heavy path (trend/stack/criteria still need `mv_answer_denormalized`).

### Reduction targets — original estimate vs reality

Inventory now (post-Task-6): `values_functions.py` ~1334 ln · `functions.py` ~955 ln ·
`escalation_functions.py` ~338 ln · `progress_functions.py` ~334 ln ·
`backend/utils/functions.py` ~105 ln. The original `−40%` estimate assumed the matrix was
mechanically mergeable; it is not (see "What is NOT a safe win"). Status per file:

| File | Original estimate | Actual outcome |
|------|-----|--------------------------|
| **values_functions.py** | ~13 fn / ~800 (**−40%**) | **Deferred — redesign, not a merge.** Safe extractions done (`_date_answer_sq`, `_finalize_month/_date`). The matrix cells differ intentionally (FormData-vs-MV source, distinct-vs-plain count, registration fallback, dynamic date windows), so the `−40%` needs a careful `group_rows(...)` redesign — highest-risk change, deferred. `_stack_option_by_parent_legacy` can't be deleted (it's the all-submissions path; `mv_parent_aggregates` is latest-only). |
| **functions.py** | ~26 fn / ~720 (**−22%**) | **Mostly deferred.** Item-1 option-dedup share blocked (different option shapes). The two correlated-subquery builders **both stay** — `latest_monitoring_subquery` is needed for dynamic date-windows *and* in-transaction tests, so it can't be dropped. `format_*`/`fill_*` already live here and `values_functions` imports them (no duplication). |
| **progress_functions.py** | ~0 | Done — only the Task-6 rename (`question_ids`→`question_names`, filter/scope/date by name). |
| **escalation_functions.py** | ~0 | Done — key-by-name change (criteria + columns). `_answer_cell_value` fold not pursued (cosmetic). |
| **utils/functions.py** | ~−15 ln | ✅ **Done** — `_typed_value` extracted (net slightly larger with its docstring + the 6 unit tests, but duplication removed). |

**Reality:** the only legacy fallbacks the original plan assumed could "go once the MV is
authoritative" turned out to be **inherent** (dynamic date windows, all-submissions mode,
denominators) — not deletable without adding *more* MV machinery than they remove. So Part H
delivered the safe consolidations (criteria→indexed-MV, `_typed_value`, the `values_functions`
helper extracts) and correctly **stopped short** of the matrix redesign, which remains an
optional, separately-reviewed effort guarded by the name-correctness test suite.

---

## Part I — frontend request-builder hooks (emit names)

**Files:** `frontend/src/pages/bi/hooks/useDashboard{Values,Escalation,Progress}.js`,
`frontend/src/pages/bi/.../useMapByParent.js`, `frontend/src/lib/dashboardFilterHints.js`.

Only the **request builders** change; display components (ChartRenderer, EscalationTable,
progress/metric widgets, map renderer) stay untouched because responses are identical.

- `serializeCriteria`: `${type}:${question_name}:${value}` (and `overdue:${completion_name}:${deadline_name}`).
- `serializeColumns`: `${key}:${source}:${question_name}`.
- `serializeComponents`: `${key}:${formula}:${question_names.join(":")}` (+ `@types`, `:total_items`).
- `expandApiHints` / `applyDashboardFilters` (`dashboardFilterHints.js`): emit
  `date_question_name`, `completion_question_name`/`deadline_question_name`, and
  `criteria=option_equals:${question_name}:${value}`.
- `useMapByParent`: build formula conditions with `question_name`; read
  `activeFilter.question_name`.
- **`parent_form_id` inheritance (default-from-root, override per-api).** The request
  builder that issues `/values` calls (`useDashboardValues`, today in
  `frontend/src/util/hooks/`, consumed by `KPICard`/`MetricCard`/chart widgets) resolves the
  effective `parent_form_id` as:
  `effective = api.parent_form_id !== undefined ? api.parent_form_id : rootConfig.parent_form_id`
  and sends it **only for cross-form requests** (a `question_name` api block with **no**
  `form_id`). Rules:
  - **Default:** inherit the dashboard's root `parent_form_id` (every config already declares
    it at the top level) → cross-form `question_name` charts are family-scoped automatically,
    no per-chart wiring.
  - **Override:** an `api` block may set its own `parent_form_id` to target a *different*
    family.
  - **Opt out (national / cross-family):** set `"parent_form_id": null` in the `api` block →
    the param is omitted and the query spans all families (Part C item 5).
  - Form-scoped api blocks (those with `form_id`) ignore this entirely — they don't hit the
    cross-form path.

The config field that previously held `question_id` now holds `question_name`. **The backend is
name-only — it no longer accepts ids on these endpoints (a numeric token is a 400, Part A), so
hooks + configs must cut over together, not independently.** Run ESLint in the container:
`./dc.sh exec -T frontend npx eslint <path>`.

---

## Part J — notebook generator + config conversion

**Files:** `scripts/visualization-config/visualization_config.ipynb`,
`scripts/visualization-config/normalize_csv.ipynb`, the two OLD configs
`frontend/src/config/visualizations/1749621221728.json` (RWS) and `1749623934933.json` (EPS).

1. In `build_item()` / the chart-type builders, emit `question_name` for **all** chart types —
   including `metric_card` — and emit `date_question_name` (not `date_question_id`) and any
   other question params (`completion_question_name`, `deadline_question_name`,
   `scope_question_name`, `filter_question_name`). With Part D giving `metric_card` the rich
   features over names, the qid fallback is removed. **Do not emit a per-chart `parent_form_id`
   for the normal case** — the hook inherits it from the root config (Part I, default-from-root).
   The generator emits `parent_form_id` inside an `api` block **only** to override the family,
   or as `"parent_form_id": null` to opt a chart out into a national / cross-family view
   (Part C item 5).
2. Convert the two OLD config files to pure-global `question_name`, using the
   `question_id → question_name` map derived from the family form JSONs in
   `backend/source/forms/` (e.g. RWS registration `3_1749621221728.prod.json`:
   `1749621221731=project_name`, `1749621329696=village_name`,
   `1749622291234=project_target_group`, `1749622571775=implementing_agencies`,
   `1749622701234=construction_start_date`, `1749622715678=water_committee`,
   `1749622652941=wsmp_submitted`, `1749622675800=wsmp_approved`; and the monitoring forms for
   the rest). On name collisions across the family, prefer the comprehensive monitoring form
   over Quick monitoring (matching the notebook's `qname_map` rule). Keep `form_id` only where
   intrinsically needed (registration-count cards, table source, map `source_form_id`).

### Review findings — existing `question_name` charts already over-count (parent-family bleed)

The two OLD configs are **partially** migrated: three charts already use cross-form
`question_name` with **no family scope**, and two of them currently aggregate across families
(verified against `mv_cross_form_latest`):

| Config / chart | `question_name` | Families in MV | Today (unscoped) | Correct |
|---|---|---|---|---|
| EPS `chart_test_method` | `water_testing_method` | EPS 82 + WTP 44 | **126** ❌ | 82 |
| RWS `chart_test_method_half` | `water_test_type` | RWS 54 + EPS 10 | **64** ❌ | 54 |
| EPS `chart_operational_status` | `system_status` | EPS 149 | 149 ✅ (today) | 149 — unscoped, future-fragile |

Once Part C item 5 + Part I inheritance land, these are fixed **automatically** by the
root-config `parent_form_id` default — no per-chart edits needed (this is the main reason to
prefer default-from-root over per-chart emission). No action beyond verifying the numbers
after wiring.

**Verified (id→name resolution, against the `Questions` table):** all `question_id` references
in both OLD configs resolve — **EPS 31/31** unique ids, **RWS 37/37**. The `1849…` ids in
`progress_construction` are **real construction sub-questions** (e.g.
`1849633499999 = concrete_base_construction_2m_x_2m_square_base`,
`1849633720001 = urf_tank_current_status`), just a different id range from the `1749…`
project_info group — **not** placeholders. The **only** stub is the `drainage` component
(`question_ids: []` + `"note": "Formula pending definition"`, `hide: true`): leave it empty
during conversion (no `question_names` to emit) until its formula is defined. No ids to drop.

---

## Breaking change & correctness guarantee (name-only)

- **Breaking:** these endpoints (escalation / progress / formula, and the cross-form `/values`
  path) **no longer accept `question_id`** in grammars/columns/components/conditions or scalar
  params — a numeric token returns **400** (Part A guard). This is safe because the endpoints
  have **no external/mobile callers** (verified); all consumers are in-repo and migrate to
  names in the same change.
- **Correctness:** because every MV filter is scoped to one form's `data_id` set (and
  `question_name` is unique within a form), name-based filtering returns the **same rows** the
  id-based filter used to. We prove this with **direct name-correctness tests** (below) rather
  than an id-vs-name parity cross-check (which no longer exists, since ids are rejected).
- **Testing — replace parity with name-correctness:** rewrite the `question_id`-based cases in
  `tests/tests_question_name.py` to use `question_name`, and assert each chart/table/histogram
  payload against **known seeded rows** (e.g. "EPS family has N parents with `ph` ≤ 0"). Add a
  case asserting a **numeric `question_name` → HTTP 400**. The form-scoped (`form_id` +
  `question_name`) and cross-form (`question_name` [+ `parent_form_id`]) routes each get
  coverage, including the family-scope vs national `parent_form_id` behaviour (Part C item 5).

---

## Verification

```bash
# Backend unit tests (rewritten to question_name; must be green)
./dc.sh exec backend python manage.py test api.v1.v1_visualization

# Lint
./dc.sh exec backend flake8 api/v1/v1_visualization

# Cross-form values: family-scoped vs national (parent_form_id optional)
curl "http://localhost:8000/api/v1/visualization/values?question_name=ph&parent_form_id=<REG_FORM>&group_by=parent_id"
curl "http://localhost:8000/api/v1/visualization/values?question_name=ph&group_by=parent_id"   # national

# Form-scoped values by name
curl "http://localhost:8000/api/v1/visualization/values?form_id=<F>&question_name=<NAME>&group_by=option"

# A numeric question_name must 400 (Part A guard)
curl -i "http://localhost:8000/api/v1/visualization/values?form_id=<F>&question_name=1749630516826&group_by=option"

# Escalation / progress / formula with names
curl "http://localhost:8000/api/v1/visualization/escalation/<F>?monitoring_form_id=<M>&criteria=overdue:proposed_completion_date:proposed_completion_date&columns=name:parent_name,date:latest_date:inspection_date"
curl "http://localhost:8000/api/v1/visualization/progress/<F>?monitoring_form_id=<M>&components=base:any_yes:water_committee"

# Frontend hook tests + eslint (in container)
./dc.sh exec -T frontend npx jest src/pages/bi
./dc.sh exec -T frontend npx eslint src/pages/bi src/lib/dashboardFilterHints.js
```

**End-to-end:** rebuild a config via the notebook → confirm output has **no** `question_id`
(only `question_name` / `*_question_name`) → load the dashboard for that family and confirm
charts, escalation table, progress histogram, and map render correctly (and family-scoped where
`parent_form_id` applies).

---

## Suggested execution order (sub-tasks)

1. Part A (validation guard) + Part B (serializers, name-only) — **breaking**; land with the
   config conversion (Part J) so nothing sends ids.
2. Part C–G (functions filter by name, via indexed MV) — keep tests green after each module.
3. Part H (consolidation) — only what keeps tests green.
4. Part I (frontend hooks) + Part J (notebook + config conversion).
5. Rewrite `tests_question_name.py` to name-correctness (+ numeric-name-400 case).

## Files touched (summary)

| Area | Files |
|---|---|
| New | *(none — `validate_qname` lives in `dashboard_serializers.py`; no `qname_functions.py`)* |
| Serializers | `dashboard_serializers.py` (+ `validate_qname`), `serializers.py` (FormulaValuesSerializer) |
| Functions | `functions.py`, `values_functions.py`, `escalation_functions.py`, `progress_functions.py`, `formula.py` |
| Views | `dashboard_views.py`, `views.py` (formula map) |
| Frontend | `useDashboard{Values,Escalation,Progress}.js`, `useMapByParent.js`, `dashboardFilterHints.js` |
| Generator/config | `visualization_config.ipynb`, `normalize_csv.ipynb`, `1749621221728.json`, `1749623934933.json` |
| Tests | `tests/tests_question_name.py` (rewritten to name-correctness + numeric-name-400) |

## Dependencies

- Tasks 1–5 complete (MVs exist & populated). `mv_answer_denormalized.question_name` and
  `mv_parent_aggregates.question_name` are the load-bearing columns.
