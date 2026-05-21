# Mobile — Fix Submitted Count & Rename Draft Label

**Issue**: #222 `feature/222-mobile-rename-saved-to-draft-and-improve-statistics`

## Summary

The Home screen form list shows three statistics per form: **Submitted**, **Draft**, and **Synced**.

Problems addressed:

1. The **Draft** label reads *"Saved: N"* in English — the key is already named `draftLabel` in i18n but the value string is wrong.
2. The **Submitted** count includes datapoints downloaded **from the server**, not just those submitted on-device through `FormPage.js`.
3. The **Submitted** and **Synced** counts exclude monitoring (child) form datapoints — the Home screen only counted registration form rows.
4. The **Synced** count excludes server-re-downloaded drafts that have been uploaded.
5. A server-downloaded draft submitted by the user **disappears** after sync — `deleteDraftSynced` was missing a `submitted = 0` guard and deleted uploaded submitted records.

## Scope

| File | Change |
|------|--------|
| `app/src/lib/i18n/ui-text.js` | Rename EN `draftLabel` value `'Saved: '` → `'Draft: '` |
| `app/src/database/tables.js` | Add `locallyCreated TINYINT DEFAULT 0` field to `datapoints` |
| `app/src/database/migrations/05_add_locallyCreated_to_datapoints.js` | Migration to add column + back-fill existing rows with `locallyCreated = 1`; `down` throws (irreversible) |
| `app/src/database/migrations/index.js` | Export the new migration |
| `app/src/database/crud/crud-datapoints.js` | Accept `locallyCreated` in `saveDataPoint` and `updateDataPoint` (normalise to 0/1); fix `deleteDraftSynced` to guard with `submitted = 0` |
| `app/src/database/crud/crud-forms.js` | `selectLatestFormVersion`: add correlated subqueries for child form submitted + synced counts; expand synced outer clause to include re-downloaded drafts. `getFormOptions`: add `locallyCreated = 1` filter to submitted and synced |
| `app/src/pages/FormPage.js` | Set `locallyCreated: 1` on new-submission save-as-draft and on all submit paths (including existing server-downloaded drafts) |

## Documents

- [requirements.md](requirements.md) — what the feature must do and not do
- [design.md](design.md) — data model, query changes, column semantics
- [implementation-plan.md](implementation-plan.md) — ordered list of file edits
