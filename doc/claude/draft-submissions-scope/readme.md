# Draft Submissions Scope — Feature #10

## Overview

This feature extends the visibility rules for both **pending** and **draft** form data submissions so that users with the appropriate administration-level roles can see submissions from within their scope — not only submissions they created themselves.

## Problem Statement

Previously, the draft submission list and detail APIs only returned submissions created by the requesting user. This meant:

- A supervisor at a higher administration level could not see drafts created by team members below them.
- An approver could not create a batch from submissions they needed to approve — only the submitter could batch their own data.
- Searching for draft submissions filtered with a national-level administration (`?administration=1`) returned zero results for supervisors, even when they covered the entire territory.

## What Changed

| Area | Before | After |
|------|--------|-------|
| Pending data list | Visible only to creator or exact administration | Visible to users with approve access at same or higher administration |
| Draft data list | Visible only to creator | Visible to creator OR users with submit access in scope (by draft admin or creator's role) |
| Draft detail (GET) | Creator only — 400 for others | Scope-based — out-of-scope returns 404 |
| Draft detail (PUT) | Creator only — 400 for others | Scope-based — out-of-scope returns 404 |
| Batch creation | Only submitter of the data | Approvers in scope can also create batches |
| Batch administration | Always user's role administration | LCA of all data items' administrations |

## Branch

`feature/10-feedback-show-submissions-for-upper-adm-level`

## Documentation

- [requirements.md](requirements.md) — functional and non-functional requirements
- [design.md](design.md) — technical design decisions and key patterns
- [implementation-plan.md](implementation-plan.md) — phased implementation breakdown and test summary

## Related Files

- `backend/api/v1/v1_data/views.py` — main scope filter changes
- `backend/api/v1/v1_data/serializers.py` — `can_delete` field
- `backend/api/v1/v1_approval/serializers.py` — LCA batch administration
- `backend/api/v1/v1_data/tests/tests_draft_data_submit_filter.py`
- `backend/api/v1/v1_data/tests/tests_draft_detail_scope.py`
- `backend/api/v1/v1_data/tests/tests_draft_delete_scope.py`
- `backend/api/v1/v1_approval/tests/tests_create_batch_by_approver.py`
- `backend/api/v1/v1_data/tests/tests_pending_data_approval_filter.py`
- `frontend/src/pages/manage-draft/DraftDetail.jsx`
