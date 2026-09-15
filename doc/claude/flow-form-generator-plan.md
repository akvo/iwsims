# Generating IWSIMS Forms from Akvo Flow Surveys

Plan for building `scripts/akvo-flow/af_form_generator.py`, which converts a
downloaded Akvo Flow survey definition into an IWSIMS form definition under
`backend/source/forms/`.

**Scope**: Flow surveys `535151018` (Rural Water Point Survey) and `540671011`
(School Form 2021-2022). Registration forms only (`*.prod.json`) — no monitoring
or child forms.

**Status**: Complete locally (2026-09-15). Both forms are seeded and all data
is imported — 1,593 and 975 datapoints, 0 invalid answers. **Nothing is
committed.**

| Form | Flow survey | Datapoints | Answers | Admin | Geo |
|---|---|---|---|---|---|
| 1789351200000 Rural Water Point Survey | 535151018 | 1,593 / 1,593 | 110,381 | 1,593 | 1,593 |
| 1789351201000 School Form 2021-2022 | 540671011 | 975 / 975 | 55,878 | 975 | 975 |

---

## Summary

| # | Item | Where | Gate |
|---|------|-------|------|
| 1 | Pin new MIS form IDs | `flow_forms.json` | resolved — §2A |
| 2 | Decide school-cascade target | resolved — `input`, see §5.3 | — |
| 3 | Build generator | `scripts/akvo-flow/af_form_generator.py` | Phase 2–4 |
| 4 | Self-check | `scripts/akvo-flow/test_af_form_generator.py` | Phase 5 |
| 5 | Manual review of generated JSON | `backend/source/forms/` | **Phase 6 — hard gate** |
| 6 | Seed into IWSIMS | `form_seeder` | Phase 7 |
| 7 | Repoint config, regenerate mappings | `flow_forms.json`, `output/forms/*.csv` | Phase 8 |

---

## 1. Context

### Why a new form rather than reusing the RWS forms

Both surveys currently migrate onto the shared Rural Water Project forms
(parent `1749621221728`, monitoring `1749621962296` / `1749631041125`) via
`af_forms_mapping.ipynb`'s fuzzy label matcher. That path is implemented and
verified — see `flow-caddisfly-label-transform-plan.md`.

Giving each survey its own form removes the label-similarity matching step
entirely: with Flow question IDs carried through as MIS question IDs (§4), the
Flow→MIS question mapping becomes the identity function.

### Where the generator sits

```
af_downloader.ipynb                Flow instance ──► output/flow_forms/{flow_id}_{name}.json
        │
        ▼
af_form_generator.py      ★NEW     output/flow_forms/*.json ──► ../../backend/source/forms/{n}_{mis_id}.prod.json
        │
        ▼
af_forms_mapping.ipynb             Flow questions ──► MIS questions (mapping CSVs)
        │
        ▼
backend: flow_data_seeder          Flow responses ──► IWSIMS FormData
```

Two modules, to stay inside the 400-line limit:
`af_form_generator.py` (CLI, config, file IO) and `util/form_transform.py`
(pure Flow→IWSIMS mapping, no IO).

The generator writes **straight to `backend/source/forms/`** — there is no
preview directory and no `--dry-run`. Writing there is not a commitment:
`form_seeder` is a manual trigger, so a regenerated file only reaches the
database when someone runs it.

A plain script in `scripts/akvo-flow/` rather than a Django management command:
the input already lives in `output/flow_forms/`, and a command under `backend/`
would have to reach outside its own tree for it. It reads config through
`util/config.py:load_flow_forms()`, the same loader the rest of the pipeline uses.

### Inputs — verified present

| File | Size | Groups | Questions |
|---|---|---|---|
| `output/flow_forms/535151018_Rural_Water_Point__Survey.json` | 67.7 KB | 5 | 94 |
| `output/flow_forms/540671011_School_Form_2021-2022.json` | 43.4 KB | 4 | 68 |

| Flow type | 535151018 | 540671011 |
|---|---|---|
| `free` | 47 | 27 |
| `option` | 41 | 33 |
| `geo` | 2 | 2 |
| `cascade` | 1 | 2 |
| `photo` | 1 | 3 |
| `date` | 1 | — |
| `caddisfly` | 1 | 1 |

No `barcode`, `scan`, `video`, `signature`, or `geoshape` questions exist in
either survey. Those branches are not implemented; the generator raises on an
unknown type rather than silently skipping.

---

## 2. Decisions — signed off 2026-09-15

All three items below are settled. Phase 1 is unblocked.

**A. New MIS form IDs — approved as proposed.** Pinned constants, never derived
from wall-clock time at run time (§4):

| Flow ID | MIS form ID | Output file |
|---|---|---|
| 535151018 | `1789351200000` | `6_1789351200000.prod.json` |
| 540671011 | `1789351201000` | `7_1789351201000.prod.json` |

The highest existing ID is `1749652214711`, so neither collides. The `6_`/`7_`
prefix continues the existing 1–5 convention; `form_seeder.py:100` globs the
directory and ignores the prefix.

**B. Repoint `flow_forms.json` — approved.** `mis_form_id` for both surveys
moves to the new forms and `mis_child_form_ids` becomes `[]`. This invalidates
six existing mapping CSVs; see §9 for what must be regenerated.

**C. `free` → `text`, except meta → `input` — approved (revised twice,
2026-09-15).** Non-numeric Flow `free` questions become `text`, *unless* the
question is `meta`, in which case it becomes `input`. See §6 "Meta questions".

---

## 3. Output contract

```json
{
  "id": 1789351200000,
  "form": "Rural Water Point Survey",
  "description": "Rural Water Point Survey - Registration",
  "defaultLanguage": "en",
  "languages": ["en"],
  "version": 1,
  "type": 1,
  "question_groups": [...]
}
```

- `type: 1` = `FormTypes.registration`.
- `defaultLanguage` / `languages` from Flow `defaultLanguageCode` (`en` in both).
- No `parent_id`, so `form_seeder` classifies both as parent forms and seeds them
  before any child form.

Question group shape:

| IWSIMS field | Source | Notes |
|---|---|---|
| `id` | `FORM_BASE + order` | Flow groups carry no ID |
| `name` | `snake_case(heading)` | |
| `label` | `questionGroup.heading` | |
| `description` | `null` | Flow has no group description |
| `order` | array index + 1 | Flow groups carry no order attribute |
| `repeatable` | `questionGroup.repeatable` | |
| `repeat_text` | `"Add another"` when repeatable, else `null` | dominant existing value |

Repeatable groups in scope: `Water System Information & Water Quality Test`
(535151018, 32 questions) and `Water Quality Test` (540671011, 10 questions).

> **Pre-existing bug, not introduced here.** `form_seeder.py:226,234` reads
> `qg.get("repeatText")`, but every file in `source/forms/` writes `repeat_text`.
> Repeat text is therefore `NULL` in the database for all 20 existing forms. The
> generator emits `repeat_text` to match the existing files. Fixing the seeder
> key is a one-word change and belongs in its own commit.

---

## 4. ID allocation

IDs must be **stable across re-runs**. `form_seeder.py` deletes any `Questions`
row absent from the JSON — and its answers with it — so an ID scheme that shifts
when a question is inserted in Flow would destroy data on the next re-pull.

| Entity | Rule | Rationale |
|---|---|---|
| Form | Pinned constant in `flow_forms.json` | Never derived from `now()` |
| Question group | `FORM_BASE + group_order` (1…5) | No Flow ID exists; ≤5 per form |
| Question | **Flow question ID, unchanged** | Stable under insert/reorder in Flow |
| Synthetic question (caddisfly fan-out) | `FORM_BASE + 100 + n` | Reserved band, no Flow counterpart |
| Option | omitted | `form_seeder.py:281` ignores `o["id"]` |

**Collision safety.** Flow question IDs in these two surveys span
469691016–541050982 — 9 digits, under 6×10⁸. Every existing IWSIMS ID is an
epoch-millisecond value at or above 1748903240763 — 13 digits, over 1.7×10¹².
The ranges cannot overlap.

Option IDs are omitted deliberately: `form_seeder` builds `QuestionOptions` from
`label`, `value`, `order` and `color` only, so an `id` in the JSON is inert.

---

## 5. Question type mapping

| Flow | Condition | IWSIMS type | Extra output |
|---|---|---|---|
| `free` | `validationRule.validationType == "numeric"` | `number` | `rule` from min/max/allowDecimal |
| `free` | `meta` (see §6) | `input` | datapoint-name questions |
| `free` | otherwise | `text` | decision C |
| `option` | `options.allowMultiple` | `multiple_option` | |
| `option` | otherwise | `option` | |
| `geo` | — | `geo` | |
| `date` | — | `date` | |
| `photo` | — | `photo` | |
| `cascade` | resource `cascade-5430921-v6.sqlite` | `administration` | §5.2 |
| `cascade` | any other resource | `input` | §5.3 |
| `caddisfly` | — | *three questions* | §5.4 |

**No `cascade` or `entity` question types are emitted.** Entity management is
deliberately disabled in IWSIMS, so a question depending on it could never be
answered. Three independent confirmations:

1. The Master Data menu offers only Administrative List, Attributes and
   Organisations — no Entities, no Entity Types.
2. Those two menu items exist in the source but are **commented out**:
   `frontend/src/components/sidebar/index.jsx:255-265`. The sidebar is the only
   route into Master Data, so the entity tabs still listed in
   `components/tabs/MasterDataTab.js:31-36` are unreachable dead UI.
3. `grep` over `source/forms/*.prod.json` returns zero hits for `cascade` and
   `entity`. Both occur only in `example-*.json` fixtures.

The `cascade`/entity pattern belongs to akvo-mis, not IWSIMS.

### 5.1 Numeric free questions

```
{"validationType":"numeric","allowDecimal":false,"minVal":"1.0"}
  →  type "number", rule {"allowDecimal": false, "min": 1}
```

`minVal` / `maxVal` arrive as decimal strings; cast to `int` when `allowDecimal`
is false, otherwise `float`. `signed` and `requireDoubleEntry` have no IWSIMS
equivalent and are dropped.

Every other `free` question becomes `text`, except meta questions, which become
`input` (§6).

### 5.2 Administration cascade

`cascade-5430921-v6.sqlite`, levels Division → Province → Tikina. Present as
q `469691022` in 535151018 and q `525291017` in 540671011.

IWSIMS administration levels are seeded National=0, Division=1, Province=2,
Tikina=3, Village=4 (`administration_seeder.py:118-126`, from `source/fiji.csv`).
Flow's three levels stop at Tikina, so `max_level: 3`:

```json
{
  "id": 469691022,
  "name": "division_province_tikina",
  "label": "In which division-province-tikina are you in?",
  "order": 1,
  "type": "administration",
  "required": true,
  "meta": true,
  "api": { "max_level": 3 }
}
```

Verified semantics: `serializers.py:96-106` turns `api.max_level` into
`query_params=&max_level=3`, and `app/src/form/fields/TypeCascade.js:40,69` stops
descending once `admLevel - 1 >= maxLevel`.

`meta: true` is forced on the administration question regardless of Flow's
`localeNameFlag`, matching every existing registration form.

> Note: the existing `3_1749621221728.prod.json` administration question omits
> `api` entirely, so it descends to Village despite its
> "Division-Province-Tikina" label. The generator is stricter; if matching the
> existing behaviour is preferred, drop the `api` key.

### 5.3 School cascade → `input`

`cascade-512440951-v41.sqlite`, q `525291018`, levels
Province → Type of School → Name of School → School Code.

Emitted as a single `input` question with `meta: true` (Flow
`localeNameFlag: true` — it contributes to the datapoint name).

`input` is the only workable target. The entity cascade that would otherwise fit
this shape is unavailable in IWSIMS (§5, note), and the school hierarchy is not
part of the administration tree — `source/fiji.csv` defines exactly
Division / Province / Tikina / Village — so `administration` cannot represent it
either.

It is also the existing, already-shipped behaviour rather than a new invention.
`flow-caddisfly-label-transform-plan.md` §3 records that `transform_mis_value`
gained a branch specifically for this case:

> Flow cascade answers are `[{"code": "...", "name": "..."}]`. Only the
> `administration` branch handled them; on an `input` question the list fell
> into the option branch, found no `text` keys and returned `""`. The school
> name (registered schools use a cascade) would have been lost, and with it the
> datapoint name.

That branch joins the cascade levels with `" - "` into one string, so the target
must be exactly **one** `input` question — not one per level.

```json
{
  "id": 525291018,
  "name": "school_name_and_code",
  "label": "What is the school name and code?",
  "order": 5,
  "type": "input",
  "required": true,
  "meta": true,
  "dependency": [{ "id": 513321001, "options": ["yes"] }]
}
```

### 5.4 Caddisfly fan-out

One `caddisfly` question per survey (`541050982` in 535151018; one in 540671011),
`caddisflyResourceUuid: e40d4764-e73f-46dd-a598-ed4db0fd3386` — the Aquagenx CBT
E.coli test. IWSIMS has no caddisfly type.

Each expands into three questions, matching the `CADDISFLY_TARGETS` dispatcher
already defined in `af_forms_mapping.ipynb` so the data-migration path
(`flow-caddisfly-label-transform-plan.md` §2) keeps working unchanged:

| # | ID | Type | Label | Predicate it must satisfy |
|---|---|---|---|---|
| 1 | `FORM_BASE + 101` | `number` | `E.Coli CBT test result (MPN/100ml)` | `"cbt" in label and "lab" not in label` |
| 2 | `FORM_BASE + 102` | `option` | `E.Coli CBT test health risk category` | `"risk" in label` |
| 3 | `FORM_BASE + 103` | `photo` | `E.Coli CBT test result photo` | `"cbt" in label` |

Labels are **fixed strings, not derived from the Flow label**. The two surveys
word the caddisfly question differently:

| Flow ID | Flow label | contains `cbt`? |
|---|---|---|
| `541050982` (535151018) | Conduct E.Coli test using Aguagenx CBT Bag Test | yes |
| `536681031` (540671011) | The test conducted with Caddisfly? | **no** |

A `{flow label} — …` template would therefore satisfy the `"cbt" in label`
predicate for 535151018 and silently fail it for 540671011, so the School form's
E.coli results would never be dispatched. Fixed labels make the contract hold
regardless of Flow wording.

The original Flow label is preserved as the `tooltip` of all three questions so
the surveyor-facing context is not lost.

`CADDISFLY_TARGETS` is keyed by MIS type, so each generated question need only
satisfy the lambda for **its own** type — label 2 also containing `cbt` is
harmless. Phase 4 check 5 asserts all three.

Risk-category options are **copied verbatim from the existing risk questions**,
not invented — e.g. q `1754995400001` in `1_1749652214711.monitoring.prod.json`:

| value | label | color |
|---|---|---|
| `no_risk` | No risk | `#64A73B` |
| `low_risk` | Low risk | `#1f78b4` |
| `moderate_risk` | Moderate Risk | `#d95f02` |
| `high_risk` | High Risk | `#e41a1c` |

This vocabulary is used by five of the six existing forms that carry a risk
question; the sixth (`3_1749631041125`) uses `medium_risk` for the third band,
and `label_aliases.json` already lists both spellings.

Matching it is not cosmetic. `label_aliases.json` maps Flow's caddisfly result
labels onto **MIS option values**, and a candidate is used only when the target
question actually offers it:

```
'intermediate risk'        -> ['medium_risk', 'moderate_risk']
'low risk / safe'          -> ['low_risk']
'very high risk / unsafe'  -> ['high_risk']
```

An invented vocabulary (`safe` / `intermediate_risk` / `unsafe`) would leave
every one of those aliases unresolved, silently dropping the Flow E.coli
results into `invalid_values.csv`. Verified after the fix: all ten risk-related
alias entries resolve against the generated options.

All three inherit the source question's `required`, `dependency` and group.
Neither caddisfly question is the target of any dependency — verified across both
surveys — so replacing it with three new IDs cannot strand a reference.

---

## 6. Remaining field mapping

| IWSIMS field | Source |
|---|---|
| `order` | Renumbered 1…n per group by sorted Flow `order` (Flow orders have gaps) |
| `required` | Flow `mandatory` |
| `meta` | `localeNameFlag or localeLocationFlag`; forced `true` for administration — and it constrains `type`, see below |
| `tooltip` | `{"text": help.text}` when `help.text` is non-null, else omitted |
| `dependency` | below |

`help` appears on 22/94 and 16/68 questions, but some carry `{"text": null}`
(e.g. q `536930972`). Those must be omitted, not emitted as `{"text": null}`.

### Meta questions

Meta questions build the datapoint name, so they are restricted to the three
types that render a usable one:

```python
META_TYPES = ("administration", "input", "geo")
```

A meta question that would otherwise resolve to `text` is emitted as `input`.
Anything else meta — a `number` or `option`, say — is **rejected by the
self-check rather than silently converted**, since there is no safe automatic
answer for those and a numeric `rule` would be lost in the process.

**At most one geo question may be meta.** A datapoint name takes a single
point, and Flow sets `localeLocationFlag` per question, so a survey can mark
several. `demote_extra_geo_meta` keeps the first in document order and clears
the rest. In 535151018 this demotes `415600933` "Take GPS location of the
water system", leaving `535141023` "GPS of the village/settlement?" as the
name-bearing point; 540671011 marks only one geo question and is unaffected.

Three questions are affected across the two surveys, all of them name fields
with no validation rule:

| Flow ID | Label | was | now |
|---|---|---|---|
| `469691020` | Name of Village | `text` | `input` |
| `469691019` | Name of Settlement | `text` | `input` |
| `475531012` | What is the school name? (for unregistered) | `text` | `input` |

Resulting meta sets:

| Form | Meta questions |
|---|---|
| 535151018 | administration, input ×2, geo |
| 540671011 | administration, input ×2, geo |

This also aligns with the hand-authored forms, where `project_name` and
`village_name` in `3_1749621221728.prod.json` are both `input` with
`meta: true`.

### Names and values

One `snake_case()` helper, close to `form_seeder.py:clean_string` but with two
deliberate differences: underscores survive, and separator punctuation (`-`,
`/`) becomes an underscore rather than vanishing.

Both matter. `clean_string` strips `_` outright, so Flow `variableName` values
degrade badly — `WASH_school_toilets_photo` → `washschooltoiletsphoto`,
`School_name` → `schoolname`. And dropping hyphens turns
"Division-Province-Tikina" into `divisionprovincetikina`, where the divergent
rule gives `division_province_tikina` — exactly the name the hand-authored
`3_1749621221728.prod.json` already uses.

Diverging is safe because the generator always emits an explicit option
`value`, so `form_seeder` never derives one itself, and dependency options are
matched against values this same function produced.

`name` source order:
1. Flow `variableName` when present (26 of 68 in 540671011; 0 in 535151018)
2. `snake_case(text)`, truncated to 50 chars at a word boundary

Names must be unique within a form — the mobile SQLite generator keys on them.
Collisions take a `_2`, `_3` … suffix applied in document order, so the result is
deterministic.

Option `value` is `snake_case(option.value or option.text)`.

`allowOther` (true on e.g. q `536671014`) appends `{"value": "other", "label": "Other"}`.
Flow's free-text "other" answer has nowhere to land — a known lossy point,
consistent with how `3_1749621221728.prod.json` models Other as a plain option
plus a dependent text question.

### Dependencies

```
Flow:    {"question": "535141022", "answerValue": "Village"}
IWSIMS:  {"id": 535141022, "options": ["village"]}
```

- `question` → `id` as `int` (identity mapping, §4).
- `answerValue` → `options`, split on `|` (Flow's multi-value separator), each
  element through the same `snake_case()` used for option values.

49 of 94 and 33 of 68 questions carry dependencies. This is the most heavily
exercised and highest-risk part of the translation; Phase 4 check 2 targets it
directly.

### Option colors

Reproduces the palette already in `source/forms/`:

- `Yes` → `#64A73B`, `No` → `#e41a1c`, matched case-insensitively (208 and 200
  existing uses).
- Everything else cycles ColorBrewer Dark2 by option order:
  `#1b9e77 #d95f02 #7570b3 #e7298a #66a61e #e6ab02 #a6761d #666666`,
  then `#1f78b4 #a65628 #377eb8 #003f5c` beyond eight.

---

## 7. Implementation phases

### Phase 1 — Config and scaffolding

- Add to each survey entry in `storage/akvo-flow/flow_forms.json`:
  `mis_form_id` (pinned, §2A), `mis_form_prefix`, `mis_form_name`,
  `mis_description`, and `administration_cascade` naming
  `cascade-5430921-v6.sqlite`.
- `af_form_generator.py`: argument parsing, config load, Flow JSON discovery,
  JSON writer. No transformation yet.
- Exit criterion: runs end to end and emits a form envelope with zero groups.

### Phase 2 — Core transformation

- `snake_case()`, name deduplication, color allocation.
- Group mapping (§3), question mapping for `free` / `option` / `geo` / `date` /
  `photo` (§5, §6).
- Dependency translation.
- Exit criterion: 92 of 94 and 65 of 68 questions emitted; cascades and
  caddisfly still unhandled.

### Phase 3 — Special cases

- Administration cascade (§5.2), school cascade (§5.3), caddisfly fan-out (§5.4).
- Exit criterion: question counts hit 96 and 70 (94 − 1 + 3, 68 − 1 + 3).

### Phase 4 — Self-check

`scripts/akvo-flow/test_af_form_generator.py`, plain `assert`, run against the
two real Flow files. No fixtures, no framework.

1. **Completeness** — output count equals `flow_questions - caddisfly + 3×caddisfly`.
2. **Dependency integrity** — every `dependency[].id` resolves to a question in
   the same form, and every `dependency[].options` value exists among that
   question's option values. This is the check that catches `snake_case` drift
   between its two call sites.
3. **ID uniqueness and range** — no duplicate question or group IDs; no
   generated ID collides with an ID in any other file in `source/forms/`.
4. **Type validity** — every emitted `type` is an attribute of `QuestionTypes`
   (`getattr` at `form_seeder.py:255` raises `AttributeError` otherwise).
5. **Caddisfly contract** — the three labels satisfy their respective
   `CADDISFLY_TARGETS` predicates.
6. **Name uniqueness** — question names unique within each form.
7. **No forbidden types** — no `cascade` or `entity` in the output.
8. **Meta types** — every `meta` question is `administration`, `input` or
   `geo`; exactly one `administration` question exists with `max_level: 3`;
   at most one `geo` question is `meta`.

Check 3 skips the two files the generator owns, so re-running it after a
generate does not report the forms as colliding with themselves.

### Phase 5 — Generate

```bash
cd scripts/akvo-flow
python af_form_generator.py --flow-id 535151018 --flow-id 540671011
python test_af_form_generator.py
```

Writes `6_1789351200000.prod.json` and `7_1789351201000.prod.json` into
`backend/source/forms/`. Re-running overwrites them in place; because question
IDs are the Flow IDs (§4), a re-generate after a Flow edit updates rather than
replaces.

### Phase 6 — MANUAL VERIFICATION GATE — passed 2026-09-15

Nothing is seeded until this passes. Reviewed:

- [ ] Group headings, order and `repeatable` flags match the Flow form
- [ ] Both administration questions are `administration` with `max_level: 3`
- [ ] q `525291018` is a single `input` with `meta: true`
- [ ] No `cascade` and no `entity` anywhere in either file
- [ ] Caddisfly fan-out labels read sensibly and keep their dependency
- [ ] The datapoint name each form produces reads correctly, given its meta
      set (§6) — administration + name inputs + geo
- [ ] `meta: true` questions produce a sensible datapoint name
- [ ] Numeric `rule` bounds match Flow `validationRule`
- [ ] Option labels still match `label_aliases.json` entries (§5.4)
- [ ] Spot-check 10 dependencies against the Flow XML in `static/xml/fiji-dws/`

### Phase 7 — Seed

```bash
cd ../.. && ./dc.sh exec backend python manage.py form_seeder -f 6_1789351200000
./dc.sh exec backend python manage.py form_seeder -f 7_1789351201000
./dc.sh exec backend python manage.py test api.v1.v1_forms
./dc.sh exec backend flake8
```

Then open each form in the web UI and confirm it renders, the administration
selector stops at Tikina, and dependent questions show and hide correctly.

### Phase 8 — Config repoint and mapping regeneration

Only after Phase 7 passes, and only if §2B was approved.

---

## 8. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Dependency option value drifts from option value | Questions never unhide; form unusable | Phase 4 check 2; single `snake_case()` |
| Flow question inserted later shifts IDs | Seeder deletes questions and their answers | Flow IDs used verbatim (§4) |
| A meta question resolving to an unusable type (`number`, `option`) | Datapoint name unusable | Phase 4 check 8 fails loudly; no silent conversion |
| Caddisfly labels stop matching `CADDISFLY_TARGETS` | Data migration silently drops E.coli results | Phase 4 check 5 |
| `allowOther` free text discarded | Flow "Other" answers lost | Accepted, documented (§6) |
| Duplicate question `name` | Mobile SQLite generation breaks | Phase 4 check 6 |
| Repointing config strands existing mappings | Future migrations target the wrong form | §9 |

---

## 8a. Findings from the local run (2026-09-15)

### The migration is a move, not a copy — old rows must go first

`FormData.id` **is** the Flow datapoint id. A Flow datapoint can therefore
exist only once in the database, whatever form it belongs to. Both surveys had
already been migrated onto the shared RWS form, so seeding them into the new
forms failed on every row with:

```
duplicate key value violates unique constraint "data_pkey"
DETAIL: Key (id)=(525631055) already exists.
```

`create_form_data` swallows this into `logger.error` and returns `None`, which
the command reports only as `No parent form data created <id>` — the run
"succeeds" with `Parent success: 0/20`. Worth knowing: a zero-success run is
the symptom of a duplicate id, not of a mapping problem.

Scope on the local database before the fix:

| | count |
|---|---|
| Parents from these two surveys, on form `1749621221728` | 2,551 |
| Their children (`1749621962296` + `1749631041125`) | 5,118 |
| Answers involved | 69,004 |
| RWS parents from flow `2490944` (must be kept) | 117 |

### `--revert` is the wrong tool for this

`revert_form_data` deletes every record on the target form whose name starts
with `FLOW-`:

```python
form_data = form.form_form_data.filter(name__startswith=FLOW_PREFIX)
```

It does not filter by originating survey, so reverting flow `535151018` would
also have destroyed the 117 RWS datapoints that came from flow `2490944`.
The clear-down was done instead by deleting exactly the datapoint ids listed
in the two `*_parent_data.csv` files, inside one transaction.

### Stale child CSVs are still globbed

The seeder finds child data by pattern (`{flow_id}_child_data_*.csv`,
`seeder_config.py:69`), **not** from `mis_child_form_ids`. Setting that to `[]`
does not stop it reading the four pre-existing child CSVs, which would have
created children under the old monitoring forms against parents that no longer
exist. They were moved to
`storage/akvo-flow/data/_stale_pre_dedicated_forms/` rather than deleted.

### Mapping CSVs are generated, not fuzzy-matched

`af_form_generator.py` now writes
`output/forms/{flow_id}_mapping_parent_{mis_form_id}.csv` alongside the form,
built by `util/form_mapping.py:build_mapping_rows`. Because question ids are
the Flow ids, every row is an exact identity pair
(`match_method: identity`, score 100).

| | unmapped questions |
|---|---|
| Old fuzzy mapping onto the shared RWS form | most rows `NaN` |
| New identity mapping | **0** of 94 and 0 of 68 |

Running `af_forms_mapping.ipynb` was deliberately avoided: it iterates every
file in `output/flow_forms/` and would have re-scored the other six surveys'
verified mappings.

### Option label aliases

The Flow answers use singular forms where the option list defines plurals, so
`label_aliases.json` gained four entries:

```
"flush toilet"      -> ["flush_toilets"]
"water seal toilet" -> ["water_seal_toilets"]
"pit toilet"        -> ["pit_toilets"]
"compost toilets"   -> ["compost_toilet"]
```

Aliases are applied by the **notebook** when it writes the data CSV, not by the
backend seeder — so adding one means re-running
`af_data_registration_monitoring.ipynb` before re-seeding.

### Test fixture

`tests_form_seeder.py` hardcodes the list of expected form names and asserts
the count matches. The two new names were added; 47 tests pass.

### Photos must be pre-downloaded first — runbook step 7

`AnswerProcessor.process_photo` falls back to an **inline, serial** download
whenever a URL is absent from `photo_url_map`, mid-transaction, one record at a
time. Skipping `predownload_photos` cost roughly 100x:

| | rate | 1,593 records |
|---|---|---|
| Cold cache (inline fetch) | ~17/min | ~94 min |
| Warm cache | ~1,900/min | ~1 min |

The trap is that `load_success_log()` does not trust the log — it **stat()s
every file** and silently drops entries whose image is missing from disk:

```python
full_path = os.path.join(STORAGE_PATH, local_path.lstrip('/'))
if os.path.exists(full_path):
    result[url] = local_path
```

So a populated `<flow_id>_photo_downloads.csv` proves nothing on its own. The
log listed 13,614 photos while `storage/images` held 6,779; the rest were
re-fetched inline. Verify coverage through the real code path
(`PhotoPreDownloader(form_id=...).load_success_log()`) rather than by reading
the CSV.

```bash
./dc.sh exec backend python manage.py predownload_photos --form=535151018 --workers 10
./dc.sh exec backend python manage.py predownload_photos --form=540671011 --workers 10
```

3,185 and 3,835 photos, no failures. Note `_append_success_log` appends
unconditionally, so re-running leaves duplicate rows in the log — harmless,
since the loader builds a dict.

### The Rotuma administration gap

17 records of 535151018 failed with an unresolved administration, all on the
path `Eastern|Rotuma|Rotuma` — the one entry in `administration_missing.csv`.
Pre-existing, not caused by the new forms: the earlier migration had imported
exactly the same 1,576 of 1,593.

Rotuma occurs twice in the Fiji hierarchy — the province and the tikina beneath
it — but `administration_seeder` upserts on name alone:

```python
Administration.objects.update_or_create(name=name, defaults={...})
```

Two administrations sharing a name therefore collapse into one row, and only
the province survived. The model has no unique constraint on `name`, so the
second record is perfectly legal; only the seeder's lookup key prevents it.

Adding the record is necessary but **not sufficient**. Resolution runs through
`get_administration_id`, which reads `administration_mapping.csv`
(`flow_datapoint_id -> administration id`) and falls back to a dict keyed by
**bare name** — so the full path string `Eastern|Rotuma|Rotuma` can never match
the fallback. Both halves were needed:

1. Create the level-3 Rotuma under the province (id 1475, path `1.23.91.`).
2. Fill `mis_value = 1475` for the 17 `Eastern|Rotuma|Rotuma` rows in
   `administration_mapping.csv`, which were the file's only NaN rows.

Re-running the seeder then picked up exactly those 17 (`1593/1593`, 0 invalid).

> Re-running `administration_seeder` would collapse the two Rotuma rows again.
> Fixing the upsert to key on `(name, level, parent)` is a separate change.

### Local administration levels

The local database labels its levels National / Province / District /
Subdistrict / Village (from the Indonesia demo seed) while holding the Fiji
tree — level 1 is Eastern/Western/Northern/Central, level 3 the Tikinas. So
`max_level: 3` still stops at Tikina as intended; only the displayed level
names are off, and that is a local seeding artefact, not a form problem.

---

## 9. Downstream consequences of repointing

`storage/akvo-flow/flow_forms.json` currently maps both surveys onto the shared
RWS forms:

```json
"535151018": { "mis_form_id": 1749621221728, "mis_child_form_ids": [1749621962296, 1749631041125] },
"540671011": { "mis_form_id": 1749621221728, "mis_child_form_ids": [1749621962296, 1749631041125] }
```

Repointing makes these six mapping CSVs stale:

```
output/forms/535151018_mapping_parent_1749621221728.csv
output/forms/535151018_mapping_child_1749621962296.csv
output/forms/535151018_mapping_child_1749631041125.csv
output/forms/540671011_mapping_parent_1749621221728.csv
output/forms/540671011_mapping_child_1749621962296.csv
output/forms/540671011_mapping_child_1749631041125.csv
```

They must be regenerated by re-running `af_forms_mapping.ipynb` against the new
form IDs. With Flow IDs carried through as MIS IDs, the parent mapping becomes
the identity function and no longer depends on rapidfuzz similarity scoring.

Flow data already migrated into `1749621221728` from these two surveys stays
where it is. This change affects future migrations only. The
caddisfly and label-alias work described in `flow-caddisfly-label-transform-plan.md`
targets forms `1749621221728` / `1749621962296` / `1749631041125` and will need
its mappings regenerated too.

Since these surveys have no monitoring form in the new layout,
`mis_child_form_ids` becomes `[]`, and any monitoring-form questions that
`af_forms_mapping.ipynb` previously matched have nowhere to go — worth a
deliberate look at what those were before Phase 8.

---

## 10. Rollback

The generator only writes files; nothing before Phase 7 touches the database.

- **Before Phase 7**: delete the two generated files. They are the only
  files the generator writes, and nothing reads them until `form_seeder` runs.
- **After Phase 7**: the forms exist in the database with no submitted data.
  Remove the JSON files and delete the two `Forms` rows (cascade removes their
  groups, questions and options). `reset_forms.py` covers this if a full reset
  is acceptable.
- **After Phase 8**: revert `flow_forms.json` and restore the six mapping CSVs
  from git.

---

## 11. Out of scope

- Monitoring and child forms (excluded by request).
- Regenerating the six stale mapping CSVs (§9) — separate task.
- Fixing the `repeatText` / `repeat_text` seeder key mismatch (§3).
- Flow types absent from these surveys: `barcode`, `scan`, `video`, `signature`,
  `geoshape`.
- Capturing `allowOther` free text (§6).
- Backfilling data already migrated into `1749621221728`.
