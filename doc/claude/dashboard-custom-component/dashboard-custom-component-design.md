# Dashboard `custom_component` Escape Hatch — Design

## Overview

The config-driven dashboard system in `frontend/src/config/visualizations/` is built around an aggregate-data paradigm: each chart binds to a backend `/visualization/values` endpoint, gets filtered globally, and renders a count or distribution. This pattern works for the Monitoring Overview, Water Quality, and Construction Monitoring tabs of the EPS dashboard.

The **Individual Overview** tab inverts that paradigm — it is record-centric: a user picks one EPS, and every downstream widget renders that single record (or its monitoring children). Bolting record-centric primitives (`dependencies`, `{{token}}` templates, `endpoint`/`params`, `fieldNames`, `dataSource`, `render`) onto the existing aggregate schema would double the schema surface and re-introduce a mini-DSL inside JSON.

Instead, this design ships a small **escape hatch**: a new `chart_type: "custom_component"` that delegates rendering to a named React component drawn from an explicit registry, plus an `is_public: false` tab-pane flag that disables the tab for anonymous viewers. The custom component owns its own data fetching, state, and UI; the dashboard renderer stays out of its way.

This keeps the JSON schema coherent for the 95% case and gives the 5% record-centric case a clean, code-first home.

---

## Goals & Non-Goals

### Goals

- Add `chart_type: "custom_component"` that resolves a string component name from a registry.
- Add `is_public: false` on a tab pane that disables the tab for anonymous viewers (logged-out users).
- Keep all existing JSON-driven dashboards behaviorally unchanged.
- Document the escape hatch with explicit guidance for when to use it (and when not to).

### Non-Goals

- A generic "individual overview" component shared across dashboards. Deferred until ≥3 working examples make the shared abstractions obvious (rule of three).
- A token-substitution DSL (`{{filter.x.data.y}}`), `dependencies` arrays, `fieldNames`, `dataSource`, or named `render` registries. All deferred — these belong inside the custom component as plain React, not in JSON.
- Per-role permission gating beyond the binary `isLoggedIn` check. Deferred until a concrete role-based requirement appears.
- A props contract richer than "component name". The component imports what it needs from existing stores/hooks. Adding `parentFormId`, `globalFilters`, etc. is a future change driven by a real second consumer.

---

## Schema Additions

### `chart_type: "custom_component"`

A new leaf-item type. Carries one new required field.

| Field | Type | Required | Notes |
|---|---|---|---|
| `chart_type` | string | yes | Literal `"custom_component"` |
| `component` | string | yes | Registry key — must match an export from `custom-components/index.js` |
| `id` | string | yes | Standard item id |
| `order` | number | yes | Standard sort key |
| `col_span` | number | no | Standard 1–24 grid; defaults to `24` |
| `hide` | boolean | no | Standard hide flag |

**Example** (from [`1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json)):

```json
{
  "id": "individual_overview_component",
  "chart_type": "custom_component",
  "order": 1,
  "component": "IndividualEPSOverview"
}
```

The dashboard renderer does not introspect any other field on this item. The component itself is the source of truth for everything that happens inside its render boundary.

### `is_public: false` on tab panes

A new optional boolean on tab pane objects (the `items[]` of a `tabs` container item).

| Field | Type | Default | Notes |
|---|---|---|---|
| `is_public` | boolean | `true` | When `false`, tab is **disabled** for anonymous viewers (rendered visible-but-not-clickable) |

**Example**:

```json
{
  "id": "tab_individual_overview",
  "is_public": false,
  "label": "Individual Overview",
  "items": [ /* ... */ ]
}
```

Rationale for "disabled, not hidden": the user-visible tab label communicates that authenticated functionality exists. Hiding it entirely would mislead anonymous viewers about what the dashboard offers. Disabling prevents access while preserving discoverability.

`is_public` is **only** evaluated on tab panes (children of a `tabs` container). It is ignored elsewhere.

---

## Component Design

### Registry shape — `custom-components/index.js`

Explicit named-export map. No dynamic imports, no convention-based lookup. Tree-shakeable and grep-friendly.

```js
// frontend/src/components/dashboard/custom-components/index.js
import IndividualEPSOverview from "./IndividualEPSOverview";

export { IndividualEPSOverview };
```

Adding a new custom component is a three-step change:

1. Create `frontend/src/components/dashboard/custom-components/<Name>.jsx`.
2. Add a named export to `custom-components/index.js`.
3. Reference it from JSON via `"component": "<Name>"`.

Naming is free-form — pick whatever describes the component (`IndividualEPSOverview`, `RWSDetailPanel`, `WTPSiteHistory`). The registry map is the source of truth for what is importable.

### `CustomComponentWidget` — new dispatch wrapper

A new thin widget colocated with the other dashboard widgets:

`frontend/src/components/dashboard/widgets/CustomComponentWidget.jsx`

Responsibilities:

1. Look up `item.component` in the registry.
2. If found → render the component (no extra props beyond what the component imports for itself).
3. If not found → log a `console.warn` and render an Ant Design `<Alert type="warning">` with the message `Custom component "<name>" not found in registry`. Do not throw; the rest of the dashboard must continue rendering.

Pseudocode:

```jsx
const CustomComponentWidget = ({ item }) => {
  const Component = REGISTRY[item.component];
  if (!Component) {
    console.warn(`[CustomComponentWidget] Unknown component: "${item.component}" (id: ${item.id})`);
    return <Alert type="warning" message={`Custom component "${item.component}" not found`} />;
  }
  return <Component />;
};
```

Note: `REGISTRY` here is the imported `* as customComponents` namespace from `custom-components/index.js`.

### `DashboardRenderer.jsx` change

Add a single dispatch branch in `renderWidget` ([DashboardRenderer.jsx:104](../../../frontend/src/components/dashboard/DashboardRenderer.jsx#L104)):

```jsx
if (type === "custom_component") {
  return <CustomComponentWidget item={item} />;
}
```

Placed before the unknown-type fallback. No other changes to renderer logic — the custom component slots into the existing `<Col span={col_span ?? 24}>` wrapper.

### Component-side responsibilities

The custom component is fully responsible for:

- **Data fetching** — uses existing axios/util hooks or `axios` directly.
- **Auth-aware errors** — handles 401/403 from authenticated endpoints.
- **Loading / empty / error states** — renders its own `<Skeleton>`, `<Empty>`, `<Alert>` as needed.
- **Internal state** — selection, filters, drill-downs all live inside the component.
- **Internal layout** — the component receives one `<Col span={col_span ?? 24}>` and lays out its interior however it wants.
- **Internal tests** — colocated `.test.jsx` next to the component.

The dashboard renderer does **not**:

- Pass `filterState`, `definitionsById`, `parentFormId`, `globalFilters`, or any other context.
- Wrap the component in a `<Card>`, error boundary, or loading skeleton.
- Re-render the component when global filters change.

If a future component needs context from the dashboard, the right move is to add a single, well-named prop at that time — not to design a speculative props contract now.

---

## Auth Gating Flow

### Source of truth

`UIState.isLoggedIn` from [`frontend/src/lib/store.js`](../../../frontend/src/lib/store.js) (Pullstate store).

### Where the check lives

[`TabsWidget.jsx`](../../../frontend/src/components/dashboard/widgets/TabsWidget.jsx) is modified to:

1. Subscribe to `UIState.isLoggedIn` via `UIState.useState((s) => s.isLoggedIn)`.
2. When constructing `tabItems`, set `disabled: pane.is_public === false && !isLoggedIn` on the AntD `<Tabs>` item.
3. The default-active key falls through to the first **non-disabled** tab so anonymous viewers don't land on a disabled tab on first paint.

Pseudocode:

```jsx
const isLoggedIn = UIState.useState((s) => s.isLoggedIn);

const tabItems = panes.map((pane) => ({
  key: pane.id,
  label: pane.label,
  disabled: pane.is_public === false && !isLoggedIn,
  children: <div>{renderItems(pane.items || [])}</div>,
}));

const firstEnabled = panes.find((p) => !(p.is_public === false && !isLoggedIn));
```

### Anonymous-safety guarantee

Because `<Tabs destroyInactiveTabPane>` is already in use, an inactive tab's children are **not mounted**, so the custom component does not run, does not fetch, and does not appear in the DOM. The disabled flag prevents the user from activating it. Combined: anonymous viewers cannot trigger the authenticated component's network calls via this UI path.

This is the entire auth-gating mechanism. There is no server-side stripping of config, no separate route, no permission system integration. If a stronger guarantee is ever needed (e.g., the dashboard JSON itself contains sensitive endpoint paths), that's a future concern.

### Direct-URL behavior

The dashboard route `/dashboard/:slug` doesn't currently support `?tab=<id>` deep-linking. The disabled-tab mechanism is sufficient because there is no anonymous URL that lands directly on the `is_public: false` tab. If deep-linking is added later, the same `is_public + isLoggedIn` check would gate URL-driven tab activation.

---

## Sequence: Anonymous viewer loads dashboard

```
User → /dashboard/eps-overview (anonymous)
  ↓
useDashboardConfig loads JSON, returns items unchanged
  ↓
DashboardRenderer walks items, dispatches `tabs` → TabsWidget
  ↓
TabsWidget reads UIState.isLoggedIn = false
  ↓
For tab_individual_overview (is_public: false):
  → tabItem.disabled = true
  ↓
defaultActiveKey resolves to first non-disabled pane (tab_monitoring_overview)
  ↓
AntD Tabs renders 4 tabs; "Individual Overview" greyed out and unclickable
  ↓
destroyInactiveTabPane = true → IndividualEPSOverview never mounts
```

## Sequence: Logged-in viewer activates Individual Overview

```
User → /dashboard/eps-overview (logged in)
  ↓
TabsWidget: tabItem.disabled = false, all 4 tabs clickable
  ↓
User clicks "Individual Overview"
  ↓
TabsWidget renders pane via renderItems(pane.items)
  ↓
DashboardRenderer dispatches custom_component → CustomComponentWidget
  ↓
CustomComponentWidget looks up "IndividualEPSOverview" in REGISTRY
  ↓
Component mounts, owns its own location/EPS selection, fetches authenticated APIs
  ↓
On tab change away → destroyInactiveTabPane unmounts component, frees state
```

---

## File Touch List

### New files

| Path | Purpose |
|---|---|
| `frontend/src/components/dashboard/widgets/CustomComponentWidget.jsx` | Registry lookup + render or warn |
| `frontend/src/components/dashboard/widgets/__test__/CustomComponentWidget.test.jsx` | Smoke test: known name renders, unknown name warns |

### Modified files

| Path | Change |
|---|---|
| `frontend/src/components/dashboard/DashboardRenderer.jsx` | Add `custom_component` dispatch branch + import |
| `frontend/src/components/dashboard/widgets/TabsWidget.jsx` | Read `isLoggedIn`, set `disabled` on `is_public: false` panes, choose first-enabled default |
| `frontend/src/config/visualizations/README.md` | Document the new chart_type, the `is_public` flag, and the "when to use the escape hatch" guidance |

### Already in place (no change needed)

| Path | Notes |
|---|---|
| `frontend/src/components/dashboard/custom-components/index.js` | Registry already wired with `IndividualEPSOverview` |
| `frontend/src/components/dashboard/custom-components/IndividualEPSOverview.jsx` | Component already authored; managed separately from this design |

---

## README Updates (specification)

Apply these diffs to [`frontend/src/config/visualizations/README.md`](../../../frontend/src/config/visualizations/README.md):

### 1. `chart_type` catalogue — append a row

```
| `custom_component` | Arbitrary React component from the custom-components registry | `component` (string, registry key) |
```

### 2. Tab pane shape — add `is_public` note

Under the existing "Tab pane shape" section, append:

> **`is_public`** (optional, defaults `true`) — when set to `false`, the tab is rendered **disabled** for anonymous viewers and only becomes clickable for users with `UIState.isLoggedIn === true`. Use this for tabs whose children fetch authenticated endpoints.

### 3. New section: "Custom component escape hatch"

Insert a new top-level section between "Chart data-source modes" and "Filter hints", roughly:

> ## Custom component escape hatch
>
> Some dashboard tabs follow a record-centric pattern that doesn't fit the aggregate
> chart paradigm — the user picks one record and downstream widgets render details
> for that record. Rather than extending the JSON schema with primitives that only
> make sense for these tabs (`dependencies`, token templates, custom endpoints,
> render registries), use the `custom_component` chart_type to delegate rendering
> to a React component.
>
> ### When to reach for it
>
> - The interaction model is **record-centric**, not aggregate.
> - The tab needs internal state that isn't expressible as a global filter.
> - The behavior is unique enough that no other dashboard would reuse it.
>
> ### When NOT to reach for it
>
> - The widget can be expressed as `card` / `bar` / `doughnut` / `table` etc. with
>   an `api` block — extend the existing schema instead.
> - Two or three other dashboards would benefit from the same widget — promote
>   it to a first-class `chart_type` rather than copying components.
>
> ### Adding a custom component
>
> 1. Create `frontend/src/components/dashboard/custom-components/<Name>.jsx`.
> 2. Add a named export in `custom-components/index.js`.
> 3. Reference it in JSON:
>
> ```json
> {
>   "id": "individual_overview_component",
>   "chart_type": "custom_component",
>   "order": 1,
>   "component": "<Name>"
> }
> ```
>
> ### What the component owns
>
> - Data fetching, including auth-aware error handling.
> - Loading, empty, and error UI states.
> - Internal selection state, drill-downs, sub-tabs.
> - Any internal filters (the dashboard's global filter bar is not piped in).
>
> ### Stay specific until rule-of-three
>
> Don't generalize prematurely. The first per-dashboard custom component is fine
> as a one-off. When a third dashboard needs a similar pattern, refactor the
> common pieces into shared building-block components (`<RecordSelectorBar>`,
> `<RegistrationDetailTable>`, etc.) — not into a single mega-component
> driven by yet another schema.

### 4. Related components — append

```
- [`widgets/CustomComponentWidget`](../../components/dashboard/widgets/CustomComponentWidget.jsx) — registry-backed escape hatch
```

---

## Test Specification

### `CustomComponentWidget.test.jsx`

Two cases sufficient for the dispatcher:

| Case | Expectation |
|---|---|
| Known component name | The named component renders (assert by data-testid or text) |
| Unknown component name | Renders `<Alert>` with "not found" copy; no throw; `console.warn` called |

### `TabsWidget` modification

Add to existing `TabsWidget.test.jsx` (or create one if missing):

| Case | Expectation |
|---|---|
| `is_public: false` pane + `isLoggedIn = false` | Tab item rendered with `disabled=true`; `defaultActiveKey` is first non-disabled pane |
| `is_public: false` pane + `isLoggedIn = true` | Tab item not disabled; behaves identically to public panes |
| All `is_public` true (or omitted) | No behavioral change vs current implementation |

### `IndividualEPSOverview` tests

Live with the component itself, not in scope of this design. Out-of-band per FR-3 (component owns its own testing).

### Manual smoke test

1. `./dc.sh up -d` and load `/dashboard/eps-overview` while logged out.
2. Verify the four tabs render and "Individual Overview" is greyed out / unclickable.
3. Log in, reload the dashboard.
4. Click "Individual Overview" — the component mounts and runs.
5. Click another tab and back — `destroyInactiveTabPane` should remount the component cleanly.

---

## Backwards Compatibility

- All existing dashboards have no `is_public` set on any tab — defaults to `true`, behavior unchanged.
- All existing dashboards have no `custom_component` items — the new dispatch branch is never hit.
- The registry export shape (`export { Name }`) is additive; removing a component requires removing its JSON references in lockstep.

No migration of existing config files is required.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `custom-components/` becomes a dumping ground over time | Medium | Medium | README documents "when NOT to use" + rule-of-three guidance |
| Components silently break if registry export is removed but JSON still references it | Low | Low | `console.warn` + `<Alert>` fallback; future work could add config-load-time validation |
| A custom component leaks into anonymous view via a future router change (deep-link to tab) | Low | Medium | Auth check is centralized in `TabsWidget`; same check would be reused for any deep-link feature |
| Over-coupling: a custom component imports too many app internals and becomes hard to move | Medium | Low | Keep components scoped; revisit at rule-of-three refactor |

---

## Out of Scope (Explicit Deferrals)

These were considered during the brainstorm and intentionally not designed:

- Token-substitution DSL (`{{filter.x.data.y}}`).
- `dependencies: [{id}]` for component-level prerequisite gating.
- `endpoint` + `params` blocks under `api` for arbitrary REST calls.
- `fieldNames` mapping for AntD Select payload shaping.
- `dataSource` + `render` for table-driven pivot views.
- A new `conditional` chart_type.
- A new `progress` chart_type.
- A generic "individual overview" component.
- Per-role permission gating beyond binary login state.
- Server-side stripping of `is_public: false` items from the config payload.
- Deep-link query-param tab activation.

Each of these can be revisited if and when a real, recurring need appears. Today they would be premature.

---

## Next Step

Approved design → implement per the file touch list above. The change is small enough that PR review covers any remaining design adjustments inline.

Suggested PR title: `[#196] feat(dashboard): add custom_component chart_type and is_public tab gating`

To start implementation: `/sc:implement` referencing this document.
