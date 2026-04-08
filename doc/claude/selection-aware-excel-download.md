# Selection-Aware Excel Download

## Problem

The Manage Data page had two download buttons:
1. **Download Report** (DOCX) — used `selectedRowKeys` to filter specific datapoints
2. **Download** (Excel) — ignored `selectedRowKeys`, only offered "All data" / "Latest data" radio

Both buttons also shared a single `selectedChildForms` state and `childFormMenuItems` memo, causing child form selections in one dropdown to affect the other.

## Solution

When rows are selected, the Excel download now exports only those rows (via `selection_ids`). When no rows are selected, behavior is unchanged. Each dropdown has independent child form state.

---

## Changes

### Backend

#### `serializers.py` — `DownloadDataRequestSerializer`
- Added `selection_ids` field (`CustomListField` of `FormData` PKs, required=False)
- Queryset restricted to registration data only: `FormData.objects.filter(form__parent__isnull=True)`

#### `serializers.py` — `DownloadListSerializer`
- `get_attributes()`: When `selection_ids` is present on a `download` job, returns the selected `FormData` rows as `[{id, name, form_id}]` (rendered as clickable links in DownloadTable). When absent, returns child forms as `[{id, name}]` (plain text). Keeps the flat array format the frontend expects.
- `get_download_type()`: Returns `None` when `selection_ids` is present (hides the "recent Data -" / "all Data -" label).

#### `views.py` — `download_generate()`
- Extracts `selection_ids` from validated data and passes as `-s` flag to the `job_download` management command.

#### `management/commands/job_download.py`
- Added `-s`/`--selection_ids` argument (`nargs="*"`, `default=[]`, `type=int`)
- Stored in `job.info["selection_ids"]`

#### `job.py` — `download_data()`
- New `selection_ids` parameter. When provided, filters `FormData` by `id__in=selection_ids` directly, bypassing download_type/administration/date logic. Still merges latest child data per `child_form_ids`.

#### `job.py` — `download_monitoring_data()`
- New `selection_ids` parameter. When provided, adds `parent_id__in=selection_ids` filter. Other filters (administration, date) still apply.

#### `job.py` — Passthrough in:
- `generate_data_sheet()` — passes `selection_ids` to `download_data()`
- `generate_monitoring_data_sheet()` — passes `selection_ids` to `download_monitoring_data()`
- `_generate_excel_download()` — extracts from `job.info`, passes to `generate_data_sheet()`
- `_generate_zip_download()` — extracts from `job.info`, passes to both `generate_data_sheet()` and `generate_monitoring_data_sheet()`

### Frontend

#### `DataFilters.js`
- **Separate state**: Split `selectedChildForms` into `excelChildForms` and `docxChildForms` with independent `useState` hooks.
- **Reusable checkbox builder**: `buildCheckboxItems(selected, setSelected)` — a `useCallback` that generates checkbox menu items for any state/setter pair.
- **Split menus**: `excelMenuItems` and `docxMenuItems` each call `buildCheckboxItems` with their own state.
- **Conditional radio**: `excelMenuItems` hides the "All data" / "Latest data" radio group when `selectedRowKeys.length > 0`.
- **`export2Excel()`**: When `selectedRowKeys` is present, appends `selection_ids` params and skips the `type` param.
- **Badge**: Excel download button wrapped in `<Badge count={selectedRowKeys.length}>`.
- **Icons**: Excel menu footer uses `<DownloadOutlined />`, DOCX menu footer uses `<FileWordOutlined />`.

#### `ManageDataTable.jsx`
- Added `useEffect` that resets `selectedRowKeys` to `[]` when `administration` changes.

### Tests

#### `tests_zip_download_with_selection_ids.py`

**`ZipDownloadWithSelectionIdsTestCase`** (4 tests):
- `test_selection_ids_filters_registration_data` — only selected rows in registration Excel
- `test_selection_ids_filters_monitoring_data` — monitoring Excel only has children of selected parents
- `test_empty_selection_ids_uses_normal_behavior` — same row count as without selection_ids
- `test_xlsx_with_selection_ids` — xlsx (no child forms) with selection_ids filters correctly

**`ZipDownloadCommandWithSelectionIdsTestCase`** (1 test):
- `test_command_accepts_selection_ids_argument` — `-s` flag stores in job info

**`ZipDownloadApiWithSelectionIdsTestCase`** (1 test):
- `test_api_endpoint_accepts_selection_ids` — GET with `selection_ids` returns HTTP 200

---

## File Summary

| File | Change |
|---|---|
| `backend/api/v1/v1_jobs/serializers.py` | `selection_ids` in request serializer; attributes/download_type in list serializer |
| `backend/api/v1/v1_jobs/views.py` | Pass `selection_ids` to command |
| `backend/api/v1/v1_jobs/management/commands/job_download.py` | `-s` argument, store in info |
| `backend/api/v1/v1_jobs/job.py` | `selection_ids` in download_data, download_monitoring_data, and all generators |
| `backend/api/v1/v1_jobs/tests/tests_zip_download_with_selection_ids.py` | 6 dedicated tests |
| `frontend/src/components/filters/DataFilters.js` | Independent state, split menus, selection_ids in API, badge |
| `frontend/src/pages/manage-data/components/ManageDataTable.jsx` | Reset selectedRowKeys on administration change |
