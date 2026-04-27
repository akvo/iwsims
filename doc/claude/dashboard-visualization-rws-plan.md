# Rural Water Projects Dashboard Plan

## Overview

This document defines the data structure and queries for the Akvo MIS Rural Water Systems (RWS) Monitoring Dashboard.
All references use Question IDs from the form definitions.

- **Parent (Registration) Form ID**: `1749621221728` ([`backend/source/forms/3_1749621221728.prod.json`](../../backend/source/forms/3_1749621221728.prod.json))
- **Primary Monitoring Form ID**: `1749621962296` — *Rural Water Project — Comprehensive Monitoring* ([`backend/source/forms/3_1749621962296.monitoring.prod.json`](../../backend/source/forms/3_1749621962296.monitoring.prod.json)). Single comprehensive form covering construction inspection AND water quality per visit. Source for **most** dashboard fields.
- **Quick Monitoring Form ID**: `1749631041125` — *Quick monitoring form* ([`backend/source/forms/3_1749631041125.monitoring.prod.json`](../../backend/source/forms/3_1749631041125.monitoring.prod.json)). Source for the small set of fields not present in the comprehensive form (operational status flag, contact persons, phone, training, photo caption). The dashboard reads from both forms — comprehensive first, quick form as fallback for the marked qids.
- **Scope**: RWS site monitoring — operational status, water quality, and construction progress

### Question-ID Marker Legend

Some design rows in this plan don't have an exact equivalent in the comprehensive monitoring form. Markers used inline:

- ⚠️ **after a qid** — semantic approximation in the comprehensive form (e.g., `improvement_action` ≈ "Major issues" but not identical). Confirm fit during implementation.
- 🔵 **`QUICK-FORM`** — the qid is sourced from the **quick monitoring form `1749631041125`** rather than the comprehensive form. Used for the 5 fields the comprehensive form does not provide. The dashboard fetches both monitoring forms per record and reads these qids from the quick-form payload.

| Field reasoning | |
|---|---|
| `1749631041155` (Operational Status) — 🔵 QUICK-FORM | Comprehensive form has **per-component** statuses (`sea_water_storage_status`, `dam_construction_implementation`, etc.) but no single overall operational flag. Read from quick form `1749631041125`. |
| `1749623661234` ⚠️ ("Major issues" approximation) | The comprehensive form's `improvement_action` (yes/no) — "Is there any improvement action to be taken by the implementing agency?" — is the closest semantic match for the original "Major issues" yes/no flag. Not identical, but used as primary; quick form's `1749631041156` remains available as fallback if needed. |
| `1749631041128` / `1749631041129` / `1749631041131` — 🔵 QUICK-FORM | Contact persons / phone / water-committee training fields exist only in the quick monitoring form. Read from quick form. |
| `1749631041153` (Photo description) — 🔵 QUICK-FORM | Comprehensive form has per-component photo descriptions (`dam_description`, etc.) but no single generic caption for the sampling-point photo. Read from quick form for the Inspection Details section. |

### Common Filters (Applied Across All Tabs)

| Filter | Question ID(s) |
|---|---|
| Location | `1749621221730`, `1749621329696` |
| Monitoring Period | `1749621962298` |
| Implementing Agency | `1749622571775` |
| Water Committee | `1749622715678` |

---

## 1. Monitoring Overview

### Key Metrics (Shared Top-Row KPIs, rendered on every tab)

| Metric | Query |
|---|---|
| Total RWS Registered | `COUNT(UNIQUE 1749621221731)` |
| RWS Under Construction | `COUNT(UNIQUE 1749630516826 == 'No')` |
| RWS Operational | `COUNT(UNIQUE 1749631041155 == 'Operational')` 🔵 QUICK-FORM |
| RWS with Critical Issues | `COUNT(UNIQUE 1749623661234 == 'Yes')` ⚠️ approximate (`improvement_action` ≈ "critical issues") |

> **Note:** Lab Tested and CBT Tested are **not** in the shared top row. They are in the Water Quality tab KPI row (see §2).
>
> **🔵 QUICK-FORM note**: "RWS Operational" depends on a single overall operational-status field. Sourced from quick monitoring form `1749631041125` (qid `1749631041155`) since the comprehensive form has only per-component statuses.

### Monitoring Overview Tab Metrics

| Metric | Query |
|---|---|
| RWS Monitored (Last 12 Months) | `COUNT(UNIQUE 1749621221731 WHERE 1749621962298 within last 12 months)` |
| Critical Issues | `COUNT(UNIQUE 1749621221731 WHERE 1749623661234 == 'Yes')` |
| No Water Sample | `COUNT(UNIQUE 1749621221731 WHERE 1749622785185 == 'No')` |

### RWS at a Glance — Status & Compliance

- **Operational Status**: `1749631041155` 🔵 QUICK-FORM

#### Drinking Water Compliance (all conditions must be met)

- E. coli (`1749622991234`) `<= 0`
- Turbidity (`1749623109418`) `<= 5`
- Total Coliform (`1749623024122`) `<= 0`
- Fecal Coliform (`1749623074194`) `<= 0`
- Temperature (`1723459200023`) `<= 30`
- pH (`1723459200024`) `6.5 <= value <= 8.5`
- Conductivity (`1723459200025`) `<= 1000`
- Salinity (`1723459200026`) `<= 1` ppt

#### Additional Fields

| Field | Question ID |
|---|---|
| Test Type | `1749621221731` |
| Water Committee | `1749622715678` |
| Implementing Authority | `1749622571775` |
| Project Beneficiary | `1749622291234` |
| Accessibility Issues | *(Placeholder — pending QID)* |

### Escalation List Table

#### Inclusion Criteria
Show RWS where **ANY** water quality parameter violates compliance (any of the following is true):

- E. coli (`1749622991234`) `>= 0`
- Turbidity (`1749623109418`) `>= 5`
- Total Coliform (`1749623024122`) `>= 0`
- Fecal Coliform (`1749623074194`) `>= 0`
- Temperature (`1723459200023`) `>= 30`
- pH (`1723459200024`) outside `6.5–8.5`
- Conductivity (`1723459200025`) `>= 1000`
- Salinity (`1723459200026`) `>= 1` ppt

#### Table Columns

| Column | Question ID | Notes |
|---|---|---|
| RWS Name | `1749621221731` | |
| Village Name | `1749621329696` | |
| Last Monitoring | `1749621962298` | |
| Operational Status | `1749631041155` 🔵 QUICK-FORM | |
| Water Collection Ability | `1749622785185` | |
| Critical Quality Issue | — | Display parameter(s) causing escalation |

### Inspections Per Month

- **Visualization**: Monthly count of monitoring activities; x-axis rotated to **fiscal-year order** (frontend rotates backend chronological `YYYY-MM` groups using `filters.date.fiscal_year_start_month`).
- **Query**: `COUNT(1749621221731)` grouped by month extracted from `1749621962298`, with `from_date` / `to_date` bounded to active fiscal year so backend gap-fills empty months.

---

## 2. Water Quality

### Tab KPI Row (below shared top row)

| Metric | Query |
|---|---|
| RWS with water sample taken (last 12 months) | `COUNT(UNIQUE 1749624452994 WHERE 1749632545235 within last 12 months)` |
| Lab Tested RWS | `COUNT(UNIQUE 1749624452994 WHERE 1749633001462 == 'Lab Test')` |
| CBT Tested RWS | `COUNT(UNIQUE 1749624452994 WHERE 1749633001462 == 'CBT Test')` |

### Water Quality Parameters

#### Microbial Parameters

| Parameter | Question ID | Notes |
|---|---|---|
| E. coli | `1749622991234` | |
| Total Coliform | `1749623024122` | |
| Fecal Coliform | `1749623074194` | Hidden by default; un-hide after stakeholder confirmation |

#### Physical Parameters

| Parameter | Question ID |
|---|---|
| Turbidity | `1749623109418` |
| Temperature | `1723459200023` |

#### Chemical Parameters

| Parameter | Question ID |
|---|---|
| pH | `1723459200024` |
| Conductivity | `1723459200025` |
| Salinity | `1723459200026` |

---

## 3. Construction Monitoring

### KPIs

| Metric | Query | Notes |
|---|---|---|
| Total RWS under construction (%) | `COUNT(UNIQUE 1749621221731 WHERE 1749622701234 < TODAY() AND 1749622695675 > TODAY()) ÷ COUNT(all registered) × 100` | Active construction window |
| RWS with past-due completion date | `COUNT(UNIQUE 1749621221731 WHERE 1749622695675 < TODAY() AND completion_score < 100)` | Past deadline and not complete |

### Charts (side-by-side bar pair)

1. **Percentage of projects completed**  
   Distribution of RWS across overall-progress buckets (`0–10%`, `11–20%`, …, `91–100%`).  
   Source: `/visualization/progress` histogram (no extra API call).

2. **Proposed completion date**  
   Monthly histogram of `1749622695675` with `TODAY()` reference line.  
   X-axis rotated to fiscal-year order (same mechanism as Inspections Per Month in §1).  
   **Filter**: only RWS not yet completed (`completion_score != 100`).

### Project Progress Calculation

Completion score depends on project type (`1749621851234`).  
Each component scores `1/N` when marked **Completed**, where `N` is total scorable components for that project type.  
**Piping works has no completion status and is excluded from scoring.**

#### Surface Water Project (7 components)

| Component | Question ID | Progress |
|---|---|---|
| Dam | `1723459210015` | `1/7` if Completed |
| Raw Water Main | `1723459310020` | `1/7` if Completed |
| Reservoir | `1723459310033` | `1/7` if Completed |
| Distribution Main | `1723459310036` | `1/7` if Completed |
| Reticulation | `1723459310040` | `1/7` if Completed |
| Pump | `1749622191234` | `1/7` if Completed |
| Piping Works | — | No status, excluded |

**Formula**: `SWP_completion_score = (sum of completed components) / 7 × 100`

#### Borehole (8 components)

| Component | Question ID | Progress |
|---|---|---|
| Raw Water Main | `1723459310020` | `1/8` if Completed |
| Reservoir | `1723459310033` | `1/8` if Completed |
| Distribution Main | `1723459310036` | `1/8` if Completed |
| Reticulation | `1723459310040` | `1/8` if Completed |
| Borehole | `1749622111239` | `1/8` if Completed |
| Tanks | `1749622266234` | `1/8` if Completed |
| Pump | `1749622191234` | `1/8` if Completed |
| Piping Works | — | No status, excluded |

**Formula**: `BH_completion_score = (sum of completed components) / 8 × 100`

#### Desalination (8 components)

| Component | Question ID | Progress |
|---|---|---|
| Raw Water Main | `1723459310020` | `1/8` if Completed |
| Reservoir | `1723459310033` | `1/8` if Completed |
| Distribution Main | `1723459310036` | `1/8` if Completed |
| Reticulation | `1723459310040` | `1/8` if Completed |
| Desalination Unit | `1749622163234` | `1/8` if Completed |
| Tanks | `1749622266234` | `1/8` if Completed |
| Pump | `1749622191234` | `1/8` if Completed |
| Piping Works | — | No status, excluded |

**Formula**: `D_completion_score = (sum of completed components) / 8 × 100`

#### Rainwater Harvesting (4 components)

| Component | Question ID | Progress |
|---|---|---|
| Rainwater Tanks | `1723459250020` or `1723459240022` | `1/4` if Completed |
| Gutters | `1749622229234` | `1/4` if Completed |
| Base construction | `1749622301234` | `1/4` if Completed |
| Piping works | — | No status, excluded |

**Formula**: `RH_completion_score = (sum of completed components) / 4 × 100`

### Escalation List

#### Inclusion Criteria
RWS where:

- `completion_score != 100`, and
- `1749622695675 < TODAY()`

(i.e., not yet completed and past proposed completion date)

#### Table Columns

| # | Column | Source |
|---|---|---|
| 1 | RWS Name | `1749621221731` |
| 2 | Last Monitoring | `1749621962298` |
| 3 | Progress | Calculated completion score (project-type formula) |
| 4 | Expected Progress | `(TODAY() - 1749622701234) ÷ (1749622695675 - 1749622701234) × 100` |
| 5 | Deadline | `1749622695675` |

---

## 4. Individual Overview

### A. Inspection Details

| Field | Question ID |
|---|---|
| Date of inspection | `1749621962298` |
| Inspector | `1749623704567` |
| Name of contact persons | `1749631041128` 🔵 QUICK-FORM |
| Phone contact | `1749631041129` 🔵 QUICK-FORM |
| Water committee training conducted | `1749631041131` 🔵 QUICK-FORM |
| Weather condition | `1749622774567` |
| Water sample taken | `1749622785185` |
| Method of testing | `1749622849604` |
| General remarks | `1749623648243` |
| Major issues | `1749623661234` ⚠️ |
| Description of major issues | `1749623674044` |
| Photo | `1849622785200` |
| Photo description | `1749631041153` 🔵 QUICK-FORM |

### B. Site / Project Profile

| Field | Question ID |
|---|---|
| Division / Province / Tikina | `1749621221730` |
| RWS list | `1749621221731` |
| Water source | `1749621374500` |
| Project type | `1749621851234` |
| Village | `1749621329696` |
| Water committee | `1749622715678` |
| Implementation date | `1749622701234` |
| Project background | `1749621347162` |
| Implementing agency | `1749622571775` |
| WSMP approved | `1749622675800` |
| Households served | `1749622327890` |
| Population served | `1749622341234` |
| Project costs | `1749622354567` |

### C. Graphs (Historical Trends)

Use historical data for each parameter:

| Parameter | Question ID |
|---|---|
| E. coli | `1749622991234` |
| Fecal coliform | `1749623074194` |
| Total coliform | `1749623024122` |
| Temperature | `1723459200023` |
| Turbidity | `1749623109418` |
| pH | `1723459200024` |
| Conductivity | `1723459200025` |
| Salinity | `1723459200026` |

### D. Construction Monitoring (Project-type dependent page)

- Percentage completed: `SWP_completion_score / BH_completion_score / D_completion_score / RH_completion_score`

#### Construction Information

| Field | Question ID |
|---|---|
| Inspection date | `1749621962298` |
| Construction start date | `1749622701234` |
| Proposed completion date | `1749622695675` |
| Weather conditions | `1749622774567` |

#### Surface Water Project

| Project Scope | Implementation | Notes / Issues | Photo |
|---|---|---|---|
| Dam | `1723459210015` | `1723459220018` | `1723459200011` | — |
| Raw water main | `1723459310020` | `1723459220020` | `1723459210016` | — |
| Reservoir | `1723459310033` | `1723459220024` | `1723459200020` | — |
| Distribution main | `1723459310036` | `1723459220028` | `1723459200028` | — |
| Reticulation | `1723459310040` | `1723459220030` | `1723459211032` | — |
| Pumps | `1749622191234` | `1749622206234` | `1749622197890` | — |
| Piping works | — | `1749623401234` | `1749623381234` | — |

#### Borehole

| Project Scope | Implementation | Notes / Issues | Photo |
|---|---|---|---|
| Borehole | `1749622111239` | `1749622111240` | `1749622117890` | — |
| Raw water main | `1723459310020` | `1723459220020` | `1723459210016` | — |
| Reservoir | `1723459310033` | `1723459220024` | `1723459200020` | — |
| Distribution main | `1723459310036` | `1723459220028` | `1723459200028` | — |
| Reticulation | `1723459310040` | `1723459220030` | `1723459211032` | — |
| Pumps | `1749622191234` | `1749622206234` | `1749622197890` | — |
| Piping works | — | `1749623401234` | `1749623381234` | — |
| Tanks | `1749622266234` | `1749622264234` | `1749622277890` | — |

#### Desalination

| Project Scope | Implementation | Notes / Issues | Photo |
|---|---|---|---|
| Desalination unit | `1749622163234` | `1749622063234` | `1749622077890` | — |
| Raw water main | `1723459310020` | `1723459220020` | `1723459210016` | — |
| Reservoir | `1723459310033` | `1723459220024` | `1723459200020` | — |
| Distribution main | `1723459310036` | `1723459220028` | `1723459200028` | — |
| Reticulation | `1723459310040` | `1723459220030` | `1723459211032` | — |
| Pumps | `1749622191234` | `1749622206234` | `1749622197890` | — |
| Piping works | — | `1749623401234` | `1749623381234` | — |
| Tanks | `1749622266234` | `1749622264234` | `1749622277890` | — |

#### Rainwater Harvesting

| Project Scope | Implementation | Notes / Issues | Photo |
|---|---|---|---|
| Rainwater tanks | `1723459250020` / `1723459240022` | `1723459250021` | `1723459250023` | — |
| Gutters | `1749622229234` | `1749622230234` | `1749622237890` | — |
| Base construction | `1749622301234` | `1749622303234` | `1749622317890` | — |
| Piping works | — | `1749623401234` | `1749623381234` | — |