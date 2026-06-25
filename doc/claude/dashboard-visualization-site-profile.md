# Feature Design Document

> Completed from `FEATURE_DESIGN_TEMPLATE.md`. Read this for context during implementation.

---

## Feature: Config-Driven Site Profile (replaces `click_url_template`)

**Task ID**: SP-001
**Author**: Iwan Firmawan
**Date**: 2026-06-24
**Status**: Draft

---

## 1. Context & Problem Statement

```
Currently:
- Clicking a site in a dashboard widget (map marker via DashboardMap/MapPopupCard,
  ranking row via RankingWidget) deep-links OUT to the control-center monitoring
  record using a per-config `click_url_template`:
      "/control-center/data/{parent_form_id}/monitoring/{data_id}"
  Placeholders are filled per row (constants.js → DETAIL_URL_TEMPLATE; configs may
  override).
- That destination route (MonitoringDetail.jsx) shows three generic tabs:
  Registration Data, Monitoring Data, Monitoring Overview. There is no synthesized,
  at-a-glance "profile" of the site.
- The prototype index.html (National Overview mockup) shows the desired end state:
  clicking a WWTP/WTP site opens a rich "Site Profile" view (name/header,
  Infrastructure Assessment, Treatment Processes, Staff & OHS, Maintenance Programs,
  Latest Effluent Test, BOD/COD/TDS trends, Operational Risks, Inspection History,
  Risk Score Trend). Layout differs per asset type. In the prototype this is stubbed
  ("site profile not yet wired — coming in next iteration").
- `click_url_template` is configurable but every real config points at the same
  MonitoringDetail route — the configurability buys nothing and adds surface area.

Goal:
- Replace `click_url_template` entirely with an in-app, JSON-config-driven Site
  Profile rendered as the FIRST (default) tab of MonitoringDetail.jsx.
- Drive the profile layout from src/config/site-profiles/{parent_form_id}.json,
  selected automatically by the datapoint's registration form id (source_form_id) —
  no per-widget config, no component code change to add/adjust a profile.
- Reuse the existing config-driven widget vocabulary (DashboardRenderer / ChartRenderer
  / chart_type catalogue) and existing data APIs, scoped to a SINGLE datapoint,
  following the record-centric "Individual Overview" precedent.
```

---

## 2. Requirements

### User Acceptance Criteria
- [ ] Clicking a site (map popup link or ranking row) navigates to the in-app
      MonitoringDetail page and lands on a new **Site Profile** tab by default.
- [ ] The Site Profile is reachable at the existing control-center datapoint URL
      `/control-center/data/{form_id}/monitoring/{data_id}` — e.g. a WWTP site at
      `http://localhost:3000/control-center/data/1748903240763/monitoring/500` — where
      `{form_id}` is the registration form id and `{data_id}` is the datapoint id. No
      new route is added; the Site Profile is the default tab of this page.
- [ ] The Site Profile tab shows a synthesized view of that one site, organized as
      **asset-specific sub-tabs** (e.g. WWTP → Infrastructure Assessment, Effluent
      Quality, Operational Risks, Inspection History), defined by config.
- [ ] Each of the five asset types has its own bespoke config file (see §3, "Profile
      layouts by asset type"). WWTP, WTP, and Pump have designed layouts; EPS and RWP
      use the **default layout** (Constructions, Water Quality, Inspection History)
      copied into their own files until bespoke designs exist. No shared `default.json`.
- [ ] When a datapoint's form maps to no site-profile config key, the
      page behaves as today (Registration / Monitoring / Overview tabs only; no
      broken/empty tab).
- [ ] Existing Registration Data, Monitoring Data, and Monitoring Overview tabs remain
      available and unchanged.

### Technical Acceptance Criteria
- [ ] `click_url_template` is removed from the schema, the rendering code, and all
      bundled visualization configs; click-through builds a single canonical route in
      code.
- [ ] A new `src/config/site-profiles/{parent_form_id}.json` registry mirrors the
      `src/config/visualizations/` pattern (drop-a-file + register in `index.js`,
      invalid/duplicate entries warned and skipped, app still boots).
- [ ] Profile widgets fetch per-site data from existing endpoints scoped by datapoint
      id/uuid — no new backend endpoint.
- [ ] No regression to the dashboard map/ranking widgets other than the click target.
- [ ] Profile tab mounts lazily (no fetches until the tab is the active datapoint /
      tab), consistent with `destroyInactiveTabPane` usage elsewhere.

---

## 3. Data Model Changes

**No new DB tables or Django models.** The required materialized views already exist
(`v1_visualization` migration `0002`). The backend change is one thin read view over
those MVs (§4, D-4); the data "model" otherwise is the new frontend JSON config schema.

### New config schema — `src/config/site-profiles/{parent_form_id}.json`

The profile uses a **record-native widget vocabulary** — chart_types that are
inherently single-datapoint — rather than reusing the aggregate dashboard widgets with
a scope flag (see D-8 for why). The asset-specific sections are a single top-level
`tabs` item, one pane per section. Widgets reference questions by **`question.name`**
(the stable, human-readable variable name), NOT numeric `question.id` (see D-9). No
`api` blocks, no `scope` flag.

```jsonc
{
  "parent_form_id": 1748903240763,        // registration form id == file name; binding key
  "name_key": "siteProfileWwtpName",
  "description_key": "siteProfileWwtpDescription",
  "header": {
    "photo": "plant_photo",
    "subtitle": "division",
    "status": { "label_key": "siteProfileDerivedStatus" },
    "meta": [
      { "label_key": "siteProfileType", "value_key": "siteProfileAssetTypeWwtp" },
      { "label_key": "siteProfileCommissioned", "question": "commissioned_year" },
      { "label_key": "siteProfileDesignCapacity", "question": "design_capacity_m3_day" },
      { "label_key": "siteProfilePopulationConnected", "question": "total_population_connected_to_this_plant" },
      { "label_key": "siteProfileSupervisor", "question": "plant_supervisor_name" }
    ]
  },
  "items": [
    {
      "id": "wwtp_profile_tabs",
      "chart_type": "tabs",
      "order": 1,
      "items": [
        { "id": "tab_infrastructure", "label_key": "siteProfileInfrastructureAssessment", "items": [
          // Component · Condition pill · Photo · Notes — pills + colors come from the
          // form option definitions (option.color), NOT the config (see D-11).
          { "id": "infra", "chart_type": "assessment", "order": 1, "col_span": 12,
            "rows": [
              { "question": "ground_conditions", "photo": "photo_of_ground_conditions" },
              { "question": "building_conditions", "photo": "photo_of_building_conditions" },
              { "question": "condition_of_fence_for_security_purpose", "photo": "photo_for_security_purpose" },
              { "question": "security_lights" },
              { "question": "transport_availability" }
            ] },
          // colored tags from a multiple_option answer
          { "id": "processes", "chart_type": "tags", "order": 2, "col_span": 12,
            "label_key": "siteProfileTreatmentProcessesInUse", "question": "treatment_processes" },
          { "id": "staff", "chart_type": "field_list", "order": 3, "col_span": 12,
            "label_key": "siteProfileStaffOhs",
            "rows": [
              { "label_key": "siteProfileNumberOfStaff", "question": "num_staff_at_plant" },
              { "label_key": "siteProfileSupervisor", "question": "plant_supervisor_name" },
              { "label_key": "siteProfileOhsPolicy", "question": "has_ohs_policy" },
              { "label_key": "siteProfileOhsEquipmentCondition", "question": "ohs_equipment_available" },
              { "label_key": "siteProfileWorkingTools", "question": "working_tools" }
            ] },
          { "id": "maintenance", "chart_type": "field_list", "order": 4, "col_span": 12,
            "label_key": "siteProfileMaintenancePrograms",
            "rows": [
              { "label_key": "siteProfileUrgentMaintenance", "question": "urgent_maintenance_programs" },
              { "label_key": "siteProfilePlannedPreventative", "question": "planned_preventative_maintenance" },
              { "label_key": "siteProfileUpgradingProgram", "question": "upgrading_program" }
            ] }
        ]},
        { "id": "tab_effluent", "label_key": "siteProfileEffluentQuality", "items": [
          // Parameter · Result · Threshold · Status — thresholds are config-driven
          // (external DWS standards, not in the form rules; see D-11).
          { "id": "effluent_test", "chart_type": "compliance", "order": 1, "col_span": 24,
            "label_key": "siteProfileLatestEffluentTest",
            "compliance_rule": ["bod", "chemical_oxygen_demand", "total_dissolved_solids"],
            "rows": [
              { "question": "bod", "unit": "mg/L", "threshold": { "max": 40 } },
              { "question": "chemical_oxygen_demand", "unit": "mg/L", "threshold": { "max": 100 } },
              { "question": "ph", "threshold": { "min": 7.6, "max": 9.0 } }
            ] },
          { "id": "bod_trend", "chart_type": "trend", "order": 2, "col_span": 12,
            "question": "bod", "unit": "mg/L" },
          { "id": "cod_trend", "chart_type": "trend", "order": 3, "col_span": 12,
            "question": "chemical_oxygen_demand", "unit": "mg/L" }
        ]},
        { "id": "tab_risks", "label_key": "siteProfileOperationalRisks", "items": [
          { "id": "risks", "chart_type": "risks", "order": 1,
            "rows": [
              { "question": "working_tools", "action_key": "siteProfileActionProcureMissingTools", "recurring": false },
              { "question": "ohs_equipment_available", "action_key": "siteProfileActionProcureOhsItems", "recurring": false },
              { "question": "urgent_maintenance_programs", "action_key": "siteProfileActionScheduleCorrectiveMaintenance", "recurring": false },
              { "question": "any_work_related_constraints", "action_question": "work_related_constraints_details", "recurring": false }
            ] }
        ]},
        { "id": "tab_inspection", "label_key": "siteProfileInspectionHistory", "items": [
          // per-submission rows — needs the endpoint's submissions[] block (D-11)
          { "id": "history", "chart_type": "record_table", "order": 1,
            "label_key": "siteProfileInspectionHistory",
            "columns": [
              { "title_key": "siteProfileDateCol", "source": "date" },
              { "title_key": "siteProfileInspectorCol", "question": "dws_staff_name" },
              { "title_key": "siteProfileStatusCol", "question": "has_final_recommendation", "render": "status" },
              { "title_key": "siteProfileIssuesRaisedCol", "question": "final_recommendations" },
              { "title_key": "siteProfileResolvedCol", "question": "has_final_recommendation", "render": "resolved" }
            ] }
        ]}
      ]
    }
  ]
}
```

#### Record-native `chart_type` vocabulary

Every question reference is a `question.name` string (single `question`, or
`questions[]` for a set). The renderer resolves name → question definition → answer for
the **current** datapoint.

All widgets read the single site-profile endpoint (§4); the data source column names
which part of that payload feeds each.

> **Naming**: user-friendly names chosen so a config author can read the JSON at a
> glance. Earlier draft names in brackets for traceability.

| `chart_type` | Renders | Backed by | Payload slice |
|---|---|---|---|
| `field_list` *(was `field_table` / `table`)* | Label/value rows for configured `rows[]` (or fallback `questions[]`); no visible header, matching prototype's Staff & OHS / Maintenance tables. Option answers show as colored pills (`option.color`) | `FieldListWidget` | `latest[name]` |
| `record_table` | Multi-column record table for configured `columns[]`, matching prototype's Inspection History shape (`Date`, `Inspector`, `Status`, `Issues Raised`, `Resolved?`) | `RecordTableWidget` | `submissions[]` |
| `assessment` *(was `condition_table`)* | **Component · Condition pill · Photo · Notes** table; one `rows[]` entry per option-question, with optional `photo` (companion `type: "photo"` question) and `notes` (companion text question). Pill text+color come from the form's `option.label`/`option.color` | **new** | `latest[question]`, `latest[photo]`, `latest[notes]` |
| `compliance` *(was `metric_table`)* | **Parameter · Result · Threshold · Status** table; each `rows[]` entry is a numeric `question` + config `threshold {min,max}` → Pass/Fail/Below/Info pill, plus a `compliance_rule[]` verdict line | **new** | `latest[name]` |
| `tags` *(was `pill_list`)* | Colored tag list from one `multiple_option` `question`; tag text+color from `option.label`/`option.color` | **new** (small) | `latest[name]` |
| `trend` *(was `history_line`)* | One numeric `question` (by name) across this site's history; optional `threshold` band, `unit` | `HistoricalLineChart` (exists) | `history[name]` |
| `metric` *(was `latest_metric`)* | A single latest answer (`question` by name) as a compact KPI tile, matching prototype cards such as **Latest BOD** and **Station Status**; numeric values can show `unit`, option answers render as form-colored pills | `MetricWidget` (new) | `latest[name]` |
| `risks` *(was `risk_list`)* | **Risk · Severity · Recommended Action · Recurring?** — derives severity from each configured condition's option severity (green/amber/red) on the latest record. Action/recurring are optional per row so configs can omit them where no real source exists | new (derived) | `latest[name]` |
| `heading` *(was `section_title`)* | `<h4>` heading | reused as-is | — |
| `tabs` | Sub-tab container | reused `TabsWidget` | — |
| `photo` | Site/asset/contextual photo with optional caption, rendered with AntD `<Image />`; supports single images and repeatable-group galleries. Uses `question` or ordered `questions[]` fallback; `source: "latest"` for canonical photos, `source: "submissions"` for repeatable inspection/project photos | `PhotoWidget` (new, AntD Image) | `latest[name]` or `submissions[0].answers[name]` |
| `custom` *(was `custom_component`)* | Escape hatch for bespoke/derived pieces that are not covered by record-native widgets (e.g. computed risk-score trend) | registry | component-owned (`submissions[]`) |

The scope is implicit in the widget type — there is no `scope` flag and no `api` block.
`trend` widgets declare their `question` under the config's `history` request
(or the renderer derives the `history` question-name list from all `trend` items). Anything not
derivable from the MV payload goes through `custom` (D-4).

`header` is profile-level, not a `chart_type`: it mirrors the prototype's hero block
above the tabs and can render optional photo, title, subtitle, meta values, and a
status badge. It must be explicit because not every registration form has a photo.
Do not invent an `overall_status` question just to match the prototype; use a real
question or a derived summary from the existing compliance/risk rules.

Display text should be referenced by key (`label_key`, `title_key`, `caption_key`,
`action_key`, `value_key`, column `title_key`) and resolved from
`frontend/src/lib/ui-text.js`. Avoid hardcoded English UI strings in widgets or final
profile config JSON; units such as `mg/L` can remain in config because they are data
formatting metadata.

> **Condition pills are form-driven, not config-driven** (D-11): the option label and
> severity color come from the live form definition (`option.label`, `option.color` in
> `window.forms`), resolved via `findQuestionByName`. The config only names the
> question, so a pill recolors automatically if the form's option palette changes — no
> per-config color map. Thresholds for `compliance`, by contrast, **are** config-driven
> because the DWS pass/fail limits (BOD < 40, COD < 100, pH 7.6–9.0, …) are external
> standards absent from the form's data-entry rules.

### Profile layouts by asset type

All five asset types get a profile. **Tab plan confirmed by product** — WWTP, WTP, and
Pump have bespoke sub-tab layouts; EPS and RWP use the **default** layout
(Constructions · Water Quality · Inspection History) as no bespoke design exists yet.
The prototype's separate **Recommendations** tab remains out of scope. The risk table's
`Recommended Action` column is allowed only as row-level risk metadata when a config
has a static action or a real companion question.

| Asset | Form id | Layout source | Sub-tabs (in order) |
|---|---|---|---|
| WWTP | 1748903240763 | bespoke | Infrastructure Assessment · Effluent Quality · Operational Risks · Inspection History |
| WTP | 1749634736797 | bespoke | Drinking Water Quality · Pumps & Dosing · Infrastructure · OHS & Safety · Operations · Inspection History |
| Pump | 1749611049520 | bespoke | Pumps & Electrical · Infrastructure · OHS & Safety · Operations · Inspection History |
| EPS | 1749623934933 | **default** | Constructions · Water Quality · Inspection History |
| RWP | 1749621221728 | **default** | Constructions · Water Quality · Inspection History |

> Naming note: **RWP is the canonical asset label** for form `1749621221728`
> (standardized; the older `rwsOverview`/"RWS" naming is retired). The site-profile
> config is `site-profiles/1749621221728.json` ("RWP Site Profile").

### New registry — `src/config/site-profiles/index.js`

Mirrors `visualizations/index.js`. **Every asset has its own bespoke
`{parent_form_id}.json` file** — there is no shared `default.json`. EPS and RWP simply
copy the default *layout* (Constructions · Water Quality · Inspection History) into
their own files until bespoke designs exist. A straight lookup keyed by
`parent_form_id`:

```js
// One file per asset, indexed by parent_form_id (number). No default fallback.
export const getSiteProfileConfigByFormId = (formId) =>
  INDEX.get(Number(formId)) || null;
export const hasSiteProfile = (formId) => Boolean(getSiteProfileConfigByFormId(formId));
```

- `INDEX` — all five configs (WWTP, WTP, Pump, EPS, RWP) keyed by `parent_form_id`.
- Missing/invalid/duplicate entries are warned and skipped; a form with no config
  returns `null` and the page renders without the profile tab.

### Migration Strategy

```
- No data migration (no DB change).
- Config migration: delete `click_url_template` from the 5 bundled configs
  (1748903240763, 1749611049520, 1749621221728, 1749623934933, 1749634736797).
- Author one site-profiles/{form_id}.json per asset: WWTP (1748903240763),
  WTP (1749634736797), Pump (1749611049520) designed; EPS (1749623934933) and
  RWP (1749621221728) use the default layout copied into their own files. No default.json.
- Rollback: re-add the field + `buildSiteDetailHref` override branch; profile tab is
  additive and can be feature-flagged off by emptying the registry.
```

---

## 4. API Contract

**One new read endpoint**, backed by existing materialized views (no new DB objects —
the MVs already exist via `v1_visualization` migration `0002`). See D-10.

### New: `GET /api/v1/visualization/site-profile/{parent_id}`

| Param | In | Required | Notes |
|---|---|---|---|
| `parent_id` | path | yes | The registration datapoint id (`FormData.id`) — the site |
| `parent_form_id` | query | yes | Registration family; scopes the cross-form lookup |
| `questions` | query | no | Comma-separated `question_name` list to include; omit = all latest answers for the site |
| `history` | query | no | Comma-separated `question_name` list to also return as time series |
| `records` | query | no | Comma-separated `question_name` list to return per **monitoring submission** (one row per inspection) — backs `record_table` + risk-score-trend `custom` widgets (D-11) |

```jsonc
// GET /api/v1/visualization/site-profile/500?parent_form_id=1748903240763
//     &questions=treatment_capacity,process_type,pump_failure
//     &history=bod_effluent,cod_effluent
//
// Response 200 — keyed by question_name (the config's reference key)
{
  "parent_id": 500,
  "name": "Olosara WWTP",
  "latest": {
    "treatment_capacity": { "question_name": "treatment_capacity", "type": 4, "value": 1200, "created": "2024-06-10T08:30:00Z" },
    "process_type":       { "question_name": "process_type", "type": 5, "options": ["activated_sludge"], "created": "2024-06-10T08:30:00Z" },
    "pump_failure":       { "question_name": "pump_failure", "type": 5, "options": ["yes"], "created": "2024-06-10T08:30:00Z" }
  },
  "history": {
    "bod_effluent": [ { "date": "2024-04-10", "value": 62 }, { "date": "2024-05-10", "value": 48 } ],
    "cod_effluent": [ { "date": "2024-04-10", "value": 180 }, { "date": "2024-05-10", "value": 150 } ]
  },
  // Only when ?records= is passed. One entry per monitoring submission (newest first),
  // each carrying the requested question_names → answers. Backs the Inspection History
  // table and the risk-score trend.
  "submissions": [
    { "data_id": 9001, "date": "2024-06-10T08:30:00Z",
      "answers": { "inspection_date": "2024-06-10", "dws_staff_name": "E. Bola",
                   "has_final_recommendation": ["yes"] } },
    { "data_id": 8804, "date": "2024-01-26T09:00:00Z",
      "answers": { "inspection_date": "2024-01-26", "dws_staff_name": "V. Qoro",
                   "has_final_recommendation": ["no"] } }
  ]
}
```

**Backend mapping** (no new tables):
- `latest{}` ← `mv_cross_form_latest` filtered by `parent_id` (+ `parent_form_id`),
  optionally `question_name IN (questions)`. Cross-form, so a site with several
  monitoring forms still yields one latest value per `question_name`. Photo answers
  (`type: "photo"`) and free-text notes come back here too — the `assessment` widget reads
  `latest[question]` + `latest[photo]` + `latest[notes]` per row.
- `history[name]` ← `mv_answer_denormalized` filtered by `parent_id` +
  `question_name = name`, ordered by `data_created` ascending.
- `submissions[]` ← `mv_answer_denormalized` filtered by `parent_id` +
  `question_name IN (records)`, grouped by `data_id`, ordered by `data_created`
  descending. One object per monitoring submission. (Omitted entirely when no
  `records` param.)
- Reuse `DatapointDetailSerializer` (or its name lookup) for the `name` header.

### Supporting existing reads (already fetched by MonitoringDetail)

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| GET | `/data-details/{parentId}` | Datapoint header (name, uuid, administration) | Required |

The profile's record-native widgets read **only** the new site-profile endpoint
(response already keyed by `question.name`). They do **not** call
`/visualization/values` (fleet aggregates — wrong shape for one site; D-8), nor the
chatty `/data/{id}` + `/form-data?parent={uuid}` per-submission chain (D-10 supersedes
it). Endpoint auth/permission mirrors the other `v1_visualization` views.

### Click-through route (replaces template)

```
Built in code (no config):  /control-center/data/{parent_form_id}/monitoring/{data_id}
                            → MonitoringDetail (params: form=parent_form_id, parentId=data_id)
                            → defaults to the "site-profile" tab when a config exists.
```

---

## 5. Decision Log

### D-1: Presentation surface — tab in MonitoringDetail vs. new route/drawer

**Options Considered**:
1. New SPA route `/dashboard/site-profile/{form}/{id}` — bookmarkable full page.
2. Drawer/modal over the dashboard.
3. **First tab inside the existing MonitoringDetail page** (the page the click already
   lands on).

**Decision**: Option 3.

**Rationale**: `click_url_template` already targets MonitoringDetail. Adding the
profile as that page's first/default tab means the click destination is unchanged, the
existing breadcrumb/route/auth are reused, and Registration/Monitoring/Overview tabs
stay one click away. Lowest surface area, no new route wiring.

**Impact**: `MonitoringDetail.jsx` gains a conditional first `<TabPane>` and changes its
default `dataTab` to the profile when a config exists.

### D-2: Config binding — explicit key vs. by form id vs. asset-type field

**Options Considered**:
1. Explicit `site_profile` key on each visualization item.
2. **By `source_form_id`** → `site-profiles/{form_id}.json`.
3. Asset-type attribute on the datapoint.

**Decision**: Option 2 (by form id), mirroring how dashboards are keyed by
`parent_form_id`.

**Rationale**: MonitoringDetail already has the registration form id (`form` param) and
the datapoint. One layout per form is the natural granularity for WWTP/WTP. Zero
per-widget config; consistent with the visualizations registry mental model.

**Impact**: New `site-profiles/` directory + `index.js` registry keyed by form id.

### D-3: Migration — coexist vs. full replacement of `click_url_template`

**Options Considered**:
1. Coexist (profile preferred, fall back to template).
2. **Full replacement** — remove the field and override logic.

**Decision**: Option 2 (full replacement).

**Rationale**: Every real config points the template at the same MonitoringDetail
route, so the field is dead configurability. Removing it deletes branching in three
components and the constant, and centralizes the route in one builder.

**Impact**: Edit `constants.js`, `DashboardMap/index.jsx`, `DashboardMap/MapPopupCard.jsx`,
`RankingWidget.jsx`; strip the field from 5 JSON configs; update README §`map` row.

### D-4: Data source — existing chatty chain vs. thin MV-backed endpoint

**Options Considered**:
1. Frontend-only: reuse the `individual-overview` chain — `/data/{data_id}` +
   `/form-data?parent={uuid}` + `/data/{submission_id}` per history row. N+1 requests;
   frontend resolves `question.name → id` via `window.forms`.
2. **Thin MV-backed endpoint** `GET /visualization/site-profile/{parent_id}` querying
   `mv_cross_form_latest` (latest by `question_name` for the site) +
   `mv_answer_denormalized` (history). One round-trip; response keyed by `question_name`.

**Decision**: Option 2.

**Rationale**: The materialized views are **natively keyed by `question_name`** — the
exact key the config uses (D-9) — so config → query is 1:1. `mv_cross_form_latest`
filtered by a single `parent_id` already *is* a site-profile payload (cross-form, one
latest value per question_name). No existing endpoint exposes single-parent lookups
(`/maps/datapoint/{id}` is metadata-only; the formula endpoint is family-aggregate), so
a thin new read endpoint is warranted, and it replaces an N+1 frontend chain with one
fast request. The MVs already exist (migration `0002`) — no new DB objects.

**Impact**: Add `site-profile/{parent_id}` view + URL in `v1_visualization`; frontend
profile widgets read it directly. Supersedes the earlier "no new endpoint" stance after
the MV reference doc surfaced the better path.

### D-8: Widget model — record-native vocabulary vs. `scope` flag on aggregate widgets

**Options Considered**:
1. Add `scope: "record"` to configs and teach every aggregate widget
   (`card`/`bar`/`doughnut`/`boxplot`/…) a second single-record code path.
2. **A small record-native `chart_type` vocabulary** (`field_list`, `record_table`,
   `trend`, `metric`, `risks`, + reused `tabs`/`heading`/`photo`/`custom`).

**Decision**: Option 2.

**Rationale**: Aggregate widgets are fundamentally fleet-shaped (distributions/counts
over many parents from `/visualization/values`). A single site has one answer per
question, so a "distribution of one" is meaningless — `scope: "record"` would force a
second, often-nonsensical render path into every widget. Record-native types make the
single-record intent implicit in the type, need no flag, and map onto primitives that
already exist (`CharacteristicsTable`, `HistoricalLineChart`). `PhotoWidget` should use
AntD Image directly instead of the older `PhotoCaptionCard` pattern.

**Impact**: New small widget set + dedicated `ProfileRenderer` (D-5); no `scope` flag;
no `api` blocks in profile configs.

### D-9: Question reference — numeric `question.id` vs. `question.name`

**Options Considered**:
1. Numeric `question.id` (as visualization configs use).
2. **`question.name`** — the stable, human-readable variable name.

**Decision**: Option 2 (`question.name`).

**Rationale**: Names are stable across form rebuilds and readable in config, and they
are the **native key of the materialized views** (`mv_cross_form_latest`,
`mv_answer_denormalized`, `mv_parent_aggregates` all index `question_name`), so the
config key, the API response key, and the MV index key are all the same string — no
id-mapping layer on the server. On the frontend, a `findQuestionByName(name)` helper
(sibling to `findQuestion(id)` in `individual-overview/shared/helpers.js`) resolves a
name to its question definition when needed for labels/types.

**Impact**: Profile widgets use `question` / `questions[]` (names); the site-profile
endpoint accepts and returns `question_name`.

### D-10: (superseded — folded into D-4)

See D-4: the MV-backed endpoint is the chosen data source.

### D-5: Rendering engine — extend DashboardRenderer vs. dedicated ProfileRenderer

**Options Considered**:
1. Add the record-native chart_types + a `recordContext` prop to `DashboardRenderer`.
2. **Dedicated `ProfileRenderer`** that knows only record-native + layout types and
   threads a `recordContext` (the site-profile payload + datapoint id/uuid).

**Decision**: Option 2 (dedicated `ProfileRenderer`).

**Rationale**: The two surfaces share almost no data plumbing — `DashboardRenderer`
threads ~10 aggregate-specific props (filterState, computeResponses, definitionsById,
fiscalYear, …) that a profile never uses, and the profile's data comes from one
record-scoped endpoint, not per-widget `/values` calls. A small separate renderer keeps
profile concerns isolated, avoids growing the fleet renderer's prop surface, and still
reuses leaf primitives (`TabsWidget`, `CharacteristicsTable`, `HistoricalLineChart`,
AntD Image for `photo`, and `CustomComponentWidget`).

**Impact**: New `ProfileRenderer.jsx` (sorts by `order`, recurses for `tabs`, dispatches
record-native types) consuming `recordContext` from the site-profile endpoint.

### D-6: Coverage — one file per asset (designed or default-layout copy)

**Options Considered**:
1. **One `{form_id}.json` per asset.** Designed types (WWTP/WTP/Pump) get bespoke
   layouts; EPS/RWP copy the default layout (Constructions · Water Quality · Inspection
   History) into their own files.
2. A single shared `default.json` that undesigned assets fall back to via the registry.

**Decision**: Option 1 (one file per asset; no shared `default.json`).

**Rationale**: All five assets already have their own file, so the registry stays a
plain `parent_form_id → config` lookup with no fallback branch or allow-list. EPS/RWP
diverge entirely in their Constructions fields anyway (see Appendix A), so a shared
file would be union-with-omit-missing — more complex than just two small files. Each
asset evolves independently when its design lands.

**Impact**: Registry is a straight lookup, `null` when absent (no tab). Five config
files; no `default.json`.

### D-7: Auth — gate the profile tab (`is_public: false`) or not

**Options Considered**:
1. Gate the profile tab/sections with `is_public: false` like the public-dashboard
   Individual Overview tab.
2. **Leave ungated** — rely on the page's existing control-center auth.

**Decision**: Option 2 (ungated).

**Rationale**: `is_public: false` exists to stop **anonymous** viewers on the public
`/dashboard/:slug` route from firing authenticated fetches. The Site Profile lives in
`MonitoringDetail` under `/control-center/...`, which is not reachable anonymously and
is already governed by `AbilityContext`. Gating would be redundant. Flipping to gated
later is a one-line config change if a public surface ever hosts the profile.

**Impact**: No `is_public` flag on profile configs; profile relies on route-level auth.

### D-11: Widget vocabulary — ambiguous `table` vs. purpose-built record widgets

**Context**: Reviewing the prototype's rendered WWTP profile (Infrastructure Assessment,
Latest Effluent Test, Treatment Processes, Inspection History — see screenshots) showed
the original two-column `field_table` is insufficient for most panels.

**Options Considered**:
1. Keep one `field_table` and express richer panels as `custom` components.
2. **A small set of purpose-built, user-friendly record widgets** — `field_list`
   (label/value field list), `record_table` (multi-column per-submission table),
   `assessment`
   (Component·Condition·Photo·Notes), `compliance` (Parameter·Result·Threshold·Status),
   `tags` (multi-select pills), `trend`, `metric` — alongside `risks`/`custom`.

**Decision**: Option 2, plus a naming pass to friendly names (see the vocabulary table
in §3): `field_table→field_list`, ambiguous `table` is removed,
`inspection_history→record_table`, `condition_table→assessment`,
`metric_table→compliance`, `pill_list→tags`, `history_line→trend`,
`latest_metric→metric`, `risk_list→risks`, `section_title→heading`,
`custom_component→custom`.

**Rationale**:
- **Form-driven pills**: every condition/option question in the real monitoring form
  already carries per-option `label` + `color` (e.g. `good #009b77`, `poor #dd4124`).
  `assessment`/`tags` read these from `window.forms` (via `findQuestionByName`) — zero
  color config, auto-syncs with the form. Verified against `5_1748905550055.monitoring`.
- **Config-driven thresholds**: the DWS pass/fail limits behind the Effluent Test
  status column (BOD < 40, COD < 100, TDS < 1000, pH 7.6–9.0) are **not** in the form
  rules, so `compliance` carries them in config.
- **Photo companions exist**: condition questions pair with `type: "photo"` questions
  (`ground_conditions`→`photo_of_ground_conditions`, etc.), so `assessment` can show the
  real thumbnail, not a mock icon.
- **No universal hero photo**: verified against `backend/source/forms/*.prod.json`.
  WWTP registration has `plant_photo`; Pump registration has `pump_station_photo`;
  WTP, EPS, and RWP registration forms do not have registration-level photos. Many
  photo questions live in monitoring forms instead, and several are inside repeatable
  groups (`inspection_photo`, project photos, RWP component photos), so a `photo` widget
  must be explicit per profile and render galleries for repeatable answers.
- **Per-submission data**: Inspection History and the risk-score trend are one-row-per-
  inspection, which `latest{}`/`history{}` can't express → the `records` param +
  `submissions[]` block (§4).

**Resolved decisions** (from review; tracked in §10):
- **`assessment` rows — omit synthetic rows.** Only option questions with an
  `option.color` become rows (WWTP: the 5 condition questions). Treatment-unit
  operational status (`comment_on_operation_of_*`, `operational/not_operational`, no
  color) surfaces in the **Operational Risks** tab, not the assessment table.
- **`assessment` Notes — optional, column auto-hidden.** `notes` is wired per-row only
  where a companion text question exists; the widget drops the Notes column when no row
  defines one. WWTP's 5 rows have none → Component · Condition · Photo only.
- **`risks` follows the prototype table shape.** Use Risk · Severity everywhere; add
  Recommended Action / Recurring? only when the config has a static value or a real
  companion question. The separate Recommendations tab remains out of scope.

**Risk-score / compliance trend (`custom`) — reuse existing rules** (decided, Option A):
**No new scoring formula.** The trend reuses the *same* per-form "critical" definition
the dashboards already use — the `rules_kpi` `rules[]` block (e.g. WWTP
`kpi_critical_issues` in `config/visualizations/1748903240763.json`): an array of
`{ question_name, op, value }` conditions where the site is *critical* if **any** rule
fires (BOD>40, COD>100, TDS>1000, `comment_on_operation_of_* = not_operational`, …).

```
for each submission in submissions[] (oldest → newest):
    triggered = count(rules where rule matches that submission's answers)
    plot triggered   // 0 = compliant, higher = more critical issues that inspection
```

- **Single source of truth**: the widget references the existing rules rather than
  copying them — config carries `rules_ref` (the visualization config id, e.g.
  `kpi_critical_issues`) or, if simpler, the inline `rules[]`. Either way the definition
  of "critical" stays identical to the dashboard map/list pin colors.
- The rules' `question_name`s are added to the `records` request so `submissions[]`
  contains the answers needed to evaluate them per inspection.
- It is a **compliance trend** (count of failing rules over time), not a smooth 0–4
  curve — accepted trade-off for consistency with the rest of the app.

**Impact**: New `field_list`/`record_table`/`assessment`/`compliance`/`tags` widgets;
`risks` is severity-deriving (reads option colors) with optional Action/Recurring
columns; `records`/`submissions[]` added to the endpoint for `record_table` +
risk-score trend; all configs + `ProfileRenderer` dispatch use the friendly names.

---

## 6. Type/Constant Mappings

| Frontend/Editor | Backend Constant | DB Value |
|-----------------|------------------|----------|
| `site-profiles/1748903240763.json` | registration form id 1748903240763 (WWTP, bespoke) | form_id `1748903240763` |
| `site-profiles/1749634736797.json` | registration form id 1749634736797 (WTP, bespoke) | form_id `1749634736797` |
| `site-profiles/1749611049520.json` | registration form id 1749611049520 (Pump, bespoke) | form_id `1749611049520` |
| `site-profiles/1749623934933.json` | registration form id 1749623934933 (EPS, default layout) | form_id `1749623934933` |
| `site-profiles/1749621221728.json` | registration form id 1749621221728 (RWP, default layout) | form_id `1749621221728` |
| `question` / `questions[]` (names) | `question_name` (MV index + API key) | `question.name` |
| `chart_type` friendly names (`field_list`, `record_table`, `assessment`, `compliance`, `tags`, `trend`, `metric`, `risks`, `heading`, `custom`, `tabs`, `photo`) | `ProfileRenderer` dispatch keys | — |
| `assessment`/`tags` pill `option.color` | form `question.option[].color` (e.g. `#009b77`) | resolved via `findQuestionByName` |
| Tab key `"site-profile"` | new `uiText.manageDataTab0` / `siteProfileTab` label | — |
| Route `/control-center/data/{form}/monitoring/{parentId}` | `MonitoringDetail` (params `form`, `parentId`) | — |
| Endpoint `/visualization/site-profile/{parent_id}` | `mv_cross_form_latest` + `mv_answer_denormalized` | — |

---

## 7. Compatibility & Migration

### Backward Compatibility
- [ ] Forms without a `site-profiles/{id}.json` are unaffected — MonitoringDetail
      renders its existing three tabs and defaults to them.
- [ ] Removing `click_url_template` changes only the click target builder; map/ranking
      widgets otherwise behave identically.
- [ ] New endpoint is purely additive → existing consumers unaffected.
- [x] **MV freshness — effectively live.** `refresh_mv_concurrency()` runs
      `REFRESH MATERIALIZED VIEW CONCURRENTLY` synchronously after every approved save
      (`v1_data/tasks.py` → `seed_approved_data`, async post-approval), not on a cron.
      So profile "latest" lags only by the refresh itself — no meaningful staleness, **no
      "data as of …" caption needed**. Inspection History shows the real last-inspection
      date from the data.


---

## 8. Security Considerations

- [ ] Profile tab reuses existing authenticated endpoints and the page's existing
      `AbilityContext` (`can('edit'|'view', 'data')`) — no new permission surface.
- [ ] **Not gated** with `is_public: false` (D-7): the profile lives in
      `MonitoringDetail` under `/control-center/...`, already behind control-center auth
      and unreachable anonymously, so the `is_public` mechanism (which only protects the
      public `/dashboard/:slug` route) is redundant here.
- [ ] No new attack vectors: configs are build-time bundled JSON (not user input);
      placeholders are filled from typed route params/datapoint ids.

---

## 9. Testing Strategy

| Test Type | Coverage |
|-----------|----------|
| Unit (FE) | `site-profiles/index.js` registry: lookup by exact `parent_form_id`, no arbitrary fallback, unknown keys return null, `hasSiteProfile`. Route builder replacing `click_url_template`. `findQuestionByName`. `ProfileRenderer` dispatch + `order` sort + `tabs` recursion. |
| Unit (BE) | `site-profile/{parent_id}` view: `latest{}` from `mv_cross_form_latest` (cross-form, single parent), `history[name]` from `mv_answer_denormalized` ordered by date; `questions`/`history` question-name list filtering; unknown `question_name` omitted not errored. |
| Integration | MonitoringDetail renders the profile tab only when a config resolves; defaults to it; existing tabs render when absent; `?form_id=` still forces Monitoring tab. `ProfileRenderer` renders each record-native type against a mock payload. |
| E2E | From a dashboard, click a map popup / ranking row → lands on MonitoringDetail Site Profile tab for the correct site; WWTP vs WTP vs default show their respective sub-tabs; the `trend` widget plots the line; switching to Registration/Monitoring tabs still works. |
| Regression | Existing visualizations snapshot/`useDashboardConfig` tests still pass after `click_url_template` removal. |

---

## 10. Open Questions

**Resolved**
- [x] **Coverage** — all five asset types get a profile: WWTP/WTP/Pump bespoke,
      EPS/RWP on the default layout, each as its own file. (D-6)
- [x] **`?form_id=` deep-links** — keep current behavior: an explicit `?form_id=` still
      forces the Monitoring Data tab over the default profile tab (MonitoringDetail
      L81–83). The profile is the default only when no such override is present.
- [x] **Data source** — one thin MV-backed endpoint
      `GET /visualization/site-profile/{parent_id}` (mv_cross_form_latest +
      mv_answer_denormalized), keyed by `question_name`; derived pieces via
      `custom`. (D-4)
- [x] **Question reference** — by `question.name` (MV-native key), not numeric id. (D-9)
- [x] **Widget model** — record-native vocabulary, not a `scope` flag on aggregate
      widgets. (D-8)
- [x] **Renderer** — dedicated `ProfileRenderer`, not an extension of
      `DashboardRenderer`. (D-5)
- [x] **Auth gating** — not gated; rely on control-center route auth. (D-7)

**Resolved (this pass)**
- [x] **(D-11) `assessment` rows — omit the synthetic rows.** Keep only option
      questions that carry an `option.color` (WWTP: the 5 condition questions). The
      prototype's pumps/electrical/lagoons/screening rows have no clean colored option
      question — treatment-unit operational status (`comment_on_operation_of_*`,
      `operational/not_operational`, no color) is surfaced in the **Operational Risks**
      (`risks`) tab instead, not the assessment table.
- [x] **(D-11) `assessment` Notes — optional per-row `notes`, column auto-hidden.**
      Wire `notes` only where a companion text question exists; the widget hides the
      Notes column when no row defines one. WWTP's 5 rows have no note companion → no
      Notes column (Component · Condition · Photo only). No fabricated text.
- [x] **(D-11) "Recommended action" / "Recurring?" — optional risk-table metadata.**
      `risks` always has **Risk · Severity**; it may add row-level Recommended Action
      and Recurring? columns when configured. The separate Recommendations tab remains
      out of scope.
- [x] **(D-11) risk-score trend — reuse existing compliance rules** (Option A). No new
      formula: apply the dashboard's `rules_kpi` `rules[]` (per-form "critical"
      definition) to each `submissions[]` inspection → plot failing-rule count over time.
- [x] **Tab label — "Site Profile"** (generic, not asset-specific "WWTP Profile").
- [x] Canonical label for form 1749621221728 — **RWP** (standardized; "RWS" retired).
- [x] **Shared default — removed.** One bespoke file per asset; no `default.json`. (D-6)
- [x] **MV freshness — effectively live, no caption needed.** `refresh_mv_concurrency()`
      runs `REFRESH MATERIALIZED VIEW CONCURRENTLY` synchronously after every approved
      save (`v1_data/tasks.py` → `seed_approved_data`), so profile "latest" lags only by
      the refresh itself, not a cron window. No "data as of" staleness caption; the
      Inspection History already shows the real last-inspection date.
- [x] Per-section widget → `question_name` mapping — **drafted in Appendix A**; still
      needs a verification pass (names exist, types match widgets) before final JSON.

**Still open**
- [x] **Risk-score scoring — decided: reuse existing compliance/critical rules**
      (Option A, D-11). No invented weights; the trend = failing-rule count per
      inspection from the shared `rules_kpi` definition.

_All §10 questions resolved._

---

## 11. References

- Prototype: `index.html` (National Overview) — Site Profile sections ~L801–917 (WWTP),
  ~L1187+ (WTP); current stub at L3223.
- Integration point: `src/pages/manage-data/MonitoringDetail.jsx` (tabs at L319–483).
- `click_url_template` replacement touch points: `src/components/dashboard/constants.js`
  (`buildSiteDetailHref`), `DashboardMap/MapPopupCard.jsx`,
  `widgets/RankingWidget.jsx`, and the 5 configs under `src/config/visualizations/`.
- Config-driven engine (pattern to adapt, not reuse wholesale):
  `src/components/dashboard/DashboardRenderer.jsx`, `ChartRenderer.jsx`; schema in
  `src/config/visualizations/README.md`.
- Record-centric primitives to reuse:
  `src/components/dashboard/custom-components/individual-overview/shared/`
  (`CharacteristicsTable.jsx`, `HistoricalLineChart.jsx`,
  `helpers.js` — `findQuestion`/`findAnswer`/`formatAnswerValue`).
- Materialized views: `doc/claude/materialized-views-optimization/materialized-views-reference.md`
  (`mv_cross_form_latest` keyed by `(parent_id, question_name)`, `mv_answer_denormalized`);
  backend migration `backend/api/v1/v1_visualization/migrations/0002_add_optimized_materialized_views.py`.
- Backend integration: `backend/api/v1/v1_visualization/urls.py`, `views.py`
  (`DatapointDetailView`, the `mv_cross_form_latest` usage in the formula endpoint).
- Registry pattern to mirror: `src/config/visualizations/index.js`.

---

## Appendix A — Drafted `question_name` lists per sub-tab

> **Status: DRAFT.** Bucketed from the live form definitions in
> `backend/source/forms/` (reg + monitoring forms per family). Names are real and
> copied from the form `questions[].name`. Selection is deliberately a *usable* subset,
> not every question. **Verify against the forms before authoring final JSON** — confirm
> each name still exists and that numeric/option types match the assigned widget.

### WWTP — `1748903240763.json` (authored — reflects D-11 widgets)

- **Infrastructure Assessment**
  - `assessment` (Component·Condition·Photo·Notes), pills from form option colors:
    `ground_conditions`+`photo_of_ground_conditions` · `building_conditions`+`photo_of_building_conditions` · `condition_of_fence_for_security_purpose`+`photo_for_security_purpose` · `security_lights` · `transport_availability`
  - `tags`: `treatment_processes`  *(Treatment Processes in Use)*
  - `field_list` (Staff & OHS): `num_staff_at_plant`, `plant_supervisor_name`, `has_ohs_policy`, `staff_use_ohs_equipment_at_workplace`, `ohs_equipment_available`, `working_tools`
  - `field_list` (Maintenance): `urgent_maintenance_programs`, `provide_details_of_these_urgent`, `provide_details_of_these_preventative`, `provide_details_of_these_upgrading`
  - `field_list` (Plant characteristics — reg-form fields, see D-4 caveat): `plant_name`, `division`, `commissioned_year`, `design_capacity_m3_day`, `total_population_connected_to_this_plant`, `has_pump_station`, `num_pump_stations`, `pump_station_types`
- **Effluent Quality**
  - `compliance` (Latest Effluent Test, config thresholds): `bod` (<40) · `chemical_oxygen_demand` (<100) · `total_dissolved_solids` (<1000) · `total_suspended_solids` (<60) · `ammonia` (<10) · `total_phosphorus` (<5) · `oil_and_grease` (<5) · `ph` (7.6–9.0); `compliance_rule` = bod/cod/tds
  - `metric`: `bod`
  - `trend` (each): `bod` · `chemical_oxygen_demand` · `total_dissolved_solids` · `total_suspended_solids` · `ph` · `dissolved_oxygen` · `ammonia` · `total_phosphorus` · `conductivity` · `inflow_rate_in_cubic_meters_per_day`
- **Operational Risks**
  - `risks` (severity derived from each option's color): `ground_conditions`, `building_conditions`, `condition_of_fence_for_security_purpose`, `security_lights`, `transport_availability`, `working_tools`, `ohs_equipment_available`, `has_ohs_policy`, `staff_use_ohs_equipment_at_workplace`, `urgent_maintenance_programs`, `comment_on_operation_of_oxidation_ponds`, `comment_on_operation_of_pasveer_ditches`, `comment_on_operation_of_sludge_digester`, `comment_on_operation_of_imhoff`, `any_work_related_constraints`
- **Inspection History**
  - `record_table` via `records` → `submissions[]`: `inspection_date`, `plant_supervisor_name`, `dws_staff_name`, `has_final_recommendation`
  - `custom` `RiskScoreTrend` (Compliance Trend) — `rules_ref: kpi_critical_issues` (reuses the dashboard "critical" rules; failing-rule count per inspection)

### WTP — `1749634736797.json`

- **Drinking Water Quality** (each a `trend`)
  - `turbidity_ntu` (NTU, max 5) · `residual_chlorine_mg_l` (mg/L) · `ph` · `e_coli_cfu_100ml` (cfu/100ml, max 0) · `e_coli_count_cbt` · `total_coliform_cfu_100ml` (cfu/100ml) · `fecal_coliform_cfu_100ml` (cfu/100ml, max 0) · `conductivity` (µS/cm) · `salinity` (PPT) · `temperature_c` (°C)
  - `field_list`: `water_quality_checks`, `water_testing_method`, `parameters_tested`, `can_take_water_sample`, `e_coli_risk_level_cbt`
- **Pumps & Dosing**
  - `field_list`: `pumps_rising_main_count`, `pumps_rising_main_standby_count`, `borehole_pump_count`, `borehole_pump_standby_count`, `borehole_gallery_pumps_count`, `borehole_gallery_pumps_standby_count`, `number_of_high_lift_pumps`, `disinfection_technique`, `chlorine_dosage_g_m3`, `chlorine_gas_dosing_method`, `hth_powder_dosage_g_m3`, `sodium_hypochlorite_dosage_g_m3`, `dpd_tablets_dosage_g_m3`
  - `risks`: `pumps_rising_main_has_risks`, `borehole_pump_has_risks`, `borehole_gallery_pumps_has_risks`, `risks_associated_with_the_high_lift_pumps`, `has_chlorine_gas_risks`, `has_hth_powder_risks`, `has_sodium_hypochlorite_risks`, `has_dpd_tablets_risks`, `has_alum_dosing_risks`, `has_soda_ash_dosing_risks`, `issues_risks_associated_with_polymer_dosing`, `issues_risk_associated_with_lime_dosing`, `risks_associated_with_prechlorination_system`
- **Infrastructure**
  - `field_list`: `plant_type`, `designed_capacity_megalitres`, `constructed_date`, `raw_water_source`, `raw_water_transport_method`, `floc_tanks_are_there_at_the_plant`, `clarifiers_sedimentation_tanks_are_there`, `types_of_clarifiers_sedimentation_tanks_at_the_plant`, `types_of_filtration_system`, `types_of_backwash_sludge_removal_system`, `type_of_flow_meters`, `number_of_storage_reservoir_at_the_plant`, `number_of_distribution_reservoirs_for_the_plant`, `has_backup_generator`
  - `risks`: `issues_risk_associated_with_surface_water_source`, `issues_risk_associated_with_ground_water_source`, `risks_associated_with_the_raw_water_gravity_system`, `risks_associated_with_the_floc_tanks`, `risks_associated_with_the_clarifiers_sedimentation_tanks`, `risks_associated_with_the_filtration_system`, `risks_associated_with_the_backwash_sludge_removal_system`, `risks_associated_with_the_flow_meters`, `backup_generator_condition`
- **OHS & Safety**
  - `field_list`: `has_ohs_policy`, `staff_use_ohs_equipment`, `staff_comply_ohs_policy`, `has_dwsp`, `has_sop`, `has_disinfection_sop`
  - `risks`: `staff_comply_ohs_policy`, `staff_use_ohs_equipment`
- **Operations**
  - `trend`: `daily_production_megalitres` (megalitres)
  - `field_list`: `staff_count`, `sops_available`, `contact_person_name`, `has_dwsp`
  - `risks`: `has_production_constraints`, `has_final_recommendation`
- **Inspection History**
  - `record_table`: `date_of_inspection`, `dws_officer_name`, `has_final_recommendation`, `final_recommendations`

### Pump — `1749611049520.json`

- **Pumps & Electrical**
  - `field_list`: `num_pumps_operational`, `num_pumps_standby`, `power_backup_system`
  - `trend`: `num_pumps_operational` (pumps)  *(verify it trends meaningfully)*
  - `risks`: `electrical_panel`, `hour_run_meter`, `amp_meter`, `volt_meter`, `pump_status`, `power_backup_system`
- **Infrastructure**
  - `field_list`: `non_return_valve`, `sluice_valve`, `ventilation`, `pump_station_lid`, `gantry`
  - `risks`: `non_return_valve`, `sluice_valve`, `ventilation`, `pump_station_lid`, `gantry`, `facility_condition`, `ground_conditions`, `security_gate_fencing`, `water_supply`, `lights`
- **OHS & Safety**
  - `field_list`: `ohs_equipment`, `guardrails_pump_station`
  - `risks`: `ohs_equipment`, `guardrails_pump_station`, `security_gate_fencing`, `odour`, `fats_grease_balls`
- **Operations**
  - `metric`: `station_status`
  - `risks`: `station_status`, `log_book_updated`, `odour`, `fats_grease_balls`
  - `field_list`: `num_pumps_operational`, `num_pumps_standby`
- **Inspection History**
  - `record_table`: `inspection_date`, `station_status`, `supervisor_name`, `dws_staff_name`

### Default layout — EPS (`1749623934933.json`) + RWP (`1749621221728.json`)

Both use the same 3-sub-tab **default layout** (Constructions · Water Quality ·
Inspection History) but as **two separate bespoke files** (no shared `default.json`;
see D-6). They share a common Water-Quality core; their Constructions fields diverge
entirely, so each file lists its own.

- **Shared core** (identical question_names in both files)
  - Water Quality `trend`: `ph` · `turbidity_ntu` (NTU, max 5) · `temperature_c` (°C) · `conductivity` (µS/cm) · `salinity` (PPT)
  - Inspection History: `inspection_date`
- **EPS** (`1749623934933`)
  - Constructions `field_list`: `urf_tank_size`, `urf_tank_thickness`, `urf_tank_inflow_pipe_size`, `urf_tank_outlet_pipe_size`, `urf_tank_media_size`, `eps_tank_size`, `eps_tank_thickness`, `eps_tank_inflow_pipe_size`, `eps_tank_overflow_pipe_size`, `eps_tank_siphon_pipe_size`, `eps_tank_media_size`, `balance_tank_size`, `storage_tank_size`, `number_of_standpipes_to_be_implemented`, `existing_number_of_implemented_standpipes`, `project_scope`
  - Water Quality `trend`: `e_coli_level` (CFU/100ml, max 0), `total_coliform_level`, `fecal_coliform_level`, `cbt_bag_contamination_level`
  - Inspection History `record_table`: `inspection_date`, `officer_name`, `is_project_completed`, `system_status`, `percentage_of_project_completion`
- **RWP** (`1749621221728`)
  - Constructions `field_list`: `reservoir_type`, `reservoir_size_concrete`, `reservoir_size_roto`, `number_of_reservoirs`, `raw_water_main_type_of_pipe`, `distribution_main_type_of_pipe`, `distribution_main_length`, `reticulation_type_of_pipe`, `number_of_household_connections`, `number_of_shared_connections`, `tanks_size`, `pumps_name`, `pumps_power_supply`, `water_source_type`, `type_of_project`
  - Water Quality `trend`: `lab_ecoli` (CFU/100ml, max 0), `total_coliform_count`, `fecal_coliform_count`, `cbt_ecoli`
  - Inspection History `record_table`: `inspection_date`, `dws_officer_name`, `infrastructure_status`, `project_completion_percentage`, `major_issues`

> **Resolved (D-6)**: two separate per-asset files, not a shared `default.json`.
> Constructions fields diverge entirely between EPS and RWP, so each file carries its
> own; the only duplication is the small Water-Quality core above.

---

## Approval

| Role | Name | Date | Status |
|------|------|------|--------|
| Developer | Iwan Firmawan | | |
| Tech Lead | | | |
| Product | | | |
