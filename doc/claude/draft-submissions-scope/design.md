# Design — Draft Submissions Scope

## Administration Hierarchy Model

Administration records store their ancestry as a dot-separated `path` string:

```
root (pk=1, path="")
  province (pk=2, path="1.")
    district (pk=3, path="1.2.")
      village (pk=4, path="1.2.3.")
```

A user's **role subtree** covers the role's administration and all descendants:

```python
admin_subtree_path = f"{admin.path}{admin.pk}."
Q(administration_id=admin.pk) | Q(administration__path__startswith=admin_subtree_path)
```

## Scope Filter Architecture

### Helper: `_build_draft_scope_filter(user, access_type)`

Extracted module-level helper in `v1_data/views.py`. Accepts an optional `access_type` (defaults to `DataAccessTypes.submit`) so it can be reused for both list/detail (submit) and delete (delete).

```
Q(created_by=user)                           # creator always sees own drafts
| Q(administration in user's subtree)         # draft admin within scope
| Q(created_by's role admin in user's scope) # creator-scope fallback
```

The **creator-scope fallback** handles the case where a draft has no administration (nullable) or was submitted at a higher level (e.g. national). If the creator's role administration falls within the supervisor's subtree, the supervisor can still see it.

```python
creator_scope_lookup = "created_by__user_user_role__administration__pk__in"
draft_filter |= Q(**{creator_scope_lookup: scope_admin_pks})
```

Using a variable for the lookup key avoids line-length violations (E501) from the long ORM path string.

### Why `.distinct()` Is Required

The `created_by__user_user_role__administration__pk__in` path joins through `UserRole`, which can have multiple rows per user. Without `.distinct()`, a user with two roles would produce duplicate FormData rows in the queryset.

### GET/PUT Scope — 404 Not 403

```python
draft_data = get_object_or_404(
    FormData.objects_draft.filter(draft_filter).distinct(),
    pk=data_id,
)
```

Using `get_object_or_404` on the already-filtered queryset means out-of-scope records are treated as non-existent. This prevents leaking existence information via HTTP status codes.

### DELETE Scope — 403 for Out-of-Scope

Delete uses a two-step check:

1. `get_object_or_404(FormData, pk=data_id, is_draft=True)` — confirms the record exists (returns 404 if not)
2. `FormData.objects_draft.filter(delete_filter, pk=data_id).distinct().exists()` — checks delete permission; returns 403 if false

This separation means a known-existent record that is out of delete scope returns 403 (authorization failure), while a nonexistent ID returns 404. This is appropriate because the requestor already knows the ID (they received it from the list endpoint).

## Serializer: `can_delete` Field

`ListFormDataSerializer` computes `can_delete` at serialization time using the request from serializer context:

```python
def get_can_delete(self, instance):
    user = request.user
    if user.is_superuser or instance.created_by_id == user.id:
        return True
    return user.user_user_role.filter(
        role__role_role_access__data_access=DataAccessTypes.delete
    ).exists()
```

This is intentionally a broad check (any delete-access role) rather than a full scope check. The backend already enforces full scope on the actual DELETE request. The field exists solely so the frontend can hide the button when the user has no delete access at all — avoiding a guaranteed 403 that would confuse the user.

Both callers of `ListFormDataSerializer` (draft list and main data list) now pass `context={"request": request}`.

## Batch Administration: LCA

When building a batch from multiple `FormData` items, the batch's administration is set to the **Lowest Common Ancestor** of all item administrations. This is computed via path prefix matching:

```python
def find_lca(administrations):
    # Sort all path strings; the LCA is the node whose path is a prefix of all others
    paths = [f"{a.path}{a.pk}." for a in administrations]
    # Walk ancestor chain of first item until its path is a prefix of all others
```

This replaces the previous behavior of always using the requesting user's role administration, which was incorrect for cross-administration batches.

## Frontend: Conditional Delete Button

In [DraftDetail.jsx](frontend/src/pages/manage-draft/DraftDetail.jsx):

```jsx
{record?.can_delete && (
  <Button type="danger" shape="round" onClick={() => onDelete(record, setDeleting)} loading={deleting}>
    {text.deleteText}
  </Button>
)}
```

The optional-chaining on `record?.can_delete` ensures no render errors when `record` is undefined during initial load.

## Data Access Types Reference

| Constant | Value | Roles that have it |
|----------|-------|--------------------|
| `read` | 1 | Admin, Submitter, Approver |
| `approve` | 2 | Admin, Approver |
| `submit` | 3 | Admin, Submitter |
| `edit` | 4 | Admin |
| `delete` | 5 | Admin |

IS_APPROVER has read + approve only. IS_ADMIN has all five.
