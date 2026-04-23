# Individual Overview — Implementation Plan (EPS + RWS)

Build the Individual Overview escape-hatch tab for **both** the EPS dashboard ([`IndividualEPSOverview`](../../../frontend/src/components/dashboard/custom-components/IndividualEPSOverview.jsx) — already scaffolded) and the RWS dashboard ([`IndividualRWSOverview`](../../../frontend/src/components/dashboard/custom-components/) — to be created), composing shared primitives so future record-centric tabs cost ≪200 lines per shell.

**Branch**: `feature/196-visualization-individual-overview`
**Issue**: #196
**Companion**: [`dashboard-custom-component/`](../dashboard-custom-component/) — escape-hatch SDD
**Mockups** (internal, not committed): [`doc/claude/dashboard-visualization-individual-overview/`](../dashboard-visualization-individual-overview/)
**RWS dashboard plan**: [`dashboard-visualization-rws-plan.md`](../dashboard-visualization-rws-plan.md)

---

## Scope (this PR — both EPS and RWS individual overviews)

### EPS Individual Overview

| Section | What it shows | Source |
|---|---|---|
| Filter row | Administration cascade + EPS-list select | `store.administration` + `/form-data/<reg>?administration=<id>&sort_by=latest_activity` |
| Top: Photo card (left, col 12) | Photo from latest construction monitoring with caption | Latest `/form-data/<construction>?parent=<uuid>` → `/data/<id>` → `inspection_photo` |
| Top: EPS Characteristics (right, col 12) | Key/value table of registration answers | `/data/<eps_id>` cross-referenced with `window.forms` for labels |
| Sub-tab: Construction monitoring | Progress bar + 12-row Construction Information table + General remarks | Latest construction monitoring values |
| Sub-tab: Water quality monitoring | Last Water Monitoring Information table + sampling-point photo + status tag + conditional Lab/CBT line charts (Microbial only, 3 charts) | Latest water-quality values + paginated history |

### RWS Individual Overview

| Section | What it shows | Source |
|---|---|---|
| Filter row | Administration cascade + RWS-list select + Water Source badge + Project Type badge | `store.administration` + `/form-data/<reg>?administration=<id>` + comprehensive monitoring `water_source_type` / `type_of_project` |
| Top: Photo card (col 8) | Photo from latest comprehensive monitoring sampling-point | `extractPhotoUrl(monitoringValues, sampling_point_photo qid)` |
| Top: RWS Characteristics (col 8) | Key/value table — Division, Village, Water Committee, Implementation Date, Implementing Agency, Project Background, Name of village head, Contact, WSMP approved | Registration form values |
| Top: Stats card (col 8) | Households served / People served / Project costs (icon row) | Registration form values |
| Sub-tab: Construction monitoring | Progress bar (project-type formula) + Construction Information table (project-type-aware rows: SWP / BH / D / RH) + General remarks | Comprehensive monitoring values |
| Sub-tab: Water quality monitoring | Last Water Monitoring Information table + sampling-point photo + status tag + conditional Lab/CBT line charts (Microbial 3 + Chemical 3 + Physical 2 = 8 charts on Lab; 1 chart on CBT) | Comprehensive monitoring values + paginated history |
| Sub-tab: WSMP monitor | **Out of scope** — placeholder pane with empty state, content TBD | — |

---

## Cross-dashboard reusability analysis

Comparing both pairs of mockups:

| Surface | EPS | RWS | Verdict |
|---|---|---|---|
| Filter row | Admin + EPS select | Admin + RWS select + Water Source badge + Project Type badge | Selector primitive shared; badges RWS-only |
| Top section grid | 2-col (Photo + Characteristics) | 3-col (Photo + Characteristics + Stats card) | Photo + Characteristics primitives shared; Stats card RWS-only |
| Sub-tab list | Construction + Water Quality | Construction + Water Quality + WSMP monitor | Container shared; tab list per-dashboard |
| Progress % source | Single qid | Project-type formula (SWP/BH/D/RH) | Display primitive shared; computation per-dashboard |
| Project Scope table | 12 fixed rows; cols = Scope \| In scope? \| Implementation \| Photo | Project-type-dependent rows; cols = Scope \| Implementation \| Notes/issues \| Photo | Container shared if columns parameterised; rows + col defs per-dashboard |
| Water Quality details | 9 rows | 11 rows (adds Inspector, Major issues, Description) | Same primitive (Question/Answer table), different qid lists |
| WQ charts | Microbial only (3 charts) | Microbial + Chemical + Physical (8 charts) | Same primitive (`<HistoricalLineChart>` w/ threshold band); different param lists |

**Reusable primitives extracted from day 1** (each appears ≥4× across the two designs):

1. `findQuestion` / `findAnswer` / `formatAnswerValue` / `extractPhotoUrl` / `sortByDateAscending` (helpers, no UI)
2. `<CharacteristicsTable>` — Question/Answer table given `{ qids[], values, fallbackForms? }` — used **6×** (EPS chars, EPS WQ details, RWS chars, RWS WQ details, plus secondary tables)
3. `<PhotoCaptionCard>` — photo + caption + empty state — used **4×**
4. `<HistoricalLineChart>` — `<Line>` from akvo-charts + threshold band + ascending sort — used **3× in EPS WQ + 8× in RWS WQ = 11×**
5. `useIndividualOverviewData` — hook for admin → datapoints → reg-values + monitoring-values fetch chain (EPS=2 monitoring forms, RWS=1)
6. `useMonitoringHistory` — paginated history fetcher feeding the line charts

**Per-dashboard (rule of three NOT met → don't abstract yet)**:

- The shell components (`IndividualEPSOverview.jsx`, `IndividualRWSOverview.jsx`)
- Project Scope table cell renderers (different status semantics, different column meaning)
- All constants (qid lists, project scope rows, lab/cbt param lists, project-type formulas)
- Progress % calculation (RWS needs project-type-aware formula, EPS reads a single qid)
- Stats card (RWS-only)
- Water source / project type badges (RWS-only)

This avoids the platform-design trap the [escape-hatch SDD](../dashboard-custom-component/dashboard-custom-component-design.md) explicitly warned against, while reaping ~50% code-share between the two shells.

---

## Approach

### File layout

```
custom-components/
├── index.js                                  # registry (modified — registers both shells)
├── IndividualEPSOverview.jsx                 # EPS shell (~180 lines)
├── IndividualRWSOverview.jsx                 # RWS shell (~220 lines — extra Stats card, WSMP placeholder)
└── individual-overview/                      # pieces specific to the individual-overview pattern
    ├── shared/                               # primitives reusable across both shells
    │   ├── helpers.js                        # findQuestion, findAnswer, formatAnswerValue,
    │   │                                     #   extractPhotoUrl, sortByDateAscending
    │   ├── CharacteristicsTable.jsx          # generic Question/Answer table
    │   ├── PhotoCaptionCard.jsx              # photo + caption + empty state
    │   ├── HistoricalLineChart.jsx           # Line chart + threshold band
    │   ├── useIndividualOverviewData.js      # admin → datapoints → values fetch chain
    │   └── useMonitoringHistory.js           # paginated history per parent_uuid
    └── config/                               # per-dashboard constants (qids, scope rows, params)
        ├── eps.js                            # EPS-specific constants
        └── rws.js                            # RWS-specific constants (project-type-aware row sets,
                                              #   dual-form qid mappings)
```

The two shells stay at the `custom-components/` root because that's what the
registry index.js imports and exports. Everything else specific to the
individual-overview pattern lives under `individual-overview/`. A future
`<DataExportPanel>` or other custom component would similarly own a sibling
subfolder rather than polluting the root.

### Data flow (lifted into the hook)

```
useIndividualOverviewData({ regFormId, monitoringFormIds })
   │
   ├── store.useState(s => s.administration) → deepest selected level
   │
   ├── effect ─► fetchDataPoints(reg, adminId)         → dataPoints[]
   │
   ├── selectedDataPoint state                          (set by consumer)
   │
   ├── effect ─► fetchValues(reg, eps.id)               → regValues
   │
   └── effect (per monitoringFormId)
       ├──► fetchLatestMonitoring(formId, parent_uuid) → latestSubmissions[formId]
       └──► fetchValues(formId, latest.id)             → monitoringValues[formId]

Returned shape:
{
  loadingDataPoints, dataPoints, selectedDataPoint, setSelectedDataPoint,
  regValues, monitoringValues: { [formId]: values[] },
  refetch
}
```

EPS: `monitoringFormIds = [1749624452908, 1749632545233]`.
RWS: `monitoringFormIds = [1749621962296, 1749631041125]` — comprehensive form for most fields + quick form for the 5 fields the comprehensive form does not provide (operational status, contact persons, phone, water-committee training, photo description). The shell reads from `monitoringValues[1749621962296]` first, falling back to `monitoringValues[1749631041125]` for the marked qids.

History fetch lives in `useMonitoringHistory(formId, parentUuid)` — only invoked when a Water Quality sub-tab is active.

### Charts strategy

`/visualization/values` aggregates across all records — cannot filter to one parent UUID. Both shells use `useMonitoringHistory` to do the N+1 round-trips client-side; charts then project per-parameter without extra calls.

### Conditional Lab vs CBT

Read latest WQ submission's `water_testing_method` answer (EPS qid `1749633001462`, RWS qid `1749622849604`). Render Lab charts when `lab_test ∈ methods`, CBT charts when `cbt_test ∈ methods`.

---

## Question-ID Reference

### EPS

Pulled from [`backend/source/forms/2_1749623934933.prod.json`](../../../backend/source/forms/2_1749623934933.prod.json), [`2_1749624452908.monitoring.prod.json`](../../../backend/source/forms/2_1749624452908.monitoring.prod.json), [`2_1749632545233.monitoring.prod.json`](../../../backend/source/forms/2_1749632545233.monitoring.prod.json).

#### Registration `1749623934933`

| Design row | qid |
|---|---|
| Division / Province / Tikina | `1749624452990` |
| Village name | `1749624452991` |
| Active Water Committee | `1749624452105` |
| Implementation date | `1749632480584` |
| Implementing Agency | `1749624452993` |
| Project Background | `174962445299` |
| Number of households | `1749624452106` |
| Total population | `1749624452107` |

#### Construction `1749624452908`

| Design row | qid |
|---|---|
| Inspection date | `1749624452911` |
| Construction start date | `1749624452910` |
| Proposed completion date | `1749630516825` |
| Weather Condition | `1749630701234` |
| Concrete Base (completion / photo / caption) | `1849633499999` / `1849633500001` / `1849633600001` |
| URF Tank | `1849633720001` / `1849633800001` / `1849633900001` |
| EPS Tank | `1849633900003` / `1849634100001` / `1849634200001` |
| Balance Tank | `1849634300002` / `1849634400001` / `1849634500001` |
| Storage Tank | `1849634690001` / `1849634700001` / `1849634800001` |
| Standpipes | `1849635200001` / `1849635000001` / `1849635100001` |
| Drainage | — / `1849635300001` / `1849635400001` |
| Site Security & Perimeter | `1849635500001` / `1849635600001` / `1849635700001` |
| Project completion % | `1849635800001` |
| General remarks | `1749624532451` |
| Top photo (inspection / caption) | `1749624521442` / `1749631662652` |

#### Water quality `1749632545233`

| Design row | qid |
|---|---|
| Date of Inspection | `1749632545235` |
| Name of village headman | `1749632793266` |
| Phone contact | `1749632819551` |
| EPS Training conducted | `1749632835123` |
| Weather Condition | `1749632196724` |
| Water sample taken | `1749632647507` |
| Why water sample could not be taken | `1749632887312` |
| Method of Water Testing | `1749633001462` |
| General remarks | `1749633350893` |
| Sampling point photo / caption | `1749633073911` / `1749633110662` |
| Operational status (current status tag) | `1749633373968` |
| Lab — E-coli | `1749633220746` |
| Lab — Total Coliform | `1749633259392` |
| Lab — Faecal Coliform | `1749633295165` |
| CBT — Contamination count | `1749633325456` |

### RWS

**RWS uses two monitoring forms** — comprehensive `1749621962296` for most fields plus quick form `1749631041125` for 5 fields not present in the comprehensive form (operational status, contact persons, phone, water-committee training, photo description). The marker `🔵 QUICK-FORM` in [`dashboard-visualization-rws-plan.md`](../dashboard-visualization-rws-plan.md) flags those qids; the shell looks them up against `monitoringValues[1749631041125]`. All other RWS qids resolve against the comprehensive form.

Source forms: [`3_1749621221728.prod.json`](../../../backend/source/forms/3_1749621221728.prod.json) (registration), [`3_1749621962296.monitoring.prod.json`](../../../backend/source/forms/3_1749621962296.monitoring.prod.json) (comprehensive monitoring).

#### Registration `1749621221728`

| Design row | qid |
|---|---|
| Division / Province / Tikina | `1749621221730` |
| Village name | `1749621329696` |
| Water Committee | `1749622715678` |
| Construction Start Date | `1749622701234` |
| Implementing Agency | `1749622571775` |
| Project Background | `1749621347162` |
| Number of households | `1749622327890` |
| Total population | `1749622341234` |
| Project costs | `1749622354567` |
| WSMP submitted / approved | `1749622652941` / `1749622675800` |

#### Comprehensive monitoring `1749621962296`

| Design row | qid |
|---|---|
| Inspection date | `1749621962298` |
| Proposed completion date | `1749622695675` |
| Weather Condition | `1749622774567` |
| Water sample taken | `1749622785185` |
| Sampling point photo | `1849622785200` |
| Method of Water Testing | `1749622849604` |
| Parameters tested | `1749621050010` |
| Project type (drives scope rows + progress formula) | `1749621851234` |
| Water source (drives top-row badge) | `1749621374500` |
| Lab — E-coli | `1749622991234` |
| Lab — Total Coliform | `1749623024122` |
| Lab — Fecal Coliform | `1749623074194` |
| Lab — Turbidity | `1749623109418` |
| Lab — Temperature | `1723459200023` |
| Lab — pH | `1723459200024` |
| Lab — Conductivity | `1723459200025` |
| Lab — Salinity | `1723459200026` |
| CBT — E.coli count | `1749622982588` |
| CBT — Risk level | `1849622785201` |
| CBT — Photo | `1749623001234` |

#### Project-type-aware project scope rows

Per [RWS plan §4 D](../dashboard-visualization-rws-plan.md). Stored as a `Map<projectType, Row[]>` in `individual-overview/config/rws.js`. Each row has `{ key, label, status_qid, implementation_qid?, issues_qid, photo_qid? }`.

| Project type | Row count | Components |
|---|---|---|
| `surface_water_project` | 7 | Dam, Raw water main, Reservoir, Distribution main, Reticulation, Pumps, Piping works |
| `borehole` | 8 | Borehole, Raw water main, Reservoir, Distribution main, Reticulation, Pumps, Piping works, Tanks |
| `desalination` | 8 | Desalination unit, Raw water main, Reservoir, Distribution main, Reticulation, Pumps, Piping works, Tanks |
| `rainwater_harvesting` | 4 | Rainwater tanks, Gutters, Base construction, Piping works |

Exact qids per row from the existing `progress_construction.components[]` block in [`1749621221728.json`](../../../frontend/src/config/visualizations/1749621221728.json) (lines 21–117) plus the RWS plan §4 D Implementation/Issues/Photo qid columns.

---

## API contract recap

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /api/v1/form-data/<form_id>?administration=<id>&sort_by=latest_activity&sort_type=descend` | `{ data: [{id, name, uuid, …}], total }` | Paginated; renders into the RWS / EPS Select |
| `GET /api/v1/form-data/<monitoring_form>?parent=<uuid>` | Same shape, sorted | First page → latest monitoring; full pagination → history |
| `GET /api/v1/data/<data_id>` | `[{question, value, index, history}]` | `value` shape varies by question type — see [`backend/utils/functions.py:35`](../../../backend/utils/functions.py#L35) |

---

## Phased Task Breakdown

### Phase 1 — Shared primitives

- [ ] `individual-overview/shared/helpers.js` — pure functions: `findQuestion(qid)`, `findAnswer(values, qid)`, `formatAnswerValue(answer, question)`, `extractPhotoUrl(values, qid)`, `resolveAnswerLabel(values, qid)`, `sortByDateAscending(rows)`
- [ ] `individual-overview/shared/PhotoCaptionCard.jsx` — props: `{ photoUrl, caption, alt, height? }`. AntD `<Card cover={<Image …>}>` + caption; falls back to `<Empty>`.
- [ ] `individual-overview/shared/CharacteristicsTable.jsx` — props: `{ title?, qids[], values, formIdHint? }`. Two-column AntD `<Table>` (Question / Answer) with rows from `window.forms` labels and `formatAnswerValue` answers. Skips qids with no answer.
- [ ] `individual-overview/shared/HistoricalLineChart.jsx` — props: `{ title, data: [{label, value}], thresholdMin?, thresholdMax?, unit? }`. Renders akvo-charts `<Line>` with optional shaded threshold band (markArea).
- [ ] `individual-overview/shared/useIndividualOverviewData.js` — hook described above; exposes `{ loadingDataPoints, dataPoints, selectedDataPoint, setSelectedDataPoint, regValues, monitoringValues, refetch }`. Subscribes to `store.administration` for the deepest selected admin.
- [ ] `individual-overview/shared/useMonitoringHistory.js` — `(formId, parentUuid) → { rows: [{date, values[]}], loading, error }`. Paginated list + per-submission `/data/<id>` fetches.

### Phase 2 — Per-dashboard config modules

- [ ] `individual-overview/config/eps.js`:
  - `REGISTRATION_FORM_ID`, `CONSTRUCTION_FORM_ID`, `WATER_QUALITY_FORM_ID`
  - `REGISTRATION_CHARACTERISTICS_QIDS` (8 qids)
  - `WATER_QUALITY_DETAIL_QIDS` (9 qids)
  - `PROJECT_SCOPE_ROWS` (12 fixed rows)
  - `PROGRESS_QUESTION_ID`, `REMARKS_QUESTION_ID`
  - `CONSTRUCTION_PHOTO_QID`, `CONSTRUCTION_PHOTO_CAPTION_QID`
  - `WQ_PHOTO_QID`, `WQ_PHOTO_CAPTION_QID`, `WQ_STATUS_QID`, `WQ_TEST_METHOD_QID`, `WQ_DATE_QID`
  - `WQ_LAB_PARAMS` (3 entries), `WQ_CBT_PARAM` (1 entry)

- [ ] `individual-overview/config/rws.js`:
  - `REGISTRATION_FORM_ID = 1749621221728`, `COMPREHENSIVE_FORM_ID = 1749621962296`, `QUICK_FORM_ID = 1749631041125`
  - `QUICK_FORM_QIDS = { operationalStatus: 1749631041155, contactPersons: 1749631041128, phoneContact: 1749631041129, trainingConducted: 1749631041131, photoDescription: 1749631041153 }` — explicit set of qids that should be read from the quick form rather than the comprehensive form
  - `REGISTRATION_CHARACTERISTICS_QIDS` (10+ qids per RWS mockup)
  - `STATS_CARD_QIDS` (households, population, project_costs)
  - `WATER_SOURCE_QID`, `PROJECT_TYPE_QID`
  - `WATER_QUALITY_DETAIL_QIDS` (11 qids)
  - `PROJECT_SCOPE_ROWS_BY_TYPE` — `Map<projectType, Row[]>` for the 4 project types
  - `WSMP_APPROVED_QID`
  - `INSPECTION_DATE_QID`, `PROPOSED_COMPLETION_QID`, `WEATHER_CONDITION_QID`
  - `CONSTRUCTION_PHOTO_QID` (sampling point reused as Photo from Last Monitoring)
  - `WQ_PHOTO_QID`, `WQ_PHOTO_CAPTION_QID`, `WQ_STATUS_QID`, `WQ_TEST_METHOD_QID`, `WQ_DATE_QID`
  - `WQ_LAB_PARAMS` — 8 entries (Microbial 3 + Chemical 3 + Physical 2)
  - `WQ_CBT_PARAMS` — 1+ entries (Contamination using CBT bags)

### Phase 3 — Dashboard JSON wiring

- [ ] Modify [`1749621221728.json`](../../../frontend/src/config/visualizations/1749621221728.json):
  - Add top-level `"slug": "rws-overview"` (required by [`config validator`](../../../frontend/src/config/visualizations/index.js#L42))
  - Append a 4th tab pane to `main_tabs.items[]`:
    ```json
    {
      "id": "tab_individual_overview",
      "is_public": false,
      "label": "Individual Overview",
      "items": [
        {
          "id": "individual_overview_component",
          "chart_type": "custom_component",
          "order": 1,
          "component": "IndividualRWSOverview"
        }
      ]
    }
    ```
- [ ] Modify [`frontend/src/config/visualizations/index.js`](../../../frontend/src/config/visualizations/index.js):
  - Import RWS JSON: `import rwsOverview from "./1749621221728.json";`
  - Append to `RAW_CONFIGS`: `const RAW_CONFIGS = [epsOverview, rwsOverview];`
- [ ] Modify [`custom-components/index.js`](../../../frontend/src/components/dashboard/custom-components/index.js):
  - Add named export for `IndividualRWSOverview`

### Phase 4 — EPS shell composition

Rewrite [`IndividualEPSOverview.jsx`](../../../frontend/src/components/dashboard/custom-components/IndividualEPSOverview.jsx) as a thin orchestrator (~180 lines):

- [ ] Filter row: `<AdministrationDropdown />` + EPS `<Select>` (driven by `useIndividualOverviewData.dataPoints`)
- [ ] Top row (col 12 / col 12):
  - `<PhotoCaptionCard>` ← `extractPhotoUrl(monitoringValues[CONSTRUCTION], CONSTRUCTION_PHOTO_QID)`
  - `<CharacteristicsTable title="EPS Characteristics" qids={REGISTRATION_CHARACTERISTICS_QIDS} values={regValues} />`
- [ ] AntD `<Tabs destroyInactiveTabPane>` with two panes:
  - **Construction monitoring**: progress bar from `PROGRESS_QUESTION_ID`; Construction Information `<Table>` driven by `PROJECT_SCOPE_ROWS` (12 rows) with In-scope tag / Implementation cell / Photo thumbnail; General remarks block.
  - **Water quality monitoring**: 2-col layout — left `<CharacteristicsTable>` (9 rows); right stacked `<PhotoCaptionCard>` + status `<Tag>`. Conditional Microbial Parameters card containing 3× `<HistoricalLineChart>` (Lab) and CBT card with 1× `<HistoricalLineChart>`.

### Phase 5 — RWS shell composition

Create `IndividualRWSOverview.jsx` (~220 lines):

- [ ] Filter row: `<AdministrationDropdown />` + RWS `<Select>` + Water Source badge + Project Type badge (badges read from latest monitoring `monitoringValues[1749621962296]`)
- [ ] Top row (col 8 / col 8 / col 8):
  - `<PhotoCaptionCard>` ← `extractPhotoUrl(monitoringValues[1749621962296], CONSTRUCTION_PHOTO_QID)`
  - `<CharacteristicsTable title="RWS Characteristics" qids={REGISTRATION_CHARACTERISTICS_QIDS} values={regValues} />`
  - Stats card: 3 icon rows (Households served / People served / Project costs) sourced from `regValues`
- [ ] AntD `<Tabs destroyInactiveTabPane>` with three panes:
  - **Construction monitoring**: progress bar — for now **read raw % from a single qid if available**, else show `<Empty>` with TODO note for the project-type formula computation (defer the formula to a follow-up). Construction Information `<Table>` driven by `PROJECT_SCOPE_ROWS_BY_TYPE.get(projectType)` rows; columns Scope \| Implementation \| Notes/issues \| Photo.
  - **Water quality monitoring**: 2-col layout same as EPS but with 11-row details + Lab charts split into Microbial / Chemical / Physical sections (8 charts) and CBT card (1 chart).
  - **WSMP monitor**: placeholder pane with `<Empty description="WSMP monitor coming soon" />` (mockup content not specified yet).

### Phase 6 — Verification

- [ ] `npm run lint` clean
- [ ] `npm run prettier` clean
- [ ] `npm test -- --watchAll=false` — full suite green; **update** `useDashboardConfig` test to assert RWS dashboard now has 4 tabs and is registered (currently the test only covers EPS)
- [ ] Manual smoke (signed-in): `/dashboard/eps-overview` and `/dashboard/rws-overview` both render the Individual Overview tab without console errors
- [ ] Manual smoke (anonymous): both Individual Overview tabs disabled

### Phase 7 — Commit & push

- [ ] Sequential commits with `[#196]` prefix:
  1. `feat(dashboard): add shared primitives for individual-overview pattern`
  2. `feat(dashboard): add EPS individual-overview config + finalize EPS shell`
  3. `feat(dashboard): add RWS individual-overview config + RWS shell`
  4. `feat(dashboard): wire RWS dashboard slug + register IndividualRWSOverview`
  5. `test(dashboard): cover RWS dashboard registration + 4-tab assertion`
  6. `docs(dashboard): document individual-overview reusability strategy`
- [ ] Wait for explicit user go-ahead before push.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Premature abstraction — primitives shaped wrongly for RWS | Medium | Medium | Designed against both mockups; only extracting primitives that appear ≥4× across the two designs |
| RWS qid mapping discrepancies (RWS plan references `1749631041125` qids; user clarified comprehensive `1749621962296`) | High | Medium | Phase 2 explicitly validates each RWS qid against the comprehensive form definition; missing qids surface as `—` placeholders rather than crashes |
| `window.forms` shape varies between dev/prod | Low | Medium | `findQuestion` defensively guards every level (`forms || []`, `groups || []`) and returns `null` |
| Photo answers may be relative URLs in some envs | Medium | Low | `<Image>` accepts both; render only when `typeof value === "string"` |
| WQ history fetch is N+1 round-trips | Medium | Low | Acceptable for typical N≤20; isolated in `useMonitoringHistory` for future swap |
| RWS project-type progress formula not implemented in this PR | High | Low | Phase 5 explicitly defers to a future PR; placeholder `<Empty>` + TODO comment in the shell |
| AntD `<Progress>` expects 0–100 number; backend may return string | Medium | Low | Coerce with `Number()` and clamp `0 ≤ pct ≤ 100` |

## Out of Scope (this PR)

- **WSMP monitor sub-tab content** for RWS (mockup content not specified) — placeholder `<Empty>` rendered.
- **RWS project-type-aware progress formula** — placeholder `<Empty>` with TODO; Surface Water = sum of completed components / 7, Borehole = /8, Desalination = /8, Rainwater = /4. Defer until first dashboard with real data exercises it.
- Editing capabilities on photo / tables (read-only view).
- Linking back to the underlying datapoint detail page (parent dashboard map handles that).
- Photo lightbox / gallery (AntD `<Image>` provides default zoom).
- Localised strings (English literals matching design copy).
- URL state for selected datapoint (selection is component-local; reload resets).
- Backend endpoint to return per-EPS / per-RWS history in one call (current N+1 is OK).

## Companion documents

- [`dashboard-custom-component/dashboard-custom-component-design.md`](../dashboard-custom-component/dashboard-custom-component-design.md) — escape-hatch design both shells plug into
- [`dashboard-visualization-individual-overview/`](../dashboard-visualization-individual-overview/) — EPS + RWS design mockups (internal)
- [`dashboard-visualization-rws-plan.md`](../dashboard-visualization-rws-plan.md) — full RWS dashboard plan including §4 Individual Overview spec
- [`backend/source/forms/`](../../../backend/source/forms/) — authoritative form definitions

---

## Next step

Approved plan → execute Phase 1 (shared primitives) onwards. Stop after Phase 6 for user confirmation before commit/push (Phase 7).
