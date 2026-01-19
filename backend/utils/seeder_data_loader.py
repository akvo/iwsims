"""
Seeder Data Loader Module

This module provides data loading functionality for Flow Complete Seeder.
"""

import logging
import os
from typing import Dict, Optional, Tuple

import pandas as pd

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
            # Only include child rows for the limited parent identifiers (uuid)
            # We use identifier because children share the same identifier
            # as their parent registration in Akvo Flow
            parent_identifiers = parent_df[CsvColumns.IDENTIFIER].unique()
            child_df = child_df[child_df[CsvColumns.IDENTIFIER].isin(
                parent_identifiers
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
        int(float(col))
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
