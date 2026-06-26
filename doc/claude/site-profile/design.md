# Design — Site Profile

## Overview

```
MonitoringDetail (Site Profile tab)
└─ ProfilePage                      entry
   └─ ProfileProvider (context)     owns 2 fetches: site-profile payload + registration answers
      ├─ ProfileHeader              photo · name · location subtitle · meta row
      └─ Tabs (from config.tabs)    profile-local antd Tabs
         └─ Main container          per active tab
            ├─ Col left   ── children where position=left, sorted by order
            └─ Col right  ── children where position=right, sorted by order
                 each child → RecordTable | FieldList | HistoryChart | Photo
```

The profile is self-contained under
`frontend/src/pages/manage-data/components/profile/` and depends only on `antd`,
`akvo-charts`, the shared `api`/`store`/`ui-text` libs, and the visualization API.

## Config schema (`config/site-profiles/{parent_form_id}.json`)

```jsonc
{
  "parent_form_id": 1749611049520,
  "name": "Pump Station Site Profile",     // payload.name overrides this in the header
  "subtitle_key": "siteProfilePumpSubtitle", // fallback when no location resolves
  "header": {                                 // hero; all parts optional
    "photo": "pump_station_photo",            // photo question (registration or monitoring)
    "location": "division",                   // administration question → subtitle
    "village": "village_name",                // optional text question, prepended to subtitle
    "meta": [
      { "label_key": "siteProfileType", "value": "Pump Station" },        // static
      { "label_key": "siteProfileCommissioned", "question": "commissioned_year" },
      { "label_key": "siteProfileDesignCapacity", "question": "design_capacity_m3_day", "unit": "m³/day" },
      { "label_key": "siteProfileLastInspection", "source": "last_inspection" } // derived
    ]
  },
  "tabs": [
    { "key": "pumpNElectric", "label_key": "siteProfilePumpsElectrical" }
  ],
  "children": [
    { "id": 1, "tab": "pumpNElectric", "position": "left", "order": 1,
      "chart_type": "record", "label_key": "...",
      "source": "rows",                        // "rows" (latest-derived) | "submissions"
      "rows": [ { "question": "ground_conditions", "photo": "photo_of_..." } ],
      "cols": [
        { "title_key": "siteProfileComponentCol", "field": "question", "render": "question_label" },
        { "title_key": "siteProfileConditionCol", "field": "question", "render": "option_pills" },
        { "title_key": "siteProfilePhotoCol",     "field": "photo",    "render": "photo" }
      ] },
    { "id": 2, "tab": "pumpNElectric", "position": "right", "order": 1,
      "chart_type": "line", "label_key": "...", "question": "bod", "unit": "mg/L",
      "threshold": { "max": 40 } },            // optional → green band + dashed limit lines
    { "id": 3, "tab": "pumpNElectric", "position": "right", "order": 2,
      "chart_type": "field", "label_key": "...",
      "questions": [ "num_pumps_operational" ] },
    { "id": 4, "tab": "inspection", "position": "right", "order": 2,
      "chart_type": "line", "source": "risk_score", "label_key": "siteProfileRiskScoreTrend",
      "questions": [ "station_status", "pump_status", "electrical_panel" ] }
  ]
}
```

`compliance` tables (a `record`) add `compliance_rule: [questionName, …]` and optional
`compliance_text` to render a PASS/FAIL verdict line under the table.

### Binding rules

- **Tab grouping**: a child belongs to the tab whose `key` equals `child.tab`.
- **Layout**: within a tab, children split by `position` (`left`/`right`) and sort by
  `order`. If a tab has only one side, that column spans full width (24). The 2-column
  split uses the **`lg`** breakpoint (≥992px → left 14 / right 10), stacked below.

## Widgets

| `chart_type` | Component | Renders | Data source |
|---|---|---|---|
| `record` | **RecordTable** | antd `Table` from `cols` (cell-render presets) + optional compliance verdict | `rows` (latest-derived) or `submissions` |
| `field` | **FieldList** | key/value list (values may be option pills) | `latest` |
| `line` | **HistoryChart** | akvo-charts `<Line>` + threshold band, **or** computed risk-score trend | `history[question]` / `submissions` |
| `photo` | **Photo** | image grid | `latest[question]` or `submissions` |

### RecordTable data models

- **`source: "rows"`** (default) — one table row per `rows[]` entry. Each `cols[]` reads a
  `field` from the row config (`question`, `photo`, `notes`, …), resolves the answer from
  `payload.latest[name]`, and renders via its `render` preset.
- **`source: "submissions"`** — one table row per inspection (`payload.submissions[]`);
  each `cols[]` `dataIndex` reads `row.answers[dataIndex]` (or `row.date`).
- **Compliance verdict** — when `compliance_rule` is present, the widget evaluates each
  listed question against its row `threshold` and renders
  "Compliance verdict: PASS/FAIL — {compliance_text}".

### Built-in cell render presets (RecordTable)

`text` · `option_pills` (colors from `option.color`) · `threshold`
(Pass / Fail / Below) · `threshold_label` (`< 40 mg/L`) · `value` (+ `unit`) ·
`question_label` · `photo` · `date` · `severity` (option label colored by severity;
renders `—` when unanswered).

### HistoryChart (`line`)

- **Trend** (default): series from `history[question]`. When `threshold {min,max}` is set,
  a green `markArea` band + dashed limit `markLine`s are layered via the ECharts instance
  (`setOption`, the same ref pattern as the dashboard's `HistoricalLineChart`). Short title
  from `label_key`; compact grid with `containLabel`.
- **Risk-score** (`source: "risk_score"`): for each `submissions[]` inspection, score the
  configured `questions[]` (red severity = 2, amber = 1, from `option.color`), bucket the
  sum into **OK · Low · Med · High · Critical** on a categorical y-axis, and render a
  **level legend** beneath the chart.

## Data flow

1. `ProfileProvider` runs the **query-collector** (`utils.js`) over `config` to derive the
   `questions` / `history` / `records` params (including `header` questions).
2. It fetches two sources (lazily, only when the Site Profile tab is active):
   - `GET /visualization/site-profile/{parent_id}?parent_form_id=…&questions=…&history=…&records=…`
     → `{ name, latest, history, submissions }`.
   - `GET /data/{parent_id}` (registration answers) via `getDataPointDetails` — **cached in
     the global store** (`store.dataPointDetails = { id, data }`) and **deduped** with an
     in-flight promise so the Registration Data tab and the header share one request.
3. Both are provided through `ProfileContext` (`payload`, `registration`).
4. Widgets read `payload`; `ProfileHeader` resolves each field:
   **registration answer → monitoring `latest` → `last_inspection` (max `latest[*].created`)
   → static `value`/`value_key`**. The location subtitle reuses the registration
   administration answer (e.g. `"Fiji|Western"` → drop country → "Western"), prepending the
   village when present.

Site-profile payload shape:
```jsonc
{
  "name": "Naqia WWTP",
  "latest":  { "<question>": { "value", "name", "options", "type", "created" } },
  "history": { "<question>": [ { "date", "value", "data_id" } ] },
  "submissions": [ { "data_id", "date", "answers": { "<question>": value } } ]
}
```

## Modules

| File | Role |
|------|------|
| `profile/ProfilePage.jsx` | Entry: provider + header + tabs + Main layout + widget dispatch |
| `profile/ProfileContext.jsx` | `ProfileContext` / `useProfile` / `ProfileProvider` (owns both fetches) |
| `profile/ProfileHeader.jsx` | Hero: photo · name · location subtitle · meta row |
| `profile/widgets/RecordTable.jsx` | `record` widget + cell-render presets + compliance verdict |
| `profile/widgets/FieldList.jsx` | `field` widget |
| `profile/widgets/HistoryChart.jsx` | `line` widget: trend + threshold band + risk-score + legend |
| `profile/widgets/Photo.jsx` | `photo` widget |
| `profile/widgets/index.js` | Barrel for the four widgets |
| `profile/utils.js` | Pure helpers + query-collector + `registrationAnswer` / `lastInspectionDate` (no JSX) |
| `profile/style.scss` | Hero · layout · chart · risk legend styling |
| `profile/index.js` | Public barrel (`ProfilePage`, context) |
| `lib/data-point-details.js` | `getDataPointDetails(id)` — cached + in-flight-guarded `GET /data/{id}` |
| `lib/store.js` | `dataPointDetails: { id, data }` cache field |
| `manage-data/DataDetail.jsx` | Registration tab — reads/populates the same cache (dedupe) |

## Internationalization

Labels are i18n keys (`label_key`, `title_key`, `subtitle_key`, `name_key`) resolved via
`getText(text, key, fallback)` against `lib/ui-text.js`, falling back to a raw `label`
string when no key is present.

## API

Read-only, no backend change:
- `GET /api/v1/visualization/site-profile/{parent_id}?parent_form_id=&questions=&history=&records=`
  → `{ name, latest, history, submissions }` (from the existing materialized views).
- `GET /api/v1/data/{parent_id}` — registration answers (same endpoint the Registration
  Data tab uses), for header meta/photo/location.
