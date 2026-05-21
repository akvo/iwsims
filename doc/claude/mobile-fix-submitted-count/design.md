# Design

## Data Model

### `datapoints` table — new column

```
locallyCreated  TINYINT  DEFAULT 0
```

#### Column semantics

| `submitted` | `syncedAt` | `locallyCreated` | Meaning |
|:-----------:|:----------:|:----------------:|---------|
| `0` | `NULL` | `1` | Draft saved locally by user (FormPage `handleOnSaveAndExit`, new submission) |
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
submitted = (submitted=1 AND locallyCreated=1)          -- registration form
          + child form (submitted=1 AND locallyCreated=1) -- monitoring forms via correlated subquery

draft     = submitted=0                                  -- all local drafts, regardless of origin

synced    = syncedAt IS NOT NULL
            AND (submitted=0 OR locallyCreated=1)        -- registration form
          + child form (submitted=1 AND locallyCreated=1  -- monitoring forms via correlated subquery
            AND syncedAt IS NOT NULL)
```

`synced` includes:
- Locally-created registrations that have been uploaded (submitted or draft)
- Server-re-downloaded drafts (`locallyCreated=0`, `submitted=0`, `syncedAt IS NOT NULL`)
- Monitoring (child) form submissions that have been uploaded

`synced` may therefore exceed `submitted` (e.g. submitted=9, draft=3, synced=12). Server-downloaded submissions (`locallyCreated=0, submitted=1`) do not appear in `submitted` but do appear in `synced` if re-downloaded as drafts.

The parent–child relationship between forms uses `forms.parentId = parent.formId` (the backend API identifier), **not** the local SQLite auto-increment `id`.

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
COUNT(
  DISTINCT CASE WHEN dp.submitted = 1 AND dp.locallyCreated = 1
  THEN dp.id END
) + COALESCE((
  SELECT COUNT(DISTINCT mdp.id)
  FROM datapoints mdp
  INNER JOIN forms mf ON mdp.form = mf.id
  WHERE mf.parentId = f.formId     -- formId, NOT local id
    AND mdp.user = ?
    AND mdp.locallyCreated = 1
    AND mdp.submitted = 1
), 0) AS submitted,
COUNT(
  DISTINCT CASE WHEN dp.submitted = 0
  THEN dp.id END
) AS draft,
COUNT(
  DISTINCT CASE WHEN dp.syncedAt IS NOT NULL
    AND (dp.submitted = 0 OR dp.locallyCreated = 1)
  THEN dp.id END
) + COALESCE((
  SELECT COUNT(DISTINCT mdp.id)
  FROM datapoints mdp
  INNER JOIN forms mf ON mdp.form = mf.id
  WHERE mf.parentId = f.formId     -- formId, NOT local id
    AND mdp.user = ?
    AND mdp.locallyCreated = 1
    AND mdp.submitted = 1
    AND mdp.syncedAt IS NOT NULL
), 0) AS synced
-- params: [user (submitted subquery), user (synced subquery), user (LEFT JOIN), latest]
```

The correlated subqueries join on `mf.parentId = f.formId` because `forms.parentId` stores the parent's **backend API form ID** (e.g. `1749627302948`), not the local SQLite auto-increment `id`. `submitted=1` is safe in both subqueries because `handleOnSubmitForm` always writes `locallyCreated: 1` via both `saveDataPoint` (new) and `updateDataPoint` (existing). The synced outer clause adds `submitted = 0` to capture server-re-downloaded drafts that have `locallyCreated = 0`.

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

**`handleOnSubmitForm`** (both new and existing submissions):

`submitData` always includes `locallyCreated: 1`. This reaches both `saveDataPoint` (new submissions) and `updateDataPoint` (existing drafts being submitted). A server-downloaded draft converted to submitted therefore gets `locallyCreated` upgraded to `1` and appears in the submitted/synced counts.

```
handleOnSubmitForm → submitData includes locallyCreated: 1
  → isNewSubmission: saveDataPoint(db, payload)
  → else:           updateDataPoint(db, payload)   ← applies locallyCreated: 1
```

**`handleOnSaveAndExit`** (save-as-draft):

`locallyCreated: 1` is injected **only** on the `saveDataPoint` call for new submissions. Existing drafts are updated via `updateDataPoint` without `locallyCreated`, preserving their original origin value in the database.

```
handleOnSaveAndExit → saveData does NOT include locallyCreated
  → isNewSubmission: saveDataPoint(db, { ...payload, locallyCreated: 1 })
  → else:           updateDataPoint(db, payload)   ← locallyCreated unchanged
```

### sync-datapoints.js — does NOT set `locallyCreated`

`downloadDatapointsJson` and `updateByUUID` do not pass `locallyCreated`. New inserts receive the column default `0`. Existing rows updated via `updateByUUID` are untouched.

### crud-datapoints.js — normalises `locallyCreated` in both `saveDataPoint` and `updateDataPoint`

```javascript
const locallyCreatedVal =
  locallyCreated !== undefined ? { locallyCreated: locallyCreated === 1 ? 1 : 0 } : {};
```

Any truthy input becomes `1`; any falsy input becomes `0`. When `locallyCreated` is `undefined` the spread is empty and the column default (or existing DB value) applies.

`updateDataPoint` accepts `locallyCreated` (it is not immutable by design). The submit path relies on this to upgrade server-downloaded drafts to `locallyCreated = 1` when the user submits them.

### deleteDraftSynced bug fix

`deleteDraftSynced` in `SyncService` Phase 2 previously deleted any row with `draftId IS NOT NULL AND syncedAt IS NOT NULL`, which incorrectly removed submitted records that carried a `draftId` after upload. The fix adds `submitted = 0` to the WHERE clause:

```sql
-- Before (deletes submitted records too)
DELETE FROM datapoints WHERE draftId IS NOT NULL AND syncedAt IS NOT NULL

-- After (draft-only cleanup)
DELETE FROM datapoints WHERE submitted = 0 AND draftId IS NOT NULL AND syncedAt IS NOT NULL
```

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
