# Flow Data Seeder Multi-Child CSV Support Plan

## Overview

This document outlines the comprehensive changes required to:
1. Apply question column reordering to `af_data_registration_monitoring.ipynb`
2. Generate separate child CSV files per child form (like `af_data_entry_horizontal.ipynb`)
3. Update `flow_data_seeder.py` and utilities to support multiple child CSV files

## Current State Analysis

### Current Architecture

| Component | Current Behavior |
|-----------|-----------------|
| `af_data_registration_monitoring.ipynb` | Generates single `{flow_id}_child_data.csv` |
| `af_data_entry_horizontal.ipynb` | Generates `{flow_id}_child_data_{child_form_id}.csv` per form |
| `flow_data_seeder.py` | Expects single `{flow_id}_child_data.csv` |

### Key Differences Between Notebooks

| Feature | Registration/Monitoring | Horizontal |
|---------|------------------------|-----------|
| Child CSV Strategy | Single consolidated file | Separate file per child form |
| Column Names | Question IDs | Human-readable labels |
| Column Ordering | None (natural order) | By `mis_question_order` |
| Child Form Validation | Auto-discover all | Explicit validation list |
| Output Path | `storage/akvo-flow/data/` | `output/mis_data_entry/` |

---

## Configuration: `use_human_readable`

A configurable variable controls column naming and output location:

```python
# Configuration for output format
use_human_readable = False  # Default: question IDs for seeder compatibility
```

| Setting | Column Names | Output Directory | Use Case |
|---------|-------------|------------------|----------|
| `use_human_readable = False` | Question IDs (e.g., `1749632545233`) | `storage/akvo-flow/data/` | Seeder input |
| `use_human_readable = True` | Human-readable labels (e.g., `Contact Details \| Date`) | `output/mis_data_entry/` | Manual review |

**Benefits:**
- Default mode keeps `flow_data_seeder.py` changes minimal
- Human-readable mode available for data verification/review
- Both modes generate separate child CSVs per form with column reordering

---

## Part 1: Notebook Changes (`af_data_registration_monitoring.ipynb`)

### 1.1 Add New Constants (Cell 1)

Add after existing `MIS_FORM_ID_COL`:

```python
MIS_QUESTION_LABEL_COL = "mis_question_label"
MIS_QUESTION_ORDER_COL = "mis_question_order"
```

### 1.2 Update `load_question_mappings()` Function (Cell 1)

**Changes:**
- Add `child_form_ids: List[int] = None` parameter
- Include label and order columns in return
- Sort questions by `mis_question_order`
- Validate child mapping files against expected IDs

**Updated signature:**
```python
def load_question_mappings(
    flow_id: int,
    mis_form_id: int = None,
    child_form_ids: List[int] = None  # NEW
) -> Dict[str, List[str]]:
```

**Key additions:**
```python
# Convert mis_question_order to numeric for proper sorting
df[MIS_QUESTION_ORDER_COL] = pd.to_numeric(df[MIS_QUESTION_ORDER_COL], errors="coerce")

# If child_form_ids is provided, validate and filter
if child_form_ids is not None:
    expected_child_files = {
        os.path.join(MAPPINGS_DIR, f"{flow_id}_mapping_child_{child_id}.csv")
        for child_id in child_form_ids
    }
    child_mapping_files = [f for f in child_mapping_files if f in expected_child_files]

# Include label and order in questions
.apply(
    lambda row: {
        FLOW_QUESTION_ID_COL: row[FLOW_QUESTION_ID_COL],
        MIS_QUESTION_ID_COL: row[MIS_QUESTION_ID_COL],
        MIS_QUESTION_LABEL_COL: row[MIS_QUESTION_LABEL_COL],
        MIS_QUESTION_ORDER_COL: row[MIS_QUESTION_ORDER_COL],
    },
    axis=1,
)
```

### 1.3 Add Helper Functions (Cell 1)

**Add `build_sorted_column_mapping()`:**
```python
def build_sorted_column_mapping(
    question_id_to_label: Dict[str, str],
    seed_questions: List[dict]
) -> Dict[str, str]:
    """
    Build a column mapping that sorts columns by mis_question_order.
    """
    column_order = []
    for fq in seed_questions:
        for q in fq["questions"]:
            qid = q[MIS_QUESTION_ID_COL]
            qlabel = q.get(MIS_QUESTION_LABEL_COL, qid)
            qorder = q.get(MIS_QUESTION_ORDER_COL, float("inf"))
            if pd.notna(qlabel) and qlabel != "":
                column_order.append((qid, qlabel, qorder))

    column_order.sort(key=lambda x: x[2] if pd.notna(x[2]) else float("inf"))

    sorted_mapping = {}
    for qid, qlabel, _ in column_order:
        sorted_mapping[qid] = qlabel
        sorted_mapping[str(qid)] = qlabel
        if '.' not in str(qid):
            sorted_mapping[f"{qid}.0"] = qlabel

    return sorted_mapping
```

**Add `build_ordered_column_list()`:**
```python
def build_ordered_column_list(
    seed_questions: List[dict],
    metadata_cols: List[str] = None
) -> List[str]:
    """
    Build an ordered list of column names for DataFrame reordering.
    """
    if metadata_cols is None:
        metadata_cols = ["form_id", "identifier", "created_at", "datapoint_id",
                        "submitter", "name", "parent", "parent_name",
                        "administration", "geo"]

    question_columns = []
    for fq in seed_questions:
        for q in fq["questions"]:
            qid = q[MIS_QUESTION_ID_COL]
            qlabel = q.get(MIS_QUESTION_LABEL_COL, qid)
            qorder = q.get(MIS_QUESTION_ORDER_COL, float("inf"))
            if pd.notna(qlabel) and qlabel != "":
                question_columns.append((qid, qlabel, qorder))

    question_columns.sort(key=lambda x: x[2] if pd.notna(x[2]) else float("inf"))

    ordered_columns = list(metadata_cols)
    for qid, qlabel, _ in question_columns:
        if qlabel not in ordered_columns:
            ordered_columns.append(qlabel)

    return ordered_columns


def build_ordered_column_list_by_id(
    seed_questions: List[dict],
    metadata_cols: List[str] = None
) -> List[str]:
    """
    Build an ordered list of column names using question IDs (not labels).
    Used when use_human_readable = False.
    """
    if metadata_cols is None:
        metadata_cols = ["form_id", "identifier", "created_at", "datapoint_id",
                        "submitter", "name", "parent", "parent_name",
                        "administration", "geo"]

    question_columns = []
    for fq in seed_questions:
        for q in fq["questions"]:
            qid = q[MIS_QUESTION_ID_COL]
            qorder = q.get(MIS_QUESTION_ORDER_COL, float("inf"))
            question_columns.append((qid, qorder))

    # Sort by mis_question_order
    question_columns.sort(key=lambda x: x[1] if pd.notna(x[1]) else float("inf"))

    # Build ordered list with question IDs
    ordered_columns = list(metadata_cols)
    for qid, _ in question_columns:
        if str(qid) not in ordered_columns:
            ordered_columns.append(str(qid))

    return ordered_columns
```

### 1.4 Add Configuration and Child Form Mapping (Cell 2)

```python
# Configuration for output format
# False = question IDs (for seeder), True = human-readable labels (for manual review)
use_human_readable = False

# Output directory based on configuration
OUTPUT_DIR = "./output/mis_data_entry" if use_human_readable else os.path.join(FLOW_SOURCE_DIR, "data")

# Mapping of Flow form IDs to their MIS child form IDs
flow_mis_child_forms = {
    "8520967": [
        1749640508297,  # WAF Water Treatment Plant - Quick Monitoring
        1749652214711,  # WAF Water Treatment Plant - Monitoring
    ],
    "17260923": [
        1748905550055,  # WWTP - Quick Monitoring
        1748918946591,  # WWTP - Monitoring
    ],
    "27040920": [
        1749611905372,  # SPS - Quick Monitoring
        1749627302948,  # SPS - Monitoring
    ],
    "1520924": [
        1749632545233,  # EPS - Water Quality Monitoring
    ],
    "5530933": [
        1749624452908,  # EPS - Project Construction Monitoring
    ],
    "2490944": [
        1749621962296,  # RWS - Quick Monitoring
        1749631041125,  # RWS - Monitoring
    ]
}

# Get expected child form IDs for this flow form
expected_child_form_ids = flow_mis_child_forms.get(flow_form_id, [])
seed_questions = load_question_mappings(
    flow_form_id,
    mis_form_id,
    child_form_ids=expected_child_form_ids
)
```

### 1.5 Update Data Processing (Cell 3)

Add `question_id_to_label` dictionary building:

```python
parent_data = []
child_data = []
caddisfly_data = []
question_id_to_label = {}  # NEW

# Inside the loop, build mapping:
for q in questions:
    qid = q[MIS_QUESTION_ID_COL]
    qlabel = q.get(MIS_QUESTION_LABEL_COL, qid)
    if pd.notna(qlabel) and qlabel != "":
        question_id_to_label[qid] = qlabel
        question_id_to_label[str(qid)] = qlabel
        if '.' not in str(qid):
            question_id_to_label[f"{qid}.0"] = qlabel
```

### 1.6 Update Output Cell (Cell 5)

**Parent data with conditional reordering:**
```python
# Only rename columns to labels if use_human_readable is True
if use_human_readable:
    sorted_question_id_to_label = build_sorted_column_mapping(
        question_id_to_label, seed_questions
    )
    parent_data_df = parent_data_df.rename(columns=sorted_question_id_to_label)

    # Build ordered column list and reorder (uses labels)
    parent_ordered_columns = build_ordered_column_list(
        seed_questions,
        metadata_cols=["form_id", "identifier", "created_at", "datapoint_id",
                       "submitter", "name", "administration", "geo"]
    )
else:
    # Keep question IDs but still reorder by mis_question_order
    parent_ordered_columns = build_ordered_column_list_by_id(
        seed_questions,
        metadata_cols=["form_id", "identifier", "created_at", "datapoint_id",
                       "submitter", "name", "administration", "geo"]
    )

parent_ordered_columns = [col for col in parent_ordered_columns if col in parent_data_df.columns]
remaining_columns = [col for col in parent_data_df.columns if col not in parent_ordered_columns]
parent_data_df = parent_data_df[parent_ordered_columns + remaining_columns]

# Save to OUTPUT_DIR (configured based on use_human_readable)
parent_data_df.to_csv(
    os.path.join(OUTPUT_DIR, f"{flow_form_id}_parent_data.csv"),
    index=False
)
```

**Child data with separate files per form:**
```python
if len(child_data) > 0:
    # Group child data by form_id
    child_data_by_form = {}
    for record in child_data:
        form_id = record.get("form_id")
        if form_id not in child_data_by_form:
            child_data_by_form[form_id] = []
        child_data_by_form[form_id].append(record)

    # Process each child form separately
    for child_form_id, child_form_data in child_data_by_form.items():
        child_form_df = pd.DataFrame(child_form_data)

        # Filter to valid parents
        child_form_df = child_form_df[
            child_form_df["datapoint_id"].isin(parent_data_df["datapoint_id"])
        ]

        # Add parent column
        child_form_df["parent"] = child_form_df["parent_name"].map(parent_name_mapping)
        child_form_df = child_form_df.drop(columns=["parent_name"])

        # Get form-specific seed_questions for column ordering
        child_form_seed_questions = [
            fq for fq in seed_questions
            if fq[MIS_FORM_ID_COL] == child_form_id
        ]

        # Apply conditional column renaming and ordering
        if child_form_seed_questions:
            if use_human_readable:
                # Build label mapping and rename columns
                child_form_question_mapping = {}
                for q in child_form_seed_questions[0]["questions"]:
                    qid = q[MIS_QUESTION_ID_COL]
                    qlabel = q.get(MIS_QUESTION_LABEL_COL, qid)
                    if pd.notna(qlabel) and qlabel != "":
                        child_form_question_mapping[qid] = qlabel
                        child_form_question_mapping[str(qid)] = qlabel

                child_sorted_mapping = build_sorted_column_mapping(
                    child_form_question_mapping, child_form_seed_questions
                )
                child_form_df = child_form_df.rename(columns=child_sorted_mapping)

                child_ordered_columns = build_ordered_column_list(
                    child_form_seed_questions,
                    metadata_cols=["form_id", "identifier", "created_at", "datapoint_id",
                                  "submitter", "name", "parent"]
                )
            else:
                # Keep question IDs but reorder by mis_question_order
                child_ordered_columns = build_ordered_column_list_by_id(
                    child_form_seed_questions,
                    metadata_cols=["form_id", "identifier", "created_at", "datapoint_id",
                                  "submitter", "name", "parent"]
                )

        # Reorder columns
        child_ordered_columns = [col for col in child_ordered_columns if col in child_form_df.columns]
        remaining_columns = [col for col in child_form_df.columns if col not in child_ordered_columns]
        child_form_df = child_form_df[child_ordered_columns + remaining_columns]

        # Save with form-specific filename to OUTPUT_DIR
        child_output_filename = f"{flow_form_id}_child_data_{int(child_form_id)}.csv"
        child_form_df.to_csv(
            os.path.join(OUTPUT_DIR, child_output_filename),
            index=False
        )
```

---

## Part 2: Backend Changes (`flow_data_seeder.py` and utilities)

### 2.1 Update `seeder_config.py`

**File:** `backend/utils/seeder_config.py`

Add new constant for child file pattern:

```python
class FilePaths:
    """File path constants."""
    OUTPUT_DIR = "data"
    SEEDED_DIR = "seeded"
    SOURCE_DIR = "storage/akvo-flow"
    ADMINISTRATION_MAPPING = "administration_mapping.csv"
    CHILD_FILE_PATTERN = "{flow_id}_child_data_*.csv"  # NEW
```

### 2.2 Update `seeder_data_loader.py`

**File:** `backend/utils/seeder_data_loader.py`

#### 2.2.1 Add new function to load multiple child files:

```python
def load_child_data_files(
    flow_id: int,
    config: SeederConfig
) -> Dict[int, pd.DataFrame]:
    """
    Load all child data CSV files for a given flow ID.

    Looks for files matching pattern: {flow_id}_child_data_{form_id}.csv
    Falls back to single file: {flow_id}_child_data.csv for backwards compatibility.

    Args:
        flow_id: The Akvo Flow form ID
        config: SeederConfig instance

    Returns:
        Dictionary mapping child form_id to DataFrame
    """
    import glob

    child_data = {}
    data_dir = os.path.join(config.source_dir, FilePaths.OUTPUT_DIR)

    # Try pattern-based loading first (new format)
    pattern = os.path.join(data_dir, f"{flow_id}_child_data_*.csv")
    child_files = glob.glob(pattern)

    if child_files:
        for child_file in child_files:
            filename = os.path.basename(child_file)
            # Extract form_id from filename: {flow_id}_child_data_{form_id}.csv
            match = re.match(rf"{flow_id}_child_data_(\d+)\.csv", filename)
            if match:
                child_form_id = int(match.group(1))
                try:
                    df = pd.read_csv(child_file, encoding=config.encoding, low_memory=False)
                    child_data[child_form_id] = df
                    logger.info(f"Loaded {len(df)} rows from {filename} (form_id: {child_form_id})")
                except Exception as e:
                    logger.error(f"Error loading {filename}: {e}")
    else:
        # Fallback: try single child file (backwards compatibility)
        single_file = os.path.join(data_dir, f"{flow_id}_child_data.csv")
        if os.path.exists(single_file):
            try:
                df = pd.read_csv(single_file, encoding=config.encoding, low_memory=False)
                # Use form_id from first row if available, otherwise use 0
                form_id = int(df[CsvColumns.FORM_ID].iloc[0]) if CsvColumns.FORM_ID in df.columns else 0
                child_data[form_id] = df
                logger.info(f"Loaded {len(df)} rows from single child file (backwards compat)")
            except Exception as e:
                logger.error(f"Error loading single child file: {e}")

    return child_data
```

#### 2.2.2 Update `load_and_prepare_data()`:

```python
def load_and_prepare_data(
    config: SeederConfig
) -> Tuple[Optional[pd.DataFrame], Dict[int, pd.DataFrame]]:
    """
    Load and prepare data files.

    Returns:
        Tuple of (parent_df, child_data_dict) where child_data_dict maps
        form_id to DataFrame
    """
    parent_df = load_data_file(config.flow_form_id, is_parent=True, config=config)

    # Load child data (multiple files supported)
    child_data_dict = load_child_data_files(config.flow_form_id, config)

    # Apply limit if specified
    if config.limit and parent_df is not None:
        parent_df = parent_df.head(config.limit)

        # Filter child data to match limited parents
        parent_identifiers = parent_df[CsvColumns.IDENTIFIER].unique()
        for form_id, child_df in child_data_dict.items():
            child_data_dict[form_id] = child_df[
                child_df[CsvColumns.IDENTIFIER].isin(parent_identifiers)
            ]

    return parent_df, child_data_dict
```

#### 2.2.3 Add function to load questions per child form:

```python
def load_questions_for_child_forms(
    child_data_dict: Dict[int, pd.DataFrame]
) -> Dict[int, Dict[int, Any]]:
    """
    Load questions for each child form.

    Args:
        child_data_dict: Dictionary mapping form_id to DataFrame

    Returns:
        Dictionary mapping form_id to questions dict
    """
    questions_by_form = {}

    for form_id, child_df in child_data_dict.items():
        if child_df is not None and not child_df.empty:
            questions_by_form[form_id] = load_questions(child_df)

    return questions_by_form
```

### 2.3 Update `seeder_data_processor.py`

**File:** `backend/utils/seeder_data_processor.py`

#### 2.3.1 Update `process_child_data_for_parent()`:

```python
def process_child_data_for_parent(
    parent_row: pd.Series,
    config: SeederConfig,
    parent_form_data: FormData,
    child_data_groups_dict: Dict[int, pd.core.groupby.DataFrameGroupBy],
    child_questions_dict: Dict[int, Dict[int, Any]],
    existing_records: Optional[List[FormData]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Process all child rows for a given parent across multiple child forms.

    Args:
        parent_row: Parent row containing identifier (uuid)
        config: SeederConfig instance
        parent_form_data: Parent FormData instance
        child_data_groups_dict: Dict mapping form_id to grouped child dataframe
        child_questions_dict: Dict mapping form_id to questions
        existing_records: Optional list of existing child records

    Returns:
        Tuple of (results_list, invalid_answers_list)
    """
    parent_identifier = parent_row[CsvColumns.IDENTIFIER]
    all_results = []
    all_invalid = []

    for form_id, child_data_groups in child_data_groups_dict.items():
        child_questions = child_questions_dict.get(form_id, {})

        try:
            child_rows = child_data_groups.get_group(parent_identifier)
        except KeyError:
            # No child rows for this parent in this form
            continue

        # Filter existing records for this form
        form_existing_records = [
            r for r in (existing_records or [])
            if r.form_id == form_id
        ] if existing_records else None

        results, invalid = process_data_rows(
            df=child_rows,
            config=config,
            questions=child_questions,
            administration_id=parent_form_data.administration_id,
            parent=parent_form_data,
            is_parent=False,
            existing_records=form_existing_records,
        )

        all_results.extend(results)
        all_invalid.extend(invalid)

    return all_results, all_invalid
```

### 2.4 Update `flow_data_seeder.py` Main Command

**File:** `backend/api/v1/v1_data/management/commands/flow_data_seeder.py`

#### 2.4.1 Update imports:

```python
from utils.seeder_data_loader import (
    load_and_prepare_data,
    load_questions,
    load_questions_for_child_forms,  # NEW
    load_administration_mappings,
    load_administration_db_mappings,
    get_administration_id,
)
```

#### 2.4.2 Update handle() method:

Replace lines ~157-213 with:

```python
# Load and prepare data (now returns dict of child DataFrames)
parent_df, child_data_dict = load_and_prepare_data(config)

# Add success column
parent_df['success'] = 'No'
for form_id, child_df in child_data_dict.items():
    if child_df is not None and not child_df.empty:
        child_data_dict[form_id]['success'] = 'No'

# ... (administration mapping loading stays same)

# Build parent-children mapping for logging
parent_children_map = {}
if not registration_only and child_data_dict:
    for form_id, child_df in child_data_dict.items():
        if child_df is not None and not child_df.empty:
            for _, child_row in child_df.iterrows():
                parent_dp_id = child_row[CsvColumns.PARENT]
                child_dp_id = child_row[CsvColumns.DATAPOINT_ID]
                if parent_dp_id not in parent_children_map:
                    parent_children_map[parent_dp_id] = []
                parent_children_map[parent_dp_id].append(child_dp_id)

# Prepare questions for all child forms
child_questions_dict = {}
child_data_groups_dict = {}

if not registration_only and child_data_dict:
    child_questions_dict = load_questions_for_child_forms(child_data_dict)

    # Group children by identifier for each form
    for form_id, child_df in child_data_dict.items():
        if child_df is not None and not child_df.empty:
            child_data_groups_dict[form_id] = child_df.groupby(CsvColumns.IDENTIFIER)

parent_questions = load_questions(parent_df)
```

#### 2.4.3 Update child processing in main loop:

Replace lines ~284-305 with:

```python
# Process child rows (only if not registration-only mode)
if child_data_groups_dict:
    c_results, c_invalid = process_child_data_for_parent(
        parent_row=parent_row,
        config=config,
        parent_form_data=parent_form_data,
        child_data_groups_dict=child_data_groups_dict,
        child_questions_dict=child_questions_dict,
        existing_records=seeded_children,
    )
    total_new_child += sum(1 for r in c_results if r.get('is_new', True))
    invalid_answers.extend(c_invalid)

    # Mark successful children in respective DataFrames
    for result in c_results:
        child_form_id = result.get('form_id')
        if child_form_id in child_data_dict:
            child_mask = (
                child_data_dict[child_form_id][CsvColumns.DATAPOINT_ID] ==
                result['flow_data_id']
            )
            child_data_dict[child_form_id].loc[child_mask, 'success'] = 'Yes'
```

#### 2.4.4 Update CSV output writing:

Replace lines ~364-375 with:

```python
# Write child CSVs (one per form)
if not registration_only and child_data_dict:
    for form_id, child_df in child_data_dict.items():
        if child_df is not None and not child_df.empty:
            child_csv_path = os.path.join(
                config.source_dir,
                FilePaths.OUTPUT_DIR,
                f"{config.flow_form_id}_child_data_{form_id}.csv",
            )
            child_df.to_csv(child_csv_path, index=False, encoding="utf-8")
            self._log_info(f"Updated child CSV: {child_csv_path}")

# Log success summary for each child form
if not registration_only and child_data_dict:
    for form_id, child_df in child_data_dict.items():
        if child_df is not None and not child_df.empty:
            child_success = (child_df['success'] == 'Yes').sum()
            child_total = len(child_df)
            self._log_info(f"Child form {form_id} success: {child_success}/{child_total}")
```

---

## Part 3: Summary of Changes

### Files to Modify

| File | Changes |
|------|---------|
| `scripts/akvo-flow/af_data_registration_monitoring.ipynb` | Add constants, helper functions, child form mapping, reordering logic, separate CSV output |
| `backend/utils/seeder_config.py` | Add `CHILD_FILE_PATTERN` constant |
| `backend/utils/seeder_data_loader.py` | Add `load_child_data_files()`, `load_questions_for_child_forms()`, update `load_and_prepare_data()` |
| `backend/utils/seeder_data_processor.py` | Update `process_child_data_for_parent()` signature and logic |
| `backend/api/v1/v1_data/management/commands/flow_data_seeder.py` | Update imports, data loading, child processing loop, CSV output |

### New File Naming Convention

**Before:**
```
storage/akvo-flow/data/
├── 8520967_parent_data.csv
└── 8520967_child_data.csv          # Single file with all children
```

**After:**
```
storage/akvo-flow/data/
├── 8520967_parent_data.csv
├── 8520967_child_data_1749640508297.csv   # Quick Monitoring form
└── 8520967_child_data_1749652214711.csv   # Full Monitoring form
```

### Backwards Compatibility

The seeder will maintain backwards compatibility by:
1. First looking for pattern `{flow_id}_child_data_*.csv`
2. Falling back to single `{flow_id}_child_data.csv` if no pattern matches found

---

## Part 4: Testing Strategy

### 4.1 Notebook Testing

1. Run `af_data_registration_monitoring.ipynb` with different flow forms
2. Verify separate child CSV files are created
3. Verify column names are human-readable labels
4. Verify columns are ordered by `mis_question_order`

### 4.2 Seeder Testing

1. Test with new multi-file format:
   ```bash
   ./dc.sh exec backend python manage.py flow_data_seeder -f 8520967 --email test@test.com --limit 10
   ```

2. Test backwards compatibility with single file:
   ```bash
   # Rename files to old format and test
   ```

3. Test revert functionality:
   ```bash
   ./dc.sh exec backend python manage.py flow_data_seeder -f 8520967 --revert
   ```

### 4.3 Unit Tests to Add

- `test_load_child_data_files_multiple()`
- `test_load_child_data_files_single_fallback()`
- `test_process_child_data_multi_form()`

---

## Part 5: Implementation Order

1. **Phase 1 - Notebook**: Update `af_data_registration_monitoring.ipynb`
   - Add constants and helper functions
   - Add child form mapping
   - Update data processing loop
   - Update output cell for separate CSVs

2. **Phase 2 - Backend Utilities**: Update loader and processor
   - Add `load_child_data_files()` function
   - Add `load_questions_for_child_forms()` function
   - Update `load_and_prepare_data()` return type
   - Update `process_child_data_for_parent()` signature

3. **Phase 3 - Main Command**: Update `flow_data_seeder.py`
   - Update imports
   - Update data loading section
   - Update child processing loop
   - Update CSV output section

4. **Phase 4 - Testing**: Run end-to-end tests
   - Test notebook output
   - Test seeder with new format
   - Test backwards compatibility

---

## Appendix: Type Changes

### Return Type Changes

| Function | Before | After |
|----------|--------|-------|
| `load_and_prepare_data()` | `Tuple[DataFrame, DataFrame]` | `Tuple[DataFrame, Dict[int, DataFrame]]` |
| `process_child_data_for_parent()` | Accepts `DataFrameGroupBy` | Accepts `Dict[int, DataFrameGroupBy]` |
