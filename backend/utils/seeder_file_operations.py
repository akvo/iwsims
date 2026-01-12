"""
Seeder File Operations Module

This module handles file operations for the Flow seeder, including saving
seeded records to CSV files and reverting seeded data.
"""

import os
import pandas as pd
import logging
from django.db import transaction
from api.v1.v1_data.models import FormData
from .seeder_config import FilePaths

logger = logging.getLogger(__name__)


def save_seeded_records(
    flow_form_id: int,
    parent_seeded: list,
    child_seeded: list,
) -> None:
    """Save seeded records to CSV files.

    Args:
        flow_form_id: Flow form ID
        parent_seeded: List of parent seeded records
        child_seeded: List of child seeded records

    Raises:
        SeedingError: If saving fails
    """
    try:
        # Save parent records
        save_seeded_file(
            flow_form_id, is_parent=True, seeded_data=parent_seeded
        )

        # Save child records
        save_seeded_file(
            flow_form_id, is_parent=False, seeded_data=child_seeded
        )

    except Exception as e:
        logger.error(f"Error saving seeded records: {e}")
        raise


def save_seeded_file(
    flow_form_id: int,
    is_parent: bool,
    seeded_data: list,
) -> None:
    """Save seeded data to CSV file.

    Args:
        flow_form_id: Flow form ID
        is_parent: True for parent data, False for child data
        seeded_data: List of seeded records

    Raises:
        SeedingError: If saving fails
    """
    try:
        seeded_df = pd.DataFrame(seeded_data)
        csv_file = f"{flow_form_id}_parent_data.csv" \
            if is_parent else f"{flow_form_id}_child_data.csv"
        csv_path = os.path.join(
            FilePaths.SOURCE_DIR, "seeded", csv_file
        )
        seeded_df.to_csv(csv_path, index=False, encoding="utf-8")

        logger.info(
            f"Saved {len(seeded_data)} "
            f"{'parent' if is_parent else 'child'} records to {csv_path}"
        )

    except Exception as e:
        logger.error(f"Error saving seeded file: {e}")
        raise


def revert_seeded_data(flow_form_id: int) -> None:
    """Revert seeded data for a form.

    This function deletes FormData records that were previously seeded
    and clears the seeded CSV files.

    Args:
        flow_form_id: Flow form ID

    Raises:
        SeedingError: If reverting fails
    """
    try:
        # Revert child data first
        revert_seeded_file(flow_form_id, is_parent=False)

        # Revert parent data
        revert_seeded_file(flow_form_id, is_parent=True)

    except Exception as e:
        logger.error(f"Error reverting seeded data: {e}")
        raise


def revert_seeded_file(
    flow_form_id: int,
    is_parent: bool,
    source_dir: str = None,
) -> None:
    """Revert seeded data from CSV file.

    This function loads the seeded CSV file, deletes the corresponding
    FormData records, and clears the CSV file.

    Args:
        flow_form_id: Flow form ID
        is_parent: True for parent data, False for child data
        source_dir: Source directory path (defaults to FilePaths.SOURCE_DIR)

    Raises:
        SeedingError: If reverting fails
    """

    if source_dir is None:
        source_dir = FilePaths.SOURCE_DIR

    try:
        csv_file = f"{flow_form_id}_parent_data.csv" \
            if is_parent else f"{flow_form_id}_child_data.csv"
        seeded_csv_path = os.path.join(source_dir, "seeded", csv_file)
        seeded_df = pd.read_csv(seeded_csv_path, encoding="utf-8")

        with transaction.atomic():
            for _, row in seeded_df.iterrows():
                mis_data_id = row["mis_data_id"]
                FormData.objects.filter(pk=mis_data_id).delete(hard=True)

        logger.info(
            f"Successfully reverted "
            f"{'parent' if is_parent else 'child'} data from {seeded_csv_path}"
            f", deleted {len(seeded_df)} records"
        )

        # Clear CSV to avoid re-reverting
        seeded_df = seeded_df.iloc[0:0]
        seeded_df.to_csv(seeded_csv_path, index=False, encoding="utf-8")

    except FileNotFoundError:
        logger.warning(
            f"Seeded file not found: {seeded_csv_path}"
        )
    except Exception as e:
        logger.error(f"Error reverting seeded file: {e}")
        raise
