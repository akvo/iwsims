# Requirements: Fix Job Download Dead `on_progress`

## Functional Requirements

### FR-1 — Generate endpoint must not crash on validation failure

The `GET /api/v1/download/generate` endpoint must return an HTTP 400 response with a clear message when the job_download management command detects an invalid input (non-registration form, child form not belonging to parent). It must never throw an unhandled `Jobs.DoesNotExist`.

**Current behaviour**: `call_command()` returns `None` → `Jobs.objects.get(pk=None)` → 500.
**Required behaviour**: 400 JSON response: `{"message": "<reason>"}`.

### FR-2 — Management command must surface validation errors as exceptions

`job_download.handle()` must raise `django.core.management.CommandError` instead of silently writing to stdout and returning `None`. This makes the error propagate to the caller (`call_command`) and be catchable in the view.

**Current behaviour**: `self.stdout.write(ERROR …); return` — caller receives `None`.
**Required behaviour**: `raise CommandError("<reason>")` — caller catches it.

### FR-3 — Auto-retry must be disabled per-task, not globally

The `async_task` call for download jobs must pass `retry=0` as a keyword argument. This isolates the no-auto-retry behaviour to download jobs only. The global `Q_CLUSTER["retry"]` setting must not be changed, to avoid affecting other job types (email, imports, etc.).

### FR-3b — Retry count must be capped; manual retry resets the counter

After `job.attempt >= MAX_DOWNLOAD_ATTEMPTS` (default: 3) the job is permanently `failed` and will not auto-retry (auto-retry is already disabled by FR-3). The user may still click the Retry button, which resets `attempt = 0` and queues a fresh task. The guard inside `job_generate_data_download` (bail if `attempt >= MAX`) acts as a safety net only — it will never fire in normal use because `download_retry` always resets `attempt = 0` before queuing.

### FR-4 — N+1 queries in `download_data` must be eliminated

For `type=all`, `d.to_data_frame` is called once per (parent × child form × child record) loop iteration. Each call issues a `SELECT` on `data_answer`. This must be replaced with a single bulk fetch per batch.

### FR-5 — N+1 queries in `get_answer_label` must be eliminated

`get_answer_label` issues one `SELECT FROM question_options` per cell value inside a DataFrame `.apply()`. All option labels for the relevant question IDs must be pre-fetched into an in-memory dict before the DataFrame is processed.

### FR-6 — Retry must delete the old GCS file and generate a new filename

When `download_retry` is called, if a previous result file exists on GCS it must be deleted before the new task is queued. A new filename (same naming scheme as the original: `download-{form}-{date}-{uuid}.{ext}`) must be generated and written to `job.result`. This prevents a partial or stale file from being served if the retry succeeds.

### FR-7 — The retry endpoint must not pass `**job.info` to `async_task`

`job_generate_data_download` reads all parameters from `job.info` (the DB), not from `**kwargs`. The retry endpoint should call `async_task("…job_generate_data_download", job.id, retry=0, hook="…")` with no unpacked info dict. This avoids silent kwarg mismatches between the stored info schema and the task signature.

### FR-8 — Frontend polling must stop on terminal states

The 1-second polling `useEffect` in the downloads page must treat both `done` and `failed` as terminal states and stop polling. Without this, a `failed` status loops indefinitely regardless of the Retry button being present.

## Non-Functional Requirements

### NFR-1 — No breaking change to the download API contract

The response shape of `POST /api/v1/download/generate` and `GET /api/v1/download/status/<task_id>` must not change.

### NFR-2 — Existing tests must remain green

All tests in `backend/api/v1/v1_jobs/tests/` must pass after the fix.

### NFR-3 — New tests must cover the fixed paths

- Test that `generate` returns 400 when a non-registration form ID is given.
- Test that `generate` returns 400 when a child form ID that is not a child of the parent is given.
- Test that `job_generate_data_download_result` sets status to `failed` permanently after `MAX_DOWNLOAD_ATTEMPTS`.

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC-1 | `GET /api/v1/download/generate?form_id=<child_form>&…` returns 400, not 500 |
| AC-2 | `GET /api/v1/download/generate?form_id=<reg>&child_form_ids=<invalid>&…` returns 400, not 500 |
| AC-3 | A job that fails 3 times has `status=failed` and `attempt=3`; Django-Q does not re-queue it (per-task `retry=0`) |
| AC-3b | After 3 failures, clicking Retry resets `attempt=0` and queues a fresh task; other job types are not affected |
| AC-4 | `download_data(type=all)` with 500 parent records and 3 child forms issues ≤ ~10 queries (not 500 × 3 × K) |
| AC-5 | `generate_data_sheet` with option-type columns issues one `SELECT FROM question_options` per question, not one per cell |
| AC-6 | All existing `v1_jobs` tests pass |
| AC-7 | On retry, the old GCS file is deleted and `job.result` contains a new filename before the task runs |
| AC-8 | Frontend polling stops when status is `done` or `failed`; it does not poll indefinitely |
