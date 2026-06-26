# Requirements — Site Profile

## Functional

- **FR-1** The Site Profile renders from a per-asset JSON config and shows a header
  (site name + subtitle + meta) followed by asset-specific **sub-tabs**.
- **FR-2** Each sub-tab lays out its widgets in a **Main container** with a **left** and
  **right** column; widget placement is driven by `position` and `order` in config.
- **FR-3** Four widget types cover every panel:
  - `record` → a table (per-question rows from latest, or per-inspection rows from submissions)
  - `field` → a key/value list
  - `line` → a time-series chart
  - `photo` → an image grid
- **FR-4** `record` tables support **built-in cell renderers** so config stays small:
  option pills colored from the form's `option.color`, numeric threshold → Pass/Fail/Below,
  photo thumbnails, dates, plain text, severity.
- **FR-5** Each `children[]` item is bound to a tab via `child.tab === tabs[].key`.
- **FR-6** All user-facing labels resolve through i18n (`label_key` / `title_key` /
  `subtitle_key` via `lib/ui-text.js`), with raw-string fallback.
- **FR-7** Charts use **akvo-charts `<Line>`**, consistent with the dashboard. Trend lines
  with a `threshold` show a green band + dashed limit lines.
- **FR-8** When a datapoint's form has no site-profile config, `MonitoringDetail` shows
  its standard tabs (Registration / Monitoring / Overview) with no empty Site Profile tab.
- **FR-9** All five assets render: WWTP, WTP, Pump (designed layouts); EPS, RWP (shared
  default 3-tab layout).
- **FR-10** The **header** shows a hero photo, the datapoint name, a location subtitle, and
  a meta row. Each meta value resolves **registration answer → monitoring `latest` →
  derived `last_inspection` → static value**. The location subtitle reuses the registration
  administration answer (e.g. `"Fiji|Western"` → "Western"), prepending the village when a
  `village` question exists.
- **FR-11** A `record` table with `compliance_rule` renders a **PASS/FAIL verdict** line.
- **FR-12** A `line` with `source: "risk_score"` renders a **computed risk-score trend**
  (per-inspection severity → OK/Low/Med/High/Critical) with an explanatory **level legend**.
- **FR-13** Registration data for the header is fetched **once** and **shared** with the
  Registration Data tab (no duplicate `/data/{id}` request).

## Technical

- **TR-1** Exactly four widget components under `profile/widgets/`
  (`RecordTable`, `FieldList`, `HistoryChart`, `Photo`); `ProfilePage` imports them.
- **TR-2** `ProfilePage` is the entry; it owns data via a `ProfileContext` provider and
  renders header + tabs + the Main layout.
- **TR-3** `utils.js` is **pure** (no React/JSX) and is the single home for shared
  helpers **and** the config query-collector.
- **TR-4** The profile is **self-contained**: it does not import from
  `components/dashboard/widgets/`.
- **TR-5** Data comes from `GET /visualization/site-profile/{parent_id}`
  (`latest` / `history` / `submissions`) plus `GET /data/{parent_id}` (registration
  answers) for header meta/photo/location — the latter cached in the global Pullstate
  store (`dataPointDetails = { id, data }`) and deduped via `lib/data-point-details.js`
  (`getDataPointDetails`, cache + in-flight guard), shared with `DataDetail`.
- **TR-6** The query-collector derives `questions` / `history` / `records` request params
  from the config so the provider fetches exactly what the tabs need, lazily (only when
  the Site Profile tab is active).
- **TR-7** Lint clean per `frontend/.eslintrc.json` (braces on all blocks, `prefer-const`,
  arrow callbacks, no `console.log`, prettier), verified in the frontend container.
- **TR-8** Unit tests cover `ProfilePage` rendering and the query-collector.

## Non-goals

- No changes to the dashboard, its widgets, or the visualization/data APIs (read-only reuse).
- Prototype meta fields absent from the real forms (Source, Discharge-to, Pump-type,
  Design-flow) are omitted rather than faked.
