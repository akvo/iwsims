"""
Seeder Data Loader Module

This module provides data loading functionality for Flow Complete Seeder.
"""

import logging
import os
from typing import Dict, Optional, Tuple

import pandas as pd
from django.db import transaction

from api.v1.v1_forms.models import Questions
from api.v1.v1_profile.models import Administration

from .seeder_config import (
    FilePaths,
    CsvColumns,
    NON_QUESTION_COLUMNS,
    DataLoadError,
    AdministrationMappingError,
    SeederConfig,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Data Loading
# =============================================================================


def load_and_prepare_data(
    config: SeederConfig,
) -> Tuple[Optional[pd.DataFrame], Optional[pd.DataFrame]]:
    """Load and prepare data files.

    Args:
        config: SeederConfig instance

    Returns:
        Tuple of (parent_df, child_df) DataFrames
    """
    parent_df = load_data_file(
        config.flow_form_id,
        is_parent=True,
        config=config,
    )
    child_df = load_data_file(
        config.flow_form_id,
        is_parent=False,
        config=config,
    )

    # Apply limit if specified
    if config.limit:
        if parent_df is not None:
            parent_df = parent_df.head(config.limit)
        if child_df is not None and parent_df is not None:
            # Only include child rows for the limited parent datapoints
            # to avoid skipping child data for parents beyond the first N rows
            parent_datapoints = parent_df[CsvColumns.DATAPOINT_ID].unique()
            child_df = child_df[child_df[CsvColumns.DATAPOINT_ID].isin(
                parent_datapoints
            )]

    return parent_df, child_df


def load_data_file(
    flow_id: int,
    is_parent: bool,
    config: SeederConfig,
) -> Optional[pd.DataFrame]:
    """Load data file from CSV.

    Args:
        flow_id: Flow form ID
        is_parent: Whether loading parent or child data
        config: SeederConfig instance

    Returns:
        DataFrame with loaded data or None if file not found

    Raises:
        DataLoadError: If file cannot be loaded
    """
    csv_file = (
        f"{flow_id}_parent_data.csv"
        if is_parent
        else f"{flow_id}_child_data.csv"
    )
    csv_path = os.path.join(
        config.source_dir,
        FilePaths.OUTPUT_DIR,
        csv_file,
    )

    try:
        df = pd.read_csv(
            csv_path,
            encoding=config.encoding,
            low_memory=False,
        )
        logger.info(f"Loaded {len(df)} rows from {csv_file}")
        return df
    except FileNotFoundError:
        logger.warning(f"File not found: {csv_path}")
        return None
    except pd.errors.EmptyDataError:
        logger.warning(f"File is empty: {csv_path}")
        return None
    except pd.errors.ParserError as e:
        raise DataLoadError(f"CSV parsing error in {csv_path}: {e}")
    except UnicodeDecodeError:
        raise DataLoadError(f"Encoding error in file: {csv_path}")


# =============================================================================
# Question Loading
# =============================================================================


def load_questions(df: Optional[pd.DataFrame]) -> Dict[int, Questions]:
    """Load questions from dataframe columns.

    Args:
        df: DataFrame to extract question IDs from

    Returns:
        Dictionary mapping question ID to Question object
    """
    if df is None or df.empty:
        return {}

    question_ids = [
        int(col)
        for col in df.columns
        if col not in NON_QUESTION_COLUMNS
    ]

    if not question_ids:
        return {}

    questions = Questions.objects.filter(pk__in=question_ids).all()

    return {q.pk: q for q in questions}


# =============================================================================
# Administration Mappings
# =============================================================================


def load_administration_mappings(
    config: SeederConfig,
) -> Dict[int, str]:
    """Load administration mapping values from CSV file.

    Args:
        config: SeederConfig instance

    Returns:
        Dictionary mapping flow_datapoint_id to mis_value

    Raises:
        AdministrationMappingError: If mapping file cannot be loaded
    """
    csv_path = os.path.join(
        config.source_dir,
        FilePaths.ADMINISTRATION_MAPPING,
    )

    try:
        df = pd.read_csv(
            csv_path,
            encoding=config.encoding,
            dtype={
                "flow_question_id": str,
                "mis_question_id": str,
            },
        )
        # Filter to only include rows with valid 'mis_value'
        df = df[df["mis_value"].notna() & (df["mis_value"] != "")]
        # Create a dict for adm[flow_datapoint_id] = mis_value
        adm_mappings = {
            int(row["flow_datapoint_id"]): row["mis_value"]
            for _, row in df.iterrows()
        }
        logger.info(
            f"Loaded {len(adm_mappings)} "
            f"administration mappings"
        )
        return adm_mappings
    except FileNotFoundError:
        logger.warning(
            f"Administration mapping file not found: {csv_path}"
        )
        return {}
    except pd.errors.EmptyDataError:
        logger.warning(
            f"Administration mapping file is empty: {csv_path}"
        )
        return {}
    except KeyError as e:
        raise AdministrationMappingError(f"CSV structure error: {e}")


def load_administration_db_mappings() -> Dict[str, str]:
    """Load administration mappings from database.

    Returns:
        Dictionary mapping administration name to ID

    Raises:
        AdministrationMappingError: If mappings cannot be loaded
    """
    try:
        adm_db_mappings = {
            adm.name: str(adm.id)
            for adm in Administration.objects.filter(
                parent__isnull=False
            ).only("id", "name")
        }
        logger.info(
            f"Loaded {len(adm_db_mappings)} "
            f"administration DB mappings"
        )
        return adm_db_mappings
    except Exception as e:
        raise AdministrationMappingError(
            f"Error loading DB mappings: {e}"
        )


def get_administration_id(
    row: pd.Series,
    adm_mappings: Dict[int, str],
    adm_db_mappings: Dict[str, str],
) -> Optional[int]:
    """Get administration ID from mappings.

    Args:
        row: Pandas Series containing row data
        adm_mappings: Flow datapoint to MIS administration mapping
        adm_db_mappings: Administration name to ID mapping

    Returns:
        Administration ID or None if not found
    """
    # Try flow datapoint mapping first
    administration_id = adm_mappings.get(
        int(row[CsvColumns.DATAPOINT_ID])
    )
    if administration_id:
        return int(administration_id)

    # Fall back to administration name mapping
    administration_id = adm_db_mappings.get(
        str(row[CsvColumns.ADMINISTRATION])
    )
    if administration_id:
        return int(administration_id)

    return None


# =============================================================================
# Revert Operations
# =============================================================================


def revert_seeded_file(
    flow_form_id: int,
    is_parent: bool,
    source_dir: str,
) -> bool:
    """Revert seeded data from a specific file.

    Args:
        flow_form_id: Form ID
        is_parent: Whether reverting parent or child data
        source_dir: Source directory path

    Returns:
        True if data was reverted, False otherwise
    """
    csv_file = (
        f"{flow_form_id}_child_data.csv"
        if not is_parent
        else f"{flow_form_id}_parent_data.csv"
    )
    seeded_csv_path = os.path.join(
        source_dir,
        FilePaths.SEEDED_DIR,
        csv_file,
    )

    try:
        seeded_df = pd.read_csv(seeded_csv_path, encoding="utf-8")
    except FileNotFoundError:
        logger.warning(f"Seeded file not found: {seeded_csv_path}")
        return False
    except pd.errors.EmptyDataError:
        logger.warning(f"Seeded file is empty: {seeded_csv_path}")
        return False

    if seeded_df.empty:
        logger.warning(f"No seeded data to revert in {csv_file}")
        return False

    # Bulk delete records
    from api.v1.v1_data.models import FormData

    mis_data_ids = seeded_df["mis_data_id"].tolist()
    with transaction.atomic():
        FormData.objects.filter(pk__in=mis_data_ids).delete(hard=True)

    record_type = "child" if not is_parent else "parent"
    logger.info(
        f"Successfully reverted {len(mis_data_ids)} "
        f"{record_type} records from {csv_file}"
    )

    # Set empty CSV to avoid re-reverting
    empty_df = pd.DataFrame(columns=seeded_df.columns)
    empty_df.to_csv(seeded_csv_path, index=False, encoding="utf-8")

    return True


def load_seeded_records(
    flow_form_id: int,
    is_parent: bool,
    source_dir: str,
) -> Dict[int, int]:
    """Load existing seeded records from CSV file.

    Args:
        flow_form_id: Flow form ID
        is_parent: Whether loading parent or child data
        source_dir: Source directory path

    Returns:
        Dictionary mapping flow_data_id to mis_data_id
    """
    csv_file = (
        f"{flow_form_id}_parent_data.csv"
        if is_parent
        else f"{flow_form_id}_child_data.csv"
    )
    seeded_csv_path = os.path.join(
        source_dir,
        FilePaths.SEEDED_DIR,
        csv_file,
    )

    try:
        seeded_df = pd.read_csv(seeded_csv_path, encoding="utf-8")
        if seeded_df.empty:
            logger.info(
                f"No existing seeded records in {csv_file}"
            )
            return {}

        seeded_records = {
            int(row["flow_data_id"]): int(row["mis_data_id"])
            for _, row in seeded_df.iterrows()
        }
        logger.info(
            f"Loaded {len(seeded_records)} existing "
            f"{'parent' if is_parent else 'child'} records "
            f"from {csv_file}"
        )
        return seeded_records
    except FileNotFoundError:
        logger.info(
            f"Seeded file not found: {seeded_csv_path}"
        )
        return {}
    except pd.errors.EmptyDataError:
        logger.info(
            f"Seeded file is empty: {seeded_csv_path}"
        )
        return {}
    except KeyError as e:
        logger.error(f"CSV structure error: {e}")
        return {}
    except Exception as e:
        logger.error(f"Error loading seeded records: {e}")
        return {}
