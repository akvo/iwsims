# Design

## Data Model

### `datapoints` table — new column

```
locallyCreated  TINYINT  DEFAULT 0
```

#### Column semantics

| `submitted` | `syncedAt` | `locallyCreated` | Meaning |
|:-----------:|:----------:|:----------------:|---------|
| `0` | `NULL` | `1` | Draft saved locally by user (FormPage `handleOnSaveAndExit`) |
| `1` | `NULL` | `1` | Submitted locally, not yet uploaded (FormPage `handleOnSubmitForm`) |
| `1` | `NOT NULL` | `1` | Submitted locally, upload complete |
| `1` | `NOT NULL` | `0` | Datapoint downloaded from server (`downloadDatapointsJson`) |
| `0` | `NOT NULL` | `0` | Draft downloaded from server (`fetchDraftDatapointsPageByPage`) |

`submitted` and `syncedAt` semantics are **unchanged**. `locallyCreated` is a new, orthogonal axis.

#### Migration

`05_add_locallyCreated_to_datapoints.js` adds the column via `ALTER TABLE`. Existing rows receive `locallyCreated = 0` (the column default).

**Back-fill applied**: the `up` function runs `UPDATE datapoints SET locallyCreated = 1` immediately after adding the column. All rows present at migration time are treated as locally created, preserving pre-migration `submitted` and `synced` counts. No server-download tracking existed before this column, so all existing data is either on-device or indistinguishably mixed — the back-fill is the only option that avoids a count regression on upgrade. Rows inserted after the migration by the server-sync path receive the column default `0`.

The `down` migration throws an error rather than running `dropColumn`. The `dropColumn` implementation uses a `DROP TABLE` + `RENAME` pattern with no wrapping transaction; a crash between those steps would permanently destroy all datapoints. Adding a nullable column with a safe default has no valid rollback — removing the column must be done via a new forward migration.

---

## Count Hierarchy

```
submitted = submitted=1  AND locallyCreated=1
synced    = locallyCreated=1  AND syncedAt IS NOT NULL
draft     = submitted=0  (all local drafts, regardless of origin)
```

`synced` counts all locally-created rows that have been uploaded, whether submitted or draft. `synced` may therefore exceed `submitted` (e.g. submitted=3, draft=3, synced=6). Server-downloaded data (`locallyCreated=0`) does not appear in `submitted` or `synced`.

---

## Query Changes

### `selectLatestFormVersion` (Home screen — registration forms)

**Before:**

```sql
COUNT(DISTINCT CASE WHEN dp.submitted = 1 THEN dp.id END) AS submitted,
COUNT(DISTINCT CASE WHEN dp.submitted = 0 THEN dp.id END) AS draft,
COUNT(DISTINCT CASE WHEN dp.syncedAt IS NOT NULL THEN dp.id END) AS synced
```

**After:**

```sql
COUNT(DISTINCT CASE WHEN dp.submitted = 1 AND dp.locallyCreated = 1
  THEN dp.id END) AS submitted,
COUNT(DISTINCT CASE WHEN dp.submitted = 0
  THEN dp.id END) AS draft,
COUNT(DISTINCT CASE WHEN dp.locallyCreated = 1 AND dp.syncedAt IS NOT NULL
  THEN dp.id END)
  + COALESCE((
    SELECT COUNT(DISTINCT mdp.id)
    FROM datapoints mdp
    INNER JOIN forms mf ON mdp.form = mf.id
    WHERE mf.parentId = f.id
      AND mdp.user = ?
      AND mdp.locallyCreated = 1
      AND mdp.submitted = 1
      AND mdp.syncedAt IS NOT NULL
  ), 0) AS synced
-- params: [user, user, latest]
```

The correlated subquery adds synced submitted datapoints from monitoring (child) forms for the same user. `locallyCreated=1 AND submitted=1` is safe because `handleOnSubmitForm` always writes `locallyCreated=1` via both `saveDataPoint` (new) and `updateDataPoint` (existing). `submitted` and `draft` count registration form datapoints only.

### `getFormOptions` (Submission screen — monitoring forms)

**Before:**

```sql
COUNT(DISTINCT CASE WHEN dp.submitted = 1 THEN dp.id END) AS submitted,
COUNT(DISTINCT CASE WHEN dp.submitted = 0 AND dp.syncedAt IS NULL THEN dp.id END) AS draft,
COUNT(DISTINCT CASE WHEN dp.submitted = 1 AND dp.syncedAt IS NOT NULL THEN dp.id END) AS synced
```

**After:**

```sql
COUNT(DISTINCT CASE WHEN dp.submitted = 1 AND dp.locallyCreated = 1
  THEN dp.id END) AS submitted,
COUNT(DISTINCT CASE WHEN dp.submitted = 0 AND dp.syncedAt IS NULL
  THEN dp.id END) AS draft,
COUNT(DISTINCT CASE WHEN dp.locallyCreated = 1 AND dp.syncedAt IS NOT NULL
  THEN dp.id END) AS synced
```

The `draft` clause in `getFormOptions` intentionally keeps `AND dp.syncedAt IS NULL` — the monitoring screen only shows unsynced local drafts for the given registration UUID.

---

## Write Path

### FormPage.js — sets `locallyCreated: 1`

Both save and submit paths write `locallyCreated: 1` in the data object before passing to `saveDataPoint` or `updateDataPoint`:

```
handleOnSaveAndExit  → saveData   includes  locallyCreated: 1
handleOnSubmitForm   → submitData includes  locallyCreated: 1
```

Both branches cover `isNewSubmission` (calls `saveDataPoint`) and existing edits (calls `updateDataPoint`). `updateDataPoint` does not accept `locallyCreated` — the value is immutable once set at creation.

### sync-datapoints.js — does NOT set `locallyCreated`

`downloadDatapointsJson` and `updateByUUID` do not pass `locallyCreated`. New inserts receive the column default `0`. Existing rows updated via `updateByUUID` are untouched.

### crud-datapoints.js — normalises `locallyCreated` in `saveDataPoint`

```javascript
const locallyCreatedVal =
  locallyCreated !== undefined ? { locallyCreated: locallyCreated === 1 ? 1 : 0 } : {};
```

Any truthy input becomes `1`; any falsy input becomes `0`. When `locallyCreated` is `undefined` the spread is empty and the column default applies.

---

## i18n Change

File: `app/src/lib/i18n/ui-text.js`

```diff
-    draftLabel: 'Saved: ',
+    draftLabel: 'Draft: ',
```

Only the English (`en`) entry. French (`fr`) is already `'Brouillon: '`.

---

## Impact on Existing Tests

`Home.test.js` and `crud-datapoints.test.js` mock the database. Tests that assert on the `submitted` or `synced` subtitle counts must add `locallyCreated: 1` to their mock datapoint fixtures to preserve expected values. Tests that do not exercise those count queries are unaffected.
