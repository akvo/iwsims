# Fix Memory Bottlenecks in Mobile Data Sync

## Context

The mobile app's data sync logic caused out-of-memory crashes when processing datasets of 500+ items across multiple forms. Root causes were: (1) recursive pagination concatenating all pages into one massive array before processing, (2) redundant form JSON parsing for every datapoint, (3) unbounded query results and `forEach(async...)` race conditions in submission uploads, (4) artificial 1-second delays in draft processing, and (5) dropdown overlays extending behind the Android navigation bar.

## Files Modified

1. `app/src/database/crud/crud-datapoints.js` - Add LIMIT to submission query
2. `app/src/lib/sync-datapoints.js` - Page-at-a-time pagination + form cache
3. `app/src/components/SyncService.js` - Page-at-a-time consumption + progress tracking
4. `app/src/database/crud/crud-forms.js` - Add `upsertForm` to prevent form duplication
5. `app/src/pages/Home.js` - Fix `syncAllForms` and `syncUserForms` (reduce pattern + upsert)
6. `app/src/lib/background-task.js` - Batch submission upload + concurrency-limited file uploads
7. `app/src/components/NetworkStatusBar.js` - Sync progress percentage + safe area insets
8. `app/src/components/BaseLayout/index.js` - Conditional bottom safe area edge
9. `app/src/components/BaseLayout/Content.js` - Flex layout fix for children branch
10. `app/src/form/fields/TypeOption.js` - Safe area insets for dropdown overlay
11. `app/src/form/fields/TypeMultipleOption.js` - Safe area insets for dropdown overlay
12. `app/src/form/fields/TypeCascade.js` - Safe area insets for dropdown overlay

## Implementation Details

### 1. LIMIT parameter on `selectSubmissionToSync`

**File:** `app/src/database/crud/crud-datapoints.js`

Added optional `limit` parameter (defaults to `null` = no limit for backward compat). Uses inline template literal with `parseInt` for safety:

```javascript
selectSubmissionToSync: async (db, limit = null) => {
  const rows = await sql.executeQuery(
    db,
    `SELECT datapoints.*, forms.formId, forms.json AS json_form
      FROM datapoints JOIN forms ON datapoints.form = forms.id
      WHERE datapoints.syncedAt IS NULL
      ORDER BY datapoints.createdAt ASC
      ${limit ? `LIMIT ${parseInt(limit, 10)}` : ''}`,
  );
  return rows;
},
```

### 2. Page-at-a-time pagination + form cache in `sync-datapoints.js`

**File:** `app/src/lib/sync-datapoints.js`

#### Recursive `fetchPage` inner function (avoids ESLint `no-await-in-loop`)

Both `fetchDatapointsPageByPage` and `fetchDraftDatapointsPageByPage` use the same pattern — a recursive inner `fetchPage` function instead of a `while` loop to satisfy ESLint's `no-await-in-loop` rule:

```javascript
export const fetchDatapointsPageByPage = async (onPageReceived, pageSize = 100) => {
  let totalProcessed = 0;
  const fetchPage = async (currentPage, totalPages) => {
    if (currentPage > totalPages) { return; }
    const { data: apiData } = await api.get(
      `/datapoint-list?page=${currentPage}&page_size=${pageSize}`,
    );
    const { data, total_page: totalPage, current: page } = apiData;
    await onPageReceived(data, page, totalPage);
    totalProcessed += data.length;
    await fetchPage(page + 1, totalPage);
  };
  await fetchPage(1, 1);
  return { totalProcessed };
};
```

- Uses `page_size=100` (backend max) to reduce HTTP round-trips 10x
- Only 1 page in memory at a time via callback pattern

#### Form cache in `downloadDatapointsJson`

Network call moved outside the transaction. Form definitions cached per `formId` via a `Map`:

```javascript
export const downloadDatapointsJson = async (
  db, { formId, administrationId, url, lastUpdated }, user, formCache = null,
) => {
  const response = await api.get(url);            // Network OUTSIDE transaction
  await sql.withTransaction(db, async (txDb) => {  // DB INSIDE transaction
    let form, parsedGroups;
    if (formCache?.has(formId)) {
      ({ dbRecord: form, parsedGroups } = formCache.get(formId));
    } else {
      form = await crudForms.getByFormId(txDb, { formId });
      parsedGroups = JSON.parse(form?.json || '{}')?.question_group || [];
      formCache?.set(formId, { dbRecord: form, parsedGroups });
    }
    // ... repeats calculation + upsert logic using parsedGroups ...
  });
};
```

### 3. SyncService.js - Page consumption + progress tracking

**File:** `app/src/components/SyncService.js`

`onSyncDataPoint` uses `fetchDatapointsPageByPage` with a `reduce` pattern for sequential async iteration (Airbnb ESLint: no `for...of`, no `await` in loops):

```javascript
UIState.update((s) => {
  s.statusBar = { type: SYNC_STATUS.on_progress, bgColor: '#2563eb', icon: 'sync' };
});
const formCache = new Map();
await fetchDatapointsPageByPage(async (pageData, pageNumber, totalPages) => {
  await pageData.reduce(async (previousPromise, item, index) => {
    await previousPromise;
    await downloadDatapointsJson(db, { ... }, activeJob.user, formCache);
    // Granular progress: page position + item within page
    const pageProgress = ((pageNumber - 1) / totalPages) * 100;
    const itemProgress = ((index + 1) / pageData.length) * (100 / totalPages);
    DatapointSyncState.update((s) => { s.progress = pageProgress + itemProgress; });
  }, Promise.resolve());
});
// After completion:
UIState.update((s) => {
  s.statusBar = { type: SYNC_STATUS.success, bgColor: '#16a34a', icon: 'checkmark-done' };
});
```

`onSyncDraftDatapoint` uses `fetchDraftDatapointsPageByPage` with the same pattern. The artificial 1-second delay was removed.

### 4. Form deduplication via `upsertForm`

**File:** `app/src/database/crud/crud-forms.js`

Added `upsertForm` method — check-then-insert-or-update pattern:

```javascript
upsertForm: async (db, { userId, id: formId, parentId, version, formJSON }) => {
  const existing = await sql.getFirstRow(db, 'forms', { formId, userId: userId || 0 });
  if (existing) {
    await sql.updateRow(db, 'forms', { id: existing.id }, {
      version, latest: 1, parentId: parentId || null,
      name: formJSON?.name || null,
      json: formJSON ? JSON.stringify(formJSON).replace(/'/g, "''") : null,
    });
    return existing.id;
  }
  return sql.insertRow(db, 'forms', { /* ... insert fields ... */ });
},
```

### 5. Home.js - `reduce` pattern + `upsertForm`

**File:** `app/src/pages/Home.js`

Replaced `forEach(async ...)` race conditions with `reduce` pattern:

```javascript
// Sequential cascade file downloads
await downloadFiles.reduce(async (prev, file) => {
  await prev;
  await cascades.download(api.getConfig().baseURL + file, file, true);
}, Promise.resolve());

// Sequential form upserts
await responses.reduce(async (prev, { value: res }) => {
  await prev;
  await crudForms.upsertForm(db, { ...findNew, id: formId, userId, version, formJSON: apiData });
}, Promise.resolve());
```

### 6. Batched submission sync in `background-task.js`

**File:** `app/src/lib/background-task.js`

#### Constants
```javascript
const BATCH_SIZE = 20;
const UPLOAD_CONCURRENCY = 3;
```

#### Concurrency-limited file uploads

`handleOnUploadFiles` uses lazy upload functions with chunked concurrency:

```javascript
const uploadFns = allFiles.map((f) => () => {
  // ... returns api.post() promise (lazy, not executed yet)
});
const chunks = Array.from(
  { length: Math.ceil(uploadFns.length / UPLOAD_CONCURRENCY) },
  (_, i) => uploadFns.slice(i * UPLOAD_CONCURRENCY, (i + 1) * UPLOAD_CONCURRENCY),
);
const results = await chunks.reduce(async (prevResults, chunk) => {
  const prev = await prevResults;
  const chunkResults = await Promise.allSettled(chunk.map((fn) => fn()));
  return prev.concat(chunkResults);
}, Promise.resolve([]));
```

#### Recursive batch processor

`processBatch` is a standalone recursive function with a shared `counts` object (pass-by-reference):

```javascript
const processBatch = async (db, activeJob, session, counts = { success: 0, failed: 0 }) => {
  const data = await crudDataPoints.selectSubmissionToSync(db, BATCH_SIZE);
  if (!data?.length) { return counts; }

  const photos = await handleOnUploadFiles(data, '/images', [QUESTION_TYPES.photo]);
  const attachments = await handleOnUploadFiles(data, '/attachments', [QUESTION_TYPES.attachment]);

  await data.reduce(async (previousPromise, d) => {
    await previousPromise;
    // ... sync logic per datapoint, counts.success++ or counts.failed++ ...
  }, Promise.resolve());

  if (data.length >= BATCH_SIZE && counts.failed === 0) {
    return processBatch(db, activeJob, session, counts);  // recurse for next batch
  }
  return counts;
};
```

`syncFormSubmission` calls `processBatch` and updates status ONCE after all batches:

```javascript
const { success: totalSuccess, failed: totalFailed } = await processBatch(db, activeJob, session);
```

### 7. NetworkStatusBar - Sync progress + safe area

**File:** `app/src/components/NetworkStatusBar.js`

- Subscribes to `DatapointSyncState.progress` and `DatapointSyncState.inProgress`
- Shows "Syncing... 45%" during datapoint download
- Uses `useSafeAreaInsets()` with `marginBottom: insets.bottom` to avoid overlapping Android nav bar

```javascript
const syncingLabel = syncInProgress && syncProgress > 0
  ? `${trans.syncingText} ${Math.round(syncProgress)}%`
  : trans.syncingText;
```

### 8. BaseLayout - Conditional bottom safe area edge

**File:** `app/src/components/BaseLayout/index.js`

Dynamically applies `'bottom'` safe area edge based on whether NetworkStatusBar is visible:

```javascript
const isOnline = UIState.useState((s) => s.online);
const statusBar = UIState.useState((s) => s.statusBar);
const networkBarVisible = !isOnline || statusBar !== null;
const edges = networkBarVisible ? ['left', 'right'] : ['left', 'right', 'bottom'];
```

- When NetworkStatusBar visible: no bottom edge (NetworkStatusBar handles its own bottom spacing)
- When NetworkStatusBar hidden: bottom edge keeps content above Android nav bar

### 9. BaseLayout/Content - Flex layout fix

**File:** `app/src/components/BaseLayout/Content.js`

Changed children branch from `<Stack>` wrapper to `<View style={{ flex: 1, width: '100%' }}>` for proper flex sizing.

### 10-12. Dropdown safe area insets

**Files:** `TypeOption.js`, `TypeMultipleOption.js`, `TypeCascade.js`

All dropdown/multiselect components use `useSafeAreaInsets()` with `containerStyle={{ marginBottom: insets.bottom }}` to prevent dropdown list overlays (rendered in Modal) from extending behind the Android navigation bar.

## Key Patterns Used

| Pattern | Why | Used In |
|---|---|---|
| Recursive `fetchPage` inner function | Avoids ESLint `no-await-in-loop` while being iterative | sync-datapoints.js |
| `reduce(async (prev) => { await prev; ... }, Promise.resolve())` | Sequential async iteration without `for...of` (Airbnb ESLint) | SyncService.js, Home.js, background-task.js |
| `Map<formId, { dbRecord, parsedGroups }>` form cache | Avoids re-parsing form JSON per datapoint | sync-datapoints.js, SyncService.js |
| Recursive `processBatch` with shared `counts` object | Batch processing with pass-by-reference accumulator | background-task.js |
| Lazy upload functions + chunked concurrency | Controls memory usage during file uploads | background-task.js |
| Conditional SafeAreaView edges | Avoids double bottom insets when NetworkStatusBar is visible | BaseLayout/index.js |
| `useSafeAreaInsets()` on dropdown containers | Prevents Modal-based dropdown overlays from going behind nav bar | TypeOption, TypeMultipleOption, TypeCascade |

## Memory Impact

| Metric | Before (500 datapoints) | After |
|---|---|---|
| Peak URL array | 500 items (all pages) | 100 items (1 page) |
| Form JSON parsing | 500 times | Once per unique formId |
| Pending submissions loaded | All (unbounded) | 20 at a time |
| Concurrent file uploads | All at once | 3 at a time |
| Draft processing time | 500+ seconds (1s delay each) | Seconds (no delay) |
| forEach async race conditions | Yes | No (reduce pattern) |
