# Implementation Plan — SQLite Busy Errors & Stuck "Fetching data" Spinner

**Status: all phases implemented (2026-06-11).** Listed in execution order;
each phase is independently shippable but they were landed together.

## Phase 1 — `openDatabase()` helper

**File**: `app/src/database/index.js`

Replace the single-line re-export module with:

```js
import * as SQLite from 'expo-sqlite';
import { DATABASE_NAME } from '../lib/constants';

export { default as tables } from './tables';

export const openDatabase = async () => {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME, {
    useNewConnection: true,
  });
  await db.execAsync('PRAGMA busy_timeout = 5000;');
  return db;
};
```

Notes:
- The previous `// eslint-disable-next-line import/prefer-default-export` is
  no longer needed (two exports now).
- No import cycle: `lib/constants.js` imports nothing.

## Phase 2 — provider connection pragma

**File**: `app/App.js` — `migrateDbIfNeeded`

At the very top, before the `user_version` read (so it runs on **every**
launch including the fast path that returns early):

```js
await db.execAsync('PRAGMA busy_timeout = 5000;');
```

## Phase 3 — route all `app.db` opens through the helper

| File | Site | Edit |
|------|------|------|
| `app/App.js` | inline `TaskManager.defineTask(SYNC_FORM_SUBMISSION_TASK_NAME, …)` | `const db = await openDatabase();` |
| `app/App.js` | imports | add `openDatabase` to the `./src/database` import; **remove** `import * as SQLite from 'expo-sqlite'` (namespace no longer referenced — `SQLiteProvider` has its own named import) |
| `app/src/lib/background-task.js` | `registerBackgroundTask` | `const db = await openDatabase();` |
| `app/src/lib/background-task.js` | `defineSyncFormVersionTask` | same |
| `app/src/lib/background-task.js` | `syncDatapointsBackground` | same |
| `app/src/lib/background-task.js` | `defineSyncFormSubmissionTask` | same |
| `app/src/lib/background-task.js` | imports | add `import { openDatabase } from '../database';`; remove `SQLite` namespace import and `DATABASE_NAME` from the constants import (both now unused) |
| `app/src/components/LogoutButton.js` | `handleYesPress` | `const db = await openDatabase();`; remove `SQLite` and `DATABASE_NAME` imports, add `openDatabase` |

Existing `closeAsync()` placement (in `finally` per the prior
`mobile-sqlite-issues` work) is untouched.

**Unchanged on purpose** (different database files, not `app.db`):
`app/src/lib/cascades.js:33`, `app/src/pages/FormPage.js:61`.

## Phase 4 — immediate transactions

**File**: `app/src/database/sql.js` — `withTransaction`

```js
// BEGIN IMMEDIATE acquires the write lock up front so busy_timeout applies.
// A deferred BEGIN can fail with SQLITE_BUSY on lock upgrade, which
// busy_timeout does not retry in WAL mode.
await db.execAsync('BEGIN IMMEDIATE TRANSACTION');
```

COMMIT/ROLLBACK logic unchanged. Covers `downloadDatapointsJson`, migrations,
`executeBatch`, `bulkInsert`.

## Phase 5 — `Submission.fetchData` hardening

**File**: `app/src/pages/Submission.js`

1. Imports: add `Platform`, `ToastAndroid` (from `react-native`) and
   `import * as Sentry from '@sentry/react-native';`.
2. Rewrite `fetchData`:
   - Guard: `if (!activeForm?.id) { setLoading(false); return; }`
   - `try`: existing `totalSavedData` + `selectDataPointsByFormAndSubmitted`
     + row mapping + `setData(rows)` — logic unchanged.
   - `catch`: `Sentry.captureMessage('[Submission] Unable to fetch data points')`,
     `Sentry.captureException(error)`, Android toast `` `SQL: ${error}` ``.
   - `finally`: `setLoading(false)` — replaces both the `rows.length === 0`
     early-clear and the 1 s `setTimeout` clear, which are deleted.
3. Dependency array: `activeForm.id` → `activeForm?.id`.

## Phase 6 — `getFormOptions` bind fix

**File**: `app/src/database/crud/crud-forms.js`

```js
const rows = await sql.executeQuery(db, selectJoin, [uuid, parentId]);
```

(was `[uuid, parentId, uuid]` — 3 binds for 2 placeholders).

## Verification

| Step | Command / action | Result (2026-06-11) |
|------|------------------|---------------------|
| Lint | `npx eslint App.js src/pages/Submission.js src/lib/background-task.js src/components/LogoutButton.js src/database/index.js src/database/sql.js src/database/crud/crud-forms.js` (inside `iwsims-mobileapp-1`, against the edited sources) | ✅ clean except pre-existing `@env` `import/no-unresolved` in `App.js` (also fails at HEAD) |
| Unit tests | `npx jest src/database` in container | ⚠️ blocked — fails identically at baseline: `Cannot find module 'expo-modules-core/src/Refs'` from `jest-expo` setup (env issue, not a regression) |
| Device | AC1–AC8 in [requirements.md](requirements.md#acceptance-criteria) | ☐ pending field/device re-test |

### Environment caveats hit during verification

- Host `npx eslint` resolves a stale global ESLint 6.4.0 (host
  `app/node_modules` is an empty docker-sync mount point) — lint must run in
  the container.
- The running `iwsims-mobileapp-1` container's `./app:/app` bind mount was
  serving **stale files** (Docker Desktop `desktop-linux` context; file-share
  frozen). Verification copied the edited sources into the container's `/tmp`
  with a symlinked `node_modules`. Restart the container before
  building/testing so it picks up the new code.

## Rollout

- No migration, no `DATABASE_VERSION` bump, no API/backend change.
- Safe to hot-ship in the next mobile release; behaviour under zero contention
  is identical.
- Follow-ups (out of scope, candidates for new issues):
  1. Param-count validation in `sql.executeQuery` (align with
     `safeExecuteQuery`).
  2. Repair the container Jest environment (`jest-expo` ↔
     `expo-modules-core` mismatch) so `npm test` runs again.
