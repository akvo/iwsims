# Individual Overview — Design

Architecture and interface specifications for the record-centric Individual Overview tabs on both the EPS and RWS dashboards.

For task-level execution checklists and qid mappings, see [implementation-plan.md](./implementation-plan.md). For the escape-hatch this design plugs into, see [`dashboard-custom-component/dashboard-custom-component-design.md`](../dashboard-custom-component/dashboard-custom-component-design.md).

---

## Overview

All other tabs on both dashboards follow an **aggregate** pattern — one `/visualization/values` API call per chart, filtered globally, counts/distributions over the whole population. The Individual Overview tabs invert that: the user picks one EPS / RWS, then every downstream widget renders details for that single record.

Two designs in hand share enough surface (Photo + Characteristics + WQ details + Lab/CBT line charts) to extract small composable primitives, but diverge enough (project-type formulas, badges, stats card, sub-tab list, project scope rows) to keep each shell as a per-dashboard composition rather than a single generic component. This design captures the seams.

---

## Goals & Non-Goals

### Goals

- Render both Individual Overview tabs (EPS + RWS) per their mockups, fully data-driven from `window.forms` + `/data/<id>` answer payloads.
- Extract six primitives into `custom-components/individual-overview/shared/` so future record-centric tabs are thin compositions.
- Keep each shell ≤ ~220 lines.
- Anonymous viewers see a disabled tab (existing escape-hatch behaviour from [TabsWidget](../../../frontend/src/components/dashboard/widgets/TabsWidget.jsx)).
- Add no new schema concepts to the JSON-driven dashboard config beyond `custom_component` + `is_public` (already shipped).

### Non-Goals

- A single generic `<IndividualOverview>` mega-component driven by per-dashboard JSON config — would re-introduce the DSL the [escape-hatch SDD](../dashboard-custom-component/dashboard-custom-component-design.md) explicitly rejected.
- Backend endpoint for per-record monitoring history — current N+1 client fetches acceptable for typical N≤20.
- RWS project-type-aware progress formula — separate concern, deferred to follow-up PR with placeholder `<Empty>`.
- RWS WSMP monitor sub-tab content — mockup not provided; placeholder only.
- Editing the rendered data, deep-linking, lightbox, localisation, URL state for selection.

---

## Architecture

### File layout

```
frontend/src/components/dashboard/custom-components/
├── index.js                                  # registry — exports both shells
├── IndividualEPSOverview.jsx                 # EPS shell (~180 lines)
├── IndividualRWSOverview.jsx                 # RWS shell (~220 lines)
└── individual-overview/                      # pieces specific to this pattern
    ├── shared/                               # primitives reusable across both shells
    │   ├── helpers.js                        # findQuestion, findAnswer, formatAnswerValue,
    │   │                                     #   extractPhotoUrl, sortByDateAscending
    │   ├── CharacteristicsTable.jsx          # Question/Answer table
    │   ├── PhotoCaptionCard.jsx              # photo + caption + empty state
    │   ├── HistoricalLineChart.jsx           # Line chart + threshold band
    │   ├── useIndividualOverviewData.js      # admin → datapoints → values fetch chain
    │   └── useMonitoringHistory.js           # paginated history per parent_uuid
    └── config/                               # per-dashboard constants
        ├── eps.js                            # EPS-specific constants
        └── rws.js                            # RWS-specific constants (project-type-aware
                                              #   row sets, dual-form qid mappings)
```

The two shell components stay at the `custom-components/` root because that's
what the registry `index.js` imports + exports for the `custom_component`
chart-type dispatcher to find. Everything else specific to the
individual-overview pattern lives under `individual-overview/`. A future
custom component (e.g. `<DataExportPanel>`) would similarly own a sibling
subfolder rather than polluting the root.

### Composition map

```
IndividualEPSOverview.jsx ──compose──┐
                                     │
IndividualRWSOverview.jsx ──compose──┤───► individual-overview/shared/
                                     │      ├── helpers.js
                                     │      ├── PhotoCaptionCard
                                     │      ├── CharacteristicsTable
                                     │      ├── HistoricalLineChart
                                     │      ├── useIndividualOverviewData
                                     │      └── useMonitoringHistory
                                     │
                                     └─── individual-overview/config/<shell>.js
                                          + per-shell JSX:
                                          ├── filter row (badges, selectors)
                                          ├── top-section grid (2-col vs 3-col)
                                          ├── tab list (2 vs 3 panes)
                                          ├── project-scope table
                                          ├── stats card (RWS only)
                                          ├── progress display (single qid vs formula)
                                          └── WSMP placeholder (RWS only)
```

---

## Primitive Interfaces

### `individual-overview/shared/helpers.js`

Pure functions, no React. Centralises all `window.forms` + `/data/<id>` lookup logic so shells stay free of form-walking code.

```js
/**
 * Find a question definition by id across every form in `window.forms`.
 * Returns null when not found (older configs, deleted questions).
 *
 * @param {number|string} questionId
 * @returns {object|null} The question with { id, label, type, option, ... }
 */
findQuestion(questionId)

/**
 * Resolve an answer entry for `questionId` from a /data/<id> response.
 * Returns null when missing.
 *
 * @param {Array} values   Array of { question, value, index, history }
 * @param {number|string} questionId
 * @returns {object|null} The matching answer entry
 */
findAnswer(values, questionId)

/**
 * Pretty-print an answer value for display in tables. Handles option /
 * multiple_option (comma-joined option labels), geo (lat/long pair), arrays
 * (comma-joined). Returns null for empty/missing values.
 *
 * @param {object} answer    The /data/<id> answer entry
 * @param {object} question  The window.forms question definition
 * @returns {string|null}
 */
formatAnswerValue(answer, question)

/**
 * Extract a photo URL from an answer. Photo answers store the absolute URL
 * directly in `value`; treats blank/non-string as absent.
 *
 * @param {Array} values
 * @param {number|string} questionId
 * @returns {string|null}
 */
extractPhotoUrl(values, questionId)

/**
 * Convenience: findAnswer + findQuestion + formatAnswerValue in one call.
 *
 * @param {Array} values
 * @param {number|string} questionId
 * @returns {string|null}
 */
resolveAnswerLabel(values, questionId)

/**
 * Sort an array of {date, value} ascending by date. Stable; null dates
 * sort first.
 *
 * @param {Array<{date: string, value: number}>} rows
 * @returns {Array<{date: string, value: number}>}
 */
sortByDateAscending(rows)
```

### `individual-overview/shared/PhotoCaptionCard.jsx`

```jsx
/**
 * Photo card with caption + AntD Image zoom. Renders <Empty> when no URL.
 *
 * @prop {string|null} photoUrl
 * @prop {string|null} caption
 * @prop {string}      [alt]      Defaults to "Photo"
 * @prop {number}      [height]   Defaults to 240
 */
<PhotoCaptionCard photoUrl={...} caption={...} />
```

### `individual-overview/shared/CharacteristicsTable.jsx`

```jsx
/**
 * Two-column AntD <Table> rendering Question (window.forms label) /
 * Answer (formatAnswerValue) for a list of question ids. Skips qids
 * with no resolvable answer rather than rendering blank rows.
 *
 * @prop {string}                  [title]    Card title; if omitted, no Card wrapper
 * @prop {Array<number|string>}    qids       Ordered list of qids to render
 * @prop {Array}                   values     /data/<id> answer payload
 * @prop {boolean}                 [bordered] Default true
 */
<CharacteristicsTable
  title="EPS Characteristics"
  qids={REGISTRATION_CHARACTERISTICS_QIDS}
  values={regValues}
/>
```

### `individual-overview/shared/HistoricalLineChart.jsx`

```jsx
/**
 * akvo-charts <Line> wrapped with optional threshold band (markArea).
 * Sorts data ascending before render.
 *
 * @prop {string}                  title
 * @prop {Array<{label, value}>}   data
 * @prop {number}                  [thresholdMin]   Lower acceptable bound
 * @prop {number}                  [thresholdMax]   Upper acceptable bound
 * @prop {string}                  [unit]           Y-axis unit label (e.g., "cfu/100mL")
 * @prop {number}                  [height]         Default 240
 */
<HistoricalLineChart
  title="Total e-coli levels"
  data={[{ label: "01-2025", value: 12 }, ...]}
  thresholdMax={0}
  unit="cfu/100mL"
/>
```

When both `thresholdMin` and `thresholdMax` are set, the band is rendered between them (e.g., pH 6.5–8.5 acceptable range). When only one is set, the band extends from min/max of data range to the threshold.

### `individual-overview/shared/useIndividualOverviewData.js`

```js
/**
 * Hook that drives the admin → datapoints → values fetch chain.
 *
 * @param {object} options
 * @param {number} options.regFormId             Registration form id
 * @param {Array<number>} options.monitoringFormIds   Monitoring form ids to fetch latest of
 *
 * @returns {{
 *   loadingDataPoints: boolean,
 *   dataPoints: Array<{id, name, uuid, ...}>,
 *   selectedDataPoint: object|null,
 *   setSelectedDataPoint: (dp: object) => void,
 *   regValues: Array,                            // /data/<id> response for selected EPS
 *   monitoringValues: { [formId]: Array },       // latest /data/<id> per monitoring form
 *   loadingValues: boolean,
 *   refetch: () => void,
 * }}
 */
useIndividualOverviewData({ regFormId, monitoringFormIds })
```

Contracts:
- Subscribes to `store.administration` (Pullstate). When the deepest selected level changes, refetches `dataPoints` and clears `selectedDataPoint`.
- When `selectedDataPoint` changes, fetches `regValues` and the latest monitoring submission for each `monitoringFormIds[i]`, then their answer payloads.
- All fetches `try/catch` with `console.error` on failure; the consuming shell sees `null` / empty arrays rather than an exception.

### `individual-overview/shared/useMonitoringHistory.js`

```js
/**
 * Fetch all monitoring submissions for a parent record and their answer
 * payloads. Charts then project per-parameter without extra calls.
 *
 * Pagination: fetches first page, then subsequent pages until exhausted
 * (typical N <= 20 for a single record). N+1 round-trips overall:
 * 1 list page (cheap) + N answer fetches.
 *
 * @param {number} formId
 * @param {string|null} parentUuid    null disables the fetch
 *
 * @returns {{
 *   rows: Array<{ id, date, values }>,    // chronological metadata + answers
 *   loading: boolean,
 *   error: Error|null,
 * }}
 */
useMonitoringHistory(formId, parentUuid)
```

The caller projects per-chart by mapping `rows` to `[{label: row.date, value: findAnswer(row.values, paramQid)?.value}]`.

---

## Component Composition

### `IndividualEPSOverview.jsx`

```jsx
const IndividualEPSOverview = () => {
  const {
    dataPoints, selectedDataPoint, setSelectedDataPoint,
    regValues, monitoringValues, loadingValues,
  } = useIndividualOverviewData({
    regFormId: REGISTRATION_FORM_ID,
    monitoringFormIds: [CONSTRUCTION_FORM_ID, WATER_QUALITY_FORM_ID],
  });

  const constructionValues = monitoringValues[CONSTRUCTION_FORM_ID] || [];
  const wqValues = monitoringValues[WATER_QUALITY_FORM_ID] || [];

  const wqHistory = useMonitoringHistory(
    WATER_QUALITY_FORM_ID,
    selectedDataPoint?.uuid
  );

  return (
    <div className="individual-overview">
      <FilterRow ... />
      <Row gutter={16}>
        <Col span={12}><PhotoCaptionCard ... /></Col>
        <Col span={12}><CharacteristicsTable ... /></Col>
      </Row>
      <Tabs destroyInactiveTabPane>
        <ConstructionMonitoringPane values={constructionValues} />
        <WaterQualityPane values={wqValues} history={wqHistory.rows} />
      </Tabs>
    </div>
  );
};
```

### `IndividualRWSOverview.jsx`

```jsx
const IndividualRWSOverview = () => {
  const {
    dataPoints, selectedDataPoint, setSelectedDataPoint,
    regValues, monitoringValues,
  } = useIndividualOverviewData({
    regFormId: REGISTRATION_FORM_ID,
    // Comprehensive form for most fields + quick form for the 5 fields the
    // comprehensive form does not provide (operational status, contact persons,
    // phone, water-committee training, photo description).
    monitoringFormIds: [COMPREHENSIVE_FORM_ID, QUICK_FORM_ID],
  });

  const compValues = monitoringValues[COMPREHENSIVE_FORM_ID] || [];
  const quickValues = monitoringValues[QUICK_FORM_ID] || [];
  const projectType = resolveAnswerLabel(compValues, PROJECT_TYPE_QID);
  const waterSource = resolveAnswerLabel(compValues, WATER_SOURCE_QID);
  const scopeRows = PROJECT_SCOPE_ROWS_BY_TYPE.get(projectType) || [];

  // Per-field source helper — qids in QUICK_FORM_QIDS resolve against quick
  // form, all others against the comprehensive form.
  const valuesFor = (qid) =>
    Object.values(QUICK_FORM_QIDS).includes(qid) ? quickValues : compValues;

  const wqHistory = useMonitoringHistory(COMPREHENSIVE_FORM_ID, selectedDataPoint?.uuid);

  return (
    <div className="individual-overview">
      <FilterRow extraBadges={{ waterSource, projectType }} ... />
      <Row gutter={16}>
        <Col span={8}><PhotoCaptionCard ... /></Col>
        <Col span={8}><CharacteristicsTable ... /></Col>
        <Col span={8}><StatsCard regValues={regValues} qids={STATS_CARD_QIDS} /></Col>
      </Row>
      <Tabs destroyInactiveTabPane>
        <ConstructionMonitoringPane
          comprehensiveValues={compValues}
          quickValues={quickValues}
          scopeRows={scopeRows}
        />
        <WaterQualityPane
          comprehensiveValues={compValues}
          quickValues={quickValues}
          history={wqHistory.rows}
        />
        <Tabs.TabPane key="wsmp" tab="WSMP monitor">
          <Empty description="WSMP monitor coming soon" />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};
```

`<FilterRow>`, `<ConstructionMonitoringPane>`, `<WaterQualityPane>`, `<StatsCard>` are inline JSX in each shell — not extracted to `individual-overview/shared/` because their internals diverge between EPS and RWS (different qid sets, different column meanings, different chart groupings). Promoting to shared primitives would require parameterising too many shapes; the rule-of-three test doesn't pass yet.

---

## Sequence Diagrams

### Selection flow

```
User picks Location
   ↓
AdministrationDropdown updates store.administration
   ↓
useIndividualOverviewData effect fires
   ↓
fetchDataPoints(REG_FORM_ID, deepestAdminId)
   ↓
dataPoints[] populated; selectedDataPoint cleared
   ↓
EPS / RWS Select shows new options

User picks an EPS / RWS
   ↓
setSelectedDataPoint(dp)
   ↓
useIndividualOverviewData effect (selectedDataPoint dep)
   ├──► fetchValues(REG, dp.id) → regValues
   ├──► fetchLatestMonitoring(monitoringForm[0], dp.uuid) → latestSubmission
   │       └──► fetchValues(monitoringForm[0], latest.id) → monitoringValues[0]
   └──► fetchLatestMonitoring(monitoringForm[1], dp.uuid)   (EPS only)
           └──► fetchValues(monitoringForm[1], latest.id)
   ↓
All shell sections re-render with values

User clicks Water Quality sub-tab
   ↓
useMonitoringHistory(WQ_FORM, dp.uuid) starts
   ├──► fetchPage(1) → list
   └──► fetchValues(each.id) in parallel
   ↓
history.rows[] populated; charts re-render with time-series data
```

### Tab gating (anonymous viewer — already implemented)

```
Anonymous viewer loads /dashboard/eps-overview
   ↓
TabsWidget reads store.useState(s => s.isLoggedIn) = false
   ↓
For tab_individual_overview (is_public: false):
  → tabItem.disabled = true
   ↓
defaultActiveKey resolves to first non-disabled pane
   ↓
destroyInactiveTabPane = true → IndividualEPSOverview never mounts
   ↓
Anonymous user cannot trigger any of this hook chain
```

---

## Edge Cases & Behaviour

| Condition | Behaviour |
|---|---|
| User on the tab without picking Location | `dataPoints = []`, EPS/RWS select shows empty + disabled. Top + sub-tab sections hidden by `selectedDataPoint == null` guard, replaced with `<Empty description="Select an EPS to view details" />`. |
| User picks Location with no EPS records | `dataPoints = []`, select shows empty state ("No data"). |
| User picks EPS with no monitoring submissions | `monitoringValues[formId] = []`. Construction sub-tab shows progress 0% + empty rows. WQ sub-tab details table has no rows; charts show "No data" placeholder. |
| Photo qid resolves to no answer | `<PhotoCaptionCard>` falls back to `<Empty image="/static/no-photo.svg" />`. |
| `window.forms` doesn't include a question id from the config | `findQuestion` returns `null`, `<CharacteristicsTable>` skips that row, console.warn once. |
| Backend returns 401 (anonymous viewer somehow bypassed gating) | `try/catch` in fetch helpers; `console.error` then state stays at `null`/`[]`. UI shows empty states. |
| User changes EPS while history fetch in progress | Hook discards stale results via mounted-flag pattern. |
| Test method qid returns `["lab_test", "cbt_test"]` (both) | Both Lab and CBT chart cards render. |
| Test method qid returns no answer | Neither chart card renders; user sees only the details table + photo. |

---

## Test Specification

### Unit tests (Jest + RTL)

| File | Cases |
|---|---|
| `individual-overview/shared/__test__/helpers.test.js` | `findQuestion` (found / not found / missing forms), `findAnswer` (found / not found), `formatAnswerValue` (option / multiple_option / number / date / geo / array / null), `extractPhotoUrl` (string / null / non-string), `sortByDateAscending` (chronological / null dates) |
| `individual-overview/shared/__test__/CharacteristicsTable.test.js` | Renders rows with labels from `window.forms`; skips qids with no answer; respects `title` Card wrapper |
| `individual-overview/shared/__test__/PhotoCaptionCard.test.js` | Renders `<Image>` when URL present; renders `<Empty>` when null; caption appears |
| `individual-overview/shared/__test__/HistoricalLineChart.test.js` | Sorts data ascending; renders threshold band when min/max provided |

Hooks (`useIndividualOverviewData`, `useMonitoringHistory`) tested via integration in shell test below.

### Shell smoke tests

| File | Cases |
|---|---|
| `custom-components/__test__/IndividualEPSOverview.test.jsx` | Renders empty state when no dp selected; renders Photo + Characteristics + tabs when dp selected (mocked api) |
| `custom-components/__test__/IndividualRWSOverview.test.jsx` | Same plus Stats card + WSMP placeholder + project-type-aware row selection |

### Existing test updates

| File | Update |
|---|---|
| `util/__test__/useDashboardConfig.test.js` | Already updated to assert EPS has 4 tabs + `tab_individual_overview` is `is_public: false`. **Add** RWS dashboard registration (4 tabs, including a public `tab_individual_overview`-equivalent). |

### Manual smoke

1. `./dc.sh up -d` → `/dashboard/eps-overview` → Individual Overview tab → pick a location + EPS → both sub-tabs render
2. Same for `/dashboard/rws-overview` → also exercise the project type badge update + project scope row selection
3. Log out → both Individual Overview tabs greyed out / unclickable
4. Pick Lab-test EPS → 3 microbial line charts render; pick CBT-test → 1 chart
5. Pick Lab-test RWS → 8 charts (Microbial + Chemical + Physical) render
6. WSMP monitor sub-tab on RWS → "coming soon" placeholder

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Premature primitive abstraction wrong-shaped for RWS | Medium | Medium | Designed against both mockups; only ≥4× primitives extracted |
| RWS qid mapping discrepancies (RWS plan §4 references `1749631041125`; user clarified `1749621962296` canonical) | High | Medium | Phase 2 validates each RWS qid; missing qids → `—` rather than crash |
| `window.forms` shape variance dev/prod | Low | Medium | `findQuestion` defensively guards every level |
| Photo answer URL format variance | Medium | Low | `<Image>` accepts both relative and absolute |
| WQ history N+1 round-trips | Medium | Low | Acceptable for N≤20; isolated in `useMonitoringHistory` for future swap |
| RWS project-type formula deferred — placeholder confuses reviewers | High | Low | Phase 5 explicit; risk register mentions it; TODO comment in shell |
| AntD `<Progress>` expects 0–100 number | Medium | Low | Coerce + clamp |
| `useMonitoringHistory` race on rapid EPS switching | Medium | Low | Mounted-flag pattern in hook |

---

## Out of Scope

Repeated from [README](./README.md) for design-doc completeness:

- RWS project-type-aware progress formula (SWP/BH/D/RH)
- RWS WSMP monitor sub-tab content
- Editing capabilities, deep-linking, lightbox, localisation, URL state
- Backend endpoint to return per-record monitoring history in one call

---

## Companion documents

- [README.md](./README.md) — SDD index + locked decisions
- [implementation-plan.md](./implementation-plan.md) — sequenced tasks + qid reference tables
- [`../dashboard-custom-component/dashboard-custom-component-design.md`](../dashboard-custom-component/dashboard-custom-component-design.md) — escape-hatch SDD
- [`../dashboard-visualization-rws-plan.md`](../dashboard-visualization-rws-plan.md) — full RWS dashboard plan including §4

---

## Next Step

Approved design → execute [implementation-plan.md](./implementation-plan.md) Phase 1 onwards. Stop after Phase 6 for user confirmation before commit/push (Phase 7).
