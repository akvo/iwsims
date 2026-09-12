# Akvo Flow Seeding: Caddisfly, Label Transformation, Cascade Names and Repeat Index

Covers the four gaps found while finalising the question mappings for the
Rural Water Point Survey (Flow `535151018`) and the School Form 2021-2022
(Flow `540671011`) onto the Rural Water Project MIS forms
(parent `1749621221728`, Monitoring `1749621962296`, Quick Monitoring
`1749631041125`). Everything below is implemented; the "Status" column says
what was verified.

## Summary

| # | Gap | Where fixed | Status |
|---|-----|-------------|--------|
| 1 | Flow option labels differ from MIS option labels, so the seeder drops them as invalid | `af_data_registration_monitoring.ipynb` + `label_aliases.json` | Implemented, self-checked, 2490944 re-run compared |
| 2 | Caddisfly (Aquagenx CBT) answers: only the *last* result was stored and the photo was lost | notebook + mapping CSVs (one Flow question fans out to number / option / photo) | Implemented, 2490944 re-run compared |
| 3 | Cascade answers on non-administration questions (school name) became empty strings | notebook `transform_mis_value` | Implemented, old paths unchanged |
| 4 | Two Flow questions mapped to one MIS question overwrote each other | notebook (`<id>-<n>` columns) + seeder (`Answers.index`) | Implemented, 167 seeder tests pass incl. 4 new |

---

## 1. Option label transformation

### Problem

`transform_mis_value` matched a Flow option answer to a MIS option by exact
label. Anything else was passed through as raw text, and
`AnswerProcessor.process_option` in the seeder keeps only values that exist in
the MIS option list, so the answer landed in `invalid_values.csv`.

Examples from the two surveys: `Village` vs `Villages`,
`Compartment Bag Test (CBT)` vs `CBT Test`, `Intermediate Risk` vs
`Medium Risk`/`Moderate Risk`, `No Risk` vs `No risk`, and every value of
"type of water supply" vs "Type of Project".

### Design

`resolve_option_value(question, text)` in the notebook resolves in order:

1. exact label match (previous behaviour, unchanged);
2. case- and whitespace-insensitive match on label **or** value;
3. alias table lookup;
4. for labels with a " / " suffix (Aquagenx risk categories such as
   `High Risk / Possibly Unsafe`) retry steps 1 to 3 with the part before it;
5. fall back to the raw text so the seeder still reports it as invalid.

The alias table is **not in the notebook**. It is loaded from
`scripts/akvo-flow/label_aliases.json`, which is gitignored
(`scripts/akvo-flow/.gitignore`). `label_aliases.example.json` is committed as
the template. Keys are Flow labels (normalised the same way as step 2);
values are a list of MIS option *values* to try in order. A candidate is only
used when the target question actually offers it, so one table can serve
every form: `"intermediate risk": ["medium_risk", "moderate_risk"]` resolves
to `medium_risk` on Quick Monitoring and `moderate_risk` on Monitoring.

If the file is missing the notebook prints a notice and behaves as before
(steps 1, 2 and 4 only).

### Setup

```bash
cd scripts/akvo-flow
cp label_aliases.example.json label_aliases.json   # edit per deployment
```

### Entries shipped in the example

| Flow label (normalised) | MIS candidates | Used by |
|---|---|---|
| village / settlement | villages / settlements | parent "The project is meant for?" |
| compartment bag test (cbt), cbt bag test | cbt_test | test method |
| intermediate / moderate / medium risk | medium_risk, moderate_risk | CBT risk level |
| rural water scheme, mrd borehole scheme, sea water desalination system, rainwater harvesting system, ... | surface_water_project, borehole, desalination, rainwater_harvesting | "Type of Project" |
| river, creek, stream, spring, well, rain water | surface_water_river, ..., ground_water, rainwater | "Type of Water Source?" |
| low risk / safe, intermediate risk / probably safe, intermediate risk / possibly safe, high risk / possibly unsafe, high risk / probably unsafe, very high risk / unsafe, very high risk | low_risk, medium_risk/moderate_risk, high_risk | Caddisfly health-risk category (all six Aquagenx categories seen in the data) |

Labels with no sensible MIS value (for example `WAF Urban Water Supply` as a
project type) are deliberately absent and will keep surfacing in
`invalid_values.csv` for review.

---

## 2. Caddisfly handling

### What a caddisfly answer looks like

```json
{"type": "caddisfly", "name": "Water - E.coli", "uuid": "...",
 "result": [
   {"name": "Health Risk Category (Based on MPN and Confidence Interval)", "unit": "", "value": "Very High Risk / Unsafe"},
   {"name": "MPN", "unit": "MPN/100ml", "value": ">100"},
   {"name": "Upper 95% Confidence Interval", "unit": "", "value": "9435.1"}],
 "image": "https://akvoflow-102.s3.amazonaws.com/images/....jpg",
 "testDate": "2022-04-22 14:25", "app": {"appVersion": "1.0.21 (Build 297)"}}
```

### Previous behaviour and its bug

The notebook took `result[-1].value` for whatever single MIS question the
caddisfly Flow question was mapped to. For Aquagenx CBT the last result is the
**upper confidence interval**, so the RWS re-run showed `9435.1` stored as
"E.coli Level using CBT?". The image URL was discarded.

### Design

One caddisfly Flow question is mapped to **several** MIS questions in the
mapping CSV (extra `manual` rows with the same `flow_question_id`; the mapping
notebook preserves them on re-run). The data notebook dispatches by the MIS
question **type** (`caddisfly_value_for`):

| MIS type | Caddisfly field | Transform |
|---|---|---|
| number | result named `MPN` | `parse_caddisfly_number`: strips censoring marks (`>100` becomes `100.0`, `<1` becomes `1.0`); unparsable text is kept for the invalid report |
| option / multiple_option | result named `Health Risk ...` | `resolve_option_value` (alias table above) |
| photo | `image` | URL as-is, so `predownload_photos` fetches it like any Flow photo |
| anything else | `result[-1].value` | legacy fallback |

Rules:

- Caddisfly values are applied **after** all other mappings and only fill
  MIS questions that are still empty. An enumerator-entered value (for example
  the free-text "What is the result of CBT Bag Test?") always wins.
- The per-datapoint `{flow_form_id}_caddisfly_data.csv` export is unchanged
  (same columns, verified byte-identical on 2490944) and is written once per
  caddisfly Flow question.

### Mapping rows (generic rule)

`af_forms_mapping.ipynb` fans every Flow `caddisfly` question out
automatically (`caddisfly_fanout_rows`, applied per child form before the CSV
is saved). Targets are chosen by MIS type and label, first match wins:

| MIS type | Label rule | Receives |
|---|---|---|
| number | contains "cbt" and not "lab" | MPN |
| option | contains "risk" | health-risk category |
| photo | contains "cbt" | test image |

Rows are written as `manual` so re-runs keep them and they can be edited like
any manual row; only the unmatched placeholder row of the caddisfly question
is removed. Applied to every existing child mapping CSV: all six surveys
with a caddisfly question (1520924, 2490944, 5530933, 8520967, 535151018,
540671011) now have the three targets on each child form; the wastewater
surveys (17260923, 27040920) have no caddisfly question. Every caddisfly
photo therefore lands on the form's "Take photo of CBT Bag" question.

---

## 3. Cascade answers on non-administration questions

Flow cascade answers are `[{"code": "...", "name": "..."}]`. Only the
`administration` branch handled them; on an `input` question the list fell
into the option branch, found no `text` keys and returned `""`. The school
name (registered schools use a cascade) would have been lost, and with it the
datapoint name.

`transform_mis_value` now has one extra branch, placed **after** the
administration and geo branches and **before** the option branch: a list whose
items are dicts without `text` is joined by `" - "` from their `name` (or
`text`) fields. Administration answers still produce the pipe-joined path,
option lists still produce pipe-joined values, so existing forms are
unaffected (2490944 parent output identical).

---

## 4. Repeat index for repeatable question groups

### Problem

The row dictionary was keyed by MIS question id, so a second Flow question
mapped to the same MIS question silently overwrote the first. For repeatable
groups (Inspection Photos, Water Quality Testing) the second value should be
the next repeat instance instead.

### Column format

`<mis_question_id>` for index 0, `<mis_question_id>-<n>` for index `n >= 1`.
This is the key format `Answers.to_key` already uses for exports, so nothing
new has to be learned when reading the CSVs.

### Notebook

- `add_answer(row_data, questions, id, value)`: first value goes to `<id>`;
  a further value goes to `<id>-<n>` **only if** the MIS question group is
  repeatable (`question_group_repeatable` from the form JSON); otherwise the
  last mapping wins as before.
- `place_indexed_columns` keeps `<id>-<n>` right after `<id>` when ordering
  columns for parent and child CSVs.
- Mapping rows added: school hand-washing photo (535141016) now maps to
  Inspection Photos "Take a photo" in both children, alongside the toilet
  photo, and becomes `…-1`.

### Seeder (backend)

| File | Change |
|---|---|
| `utils/seeder_config.py` | `parse_question_column(col) -> (question_id, index) or None` is the single parser for data CSV columns; tolerates `123.0` |
| `utils/seeder_data_loader.py` `load_questions` | uses the parser (previously `int(float(col))` would crash on `123-1`) |
| `utils/seeder_data_processor.py` `prepare_answer_data` | iterates the row's columns through the parser and adds `index` to each answer record |
| `utils/seeder_data_processor.py` `bulk_create_answers` | existing answers keyed by `(question_id, index)`; new rows created with `index`; records without `index` default to 0 |
| `utils/seeder_photo_downloader.py` `extract_photo_urls_with_context` | collects URLs from every column of a photo question, indexed ones included |
| `management/commands/predownload_photos.py` | uses the parser to find photo questions |

Tests: `api/v1/v1_data/tests/tests_flow_data_seeder_repeat_index.py`
(parser, `load_questions`, `prepare_answer_data`, create + update per index,
index defaults to 0). Full seeder suite: 167 tests, all passing.

Known limits, unchanged by this work:

- `af_downloader.ipynb` flattens Flow repeat iterations by overwriting, so
  only the **last** iteration of a Flow repeatable group reaches the raw CSV.
  Repeat indexes here come from *several Flow questions* mapping to one MIS
  question, not from Flow iterations.
- `use_human_readable = True` does not rename `<id>-<n>` columns to labels.

---

## Verification performed

1. Notebook helpers exercised in isolation (alias resolution incl. missing
   config, cascade join, repeat index, caddisfly dispatch, column placement).
2. 2490944 re-run against the previous outputs: same row counts and columns;
   only differences are the two intended value changes (MPN instead of
   confidence interval; `creek` resolved to `surface_water_creek`).
3. Backend: flake8 clean; seeder test modules pass in the backend container.

## Flow API outage and the Excel fallback

During this work every `form_instances` call returned `403` with
`accessing discovery url (https://akvofoundation.eu.auth0.com/.well-known/openid-configuration) failed: 22: certificate chain too long`
for old and new surveys alike (the server cannot validate tokens against
Auth0; a client-side `-k` does not help). `af_export_to_raw.py` converts a
Flow Excel export into the downloader's raw CSV format so the rest of the
pipeline runs unchanged. Both new surveys were processed this way:

| Survey | Submissions | Parent rows | Child rows per form | Extra repeats dropped |
|---|---|---|---|---|
| 535151018 | 1598 | 1593 | 1598 | 81 (Group 3) |
| 540671011 | 978 | 975 | 978 | 7 (Group 3) |

Option values still expected in `invalid_values.csv` after seeding, by
design: `WAF Urban Water Supply`, `EPS - Ecological Purification System`,
`Privately owned/supply system`, `Private` and `WAF water Supply` as a
project type (no MIS equivalent), plus free-text "other" water sources.

## Administration correctness (official list)

The partner's official hierarchy (`backend/source/fiji.csv`, Division /
Province / Tikina / Village; two province spellings normalised to the DB and
Flow spelling: `Lomaiviti`, `Nadroga/Navosa`) was imported additively with the
new `administration_csv_seeder` command: 5 tikinas and 1169 villages created,
0 existing rows changed (294 to 1468). `af_administration_mapping.ipynb` was
fixed to key lookups on parent name, to tolerate merged province names, to
skip non-administration cascades (school name) and to apply `_administration`
aliases. Result: 540671011 fully resolved; 535151018 resolves all but the
17 rows in `Eastern|Rotuma|Rotuma` (no such tikina in MIS or the official
list). Nine tikina groups in the older surveys were previously matched to the
wrong province (for example `Tailevu|Wailevu` to Cakaudrove's Wailevu) and
now map correctly; re-seeding those surveys updates them.

## Seeder fixes found during the trial seed

- `flow_data_seeder --limit=N` wrote the *limited* DataFrames back to
  `storage/akvo-flow/data/*.csv`, truncating the data files to N rows. Limited
  runs now leave the CSVs unchanged (the full run still writes the `success`
  column).
- Photos downloaded on the fly by the seeder were stored as
  `./storage/images/<file>` (a filesystem path) while pre-downloaded photos
  and API uploads use the URL form `/images/<file>`. On-the-fly downloads
  now store `/images/<file>` too. Any answer already stored with the old
  form is corrected when its survey is re-seeded.

## Shared form configuration

`storage/akvo-flow/flow_forms.json` (template
`scripts/akvo-flow/flow_forms.example.json`) now drives the three notebooks
through `util/config.py` and the seeder through
`utils.seeder_config.load_flow_form_ids`, replacing four hard-coded maps.

## Next phase (per form)

```bash
cd scripts/akvo-flow
cp label_aliases.example.json label_aliases.json         # once
# af_downloader.ipynb  -> storage/akvo-flow/raw/{535151018,540671011}_*.csv
# af_data_registration_monitoring.ipynb with flow_form_id = '535151018' then '540671011'
./dc.sh exec backend python manage.py predownload_photos --form=<flow_id>
./dc.sh exec backend python manage.py flow_data_seeder --form=<flow_id> --email=<you>
# review storage/akvo-flow/invalid_values/<flow_id>_invalid_values_data.csv and extend label_aliases.json
```
