# IWSIMS Dashboard API Checklist

Reference list of every API call required by the EPS Overview dashboard, grouped by tab and chart. All calls hit `http://localhost:3000` in development.

**Common filters** (date range, administration, implementing agency, water committee) are omitted for brevity. When the user selects dashboard filters, they are applied as:

- `administration_id=<id>` — on all endpoints
- `from_date=<date>&to_date=<date>` — on all endpoints
- `criteria=option_contains:<qid>:<value>` — on `/values`, `/progress`, `/maps/geolocation`. The backend **auto-splits** criteria: qids on the widget's `form_id` narrow monitoring records; qids on the parent (registration) form narrow parent records.
- `filter_criteria=option_contains:<qid>:<value>` — on `/escalation` only (AND-narrowing on top of escalation OR criteria)

**Donut restricted tally**: When a criteria filter targets the same question as a `group_by=option` donut on a `multiple_option` question, only the filtered option values are tallied (not all co-selected values in the answer array).

---

## 1. Monitoring Overview

### KPIs

**Total EPS registered**

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749623934933' \
  -H 'accept: */*'
```

**Total EPS under construction**

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749624452908&question_id=1749630516826&option_value=no&monitoring=latest&sum_by=parent_id' \
  -H 'accept: */*'
```

**Total EPS operational**

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&question_id=1749633373968&option_value=operational&monitoring=latest&sum_by=parent_id' \
  -H 'accept: */*'
```

**Total EPS with critical issues**

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&question_id=1749633373968&option_value=issue_with_system&monitoring=latest&sum_by=parent_id' \
  -H 'accept: */*'
```

### Donut charts

**Operational status**

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&question_id=1749633373968&group_by=option&monitoring=latest&sum_by=parent_id&value_type=percentage' \
  -H 'accept: */*'
```

**Water committee** (registration donut — one answer per record)

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749623934933&question_id=1749624452105&group_by=option&sum_by=id&value_type=percentage' \
  -H 'accept: */*'
```

**Implementing authority** (registration donut)

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749623934933&question_id=1749624452993&group_by=option&sum_by=id&value_type=number' \
  -H 'accept: */*'
```

**Lab tested vs CBT tested** (monitoring donut — aggregate per parent EPS)

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&question_id=1749633001462&group_by=option&monitoring=latest&sum_by=parent_id&value_type=percentage' \
  -H 'accept: */*'
```

### Drinking water compliance (stacked bar — frontend computed)

Fan out **one `/values` call per parameter**, merge responses by `data[].group` (parent EPS id), then classify each EPS against its thresholds to build the `Yes` / `No` stacked bar. See [iwsims-dashboard-config-example.md §6](iwsims-dashboard-config-example.md) for the transform.

| Parameter | Question ID | Threshold |
|---|---|---|
| E. coli | `1749633220746` | ≤ 0 |
| Turbidity | `1749633220745` | ≤ 5 |
| Coliform | `1749633259392` | ≤ 0 |
| Parameter X | `1749633295165` | ≤ 0 |
| Temperature | `1797307852531` | ≤ 30 |
| pH | `1797307852532` | 6.5–8.5 |
| Conductivity | `1797307852533` | ≤ 1000 |
| Salinity | `1797307852534` | ≤ 1 |

Template (one call per `question_id` above):

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&question_id=<QID>&group_by=parent_id&monitoring=latest&repeat_agg=average' \
  -H 'accept: */*'
```

### Tab-bottom KPIs (Monitoring overview)

Three additional KPIs render under the donut row, before the escalation table.

**Total EPS monitored in last 12 months** — distinct count of registration EPS that have at least one water-quality monitoring submission whose `inspection_date` (`1749632545235`) falls in the rolling 12-month window. Frontend templates `from_date = today - 12 months` and `to_date = today`. Display as `count / total` ("52/total").

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&monitoring=latest&sum_by=parent_id&date_question_id=1749632545235&from_date=<TODAY-12M>&to_date=<TODAY>' \
  -H 'accept: */*'
```

**Total EPS with critical issues** — same call as the top-row KPI in §Monitoring Overview KPIs (operational_status = `issue_with_system`); reuse the response.

**Total EPS where water sample collection was not possible** — distinct EPS whose latest water-quality monitoring marks `1749632647507 = no`.

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&question_id=1749632647507&option_value=no&monitoring=latest&sum_by=parent_id' \
  -H 'accept: */*'
```

### Escalation list (table)

Surfaces EPS where water-quality parameters are out of range OR the system has an issue OR the sample could not be collected. Single `/escalation` call; rows are the inclusive OR of the criteria. The "Accessibility issues" column in the design is a placeholder — render an empty cell until a QID is assigned.

| Column | Source | Notes |
|---|---|---|
| EPS name | `parent_answer:1749624452994` | Lives on the registration form, so use `parent_answer` (not `answer`, which only reads the latest monitoring submission). `parent_name` is also acceptable if you want the auto-generated datapoint name |
| Village Name | `parent_answer:1749624452991` | Registration-form question |
| Last Monitoring | `latest_date:1749632545235` | inspection_date from latest water-quality submission |
| Operational Status | `answer:1749633373968` | `operational` / `issue_with_system` |
| Not able to collect the water sample | `answer:1749632647507` | `yes` / `no` |
| Critical water quality issues | `answer` per parameter QID OR client-side `violations` summary | `/escalation` has no `violations` source — fan out a column per parameter (`ecoli:answer:1749633220746`, …) and roll up client-side, or just show the failing parameter labels via the frontend |
| Accessibility issues | *(placeholder)* | QID pending |

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/escalation/1749623934933?monitoring_form_id=1749632545233&page=1&page_size=20&criteria=option_equals:1749632647507:no,option_equals:1749633373968:issue_with_system,threshold_gt:1749633220746:0,threshold_gt:1749633259392:0,threshold_gt:1749633295165:0,threshold_gt:1749633220745:5,threshold_gt:1797307852531:30,threshold_gt:1797307852533:1000,threshold_gt:1797307852534:1&columns=eps_name:parent_answer:1749624452994,village_name:parent_answer:1749624452991,last_monitoring:latest_date:1749632545235,operational_status:answer:1749633373968,water_collection:answer:1749632647507,ecoli:answer:1749633220746,coliform:answer:1749633259392,turbidity:answer:1749633220745' \
  -H 'accept: */*'
```

> The design's red alert annotation ("alert when not able to collect the water sample…") is a frontend row-styling rule based on the `water_collection` and `operational_status` cells — no backend involvement.

### Inspections per month over last year (bar chart, fiscal axis)

Bar chart of **count of monitoring submissions per month** over the last year. The header label in the design is templated client-side ("Inspections [\<adm\>] (between \<from\> - \<to\>) per Month over Last Year"). Same fiscal-year axis convention as §2 Proposed completion date — backend returns chronological `YYYY-MM` groups, frontend rotates them to start at `filters.date.fiscal_year_start_month`. `monitoring=all` is critical so revisits to the same EPS each contribute a bar instead of being collapsed to the latest.

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&group_by=month&monitoring=all&date_question_id=1749632545235&from_date=<FY_START>&to_date=<FY_END>' \
  -H 'accept: */*'
```

Frontend transform mirrors the construction "Proposed completion date" chart: sort by `group` ascending, rotate to fiscal order, render as bars. Pass `from_date`/`to_date` covering the active fiscal year so the backend gap-fills empty months for a clean 12-bar axis.

---

## 2. Construction Monitoring

### KPIs

**Total EPS under construction (percentage)** — share of registered EPS whose construction-complete flag (`1749630516826`) is `no`. Matches `kpis.under_construction_pct` in the config; the top-row `under_construction` count KPI uses the same question with `value_type=number`.

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749624452908&question_id=1749630516826&option_value=no&monitoring=latest&sum_by=parent_id&value_type=percentage' \
  -H 'accept: */*'
```

**EPS with a past-due completion date** — `to_date` is templated client-side as `today - 1 day` for strict `< TODAY()`; use `today` for `<= TODAY()`.

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749624452908&question_id=1749630516826&option_value=no&date_question_id=1749630516825&to_date=<YYYY-MM-DD>&monitoring=latest&sum_by=parent_id&value_type=percentage' \
  -H 'accept: */*'
```

### Charts

**Percentage of projects completed** — progress-bucket histogram (`0-10%`, `11-20%`, …, `91-100%`). Single call to `/progress`; frontend reads `response.histogram`.

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/progress/1749623934933?monitoring_form_id=1749624452908&filter_question_id=1749630516826&filter_option_value=no&components=concrete_base:any_yes:1849633499999:1849633498888:1849633497777,urf_tank:completed_binary:1849633720001,eps_tank:completed_binary:1849633900003,balance_tank:completed_binary:1849634300002,storage_tank:completed_binary:1849634690001,standpipes:ratio:1849635200001:1849634950001,site_security:multi_select_proportion:1849635500001:3' \
  -H 'accept: */*'
```

**Proposed completion date** — bar chart of incomplete projects bucketed by deadline month. The x-axis follows the **fiscal year ordering** defined by `filters.date.fiscal_year_start_month` (e.g., Jul → Jun for FY anchor `7`, Apr → Mar for `4`); the backend returns chronological `YYYY-MM` groups and the frontend rotates them to fiscal order before rendering. A red vertical reference line marks **TODAY** (client-side `raw_config`). Filtered to incomplete projects only (`1749630516826 = no`).

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749624452908&question_id=1749630516826&option_value=no&group_by=month&date_question_id=1749630516825&monitoring=latest&sum_by=parent_id&from_date=2026-01-01&to_date=2026-12-31' \
  -H 'accept: */*'
```

**Frontend transform** (sketch):

```js
// 1. Fetch /values → { data: [{ value, label, group: "YYYY-MM" }, ...] }
// 2. Sort by group ascending, then rotate so the first bucket is the
//    first month of the fiscal year window covering TODAY.
// 3. Insert a vertical marker line at the bucket containing TODAY
//    (use raw_config.markLine in akvo-charts / ECharts).
```

To bound the x-axis to a single fiscal year, pass `from_date` and `to_date` as the FY start/end (the backend gap-fills missing months when both are provided — see [generic-visualization-api-spec.md](generic-visualization-api-spec.md)).

### Escalation list (table)

Server-side call surfaces overdue incomplete projects via the `overdue` criterion. The design renders **per-component completion percentages** (e.g. `50%`, `33%`, `100%`), so the implementation joins `/escalation` (row set + identifier columns) with `/progress` (computed component scores) on `parent_id` client-side. This is the shipped pattern in [`Dashboard.jsx`](../../frontend/src/pages/dashboard/Dashboard.jsx) (`escalationCellComputers.construction`).

`/escalation` is responsible for: overdue filter, EPS identity, dates. `/progress` is responsible for: per-component scores + overall. Expected progress is computed in the browser from start/deadline.

#### Columns served by `/escalation`

| Column | Source | Notes |
|---|---|---|
| EPS name | `parent_answer:1749624452994` | `parent_name` is also acceptable. |
| Last monitoring | `latest_date:1749624452911` | |
| Deadline | `latest_date:1749630516825` | Formatted `YYYY-MM-DD`; reused as ISO input for the expected-progress computation. |
| `_start_date` (hidden) | `parent_answer:1749624452910` | Helper for the expected-progress computation; column is marked `hide: true` in the frontend config so it isn't rendered, but the row still carries the value. |

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/escalation/1749623934933?monitoring_form_id=1749624452908&criteria=overdue:1749630516826:1749630516825&columns=eps_name:parent_answer:1749624452994,last_monitoring:latest_date:1749624452911,_start_date:parent_answer:1749624452910,deadline:latest_date:1749630516825&page=1&page_size=20' \
  -H 'accept: */*'
```

#### Columns computed client-side from `/progress.details`

Use the same `/progress` call from the **Percentage of projects completed** chart above — no extra round trip. Index `details` by `group` (parent EPS id) and read:

| Column | Computer |
|---|---|
| Concrete base construction | `details[parent_id].components.concrete_base` |
| URF tank implementation | `details[parent_id].components.urf_tank` |
| EPS tank installation | `details[parent_id].components.eps_tank` |
| Balance tank implementation | `details[parent_id].components.balance_tank` |
| Storage tank implementation | `details[parent_id].components.storage_tank` |
| Standpipes | `details[parent_id].components.standpipes` (already `implemented ÷ planned × 100`) |
| Drainage | `details[parent_id].components.drainage` (placeholder until QID resolved) |
| Site security and perimeter | `details[parent_id].components.site_security` (already `selected/3 × 100`) |
| Progress | `details[parent_id].overall` |
| Expected progress | `(TODAY − row._start_date) / (row.deadline − row._start_date) × 100`, clamped to 0–100 |

All values are rendered as rounded integer percent (`Math.round(n) + "%"`). Missing scores render as `—`.

> Design intent of "overall_progress < expected_progress" as a stricter post-filter is **not** currently applied — the server-side `overdue` criterion (incomplete AND deadline < today) is the shipped filter. If the stricter filter is needed, drop rows in the frontend after the join.




## 3. Water Quality

### KPIs

**EPS with water sample taken last 12 months** — share of registered EPS that have at least one water-quality monitoring submission whose `inspection_date` (`1749632545235`) falls in the rolling 12-month window. Frontend templates `from_date = today - 12 months` and `to_date = today` (ISO `YYYY-MM-DD`).

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&monitoring=latest&sum_by=parent_id&value_type=percentage&date_question_id=1749632545235&from_date=<TODAY-12M>&to_date=<TODAY>' \
  -H 'accept: */*'
```

**Lab tested EPS** — distinct count of EPS whose latest monitoring `test_type` (`1749633001462`) is `lab_test`.

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&question_id=1749633001462&option_value=lab_test&monitoring=latest&sum_by=parent_id' \
  -H 'accept: */*'
```

**CBT tested EPS** — same shape as Lab tested, with `option_value=cbt_test`.

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&question_id=1749633001462&option_value=cbt_test&monitoring=latest&sum_by=parent_id' \
  -H 'accept: */*'
```

> Verify the actual option `value` strings against the form definition — replace `lab_test` / `cbt_test` if the seeder uses different slugs (e.g. `lab`, `cbt`).

### Parameter histograms (frontend computed)

Each chart on this tab is a **value-distribution histogram** of one numeric parameter measured per EPS, with a red threshold reference line. The backend serves the **per-EPS aggregated value** (latest monitoring, `repeat_agg=average`); the frontend bins the values along the x-axis using `display.bin_width` from the parameter's config block ([iwsims-dashboard-config-example.md §7](iwsims-dashboard-config-example.md)) and draws the threshold marker via `raw_config.markLine`.

Template (one call per parameter):

```bash
curl -X GET \
  'http://localhost:3000/api/v1/visualization/values?form_id=1749632545233&question_id=<QID>&group_by=parent_id&monitoring=latest&repeat_agg=average' \
  -H 'accept: */*'
```

Response shape: `{ data: [{ value: <avg>, label: <eps_name>, group: <parent_id> }, ...], labels: [...] }`. Frontend buckets `data[].value` into bins and renders count-per-bin as a bar chart.

| Section | Parameter | Question ID | Threshold marker | `bin_width` |
|---|---|---|---|---|
| Microbial | E. coli presence | `1749633220746` | `≤ 0` CFU/100 mL | `50` |
| Microbial | Total coliform presence | `1749633259392` | `≤ 0` CFU/100 mL | `50` |
| Physical | Turbidity | `1749633220745` | `< 5` NTU | `1` |
| Physical | Water temperature | `1797307852531` | `< 30 °C` | `1` |
| Chemical | pH | `1797307852532` | `6.5 – 8.5` (band) | `0.5` |
| Chemical | Conductivity | `1797307852533` | `< 1000` µS/cm | `100` |
| Chemical | Salinity | `1797307852534` | `< 1` ppt | `0.1` |

> The Drinking Water Compliance stacked bar in §1 uses the **same per-EPS values** to classify each EPS as compliant/non-compliant. If both charts are visible at once, fetch each parameter once and reuse the response for both transforms — see [iwsims-dashboard-config-example.md §6](iwsims-dashboard-config-example.md) for the `compliance` compute.

### Filters

All Water Quality calls accept the global `administration_id`, `from_date`, `to_date` filters from the dashboard filter bar. Default scope (no `administration_id`) is the root administration — see [generic-visualization-api-spec.md §Filters](generic-visualization-api-spec.md).