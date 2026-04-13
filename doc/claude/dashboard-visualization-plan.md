# Dashboard Visualization Plan

## Overview

This document defines the data structure and queries for the Akvo MIS Water System Monitoring Dashboard. All references use Question IDs from the form definitions.

### Common Filters (Applied Across All Tabs)

| Filter | Question ID |
|--------|------------|
| Location | 1749624452990 |
| Monitoring Period | 1749632545235 / 1749624452911 |
| Implementing Agency | 1749624452993 |
| Water Committee | 1749624452105 |

---

## 1. Monitoring Overview

### Key Metrics

| Metric | Query |
|--------|-------|
| Total EPS Registered | COUNT(UNIQUE 1749624452994) |
| EPS Under Construction | COUNT(UNIQUE 1749630516826 == 'No') |
| EPS Operational | COUNT(UNIQUE 1749633373968 == 'Operational') |
| EPS with Critical Issues | COUNT(UNIQUE 1749633373968 == 'Issue with the system') |
| Lab Tested | COUNT(UNIQUE 1749624452994 WHERE 1749633001462 == 'Lab Test') |
| CBT Bag Tested | COUNT(UNIQUE 1749624452994 WHERE 1749633001462 == 'CBT Test') |

### Monitoring Overview Tab

| Metric | Query |
|--------|-------|
| EPS Monitored (Last 12 Months) | COUNT(UNIQUE 1749624452994 WHERE 1749632545235 within last 12 months) |
| Critical Issues | COUNT(UNIQUE 1749633373968 == 'Issue with the system') |
| No Water Sample | COUNT(UNIQUE 1749624452994 WHERE 1749632647507 == 'No') |

### EPS at a Glance - Status & Compliance

**Operational Status**: 1749633373968

**Drinking Water Compliance** (All conditions must be met):
- E. coli (1749633220746) ≤ 0
- Turbidity (1749633220745) ≤ 5
- Coliform (1749633259392) ≤ 0
- (Parameter 1749633295165) ≤ 0
- Temperature (1797307852531) ≤ 30
- pH (1797307852532): 6.5 ≤ value ≤ 8.5
- Conductivity (1797307852533) ≤ 1000
- Salinity (1797307852534) ≤ 1 ppt

**Additional Fields**:
- Test Type: 1749633001462
- Water Committee: 1749624452105
- Implementing Authority: 1749624452993

### Escalation List Table

**Inclusion Criteria**: Show EPS where ANY of the following are true:
- No water sample collected: 1749632647507 == 'No'
- Operational issue: 1749633373968 == 'Issue with the system'
- Water quality violations (see compliance rules above)

**Table Columns**:
| Column | Question ID | Notes |
|--------|------------|-------|
| EPS Name | 1749624452994 | |
| Village Name | 1749624452990 | |
| Last Monitoring | 1749632545235 / 1749624452911 | |
| Operational Status | 1749633373968 | |
| Water Collection Ability | 1749632647507 | |
| Critical Quality Issue | — | Display parameter causing escalation |

### Inspections Per Month

**Visualization**: Monthly count of monitoring activities

**Query**: COUNT(1749624452994) grouped by month extracted from 1749632545235

---

## 2. Water Quality

### Key Metrics (Same as Monitoring Overview)

| Metric | Query |
|--------|-------|
| Total EPS Registered | COUNT(UNIQUE 1749624452994) |
| EPS Operational | COUNT(UNIQUE 1749633373968 == 'Operational') |
| EPS Monitored (Last 12 Months) | COUNT(UNIQUE 1749624452994 WHERE 1749632545235 within last 12 months) |
| Lab Tested | COUNT(UNIQUE 1749624452994 WHERE 1749633001462 == 'Lab Test') |
| CBT Bag Tested | COUNT(UNIQUE 1749624452994 WHERE 1749633001462 == 'CBT Test') |

### Water Quality Parameters

**Microbial Parameters**:
- E. coli: 1749633220746
- Coliform: 1749633259392

**Physical Parameters**:
- Turbidity: 1749633220745
- Temperature: 1797307852531

**Chemical Parameters**:
- pH: 1797307852532
- Conductivity: 1797307852533
- Salinity: 1797307852534

---

## 3. Construction Monitoring

### KPIs

| Metric | Query | Notes |
|--------|-------|-------|
| Total EPS under construction (%) | COUNT(1749630516826 == 'No') ÷ COUNT(all registered) × 100 | Share of registered EPS still under construction |
| EPS with a past-due completion date (%) | COUNT(1749630516826 == 'No' AND 1749630516825 < TODAY()) ÷ COUNT(1749630516826 == 'No') × 100 | Denominator is the under-construction cohort, **not** total registered |

Both tiles render as percentages per the design. For raw counts add companion tiles or drop `value_type=percentage`.

### Charts (side-by-side bar pair)

**Percentage of projects completed** — distribution of EPS across overall-progress buckets (0-10%, 11-20%, …, 91-100%). Sourced from `/visualization/progress` histogram; no extra API call.

**Proposed completion date** — monthly histogram of `1749630516825` with TODAY() reference line.
- **Filter**: Only EPS not yet completed (`1749630516826 == 'No'`).

### Project Progress Calculation

**Progress by Component**:

| Component | Question ID | Progress Formula |
|-----------|------------|------------------|
| Concrete Base Construction | 1849633499999, 1849633498888, 1849633497777 | 100% if ANY == 'YES' |
| URF Tank | 1849633720001 | 100% if 'Completed', else 0% |
| EPS Tank Installation | 1849633900003 | 100% if 'Completed', else 0% |
| Balance Tank | 1849634300002 | 100% if 'Completed', else 0% |
| Storage Tank | 1849634690001 | 100% if 'Completed', else 0% |
| Standpipes | implemented `1849635200001`, planned `1849634950001` | (Implemented ÷ Planned) × 100% — clamped to 100 |
| Drainage | — | *Pending definition — column rendered as placeholder until QID resolved* |
| Site Security & Perimeter | 1849635500001 | 33% per item selected; 100% if all 3 selected |

**Overall Progress**: Average of all enabled components (simple mean across components the EPS has in scope). The earlier mention of `1749624505915` as a denominator is dropped — scope selection is handled by "enabled components" rather than arithmetic weighting.

**Expected Progress**: (Days elapsed ÷ Total planned days) × 100%
- Days elapsed = TODAY() - project start date (`1749624452910`)
- Total planned days = `1749630516825` - `1749624452910`

### Escalation List

**Inclusion Criteria (per design)**: *"EPS where the percentage of project completion is not in line with the expected project progress"* — i.e. `overall_progress < expected_progress`.

This is a **frontend post-filter** applied to `/visualization/progress` results, because the `/escalation` endpoint cannot compare two computed values. The server-side call still uses `/progress` (with `filter_option_value=no` to scope to active construction); the client drops rows where `overall >= expected` before rendering.

**Table Columns** (explicit mapping for the frontend to build `/progress.details` + parent-name lookup):

| # | Column | Source |
|---|--------|--------|
| 1 | EPS Name | `1749624452994` (parent datapoint name) |
| 2 | Last Monitoring | `1749624452911` |
| 3 | Concrete base construction | Component score (see formula above) |
| 4 | URF tank implementation | Component score |
| 5 | EPS tank implementation | Component score |
| 6 | Balance tank implementation | Component score |
| 7 | Storage tank implementation | Component score |
| 8 | Standpipes | Component score |
| 9 | Drainage | *Placeholder — pending QID* |
| 10 | Site security and perimeter | Component score |
| 11 | Progress | Overall progress (average of enabled components) |
| 12 | Expected progress | (Days elapsed ÷ Total planned days) × 100% |
| 13 | Deadline | `1749630516825` |
