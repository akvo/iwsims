# Filters for Dashboard Map View

Configurable in-map filter dropdown + filter-aware popup for
`DashboardMap`. The Fiji "Monitored EPS" design is the initial driver,
but the schema and backend contract are intentionally form-agnostic so
the same widget works for any registration → monitoring relationship in
the system.

## Documents

- [requirements.md](./requirements.md) — locked functional and non-functional
  requirements derived from `/sc:brainstorm`.
- [design.md](./design.md) — component breakdown, config schema, backend
  contract, fetch flow, and ESLint compliance notes.

## Scope at a Glance

- New header row inside `DashboardMap` with title, **one filter-mode
  dropdown** that switches between configured select filters,
  **clickable legend chips** that narrow visible markers, and an
  optional toggle.
- New `filters[]` config block on `chart_type: "map"` items, supporting
  three filter shapes:
  - `select` + `question_id` → narrow by an answer value (existing
    `criteria=option_equals:...` plumbing).
  - `select` + `formula` → narrow by a server-computed bucket (new
    backend evaluator).
  - `toggle` → boolean switch with a configurable `rolling_months`
    window applied to monitoring children.
- Filter-aware popup: 3 fixed FormData fields (name, administration,
  updated) + 1 dynamic field tied to the active filter's value for the
  clicked datapoint's latest monitoring child.
- New backend query param `include_monitoring=true` on
  `/api/v1/maps/geolocation/{form_id}` to support the toggle filter.
- New backend endpoint for formula-based per-parent grouping (Phase 1
  decision; see Q-B in decision log).
- Drop unused legacy fields (`status_colors`, `status_question_id`,
  `status_monitoring_form_id`).

## Affected Code

- `frontend/src/components/dashboard/DashboardMap.jsx` (refactor into a
  small module).
- `frontend/src/config/visualizations/1749621221728.json` (migrate).
- `frontend/src/config/visualizations/1749623934933.json` (migrate).
- `backend/api/v1/v1_visualization/views.py` (`GeolocationListView` and
  the new formula evaluator view).
- `backend/api/v1/v1_visualization/serializers.py`
  (`GeoLocationFilterSerializer`, formula payload serializer).

## Vocabulary

The widget is generic. Where this doc says **"datapoint"** it means a
registration FormData (`parent IS NULL`) on `source_form_id`. Where it
says **"monitoring child"** it means any FormData with
`parent_id = <datapoint.id>`. The Fiji example uses these terms as
"EPS" and "monitoring submission" respectively, but no code path is
hardcoded to that domain.

## Decision Log

| # | Decision | Source |
|---|----------|--------|
| 1 | Filters configured via explicit `item.filters[]` array (Option B) | brainstorm Q1 |
| 2 | ~~Selected value hides non-matching markers~~ — **superseded by #18** | brainstorm Q2 |
| 3 | Toggle reuses `from_date`/`to_date` + new `include_monitoring` flag | brainstorm Q3 + follow-up |
| 4 | Marker click → filter-aware popup (3 FormData fields + 1 derived field) | brainstorm Q4 + clarification |
| 5 | Popup includes "View details" link (replaces `window.open` on click) | brainstorm Q5 |
| 6 | Stay on OSM tiles | brainstorm Q6 |
| 7 | Map filter state is local — does not propagate to other widgets | brainstorm Q7 |
| 8 | Toggle disabled when dashboard-level date filter is active | follow-up |
| 9 | Cache popup payloads per session keyed by `(data_id, filter_key)` | follow-up |
| 10 | Drop `status_colors`, `status_question_id`, `status_monitoring_form_id` (Option B) | follow-up |
| 11 | Toggle config flat (`rolling_months: 12`); no `kind` discriminator | follow-up |
| 12 | Popup field source = latest monitoring child of clicked datapoint, ordered `created DESC`. Fallback "No monitoring data". | clarification Q-A |
| 13 | Formula evaluation runs **on the backend** (Phase 1). May be revisited if perf or schema complexity warrants frontend eval. | clarification Q-B |
| 14 | Repeatable groups: formula uses **latest repeat** (highest `index`) of each referenced question | clarification Q-C |
| 15 | Schema is form-agnostic — EPS is just the initial example | clarification Q-D |
| 16 | Formula filters declare buckets explicitly; values are not auto-generated Yes/No | clarification Q-E |
| 17 | 7-field popup from screenshot is superseded by 4-field filter-aware popup | clarification Q-F |
| 18 | **One filter-mode dropdown** lists each select filter as a *mode*; the active mode's `color_map` entries render as **clickable legend chips** that multi-select-narrow the visible markers. The first declared select filter is the default mode. | post-render review |
| 19 | Default chip state: all chips selected (no narrowing). Clicking a chip deselects it (its value's markers hide). Clicking again re-selects. If user deselects all chips, no markers show. | follow-up to #18 |
| 20 | Formula-mode dropdown legend includes the `default` bucket alongside the explicit `buckets[]` so deselecting "No" works even though "No" comes from the formula's default branch. | post-render review |
| 21 | `administration_full_name` and `updated` are **not** pre-loaded in the geolocation response. They are fetched on demand via a new public `GET /api/v1/maps/datapoint/{data_id}` endpoint when the user clicks a marker, and cached in a `useRef` map for the lifetime of `DashboardMap`. Chosen because maps are expected to have many points but few are clicked per session — lazy fetch avoids the 2-query `build_admin_full_name_map` overhead on every geolocation load. | implementation review |
| 22 | `useMapByParent` routes **both** question-id and formula select filters to `GET /visualization/values/formula`. For question-id filters the hook constructs an equivalent `option_equals` formula from `window.forms` options at call-time rather than calling `GET /visualization/values?group_by=parent_id`, which silently returns `[]` for option questions (unimplemented branch in `handle_option_question`). Chosen over fixing the backend gap (Option A) to keep blast radius zero — no existing handler is touched. | implementation review |
| 23 | The formula endpoint handles **both registration and monitoring forms** (`form.parent_id is None` → registration). Registration forms group by `id`; monitoring forms group by `parent_id`. Both emit `{group: registration_datapoint_id, label: bucket}` so `byParent[point.id]` works identically. Popup fallback text is "Not answered" for registration-form filters, "No monitoring data" for monitoring-form filters. | implementation review |
