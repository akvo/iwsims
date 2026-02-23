# Plan: Optimize Datapoint Sync — Per-Form Iterative Download + Fix Bugs

## Context

Three problems need to be solved together:

**1. Memory waste**: `fetchAndGroupDatapointsByForm()` fetches ALL datapoint metadata across ALL forms into a `Map<formId, Array>` in memory before processing. For 500+ datapoints, this wastes memory and time.

**2. Progress/retry bugs when app is killed mid-sync**:
- Progress can exceed 100% (reported 105%) — caused by double-counting in `globalProcessed`: line 254 adds `queueRow.totalData` for skipped forms, then line 294 increments per-item, and `getAllProgress()` uses hardcoded `lastPage * 20` that doesn't match actual page sizes
- Sync retry fails after phone screen off / app kill — queue's `totalData` becomes stale when `fetchAndGroupDatapointsByForm()` returns different counts on resume vs. first run
- Dashboard count mismatch — three divergent sources: `countSyncedByFormId()`, `getAllProgress().processed`, and `formProgress.total`

**3. `expo-background-fetch` is deprecated** — needs removal. The foreground `SyncService` timer already covers sync execution.

**Solution**: Backend now supports `form_id` on `/datapoint-list`. Replace the two-phase approach with a single-pass per-form iterator. Track progress by actual API page numbers. Remove background-fetch entirely.

---

## Changes

### 1. Backend: `views.py` — Skip `last_synced_at` when `form_id` filtered

**File**: `backend/api/v1/v1_mobile/views.py` (lines 627-631)

The backend updates `last_synced_at` when last page is reached. With per-form requests, form A's last page would update the timestamp, causing form B to miss existing datapoints.

```python
# BEFORE (line 629):
if page == total_page:

# AFTER:
if page == total_page and not form_id:
```

### 2. Backend: `views.py` — Add sync-complete endpoint

New endpoint after `get_datapoint_download_list`. Mobile calls this after ALL forms are synced:

```python
@extend_schema(
    tags=["Mobile Device Form"],
    summary="Mark datapoint sync as complete",
    responses={200: DefaultResponseSerializer},
)
@api_view(["POST"])
@permission_classes([IsMobileAssignment])
def mark_sync_complete(request, version):
    assignment = cast(MobileAssignmentToken, request.auth).assignment
    assignment.last_synced_at = timezone.now()
    assignment.save()
    return Response({"message": "ok"}, status=status.HTTP_200_OK)
```

### 3. Backend: `urls.py` — Register new endpoint

**File**: `backend/api/v1/v1_mobile/urls.py`

Add import + URL pattern for `mark_sync_complete` at path `/device/sync-complete`.

### 4. Backend Tests — form_id filter + sync-complete endpoint

**File**: `backend/api/v1/v1_mobile/tests/tests_mobile_datapoint_list.py`

Add these tests to `MobileDataPointDownloadListTestCase`. They reuse the existing setUp which creates `self.forms` (multiple parent forms), `self.form_data` (on `self.forms[0]`), `self.passcode`, `self.mobile_assignment`, `self.adm_children`.

```python
def test_get_datapoints_list_with_form_id_filter(self):
    """Filter by form_id returns only that form's datapoints."""
    # Create data for a second form
    second_form_data = FormData.objects.create(
        name="Second Form Data",
        geo=None,
        form=self.forms[1],
        administration=self.adm_children.first(),
        created_by=self.user,
        uuid="uuid-second-form",
    )
    add_fake_answers(second_form_data)

    code = {"code": self.passcode}
    response = self.client.post(
        "/api/v1/device/auth",
        code,
        content_type="application/json",
    )
    token = response.data["syncToken"]

    # Without form_id → both datapoints
    response = self.client.get(
        "/api/v1/device/datapoint-list/",
        follow=True,
        content_type="application/json",
        **{"HTTP_AUTHORIZATION": f"Bearer {token}"},
    )
    self.assertEqual(response.status_code, status.HTTP_200_OK)
    self.assertEqual(response.json()["total"], 2)

    # Re-auth to reset last_synced_at
    self.client.post(
        "/api/v1/device/auth",
        code,
        content_type="application/json",
    )
    token_2 = self.client.post(
        "/api/v1/device/auth",
        code,
        content_type="application/json",
    ).data["syncToken"]

    # With form_id → only that form's datapoints
    response = self.client.get(
        f"/api/v1/device/datapoint-list/?form_id={self.forms[0].id}",
        follow=True,
        content_type="application/json",
        **{"HTTP_AUTHORIZATION": f"Bearer {token_2}"},
    )
    self.assertEqual(response.status_code, status.HTTP_200_OK)
    data = response.json()
    self.assertEqual(data["total"], 1)
    self.assertEqual(data["data"][0]["form_id"], self.forms[0].id)

def test_get_datapoints_list_with_invalid_form_id(self):
    """form_id not in assignment returns 404."""
    code = {"code": self.passcode}
    response = self.client.post(
        "/api/v1/device/auth",
        code,
        content_type="application/json",
    )
    token = response.data["syncToken"]

    response = self.client.get(
        "/api/v1/device/datapoint-list/?form_id=999999",
        follow=True,
        content_type="application/json",
        **{"HTTP_AUTHORIZATION": f"Bearer {token}"},
    )
    self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

def test_form_id_filter_does_not_update_last_synced_at(self):
    """When form_id is specified, last_synced_at should NOT be updated."""
    code = {"code": self.passcode}
    response = self.client.post(
        "/api/v1/device/auth",
        code,
        content_type="application/json",
    )
    token = response.data["syncToken"]

    # Fetch with form_id (reaches last page)
    response = self.client.get(
        f"/api/v1/device/datapoint-list/?form_id={self.forms[0].id}",
        follow=True,
        content_type="application/json",
        **{"HTTP_AUTHORIZATION": f"Bearer {token}"},
    )
    self.assertEqual(response.status_code, status.HTTP_200_OK)

    # last_synced_at should still be None
    self.mobile_assignment.refresh_from_db()
    self.assertIsNone(self.mobile_assignment.last_synced_at)

def test_no_form_id_does_update_last_synced_at(self):
    """Without form_id, last_synced_at IS updated on last page (existing behavior)."""
    code = {"code": self.passcode}
    response = self.client.post(
        "/api/v1/device/auth",
        code,
        content_type="application/json",
    )
    token = response.data["syncToken"]

    response = self.client.get(
        "/api/v1/device/datapoint-list/",
        follow=True,
        content_type="application/json",
        **{"HTTP_AUTHORIZATION": f"Bearer {token}"},
    )
    self.assertEqual(response.status_code, status.HTTP_200_OK)

    self.mobile_assignment.refresh_from_db()
    self.assertIsNotNone(self.mobile_assignment.last_synced_at)

def test_mark_sync_complete(self):
    """POST /sync-complete updates last_synced_at."""
    code = {"code": self.passcode}
    response = self.client.post(
        "/api/v1/device/auth",
        code,
        content_type="application/json",
    )
    token = response.data["syncToken"]

    self.mobile_assignment.refresh_from_db()
    self.assertIsNone(self.mobile_assignment.last_synced_at)

    response = self.client.post(
        "/api/v1/device/sync-complete",
        content_type="application/json",
        **{"HTTP_AUTHORIZATION": f"Bearer {token}"},
    )
    self.assertEqual(response.status_code, status.HTTP_200_OK)

    self.mobile_assignment.refresh_from_db()
    self.assertIsNotNone(self.mobile_assignment.last_synced_at)

def test_mark_sync_complete_unauthenticated(self):
    """POST /sync-complete without token returns 403."""
    response = self.client.post(
        "/api/v1/device/sync-complete",
        content_type="application/json",
    )
    self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
```

### 5. Implementation Order

**Backend first, then mobile:**
1. Changes 1-3 (backend views.py + urls.py)
2. Change 4 (backend tests) — run tests to verify
3. Changes 6-9 (mobile app)

---

### 6. Mobile: `sync-datapoints.js` — Replace metadata collection with per-form iterator

**File**: `app/src/lib/sync-datapoints.js`

**Remove**: `fetchAndGroupDatapointsByForm` (lines 69-116)

**Add** `fetchFormDatapointsPageByPage`:
- Takes `formId`, `onPageReceived` callback, `startPage` (for resume), `pageSize` (default 100)
- Uses recursive `fetchPage` pattern (ESLint-safe, stack-safe)
- Calls `GET /datapoint-list?form_id={formId}&page={n}&page_size={pageSize}`
- Processes each page via callback immediately — only 1 page in memory
- Returns `{ totalProcessed, totalPage, total }`

**Add** `markSyncComplete`:
- Calls `POST /sync-complete` to update `last_synced_at`

### 7. Mobile: `SyncService.js` — Rewrite `onSyncDataPoint`

**File**: `app/src/components/SyncService.js`

Replace lines 200-326 (two-phase metadata+download) with single-pass per-form loop:

```
1. Get registration forms from SQLite: crudForms.selectLatestFormVersion(db, {user})
   (already filtered to parentId IS NULL)
2. Quick-check: if queue complete & local counts match → skip
3. For each registration form:
   a. Check queue for resume page (lastPage, default 0)
   b. Call fetchFormDatapointsPageByPage(formId, callback, lastPage + 1, 100)
   c. On first page response: upsert queue with API's total + total_page
   d. In callback: download each item's JSON via downloadDatapointsJson()
   e. After each API page completes: updateLastPage in queue
   f. Clear formCache after form completes
4. Call markSyncComplete()
5. Delete job, reset state
```

**Progress calculation fix** — use queue as single source of truth:
- `totalCount` = sum of all forms' `queue.totalData`
- `globalProcessed` = sum of completed forms' `totalData` + current form's items processed so far
- Progress = `Math.min((globalProcessed / totalCount) * 100, 100)` — capped at 100%
- No double-counting: completed forms counted from queue, current form counted from loop

**Resume fix** — no stale data:
- Queue stores API page number (1-based), not synthetic item-based pages
- On resume, pass `lastPage + 1` as `startPage` — API handles filtering correctly
- No need to re-fetch all metadata; just continue from where we left off
- `totalData` refreshed from first API page response (API returns `total` count)

### 8. Mobile: `crud-sync-queue.js` — Fix progress calculation

**File**: `app/src/database/crud/crud-sync-queue.js`

Fix `getAllProgress` (line 39): replace hardcoded `lastPage * 20` with dynamic page size:

```javascript
getAllProgress: async (db) => {
    const rows = await sql.safeExecuteQuery(db, `SELECT * FROM ${tableName}`, [], 'getAllProgress');
    const result = {};
    rows.forEach((r) => {
      result[r.formId] = {
        total: r.totalData,
        processed: r.lastPage >= r.totalPage
          ? r.totalData
          : r.totalPage > 0
            ? Math.min(Math.round((r.lastPage / r.totalPage) * r.totalData), r.totalData)
            : 0,
      };
    });
    return result;
},
```

### 9. Mobile: Migrate `expo-background-fetch` → `expo-background-task`

The API is nearly identical ([migration guide](https://expo.dev/blog/goodbye-background-fetch-hello-expo-background-task)). Key differences:
- New package: `expo-background-task` replaces `expo-background-fetch`
- `minimumInterval` is now in **minutes** (was seconds). Min = 15 minutes.
- Return values: `BackgroundTaskResult.Success` / `BackgroundTaskResult.Failed` (no `NoData`)
- No `stopOnTerminate`/`startOnBoot` options (WorkManager handles this automatically on Android)
- `expo-task-manager` is **kept** (still needed for `TaskManager.defineTask()`)
- Uses WorkManager (Android) + BGTaskScheduler (iOS) — modern APIs

#### 9a. Install / Uninstall packages

```bash
./dc-mobile.sh exec mobile npx expo install expo-background-task
./dc-mobile.sh exec mobile npm uninstall expo-background-fetch
```

Keep `expo-task-manager` — it's still required.

#### 9b. `app/src/lib/background-task.js` — Update imports + return values

```javascript
// BEFORE:
import * as BackgroundFetch from 'expo-background-fetch';

// AFTER:
import * as BackgroundTask from 'expo-background-task';
```

Replace all return values:
| Old | New |
|-----|-----|
| `BackgroundFetch.BackgroundFetchResult.NewData` | `BackgroundTask.BackgroundTaskResult.Success` |
| `BackgroundFetch.BackgroundFetchResult.NoData` | `BackgroundTask.BackgroundTaskResult.Success` |
| `BackgroundFetch.Result.Failed` | `BackgroundTask.BackgroundTaskResult.Failed` |

Update `registerBackgroundTask`:
```javascript
// BEFORE:
const res = await BackgroundFetch.registerTaskAsync(TASK_NAME, {
  minimumInterval: syncInterval,       // seconds (e.g., 3600)
  stopOnTerminate: false,
  startOnBoot: true,
});

// AFTER:
const intervalMinutes = Math.max(Math.round(syncInterval / 60), 15); // min 15 minutes
const res = await BackgroundTask.registerTaskAsync(TASK_NAME, {
  minimumInterval: intervalMinutes,    // minutes (min 15)
});
```

Update `unregisterBackgroundTask`:
```javascript
// BEFORE:
await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
// AFTER:
await BackgroundTask.unregisterTaskAsync(TASK_NAME);
```

Update `backgroundTaskStatus`:
```javascript
// BEFORE:
await BackgroundFetch.getStatusAsync();
// AFTER:
await BackgroundTask.getStatusAsync();
```

Update `defineSyncFormVersionTask` and `defineSyncFormSubmissionTask` return values similarly.

#### 9c. `app/App.js` — Update imports + task definitions

```javascript
// BEFORE:
import * as BackgroundFetch from 'expo-background-fetch';

// AFTER:
import * as BackgroundTask from 'expo-background-task';
```

Update `TaskManager.defineTask(SYNC_FORM_SUBMISSION_TASK_NAME, ...)` block:
```javascript
// BEFORE (line 91):
return BackgroundFetch.BackgroundFetchResult.NewData;
// AFTER:
return BackgroundTask.BackgroundTaskResult.Success;

// BEFORE (line 95):
return BackgroundFetch.Result.Failed;
// AFTER:
return BackgroundTask.BackgroundTaskResult.Failed;
```

#### 9d. Add background datapoint sync task

Currently datapoint sync only runs in the foreground. When the phone screen turns off, sync stops and retry fails. Add a background task that continues datapoint sync progressively.

**`app/src/lib/constants.js`** — add new constant:
```javascript
export const SYNC_DATAPOINT_BACKGROUND_TASK_NAME = 'sync-datapoint-background';
```

**`app/src/lib/background-task.js`** — add new task function:
```javascript
/**
 * Background datapoint sync: processes ONE form at a time, saves progress.
 * Each background trigger continues from where the last one left off.
 * Time-limited to avoid OS killing the task.
 */
const syncDatapointsBackground = async () => {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME, {
    useNewConnection: true,
  });
  try {
    const session = await crudUsers.getActiveUser(db);
    if (!session?.token) {
      await db.closeAsync();
      return;
    }
    api.setToken(session.token);

    const activeJob = await crudJobs.getActiveJob(db, SYNC_DATAPOINT_JOB_NAME);
    if (!activeJob) {
      await db.closeAsync();
      return;
    }

    // Get incomplete forms from sync queue
    const incompleteForms = await crudSyncQueue.getIncompleteForms(db);
    if (!incompleteForms.length) {
      await crudJobs.deleteJob(db, activeJob.id);
      await markSyncComplete(); // POST /sync-complete
      await db.closeAsync();
      return;
    }

    // Process first incomplete form only (time-limited)
    const queueRow = incompleteForms[0];
    const { formId } = queueRow;
    const startPage = queueRow.lastPage + 1;
    const formCache = new Map();

    await fetchFormDatapointsPageByPage(
      formId,
      async (pageData, page, totalPage, total) => {
        // Upsert queue on first page (in case total changed)
        if (page === startPage) {
          await crudSyncQueue.upsertQueue(db, [{
            formId,
            totalPage,
            totalData: total,
          }]);
        }
        // Download each datapoint on this page
        await pageData.reduce(async (prev, item) => {
          await prev;
          try {
            await downloadDatapointsJson(
              db,
              {
                url: item.url,
                formId: item.form_id,
                administrationId: item.administration_id,
                lastUpdated: item.last_updated,
              },
              session.id,
              formCache,
            );
          } catch (err) {
            Sentry.captureException(err);
          }
        }, Promise.resolve());
        // Mark page complete
        await crudSyncQueue.updateLastPage(db, formId, page);
      },
      startPage,
      100,
    );

    formCache.clear();
    await db.closeAsync();
  } catch (err) {
    Sentry.captureException(err);
    await db.closeAsync();
  }
};

export const defineSyncDatapointBackgroundTask = () =>
  TaskManager.defineTask(SYNC_DATAPOINT_BACKGROUND_TASK_NAME, async () => {
    try {
      await syncDatapointsBackground();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (err) {
      Sentry.captureException(err);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
```

**`app/App.js`** — register the new task:
```javascript
import { defineSyncFormVersionTask, defineSyncDatapointBackgroundTask } from './src/lib/background-task';
import { SYNC_DATAPOINT_BACKGROUND_TASK_NAME } from './src/lib/constants';

defineSyncFormVersionTask();
defineSyncDatapointBackgroundTask(); // NEW

// In handleOnRegisterTask, add SYNC_DATAPOINT_BACKGROUND_TASK_NAME to the allowed list
```

**`app/src/pages/Home.js`** — register background task when sync starts:
When user taps Sync, also register the background datapoint task so it continues if app goes to background:
```javascript
await backgroundTask.registerBackgroundTask(SYNC_DATAPOINT_BACKGROUND_TASK_NAME);
```

#### 9e. Mobile tests — SKIP

Mobile app tests are outdated and will not be updated in this change.

---

## What Gets Removed

1. `fetchAndGroupDatapointsByForm()` from `sync-datapoints.js`
2. Metadata Map construction + iteration logic in `SyncService.js` (lines 200-220)
3. Synthetic page tracking (`items.slice(startIndex)`, `itemsOnPage` counter)
4. `expo-background-fetch` dependency (replaced by `expo-background-task`)

## What Stays / Gets Migrated

- `downloadDatapointsJson()` — still called per item, no changes
- `fetchDraftDatapointsPageByPage()` — separate flow, unchanged
- Form cache pattern (`new Map()` per form) — still used
- Error handling / Sentry reporting — unchanged
- Sync queue table schema (formId, lastPage, totalPage, totalData) — unchanged
- `syncFormSubmission()` and `processBatch()` — migrated to new return values
- `syncFormVersion()` — migrated to new return values
- `expo-task-manager` — kept (still needed for `TaskManager.defineTask()`)
- `defineSyncFormVersionTask` — migrated to `expo-background-task` return values
- `defineSyncFormSubmissionTask` — migrated to `expo-background-task` return values
- **NEW**: `defineSyncDatapointBackgroundTask` — background datapoint sync (progressive)

## Bug Fixes Summary

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Progress >100% | Double-counting: `globalProcessed += queueRow.totalData` (line 254) + per-item increment (line 294); hardcoded `lastPage * 20` in getAllProgress | Single-pass loop with no double-counting; dynamic progress from queue; `Math.min(..., 100)` cap |
| Retry fails after kill | Queue `totalData` stale from previous `fetchAndGroupDatapointsByForm()` run; new API data doesn't match old pages | No pre-collection phase; queue populated from live API response; resume by API page number |
| Count mismatch | Three divergent sources of truth | Queue is single source; progress derived from queue `lastPage/totalPage` ratio |
| Sync stops on screen off | No background task for datapoint sync; only foreground SyncService | New `expo-background-task` continues sync progressively in background |
| Background fetch deprecated | `expo-background-fetch` uses deprecated iOS/Android APIs | Migrate to `expo-background-task` (WorkManager + BGTaskScheduler) |

## Verification

1. **Backend tests**: `./dc.sh exec backend python manage.py test api.v1.v1_mobile`
2. **Mobile lint**: `./dc-mobile.sh exec mobile npm run lint`
3. **Manual testing**:
   - Sync multi-form assignment → all datapoints download, progress 0→100%
   - Kill app mid-sync → reopen → sync resumes from correct page, completes correctly
   - Dashboard counts match after sync completes
   - Incremental sync (add data on backend, re-sync gets only new)
   - Verify no background-fetch errors in logs after removal

## Doc Output

Create `doc/claude/optimize-datapoint-sync-per-form-iterative.md` with this plan content.
