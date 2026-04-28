# Implementation Plan — `custom_component` Escape Hatch

Sequenced, checklisted tasks ready for execution. Companion to [design.md](./dashboard-custom-component-design.md). Read the design first — this doc is the *how* and *in what order*; design.md is the *what* and *why*.

**Branch**: `feature/196-visualization-individual-overview`
**Issue**: #196

---

## Pre-flight

- [ ] Confirm working directory is on `feature/196-visualization-individual-overview`
- [ ] Pull latest from origin to ensure no upstream changes since the design was approved
- [ ] Run `./dc.sh up -d` so the stack is reachable for manual verification later
- [ ] Open [`1749623934933.json`](../../../frontend/src/config/visualizations/1749623934933.json) — confirm the simplified `tab_individual_overview` already references `chart_type: "custom_component"` with `component: "IndividualEPSOverview"` (lines ~1045–1057)

---

## Phase 1 — Renderer dispatch (the new chart_type)

Goal: the dashboard renderer recognizes `custom_component`, looks up the React component from the registry, and renders it (or a "not found" alert).

- [ ] **Create** [`frontend/src/components/dashboard/widgets/CustomComponentWidget.jsx`](../../../frontend/src/components/dashboard/widgets/CustomComponentWidget.jsx)
  - Import `* as registry` from `../custom-components`
  - Component receives `{ item }` props
  - Resolve `registry[item.component]`
  - If found → render `<Component />` (no extra props per design FR-4)
  - If missing → `console.warn` with item id + name; render `<Alert type="warning" message="Custom component \"<name>\" not found" />`
  - PropTypes for `item` (shape: `{ id, component }`)

- [ ] **Modify** [`DashboardRenderer.jsx`](../../../frontend/src/components/dashboard/DashboardRenderer.jsx)
  - Import `CustomComponentWidget`
  - Add dispatch branch in `renderWidget` *before* the unknown-type fallback at [line ~196](../../../frontend/src/components/dashboard/DashboardRenderer.jsx#L196):
    ```jsx
    if (type === "custom_component") {
      return <CustomComponentWidget item={item} />;
    }
    ```

- [ ] **Verify (smoke)**: load `/dashboard/eps-overview` while logged in, click "Individual Overview" tab. The existing `IndividualEPSOverview` component should mount and render. No console errors.

---

## Phase 2 — Auth gating on tab panes

Goal: `is_public: false` panes render disabled when `UIState.isLoggedIn` is false; default-active tab skips disabled panes; component never mounts under destroyInactiveTabPane semantics.

- [ ] **Modify** [`TabsWidget.jsx`](../../../frontend/src/components/dashboard/widgets/TabsWidget.jsx)
  - Import `UIState` from `../../../lib/store`
  - Inside the component: `const isLoggedIn = UIState.useState((s) => s.isLoggedIn);`
  - When mapping panes, add `disabled: pane.is_public === false && !isLoggedIn` to each `tabItem`
  - Compute `firstEnabledKey = panes.find((p) => !(p.is_public === false && !isLoggedIn))?.id`
  - Pass `firstEnabledKey` (instead of `panes[0]?.id`) to `defaultActiveKey`
  - Update PropTypes shape on pane to include optional `is_public: PropTypes.bool`

- [ ] **Verify (manual, anonymous)**: log out, reload `/dashboard/eps-overview`. Confirm "Individual Overview" tab is greyed out and unclickable. Confirm initial active tab is "Monitoring overview" (not "Individual Overview"). Open DevTools Network — confirm no requests fired by `IndividualEPSOverview`.

- [ ] **Verify (manual, signed-in)**: log in, reload. Confirm "Individual Overview" tab is clickable and the component mounts on click.

---

## Phase 3 — Tests

Goal: enough automated coverage that the dispatch + gating behavior cannot silently regress.

- [ ] **Create** `frontend/src/components/dashboard/widgets/__test__/CustomComponentWidget.test.jsx`
  - Test 1: known component name renders (mock the registry import; assert rendered output)
  - Test 2: unknown component name renders Alert + calls `console.warn`; does not throw

- [ ] **Create or extend** `frontend/src/components/dashboard/widgets/__test__/TabsWidget.test.jsx`
  - Test 1: pane with `is_public: false` + `isLoggedIn: false` → tab item rendered with `disabled: true`; default active is the first non-disabled pane
  - Test 2: pane with `is_public: false` + `isLoggedIn: true` → not disabled
  - Test 3: panes with no `is_public` field → behavior unchanged from current
  - Use Pullstate test helpers to seed `UIState`; reset between tests

- [ ] Run `cd frontend && npm test -- --watchAll=false` — confirm all green

---

## Phase 4 — Documentation

Goal: future maintainers find the escape hatch from the visualization README and understand when (and when not) to reach for it.

- [ ] **Modify** [`frontend/src/config/visualizations/README.md`](../../../frontend/src/config/visualizations/README.md) per the four diffs in [design.md "README Updates"](./dashboard-custom-component-design.md#readme-updates-specification):
  - [ ] Append `custom_component` row to the chart_type catalogue
  - [ ] Add `is_public` note under "Tab pane shape"
  - [ ] Insert new top-level section "Custom component escape hatch" between "Chart data-source modes" and "Filter hints"
  - [ ] Append `CustomComponentWidget` to "Related components"

---

## Phase 5 — Verification

- [ ] `cd frontend && npm run lint` — no new warnings
- [ ] `cd frontend && npm run prettier` — formatting clean
- [ ] `./dc.sh exec -T frontend npx eslint src/components/dashboard/widgets/CustomComponentWidget.jsx src/components/dashboard/widgets/TabsWidget.jsx src/components/dashboard/DashboardRenderer.jsx` — zero errors (this enforces the project's `curly`, `no-undefined`, `prefer-arrow-callback` rules)
- [ ] `cd frontend && npm test -- --watchAll=false` — all green
- [ ] Manual smoke (anonymous + signed-in) per Phase 2/3 verification steps

---

## Phase 6 — Commit & PR

- [ ] `git status` — confirm only the expected files changed
- [ ] `git diff` — re-skim each diff
- [ ] Commit message format per project convention:
  ```
  [#196] feat(dashboard): add custom_component chart_type and is_public tab gating

  - Add CustomComponentWidget for registry-backed React component rendering
  - Add is_public flag on tab panes that disables tabs for anonymous viewers
  - Wire dispatch in DashboardRenderer; auth check in TabsWidget via UIState
  - Document the escape hatch and when to use it in the visualizations README
  - Tests for dispatcher (known/unknown name) and tab gating (logged-in/out)

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
- [ ] **Wait for user confirmation before push** (per project convention — do not auto-push)
- [ ] After confirmation: push and open PR titled `[#196] feat(dashboard): add custom_component chart_type and is_public tab gating`

---

## Out of scope for this PR (do not bundle)

These belong in separate follow-up work, not in this implementation:

- Any logic *inside* `IndividualEPSOverview.jsx` itself (managed separately per design FR-3)
- Any new custom components for RWS / WTP / WWTP dashboards
- A generic / shared individual-overview component
- Server-side config stripping based on `is_public`
- Deep-link tab activation via URL query param
- Schema-load-time validation of registry references
- Refactoring shared building blocks (defer until rule-of-three)

If you find yourself touching any of the above while implementing, stop and split it into a follow-up issue.

---

## Rollback plan

The change is additive: a new chart_type and a new optional flag. To rollback:

1. Revert the commits.
2. The existing JSON config still works because `tab_individual_overview` was already in the file but the `custom_component` dispatch wouldn't match — `DashboardRenderer` would log "Unknown chart_type" and render nothing for that tab. **Preferred**: also revert the JSON to remove the `custom_component` entry, or temporarily replace the tab with a section_title placeholder.

No database migrations, no API changes, no shared-component changes outside the dashboard subtree.
