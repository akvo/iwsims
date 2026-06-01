# Implementation Plan — Draft Submissions Scope

## Phases

### Phase 1: Pending Data List (Approver Visibility)

**Goal**: Approvers at same or higher administration can see pending submissions.

**Files changed**:
- `backend/api/v1/v1_data/views.py` — `PendingDataListView`

**Approach**: Added `Q` filter combining exact-admin and subtree-path matches for users with `DataAccessTypes.approve` roles.

**Tests**:
- `backend/api/v1/v1_data/tests/tests_pending_data_approval_filter.py` (new)

---

### Phase 2: Draft List Scope (Submit Access)

**Goal**: Supervisors with submit access see drafts from within their subtree, including drafts at null administration or drafts created by users whose role administration is within scope.

**Files changed**:
- `backend/api/v1/v1_data/views.py` — `DraftFormDataListView.get` + new `_build_draft_scope_filter` helper

**Key design decisions**:
- Extract reusable `_build_draft_scope_filter(user, access_type)` helper
- Creator-scope fallback: traverse `created_by__user_user_role__administration__pk__in`
- `.distinct()` mandatory to avoid duplicates from multi-role joins
- Administration filter includes `Q(administration__isnull=True)` so null-admin drafts are included

**Tests**:
- `backend/api/v1/v1_data/tests/tests_draft_data_submit_filter.py` (extended with scenarios 7–9)

---

### Phase 3: Draft Detail Scope (GET/PUT)

**Goal**: Supervisors in scope can access draft detail and edit it. Out-of-scope returns 404.

**Files changed**:
- `backend/api/v1/v1_data/views.py` — `DraftFormDataDetailView.get` and `.put`

**Key design decisions**:
- Use `get_object_or_404` on the pre-filtered queryset (same `_build_draft_scope_filter`)
- 404 (not 403) for out-of-scope — hides existence of records from unauthorized users

**Tests**:
- `backend/api/v1/v1_data/tests/tests_draft_detail_scope.py` (new, 4 scenarios)

---

### Phase 4: Draft Delete Scope

**Goal**: Owner and users with delete access in scope can delete; approvers and out-of-scope users get 403.

**Files changed**:
- `backend/api/v1/v1_data/views.py` — `DraftFormDataDetailView.delete`
- `backend/api/v1/v1_data/tests/tests_delete_draft_data.py` — updated `test_delete_draft_form_data_forbidden` (IS_ADMIN → IS_APPROVER)

**Key design decisions**:
- Two-step check: existence check (404) then scope check (403)
- Reuse `_build_draft_scope_filter(user, DataAccessTypes.delete)`

**Tests**:
- `backend/api/v1/v1_data/tests/tests_draft_delete_scope.py` (new, 5 scenarios)

---

### Phase 5: `can_delete` Serializer Field

**Goal**: Frontend receives a boolean `can_delete` per record to conditionally render the Delete button.

**Files changed**:
- `backend/api/v1/v1_data/serializers.py` — `ListFormDataSerializer`
  - Added `from api.v1.v1_profile.constants import DataAccessTypes`
  - Added `can_delete = serializers.SerializerMethodField()`
  - Added `get_can_delete` method using request context
  - Added `"can_delete"` to `Meta.fields`
- `backend/api/v1/v1_data/views.py` — both callers of `ListFormDataSerializer` now pass `context={"request": request}`

---

### Phase 6: Batch Creation by Approver

**Goal**: Approvers can create batches from pending data within their scope.

**Files changed**:
- `backend/api/v1/v1_approval/serializers.py` — `CreateBatchSerializer`
- `backend/api/v1/v1_approval/views.py` — `BatchView`

**Tests**:
- `backend/api/v1/v1_approval/tests/tests_create_batch_by_approver.py` (new)

---

### Phase 7: Batch LCA Administration

**Goal**: Batch administration = Lowest Common Ancestor of all included data administrations.

**Files changed**:
- `backend/api/v1/v1_approval/serializers.py` — `CreateBatchSerializer` (LCA logic)

---

### Phase 8: Frontend Delete Button

**Goal**: Show Delete button in draft detail only when `record.can_delete === true`.

**Files changed**:
- `frontend/src/pages/manage-draft/DraftDetail.jsx`

**Change**: Wrapped Delete button in `{record?.can_delete && (...)}`.

---

## Test Summary

| File | Scenarios | Status |
|------|-----------|--------|
| `tests_pending_data_approval_filter.py` | Approver visibility | ✅ |
| `tests_draft_data_submit_filter.py` | 9 scenarios (creator, supervisor, null admin, creator-scope) | ✅ |
| `tests_draft_detail_scope.py` | 4 scenarios (creator 200, supervisor 200, out-of-scope 404, creator-scope 200) | ✅ |
| `tests_draft_delete_scope.py` | 5 scenarios (owner 204, supervisor 204, upper 204, approver 403, sibling 403) | ✅ |
| `tests_delete_draft_data.py` | Updated forbidden test (IS_ADMIN → IS_APPROVER) | ✅ |
| `tests_create_batch_by_approver.py` | Approver batch creation | ✅ |

## Deployment Notes

- No database migrations required (`administration` was already nullable on `FormData`)
- The `_build_draft_scope_filter` helper runs up to 2 extra DB queries per request (for `scope_admin_pks`); this is acceptable given the scope of the feature
- All changes are backward-compatible for superuser and creator access paths
