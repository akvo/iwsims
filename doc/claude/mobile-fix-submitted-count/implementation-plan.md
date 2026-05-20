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

const up = (db) => sql.addNewColumn(db, tableName, fieldName, fieldType);

const down = (db) => sql.dropColumn(db, tableName, fieldName);

export { up, down };
```

Pattern matches `03_add_draftId_to_datapoints.js`.

---

## Step 4 — Register migration in index

**File**: `app/src/database/migrations/index.js`

```diff
 export * as m03 from './03_add_draftId_to_datapoints';
 export * as m04 from './04_create_datapoint_sync_queue';
+export * as m05 from './05_add_locallyCreated_to_datapoints';
```

---

## Step 5 — Pass `locallyCreated` through `saveDataPoint`

**File**: `app/src/database/crud/crud-datapoints.js`

### 5a — Add to destructured parameters (lines 43–59)

```diff
   saveDataPoint: async (
     db,
     {
       uuid,
       form,
       user,
       name,
       geo,
       submitted,
       duration,
       json,
       repeats,
       syncedAt,
       administrationId,
       draftId,
       id,
+      locallyCreated,
     },
   ) => {
```

### 5b — Build the optional value and spread it into `dataToInsert` (after `idVal`)

```diff
       const idVal = id ? { id } : {};
+      const locallyCreatedVal = locallyCreated !== undefined ? { locallyCreated } : {};

       const dataToInsert = {
         form,
         user,
         name,
         submitted,
         duration: duration || 0,
         createdAt: new Date().toISOString(),
         json: json ? JSON.stringify(json).replace(/'/g, "''") : null,
         ...geoVal,
         ...submittedAt,
         ...repeatsVal,
         ...uuidVal,
         ...syncedAtVal,
         ...admVal,
         ...draftVal,
         ...idVal,
+        ...locallyCreatedVal,
       };
```

`updateDataPoint` is **not changed** — `locallyCreated` is set once at creation.

---

## Step 6 — Update submitted count in query

**File**: `app/src/database/crud/crud-forms.js:14–17`

```diff
-          COUNT(
-            DISTINCT CASE WHEN dp.submitted = 1
-            THEN dp.id END
-          ) AS submitted,
+          COUNT(
+            DISTINCT CASE WHEN dp.submitted = 1 AND dp.locallyCreated = 1
+            THEN dp.id END
+          ) AS submitted,
```

Only this one `CASE WHEN` clause changes. `draft` and `synced` clauses are untouched.

---

## Step 7 — Set `locallyCreated: 1` in FormPage.js

**File**: `app/src/pages/FormPage.js`

### 7a — `handleOnSaveAndExit` `saveData` object (around line 97)

```diff
       const saveData = {
         form: currentFormId,
         user: userId,
         name: dpName || trans.untitled,
         submitted: 0,
         duration: surveyDuration,
         json: jsonAnswers,
         uuid: route.params?.uuid || Crypto.randomUUID(),
         geo: dpGeo,
+        locallyCreated: 1,
       };
```

### 7b — `handleOnSubmitForm` `submitData` object (around line 151)

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

---

## Step 8 — Update tests (if needed)

**File**: `app/src/pages/__tests__/Home.test.js`

Any mock datapoint fixture that is expected to appear in the `submitted` count must include `locallyCreated: 1` to reflect the new query filter.

**File**: `app/src/database/crud/__tests__/crud-datapoints.test.js`

Fixtures for `saveDataPoint` calls that test local-submission scenarios should include `locallyCreated: 1`.

Run `npm test` in `app/` to verify no regressions after all steps above are applied.

---

## Execution Order

Steps 1–7 are all independent of each other (no step's output is another step's input). They can be applied in any order or in parallel. Step 8 must run last, after all code changes are in place.
