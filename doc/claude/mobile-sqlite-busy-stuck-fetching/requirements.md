# Requirements — SQLite Busy Errors & Stuck "Fetching data" Spinner

## Problem Statements

**P1.** The `Submission` screen can display the "Fetching data" loading state
indefinitely, with no error message and no way to recover other than killing
the app. Reported on a monitoring form list while the device was offline.

**P2.** Submitting or saving a datapoint can fail with a raw native error toast
(`SQL: Error: Error updating datapoint: … Call to function 'NativeDat…'`) when
a background sync happens to be writing to the database at the same moment.
The failure is timing-dependent and not retried.

## Functional Requirements

### FR1 — Concurrent writes must not fail immediately

- FR1.1 Every connection to `app.db` MUST have a busy timeout of 5000 ms so a
  writer waits for a concurrent writer instead of failing with
  `SQLITE_BUSY` / "database is locked".
- FR1.2 This applies to **all** connections: the `SQLiteProvider` connection
  used by UI pages and `SyncService`, and every connection opened with
  `useNewConnection: true` (background tasks, logout/reset flow).
- FR1.3 New code MUST NOT open `app.db` with a raw
  `SQLite.openDatabaseAsync(DATABASE_NAME, …)` call; it MUST use the shared
  `openDatabase()` helper so the pragma cannot be forgotten.
  (Cascade `.sqlite` lookup files are out of scope — separate, read-only
  databases.)

### FR2 — Write transactions must acquire the lock up front

- FR2.1 `sql.withTransaction` MUST begin with `BEGIN IMMEDIATE` so the write
  lock is acquired at transaction start, where `busy_timeout` applies — not on
  a mid-transaction lock upgrade, where WAL mode returns `SQLITE_BUSY` without
  retrying.
- FR2.2 Rollback-on-error behaviour MUST be unchanged.

### FR3 — The Submission screen must never be stuck loading

- FR3.1 `fetchData` MUST clear the loading state on **every** exit path:
  success, thrown error, and the `!activeForm?.id` early return.
- FR3.2 On error, the screen MUST show the normal empty state (not the
  spinner), report the exception to Sentry with a
  `[Submission]`-tagged message, and show an Android toast — the same pattern
  `Home.js` `getUserForms` uses.
- FR3.3 The artificial 1-second delay before clearing the loading state is
  removed; data MUST render as soon as the query resolves.

### FR4 — Query parameter counts must match placeholders

- FR4.1 `crudForms.getFormOptions` MUST bind exactly the parameters its SQL
  declares: `[uuid, parentId]`.

## Non-Functional Requirements

- NFR1 **No behaviour change for single-writer flows.** With no concurrent
  writer, all reads/writes behave exactly as before; the pragma only changes
  contention handling.
- NFR2 **No schema change, no migration.** `busy_timeout` is a
  connection-level pragma; `DATABASE_VERSION` stays at 5.
- NFR3 **No new dependencies.**
- NFR4 **Lint-clean** under the app's Airbnb ESLint config (no new errors or
  warnings; no `eslint-disable` additions).
- NFR5 The user-facing error toast format (`SQL: ${error}`) is retained where
  it already exists, for consistency with `FormPage.js` and `Home.js`.

## Out of Scope

- Connection-lifecycle defects (close/delete races, ownership) — already
  covered by `doc/claude/mobile-sqlite-issues`.
- Retrying a failed submit automatically; the existing job/queue retry paths
  (`SyncService`, background tasks) are unchanged.
- The pre-existing `@env` `import/no-unresolved` lint error in `App.js`.
- The broken Jest environment in the `mobileapp` container
  (`jest-expo` / `expo-modules-core` resolution failure at baseline).

## Acceptance Criteria

| # | Scenario | Expected |
|---|----------|----------|
| AC1 | Submit a monitoring draft while a manual "Sync Datapoint" download is in progress | Submit succeeds (waits ≤ 5 s for the lock); no `database is locked` / `NativeDatabase` toast |
| AC2 | Background `SYNC_FORM_SUBMISSION` task fires while the user saves a draft in `FormPage` | Both writes complete; no error toast |
| AC3 | Open a monitoring form's `Submission` list offline with downloaded datapoints present | List renders; spinner clears |
| AC4 | Force a DB error inside `fetchData` (e.g. temporarily mis-spell a column in dev) | Spinner clears, empty state shows, toast `SQL: …` appears, Sentry event recorded |
| AC5 | Open `Submission` when `FormState.form` has no `id` | Spinner clears to empty state instead of spinning forever |
| AC6 | Open `FormOptions` for a registration datapoint | Monitoring forms list renders with correct submitted/draft/synced counts (param fix is behaviour-neutral on platforms that ignored the extra bind) |
| AC7 | Logout/reset flow (`LogoutButton`) | Truncates all tables and navigates to GetStarted as before |
| AC8 | `npx eslint` over the seven changed files | Only the pre-existing `@env` error in `App.js` |
