# Mobile: form card count matches the server list

## Part 1: card counts

### Problem

Several mobile assignments with the **same** scope (same administrations, same forms) show different totals on the Home form cards, even though the server offers all of them the same `datapoint-list`.

Causes found:

| Cause | Effect |
|---|---|
| The card title `(N)` counts every `submitted=1 AND syncedAt IS NOT NULL` row, including the device's own uploads that are still **pending approval** | The bracket is higher than the server count on devices that submit data |
| Migration 05 back-filled `locallyCreated = 1` on **all** existing rows, including rows downloaded from the server | "Synced" is inflated on devices that upgraded across migration 05 |
| Rows soft-deleted on the server are never removed from devices. The web delete only sets `deleted_at` (it doesn't bump `updated`), so `datapoint-list` never reports them | The bracket or Synced is higher than the server count |
| Some datapoint JSON files were stored with mode 0600, so nginx returns 403 | Devices are short by exactly the unreadable rows, and their sync can never finish. Fixed in Part 3 |

### Decision: a "server-list" meaning for the counts

A row counts as **downloaded** (`locallyCreated = 0`) once the server has returned it in `datapoint-list`, whoever created it.

| Label | Meaning | Condition |
|---|---|---|
| `Form (N)` | rows in the server list that this device holds | `submitted=1 AND syncedAt NOT NULL AND locallyCreated=0` |
| Submitted | on the device, not uploaded yet | `locallyCreated=1 AND submitted=1 AND syncedAt IS NULL` (unchanged) |
| Draft | drafts | unchanged |
| Synced | uploaded, but the server doesn't list it yet (awaiting approval or rejected) | `locallyCreated=1 AND submitted=1 AND syncedAt NOT NULL` (unchanged) |

- **No migration.** The `locallyCreated` column already exists; only how it is written changes.
- **One new backend endpoint** reports soft-deleted uuids, so devices can remove them. Without it, deleted rows are invisible: an app-only "not in the full list" diff breaks on resumed or partial pagination, and it can't tell them apart from the device's own pending rows.
- The Sync button requests the **full** list (`/auth?keep_last_synced_at=false`). That corrects the rows mislabelled by migration 05, which an incremental sync never returns. JSON files are only re-downloaded when the server copy is newer, so the extra cost is one list request per 100 rows per form.
- Background sync stays incremental. Approval bumps `FormData.updated` (`backend/api/v1/v1_data/tasks.py`, `seed_approved_data`), so an approved own submission arrives in the next change list and moves from Synced to `(N)`.
- **Deleted rows aren't handled with wipe-and-reload, unlike drafts:**
  - `datapoint-list` only returns URLs, so a reload would re-download every JSON file on each Sync.
  - A reload that stops partway would remove rows the server still has.

### Implementation

Scope: `app/`, plus one read-only backend endpoint. **Deploy the backend before the app.** A new app against an old backend gets a 404 on the new endpoint and would never mark the sync complete. **Do not commit until manual verification is approved.**

#### Step 1: downloaded rows become `locallyCreated = 0`

`app/src/database/crud/crud-datapoints.js` (`updateByUUID`): this function is only called from `downloadDatapointsJson`. Add `locallyCreated: 0` to its SET clause.

`app/src/lib/sync-datapoints.js` (`downloadDatapointsJson`):

| Path | Behaviour |
|---|---|
| existing, `syncedAt` NULL (unsent local edits) | unchanged: return, keep `locallyCreated` |
| existing, unchanged (`existing.syncedAt >= lastUpdated`) | **new:** if `existing.locallyCreated === 1`, run `sql.updateRow(db, 'datapoints', { id: existing.id }, { locallyCreated: 0 })`, then return. No network call |
| existing, changed | `updateByUUID` (now also sets `locallyCreated = 0`) |
| new row | insert. `locallyCreated` falls back to the column default 0 (unchanged) |

Update the stale "immutable origin flag" comments in `markSynced` (`crud-datapoints.js`), in `08_add_submission_key.js` (comment only), and in the counters in `crud-forms.js`.

#### Step 2: the Sync button requests the full list

`app/src/pages/Home.js` (`syncUserForms`): change `keep_last_synced_at=true` to `false`. `background-task.js` stays `true`.

#### Step 3: the bracket counts downloaded rows only

`app/src/database/crud/crud-forms.js` (`selectLatestFormVersion`): add `AND dp.locallyCreated = 0` to `registered`. `submitted`, `draft` and `synced` stay unchanged.

#### Step 4: backend endpoint `GET /api/v1/device/deleted-datapoints?form_id=<id>`

`backend/api/v1/v1_mobile/views.py` + `urls.py`, permission `IsMobileAssignment`:
- Move the assignment scope filter (previously inline in `get_datapoint_download_list`) into a shared helper, `_assignment_datapoint_scope`, with the same logic. Both views use it.
- Query: `FormData.objects_deleted` in scope, `form_id=<id>` (a registration form of this assignment, otherwise 404), `is_draft=False`. This includes deleted pending rows, so an own submission deleted before approval also leaves the device.
- If `assignment.last_synced_at` is set: `deleted_at >= last_synced_at`. With a full sync (the Sync button) it returns every deleted uuid.
- Exclude any uuid that still has a live row in the same form.
- Response: `{"uuids": [...]}`, not paginated (`# ponytail:` comment: paginate if it reaches thousands).
- Read-only: it never touches `last_synced_at`.
- Tests in `backend/api/v1/v1_mobile/tests/tests_mobile_deleted_datapoint_list.py`:
  - a deleted row in scope is returned, including a deleted pending one
  - out-of-scope rows, other forms and drafts are not returned
  - a uuid that still has a live row is excluded
  - the `last_synced_at` cut-off is applied, and `last_synced_at` is not changed
  - a missing, invalid, unknown or child `form_id` gives 404

#### Step 5: the app removes deleted rows

- `app/src/lib/sync-datapoints.js`: a new `removeDeletedDatapoints(db, formId)`. It calls the endpoint, resolves the local form with `crudForms.getByFormId`, and runs `crudDataPoints.deleteSyncedByUUIDs(db, { form, uuids })`.
- `app/src/database/crud/crud-datapoints.js` gets the new `deleteSyncedByUUIDs`:
  ```sql
  DELETE FROM datapoints
  WHERE form = ? AND submitted = 1 AND syncedAt IS NOT NULL AND uuid IN (...)
  ```
  - It never deletes drafts (`submitted = 0`) or rows with unsent changes (`syncedAt IS NULL`).
  - It deletes both origins (`locallyCreated` 0 or 1), so the back-filled rows from migration 05 are cleaned up too.
- It runs inside `finishDatapointSync` (Part 2, Step 3), for every form in the sync queue, immediately **before** `markSyncComplete`.
  - If it fails, `markSyncComplete` is skipped, so `last_synced_at` doesn't advance and the next sync reports the same deletions again.
  - It isn't called per form: the background task marks a form complete as soon as its last page is saved, so a per-form failure couldn't keep the sync incomplete.

#### Step 6: tests and checks

`app/src/lib/__tests__/sync-datapoints.test.js` (mocks `crud`, `sql`, `api`):
1. existing, unchanged, `locallyCreated = 1` → flipped to 0, no download
2. existing, unchanged, `locallyCreated = 0` → no update, no download
3. existing with `syncedAt` NULL → untouched
4. existing, changed → `updateByUUID`
5. new row → `saveDataPoint` without `locallyCreated`
6. `removeDeletedDatapoints`:
   - deletes the returned uuids from the local form
   - does nothing when the list is empty
   - rethrows when the request fails

Run:
- app: the touched jest suites plus ESLint and Prettier
- backend: `./dc.sh exec backend python manage.py test api.v1.v1_mobile` plus `flake8`

#### Step 7: manual verification (before any commit)

On a device that upgraded across migration 05, using a dev build:
1. Note the Home cards before the change.
2. Install the build and press **Sync**. Wait for the datapoint sync to finish.
3. Expect, for each form:
   - `(N)` = the server's count of live, non-pending, non-draft rows in scope
   - Synced = this device's own submissions still pending approval
   - Submitted and Draft unchanged
4. Submit one new registration → Submitted +1. Press Sync → Submitted −1, Synced +1, `(N)` unchanged.
5. Approve that submission on the web, then press Sync → Synced −1, `(N)` +1.
6. Delete a datapoint on the web, then press Sync → `(N)` −1, and the datapoint is gone from the device's list.
7. A fresh install with the same passcode shows the same `(N)` as step 3, with Synced 0.

### Known limitations (not fixed here)

- Hard-deleted rows (only drafts use `hard_delete`) leave no trace on the server, so they can't be reported. Registration datapoints are only soft-deleted, so they are covered.
- Local monitoring (child) rows of a deleted parent are kept.

---

## Part 2: tell the user when a datapoint sync is incomplete

### Problem

A datapoint download that stops partway looks finished: some cards show a partial `(N)`, others none, and nothing says the download stopped.

Downloads only run while the app is in the foreground. The datapoint background task runs at the OS's discretion, at most every 15 minutes. Switching to another app is therefore the most common interruption.

The sync can resume (`datapoint_sync_queue` keeps each form's `lastPage` until the whole sync succeeds), but the user isn't told:

| Case | What happens today |
|---|---|
| The user switches to another app mid-download | requests fail or pause; when they come back, any failed items leave the job PENDING, yet the banner still says **"Done"** |
| Some items fail (e.g. JSON files returning 403) | `hasErrors` → job back to PENDING; `runSyncSequence` still shows the green **"Done"** banner |
| Android kills the app in the background, or it crashes | on reopen nothing is shown |
| Retries exhausted (`MAX_ATTEMPT`) | the job is deleted silently; the queue stays incomplete |
| One item fails on page 2, page 3 succeeds | page 3 overwrote `lastPage`, so the queue says the form is complete; the sync is flagged as having errors, so the final step is skipped. Result: every form "done", sync never finished, and the failed page is not the resume point |
| Deleted-uuid removal or `markSyncComplete` fails (Part 1) | the job is deleted and the queue is not cleared; still shows "Done". The next run's "quick check" then deletes the job again without ever retrying that step |

### Decision

**"Incomplete" = `datapoint_sync_queue` has rows while no datapoint sync is running.** The queue is only cleared after `markSyncComplete` succeeds, so it covers every case above with no new state.

The banner shows a **forms** count: "Download incomplete: 2 of 5 forms. Press Sync to resume."
- **X** = queue rows with `lastPage >= totalPage`. A form with failed items never advances its page, so it stays unfinished.
- **Y** = the user's registration forms (`selectLatestFormVersion`). Nothing extra is requested from the server.
- If X ≥ Y (every form fetched but the final step failed), show "Download not finished. Press Sync to resume." with no count.
- A datapoint count is not used: the queue only learns a form's total when the sync reaches it, and the total means different things in full and incremental syncs.

### Step 1: a new status

- `lib/constants.js`: `SYNC_STATUS.incomplete = 5`.
- `lib/i18n/ui-text.js`, EN and FR:
  - `syncIncompleteText` with `{done}` / `{total}` placeholders
  - `syncIncompleteShortText` with no count
- `components/StatusBanner.js`: amber (`#d97706`, icon `alert-circle`), sticky (only `success` auto-dismisses).
  - Precedence: sync activity > low storage > **incomplete** > failed > offline.
  - The icon and text sit in a horizontal `ScrollView` (one line, no scroll indicator). Short messages stay centred; a message wider than the screen, such as the FR text on a narrow phone, can be swiped sideways instead of being cut off. This applies to every banner message.

### Step 2: build the status

- `lib/sync-datapoints.js`: `getIncompleteSyncStatus(db, user)`. It returns `null` when the queue is empty, otherwise `{ type: incomplete, bgColor, icon, done, total }`.
- `database/crud/crud-sync-queue.js`: `getFormsProgress(db)` returns `{ queued, done }`.

### Step 3: one final step for every path

`lib/sync-datapoints.js` gets `finishDatapointSync(db)`:
- It removes deleted uuids for every queued form, then runs `markSyncComplete`, then `clearQueue`.
- If it throws, the queue stays.

It's used in three places:
- the end of `SyncService.onSyncDataPoint`
- the "quick check" shortcut (all pages already in), which used to delete the job without retrying the final step
- `background-task.js`

### Step 3b: never save progress past a failed page

- `lib/sync-datapoints.js` gets `createPageProgressSaver(db, formId)`, used per form by both `SyncService.js` and `background-task.js`.
- `lastPage` only advances while every page so far succeeded. After a page with a failed item, later pages still download, but the queue keeps pointing before the failed page.
- The form then stays incomplete, the banner shows the real "X of Y forms", and the next Sync resumes from the failed page.

### Step 4: set the status instead of a false "Done"

`components/SyncService.js`:
- **End of `runSyncSequence`:** `(await getIncompleteSyncStatus(db, userId)) || success`.
- **Whenever the banner is empty:** app start, or after "Done" auto-dismisses. A periodic upload can show "Done" too. If no sync is running, show the incomplete status. This covers a killed app, a dropped job, and a return from another app.

Nothing resumes automatically. Pressing Sync creates a new job if needed, and it resumes from the queue's `lastPage`. That's why the banner says "Press Sync to resume".

### Step 5: tests

- `sync-datapoints.test.js`:
  - `finishDatapointSync`: deletions for every queued form, then `sync-complete`, then clear. A failure skips both.
  - `getIncompleteSyncStatus`: `null` when the queue is empty; otherwise `done`/`total` from the queue and the forms.
  - `createPageProgressSaver`: advances while pages succeed; a good page after a failed one doesn't move `lastPage`.
- `StatusBanner.test.js` covers:
  - "X of Y forms"
  - the short text when X ≥ Y
  - low storage wins over incomplete

  This suite doesn't load in the current jest setup (`ReactCurrentOwner` undefined; it fails the same way on `main`). Until that's fixed, the banner has to be checked manually.

### Manual verification

1. Press Sync, and switch to another app during the download. Come back after the sync ends → amber "Download incomplete: X of Y forms", not "Done".
2. Kill the app mid-download and reopen it → the same banner appears on start.
3. Press Sync and let it finish → green "Done", then no banner.
4. If a datapoint file returns 403 (see Part 3), the sync always ends in the incomplete banner, because that item fails on every attempt.
5. If one item fails partway through a form (e.g. a network drop), the banner shows "X of Y forms", with that form counted as not done. The next Sync resumes that form from the failed page.

### Not included

- The banner can't be tapped. Resuming stays on the existing Sync button.

---

## Part 3: datapoint files the web server couldn't read

### Problem

The app downloads each datapoint from `/datapoints/<uuid>.json`, which nginx in the `frontend` container serves from the shared storage volume. Many of these files returned **403**:

- `FormData.save_to_file` writes the JSON to a `tempfile.NamedTemporaryFile` (mode 0600), then calls `storage.upload`.
- `storage.upload` used `shutil.copy2`, which copies permission bits. The stored file ended up `-rw------- root`, which nginx (uid 101) can't read. `seeder_answer_processor` stored images the same way.

With Parts 1 and 2 in place, those items fail on every sync:

- the forms containing them never finish, and neither does the sync;
- server deletions are never applied, and `last_synced_at` never advances;
- the incomplete banner stays up.

A device compared against the server showed its missing rows were exactly the unreadable files.

### Fix

- `backend/utils/storage.py` (`upload`): `shutil.copyfile` (content only), then `os.chmod(location, 0o644)`.
  - The explicit `chmod` also covers an **overwrite**: `copyfile` into an existing file keeps that file's old mode, and re-saving an edited datapoint overwrites its JSON.
- `backend/api/v1/v1_data/tests/tests_storage.py`: a 0600 source, and an overwrite of an existing 0600 file, both end up `0644`.

### One-off repair of files already stored

Run in the backend container. `/app/storage` is the same NFS volume nginx serves, so the change persists across pod restarts:

```bash
kubectl -n iwsims-namespace exec -it deploy/iwsims -c backend -- bash
find /app/storage/datapoints /app/storage/images -type f ! -perm -o=r | wc -l          # count
find /app/storage/datapoints /app/storage/images -type f ! -perm -o=r -exec chmod go+r {} +
find /app/storage/datapoints /app/storage/images -type f ! -perm -o=r | wc -l          # expect 0
```

- It has been applied on the test cluster: 2,746 files (2,582 datapoints and 164 images), now 0. Devices then finished their sync.
- Run it again after deploying the code fix, to catch files written in between.
