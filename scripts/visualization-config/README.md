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
| `VALUE([q])` | per-parent numeric value | `bar` / `dot_strip` + `group_by:parent_id` |
| `COMPLIANT(boolexpr)` | pass/fail compliance | `stack_bar` / compliance KPI |
| `RANK([date_q],ASC\|DESC,n)` | top-N parents by recency | ranking card / custom |
| `MAP([q])` | a map pin/colour filter on `[q]` | map `filters[]` `select` entry — **only** when `[q]` is `option`/`multiple_option`; geo/number rows produce no filter (see below) |

`COALESCE([a],[b])` = "use `[a]`, fall back to `[b]`". The **first** input in the formula is the
chart's primary question; a `[date_q]` of type `date` is used for recency/ranking.

### Multiple-option distribution

`DISTRIBUTION([q])` treats `multiple_option` answers as mutually exclusive
selection-combo buckets. A latest answer with only `lab_test` counts in
`lab_test`; only `cbt_bag_test` counts in `cbt_bag_test`; both selected counts
once in `lab_test|cbt_bag_test`. This keeps the denominator aligned to parent
datapoints instead of total selected options.

Use `DISTRIBUTION([q],FLAT)` when the desired view is a per-option tally where a
single parent can increment more than one option bucket.

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
