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

The map widget renders a single header row above the map containing,
left-to-right:

- **Title** from `item.title`.
- **One filter-mode `Select`** whose options are the labels of every
  `filters[].type === "select"` entry. Picking an option switches the
  *active filter* (decision #18). Default value: the first declared
  select filter.
- **Clickable legend chips** for the active filter (FR-2.4).
- **One Ant `Switch`** per `filters[].type === "toggle"` entry,
  pushed to the right of the row.

When `item.filters` is missing or empty (or contains only toggles),
the dropdown and legend collapse; only the title and any toggles
render.

### FR-2 — Active filter and clickable legend chips

#### FR-2.1 — Active filter resolution

The *active filter* is the value of the filter-mode dropdown. By
default it is the first declared `select` filter in `filters[]`. The
user can switch by picking another option in the dropdown.

#### FR-2.2 — Bucket-value resolution per active filter

For a *question-id* active filter, bucket values come from the
question's options resolved via `window.forms[filter.form_id]`
walked by `filter.question_id`. Plus the implicit `_no_info` bucket
when the active filter's `color_map._no_info` is set.

For a *formula* active filter, bucket values are
`filter.formula.buckets[].value` plus `filter.formula.default.value`
(decision #20). Plus `_no_info` when set.

#### FR-2.3 — `byParent` table

For both filter modes the frontend fetches a `byParent` table from
the backend via `GET /visualization/values/formula`. For question-id
filters the hook constructs an equivalent `option_equals` formula from
`window.forms` options at call-time (decision #22); for formula
filters the config JSON is passed directly. `byParent[datapoint_id]`
yields the bucket value for that datapoint. Datapoints absent from
`byParent` are treated as `_no_info`.

#### FR-2.4 — Clickable legend chips (multi-select narrowing)

Each bucket renders as a chip: a coloured dot (from `color_map`) plus
its human label. Chips are clickable.

- **Default state**: all chips are *selected*. Visible marker set =
  all datapoints whose bucket is in the selected set, i.e. all
  datapoints. (Decision #19.)
- **Click**: toggles a chip's selection. Deselected chips dim
  visually (e.g. reduced opacity / outlined-only). Datapoints whose
  bucket is no longer selected become hidden.
- **All chips deselected**: no markers render.
- **Re-clicking** a deselected chip re-includes that bucket.

The narrowing is **client-side** for both filter modes: the
geolocation list is fetched once per `(filterState, toggle)`
combination; chip selection only affects which already-fetched
points render.

#### FR-2.5 — Marker colour

A visible marker is coloured by `color_map[byParent[id]]`, falling
back to `color_map._no_info`, falling back to `#1890ff`.

### FR-3 — Formula filter mode

When the active filter is a formula (Decision #18), narrowing and
colouring use the formula's per-datapoint bucket as computed by the
backend `/visualization/values/formula` endpoint. Repeatable group
handling: the formula evaluator considers the **latest repeat**
(highest `index`) for each referenced `question_id` (Decision #14).

Bucket-value resolution for chips includes both the explicit
`buckets[]` and the `default` bucket (Decision #20) so the user can
deselect "No" / fallback values that arise from the formula's
default branch.

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

`administration_full_name` and `updated` are not pre-loaded in the
geolocation response. When the user clicks a marker the popup fetches
them on demand from `GET /api/v1/maps/datapoint/{data_id}` (see
design.md §3.2). Results are cached in a `useRef` map for the lifetime
of the `DashboardMap` component so repeated clicks on the same marker
are instant. While the detail is loading the popup renders "…" for
those two rows.

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
- The geolocation response is lean: `{id, name, geo, administration_id}`
  only. `administration_full_name` and `updated` are fetched on demand
  via `GET /maps/datapoint/{id}` when a marker is clicked, and cached
  in a per-component `useRef` map so repeated clicks are instant
  (decision #21).
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
  monitoring children's `created`, scoped to the configured
  `monitoring_form_id` so unrelated child forms do not satisfy the
  date window.
- `GeolocationListView` response is lean (`{id, name, geo,
  administration_id}`); `administration_full_name` and `updated` are
  not included — verified by asserting their absence.
- `DatapointDetailView` (`GET /maps/datapoint/{id}`) returns the
  expected fields, returns 404 for monitoring children and drafts
  (`is_draft=True`), and is publicly accessible.
- New formula endpoint evaluates AND-of-conditions (including
  `between` ranges), respects "latest repeat" semantics, returns the
  `default` bucket when no bucket matches, and groups by `parent_id`.
- `validate_shape` rejects non-numeric values for numeric operators
  (prevents 500 TypeError at evaluation time).
- Permission checks on the new endpoint match the existing
  `/visualization/values` pattern.

## Open Items

None remaining as of the clarification round.

The Phase 1 backend formula evaluator may be revisited if it proves
slow on large dashboards or if the formula schema cannot express a
required filter — see decision #13 for the rationale.
