# Requirements

## Background

The Home screen (`app/src/pages/Home.js`) renders a card per form. Each card shows subtitle statistics built from `crudForms.selectLatestFormVersion`:

```
Version: 1.0   Submitted: 5   Draft: 2   Synced: 5
```

### Problem 1 — Wrong label text

`draftLabel` in `app/src/lib/i18n/ui-text.js` (EN) is set to `'Saved: '`.
The key name, every other language (e.g. FR `'Brouillon: '`), and surrounding code all use the word *draft*. The EN string is a stale artifact.

### Problem 2 — Submitted count includes server downloads

`SYNC_DATAPOINT_JOB_NAME` background task pulls submitted datapoints from the server and stores them locally with `submitted = 1`.
These appear in the `submitted` count alongside data the user actually filled in on-device.
The user cannot distinguish "I submitted 5 forms" from "5 forms were pulled from the server".

Datapoints created through `FormPage.js` (`handleOnSaveAndExit` and `handleOnSubmitForm`) are the only ones that should count.

### Problem 3 — Submitted data disappears after sync

A server-downloaded draft submitted by the user gets a `draftId` assigned. After the sync job uploads it and sets `syncedAt`, the Phase 2 cleanup (`deleteDraftSynced`) deletes the row because it matches `draftId IS NOT NULL AND syncedAt IS NOT NULL` — the missing `submitted = 0` guard causes submitted records to be wiped.

---

## Functional Requirements

### FR-1 — Draft label rename (English)

- `draftLabel` EN value MUST change from `'Saved: '` to `'Draft: '`.
- No other language string is touched (FR `'Brouillon: '` is already correct).
- No other i18n key is changed (out of scope per user decision).

### FR-2 — Submitted count: local submissions only, including child forms

- The **Submitted** statistic on the Home form card MUST count only datapoints that were created on-device through `FormPage.js`.
- Datapoints downloaded from the server via `sync-datapoints.js` (`downloadDatapointsJson`) MUST NOT be included in the submitted count.
- Submitted count MUST also include locally-submitted monitoring (child) form datapoints for the registration form row.
- The **Draft** count (`submitted = 0`) is unchanged — it already reflects only local state.
- The **Synced** count MUST be expanded to include:
  - Server-re-downloaded drafts (`submitted = 0`, `syncedAt IS NOT NULL`) alongside locally-created synced rows.
  - Monitoring (child) form locally-submitted synced datapoints.

### FR-3 — locallyCreated column

- A new boolean column `locallyCreated` (`TINYINT`) MUST be added to the `datapoints` table.
- Default value for all new rows is `0`.
- `FormPage.js` MUST write `locallyCreated = 1` when:
  - Saving a **new** draft (`handleOnSaveAndExit`, `isNewSubmission = true` path).
  - Submitting a form (`handleOnSubmitForm`), both new and existing (server-downloaded) submissions.
- Saving an **existing** draft (`handleOnSaveAndExit`, `isNewSubmission = false` path) does NOT set `locallyCreated` — the existing DB value is preserved.
- `sync-datapoints.js` does NOT write `locallyCreated`; it receives the column default `0`.
- Existing rows in the database receive `locallyCreated = 1` via migration back-fill (treating all pre-existing data as locally created, preserving pre-migration counts).

### FR-4 — Query update: selectLatestFormVersion

`selectLatestFormVersion` submitted count changes from:
```sql
COUNT(DISTINCT CASE WHEN dp.submitted = 1 THEN dp.id END) AS submitted
```
to registration form count plus a correlated subquery for monitoring form submissions (joined on `mf.parentId = f.formId`).

`selectLatestFormVersion` synced count changes from:
```sql
COUNT(DISTINCT CASE WHEN dp.syncedAt IS NOT NULL THEN dp.id END) AS synced
```
to `syncedAt IS NOT NULL AND (submitted = 0 OR locallyCreated = 1)` for registration forms, plus a correlated subquery for monitoring form synced submissions.

See [design.md](design.md) for full SQL.

### FR-5 — deleteDraftSynced bug fix

`deleteDraftSynced` in `crud-datapoints.js` MUST add `submitted = 0` to its WHERE clause so that submitted records with a `draftId` are never deleted after sync completes.

---

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Migration runs automatically at app launch via the existing migration runner; no manual intervention needed |
| NFR-2 | `locallyCreated` is set once at creation for new submissions; `updateDataPoint` accepts it only for the submit path (converting a draft to submitted) |
| NFR-3 | Existing unit tests for `crud-datapoints` and `Home` must continue to pass |
| NFR-4 | No changes to the backend API or server-side models |

---

## Out of Scope

- Changing any string other than EN `draftLabel`.
- Adding `locallyCreated` filtering to the Draft count.
- Any UI changes beyond the label string.
