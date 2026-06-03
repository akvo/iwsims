# Requirements — Draft Submissions Scope

## Context

Feature #10 addresses a gap in the submission visibility model: supervisors and approvers could not see draft or pending submissions created by users beneath them in the administration hierarchy. This blocked batch creation workflows and general oversight.

## Actors

| Actor | Role Level | Access Rights |
|-------|-----------|---------------|
| Submitter | IS_ADMIN / IS_SUBMITTER | Submit, edit, delete own drafts |
| Supervisor | IS_ADMIN at higher admin level | Submit access; delete access |
| Approver | IS_APPROVER | Approve access only; no delete |
| Super Admin | Superuser flag | Full access to all records |

## Functional Requirements

### FR-1: Draft List Visibility

A user must be able to see a draft submission in `GET /api/v1/draft-submission/` if ANY of the following conditions is true:

1. The user created the draft (`created_by == user`)
2. The draft's administration is within the user's role subtree AND the user has submit access (`DataAccessTypes.submit`)
3. The draft has no administration yet (nullable) AND the user has submit access at any level
4. The **creator's** role administration falls within the user's scope — supporting drafts submitted at an ancestor level (e.g. national)

### FR-2: Draft Detail Access (GET/PUT)

- A user who meets any condition in FR-1 for a specific draft may access `GET /api/v1/draft-submission/{id}/` and `PUT /api/v1/draft-submission/{id}/`.
- A user outside scope receives **404 Not Found** (not 403 — the record is invisible, not forbidden).

### FR-3: Draft Delete Access (DELETE)

- The draft creator (owner) can always delete their own draft.
- A user with `DataAccessTypes.delete` access at the same or higher administration level as the draft may delete it.
- A user with only approve access (`IS_APPROVER`) cannot delete any draft they did not create.
- A user with delete access but outside the draft's scope cannot delete it.
- Out-of-scope delete attempts return **403 Forbidden** (record is known to exist — this is an authorization failure).

### FR-4: Pending Data List Visibility

A user must see a pending submission in `GET /api/v1/pending-data/` if:

1. The data's administration is within the user's role subtree AND the user has approve access.

### FR-5: Batch Creation by Approver

An approver (IS_APPROVER) at the same or higher administration level as the pending data must be allowed to create a batch from that data — previously only the original submitter could.

### FR-6: Batch Administration (LCA)

When a batch is created from multiple data items that span different administrations, the batch administration must be set to the **Lowest Common Ancestor (LCA)** of all included items' administrations — not the requesting user's role administration.

### FR-7: can_delete Field in List Response

The draft list serializer must include a boolean `can_delete` field so the frontend can conditionally render the Delete button without making a separate API call. The field evaluates to `true` when the requesting user would be permitted to call `DELETE /api/v1/draft-submission/{id}/`.

## Non-Functional Requirements

### NFR-1: Security Through Obscurity on GET/PUT

Out-of-scope detail requests must return 404, not 403. A 404 reveals no information about whether the record exists, preventing enumeration attacks.

### NFR-2: No Duplicate Rows

All querysets that traverse multi-join paths (UserRole → Administration) must call `.distinct()` to avoid returning duplicate rows.

### NFR-3: No Model Changes

The `FormData` model's `administration` field is already nullable for drafts. No schema migration is required for this feature.

### NFR-4: Backward Compatibility

Existing tests must continue to pass. Any test that relied on an IS_ADMIN user being forbidden from deleting others' drafts at the same administration must be updated to reflect the new (correct) rule.

## Out of Scope

- Sharing drafts across entirely unrelated administration hierarchies
- Real-time notifications when a supervisor views or edits a subordinate's draft
- Audit logging of cross-user draft access
