# Dashboard `custom_component` Escape Hatch — SDD

Software Design Document for the `custom_component` chart_type and `is_public` tab-pane flag, introduced to support the **Individual Overview** tab on the EPS dashboard (and analogous record-centric tabs on future dashboards).

**Status**: Design approved, implementation pending.
**Branch**: `feature/196-visualization-individual-overview`
**Issue**: #196

---

## Documents in this folder

| Document | Purpose | Audience |
|---|---|---|
| [design.md](./dashboard-custom-component-design.md) | Schema additions, component design, auth gating flow, sequence diagrams, README update spec, test specification, risks, explicit out-of-scope list | Reviewers approving the design; implementer needing the *what* and *why* |
| [implementation-plan.md](./implementation-plan.md) | Sequenced, checklisted task breakdown ready to execute | Implementer driving the PR; reviewer tracking progress |

---

## TL;DR

- All other dashboard tabs are **aggregate** (one API call per chart, global filters, counts/distributions over the whole population).
- The Individual Overview tab is **record-centric** — user picks one EPS, downstream widgets render that single record.
- Bolting record-centric primitives onto the JSON schema (token DSL, `dependencies`, `endpoint`, `fieldNames`, `dataSource`, `render`) would double the schema surface and re-introduce a mini-DSL inside JSON.
- Instead: a tiny escape hatch — `chart_type: "custom_component"` plus `is_public: false` — that delegates the whole tab to a React component the developer freely authors.
- The custom component owns its data fetching, state, loading/error UI. The dashboard renderer stays out of its way.
- `is_public: false` disables (not hides) the tab for anonymous viewers; `destroyInactiveTabPane` ensures the component never mounts or fetches.
- Stay specific until rule-of-three. Generic "individual overview" deferred until ≥3 working examples.

---

## Decisions locked during brainstorm

| Decision | Value | Rationale |
|---|---|---|
| Registry style | Explicit named-export map in `custom-components/index.js` | Tree-shakeable, grep-friendly, no surprises |
| Naming convention | Free-form | Avoid bikeshedding; `IndividualEPSOverview` / `RWSDetailPanel` etc. |
| Auth source | `UIState.isLoggedIn` from `frontend/src/lib/store.js` | Existing Pullstate; no new auth machinery |
| Anonymous UX | Tab disabled (visible, not clickable) | Communicates that authenticated functionality exists; avoids misleading anonymous viewers |
| Generic component | Deferred — rule of three | Premature abstraction would re-grow the DSL we just escaped |
| Loading/error states | Component's responsibility | Keeps the escape hatch escape-hatch-shaped |
| Props contract | Minimum (component name only) | Add props when a real second consumer needs them |

---

## Out of scope (explicitly deferred)

These were considered during the brainstorm and intentionally not designed. Each can be revisited if a real recurring need appears:

- Token-substitution DSL (`{{filter.x.data.y}}`)
- `dependencies: [{id}]` for component-level prerequisite gating
- `endpoint` + `params` blocks for arbitrary REST calls in JSON
- `fieldNames` mapping for AntD Select payload shaping
- `dataSource` + `render` for table-driven pivot views
- New `conditional` / `progress` chart types
- Generic shared "individual overview" component
- Per-role permission gating beyond binary login state
- Server-side stripping of `is_public: false` items from the config payload
- Deep-link query-param tab activation

---

## Workflow

1. **Brainstorm** (done, captured in design.md Goals/Non-Goals + Out of Scope)
2. **Design** (done — see [design.md](./dashboard-custom-component-design.md))
3. **Implementation** — follow [implementation-plan.md](./implementation-plan.md)
4. **Verification** — manual smoke + Jest (defined in design.md "Test Specification")
5. **PR** — title pattern `[#196] feat(dashboard): add custom_component chart_type and is_public tab gating`
