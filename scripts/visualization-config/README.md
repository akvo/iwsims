# Visualization Config Generator

Turns the hand-authored calculation spreadsheets in `source/` into visualization config
skeletons in `output/`, via two notebooks:

```
source/*.csv  →  normalize_csv.ipynb  →  normalized/*.csv  →  visualization_config.ipynb  →  output/<form_id>.json
```

Run both from this directory (`scripts/visualization-config/`).

- **`normalize_csv.ipynb`** — indexes the `*.prod.json` forms, keeps feasible rows, resolves
  13-digit question IDs to `question_name`, and emits a 4-column normalized CSV:
  `group, indicator, calculation, method`.
- **`visualization_config.ipynb`** — reads the normalized CSVs, builds the config skeleton, then
  runs a **resolution pass** that fills family-derived references (compliance params, water-quality
  globals, registration/monitoring form ids, map option colours). Every question reference in the
  output uses `question_name` (never `question_id`).

> There is **no `used_questions` column**. Every question a row depends on is written in its
> `calculation`. The formula is the single source of truth, so a question can never be silently
> omitted by forgetting to list it in a side column.

> **The `method` column** marks each normalized row's provenance: `auto` (regenerated from
> `source/` on every run) or `manual` (hand-edited and pinned). On re-run the normalizer
> preserves `manual` rows — matched by `(group, indicator)` — so a hand-tuned `calculation`
> survives regeneration; set it back to `auto` (or delete the row) to let the script own it
> again. See `normalize_csv.ipynb` for the full workflow.

---

## The `calculation` format — **VizCalc**

`calculation` is the load-bearing column: the generator reads the **inputs** (which questions)
and the **output** (which chart) straight out of it. Free prose ("green if BOD<40…") is
ambiguous — a human reads it fine, but the parser can't tell an input from a label, an operator
from a word, or logic from punctuation. **VizCalc** is a small, Excel-style grammar that makes
all four token classes distinct to both a human and the parser, and removes whitespace as a
separator (so spacing can never change meaning).

### The four token classes

| Class | Marker | Examples | Rule |
|-------|--------|----------|------|
| **INPUT** (a question) | `[ … ]` square brackets | `[plant_name]`, `[bod]`, `[inspection_date]` | Always the canonical snake_case `question_name`. **Never** a human label (`BOD`, `GPS`). |
| **OUTPUT** (what the row produces) | `UPPERCASE( … )` outermost function | `COUNT(…)`, `PERCENT(…)`, `MAP(…)` | Exactly one, at the top level. Determines the chart type. Closed vocabulary (below). |
| **OPERATOR** | ASCII symbols only | `=` `<>` `<` `<=` `>` `>=` `+` `-` `*` `/` | No Unicode (`≥ ≤ ≠ ×`). `<>` = not-equal (Excel convention). |
| **LOGIC** | `UPPERCASE( … )` logic functions | `AND(…)`, `OR(…)`, `NOT(…)`, `IF(c,t,e)` | Group conditions explicitly. No bare prose `AND`/`OR`. |

Literals: numbers are bare (`40`, `0.5`); option/text values are double-quoted (`"No"`,
`"Operational"`). Ranges: `BETWEEN([q],lo,hi)`. Membership: `IN([q],"a","b")`.

### Whitespace rule

**Spaces are not significant and are not separators.** The only separators are `( ) [ ] ,`.
Write formulas without spaces; the parser strips any that appear. This is the "reduce confusing
spaces" goal: `AND([a]="No",[b]>0)` — not `AND( [a] = "No" , [b] > 0 )`.

### Output vocabulary → chart type

| Output function | Meaning | Generated `chart_type` / api |
|-----------------|---------|------------------------------|
| `COUNT(expr)` | count parents where `expr` is true | `card` + `option_value`/`sum_by` |
| `COUNTDISTINCT(expr)` | distinct parent/registration count | `card`, `monitoring:latest` |
| `RECENT([date_q],months)` | parents monitored within N months | `card` + `rolling_months` |
| `PERCENT(boolexpr)` | % of parents satisfying a condition | `metric_card` + `show_percentage` |
| `DISTRIBUTION([q])` | option breakdown of one question | `half_doughnut` + `group_by:option`; for `multiple_option`, defaults to `group_by:option_combo` |
| `DISTRIBUTION([q],FLAT)` | per-option breakdown for a `multiple_option` question | `half_doughnut` + `group_by:option` |
| `OPTION_COUNTS([q])` | per-option parent counts for one option/multiple-option question | horizontal `bar` + `group_by:option` |
| `PROCESS_COUNTS([q]="value" AS "Label", …)` | count parents across several independent process questions | horizontal `bar` + `compute:process_counts` segment fetches |
| `CAPACITY_COMPARE([production_q],[design_q])` | total production vs design capacity for the current filter scope | `bar` + `compute:capacity_compare`; default total, filtered drilldown later |
| `DATE_HISTOGRAM([date_q],months)` | bucket latest parent inspection dates by recency | `bar` + `compute:date_histogram`; `> months` overdue bucket plus monthly buckets |
| `VALUE_BUCKETS([q],0,1,2,3,4+)` | bucket per-parent numeric values into explicit labels | `bar` + `display:value_buckets` |
| `STAGE_FLOW([stage1_q] AS "Stage 1", [stage2_q] AS "Stage 2", …)` | sequential positive-response flow; each later stage is counted only from parents that passed all prior stages | `custom_component` + `StageFlowWidget` Sankey |
| `STATUS_BARS([q])` | per-option status bars for one process question, tone-coloured, with an "N in use" footer | `custom_component` + `ProcessStatusWidget` |
| `CONDITION([q],GOOD(…),MID(…),BAD(…)[,TRACK(…)])` | one field of a condition panel: a good→bad share bar + option dot legend | `custom_component` + `ConditionMatrixWidget` (a group's `CONDITION` rows collapse into one panel) |
| `COMPLIANCE_TREND(domain AS "Label", …)` | monthly % of parents passing each domain | `custom_component` + `ComplianceTrendWidget` line chart |
| `VALUE([q])` | per-parent numeric value | `bar` / `dot_strip` + `group_by:parent_id` |
| `COMPLIANT(boolexpr)` | pass/fail compliance | `stack_bar` / compliance KPI |
| `RANK([date_q],ASC\|DESC,n)` | top-N parents by recency | ranking card / custom |
| `MAP([q])` | a map pin/colour filter on `[q]` | map `filters[]` `select` entry — **only** when `[q]` is `option`/`multiple_option`; geo/number rows produce no filter (see below) |

`COALESCE([a],[b])` = "use `[a]`, fall back to `[b]`". The **first** input in the formula is the
chart's primary question; a `[date_q]` of type `date` is used for recency/ranking.

`STAGE_FLOW` is intentionally generic. Each argument is a yes/positive stage,
and every stage after the first is intersected with the parents that passed all
previous stages. Use `AS "Label"` to define the visible node label; the renderer
uses a Sankey custom component because pie charts cannot show stage drop-off.

### Multiple-option distribution

`DISTRIBUTION([q])` treats `multiple_option` answers as mutually exclusive
selection-combo buckets. A latest answer with only `lab_test` counts in
`lab_test`; only `cbt_bag_test` counts in `cbt_bag_test`; both selected counts
once in `lab_test|cbt_bag_test` and is labelled `Mixed`. Any N-way combo is
also labelled `Mixed`. This keeps the denominator aligned to parent datapoints
instead of total selected options.

Use `DISTRIBUTION([q],FLAT)` when the desired view is a per-option tally where a
single parent can increment more than one option bucket.

### iwsims custom-component widgets

Three outputs map to iwsims-only dashboard widgets (`frontend/src/components/dashboard/custom-components/`)
rather than an `akvo-charts` primitive. They exist because the prototype layouts
(dense condition matrices, per-process status bars, a multi-domain compliance
trend) are compositions, not single charts. Each is **self-fetching**: the
generated item carries the `api` blocks and the widget issues the `/values`
calls itself (the dashboard's `computeResponses` fan-out is not involved).

#### `STATUS_BARS([q])` → `ProcessStatusWidget` (row-level)

One process question becomes one card of tone-coloured horizontal bars (one bar
per option) with a footer caption like `12 plants have primary clarifier in use.`
The generator emits, from the form family:

- `api` `{question_name, group_by:"option", monitoring:"latest"}` — bar lengths.
- `usage_api` `{question_name, group_by:"parent_id", monitoring:"latest"}` — the
  footer numerator (distinct plants answering; a `multiple_option` question's
  option counts overlap, so they cannot be summed to a plant count).
- `options[]` `{value,label}` read from the question's option set (in form order).
- `subtitle` by question type: `status counts (multi-select)` for
  `multiple_option`, `operational / non operational` for `option`.
- `footer_template` `"{n} plants have <indicator> in use."`

**Tones are not authored** — `ProcessStatusWidget` derives them at render time
(`normal`/`normal_operation`/`operational` → green, `not_operational` → red,
everything else → amber). Left **manual**: a per-option tone override and the
`{operating} of {total}` footer / `absent_value` of a presence-style question
(e.g. WWTP *Influent Pumping*, where "no station" is grey and the footer counts
plants that operate one).

#### `CONDITION([q],GOOD(…),MID(…),BAD(…)[,TRACK(…)])` → `ConditionMatrixWidget` (group-level)

A `CONDITION` row is **one field** of a panel; all `CONDITION` rows that share a
CSV `group` collapse into a single `ConditionMatrixWidget` item with a `fields[]`
array (this is the only group-level VizCalc output — every other output is one
item per row). Unlike `STATUS_BARS`, condition tones **must be authored** in the
formula: the monitoring forms' stored option colours are inconsistent (e.g.
"electrical hazard" is green in the form definition), so the tone of each option
is listed explicitly. `%good` = the share whose latest answer is a `GOOD` option.

```text
CONDITION([ground_conditions],GOOD("good","satisfactory"),MID("maintenance_in_progress"),BAD("poor"))
```

Per field the generator emits `{key,label,api(group_by:option,monitoring:latest),options:[{value,label,tone}]}`,
option labels resolved from the form, ordered GOOD → MID → BAD → TRACK. Panel
defaults: `columns:2`, `subtitle` from the group, `readout:"pct_good"`. Left
**manual** (no CSV column carries it): the `count_of_total` readout for yes/no
panels, the `TRACK` tone for a warning row (e.g. *Urgent maintenance programs*),
side-by-side panel pairing (`col_span:12`, `columns:1`), and the exact
two-column field interleave.

#### `COMPLIANCE_TREND(domain AS "Label", …)` → `ComplianceTrendWidget` (row-level)

One row becomes a 12-month line chart of the % of parents passing each domain.
Each argument is one domain with one of two rule shapes:

```text
COMPLIANCE_TREND(THRESHOLD_ALL([bod]<40,[chemical_oxygen_demand]<100,[total_dissolved_solids]<1000) AS "Effluent",OPTION_SHARE([ohs_equipment_available]="yes") AS "OHS")
```

- `THRESHOLD_ALL(…)` → a `threshold_all` domain (per-parent monthly values via
  `group_by:month` + `stack_by:parent_id`; a parent passes if every *present*
  param satisfies its threshold).
- `OPTION_SHARE([q]="v")` → an `option_share` domain (`group_by:month` +
  `stack_by:option`; pass option ÷ all answered that month).

Series colours are not derivable — left **manual**. A **derived "operational"
domain is not expressible** as a frontend rule: option questions return nothing
under `stack_by:parent_id`, so a per-plant cross-question proxy needs backend
support (tracked separately).

#### What stays manual

These widgets carry presentation/semantic metadata the flat four-column CSV does
not model. The generator reproduces structure and data wiring; the items below
are re-applied by hand after regeneration (the same TODO discipline as
`__TODO_unit__` / `__TODO_option_value__`):

| Manual touch | Widget |
|--------------|--------|
| condition per-option tones, `TRACK` tone, yes/no `count_of_total` readout, panel pairing & field interleave | `ConditionMatrixWidget` |
| per-option tone override, presence-style `absent_value` + `{operating} of {total}` footer | `ProcessStatusWidget` |
| series colours, the backend-dependent "operational" domain | `ComplianceTrendWidget` |

### Before → after (real rows)

| Indicator | Free prose (today) | VizCalc |
|-----------|--------------------|---------|
| Total WWTPs | `COUNT DISTINCT Registration records by plant_name (fall back to geolocation…)` | `COUNTDISTINCT(COALESCE([plant_name],[geolocation]))` |
| Inspected (12 mo) | `COUNT DISTINCT plant_id WHERE inspection_date < 12 months` | `RECENT([inspection_date],12)` |
| Effluent Compliance | `compliant when bod<40 AND chemical_oxygen_demand<100 AND total_dissolved_solids<1000` | `COMPLIANT(AND([bod]<40,[chemical_oxygen_demand]<100,[total_dissolved_solids]<1000))` |
| % Operational | `Plant OPERATIONAL when has_production_constraints=No AND daily_production_megalitres>0 AND …` | `PERCENT(AND([has_production_constraints]="No",[daily_production_megalitres]>0,[pumps_rising_main_has_risks]="No"))` |
| Effluent compliance (map) | `Pin colour: green if BOD<40 AND COD<100 AND TDS<1000` | `MAP([bod])` *(or `COMPLIANT(...)` if a derived pin)* |
| Drinking water compliance (map) | `For each plant with GPS: pin colour from DW Compliance rule` | `MAP([geolocation])` |
| Needs monitoring | `Top 8 plants ORDER BY latest inspection date ASC` | `RANK([inspection_date],ASC,8)` |
| Most recently monitored | `Top 8 plants ORDER BY latest submission DESC` | `RANK([date_of_inspection],DESC,8)` |

Note the map / ranking rows: in free prose they referenced the question only by label
(`BOD`, `GPS`, "inspection date"), so the parser dropped them. In VizCalc the input is an
explicit `[question_name]`, so it is always captured.

A captured `MAP([q])` input only becomes a `select` map filter when `[q]` is an
`option`/`multiple_option` question (a select renders that question's options as a
dropdown + colour map). `MAP([bod])` (number) and `MAP([geolocation])` (geo) have no
options, so they produce **no** filter — their compliance/threshold pin colouring needs a
dedicated filter type and is left for manual authoring. The map itself still renders pins
from the dashboard's `source_form_id`.

### How the pipeline consumes VizCalc

- **Inputs:** `re.findall(r"\[([a-z][a-z0-9_]*)\]", calculation)` → every dependency, in order,
  with zero false positives from prose. (`row_qinfos()` in `visualization_config.ipynb`.)
- **Output / chart type:** the outermost `UPPERCASE(` token → the `build_item()` branch.
  A row is dispatched as VizCalc only when it has that OUTPUT token **and** at least one
  `[question_name]` input — so legacy prose that merely starts with a word like
  `COUNT(Yes) of …` (no brackets) still falls back to the heuristic builder.
- **Conditions:** operators and `AND/OR/NOT/IF` map directly to backend `criteria` /
  `compute` params.

Backend alignment: `[question_name]` inputs go to the `/values` endpoint's `question_name`
parameter (served from `mv_cross_form_latest` / `mv_answer_denormalized`) — see
[../../doc/claude/materialized-views-optimization/README.md](../../doc/claude/materialized-views-optimization/README.md)
and the Task 6 plan for full `question_name` support across all dashboard endpoints.

### What the resolution pass fills (and what it leaves as TODO)

`build_config` emits the per-row skeleton; some references need the whole **form family** —
the registration form plus its monitoring forms (linked by `parent_id`; the *comprehensive*
monitoring form is the non-"Quick" one with the most questions). After building, the resolver
walks the config and fills:

| Placeholder | Resolved to |
|-------------|-------------|
| `__TODO_list_param_ids__` | ids of the generated `dot_strip` water-quality params |
| `__TODO_wq_globals_ref__` | `"wq_globals"` (a `water_quality_globals` item the pass injects, with `sample_question_name` / `test_method_question_name` / `monitoring_form_id`) |
| `__TODO_reg_form_id__` | the registration (parent) form id |
| `__TODO_monitoring_form_id__` | the comprehensive monitoring form id |
| `__TODO_inspection_date_qname__` | the monitoring date `question_name` |
| `__TODO_option__` in a map `color_map` | per-option colours from the question's `option[].color` (`option`/`multiple_option` only), with a palette fallback for options lacking a colour |

Intentionally **left as TODO** for manual authoring (no safe automatic source):

- `__TODO_unit__` — axis units on numeric `bar` charts.
- `__TODO_option_value__` — `target_group` for `%` metric cards (which option counts as "good").
- `__TODO_option__` on **geo/number** map rows — compliance/threshold pin colouring with no
  option set to derive from (these rows produce no `select` filter at all).

A compliance row only resolves its `params_ref` if the form has matching `VALUE([param])` rows
that generate `dot_strip` items — e.g. a `COMPLIANT(AND([bod]<40,…))` card needs `VALUE([bod])`
rows for `bod`/`cod`/`tds`, otherwise `__TODO_list_param_ids__` stays (nothing to reference).

### Adoption path

VizCalc is the **target** authoring format for the source `Calculation` column. Migration can be
incremental:

1. Author new rows directly in VizCalc.
2. `normalize_csv.ipynb` keeps doing ID→name substitution; with VizCalc the IDs simply appear as
   `[1749…]` and resolve to `[question_name]`.
3. The generator's parser accepts both VizCalc and the legacy semicolon/`AND(…)` form during the
   transition; rows not yet converted keep working (with the label-only caveat above).
4. Once a form's rows are fully VizCalc, input extraction is exact and `MAP`/`RANK` rows stop
   dropping their questions.

### Optional private LLM normalizer

`normalize_csv_llm.py` is a separate proposal generator that uses Z.ai Chat
Completions and `$ZAI_API_KEY`. It does **not** replace `normalize_csv.ipynb`
and writes to separate folders by default:

```bash
ZAI_API_KEY=... python scripts/visualization-config/normalize_csv_llm.py
```

Useful scoped runs:

```bash
# Only one dashboard source file
python scripts/visualization-config/normalize_csv_llm.py --file 1749634736797.csv

# Smoke test one row without spending tokens on the whole file
python scripts/visualization-config/normalize_csv_llm.py --file 1749634736797.csv --limit 1

# Preserve already-valid VizCalc deterministically; use the LLM only for prose rows
python scripts/visualization-config/normalize_csv_llm.py --mode hybrid
```

Outputs:

| Path | Purpose |
|------|---------|
| `normalized-llm/*.csv` | pipeline-compatible 4-column normalized CSV proposals |
| `normalized-llm-review/*.review.csv` | confidence, warnings, validator errors, and raw model response |

The script follows three safety rules:

1. Existing valid VizCalc can be preserved with `--mode hybrid`.
2. LLM output is treated as a proposal, especially for prose-heavy rows.
3. Every formula is locally validated for output function, `[question_name]`
   references, unresolved numeric IDs, bracket balance, and option values. Rows
   that fail validation are marked `method=manual_review`.
