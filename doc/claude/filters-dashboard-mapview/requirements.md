# Requirements — Filters for Dashboard Map View

## Background

The Fiji dashboard design ("Monitored EPS") asks for a richer
`DashboardMap` widget. The brainstorm + clarification rounds locked
this into a generic, form-agnostic feature with three capabilities:

1. **Configurable in-map filter dropdown** that narrows markers and
   recolours them by an active filter's `color_map`. Two modes:
   - **Question-id filter** — narrow by an answer value of a real
     question.
   - **Formula filter** — narrow by a server-computed bucket label
     evaluated against monitoring answers.
2. **Configurable boolean toggle** ("Monitored last year") that
   restricts the datapoint list to those with at least one monitoring
   submission inside a configurable rolling window.
3. **Filter-aware popup** that shows three fixed FormData fields plus
   one dynamic field whose value depends on the currently-active filter
   evaluated against the clicked datapoint's latest monitoring child.

Today's `DashboardMap.jsx` only renders an OSM map with
`status_colors`-derived legend chips, opens a new tab on marker click,
and uses default Leaflet popups. None of the existing config JSONs
populate `status_colors`, so the legacy code path is effectively dead
in production.

## Goals

- Visual parity with the Fiji design header (title, filter, legend,
  toggle) and a clean card-style popup.
- Zero hardcoded form IDs or question IDs in the component — everything
  comes from `chart_type: "map"` config.
- Generic vocabulary in code and docs (datapoint, registration,
  monitoring child) so the same widget works on Rural Water Project,
  EPS, and any future registration→monitoring form pair.
- No regression on the two existing dashboards
  (`1749621221728.json`, `1749623934933.json`) once they are migrated.

## Non-Goals

- Cross-widget filter propagation — map filter state is intentionally
  local. (Brainstorm Q7.)
- Tile provider changes — we keep OSM. (Brainstorm Q6.)
- Multiple basemaps, marker clustering, draw tools, or routing.
- Per-repeat answer rendering inside the popup. (Brainstorm follow-up
  / clarification Q-C: formula uses the **latest repeat** only.)

## Functional Requirements

### FR-1 — Header layout

- The map widget renders a single header row above the map containing,
  left-to-right:
  - Title (from `item.title`).
  - One Ant `Select` per `filters[].type === "select"` entry.
  - One Ant `Switch` per `filters[].type === "toggle"` entry.
  - Legend chips derived from the **active** select filter's
    `color_map`.
- When `item.filters` is missing or empty, the header collapses (only
  the title shows, or the entire row is omitted if no title).

### FR-2 — Question-id select filter

- Renders an Ant `Select` with `allowClear` and a placeholder equal to
  `filter.label`.
- Options are resolved from `window.forms` using
  `(filter.form_id, filter.question_id)` — same lookup used by
  `filter_option` widgets in `DashboardFilters.jsx`.
- Picking a value:
  - Updates **map-local** state only.
  - Triggers a refetch of `/api/v1/maps/geolocation/{source_form_id}`
    with `criteria=option_equals:<question_id>:<value>` appended (in
    addition to any other active criteria).
  - Hides markers whose backing point does not match (server-side, by
    virtue of the `criteria` filter).
  - Recolours visible markers via the active filter's `color_map`,
    keyed by the answer value — `_no_info` is the fallback key.
- Clearing the select removes the criterion and shows all markers
  using the default colour (`_no_info` or `#1890ff`).

### FR-3 — Formula select filter

- Renders an Ant `Select` whose options come from
  `filter.formula.buckets[]` plus the implicit `_no_info` bucket.
- Each bucket has `value`, `label`, and is paired with a `color_map`
  entry keyed by `bucket.value`.
- The map widget calls a **new backend endpoint** (see design.md §3)
  that evaluates the formula per parent and returns one bucket value
  per datapoint. The resulting `byParent[id] → bucket_value` table
  drives both marker colouring and popup display.
- Picking a bucket value narrows the markers to datapoints whose
  computed bucket matches.
- Repeatable group handling: the formula evaluator considers the
  **latest repeat** (highest `index`) for each referenced
  `question_id`. (Decision #14.)

### FR-4 — Toggle filter

- Renders an Ant `Switch` with the label `filter.label`.
- The toggle's **default state** is read from `filter.default` (boolean,
  default `false`).
- When the toggle is **ON**:
  - The frontend resolves a rolling date window:
    `from_date = today - filter.rolling_months months`,
    `to_date = today`, formatted as `YYYY-MM-DD`.
  - The geolocation request adds `from_date`, `to_date`, and
    `include_monitoring=true` query params.
  - The backend interprets these as a filter on the datapoint's
    monitoring children's `created` date.
- When the toggle is **OFF**: none of the three params are sent.
- The toggle is **disabled** (greyed out, with a tooltip "Cleared by
  date filter") whenever the dashboard-level filter has a `from_date`
  or `to_date` set. While disabled, the toggle does not contribute any
  query params regardless of its visual state.

### FR-5 — Filter-aware popup

Marker click opens a Leaflet popup with **exactly four rows**:

```
Name:                 <FormData.name>
Location:             <FormData.administration.full_name>
Last update:          <FormData.updated, formatted>
<active filter label>: <derived value>
```

The "active filter" is the most-recently-changed select filter in the
header, or — if no filter is active — the first select filter declared
in `item.filters[]`. If no select filter exists, the fourth row is
omitted.

#### FR-5.1 — Source of the derived value

For each datapoint, the **latest monitoring child** is the
`FormData.children` row with the largest `created` value
(`order_by("-created")[:1]`). If there are no monitoring children, the
fourth row reads:

```
<active filter label>: No monitoring data
```

#### FR-5.2 — Question-id filter

The fourth row shows the answer value of the configured `question_id`
on the latest monitoring child. For `option` / `multiple_option`
questions, the human-readable label is shown (resolved against
`window.forms`).

#### FR-5.3 — Formula filter

The fourth row shows the bucket label produced by the backend's
formula evaluator for the datapoint's latest monitoring child. The
backend already grouped by `parent_id` — the popup just looks up
`byParent[clicked_datapoint_id]`.

#### FR-5.4 — Static FormData fields

`administration_full_name` and `updated` are not in the existing
`/maps/geolocation` response. They are added to that endpoint's
per-point payload (see design.md §3.1) so no extra fetch is needed
per click.

#### FR-5.5 — View details link

The popup includes a "View details" link at the bottom resolved from
`item.click_url_template` with `{parent_form_id}` and `{data_id}`
substituted. The link opens in a new tab. The default Leaflet popup
tail/pointer is hidden via CSS.

### FR-6 — Backwards compatibility (transitional only)

- Configs without `filters[]` render the map without the header
  control row.
- Configs with `click_action: "navigate"` (or absent — defaulting to
  `"popup"` after migration) preserve the old new-tab-on-click
  behaviour.
- The legacy fields `status_colors`, `status_question_id`, and
  `status_monitoring_form_id` are **removed** from the schema. Both
  existing config JSONs are updated to use the new shape in the same
  PR.

## Non-Functional Requirements

### NFR-1 — Lint & style

- ESLint-clean per `frontend/.eslintrc.json`:
  - `curly: error` — every `if/else/for/while` body uses braces.
  - `no-undefined: warn` — never reference the bare `undefined`
    identifier.
  - `prefer-const: warn`, `prefer-arrow-callback: error`.
  - `no-console: warn` — only `console.error`/`console.info` if
    necessary.
- Prettier-formatted (run `yarn lint && yarn prettier` before commit).

### NFR-2 — Dependency footprint

- No new npm dependencies. Reuse Ant Design v4 (`Select`, `Switch`,
  `Tooltip`, `Skeleton`), `react-leaflet`, and existing utility
  libraries.

### NFR-3 — Performance

- Filter-change-driven refetches are debounced (~250 ms) to avoid
  double-fetch when the user toggles the switch and changes the
  dropdown in rapid succession.
- The geolocation response now includes `administration_full_name`
  and `updated` per point. For the largest existing dashboards this
  adds ≤ ~80 bytes per point — acceptable.
- Per-parent filter results (`byParent`) are cached on the component
  for the lifetime of the active filter selection. They are
  recomputed only when the filter changes or the dashboard-level
  filter changes.
- Marker rendering uses `CircleMarker` (already current) — no SVG
  marker images.

### NFR-4 — Backwards compatibility

- The two existing config JSONs are migrated to the new schema in the
  same PR as the code changes.
- The new backend `include_monitoring` param defaults to `false` and
  is therefore safe for any caller that does not opt in.
- The new formula evaluator endpoint is additive — no existing route
  is changed.

### NFR-5 — Test coverage

Frontend unit tests for `DashboardMap`:

- Header renders/hides based on `filters[]` presence.
- Question-id select change fires the expected geolocation URL with
  `criteria=...`.
- Formula select change fires the expected formula-evaluator URL and
  uses the returned `byParent` table for colour and popup.
- Toggle ON sends `include_monitoring=true` plus rolling window.
- Toggle is disabled when `filterState.from_date` / `to_date` is set.
- Popup renders 4 rows when a select filter is active and 3 rows when
  none is.
- Popup shows "No monitoring data" when the datapoint has no
  monitoring children.

Backend tests:

- `GeolocationListView` with `include_monitoring=true` filters by
  monitoring children's `created`.
- `GeolocationListView` response now includes
  `administration_full_name` and `updated` per point.
- New formula endpoint evaluates AND-of-conditions (including
  `between` ranges), respects "latest repeat" semantics, returns the
  `default` bucket when no bucket matches, and groups by `parent_id`.
- Permission checks on the new endpoint match the existing
  `/visualization/values` pattern.

## Open Items

None remaining as of the clarification round.

The Phase 1 backend formula evaluator may be revisited if it proves
slow on large dashboards or if the formula schema cannot express a
required filter — see decision #13 for the rationale.
