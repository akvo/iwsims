# Dashboard Visualization — Flat Schema Migration Plan

**Status:** Draft for review
**Owner:** Iwan
**Created:** 2026-04-15
**Target branch:** `feature/188-visualization-config-implementation`

## 1. Motivation

The current dashboard config (`frontend/src/config/visualizations/<parent_form_id>.json`)
uses 10+ heterogeneous sub-trees — `filters`, `kpis`, `charts`, `water_quality`,
`progress`, `escalation`, `map`, `layout`, `tabs`. Each sub-tree has its own
shape, the layout block separately references items by key strings, and adding
a new widget requires touching two places (definition + layout).

Pain points:

- Authoring burden — numeric question IDs hand-copied across sections
- Reordering a widget requires editing `layout.<tab>.sections[]`, not the widget
- No stable per-widget id for cross-references or a future visual editor
- `layout` section types (`kpi_row`, `chart_grid`, `parameter_grid`,
  `escalation_table`, `section_title`) duplicate information already in the
  widget definitions

Target: a **single flat array of items** where every widget is one self-describing
entry with `id`, `order`, `col_span`, `chart_type`, and its own data block. Layout
emerges from `order` + `col_span`. Nested containers (`tabs`, `filter_bar`)
allow grouping without reintroducing parallel trees.

## 2. Decisions (locked in)

| # | Decision | Value |
|---|---|---|
| D1 | Schema style | Flat array of self-describing items |
| D2 | Containers | `tabs`, `filter_bar` (recursive; nested tabs allowed) |
| D3 | Tab panes | Plain config objects inside `tabs.items[]` — no `chart_type` |
| D4 | Hidden definitions | Array items with `hide: true` and `chart_type: "progress_definition"` / `"water_quality_globals"` |
| D5 | Filters | Each filter is its own array item; wrapped in a `filter_bar` container |
| D6 | Tabs top-level metadata | Removed — tabs live as a container item |
| D7 | Renaming | `kpi` → `chart_type: "card"`; `escalation_table` → `chart_type: "table"` |
| D8 | Cross-references | By `id` (not by path strings). Example: `progress_ref: "progress_construction"` |
| D9 | Filter scope | Global only (no per-pane scoping in v1) |
| D10 | ID uniqueness | Globally unique across the entire item tree |
| D11 | col_span semantics | Relative to the nearest parent container (pane or root) |
| D12 | Compatibility | Hard cutover — migrate `1749623934933.json` and renderers in one PR. No adapter shim |
| D13 | Generator | Interactive npm script; greenfield only; auto-registers in `index.js` |

## 3. New Schema Specification

### 3.1 Top-level

```json
{
  "parent_form_id": 1749623934933,
  "name": "EPS Overview",
  "description": "...",
  "fiscal_year_start_month": 1,
  "items": [ /* flat array */ ]
}
```

Only these five top-level keys. Everything else is an item.

### 3.2 Common item fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Globally unique across the tree |
| `chart_type` | string | yes | See table in §3.3 |
| `order` | number | yes | Sort key within siblings (ascending) |
| `hide` | boolean | no (default `false`) | Hidden items may still be referenced |
| `col_span` | number | no (default `24`) | 1-24, Ant Design grid relative to nearest container |
| `className` | string | no | CSS passthrough |
| `label` | string | no | Widget title (cards, charts, tables, panes) |
| `description` | string | no | Helper text |

### 3.3 `chart_type` catalogue

| `chart_type` | Role | Extra fields |
|---|---|---|
| `card` | KPI tile | `color`, `api`, `value_type` |
| `bar`, `line`, `doughnut`, `pie`, `stack_bar` | Charts | `config`, `api` \| (`source`+`progress_ref`+`field`) \| (`compute`+`params_ref`+`globals_ref`) |
| `histogram` | Water-quality parameter | `group`, `threshold`, `display`, `api` |
| `table` | Escalation / data table | `api` (with `criteria[]`), `columns[]` |
| `map` | Map widget | `source_form_id`, `status_question_id`, `status_colors`, `click_action`, `click_url_template` |
| `section_title` | Heading | `text` |
| `tabs` | Container | `items[]` of pane objects |
| `filter_bar` | Container | `items[]` of filter items |
| `filter_date` | Filter | `date_question_ids` |
| `filter_administration` | Filter | — |
| `filter_option`, `filter_multi_option` | Filter | `key`, `question_id`, `form_id` |
| `progress_definition` | Hidden def | `key`, `components[]`, `api`, `start_date_question_id`, `deadline_question_id`, `scope_question_id` |
| `water_quality_globals` | Hidden def | `sample_question_id`, `test_method_question_id`, `monitoring_form_id` |

### 3.4 Tab pane shape (plain config, no `chart_type`)

```json
{ "id": "t_monitoring", "label": "Monitoring overview", "items": [ /* items */ ] }
```

### 3.5 Cross-reference resolution

At load time the renderer builds `definitionsById: Map<id, item>` by walking the
tree. Consumers reference defs by id:

- Compliance chart: `{ "chart_type": "stack_bar", "compute": "compliance", "params_ref": ["param_e_coli", "param_turbidity"], "globals_ref": "wq_globals" }`
- Construction-progression chart: `{ "chart_type": "bar", "source": "progress", "progress_ref": "progress_construction", "field": "histogram" }`
- Escalation table column: `{ "key": "concrete_base", "computed": true, "progress_ref": "progress_construction", "component_key": "concrete_base" }`

### 3.6 Render rules

- Sort every siblings list by `order` ascending
- Skip items where `hide === true` OR `chart_type` ∈ {`progress_definition`, `water_quality_globals`}
- Wrap renderable items in `<Col span={col_span ?? 24}>`; wrap sibling row in `<Row gutter=[16,16]>`
- `tabs` → Ant `<Tabs>` with `items.map(pane => <TabPane>{renderItems(pane.items)}</TabPane>)`
- `filter_bar` → existing `<DashboardFilters>` adapted to receive a list of filter items
- `section_title` → `<Typography.Title level={4}>{text}</Typography.Title>`

## 4. Migration of `1749623934933.json`

Concrete transformation of the existing file:

- `tabs[]` → wrapped in a single top-level `{ chart_type: "tabs", items: [...] }` container
- `filters.date` → `{ chart_type: "filter_date", ... }` inside a `filter_bar` container
- `filters.administration` → `{ chart_type: "filter_administration", ... }`
- `filters.custom[]` → one item each, `chart_type: "filter_option"` or `"filter_multi_option"`
- `kpis.*` → one item each, `chart_type: "card"`, id prefixed `kpi_`
- `charts.*` → one item each, id prefixed `chart_`
- `water_quality.parameters[]` → one item each, `chart_type: "histogram"`, id prefixed `param_`, with `group`
- `water_quality.{sample_question_id, test_method_question_id, monitoring_form_id}` → one hidden item `{ id: "wq_globals", chart_type: "water_quality_globals", hide: true, ... }`
- `progress.construction` → `{ id: "progress_construction", chart_type: "progress_definition", hide: true, ... }`
- `escalation.monitoring` → `{ id: "esc_monitoring", chart_type: "table", ... }`
- `escalation.construction` → `{ id: "esc_construction", chart_type: "table", ... }`
- `map` → `{ id: "map_main", chart_type: "map", ... }`
- `layout.<tab>.sections[]` → dissolved. Each section's contents become pane `items[]` of the corresponding tab pane; `section_title` sections become items; `parameter_grid` sections expand to direct references to the `param_*` items (the pane just lists them with `col_span: 12` for microbial/physical or `col_span: 8` for chemical)

Output: a backup copy of the current file is saved to
`doc/claude/dashboard-visualization-design/1749623934933.legacy.json`
for reference during renderer rewrite.

## 5. Renderer Refactor

### 5.1 New entry point

Create `frontend/src/components/dashboard/DashboardRenderer.jsx`:

- Accepts `items[]` + shared dashboard state (`filters`, `definitionsById`, `values`, etc.)
- Dispatches by `chart_type` to a `WIDGET_REGISTRY`
- Recursive — passes its own function down to containers (`tabs`, `filter_bar`)

### 5.2 Touched files

| File | Change |
|---|---|
| `frontend/src/pages/dashboard/Dashboard.jsx` | Replace section-dispatch logic with `<DashboardRenderer items={config.items} />` |
| `frontend/src/components/dashboard/ChartRenderer.jsx` | Remove nothing, just accept a single item instead of `(chartKey, config)` |
| `frontend/src/components/dashboard/KPICardRow.jsx` | Replace with `KPICard.jsx` (single tile); rows emerge from sibling `col_span` |
| `frontend/src/components/dashboard/EscalationTable.jsx` | Accept item directly (not escalation key + config lookup) |
| `frontend/src/components/dashboard/DashboardMap.jsx` | Accept item directly |
| `frontend/src/components/dashboard/DashboardFilters.jsx` | Accept filter items array instead of `filters` object |
| `frontend/src/components/dashboard/compute/*` | Update compliance compute to accept `params_ref[]` + `globals_ref` resolved ids |
| `frontend/src/util/hooks/useDashboardConfig.js` | Add `definitionsById` derivation; expose flat items list |
| `frontend/src/util/hooks/useDashboardFilters.js` | Derive initial state from filter items instead of `filters.*` |
| `frontend/src/util/hooks/useDashboardValues.js` | Key by item `id` instead of `chartKey` |
| `frontend/src/util/hooks/useDashboardEscalation.js` | Accept item |
| `frontend/src/util/hooks/useDashboardProgress.js` | Resolve by id instead of `"construction"` string |
| `frontend/src/config/visualizations/index.js` | Unchanged (still registers by `parent_form_id`) |
| `frontend/src/config/visualizations/README.md` | Full rewrite against new schema |

### 5.3 New components

- `WidgetContainer.jsx` — wraps one item in `<Col>` and dispatches
- `TabsWidget.jsx` — renders `chart_type: "tabs"`
- `FilterBarWidget.jsx` — renders `chart_type: "filter_bar"`
- `SectionTitleWidget.jsx` — renders heading

## 6. Generator Script

Location: `frontend/scripts/generate-dashboard.js`
Command: `npm run gen:dashboard` (add script to `frontend/package.json`)

### 6.1 Dependencies to add (devDependencies)

- `inquirer@^9` — interactive prompts
- `node-fetch@^3` — backend calls

### 6.2 Flow

1. Prompt `parent_form_id` (number)
2. Refuse overwrite if `<parent_form_id>.json` exists unless `--force`
3. Prompt backend base URL (default `http://localhost:8000`) + auth token
4. Fetch `/api/v1/form/web/<id>` — extract question metadata
5. Prompt dashboard `name`, `description`, `fiscal_year_start_month`
6. Tab structure — prompt N top-level panes (label + id)
7. Filter bar — always include `filter_date` + `filter_administration`; optional custom filters (pick questions from fetched list)
8. For each tab, loop: add item → pick `chart_type` → prompt required fields (with question_id pickers where applicable) → add another?
9. Optional sections: progress definition (y/n), water_quality globals + parameters (y/n)
10. Write `<parent_form_id>.json`, pretty-printed 2-space indent
11. Auto-register: parse `index.js` with regex, insert import + registry entry; abort with warning if file diverged from expected shape
12. Print next steps (`./dc.sh up`, open `/dashboard/<id>`)

### 6.3 Out of scope for v1

- Editing existing configs
- Visual preview / ASCII layout render
- Validation against a JSON Schema (future follow-up)

## 7. Testing

- Unit: new `DashboardRenderer` with hand-crafted item trees (cards, charts, nested tabs, hidden defs, filter_bar)
- Snapshot: migrated `1749623934933.json` renders without console errors on each tab
- Manual QA (golden path):
  1. `./dc.sh up -d`
  2. Visit `/dashboard/1749623934933`
  3. Check each tab renders — KPIs, charts, parameter grids, escalation tables, map
  4. Change filters → widgets refetch
  5. Toggle `hide: true` on one item in JSON → disappears on reload
  6. Reorder two `order` values → layout order flips
- Generator smoke test: run `npm run gen:dashboard` with a test form id, verify the output file loads and renders

## 8. Rollout Steps (execution order)

1. **Prep** — copy legacy JSON to `doc/claude/dashboard-visualization-design/1749623934933.legacy.json`; write failing migration-target file
2. **Schema doc** — update `frontend/src/config/visualizations/README.md`
3. **Migrate JSON** — rewrite `1749623934933.json` to new shape
4. **Renderer** — implement `DashboardRenderer` + widget components; migrate hooks
5. **Wire up** — update `Dashboard.jsx` to use new renderer
6. **Remove dead code** — old `KPICardRow`, old section-dispatch logic, legacy hook branches
7. **Generator** — script + npm entry + inquirer dep
8. **QA pass** — full manual run-through
9. **Commit per step** (Conventional commit style, `[#188]` prefix)
10. **PR** against `main`

## 9. Open Risks

| Risk | Mitigation |
|---|---|
| Renderer regression breaks the only live dashboard | Keep legacy JSON for quick visual diff; manual QA checklist in §7 |
| `compute: "compliance"` chart depends on sibling `/values` responses being already fetched | Resolve `params_ref[]` upfront in `useDashboardValues` so all referenced params are prefetched regardless of render order |
| Generator `index.js` auto-registration fails silently on divergence | Fail loud with a clear error pointing the user to do it manually |
| ID collisions during authoring | Validator at load time throws with the offending id |
| `col_span` confusion for authors | Document the "nearest parent container" rule in README with an example |

## 10. Beads Issues

Create under epic `akvo-mis-2aj` (visualization config) or a new epic:

- `feat: flat-schema migration for dashboard config` (this plan)
  - `task: migrate 1749623934933.json to flat schema`
  - `task: implement DashboardRenderer + widget dispatch`
  - `task: refactor dashboard hooks for id-keyed state`
  - `task: rewrite config README`
  - `feat: npm run gen:dashboard interactive generator`
  - `task: manual QA pass`

## 11. Review Checklist (fill in before implementation)

- [ ] Section 3 schema shape approved
- [ ] Section 4 migration mapping approved
- [ ] Section 5 renderer file list complete
- [ ] Section 6 generator flow approved
- [ ] Section 8 rollout order agreed
