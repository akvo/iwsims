# Requirements: Mobile SQLite Stability Hardening

## Background

The mobile app uses `expo-sqlite` for offline-first data storage. Crash reports (via Sentry) show recurring `NativeDatabase` `NullPointerException` errors on Android. Investigation reviewed all SQLite usage across library helpers, background tasks, navigation handlers, pages, and the foreground sync component.

## Problem Statement

Native crashes occur when the JNI layer receives a DB handle that is already closed, not yet finalized, or being deleted concurrently. A separate class of silent failures exists where async DB work is not awaited or a required argument is missing. Root causes:

1. **Close/delete races** — `closeAsync()` called without `await` before `deleteAsync()` on the same file
2. **Sync/async API mismatch** — `openDatabaseSync` paired with async close, leaving the native handle in an indeterminate state
3. **Ownership violations** — functions that receive a `db` reference close it, invalidating the handle for the caller
4. **Untracked async work** — `forEach(async …)` returns immediately while DB writes and file downloads are still in flight
5. **Missing `finally` close** — error paths skip `closeAsync()`, leaking native handles
6. **Broken background task wiring** — `syncFormSubmission` called without its required `db` argument in the background task, causing it to silently fail on every invocation

## Functional Requirements

### FR-1: Connection Ownership

- A function that opens a DB connection (`openDatabaseAsync` / `openDatabaseSync`) **must** close it in a `finally` block before returning.
- A function that **receives** a `db` argument must **never** close it.
- Provider-managed connections (`useSQLiteContext()`) are owned by the SQLiteProvider; no page or helper may call `closeAsync()` on them.

### FR-2: Sync/Async API Consistency

- All connections opened with `openDatabaseSync` must be closed with `closeSync()`.
- If `closeSync()` is not available for the target handle, the calling flow must be made fully async and `await closeAsync()` before any subsequent operation on the same file.
- `deleteAsync()` must never be called until the corresponding close has resolved.

### FR-3: Awaited Async Loops

- No `forEach(async …)` pattern is permitted for DB writes, file downloads, or any operation that must complete before the calling function returns.
- Sequential async iteration must use the `reduce` pattern (per project ESLint rules — `no-await-in-loop`, `no-restricted-syntax`):
  ```js
  await items.reduce(async (prev, item) => {
    await prev;
    await doSomething(item);
  }, Promise.resolve());
  ```
- Concurrent async iteration (order-independent) must use `Promise.all` or `Promise.allSettled` with an explicit `await`.

### FR-4: Fire-and-Forget Elimination

- All calls to `async` functions that write to the DB must be `await`ed.
- Callers of async DB helpers must themselves be `async` to enable `await`.
- Silent DB write failures (currently invisible in switch handlers) must propagate to an error boundary or be explicitly handled.

### FR-5: Background Task Safety

- Background task handlers (`TaskManager.defineTask`) must close any DB connection they open inside a `finally` block, so the handle is released even when the task body throws.
- No DB connection opened inside a background task may be passed to a helper that closes connections (FR-1).
- Error paths in background tasks must not skip `closeAsync()` — close must be in `finally`, not `try`.

### FR-6: Background Task Functional Correctness

- `defineSyncFormSubmissionTask` must pass a valid, open DB connection to `syncFormSubmission`. The current call `await syncFormSubmission()` passes no arguments, causing the task to throw immediately on its first DB access and always return `BackgroundTaskResult.Failed`.
- The fix must open a dedicated connection inside the task, pass it to `syncFormSubmission`, and close it in `finally`.

## Non-Functional Requirements

### NFR-1: ESLint Compliance

All fixed code must pass the existing Airbnb ESLint config in `app/.eslintrc.json`:
- No `for…of` loops (`no-restricted-syntax`)
- No `await` inside loops (`no-await-in-loop`)
- No `forEach(async …)` (covered by the above two rules when applied to DB/IO work)

### NFR-2: No Regressions

- The fix must not change the observable behaviour of the UI (form loading, submission, settings persistence, user login).

### NFR-3: Minimal Diff

- Changes are confined to the specific lines identified. No refactoring of unrelated logic, no new abstractions beyond what is needed to fix the ownership/await issues.

## Out of Scope

- Migrating from `expo-sqlite` to another storage library
- Changing the SQLiteProvider hierarchy in `App.js`
- Adding retry logic or offline queue beyond what already exists
- Fixing any Sentry issues not related to SQLite native crashes

## Affected Files

| File | Issues | Requirements |
|------|--------|--------------|
| `app/src/lib/cascades.js` | dropFiles forEach, loadDataSource leak, close/delete race | FR-1, FR-2, FR-3 |
| `app/src/lib/background-task.js` | syncFormVersion ownership + close in try not finally, registerBackgroundTask missing finally, defineSyncFormVersionTask transitive leak, defineSyncFormSubmissionTask missing db | FR-1, FR-5, FR-6 |
| `app/src/components/SyncService.js` | Unhandled rejection from setInterval callback | FR-4 (minor) |
| `app/src/pages/FormPage.js` | openDatabaseSync + non-awaited closeAsync in forEach | FR-2, FR-3 |
| `app/src/pages/AddUser.js` | forEach(async) for form upsert + cascade download | FR-3 |
| `app/src/pages/AuthForm.js` | nested forEach(async) in login handler | FR-3 |
| `app/src/pages/Settings/SettingsForm.js` | fire-and-forget DB write in switch handler | FR-4 |
| `app/src/navigation/index.js` | provider DB passed to syncFormVersion which closes it | FR-1 |
| `app/App.js` | background task missing finally close | FR-5 |

## Success Criteria

- [ ] `NullPointerException` / `NativeDatabase` crashes no longer appear in Sentry for the patched code paths
- [ ] All `forEach(async …)` patterns in the affected files are eliminated
- [ ] `openDatabaseSync` is never paired with `closeAsync()` without an `await`
- [ ] `syncFormVersion` does not call `db.closeAsync()` internally; all callers manage their own lifecycle in `finally`
- [ ] `dropFiles` properly awaits all file delete operations before returning
- [ ] `defineSyncFormSubmissionTask` opens its own DB connection and passes it to `syncFormSubmission`
- [ ] `registerBackgroundTask` closes its DB connection in `finally`
- [ ] ESLint passes with no new errors on all changed files
- [ ] Background form submission task succeeds (no longer always returns `Failed`)
