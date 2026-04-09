# Dashboard Visualization — Requirements Specification

## Decisions Log

| # | Question | Answer |
|---|----------|--------|
| 1 | Repeatable group aggregation (water quality) | **Average** across entries in a single visit |
| 2 | "Last 12 months" definition | **Fiscal year** |
| 3 | Map marker click behavior | **Navigate** to EPS detail page: `/control-center/data/{formId}/monitoring/{dataId}` |
| 4 | Missing chart types in akvo-charts | Use **rawConfig** prop (pass raw ECharts options) |
| 5 | Remove stale chart components | **Yes** — clean up unused `components/chart/`, `components/visualisation/`, `pages/dashboard/` |
| 6 | Dashboard route | `/dashboard/{formId}` (e.g., `/dashboard/1749623934933`) |

## Design Principle: Reusability

The dashboard is built for EPS forms first (registration `1749623934933` + monitoring children), but must be **reusable** for other form families (e.g., Rural Water Project `1749621221728`). This means:

- API endpoints accept `parent_form_id` as a path parameter — no hardcoded question IDs in backend logic
- Dashboard configuration (which questions map to which charts, thresholds, labels) is **config-driven**, stored as JSON or a Django model
- Frontend renders charts dynamically based on config, not hardcoded per form

---

## 1. Common Filters (All Tabs)

Applied across all dashboard tabs via query parameters.

| Filter | Type | Source | Notes |
|--------|------|--------|-------|
| Date Range (from/to) | Date picker | Configurable date question per form | EPS: `1749632545235` / `1749624452911` |
| Location | Cascading select | Administration question | EPS: `1749624452990` |
| Implementing Agency | Multi-select | Configurable option question | EPS: `1749624452993` |
| Water Committee | Single-select | Configurable option question | EPS: `1749624452105` |

**Reusability**: Filter config maps `filter_key → question_id` per form family.

---

## 2. Tab: Monitoring Overview

### 2.1 KPI Cards (Top Row)

| Card | Computation | Color |
|------|-------------|-------|
| Total EPS Registered | `COUNT(DISTINCT parent_data)` | Blue |
| Total EPS Under Construction | `COUNT(parent_data WHERE is_project_completed == 'no')` | Orange |
| Total EPS Operational | `COUNT(parent_data WHERE system_status == 'operational')` | Green |
| Total EPS with Critical Issues | `COUNT(parent_data WHERE system_status == 'issue_with_system')` | Red |

### 2.2 Map

- **Source**: Registration form geo data
- **Markers**: Colored by operational status (green=operational, red=issue)
- **Click**: Navigate to `/control-center/data/{formId}/monitoring/{dataId}`
- **Component**: `akvo-charts` `Map` with marker customization

### 2.3 EPS at a Glance — Status & Compliance (6 Donuts)

| Chart | Data Source | Type |
|-------|-----------|------|
| Operational Status | QID `1749633373968` (latest monitoring) | `Doughnut` |
| Drinking Water Compliance | Computed pass/fail (see thresholds below) | `Doughnut` |
| Water Committee | QID `1749624452105` (registration) | `Doughnut` |
| Implementing Authority | QID `1749624452993` (registration) | `Doughnut` |
| Lab Tested vs CBT Tested | QID `1749633001462` (latest monitoring) | `Doughnut` |
| Placeholder (Accessibility) | TBD | `Doughnut` |

### 2.4 Monitoring Overview Sub-tab KPIs

| Card | Computation |
|------|-------------|
| EPS Monitored (Fiscal Year) | `COUNT(DISTINCT parent_data WHERE inspection_date within fiscal year)` / total |
| Critical Issues | `COUNT(parent_data WHERE system_status == 'issue_with_system')` |
| No Water Sample | `COUNT(parent_data WHERE can_collect_water_sample == 'no')` |

### 2.5 Escalation List Table

**Inclusion criteria** (ANY true):
- `can_collect_water_sample == 'no'` (QID `1749632647507`)
- `system_status == 'issue_with_system'` (QID `1749633373968`)
- Any water quality parameter outside compliance threshold

**Columns**:
| Column | Source |
|--------|--------|
| EPS Name | Registration datapoint name |
| Village Name | Administration path |
| Last Monitoring | Latest inspection date |
| Operational Status | QID `1749633373968` |
| Water Collection Ability | QID `1749632647507` |
| Critical Quality Issue | Parameter name(s) causing escalation |

**Features**: Server-side pagination, Excel export.

### 2.6 Inspections Per Month

- **Chart**: `Bar` (akvo-charts)
- **Data**: `COUNT(monitoring submissions)` grouped by month from inspection date
- **Period**: Fiscal year range from filter

---

## 3. Tab: Water Quality

### 3.1 Sub-tab KPIs

| Card | Computation |
|------|-------------|
| EPS with Water Sample (Fiscal Year) | Percentage of EPS where `can_collect_water_sample == 'yes'` |
| Lab Tested EPS | `COUNT(DISTINCT parent WHERE water_testing_method includes 'lab_test')` |
| CBT Tested EPS | `COUNT(DISTINCT parent WHERE water_testing_method includes 'cbt_test')` |

### 3.2 Water Quality Parameter Charts

Each parameter gets a **Bar chart** with an acceptance threshold reference line (via `rawConfig` markLine).

**Microbial Parameters**:
| Parameter | QID | Threshold | Unit |
|-----------|-----|-----------|------|
| E. coli | `1749633220746` | ≤ 0 | CFU/100ml |
| Total Coliform | `1749633259392` | ≤ 0 | CFU/100ml |

**Physical Parameters**:
| Parameter | QID | Threshold | Unit |
|-----------|-----|-----------|------|
| Turbidity | `1749633220745` | ≤ 5 | NTU |
| Temperature | `1797307852531` | ≤ 30 | °C |

**Chemical Parameters**:
| Parameter | QID | Threshold | Unit |
|-----------|-----|-----------|------|
| pH | `1797307852532` | 6.5 – 8.5 | - |
| Conductivity | `1797307852533` | ≤ 1000 | µS/cm |
| Salinity | `1797307852534` | ≤ 1 | PPT |

**Aggregation**: When a monitoring visit has multiple water quality test entries (repeatable group), use the **average** value.

**Compliance rule**: An EPS is "compliant" only if ALL parameters from the latest monitoring visit meet their thresholds.

---

## 4. Tab: Construction Monitoring

### 4.1 Sub-tab KPIs

| Card | Computation |
|------|-------------|
| Total EPS Under Construction | `COUNT(parent WHERE is_project_completed == 'no')` + percentage |
| Past-Due Completion | `COUNT(parent WHERE proposed_completion_date < TODAY AND is_project_completed == 'no')` |

### 4.2 Construction Progression

- **Chart**: `Bar` — histogram of % completion distribution across EPS
- **X-axis**: Progress percentage buckets (0-10%, 11-20%, ..., 91-100%)
- **Y-axis**: Number of EPS

### 4.3 Proposed Completion Timeline

- **Chart**: `Bar` — count of EPS grouped by proposed completion month
- **Reference**: TODAY line via `rawConfig` markLine

### 4.4 Progress Calculation (Server-Side)

| Component | Question ID(s) | Formula |
|-----------|---------------|---------|
| Concrete Base Construction | `1849633499999`, `1849633498888`, `1849633497777` | 100% if ANY == 'Yes' |
| URF Tank | `1849633720001` | 100% if 'Completed', else 0% |
| EPS Tank Installation | `1849633900003` | 100% if 'Completed', else 0% |
| Balance Tank | `1849634300002` | 100% if 'Completed', else 0% |
| Storage Tank | `1849634690001` | 100% if 'Completed', else 0% |
| Standpipes | `1849634900001` | (Implemented ÷ Planned) × 100% |
| Site Security & Perimeter | `1849635500001` | 33% per item selected (max 3) |

**Overall Progress** = Average of all enabled components (only components in project scope `1749624505915`).

### 4.5 Construction Escalation List Table

**Inclusion**: Incomplete (`is_project_completed == 'no'`) AND overdue (`proposed_completion_date < TODAY`)

**Columns**:
| Column | Source |
|--------|--------|
| EPS Name | Registration datapoint name |
| Component statuses | Per-component progress |
| Overall Progress % | Calculated average |
| Expected Progress % | `(days_elapsed / total_planned_days) × 100` |
| Deadline | `proposed_completion_date` |

---

## 5. Backend API Design

### 5.1 Dashboard Configuration Model

A config model or JSON file that maps form families to dashboard behavior:

```
{
  "parent_form_id": 1749623934933,
  "tabs": ["monitoring_overview", "water_quality", "construction"],
  "filters": {
    "date": { "question_ids": [1749632545235, 1749624452911] },
    "location": { "question_id": 1749624452990 },
    "implementing_agency": { "question_id": 1749624452993 },
    "water_committee": { "question_id": 1749624452105 }
  },
  "kpis": { ... },
  "charts": { ... },
  "thresholds": { ... }
}
```

### 5.2 Endpoints

| Endpoint | Method | Purpose | Returns |
|----------|--------|---------|---------|
| `GET /visualization/dashboard-config/{parent_form_id}/` | GET | Dashboard config for a form family | Config JSON |
| `GET /visualization/dashboard-stats/{parent_form_id}/` | GET | All KPI values | `{ total_registered, under_construction, operational, critical_issues, ... }` |
| `GET /visualization/chart-data/{parent_form_id}/` | GET | Aggregated chart data | Shaped for akvo-charts components |
| `GET /visualization/compliance/{parent_form_id}/` | GET | Per-EPS compliance status | `[{ eps_id, eps_name, compliant: bool, violations: [...] }]` |
| `GET /visualization/escalation/{parent_form_id}/` | GET | Paginated escalation table | `{ count, next, results: [...] }` |
| `GET /visualization/construction-progress/{parent_form_id}/` | GET | Per-EPS construction progress | `[{ eps_id, components: {...}, overall: float }]` |

**Common query params** (all endpoints): `date_from`, `date_to`, `administration`, `implementing_agency`, `water_committee`

**Escalation-specific**: `tab=monitoring|water_quality|construction`, `page`, `page_size`

**Chart-specific**: `chart_type`, `question_id`, `group_by`

### 5.3 Performance Strategy

- **Materialized views**: Extend existing `view_data_options` pattern for compliance + KPI aggregation
- **Refresh trigger**: Django-Q task on new monitoring submission (existing pattern in `refresh_materialized_data()`)
- **Caching**: Django cache for KPI stats (60s TTL), invalidate on submission
- **Pagination**: Escalation tables use DRF pagination (existing pattern)

---

## 6. Frontend Architecture

### 6.1 Route

```
/dashboard/:formId → <DashboardPage />
```

### 6.2 Component Tree

```
DashboardPage
├── DashboardFilters          (common filter bar)
├── DashboardTabs             (Ant Design Tabs)
│   ├── MonitoringOverviewTab
│   │   ├── KPICardRow        (4 stat cards)
│   │   ├── DashboardMap      (akvo-charts Map)
│   │   ├── GlanceSection     (6 Doughnut charts in grid)
│   │   ├── SubTabKPIRow      (3 stat cards)
│   │   ├── EscalationTable   (Ant Design Table + Excel export)
│   │   └── InspectionsChart  (akvo-charts Bar)
│   ├── WaterQualityTab
│   │   ├── SubTabKPIRow
│   │   ├── MicrobialCharts   (2 Bar charts with threshold lines)
│   │   ├── PhysicalCharts    (2 Bar charts with threshold lines)
│   │   └── ChemicalCharts    (3 Bar charts with threshold lines)
│   └── ConstructionTab
│       ├── SubTabKPIRow
│       ├── ProgressionChart  (Bar histogram)
│       ├── CompletionChart   (Bar with TODAY markLine)
│       └── EscalationTable
```

### 6.3 Chart Library Usage

| Component | akvo-charts Import | Config Approach |
|-----------|-------------------|-----------------|
| Doughnut charts | `Doughnut` | Standard `config` + `data` props |
| Bar charts | `Bar` | Standard for simple bars |
| Bar + threshold line | `Bar` | `rawConfig` with ECharts `markLine` |
| Line charts | `Line` | Standard (already used) |
| Map | `Map` | Custom markers with status colors |

### 6.4 Cleanup (Stale Code Removal)

Remove these unused directories/files:
- `frontend/src/components/chart/` (internal ECharts wrappers)
- `frontend/src/components/visualisation/` (old visualization components)
- `frontend/src/pages/dashboard/` (old dashboard page)
- `frontend/src/pages/visualisation/` (old visualization page)

---

## 7. Prioritized Milestones

### Phase 1: Foundation (Backend Config + KPIs)
- [ ] Dashboard config model/JSON for EPS form family
- [ ] `dashboard-stats` endpoint with common filters
- [ ] KPI card components (frontend)
- [ ] Dashboard route + tab structure + filter bar

### Phase 2: Monitoring Overview Tab
- [ ] Map with status-colored markers + navigation
- [ ] 6 Doughnut "at a glance" charts
- [ ] Inspections per month Bar chart
- [ ] Escalation list table with pagination + export

### Phase 3: Water Quality Tab
- [ ] Water quality parameter aggregation (average for repeatable groups)
- [ ] Compliance computation endpoint
- [ ] 7 parameter Bar charts with threshold markLines
- [ ] Water quality sub-tab KPIs

### Phase 4: Construction Monitoring Tab
- [ ] Construction progress calculation endpoint
- [ ] Progress histogram + completion timeline charts
- [ ] Construction escalation table

### Phase 5: Reusability + Cleanup
- [ ] Abstract dashboard config to support Rural Water Project form
- [ ] Remove stale frontend code
- [ ] Performance optimization (materialized views, caching)

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Fiscal year definition varies by country/org | Wrong date filtering | Make fiscal year start month configurable in dashboard config |
| Construction form QIDs (`1849633*`) may not exist yet | Progress calc fails | Verify QIDs exist before Phase 4; gracefully skip missing components |
| akvo-charts `rawConfig` may override styles inconsistently | Visual glitches | Test threshold markLine rendering early in Phase 2 |
| Materialized view refresh lag on high submission volume | Stale dashboard data | Rate-limit refresh to max 1/minute; show "last updated" timestamp |
| Reusability abstraction too early | Over-engineering | Build for EPS first (hardcoded config), extract to model in Phase 5 |
