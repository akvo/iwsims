# Mobile — SQLite Busy Errors & Stuck "Fetching data" Spinner

**Status**: Implemented (2026-06-11)

**Issue**: #16 `feature/16-sqlite-busy-errors-stuck-fetching-data-spinner`

## Documents

| Document | Purpose |
|----------|---------|
| [requirements.md](requirements.md) | What the fix must do and not do, acceptance criteria |
| [design.md](design.md) | Connection model, busy_timeout rationale, transaction mode, error-handling pattern |
| [implementation-plan.md](implementation-plan.md) | Ordered list of file edits with code |

---

## Reported Issues

Two field reports from tablets running the mobile app:

1. **Eternal "Fetching data" spinner** — opening a monitoring form's submission
   list (`Submission` screen, e.g. *WAF Wastewater Treatment Plant*) shows the
   "Fetching data" spinner indefinitely. Observed while the device was offline.

2. **SQL error toast on Submit** — submitting a saved monitoring draft
   (*EPS Water Quality Testing - Monitoring*) shows:

   ```
   SQL: Error: Error updating datapoint: Error updating row in table
   datapoints: Call to function 'NativeDat...' (truncated)
   ```

   The submission is not persisted as submitted; the user is left on the form.

## Root Causes

### Issue 2 — concurrent writers without `busy_timeout`

The app writes to `app.db` from **multiple SQLite connections**:

- The main `SQLiteProvider` connection (UI pages, `SyncService` foreground sync).
- Separate `useNewConnection: true` connections opened by background tasks
  (`background-task.js` ×4, the inline task in `App.js`) and `LogoutButton.js`.

WAL journal mode was enabled (migration v1), but **no `busy_timeout` was set**.
SQLite's default busy timeout is `0` ms: when the user's
`UPDATE datapoints ...` on the provider connection collides with a write from a
background-task connection, SQLite returns `SQLITE_BUSY` ("database is locked")
immediately, which expo-sqlite surfaces as
`Call to function 'NativeDatabase...' has been rejected`.

Additionally, `sql.withTransaction` used a deferred `BEGIN TRANSACTION`. In WAL
mode a deferred transaction that upgrades to a write lock mid-flight can fail
with `SQLITE_BUSY` that `busy_timeout` does **not** retry.

### Issue 1 — `fetchData` leaks the loading state

`Submission.js` `fetchData` had no `try/catch` and an early return that never
cleared `loading`:

- Any DB error (including the busy errors above) became an unhandled promise
  rejection and left `loading === true` forever → eternal spinner.
- A falsy `activeForm.id` returned early without clearing `loading`.

### Bonus defect found during investigation

`crud-forms.js` `getFormOptions` bound **3 parameters to a query with only 2
placeholders** (`[uuid, parentId, uuid]` vs `dp.uuid = ?` + `f.parentId = ?`).

## Scope

| File | Change |
|------|--------|
| `app/src/database/index.js` | New `openDatabase()` helper: opens `app.db` with `useNewConnection: true` and applies `PRAGMA busy_timeout = 5000` |
| `app/App.js` | `migrateDbIfNeeded` sets `busy_timeout` on the provider connection on every launch; inline `SYNC_FORM_SUBMISSION` task uses `openDatabase()`; drop unused `expo-sqlite` namespace import |
| `app/src/lib/background-task.js` | All four `openDatabaseAsync(DATABASE_NAME, …)` call sites use `openDatabase()`; drop unused `DATABASE_NAME` import |
| `app/src/components/LogoutButton.js` | Uses `openDatabase()` |
| `app/src/database/sql.js` | `withTransaction` uses `BEGIN IMMEDIATE TRANSACTION` |
| `app/src/pages/Submission.js` | `fetchData` wrapped in `try/catch/finally`; loading always cleared; errors reported to Sentry + Android toast; removed cosmetic 1 s spinner delay |
| `app/src/database/crud/crud-forms.js` | `getFormOptions` params fixed to `[uuid, parentId]` |

## Relationship to Prior Work

[`doc/claude/mobile-sqlite-issues`](../mobile-sqlite-issues/README.md) covered
connection **lifecycle** defects (close/delete races, ownership violations,
`forEach(async)` floats) causing `NativeDatabase` NPEs. This spec addresses the
remaining **concurrency** failure mode — `SQLITE_BUSY` between healthy
connections — plus the UI loading-state leak that turned those errors into a
permanently stuck screen.

## Verification

- ESLint passes on all changed files (run inside the `mobileapp` container;
  the only report is the pre-existing `@env` `import/no-unresolved` in
  `App.js`, present at HEAD).
- Jest could not run: the container's test environment fails at baseline
  (`jest-expo` cannot resolve `expo-modules-core/src/Refs`) on unmodified code.
- Manual scenarios to re-test on device are listed in
  [requirements.md](requirements.md#acceptance-criteria).
