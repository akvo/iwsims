# Plan: Download Filtered Monitoring Data by Date Range (#182)

## Context

PR #174 added date range filtering to the Manage Data and Pending Submissions list views. However, the **data download (Excel export)** ignores these filters — when a user applies a date range and clicks "Export to Excel", all data is downloaded regardless of the active date filter.

This plan adds date range support to the download flow so that exports respect the same filters applied to the data table.

## Current Flow (No Date Filtering)

```
Frontend (DataFilters.js)
  → GET /api/v1/download/generate?form_id=X&administration_id=Y&type=recent&child_form_ids=1,2
    → views.py: download_generate()
      → management command: job_download
        → Creates Jobs record (info={form_id, administration, download_type, use_label, child_form_ids})
        → Queues async task: job_generate_data_download(job_id, **kwargs)
          → download_data(form, administration_ids, download_type, child_form_ids)
            → FormData.filter(is_pending=False, is_draft=False, administration_id__in=...)
```

**Problem:** `download_data()` only filters by `is_pending`, `is_draft`, and `administration_id`. No date filtering exists.

## Target Flow (With Date Range)

```
Frontend (DataFilters.js)
  → GET /api/v1/download/generate?form_id=X&...&date_from=2026-01-01&date_to=2026-03-12
    → views.py: download_generate() — passes date params
      → management command: job_download — accepts -df/--date_from, -dt/--date_to
        → Creates Jobs record (info={..., date_from, date_to})
        → Queues async task: job_generate_data_download(job_id, **kwargs)
          → download_data(form, ..., date_from=..., date_to=...)
            → Filter children by date range, then include their parents
```

## Simulation: Date Range Filtering with Real Data

### Test Data

| id | form_id       | created_at | name      | parent_id |
|----|---------------|------------|-----------|-----------|
| 1  | 1749623934933 | 27/02/2026 | EPS #1    |           |
| 2  | 1749632545233 | 03/03/2026 | EPS WQ #1 | 1         |
| 3  | 1749624452908 | 03/03/2026 | EPS PC #1 | 1         |
| 4  | 1749623934933 | 28/02/2026 | EPS #2    |           |
| 5  | 1749623934933 | 02/03/2026 | EPS #3    |           |
| 6  | 1749624452908 | 03/03/2026 | EPS PC #3 | 5         |

- Registration form: `1749623934933` (ids 1, 4, 5)
- Monitoring forms: `1749632545233` (WQ), `1749624452908` (PC)
- **Filter:** date_from=2026-03-02, date_to=2026-03-06

### Why Not Filter on Parent Only?

If we filter parents by date range: only id=5 (EPS #3, created Mar 2) matches.
Result: EPS #3 + EPS PC #3. **Missing:** EPS WQ #1 and EPS PC #1 (created Mar 3) because their parent EPS #1 was created Feb 27.

A user filtering "March 2-6" expects to see monitoring submissions from that period, not just registrations.

### Correct Approach: Filter Children by Date, Include Parents Regardless

**Step 1:** Query child form data where `created` is in date range:
- id=2 (EPS WQ #1, Mar 3) → parent_id=1
- id=3 (EPS PC #1, Mar 3) → parent_id=1
- id=6 (EPS PC #3, Mar 3) → parent_id=5

**Step 2:** Collect parent IDs from matched children: {1, 5}

**Step 3:** Also include parents whose own `created` is in range: {5}

**Step 4:** Union of parent IDs: {1, 5}

**Step 5:** For each parent, only include children that are in the date range.

### Expected Output (download_type=recent)

| datapoint_name | created_at | EPS WQ data | EPS PC data |
|---|---|---|---|
| EPS #1 | 27/02/2026 | EPS WQ #1 answers | EPS PC #1 answers |
| EPS #3 | 02/03/2026 | *(no WQ data)* | EPS PC #3 answers |

- **EPS #1** included because its children (WQ #1, PC #1) were created within the date range
- **EPS #3** included because it was created within the date range AND has a child (PC #3) in range
- **EPS #2** excluded: created outside range AND has no children in range

### Expected Output (download_type=all)

Same as above — all child submissions in the range are already shown (there's only one per child form per parent in this dataset).

## Implementation Steps

### Step 1: Backend — Add date params to `download_data()` and `generate_data_sheet()`

**File:** `backend/api/v1/v1_jobs/job.py`

Add `date_from` and `date_to` parameters. When child forms are involved, filter children by date and include their parents regardless (see simulation above).

**Imports needed:** `from datetime import datetime, time, timedelta` and `from django.conf import settings`

**Helper function** — build date filter kwargs (reuse pattern from PR #174):
```python
def _build_date_filter(date_from=None, date_to=None):
    """Build created__gte / created__lt filter kwargs from date strings."""
    date_filter = {}
    if date_from:
        start_date = parser.parse(date_from)
        start_datetime = datetime.combine(start_date, time.min)
        if settings.USE_TZ:
            start_datetime = timezone.make_aware(start_datetime)
        date_filter["created__gte"] = start_datetime
    if date_to:
        end_date = parser.parse(date_to)
        end_datetime = datetime.combine(
            end_date + timedelta(days=1), time.min
        )
        if settings.USE_TZ:
            end_datetime = timezone.make_aware(end_datetime)
        date_filter["created__lt"] = end_datetime
    return date_filter
```

1. **`download_data()`** (line 47):
   ```python
   def download_data(
       form: Forms,
       administration_ids: list = None,
       download_type: str = DataDownloadTypes.recent,
       child_form_ids: list = [],
       date_from: str = None,
       date_to: str = None,
   ) -> list:
       has_date_filter = date_from or date_to
       date_filter = _build_date_filter(date_from, date_to)

       filter_data = {
           "is_pending": False,
           "is_draft": False,
       }
       if administration_ids:
           filter_data["administration_id__in"] = administration_ids

       if has_date_filter and child_form_ids:
           # Filter children by date, include their parents
           # Step 1: Find child data in date range
           child_filter = {
               "is_pending": False,
               "is_draft": False,
               "form_id__in": child_form_ids,
               **date_filter,
           }
           if administration_ids:
               child_filter["administration_id__in"] = administration_ids
           matched_children = FormData.objects.filter(**child_filter)
           parent_ids_from_children = set(
               matched_children.values_list("parent_id", flat=True)
           )
           # Step 2: Parents in date range themselves
           parent_date_filter = {**filter_data, **date_filter}
           parent_ids_in_range = set(
               form.form_form_data.filter(**parent_date_filter)
               .values_list("id", flat=True)
           )
           # Step 3: Union — parents with in-range children OR in-range themselves
           all_parent_ids = parent_ids_from_children | parent_ids_in_range
           data = form.form_form_data.filter(
               id__in=all_parent_ids, **filter_data
           ).order_by("id").all()
       elif has_date_filter:
           # No child forms — filter parents directly by date
           filter_data.update(date_filter)
           data = form.form_form_data.filter(**filter_data).order_by("id").all()
       else:
           # No date filter — existing behavior
           data = form.form_form_data.filter(**filter_data).order_by("id").all()

       # Rest of function: iterate data and build data_items...
       # When iterating children, also apply date filter:
       data_items = []
       for d in data:
           if download_type == DataDownloadTypes.recent:
               item = d.to_data_frame
               for child_form in child_form_ids:
                   child_qs = d.children.filter(
                       form_id=child_form,
                       is_pending=False,
                       is_draft=False,
                       **date_filter,  # Apply date filter to children too
                   )
                   dl = child_qs.last()
                   if dl:
                       item = {**item, **dl.to_data_frame}
                       item["datapoint_name"] = d.name
                       item["created_at"] = d.to_data_frame.get("created_at")
                       item["created_by"] = d.created_by.get_full_name()
                       item["updated_by"] = dl.created_by.get_full_name()
               data_items.append(item)
           if download_type == DataDownloadTypes.all:
               for child_form in child_form_ids:
                   for dl in d.children.filter(
                       form_id=child_form,
                       is_pending=False,
                       is_draft=False,
                       **date_filter,  # Apply date filter to children too
                   ).all():
                       data_items.append({...})
           if d.children.filter(
               is_pending=False,
               is_draft=False,
               **date_filter,  # Apply date filter here too
           ).count() == 0 and download_type == DataDownloadTypes.all:
               data_items.append(d.to_data_frame)
       return data_items
   ```

   **Key points:**
   - When `child_form_ids` + date filter: find children in range → get their parent IDs → union with parents in range
   - When iterating children for each parent, also apply `**date_filter` so out-of-range children are excluded from the Excel output
   - Use `created__lt = date_to + 1 day` (exclusive upper bound) to make `date_to` inclusive

2. **`generate_data_sheet()`** (line 116): Pass `date_from`/`date_to` through to `download_data()`.

3. **`job_generate_data_download()`** (line 192): Extract `date_from`/`date_to` from `kwargs` and pass to `generate_data_sheet()`. Also add date range info to the context sheet metadata.

### Step 2: Backend — Add date params to serializer

**File:** `backend/api/v1/v1_jobs/serializers.py`

Add to `DownloadDataRequestSerializer`:
```python
date_from = serializers.DateField(required=False, allow_null=True)
date_to = serializers.DateField(required=False, allow_null=True)
```

Add cross-field validation (same pattern as `ListFormDataRequestSerializer` in PR #174):
```python
def validate(self, data):
    date_from = data.get("date_from")
    date_to = data.get("date_to")
    if date_from and date_to and date_from > date_to:
        raise serializers.ValidationError(
            "date_from must be before or equal to date_to"
        )
    return data
```

### Step 3: Backend — Add date params to management command

**File:** `backend/api/v1/v1_jobs/management/commands/job_download.py`

Add arguments:
```python
p.add_argument("-df", "--date_from", nargs="?", default=None, type=str)
p.add_argument("-dt", "--date_to", nargs="?", default=None, type=str)
```

Store in job info:
```python
job_info = {
    "form_id": form.id,
    "administration": adm,
    "download_type": download_type,
    "use_label": use_label,
    "child_form_ids": child_form_ids,
    "date_from": date_from,
    "date_to": date_to,
}
```

Pass as kwargs to async task:
```python
task_id = async_task(
    "api.v1.v1_jobs.job.job_generate_data_download",
    new_job.id,
    hook="api.v1.v1_jobs.job.job_generate_data_download_result",
    administration=adm,
    download_type=download_type,
    use_label=use_label,
    date_from=date_from,
    date_to=date_to,
)
```

### Step 4: Backend — Update view to pass date params

**File:** `backend/api/v1/v1_jobs/views.py`

In `download_generate()`, extract validated date params and pass to management command:
```python
date_from = serializer.validated_data.get("date_from")
date_to = serializer.validated_data.get("date_to")

# Pass to call_command
options = {
    "administration": administration_id or 0,
    "type": download_type,
    "use_label": use_label,
    "child_form_ids": child_form_ids,
}
if date_from:
    options["date_from"] = str(date_from)
if date_to:
    options["date_to"] = str(date_to)

call_command("job_download", form_id, user.id, **options)
```

### Step 5: Backend — Update context sheet with date range info

**File:** `backend/api/v1/v1_jobs/job.py` (in `job_generate_data_download`)

Add date range to the Excel context sheet so users know what filter was applied:
```python
date_from = kwargs.get("date_from")
date_to = kwargs.get("date_to")

context = [
    {"context": "Form Name", "value": form.name},
    {"context": "Monitoring Form(s)", "value": ...},
    {"context": "Download Date", "value": ...},
    {"context": "Administration", "value": ...},
]

# Add date range context if filtered
if date_from or date_to:
    date_range_str = f"{date_from or 'beginning'} to {date_to or 'present'}"
    context.append({"context": "Date Range Filter", "value": date_range_str})
```

### Step 6: Frontend — Pass date range to download API

**File:** `frontend/src/components/filters/DataFilters.js`

In the `export2Excel()` function, add date range params from store state:
```javascript
const { dateRange } = UIState.useState((s) => s);

// In export2Excel():
let url = `/download/generate?form_id=${selectedForm}`;
if (hasParent) {
    url += `&administration_id=${selectedAdm}`;
}
if (dateRange) {
    url += `&date_from=${dateRange[0].format("YYYY-MM-DD")}`;
    url += `&date_to=${dateRange[1].format("YYYY-MM-DD")}`;
}
if (childFormIds.length) {
    url += `&child_form_ids=${childFormIds.join(",")}`;
}
```

### Step 7: Backend — Tests

**File:** `backend/api/v1/v1_jobs/tests/` (new or existing test file)

Test cases:
1. **Download with date_from only** — data before date_from excluded
2. **Download with date_to only** — data after date_to excluded
3. **Download with date range** — only data within range included
4. **Download with invalid date range** (date_from > date_to) — returns 400
5. **Download with date range + administration** — both filters applied
6. **Download without date range** — existing behavior unchanged (regression)
7. **Date boundary inclusivity** — data on date_from and date_to dates are included
8. **Child date triggers parent inclusion** — parent created outside range is included because its child monitoring data was created within range (see simulation: EPS #1 included via EPS WQ #1 and EPS PC #1)
9. **Out-of-range children excluded** — children created outside range are not in the Excel output even if their parent is included
10. **Parent with no in-range children and itself out-of-range** — excluded entirely (see simulation: EPS #2)

## Files to Modify

| File | Change |
|------|--------|
| `backend/api/v1/v1_jobs/job.py` | Add `date_from`/`date_to` to `download_data()`, `generate_data_sheet()`, `job_generate_data_download()` |
| `backend/api/v1/v1_jobs/serializers.py` | Add date fields + validation to `DownloadDataRequestSerializer` |
| `backend/api/v1/v1_jobs/management/commands/job_download.py` | Add `-df`/`-dt` arguments, store in job info, pass to async task |
| `backend/api/v1/v1_jobs/views.py` | Extract date params from serializer, pass to `call_command` |
| `frontend/src/components/filters/DataFilters.js` | Include `dateRange` in download API call |
| `backend/api/v1/v1_jobs/tests/` | Add test cases for date-filtered downloads |

## Design Decisions

1. **Filter on `created` field** — Matches PR #174 behavior for list views. The `created` field (auto_now_add) represents when data was submitted.

2. **Inclusive date range** — `date_from` uses `>=`, `date_to` uses `< next day`. This matches PR #174's pattern and ensures both boundary dates are fully included.

3. **Filter children by date, include parents regardless** — When child_form_ids are specified with a date range, the filter applies to monitoring (child) form `created` dates. Parents are included if they have at least one child submission in the date range OR if the parent itself was created in the range. This matches the UX expectation: "show me monitoring submissions from this period." Parents created outside the range are still shown as context for their in-range children. See the simulation section above for a worked example.

4. **Date filter also applied when iterating children** — After selecting parents, child queries within the loop also include `**date_filter`. This ensures out-of-range children are excluded from the actual Excel rows, not just from the parent selection.

5. **Optional parameters** — Both `date_from` and `date_to` are optional. Omitting both preserves existing behavior (download all). Providing only one creates an open-ended range.

6. **String format for dates** — Dates passed as `YYYY-MM-DD` strings through the management command and kwargs, parsed to datetime in `download_data()`. This keeps the interface simple and avoids serialization issues with Django-Q async tasks.