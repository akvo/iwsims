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

---

## Functional Requirements

### FR-1 — Draft label rename (English)

- `draftLabel` EN value MUST change from `'Saved: '` to `'Draft: '`.
- No other language string is touched (FR `'Brouillon: '` is already correct).
- No other i18n key is changed (out of scope per user decision).

### FR-2 — Submitted count: local submissions only

- The **Submitted** statistic on the Home form card MUST count only datapoints that were created on-device through `FormPage.js`.
- Datapoints downloaded from the server via `sync-datapoints.js` (`downloadDatapointsJson`) MUST NOT be included in the submitted count.
- The **Draft** count (`submitted = 0`) is unchanged — it already reflects only local state.
- The **Synced** count (`syncedAt IS NOT NULL`) is unchanged.

### FR-3 — locallyCreated column

- A new boolean column `locallyCreated` (`TINYINT`) MUST be added to the `datapoints` table.
- Default value for all new rows is `0`.
- `FormPage.js` MUST write `locallyCreated = 1` when saving a draft or submitting a form.
- `sync-datapoints.js` does NOT write `locallyCreated`; it receives the column default `0`.
- Existing rows in the database receive `locallyCreated = 0` via migration (preserving current semantics: prior counts treated as "unknown origin").

### FR-4 — Query update

- `selectLatestFormVersion` submitted count clause changes from:
  ```sql
  COUNT(DISTINCT CASE WHEN dp.submitted = 1 THEN dp.id END) AS submitted
  ```
  to:
  ```sql
  COUNT(DISTINCT CASE WHEN dp.submitted = 1 AND dp.locallyCreated = 1 THEN dp.id END) AS submitted
  ```

---

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Migration runs automatically at app launch via the existing migration runner; no manual intervention needed |
| NFR-2 | `locallyCreated` is write-once at insert time; `updateDataPoint` does not need to accept or modify it |
| NFR-3 | Existing unit tests for `crud-datapoints` and `Home` must continue to pass |
| NFR-4 | No changes to the backend API or server-side models |

---

## Out of Scope

- Changing any string other than EN `draftLabel`.
- Modifying the Draft or Synced count logic.
- Adding `locallyCreated` filtering to the Draft count.
- Back-filling `locallyCreated = 1` for existing rows (user decision: treat existing data as unknown origin).
- Any UI changes beyond the label string.
