# Mobile — Fix Submitted Count & Rename Draft Label

**Issue**: #222 `feature/222-mobile-rename-saved-to-draft-and-improve-statistics`

## Summary

The Home screen form list shows three statistics per form: **Submitted**, **Draft**, and **Synced**.

Two problems exist today:

1. The **Draft** label reads *"Saved: N"* in English — the key is already named `draftLabel` in i18n but the value string is wrong.
2. The **Submitted** count includes datapoints that were downloaded **from the server** via the background sync job, not just those the user submitted on-device through `FormPage.js`. This inflates the count and makes it meaningless as a measure of local activity.

## Scope

| File | Change |
|------|--------|
| `app/src/lib/i18n/ui-text.js` | Rename EN `draftLabel` value `'Saved: '` → `'Draft: '` |
| `app/src/database/tables.js` | Add `locallyCreated TINYINT DEFAULT 0` field to `datapoints` |
| `app/src/database/migrations/05_add_locallyCreated_to_datapoints.js` | Migration to add column to existing DBs |
| `app/src/database/migrations/index.js` | Export the new migration |
| `app/src/database/crud/crud-datapoints.js` | Pass `locallyCreated` through `saveDataPoint` |
| `app/src/database/crud/crud-forms.js` | Add `AND dp.locallyCreated = 1` to submitted count |
| `app/src/pages/FormPage.js` | Set `locallyCreated: 1` on save-as-draft and submit payloads |

## Documents

- [requirements.md](requirements.md) — what the feature must do and not do
- [design.md](design.md) — data model, query changes, column semantics
- [implementation-plan.md](implementation-plan.md) — ordered list of file edits
