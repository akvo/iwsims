# "No information available" bucket — SDD

Software Design Document for adding an opt-in `_no_info` bucket to `/api/v1/visualization/values` so dashboards can reconcile per-option totals with their parent-registration total when monitoring data is incomplete.

**Status**: Requirements + design approved (brainstorm). Implementation pending.
**Branch**: TBD (suggest `feature/<issue>-no-info-bucket`)
**Issue**: TBD (file via `bd create`)
**Touches**: [`backend/api/v1/v1_visualization/`](../../../backend/api/v1/v1_visualization/), [`frontend/src/components/dashboard/`](../../../frontend/src/components/dashboard/), [`frontend/src/lib/ui-text.js`](../../../frontend/src/lib/ui-text.js), [`frontend/src/config/visualizations/`](../../../frontend/src/config/visualizations/)

---

## Documents in this folder

| Document | Purpose | Audience |
|---|---|---|
| [requirements.md](./requirements.md) | Locked functional / non-functional requirements, scope matrix, explicit out-of-scope list | Reviewer approving the spec; PM / stakeholder |
| [design.md](./design.md) | Backend SQL plan, API contract, frontend wiring, edge cases, test matrix, mermaid sequence diagrams | Implementer needing the *what* and *why*; reviewer auditing the change |
| [implementation-plan.md](./implementation-plan.md) | Sequenced, checklisted task breakdown with file paths, line-number anchors, commit messages, rollback recipe | Implementer driving the PR; reviewer tracking progress |

---

## Problem in one sentence

When a dashboard's KPI tile says "104 EPS registered" but the donut chart of operational status sums to 80, the missing 24 disappear silently — instead they should show as a gray "No information available" slice so the totals reconcile and the data-quality gap is visible to operators.

## TL;DR

- Add an **opt-in** query param `include_unanswered=true` to `/api/v1/visualization/values`.
- When set, the response gains one synthetic row: `{ value, label: "No information available", group: "_no_info", color: "#bfbfbf" }`.
- The synthetic row's `value` is the count of **distinct parent registrations** that have no qualifying answer for the question, after applying the same filters as the rest of the response.
- Multiple-option questions cannot derive the bucket by subtraction (a record may answer multiple options) — it's computed as `count(distinct parents with no qualifying answer)`.
- `value_type=percentage` includes the bucket in the denominator so the response sums to 100%.
- Frontend translates the label via the existing [`ui-text.js`](../../../frontend/src/lib/ui-text.js) map (new key `noInformationAvailable`).
- Map widget gains opt-in `status_colors._no_info` so un-monitored markers can be colored gray with a legend entry.
- Default behavior unchanged everywhere — no surprise visual changes for existing dashboards.

---

## Decisions locked from brainstorm

| Decision | Value | Rationale |
|---|---|---|
| Trigger model | Opt-in flag `include_unanswered=true` | Existing consumers (`stack_bar cross_tab`, `kpi_stack`, `share_card`) do their own arithmetic; an unconditional extra row would break them |
| Param name | `include_unanswered` | Reads as a boolean modifier; future-proof for an `unanswered_split` follow-up |
| Group key | `"_no_info"` | Underscore prefix unambiguously synthetic; cannot collide with a real `QuestionOptions.value` (slug-cased); a single key works for donut, stack_bar, and map |
| Default color | `"#bfbfbf"` | Sensible neutral gray; dashboards override via existing chart-level color array or `status_colors._no_info` |
| Multiple-option semantics | `count(distinct parents with no qualifying answer)`, never `total − sum` | One record can answer multiple options, so subtraction over-counts the gap |
| Soft-deleted parents | Excluded | Use `FormData.objects` (not `objects_deleted`); matches default behavior of the rest of the visualization API |
| `value_type=percentage` | Bucket joins denominator, all rows sum to 100% | Keeps percentages internally consistent; the gap shows as its own percentage slice |
| `share_card` denominator | Becomes "all parents" when `include_unanswered=true` | Matches the intuitive reading of "operational EPS share" — share of *all EPS*, not *monitored EPS* |
| Map default | Un-monitored EPS stay uncolored unless `status_colors._no_info` is set | Opt-in everywhere; no silent visual changes |
| Translation surface | Add `noInformationAvailable` key to existing [`ui-text.js`](../../../frontend/src/lib/ui-text.js) Charts block | Matches the established i18n surface; ready for `de` and future locales |

---

## Out of scope (explicitly deferred)

- Splitting "never monitored" vs "answered-but-blank" into two distinct buckets — collapsed to one in v1.
- KPI scalar cards (`option_value` mode) — already covered by `denominator_api` ratio cards.
- `stack_by=option` / `group_by=parent_id` — per-parent rows make the gap implicit already.
- Auto-coloring un-monitored map markers without explicit `status_colors._no_info` — opt-in only.
- Introducing a new i18n framework — reuse existing `uiText` map.
- Backend changes to count-mode (no `question_id`) endpoints — out of scope; the gap doesn't apply when there's no per-option breakdown.

---

## Workflow

1. **Brainstorm** (done) — captured in this folder.
2. **Requirements** (done) — see [requirements.md](./requirements.md).
3. **Design** (done) — see [design.md](./design.md).
4. **Implementation** — follow the phased, checklisted plan in [implementation-plan.md](./implementation-plan.md).
5. **Verification** — backend tests + manual donut/map smoke per [design.md "Test Plan"](./design.md#test-plan) and [implementation-plan.md "Phase 4.3"](./implementation-plan.md#43-manual-smoke).
6. **PR** — single PR with `[#<issue>]` prefix; flip dashboards on in the same PR so the visible fix lands together with the API change.
