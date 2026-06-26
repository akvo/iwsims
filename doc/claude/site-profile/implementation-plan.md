# Implementation Plan — Site Profile

Build order is bottom-up so each step is testable. All component work lives under
`frontend/src/pages/manage-data/components/profile/`.

## Phase 1 — `utils.js` (pure)

`profile/utils.js` — pure JavaScript, **no React/JSX**.

1. Shared helpers: `findQuestionByName`, `resolveOption`, `optionSeverity`,
   `severityTagColor`, `getText`, `answerValue`, `formatAnswer`, `formatDate`,
   `passThreshold`, `thresholdLabel`, `imageUrlsFromValue`, `getQuestionLabel`,
   `registrationAnswer` / `registrationRawValue` (resolve a `/data/{id}` answer by question
   name), `lastInspectionDate(payload)` (max `latest[*].created`).
2. `collectSiteProfileQueries(config)` → `{ questions, history, records }`, walking
   `children[]`:
   - `line` → `history += child.question`
   - `record` + `source: "submissions"` → `records += cols[].dataIndex`
   - `record` + `source: "rows"` → `questions += rows[].{question,photo,notes}`
   - `field` → `questions += rows[].question`
   - `photo` → `questions` (or `records` when `source: "submissions"`) `+= child.question`
3. `imageUrlsFromValue` validates that entries look like image refs
   (`^(https?:|data:|/)` or an image extension) so non-URL answers don't render as images.

## Phase 2 — Context provider + shared registration cache

`profile/ProfileContext.jsx`

1. `ProfileContext`, `useProfile()`, `ProfileProvider`.
2. The provider runs **two** fetches (only when `enabled`):
   - site-profile payload — build the URL from `collectSiteProfileQueries`, `api.get`.
   - registration answers — `getDataPointDetails(parentId)` (below); read back from the
     store via `store.useState`.
3. Exposes `{ config, text, parentFormId, payload, registration, loading, error,
   recordContext }`.

`lib/store.js` + `lib/data-point-details.js` (shared with `DataDetail`)

- `store.dataPointDetails = { id, data }` cache field.
- `getDataPointDetails(id)` — returns the cached `data` if `id` matches; else reuses an
  **in-flight promise** (so the header and the Registration tab, which mount together,
  issue one `GET /data/{id}`), caches the result in the store.
- `DataDetail.fetchData` calls `getDataPointDetails` and runs `transformDetailData` on the
  result (read/populate the same cache).

## Phase 3 — The four widgets

`profile/widgets/` — each reads its slice from `recordContext`/`useProfile`.

1. **RecordTable.jsx** — resolve rows (`rows` or `submissions`) + columns; map each
   `col.render` preset to a cell renderer (`text`, `option_pills`, `threshold`,
   `threshold_label`, `value`, `question_label`, `photo`, `date`, `severity`). Pure
   value/format logic comes from `utils.js`; JSX presets live here.
2. **FieldList.jsx** — key/value list from `rows`/`questions`; option answers render as pills.
3. **HistoryChart.jsx** — akvo-charts `<Line>` with a compact `containLabel` grid.
   - Trend: `data = history[question]`; `threshold {min,max}` → green `markArea` band +
     dashed `markLine`s via the ECharts ref + `setOption`.
   - `source: "risk_score"`: score each `submissions[]` inspection (red=2/amber=1 from
     `option.color`) → bucket OK/Low/Med/High/Critical on a categorical y-axis; render the
     `RiskLegend` beneath.
4. **Photo.jsx** — image grid from `latest[question]` or `submissions`.
5. `widgets/index.js` exports the four. **RecordTable** also renders a compliance
   PASS/FAIL verdict when `compliance_rule` is set; `severity` cells render `—` when
   unanswered.

## Phase 4 — Header

`profile/ProfileHeader.jsx` — hero block: `header.photo` (registration → monitoring),
title (`payload.name`), location subtitle (`header.location` admin answer formatted, with
`header.village` prepended; falls back to `subtitle_key`), and the `header.meta[]` row.
Each meta value resolves **registration answer → monitoring `latest` → `last_inspection`
(`source`) → static `value`/`value_key`**. Styling in `style.scss`.

## Phase 5 — Page + dispatch

`profile/ProfilePage.jsx` — the entry/renderer:

1. Wrap children in `ProfileProvider`; read state with `useProfile()`.
2. Render `ProfileHeader`, then a profile-local antd `Tabs` from `config.tabs`.
3. For the active tab: `children.filter(c => c.tab === key)`, split by `position`, sort by
   `order`, render each through a small dispatch
   (`record→RecordTable`, `field→FieldList`, `line→HistoryChart`, `photo→Photo`) inside a
   **Main** `<Row>` with left/right `<Col>` (2-column at the **`lg`** breakpoint:
   `lg:14`/`lg:10`, stacked below; one side → `24`).
4. Handle `loading` (Spin) and `error` (Alert) states.

`profile/index.js` — export `ProfilePage` and the context.

## Phase 6 — Configs

`config/site-profiles/{parent_form_id}.json` ×5 — author the new schema:

- WWTP `1748903240763`, WTP `1749634736797`, Pump `1749611049520` — designed layouts.
- EPS `1749623934933`, RWP `1749621221728` — shared default 3-tab layout
  (Constructions · Water Quality · Inspection History).

Each file: `parent_form_id`, `name`, `subtitle_key`, a `header`
(`photo` / `location` / optional `village` / `meta[]`), `tabs[]`, `children[]`. Reference
real `question_name`s from the registration + monitoring forms in `backend/source/forms/`.
Designed assets also get a `risk_score` line in their Inspection tab; the default assets
(EPS/RWP) score from their available status questions.

## Phase 7 — Mount

`MonitoringDetail.jsx` — mount the page in the Site Profile tab:

```jsx
import { ProfilePage } from "./components/profile";

<TabPane tab={text.siteProfileTab} key="site-profile">
  <ProfilePage
    parentId={parentId}
    parentFormId={profileFormId}
    config={profileConfig}
    text={text}
    enabled={dataTab === "site-profile"}
  />
</TabPane>
```

Keep `getSiteProfileConfig`/`getSiteProfileKey` and the `dataTab` default logic.

## Phase 8 — i18n

`lib/ui-text.js` — add the keys used by configs/widgets: per-asset `subtitle_key`, header
meta labels (`siteProfileType`, `siteProfileCommissioned`, `siteProfileDesignCapacity`,
`siteProfilePopulation(Connected)`, `siteProfileLastInspection`, `siteProfileSupervisorCol`),
trend titles (`siteProfile*Trend`), and risk levels + descriptions
(`siteProfileRisk{Ok,Low,Med,High,Critical}` + `…Desc`).

## Phase 9 — Tests

`profile/__test__/`

- `ProfilePage.test.jsx` — render a config with a `header`; assert the location subtitle,
  a registration meta value + derived last-inspection, a `record` table, and a `field` row.
  Mock `../../../../../lib` to provide `api`, `store`, and `getDataPointDetails`; mock
  `akvo-charts` + `antd`.
- query-collector test — import `collectSiteProfileQueries` from `../utils`; assert
  `questions` / `history` / `records` collection from the schema.

## Verification

- **Lint** (frontend container):
  `./dc.sh exec -T frontend npx eslint src/pages/manage-data/components/profile src/pages/manage-data/MonitoringDetail.jsx src/pages/manage-data/DataDetail.jsx src/lib/data-point-details.js`
- **Unit**: `cd frontend && CI=true npx react-scripts test src/pages/manage-data/components/profile --watchAll=false`
- **Manual**: `./dc.sh up -d`, open
  `http://localhost:3000/control-center/data/1748903240763/monitoring/<datapoint_id>` →
  Site Profile is the default tab; header shows photo + location + meta (Commissioned /
  Capacity / Population from registration, Last Inspection + Supervisor from monitoring);
  sub-tabs render with the left/right Main layout; record tables show option pills +
  thresholds + compliance verdict; line charts plot history with bands; the Inspection tab
  shows the Risk Score Trend + legend. Switch to the Registration Data tab → no second
  `/data/{id}` request (Network). Repeat for EPS/RWP and confirm a form without a config
  shows only the standard tabs, and the dashboard still builds.
