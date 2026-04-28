# Individual Overview — SDD

Software Design Document for the **Individual Overview** record-centric tab pattern used by both the EPS dashboard ([`/dashboard/eps-overview`](../../../frontend/src/config/visualizations/1749623934933.json)) and the RWS dashboard ([`/dashboard/rws-overview`](../../../frontend/src/config/visualizations/1749621221728.json)).

**Status**: Design approved, implementation pending.
**Branch**: `feature/196-visualization-individual-overview`
**Issue**: #196
**Builds on**: [`dashboard-custom-component/`](../dashboard-custom-component/) — defines the `custom_component` escape-hatch this pattern plugs into.

---

## Documents in this folder

| Document | Purpose | Audience |
|---|---|---|
| [design.md](./design.md) | Architecture, primitive interfaces, sequence diagrams, edge-case behaviour, risk register, explicit out-of-scope list | Reviewer approving the design; implementer needing the *what* and *why* |
| [implementation-plan.md](./implementation-plan.md) | Sequenced, checklisted task breakdown with question-ID reference tables ready to execute | Implementer driving the PR; reviewer tracking progress |

---

## TL;DR

- Both EPS and RWS dashboards need a record-centric "Individual Overview" tab where the user picks one EPS / RWS site, then downstream widgets render details for that single record.
- Built as React components delegated via the `custom_component` escape-hatch — the JSON-driven aggregate dashboard schema stays unchanged.
- Six small primitives in `custom-components/shared/` are reused across both shells (≥4× each); shell-specific bits (project-scope rows, qid lists, project-type formulas, badges, stats card) stay per-dashboard per the [escape-hatch SDD](../dashboard-custom-component/dashboard-custom-component-design.md)'s "rule of three until ≥3 working examples."
- Result: each shell is ~180–220 lines of composition; future "Individual X Overview" tabs are also small.

---

## Decisions locked from brainstorm + RWS scope expansion

| Decision | Value | Rationale |
|---|---|---|
| Composition style | One shell per dashboard, composing shared primitives | Avoids the DSL trap the escape-hatch SDD warned against |
| Primitive extraction | Six primitives (helpers + 3 React + 2 hooks) extracted from day 1 | Each appears ≥4× across the two designs — past the rule-of-two threshold |
| RWS scope | Included in this PR | Two designs in hand; primitives benefit from being designed against both |
| RWS slug | `rws-overview` | Mirrors `eps-overview`; easy to type |
| RWS monitoring forms | `1749621962296` (comprehensive) **plus** `1749631041125` (quick) | Comprehensive covers most fields; quick form provides 5 fields not in the comprehensive form (operational status, contact persons, phone, water-committee training, photo description) |
| RWS project-type progress formula | **Deferred** to a follow-up PR | Per-project-type math (SWP=÷7, BH=÷8, D=÷8, RH=÷4) is its own surface |
| RWS WSMP monitor sub-tab | Placeholder `<Empty>` — content TBD | Mockup not provided yet |
| Lab/CBT chart history | Client-side N+1 via `useMonitoringHistory` | `/visualization/values` cannot filter to one parent_uuid; backend endpoint deferred |

---

## Out of scope (explicitly deferred)

- RWS project-type-aware progress formula
- RWS WSMP monitor sub-tab content
- Editing capabilities on photos / tables (read-only view)
- Linking back to underlying datapoint detail page
- Photo lightbox (AntD `<Image>` default zoom is enough)
- Localised strings
- URL state for selected datapoint
- Backend endpoint for per-record monitoring history (current N+1 acceptable)

---

## Workflow

1. **Brainstorm** (done) — captured in [design.md](./design.md) "Goals & Non-Goals"
2. **Design** (done) — see [design.md](./design.md)
3. **Implementation** — follow [implementation-plan.md](./implementation-plan.md)
4. **Verification** — manual smoke + Jest (in design.md "Test Specification")
5. **PR** — six sequential commits with `[#196]` prefix per implementation-plan Phase 7
