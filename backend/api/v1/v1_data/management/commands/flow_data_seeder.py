"""
Flow Complete Seeder - Django Management Command

This command reads data exported from Akvo Flow and seeds it into the
MIS database, creating FormData and Answer records. It supports both
parent and child data, with proper administration mapping and answer
processing.

This implementation adheres to DRY (Don't Repeat Yourself) principle by
abstracting repetitive parent/child processing logic into unified, generic
methods, with internal functions extracted to modular utility files.

Usage:
    python manage.py flow_complete_seeder -f <form_id> --email <user_email>

Examples:
    # Seed all data for form 123
    python manage.py flow_complete_seeder -f 123 --email user@example.com

    # Seed with limit
    python manage.py flow_complete_seeder -f 123 \\
        --email user@example.com --limit 100

    # Revert seeded data
    python manage.py flow_complete_seeder -f 123 --revert
"""

import os
import logging
import pandas as pd
from django.core.management import BaseCommand

from api.v1.v1_visualization.functions import refresh_materialized_data

from utils.seeder_config import CsvColumns, FilePaths
from utils.seeder_data_loader import (
    load_and_prepare_data,
    load_questions,
    load_administration_mappings,
    load_administration_db_mappings,
    get_administration_id,
    load_seeded_records,
)
from utils.seeder_data_processor import (
    process_child_data_for_parent,
    create_form_data,
    prepare_answer_data,
    bulk_create_answers,
)
from utils.seeder_answer_processor import AnswerProcessor
from utils.seeder_file_operations import (
    save_seeded_records,
    revert_seeded_data,
)
from utils.seeder_config import validate_and_prepare_config

logger = logging.getLogger(__name__)


# =============================================================================
# Main Command
# =============================================================================


class Command(BaseCommand):
    """Django management command for seeding Flow data into MIS."""

    help = "Seed data from Akvo Flow exports into MIS database"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.answer_processor = AnswerProcessor()

    def add_arguments(self, parser):
        """Add command arguments.

        Args:
            parser: Argument parser instance
        """
        parser.add_argument(
            "-f",
            "--form",
            type=int,
            required=True,
            help="Akvo Flow form ID",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Limit number of records to process",
        )
        parser.add_argument(
            "--revert",
            action="store_true",
            help="Revert seeded data",
        )
        parser.add_argument(
            "--email",
            type=str,
            required=False,
            help="Email of user running the command",
        )

    def handle(self, *args, **options):
        """Main entry point - orchestrates seeding process.

        Args:
            *args: Additional positional arguments
            **options: Command-line options
        """
        try:
            config = validate_and_prepare_config(options)

            if options.get("revert"):
                self._log_info(
                    f"\n{'='*60}\n"
                    f"Reverting Flow Data Seeding\n"
                    f"Form ID: {config.flow_form_id}\n"
                )
                revert_seeded_data(config.flow_form_id)
                return

            self._log_info(
                f"\n{'='*60}\n"
                f"Starting Flow Data Seeding\n"
                f"Form ID: {config.flow_form_id}\n"
            )

            # Load and prepare data
            parent_df, child_df = load_and_prepare_data(config)

            # load administration mappings
            adm_mappings = load_administration_mappings(config)
            adm_db_mappings = load_administration_db_mappings()

            # Load existing seeded records
            parent_existing = load_seeded_records(
                config.flow_form_id,
                is_parent=True,
                source_dir=config.source_dir,
            )
            child_existing = load_seeded_records(
                config.flow_form_id,
                is_parent=False,
                source_dir=config.source_dir,
            )

            # Process data
            parent_seeded = [
                {
                    "flow_data_id": parent_key,
                    "mis_data_id": parent_existing[parent_key],
                }
                for parent_key in list(parent_existing.keys())
            ]
            child_seeded = [
                {
                    "flow_data_id": child_key,
                    "mis_data_id": child_existing[child_key],
                }
                for child_key in list(child_existing.keys())
            ]
            total_existing_parent = len(parent_existing)
            total_existing_child = len(child_existing)
            total_new_parent = 0
            total_new_child = 0
            invalid_answers = []

            # Process child data
            if child_df is not None and not child_df.empty:
                child_questions = load_questions(child_df)
                child_data_groups = child_df.groupby(
                    CsvColumns.DATAPOINT_ID
                )

                for _, parent_row in parent_df.iterrows():
                    try:
                        # Get administration ID for parent
                        admin_id = get_administration_id(
                            row=parent_row,
                            adm_mappings=adm_mappings,
                            adm_db_mappings=adm_db_mappings,
                        )
                        if not admin_id:
                            # Skip if no administration mapping found
                            continue

                        # Create parent answers
                        p_answers, p_invalid = prepare_answer_data(
                            row=parent_row,
                            questions=load_questions(parent_df),
                            administration_id=admin_id,
                            answer_processor=self.answer_processor,
                        )

                        invalid_answers.extend(p_invalid)

                        if len(p_answers) == 0:
                            continue

                        # Create parent FormData
                        parent_form_data = create_form_data(
                            row=parent_row,
                            user=config.user,
                            administration_id=admin_id,
                            existing_records=parent_existing,
                        )

                        bulk_create_answers(
                            parent_form_data,
                            p_answers,
                            config.user,
                        )
                        if parent_form_data.pk not in parent_existing.values():
                            total_new_parent += 1
                            parent_seeded.append(
                                {
                                    "flow_data_id": parent_row[
                                        CsvColumns.DATAPOINT_ID
                                    ],
                                    "mis_data_id": parent_form_data.pk,
                                }
                            )

                        # Process child rows
                        c_results, c_invalid = process_child_data_for_parent(
                            parent_row=parent_row,
                            config=config,
                            parent_form_data=parent_form_data,
                            child_data_groups=child_data_groups,
                            child_questions=child_questions,
                            existing_records=child_existing,
                        )
                        total_new_child += len(list(filter(
                            lambda x: x["mis_data_id"]
                            not in child_existing.values(),
                            c_results,
                        )))
                        if total_new_child > 0:
                            child_seeded.extend(c_results)
                        # Accumulate invalid answers
                        invalid_answers.extend(c_invalid)

                    except Exception as e:
                        self._log_error(
                            f"Error processing parent row "
                            f"{parent_row[CsvColumns.DATAPOINT_ID]}: {e}"
                        )
                        logger.exception(
                            f"Error processing parent row "
                            f"{parent_row[CsvColumns.DATAPOINT_ID]}"
                        )
                        continue
            # Save seeded records
            save_seeded_records(
                config.flow_form_id,
                parent_seeded,
                child_seeded,
            )

            # Convert invalid answers to DataFrame and save if any
            if invalid_answers:
                invalid_df = pd.DataFrame(invalid_answers)
                invalid_file_path = os.path.join(
                    FilePaths.SOURCE_DIR,
                    "invalid_values",
                    f"{config.flow_form_id}_invalid_values_data.csv",
                )
                invalid_df.to_csv(
                    invalid_file_path, index=False, encoding="utf-8"
                )
                self._log_warning(
                    f"Saved {len(invalid_answers)} invalid answers to "
                    f"{invalid_file_path}"
                )

            self._log_success(
                f"Successfully completed seeding for form "
                f"{config.flow_form_id}"
            )
            # Statistics
            self._log_info(
                f"Total existing registration: {total_existing_parent}"
            )
            self._log_info(
                f"Total new registration: {total_new_parent}"
            )
            self._log_info(
                f"Total existing monitoring: {total_existing_child}"
            )
            self._log_info(
                f"Total new monitoring: {total_new_child}"
            )
            self._log_info(
                f"Total invalid answers encountered: {len(invalid_answers)}"
            )

            # Refresh materialized view after seeding
            refresh_materialized_data()

        except Exception as e:
            self._log_error(f"Unexpected error: {e}")
            logger.exception("Unexpected error during seeding")
            raise

    # =========================================================================
    # Logging Helpers
    # =========================================================================

    def _log_info(self, message: str):
        """Log info message to both logger and stdout.

        Args:
            message: Message to log
        """
        logger.info(message)
        self.stdout.write(self.style.HTTP_INFO(message))

    def _log_success(self, message: str):
        """Log success message to both logger and stdout.

        Args:
            message: Message to log
        """
        logger.info(message)
        self.stdout.write(self.style.SUCCESS(message))

    def _log_warning(self, message: str):
        """Log warning message to both logger and stdout.

        Args:
            message: Message to log
        """
        logger.warning(message)
        self.stdout.write(self.style.WARNING(message))

    def _log_error(self, message: str):
        """Log error message to both logger and stdout.

        Args:
            message: Message to log
        """
        logger.error(message)
        self.stdout.write(self.style.ERROR(message))
