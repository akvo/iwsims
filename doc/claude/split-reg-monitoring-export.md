# Plan: Split Registration & Monitoring Data Export (.zip)

## Problem Statement

Currently, `job_generate_data_download()` produces a **single Excel file** that merges parent (registration) and child (monitoring) form data as additional columns in the same sheet. This causes:

1. **Horizontal complexity**: Monitoring questions are appended as columns alongside registration columns, making the spreadsheet very wide and hard to read (e.g. 60+ columns when 2 monitoring forms are included)
2. **Identity loss**: Monitoring records use the parent's `id` — the `to_data_frame` merge overwrites the child's own id with the parent's
3. **Ambiguous metadata**: `updated_at`/`updated_by` are overloaded to represent child submission time, while `created_at`/`created_by` always refer to the parent
4. **Complex merging logic**: `download_data()` has intricate branching for `recent` vs `all` modes with child forms, date filters, and administration filters all interacting

### Example

Form: **EPS Inspection** (`1749623934933`, type=1 registration) has 2 monitoring forms:
- **EPS Projects Construction - Monitoring** (`1749624452908`, type=2) — 40+ questions
- **EPS Water Quality Testing - Monitoring** (`1749632545233`, type=2) — 15+ questions

Current export: 1 Excel with all columns merged horizontally.

### Desired Output

A `.zip` file containing separate Excel files:
```
download-eps_inspection-260320-<uuid>.zip
├── eps_inspection.xlsx                              (registration data only)
├── eps_projects_construction_-_monitoring.xlsx       (monitoring data with parent_id)
└── eps_water_quality_testing_-_monitoring.xlsx       (monitoring data with parent_id)
```

Each monitoring Excel has its own `id` column (the monitoring FormData.id) plus a `parent_id` column referencing the registration FormData.id.

---

## Design Decisions

### D1: .zip format only when child forms are selected

- **When `child_form_ids` is non-empty**: produce `.zip` with separate files
- **When `child_form_ids` is empty** (registration-only export): keep current single `.xlsx` behavior — no breaking change

### D2: Monitoring sheet meta columns

Each monitoring Excel will have these meta columns:

```python
monitoring_meta_columns = [
    "id",              # monitoring FormData.id (was parent id before)
    "parent_id",       # registration FormData.id (NEW)
    "datapoint_name",  # inherited from parent
    "administration",  # inherited from parent
    "geolocation",     # from monitoring record if available, else parent
    "created_at",      # monitoring submission timestamp
    "created_by",      # monitoring submitter
]
```

Registration sheet keeps current `meta_columns` unchanged (no `parent_id`, no `uuid` in meta — `uuid` comes from `to_data_frame` as a question column).

### D3: Download type behavior in split mode

- **`recent`**: Each monitoring sheet contains only the **latest** submission per parent datapoint
- **`all`**: Each monitoring sheet contains **all** submissions per parent datapoint (multiple rows per `parent_id`)

### D4: Date filtering — independent per sheet (no regression)

**Critical**: Current behavior couples parent inclusion to child date ranges (parent included if ANY child is in range). The split approach simplifies this without regression:

- **Registration sheet**: Filter by parent's `created` date directly. No cross-form dependency needed because registration data stands alone.
- **Monitoring sheets**: Filter by each monitoring record's `created` date directly. The `parent_id` column always references the parent regardless of whether the parent falls in the date range — this is a foreign key reference, not a filter.

**Regression guard**: The current `download_data()` function is NOT deleted. It remains available for any other callers. The new zip path uses new functions that handle each form independently.

### D5: Context sheet and definition sheets

- **Registration Excel**: Gets context sheet (form name, download date, administration, date range) + definition sheet (questions + options for registration form only)
- **Each monitoring Excel**: Gets its own definition sheet (questions + options for that monitoring form only). No context sheet duplication — context is in the registration file.

### D6: File naming

- Job `result` field stores `.zip` filename when child forms present
- Individual Excel files inside zip use sanitized form names (lowercase, spaces → underscores)

---

## Implementation Plan

### Phase 1: Add `monitoring_meta_columns` to `export_form.py`

**File**: `backend/utils/export_form.py`

```python
monitoring_meta_columns = [
    "id",
    "parent_id",
    "datapoint_name",
    "administration",
    "geolocation",
    "created_at",
    "created_by",
]
```

No changes to existing `meta_columns`.

### Phase 2: New function `download_monitoring_data()`

**File**: `backend/api/v1/v1_jobs/job.py`

```python
def download_monitoring_data(
    parent_form: Forms,
    child_form: Forms,
    administration_ids: list = None,
    download_type: str = DataDownloadTypes.recent,
    date_from: str = None,
    date_to: str = None,
) -> list:
    """
    Query monitoring FormData for a single child form.
    Returns list of dicts with monitoring's own id + parent_id reference.
    """
```

Key logic:
1. Base filter: `FormData.objects.filter(form=child_form, parent__form=parent_form, parent__isnull=False, is_pending=False, is_draft=False)`
2. Administration filter: `parent__administration_id__in=administration_ids` (monitoring inherits parent's administration context)
3. Date filter: Apply `_build_date_filter()` directly on monitoring `created` field
4. For `recent`: group by `parent_id`, take latest per group (`.order_by('parent_id', '-created').distinct('parent_id')` on PostgreSQL, or manual grouping fallback)
5. For `all`: return all matching records ordered by `parent_id, created`
6. Build each row:
   ```python
   row = child_fd.to_data_frame  # gets monitoring's own id and answers
   row["parent_id"] = child_fd.parent_id
   row["datapoint_name"] = child_fd.parent.name
   row["administration"] = child_fd.parent.administration.administration_column
   ```

**Note**: `to_data_frame` already returns the FormData's own `id`, so no override needed. The `parent_id` is added as a new column.

### Phase 3: New function `generate_monitoring_data_sheet()`

**File**: `backend/api/v1/v1_jobs/job.py`

```python
def generate_monitoring_data_sheet(
    writer: pd.ExcelWriter,
    parent_form: Forms,
    child_form: Forms,
    administration_ids: list = None,
    download_type: str = DataDownloadTypes.recent,
    use_label: bool = True,
    date_from: str = None,
    date_to: str = None,
) -> None:
    """
    Write one monitoring form's data to an Excel writer.
    Similar to generate_data_sheet but uses monitoring_meta_columns
    and generates definition sheet scoped to this child form only.
    """
```

Logic mirrors `generate_data_sheet()` but:
- Uses `download_monitoring_data()` instead of `download_data()`
- Uses `monitoring_meta_columns` for column ordering
- Uses `get_question_names(form=child_form)` — only child form questions
- Generates `generate_definition_sheet(writer, form=child_form)` — no `child_form_ids` param
- Same label conversion logic (option values → labels)

### Phase 4: Refactor `job_generate_data_download()` — zip/excel split

**File**: `backend/api/v1/v1_jobs/job.py`

```python
def job_generate_data_download(job_id, **kwargs):
    job = Jobs.objects.get(pk=job_id)
    child_form_ids = job.info.get("child_form_ids", [])

    if child_form_ids:
        return _generate_zip_download(job, **kwargs)
    else:
        return _generate_excel_download(job, **kwargs)
```

**`_generate_excel_download()`**: Extract current single-Excel logic from `job_generate_data_download()`. This handles registration-only exports. Calls existing `generate_data_sheet()` with `child_form_ids=[]` (no merging). **Existing behavior preserved exactly.**

**`_generate_zip_download()`**:
```python
import zipfile

def _generate_zip_download(job, **kwargs):
    zip_path = f"./tmp/{job.result}"  # .zip filename
    form = Forms.objects.get(pk=job.info.get("form_id"))
    child_form_ids = job.info.get("child_form_ids", [])
    child_forms = form.children.filter(pk__in=child_form_ids).all()
    # ... extract administration_ids, download_type, use_label, dates ...

    tmp_files = []
    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # 1. Registration Excel
            reg_name = _sanitize_form_name(form.name)
            reg_path = f"./tmp/reg_{job.id}.xlsx"
            tmp_files.append(reg_path)
            reg_writer = pd.ExcelWriter(reg_path, engine="xlsxwriter")
            generate_data_sheet(
                writer=reg_writer, form=form,
                administration_ids=administration_ids,
                download_type=download_type,
                use_label=use_label,
                child_form_ids=[],  # registration only
                date_from=date_from, date_to=date_to,
            )
            _write_context_sheet(reg_writer, form, child_forms, job, ...)
            reg_writer.save()
            zf.write(reg_path, f"{reg_name}.xlsx")

            # 2. One Excel per monitoring form
            for child_form in child_forms:
                child_name = _sanitize_form_name(child_form.name)
                child_path = f"./tmp/child_{child_form.id}_{job.id}.xlsx"
                tmp_files.append(child_path)
                child_writer = pd.ExcelWriter(child_path, engine="xlsxwriter")
                generate_monitoring_data_sheet(
                    writer=child_writer,
                    parent_form=form,
                    child_form=child_form,
                    administration_ids=administration_ids,
                    download_type=download_type,
                    use_label=use_label,
                    date_from=date_from, date_to=date_to,
                )
                child_writer.save()
                zf.write(child_path, f"{child_name}.xlsx")

        url = upload(file=zip_path, folder="download")
        return url
    finally:
        # Cleanup temp files
        for f in tmp_files:
            if os.path.exists(f):
                os.remove(f)
```

### Phase 5: Extract context sheet helper

**File**: `backend/api/v1/v1_jobs/job.py`

Extract the context sheet generation from `job_generate_data_download()` into:

```python
def _write_context_sheet(writer, form, monitoring_forms, job,
                         administration_name, date_from, date_to):
    """Write the context/metadata sheet to an Excel writer."""
```

Used by both `_generate_excel_download()` and `_generate_zip_download()` (in the registration Excel only).

### Phase 6: Update `job_download.py` command — .zip filename

**File**: `backend/api/v1/v1_jobs/management/commands/job_download.py`

Change filename generation:

```python
if child_form_ids:
    out_file = "download-{0}-{1}-{2}.zip".format(
        form_name, today, uuid.uuid4()
    )
else:
    out_file = "download-{0}-{1}-{2}.xlsx".format(
        form_name, today, uuid.uuid4()
    )
```

### Phase 7: Update download file endpoint

**File**: `backend/api/v1/v1_jobs/views.py`

Update `download_file()` to handle `.zip` content type:

```python
if filename.endswith(".zip"):
    content_type = "application/zip"
elif filename.endswith(".docx"):
    content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
else:
    content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
```

---

## Existing Functions: What Changes, What Stays

| Function | Change? | Details |
|----------|---------|---------|
| `download_data()` | **NO CHANGE** | Kept as-is for backward compatibility. Still used by `_generate_excel_download()` for registration-only exports. |
| `generate_data_sheet()` | **NO CHANGE** | Called with `child_form_ids=[]` in zip mode (registration only). Existing merged behavior still works for non-zip path. |
| `_build_date_filter()` | **NO CHANGE** | Reused by both existing and new code paths. |
| `get_question_names()` | **NO CHANGE** | Called per-form in new monitoring sheet function. |
| `generate_definition_sheet()` | **NO CHANGE** | Called with single form (no `child_form_ids`) for monitoring sheets. |
| `meta_columns` | **NO CHANGE** | Used for registration sheets as before. |
| `job_generate_data_download()` | **REFACTORED** | Split into `_generate_zip_download()` and `_generate_excel_download()`. |
| `job_download.py` command | **MODIFIED** | Filename extension changes based on child_form_ids. |
| `views.py download_file()` | **MODIFIED** | Content type detection for .zip. |

---

## Date Filtering: Regression Prevention

### Current behavior (merged mode)

In `download_data()` with `child_form_ids` and date filter:
1. Find children created in date range
2. Get their parent IDs
3. Also find parents created in date range themselves
4. Union both sets of parent IDs
5. Query parents by union of IDs
6. For each parent, re-filter children by date range

### New behavior (split mode) — equivalent results, simpler logic

**Registration sheet** (date filter applied):
- Parents filtered by their own `created` date
- No child dependency — registration data is independent

**Monitoring sheet** (date filter applied):
- Monitoring records filtered by their own `created` date
- `parent_id` column always populated (even if parent is outside date range)
- Users can cross-reference via `parent_id` ↔ registration sheet `id`

**Why no regression**: The split approach gives users **more data, not less**. In the merged mode, a parent outside the date range but with an in-range child would appear — and users see the parent's registration data. In split mode:
- The monitoring sheet shows the in-range monitoring records with `parent_id`
- The registration sheet may or may not include that parent (depending on its own date)
- Users can still correlate via `parent_id`

**If strict parity is needed**: Add a flag to include parents referenced by in-range monitoring records. But this adds complexity — recommend starting without it and validating with users.

### Backward compatibility

- `download_data()` is NOT modified — the merged mode still works exactly as before
- `_generate_excel_download()` calls `download_data()` with the same parameters
- Only the zip path uses the new `download_monitoring_data()` function

---

## Test Plan

### Existing tests — verify no regression

All existing tests must pass without modification:

| Test File | Tests | Status |
|-----------|-------|--------|
| `tests_bulk_data_download.py` | `test_data_download_with_download_type_all` | Must pass (uses `download_data()` directly) |
| | `test_data_download_with_download_type_all_no_children` | Must pass |
| | `test_data_download_with_download_type_recent` | Must pass |
| | `test_data_download_repeatable_questions` | Must pass |
| | `test_data_download_list_of_columns` | Must pass |
| | `test_generate_definition_sheet` | Must pass |
| | `test_generate_definition_sheet_with_child_forms` | Must pass |
| | `test_blank_data_template` | Must pass |
| `tests_download_date_filter.py` | All 8 date filter tests | Must pass (uses `download_data()` directly) |
| | `test_invalid_date_range_returns_400` | Must pass |
| `tests_generate_excel_data_endpoint.py` | All 12 endpoint tests | Must pass |
| `tests_job_download_command.py` | All 6 command tests | Must pass |
| `tests_download_file_endpoint.py` | `test_successful_file_download` | Must pass |
| `tests_download_status_endpoint.py` | Both status tests | Must pass |
| `tests_download_list_endpoint.py` | Both list tests | Must pass |

### New tests — split export coverage

#### File: `tests_split_monitoring_export.py`

**Setup**: Use existing test forms (form pk=1 with child form pk=10001) and seeded data.

```
Test 1: test_download_monitoring_data_returns_child_ids
    - Call download_monitoring_data(parent_form, child_form)
    - Assert each row has "id" != parent.id (it's the monitoring record's own id)
    - Assert each row has "parent_id" matching a registration FormData.id
    - Assert "parent_id" column exists in every row

Test 2: test_download_monitoring_data_recent_one_per_parent
    - Call with download_type="recent"
    - Assert unique parent_ids == number of rows (one monitoring per parent)

Test 3: test_download_monitoring_data_all_multiple_per_parent
    - Call with download_type="all"
    - Assert total rows >= number of unique parent_ids
    - Assert rows are ordered by parent_id, created

Test 4: test_download_monitoring_data_with_administration_filter
    - Call with administration_ids=[specific_admin.id]
    - Assert all rows' parent administration matches filter

Test 5: test_download_monitoring_data_with_date_from
    - Set known dates on monitoring records
    - Call with date_from (exclude old monitoring records)
    - Assert old monitoring records excluded
    - Assert parent_id still references correct parent

Test 6: test_download_monitoring_data_with_date_to
    - Call with date_to (exclude recent monitoring records)
    - Assert recent monitoring records excluded

Test 7: test_download_monitoring_data_with_date_range
    - Call with both date_from and date_to
    - Assert only monitoring records within range returned

Test 8: test_download_monitoring_data_date_boundary_inclusivity
    - Set monitoring record to exactly date_from date
    - Assert it is included (gte boundary)
    - Set monitoring record to exactly date_to date
    - Assert it is included (lt date_to+1 day)

Test 9: test_download_monitoring_data_empty_result
    - Call with date range that excludes all data
    - Assert empty list returned

Test 10: test_download_monitoring_data_with_date_and_administration
    - Combine date range + administration filter
    - Assert both filters applied correctly
```

#### File: `tests_zip_download.py`

**Setup**: Use existing test forms with seeded data.

```
Test 11: test_zip_download_produces_zip_file
    - Call job_generate_data_download with child_form_ids
    - Assert result URL contains ".zip"
    - Assert zip file exists in ./tmp/

Test 12: test_zip_contains_correct_files
    - Generate zip
    - Open with zipfile.ZipFile
    - Assert zip contains N+1 files (1 registration + N monitoring)
    - Assert filenames match sanitized form names

Test 13: test_zip_registration_excel_has_correct_columns
    - Extract registration Excel from zip
    - Read with pd.read_excel
    - Assert meta_columns present
    - Assert NO monitoring question columns
    - Assert "parent_id" NOT in columns

Test 14: test_zip_monitoring_excel_has_correct_columns
    - Extract monitoring Excel from zip
    - Read with pd.read_excel
    - Assert monitoring_meta_columns present (id, parent_id, datapoint_name, ...)
    - Assert only monitoring form's question columns present
    - Assert NO registration question columns

Test 15: test_zip_monitoring_parent_id_references_valid
    - Extract both registration and monitoring Excels
    - Assert every parent_id in monitoring sheet exists as id in registration sheet

Test 16: test_zip_download_without_child_forms_produces_xlsx
    - Call job_generate_data_download without child_form_ids
    - Assert result URL contains ".xlsx" (not .zip)
    - Existing behavior preserved

Test 17: test_zip_monitoring_recent_mode
    - Generate zip with download_type="recent"
    - Read monitoring Excel
    - Assert unique parent_ids == row count

Test 18: test_zip_monitoring_all_mode
    - Generate zip with download_type="all"
    - Read monitoring Excel
    - Assert total rows >= unique parent_ids

Test 19: test_zip_download_with_date_filter
    - Set known dates on data
    - Generate zip with date_from/date_to
    - Read registration Excel: assert only in-range parents
    - Read monitoring Excel: assert only in-range monitoring records
    - Assert parent_id references still valid (even if parent not in registration sheet)

Test 20: test_zip_download_with_administration_filter
    - Generate zip with administration_id
    - Read both Excels
    - Assert administration filter applied to both

Test 21: test_zip_definition_sheets_per_form
    - Extract registration Excel: assert "questions" sheet has only registration questions
    - Extract monitoring Excel: assert "questions" sheet has only that monitoring form's questions

Test 22: test_zip_context_sheet_in_registration_only
    - Assert registration Excel has "context" sheet
    - Assert monitoring Excels do NOT have "context" sheet (or have minimal info)

Test 23: test_zip_with_use_label_true
    - Generate zip with use_label=True
    - Assert option questions show labels not values in both Excels

Test 24: test_zip_with_use_label_false
    - Generate zip with use_label=False
    - Assert option questions show raw values

Test 25: test_zip_empty_monitoring_data
    - Remove/mark-pending all monitoring submissions for one child form
    - Generate zip
    - Assert that monitoring Excel either has blank template or is omitted
```

#### File: `tests_job_download_command.py` (additions)

```
Test 26: test_download_command_produces_zip_filename
    - Call job_download command with child_form_ids
    - Assert job.result ends with ".zip"

Test 27: test_download_command_without_children_produces_xlsx
    - Call job_download command without child_form_ids
    - Assert job.result ends with ".xlsx"
```

#### File: `tests_download_file_endpoint.py` (additions)

```
Test 28: test_successful_zip_file_download
    - Create a .zip test file and upload
    - Create Job with result=filename.zip
    - GET /api/v1/download/file/{filename.zip}
    - Assert 200 OK
    - Assert Content-Type is "application/zip"
    - Assert Content-Disposition has .zip filename
```

#### File: `tests_download_date_filter.py` (additions for split mode)

```
Test 29: test_monitoring_date_filter_independent_from_parent
    - Parent created 5 days ago (outside range)
    - Monitoring created yesterday (in range)
    - Call download_monitoring_data with date_from=yesterday
    - Assert monitoring record IS returned
    - Assert parent_id references the old parent

Test 30: test_monitoring_date_filter_excludes_out_of_range
    - Parent created yesterday, monitoring created 5 days ago
    - Call download_monitoring_data with date_from=yesterday
    - Assert monitoring record is NOT returned (monitoring itself is out of range)

Test 31: test_registration_date_filter_no_child_dependency
    - Parent created yesterday, all monitoring created 5 days ago
    - Call download_registration_data (via generate_data_sheet with child_form_ids=[])
    - Assert parent IS included (filtered by own date, not child dates)
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/api/v1/v1_jobs/job.py` | Add `download_monitoring_data()`, `generate_monitoring_data_sheet()`, `_generate_zip_download()`, `_generate_excel_download()`, `_write_context_sheet()`, `_sanitize_form_name()`. Refactor `job_generate_data_download()`. |
| `backend/utils/export_form.py` | Add `monitoring_meta_columns` list |
| `backend/api/v1/v1_jobs/management/commands/job_download.py` | `.zip` vs `.xlsx` filename based on `child_form_ids` |
| `backend/api/v1/v1_jobs/views.py` | Content type detection for `.zip` in `download_file()` |

## Files NOT Modified

| File | Reason |
|------|--------|
| `backend/api/v1/v1_data/models.py` | `to_data_frame` already returns FormData's own `id`; `parent_id` is a model field accessible directly |
| `backend/api/v1/v1_forms/models.py` | Parent-child relationship already works |
| `backend/api/v1/v1_jobs/models.py` | `result` field stores any filename string |
| `backend/api/v1/v1_jobs/constants.py` | No new job types or download types needed |
| `backend/api/v1/v1_jobs/serializers.py` | Request parameters unchanged |

## New Test Files

| File | Coverage |
|------|----------|
| `backend/api/v1/v1_jobs/tests/tests_split_monitoring_export.py` | Tests 1-10: `download_monitoring_data()` unit tests |
| `backend/api/v1/v1_jobs/tests/tests_zip_download.py` | Tests 11-25: End-to-end zip generation tests |

---

## Execution Order

1. **Phase 1**: Add `monitoring_meta_columns` to `export_form.py`
2. **Phase 2-3**: New `download_monitoring_data()` + `generate_monitoring_data_sheet()` + tests 1-10
3. **Phase 4-5**: Refactor `job_generate_data_download()` + context helper + tests 11-25
4. **Phase 6**: Update `job_download.py` command + tests 26-27
5. **Phase 7**: Update download file endpoint + test 28
6. **Final**: Run full test suite, verify all existing tests pass (tests 29-31 for date filter regression)

## Risk Mitigation

- **No deletion of existing functions**: `download_data()` and `generate_data_sheet()` remain intact
- **Feature flag approach**: The zip/excel split is naturally gated by `child_form_ids` — empty means old behavior
- **Temp file cleanup**: Use `try/finally` to ensure intermediate Excel files are removed after zipping
- **PostgreSQL-specific `distinct('parent_id')`**: If needed, provide a fallback using Python grouping for test environments using SQLite
