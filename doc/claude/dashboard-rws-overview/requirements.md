# RWS Dashboard Redesign — Requirements Specification v1.0

> Scope: redesign of the root-level "at-a-glance" section of the RWS Overview
> dashboard ([1749621221728.json](../../../frontend/src/config/visualizations/1749621221728.json)).
> Produced via `/sc:brainstorm` requirements-discovery. Next step: `/sc:design`.

## Decisions locked

| ID | Decision |
|---|---|
| A.1 | Accessibility uses `can_take_sample` = QID **1749622785185** on **comprehensive** monitoring form **1749621962296** |
| A.2 | Accessibility 3-bucket rule: `sample=yes ∧ issues=no` → *Easily accessible*; `sample=yes ∧ issues=yes` → *Accessible with issues*; `sample=no` → *Not accessible* |
| B | Operational Status column = two independent measures (`% operational`, `% with issues`) rendered stacked (total may exceed 100) |
| C | Beneficiaries bar = count of projects whose `project_target_group` multi-option *contains* the value (overlapping sets) |
| D / D.1 | Replace **items 4–14** (KPI row + at-a-glance section). Keep items 1–3 (hidden defs + filters), item 8 (map), item 15 (tabs) |
| E | Denominator `M` for ratio KPIs = count of registration submissions on parent form **1749621221728** |

## 1. Functional Requirements

### FR-1 — Four redesigned KPI cards (replaces items 4–7)

Single row, `col_span: 6` each. New **`ratio_percentage`** card variant rendering
"N / M (P%)" — existing `value_type: "percentage"` only outputs `%`.

| KPI | Numerator | Denominator |
|---|---|---|
| Operational Systems | `infrastructure_status=operational` on form 1749631041125 (latest, sum_by parent) | M |
| Drinking Water Compliance | M − (count of RWS with ≥1 compliance-threshold violation from the 8 WQ params) | M |
| Active Water Committees | `water_committee=yes` on form 1749621221728 (exclude `not_active`, `no`) | M |
| Accessibility Issues — "No Issues" | (RWS in *Easily accessible* bucket per A.2 rule) | M |

### FR-2 — New section: "RWS at-a-glance: Status and Compliance" (replaces items 9–14)

Keeps existing `section_title` item, followed by:

**FR-2a — "Implementation at Scale" (cross-tab stacked horizontal bar)**

- Category axis: `type_of_project` (QID 1749621851234, comprehensive monitoring
  form, latest per parent) — 4 values
- Stack series: `implementing_agencies` (QID 1749622571775, registration form) —
  8 options
- Cross-form + multi-option → requires a new `compute: "cross_tab"` (frontend
  fan-out) OR a new backend `/visualization/values` mode. Prefer frontend
  compute for additivity (NFR-1).
- `col_span: 12`, horizontal orientation

**FR-2b — "Reach and Quality" panel (`col_span: 12`)**

- Half-doughnut: Lab vs CBT — reuses existing `chart_test_method` data with a
  new `config.doughnut_style: "half"` hint passed through to akvo-charts.
- Bar chart "Beneficiaries": `project_target_group` (QID 1749622291234,
  registration form) with `group_by: "option"`. Rendered as standard
  `chart_type: "bar"`. Overlapping multi-option semantics handled by backend's
  existing multi-option group_by (confirm behavior — may need `overlap_ok: true`
  hint).

**FR-2c — "System Health & Performance Stack" (3-column grouped stacked bar, `col_span: 12`)**

Three stacked columns sharing a y-axis "RWS count (or %)":

| Column | Series | Source |
|---|---|---|
| Operational Status | Operational / Issues with the system | Two independent metrics, both on form 1749631041125: `infrastructure_status=operational` and `major_issues=yes` (sum_by parent, latest) |
| Accessibility | Easily accessible / Accessible with issues / Not accessible | Derived per A.2 — **cross-form join** between form 1749621962296 (can_take_sample) and form 1749631041125 (major_issues), both keyed on parent |
| Drinking Water Compliance | Compliant / E-coli / Total coliform / Turbidity / Residual chl… / pH / Temperature / Conductivity / Salinity | Existing `compute: "compliance"` over the 8 `param_*` histograms — reuse logic, change orientation |

Proposed JSON shape: new `chart_type: "grouped_stack_bar"` with `items[]` of 3
series-producing sub-items, each a `compute` definition. Alternative: a
container with 3 sibling `stack_bar` items at `col_span: 4` (simpler, no new
chart_type).

### FR-3 — Preserved items (no change)

- `progress_construction` (hidden), `wq_globals` (hidden), `filters_main` —
  definitions reused by tabs
- `map_main` — stays
- `main_tabs` with all 4 panes (Monitoring overview, Water quality, Construction
  monitoring, Individual Overview) — untouched

## 2. Non-Functional Requirements

- **NFR-1** — Prefer frontend composition & schema extension over new backend
  endpoints. Cross-form joins (FR-2a, FR-2c Accessibility column) implemented as
  frontend fan-out that calls existing `/visualization/values` multiple times
  and joins by `parent_id` client-side.
- **NFR-2** — Schema extensions must be **additive**:
  `value_type: "ratio_percentage"`, `config.doughnut_style`,
  `compute: "cross_tab"`, (optional) `chart_type: "grouped_stack_bar"`. Existing
  `1749623934933.json` (EPS) must continue to render unchanged.
- **NFR-3** — Public-safe: everything outside the Individual Overview tab
  remains accessible to anonymous viewers. No authenticated endpoints
  introduced.
- **NFR-4** — Filter compatibility: all new widgets re-fetch on filter-bar
  changes (date, administration, implementing_agency, water_committee) via the
  existing `useDashboardValues`/`useDashboardFilters` pipeline.
- **NFR-5** — "No data" parity: every new widget renders the existing
  `ChartRenderer` "No data" placeholder on empty responses (matches README
  §Empty-data behaviour).

## 3. User Stories & Acceptance Criteria

**US-1 — At-a-glance KPIs** *(FR-1)*

- *Given* I'm a program manager on `/dashboard/rws-overview`, *when* the page
  loads, *then* I see 4 KPI cards showing `N/M (P%)` format.
- *When* I change the Monitoring Period filter, *then* all 4 KPIs re-query and
  re-render.
- *When* `M = 0`, *then* each KPI renders "—" (no div-by-zero).

**US-2 — Implementation at Scale** *(FR-2a)*

- *Given* multiple project types exist, *then* I see 4 horizontal bars (one per
  `type_of_project` option) stacked by 8 implementing-agency segments.
- *Hover* on a segment reveals `{agency, project_type, count}`.
- *When* a filter excludes all RWS of a type, that bar disappears (or renders
  zero-length with label).

**US-3 — Reach and Quality** *(FR-2b)*

- Half-doughnut renders with the 0°–180° arc (not full circle).
- Beneficiaries bar shows 6 bars with counts that **may not sum to M**
  (multi-option overlap).

**US-4 — System Health stack** *(FR-2c)*

- Three columns share the same x-axis label position.
- Operational Status column's two segments are independent — the stacked total
  can exceed 100% (tooltip makes the independence explicit).
- Accessibility column correctly joins comprehensive + quick monitoring records
  by `parent_id`; RWS with no comprehensive monitoring submission are excluded
  (NOT silently counted as "accessible").
- Drinking Water Compliance column's "Compliant" segment uses the same formula
  as the FR-1 Compliance KPI (single source of truth).

**US-5 — Preserved surface**

- The 4 tabs (Monitoring overview, Water quality, Construction monitoring,
  Individual Overview) behave identically to pre-change.
- `is_public: false` on Individual Overview still disables the tab for
  anonymous viewers.

## 4. Out of Scope (explicit)

- Changes to the EPS dashboard (`1749623934933.json`)
- Backend form schema edits (adding new questions)
- New accessibility question on the monitoring forms — out of scope since A.2
  derives from existing fields
- Changes to the Individual Overview custom component
- New filter controls

## 5. Risks & Open Implementation Notes (for `/sc:design`)

- **R-1 (HIGH)** — Cross-form join for FR-2a (registration × comprehensive) and
  FR-2c-Accessibility (comprehensive × quick). Today no widget does this.
  Design must choose between frontend fan-out+join vs backend compute endpoint.
  Frontend-only keeps NFR-1 but scales poorly past ~1000 RWS.
- **R-2 (MED)** — `grouped_stack_bar` vs "3 siblings at `col_span: 4`". The
  sibling approach is zero-schema-change; the grouped widget gives a shared
  legend and single "No data" state. Design call.
- **R-3 (LOW)** — `overlap_ok` semantics for multi-option `group_by: "option"`
  (Beneficiaries). Verify current `/visualization/values` behavior before adding
  a new hint.
- **R-4 (LOW)** — Compliance KPI formula (FR-1) reuses the compliance compute —
  factor into a shared util so KPI and FR-2c column stay consistent.

## 6. Handoff

Ready for **`/sc:design`** to produce:

1. JSON patch for `1749621221728.json` with the 11 new items replacing items
   4–14
2. Schema extensions list: `value_type: "ratio_percentage"`,
   `config.doughnut_style`, `compute: "cross_tab"`, (optional)
   `chart_type: "grouped_stack_bar"`
3. Renderer changes in `ChartRenderer.jsx` + `widgets/KPICard.jsx` (ratio
   variant) + `useDashboard*` hooks for cross-form join
4. Test plan covering US-1 through US-5 + the 3 data-integrity ACs (empty M,
   multi-option overlap, cross-form join completeness)

## Appendix — Source references

- Dashboard config: [frontend/src/config/visualizations/1749621221728.json](../../../frontend/src/config/visualizations/1749621221728.json)
- Config schema: [frontend/src/config/visualizations/README.md](../../../frontend/src/config/visualizations/README.md)
- Registration form: [backend/source/forms/3_1749621221728.prod.json](../../../backend/source/forms/3_1749621221728.prod.json)
- Comprehensive monitoring form: [backend/source/forms/3_1749621962296.monitoring.prod.json](../../../backend/source/forms/3_1749621962296.monitoring.prod.json)
- Quick monitoring form: [backend/source/forms/3_1749631041125.monitoring.prod.json](../../../backend/source/forms/3_1749631041125.monitoring.prod.json)
