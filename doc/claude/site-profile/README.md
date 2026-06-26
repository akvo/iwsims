# Site Profile

The **Site Profile** is the synthesized, at-a-glance view of a single site (WWTP, WTP,
Pump, EPS, RWP) shown as the default tab of `MonitoringDetail` when a user opens a
datapoint from a dashboard map marker or ranking link.

It is **config-driven**: each asset family declares its layout in a JSON file, and a
small set of generic widgets renders it against per-site data from the visualization API.

## Design at a glance

- **Four generic widgets** render everything: `RecordTable`, `FieldList`, `HistoryChart`, `Photo`.
- **A declarative config** per asset: top-level `tabs[]` + a flat `children[]`, where each
  child pairs to a tab (`child.tab === tabs[].key`), chooses a side
  (`position: left | right`), sorts by `order`, and names a `chart_type`.
- **Built-in cell renderers** produce the rich visuals (condition pills colored from the
  form, threshold Pass/Fail + compliance verdict, photos, risk-score trend) from compact
  config.
- **A config-driven header** (photo · name · location · meta) resolved from registration
  answers + monitoring, with the registration fetch shared with the Registration Data tab.
- **A pure `utils.js`** holds shared helpers and the config query-collector.

## Documents

| File | Purpose |
|------|---------|
| [requirements.md](./requirements.md) | Functional + technical acceptance criteria |
| [design.md](./design.md) | Architecture: schema, components, data binding, layout, data flow |
| [implementation-plan.md](./implementation-plan.md) | Step-by-step build + verification |

## Key locations

- Components: `frontend/src/pages/manage-data/components/profile/`
- Configs: `frontend/src/config/site-profiles/{parent_form_id}.json`
- Mount point: `frontend/src/pages/manage-data/MonitoringDetail.jsx`
- API: `GET /api/v1/visualization/site-profile/{parent_id}` (`v1_visualization`)
- Visual reference: `iwsims-visualization/index.html`
