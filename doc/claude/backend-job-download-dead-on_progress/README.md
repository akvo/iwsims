# Backend: Fix Job Download Dead `on_progress`

## Problem Summary

Two related bugs cause the download feature to silently fail or stay stuck on `on_progress` indefinitely:

1. **Crash on `generate` endpoint** — `Jobs.DoesNotExist` is thrown when `call_command("job_download", …)` returns `None` due to a silent validation failure inside the management command. The view has no guard for `None` and immediately calls `Jobs.objects.get(pk=None)`.

2. **Job stuck `on_progress` / timeout loop** — for large date-range exports the async worker exceeds the 600 s Django-Q timeout, which sets status to `failed`. Django-Q re-queues after 1200 s with no cap on retries. Meanwhile the frontend polls `download/status/<task_id>` indefinitely because there is no client-side terminal state for `failed`.

## Sentry Event

```
Jobs.DoesNotExist: Jobs matching query does not exist.
Transaction: /api/{version}/download/generate
File: api/v1/v1_jobs/views.py:151
```

Root variable from Sentry frame: `"result": "None"` — confirms `call_command` returned `None`.

## Scope

| Layer | File |
|-------|------|
| View | `backend/api/v1/v1_jobs/views.py` |
| Management command | `backend/api/v1/v1_jobs/management/commands/job_download.py` |
| Job function | `backend/api/v1/v1_jobs/job.py` |
| Settings | `backend/mis/settings.py` |

Out of scope: frontend polling strategy, Django-Q worker infrastructure.

## Related Docs

- `doc/claude/split-reg-monitoring-export.md` — ZIP download design already implemented
- `doc/claude/download-filtered-data-by-date-range.md` — date filter design
