# Implementation Plan

Ordered list of file edits. Each step is independent of later steps unless noted.

---

## Step 1 — i18n label rename

**File**: `app/src/lib/i18n/ui-text.js:8`

```diff
-    draftLabel: 'Saved: ',
+    draftLabel: 'Draft: ',
```

No other lines in this file change.

---

## Step 2 — Add `locallyCreated` to `datapoints` table definition

**File**: `app/src/database/tables.js:58–59`

```diff
       uuid: 'VARCHAR(191)',
       repeats: 'TEXT',
+      locallyCreated: 'TINYINT DEFAULT 0',
```

Add after the `repeats` field inside the `datapoints` fields object.

---

## Step 3 — Create migration file

**New file**: `app/src/database/migrations/05_add_locallyCreated_to_datapoints.js`

```javascript
import sql from '../sql';

const tableName = 'datapoints';
const fieldName = 'locallyCreated';
const fieldType = 'TINYINT DEFAULT 0';

const up = async (db) => {
  await sql.addNewColumn(db, tableName, fieldName, fieldType);
  // Back-fill: all rows present at migration time are treated as locally created.
  // No server-download tracking existed before this column, so all existing data
  // was either created on-device or indistinguishably mixed. Setting 1 preserves
  // pre-migration submitted/synced counts.
  await db.execAsync(`UPDATE ${tableName} SET ${fieldName} = 1`);
};

// dropColumn uses a DROP TABLE + RENAME pattern with no wrapping transaction.
// A crash between those steps would permanently destroy all datapoints.
// Adding a nullable column with a safe default has no meaningful rollback —
// if the column must be removed, ship a new forward migration instead.
const down = () => {
  throw new Error(
    'Migration 05 is irreversible. To remove locallyCreated, create a new forward migration.',
  );
};

export { up, down };
```

---

## Step 4 — Register migration in index

**File**: `app/src/database/migrations/index.js`

```diff
 export * as m03 from './03_add_draftId_to_datapoints';
 export * as m04 from './04_create_datapoint_sync_queue';
+export * as m05 from './05_add_locallyCreated_to_datapoints';
```

---

## Step 5 — Fix `deleteDraftSynced` and pass `locallyCreated` through `saveDataPoint` / `updateDataPoint`

**File**: `app/src/database/crud/crud-datapoints.js`

### 5a — Fix `deleteDraftSynced` (bug: submitted records were deleted)

```diff
-      'DELETE FROM datapoints WHERE draftId IS NOT NULL AND syncedAt IS NOT NULL',
-      [],
+      'DELETE FROM datapoints WHERE submitted = ? AND draftId IS NOT NULL AND syncedAt IS NOT NULL',
+      [0],
```

### 5b — Add `locallyCreated` to `saveDataPoint` destructured parameters

```diff
   saveDataPoint: async (
     db,
     {
       ...
       id,
+      locallyCreated,
     },
   ) => {
```

### 5c — Build the optional value and spread into `dataToInsert` (strict 0/1 normalisation)

```diff
       const idVal = id ? { id } : {};
+      const locallyCreatedVal =
+        locallyCreated !== undefined ? { locallyCreated: locallyCreated === 1 ? 1 : 0 } : {};

       const dataToInsert = {
         ...
         ...idVal,
+        ...locallyCreatedVal,
       };
```

### 5d — Add `locallyCreated` to `updateDataPoint` (needed for the submit path)

```diff
   updateDataPoint: async (
     db,
-    { id, name, geo, submitted, duration, submittedAt, syncedAt, json, repeats },
+    { id, name, geo, submitted, duration, submittedAt, syncedAt, json, repeats, locallyCreated },
   ) => {
     try {
       const repeatsVal = repeats ? { repeats } : {};
       const submittedVal = submitted !== undefined ? { submitted } : {};
       const syncedAtVal = syncedAt !== undefined ? { syncedAt } : {};
+      const locallyCreatedVal =
+        locallyCreated !== undefined ? { locallyCreated: locallyCreated === 1 ? 1 : 0 } : {};

       const res = await sql.updateRow(db, 'datapoints', { id }, {
         ...
+        ...locallyCreatedVal,
       });
```

`updateDataPoint` accepts `locallyCreated` to handle the case where a server-downloaded draft (`locallyCreated = 0`) is submitted by the user — the submit path sets `locallyCreated: 1`, upgrading the row so it appears in the submitted/synced counts.

---

## Step 6 — Update queries in `crud-forms.js`

**File**: `app/src/database/crud/crud-forms.js`

### 6a — `selectLatestFormVersion`: submitted count with child form subquery

```diff
-          COUNT(
-            DISTINCT CASE WHEN dp.submitted = 1
-            THEN dp.id END
-          ) AS submitted,
+          COUNT(
+            DISTINCT CASE WHEN dp.submitted = 1 AND dp.locallyCreated = 1
+            THEN dp.id END
+          ) + COALESCE((
+            SELECT COUNT(DISTINCT mdp.id)
+            FROM datapoints mdp
+            INNER JOIN forms mf ON mdp.form = mf.id
+            WHERE mf.parentId = f.formId
+              AND mdp.user = ?
+              AND mdp.locallyCreated = 1
+              AND mdp.submitted = 1
+          ), 0) AS submitted,
```

### 6b — `selectLatestFormVersion`: synced count with re-downloaded drafts + child form subquery

```diff
-          COUNT(
-            DISTINCT CASE WHEN dp.syncedAt IS NOT NULL
-            THEN dp.id END
-          ) AS synced
+          COUNT(
+            DISTINCT CASE WHEN dp.syncedAt IS NOT NULL
+              AND (dp.submitted = 0 OR dp.locallyCreated = 1)
+            THEN dp.id END
+          ) + COALESCE((
+            SELECT COUNT(DISTINCT mdp.id)
+            FROM datapoints mdp
+            INNER JOIN forms mf ON mdp.form = mf.id
+            WHERE mf.parentId = f.formId
+              AND mdp.user = ?
+              AND mdp.locallyCreated = 1
+              AND mdp.submitted = 1
+              AND mdp.syncedAt IS NOT NULL
+          ), 0) AS synced
```

### 6c — Update params array (three `user` bindings now)

```diff
-    const rows = await sql.executeQuery(db, selectJoin, [user, latest]);
+    const rows = await sql.executeQuery(db, selectJoin, [user, user, user, latest]);
```

Param order: `user` (submitted subquery) → `user` (synced subquery) → `user` (LEFT JOIN) → `latest`.

**Key**: the correlated subqueries join on `mf.parentId = f.formId`, not `f.id`. `forms.parentId` stores the parent's backend API form identifier (e.g. `1749627302948`), not the local SQLite auto-increment `id`.

### 6d — `getFormOptions`: add `locallyCreated = 1` to submitted and synced

```diff
-          COUNT(
-            DISTINCT CASE WHEN dp.submitted = 1
-            THEN dp.id END
-          ) AS submitted,
+          COUNT(
+            DISTINCT CASE WHEN dp.submitted = 1 AND dp.locallyCreated = 1
+            THEN dp.id END
+          ) AS submitted,
           ...
-          COUNT(
-            DISTINCT CASE WHEN dp.submitted = 1 AND dp.syncedAt IS NOT NULL
-            THEN dp.id END
-          ) AS synced
+          COUNT(
+            DISTINCT CASE WHEN dp.locallyCreated = 1 AND dp.syncedAt IS NOT NULL
+            THEN dp.id END
+          ) AS synced
```

---

## Step 7 — Set `locallyCreated: 1` in FormPage.js

**File**: `app/src/pages/FormPage.js`

### 7a — `handleOnSaveAndExit`: inject `locallyCreated: 1` only on `saveDataPoint` call

`locallyCreated` is **not** added to `saveData`. It is injected only at the `saveDataPoint` call site for new submissions, so existing drafts preserve their DB origin value on update:

```diff
       if (isNewSubmission) {
-        await crudDataPoints.saveDataPoint(db, payload);
+        await crudDataPoints.saveDataPoint(db, { ...payload, locallyCreated: 1 });
       } else {
         await crudDataPoints.updateDataPoint(db, payload);
       }
```

### 7b — `handleOnSubmitForm`: `locallyCreated: 1` in `submitData` (unchanged from initial plan)

```diff
       const submitData = {
         form: currentFormId,
         user: userId,
         name: datapoitName,
         geo: values.geo,
         submitted: 1,
         duration: surveyDuration,
         json: answers,
         uuid: route.params?.uuid || Crypto.randomUUID(),
+        locallyCreated: 1,
       };
```

This value flows into both `saveDataPoint` (new) and `updateDataPoint` (existing). The `updateDataPoint` now accepts it (Step 5d), so server-downloaded drafts that the user submits are correctly upgraded to `locallyCreated = 1`.

---

## Step 8 — Update tests (if needed)

**File**: `app/src/pages/__tests__/Home.test.js`

Any mock datapoint fixture that is expected to appear in the `submitted` or `synced` count must include `locallyCreated: 1` to reflect the new query filter.

**File**: `app/src/database/crud/__tests__/crud-datapoints.test.js`

Fixtures for `saveDataPoint` calls that test local-submission scenarios should include `locallyCreated: 1`.

Run `npm test` in `app/` to verify no regressions after all steps above are applied.

---

## Execution Order

Steps 1–7 are all independent of each other (no step's output is another step's input). They can be applied in any order or in parallel. Step 8 must run last, after all code changes are in place.
