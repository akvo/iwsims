# Visualisation Dashboard — Gap Plan

Working document for closing the gap between the current config-driven dashboards
and the `lotte` design mock. **Chart parity is the goal, not pixel parity** — the
mock is a reference for *which graphs should exist*, not for layout or wording.

- Mock: [`doc/visualization/lotte/index.html`](./lotte/index.html) (static, mock data — open in a browser)
- Progress checklist: **[issue #34](https://github.com/akvo/iwsims/issues/34)** — tick the boxes there as you go.

---

## 1. Reference map — read these, not the whole repo

Everything below is the complete surface area for dashboard work. You should not
need to grep the repo to get oriented.

### Authoritative schema docs

| Doc | What it covers |
|---|---|
| `frontend/src/config/visualizations/README.md` | **661-line authoritative reference.** Item schema, `chart_type` catalogue, all 5 chart data-source modes, `col_span` semantics, cross-refs by id, custom-component escape hatch + rule-of-three, filter hints, escalation tables, empty-data behaviour, testing. **Read this before adding any chart.** |
| *(none for site profiles)* | Site-profile schema is undocumented — see [§3](#3-site-profile) below. |

### Dashboard rendering

| File | Role |
|---|---|
| `frontend/src/pages/dashboard/Dashboard.jsx` (958 L) | Page shell. Owns the compute fan-out: walks the item tree, collects items by `compute` mode, fires invisible fetchers, assembles `computeResponses` keyed by mode → itemId. Also builds `cellComputersById` for escalation-table computed columns. |
| `frontend/src/components/dashboard/DashboardRenderer.jsx` | Recursive layout engine. Sorts by `order`, drops `hide` + `HIDDEN_TYPES`, wraps in `<Col span={col_span ?? 24}>`, dispatches on `chart_type`. **Add a new `chart_type` here.** |
| `frontend/src/components/dashboard/ChartRenderer.jsx` (~760 L) | Generic chart wrapper for the akvo-charts types. Handles `dots` / `dot_strip` specially and maps `histogram` → `bar`. |
| `frontend/src/components/dashboard/constants.js` | `CONDITION_TONE_COLORS`, `buildSiteDetailHref(formId, dataId)`, `COMPLIANCE_PARAM_COMPUTES`. |
| `frontend/src/components/chart/options/` | ECharts option builders: `Bar`, `BarStack`, `Line`, `LineArea`, `Pie`, `common.js`. |

### Widgets and hooks

| Path | Contents |
|---|---|
| `frontend/src/components/dashboard/widgets/` | `KPICard`, `MetricCard`, `RankingWidget`, `SectionTitleWidget`, `FilterBarWidget`, `TabsWidget`, `CustomComponentWidget`, `FormulaInfo` (the ⓘ formula popover) |
| `frontend/src/components/dashboard/compute/` | 19 pure calculators — see table in [§4](#4-compute-modes-in-use) |
| `frontend/src/components/dashboard/custom-components/` | React escape hatches + `index.js` named-export registry |
| `frontend/src/components/dashboard/DashboardMap/` | `index.jsx`, `useMapFilters`, `useMapByParent`, `resolveColorMap`, `getCrossFormQuestionOptions`, `MapPopupCard`, `DashboardMapHeader` |
| `frontend/src/util/hooks/` | `useDashboardConfig`, `useDashboardFilters`, `useDashboardValues`, `useDashboardProgress`, `useDashboardEscalation`, `useVisualizationRequest` |
| `frontend/src/lib/ui-text.js` | i18n strings. Every `label_key` / `title_key` / `caption_key` in the site-profile configs resolves here. |

### Site profile rendering

| File | Role |
|---|---|
| `frontend/src/pages/manage-data/MonitoringDetail.jsx` (559 L) | Hosts the profile as the first `TabPane` (`key="site-profile"`), resolves config via `getSiteProfileConfig(profileFormId)` |
| `frontend/src/pages/manage-data/components/profile/ProfilePage.jsx` | Tab + two-column (`position: left|right`) layout engine |
| `frontend/src/pages/manage-data/components/profile/ProfileHeader.jsx` | Photo carousel + meta strip |
| `frontend/src/pages/manage-data/components/profile/widgets/` | `RecordTable` (`chart_type: record`), `FieldList` (`field`), `HistoryChart` (`line`), `Photo` |
| `frontend/src/pages/manage-data/components/profile/utils.js`, `ProfileContext.jsx` | Query building + shared context |

### Routes

| Route | File | Notes |
|---|---|---|
| `/dashboard/:slug` | `App.js:110` | The only dashboard route. Slug resolves via the visualizations registry. |
| `/control-center/data/:form/monitoring/:parentId` | `App.js:154` | Site profile lives here as a tab, **not** under `/dashboard`. |

### Backend

| Path | Notes |
|---|---|
| `backend/api/v1/v1_visualization/` | Charts + maps endpoints |
| `backend/utils/report_generator.py` | Word (`.docx`) generation — `generate_datapoint_report()` |
| `backend/api/v1/v1_jobs/urls.py:39` | `download/datapoint-report` — Word export exists at the data layer, is **not** wired to the site profile. No PDF anywhere. |

---

## 2. Where each visualisation lives

### Dashboards

All configs live in `frontend/src/config/visualizations/` and are registered in
that directory's `index.js` (`RAW_CONFIGS` array). Filename = `parent_form_id`.

| Asset | Slug / URL | Config file | Site-profile config | Current chart count |
|---|---|---|---|---|
| WWTP | `/dashboard/wwtp-overview` | `1748903240763.json` | ✅ | rich on treatment units, thin on effluent |
| WTP | `/dashboard/wtp-overview` | `1749634736797.json` | ✅ | most complete |
| RWS | `/dashboard/rws-overview` | `1749621221728.json` | ✅ | complete + construction tab |
| EPS | `/dashboard/eps-overview` | `1749623934933.json` | ✅ | complete + construction tab |
| Pump Stations | `/dashboard/pump-overview` | `1749611049520.json` | ✅ | **6 items total — biggest gap** |

### Site profiles

Configs in `frontend/src/config/site-profiles/`, registered in that directory's
`index.js` keyed by `parent_form_id`. Reached by opening any datapoint:

```
/control-center/data/<parent_form_id>/monitoring/<datapoint_id>
```

Example (EPS): <http://localhost:3000/control-center/data/1749623934933/monitoring/1118821031>

| Profile | Tabs |
|---|---|
| WWTP `1748903240763` | infrastructure · effluent · risks · inspection |
| WTP `1749634736797` | drinkingWaterQuality · pumpsDosing · infrastructure · ohsSafety · operations · inspection |
| Pump `1749611049520` | pumpNElectric · infrastructure · ohsSafety · operations · inspection |
| RWS `1749621221728` | constructions · waterQuality · inspection |
| EPS `1749623934933` | constructions · waterQuality · inspection |

---

## 3. Site-profile config schema (undocumented elsewhere)

```jsonc
{
  "parent_form_id": 1749623934933,
  "name": "EPS Site Profile",
  "subtitle_key": "...",              // ui-text.js key
  "header": {
    "photo": ["eps_photo", "..."],    // question names, first non-empty wins
    "location": "division_province_tikina",
    "village": "village_name",
    "meta": [{ "label_key": "...", "question": "..." | "value": "..." | "source": "last_inspection" }]
  },
  "tabs": [{ "key": "waterQuality", "label_key": "siteProfileWaterQuality" }],
  "children": [                        // FLAT list, assigned to a tab by `tab`
    {
      "id": 4,
      "tab": "waterQuality",
      "position": "left" | "right",    // two-column layout
      "order": 3,
      "chart_type": "record" | "field" | "line",
      "label_key": "...",
      "caption_key": "...",

      // chart_type: record  → RecordTable
      "source": "rows" | "submissions" | "risk_score",
      "rows": [{ "question": "...", "photo": "..." }],
      "cols": [{ "title_key": "...", "field": "question", "render": "question_label" | "option_pills" | "photo" }],

      // chart_type: field   → FieldList
      "questions": ["q1", "q2"],

      // chart_type: line    → HistoryChart
      "question": "e_coli_level",
      "unit": "cfu/100ml",
      "threshold": { "min": 6.5, "max": 8.5 },
      "date_question": "inspection_date"
    }
  ]
}
```

Every `*_key` must exist in `frontend/src/lib/ui-text.js` or the label renders blank.

---

## 4. Compute modes in use

`compute` selects a frontend calculator instead of a plain `api` fetch. Modes
currently wired (Dashboard.jsx fan-out + widget-local):

| `compute` | Module | Used by |
|---|---|---|
| `compliance` | `compute/compliance.js` | water-quality stacked bars |
| `compliance_kpi` | `compute/compliance.js` | compliance KPI cards |
| `critical_kpi` | `compute/critical.js` | "critical issues" cards |
| `rules_kpi` | `compute/rulesKpi.js` | rule-matched count cards |
| `cross_tab` | `compute/crossTab.js` | cross-form category × series |
| `kpi_stack` | `compute/kpiStack.js` | independent-metric stacks |
| `accessibility_bucket` / `accessibility_no_issues_kpi` | `compute/accessibility.js` | RWS accessibility |
| `bucket_bar` | `compute/bucketBar.js` | bucketed bars |
| `grouped_stack` | `compute/groupedStack.js` | grouped stacked bars |
| `date_histogram` | `compute/dateHistogram.js` | inspection-date histogram |
| `process_counts` | `compute/processCounts.js` | treatment-process counts |

Not yet referenced from any config but available: `valueBuckets`, `valueHistogramBins`,
`progressHistogram`, `stageFlow`, `conditionMatrix`, `processStatus`, `complianceTrend`,
`fiscalMonthRotation`, `formula`.

### Custom components registry

`frontend/src/components/dashboard/custom-components/index.js` — resolved by name
from `{"chart_type": "custom_component", "component": "<Name>"}`.

`ComplianceTrendWidget` · `ConditionMatrixWidget` · `ProcessStatusWidget` ·
`CapacityComparePerPlant` · `StageFlowWidget` · `IndividualRWSOverview` · `IndividualEPSOverview`

---

## 5. Rules of progress

**R1 — Config first.** Adding a chart should mean editing one JSON file. Reach for
component code only when the README's "When NOT to reach for it" test fails.

**R2 — Reuse before building.** Before writing a new compute module or custom
component, check [§4](#4-compute-modes-in-use). Several existing modules
(`valueBuckets`, `stageFlow`, `complianceTrend`) are already built and wired into
only one dashboard — most remaining gaps are a config edit away.

**R3 — Rule of three.** Keep a custom component specific to its asset until the
same shape is needed in a third place; only then generalise. (README §"Stay
specific until rule-of-three".)

**R4 — Unique ids.** `id` must be globally unique across the whole item tree of a
config. `order` sorts siblings only.

**R5 — Every chart gets an `info` block.** The ⓘ popover (`FormulaInfo`) carries
the api/criteria/threshold explanation. Match the humanised style established in
commits `7ff59cec` / `8d4a356f`.

**R6 — Lint in the container, not the host.** ESLint does not cover the JSON
configs — only touched JS/JSX needs it.
```bash
./dc.sh exec -T frontend npx eslint src/components/dashboard/<file>.jsx
python -m json.tool frontend/src/config/visualizations/<file>.json > /dev/null   # config syntax check
```
Frontend rules that bite most often: `curly` (braces always), `no-undefined`
(bare `return;`), `prefer-arrow-callback`, `no-console` (only `error`/`info`).
Never add `// eslint-disable-next-line` — fix the code.

**R7 — Test new compute modules.** Pure calculators go in `compute/` with a test in
`compute/__test__/`. Widgets get a test in the sibling `__test__/` dir.
```bash
cd frontend && npm run test:ci
```

**R8 — Verify in the running app.** Config typos fail soft: an unknown
`chart_type` logs `[DashboardRenderer] Unknown chart_type` and renders nothing;
an unknown `component` renders an antd `Alert`. **A blank slot is the failure
mode — check the browser console, don't assume it rendered.**

**R9 — Commit format.** `[#<issue>] <subject>` + bullet body, per `CLAUDE.md`.

**R10 — Update this file.** Tick the box and note the config file touched in the
same commit as the change.

### Known inconsistencies to watch

- `README.md` §9 documents the dot-strip chart as **`boxplot`**. The actual
  `chart_type` accepted by `DashboardRenderer` and used in every config is
  **`dot_strip`** (with `dots` as a separate type). Use `dot_strip`.
- `DashboardRenderer` accepts a deprecated `complianceResponses` prop aliased into
  `computeResponses.compliance`. Use `computeResponses` for anything new.

---

## 6. Progress

The checklist lives in **[issue #34](https://github.com/akvo/iwsims/issues/34)** —
25 items across 8 groups (A. Pump Stations · B. WWTP · C. WTP · D. EPS · E. RWS ·
F. Site profiles · G. Cross-asset · H. Non-chart), each tagged 🟢 config-only /
🟡 needs wiring / 🔴 new component, with the suggested order of work.

Tick the boxes there, not here. Per **R10**, note the config file touched in the
commit that lands each item.
