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
    python manage.py flow_data_seeder -f <form_id> --email <user_email>

Examples:
    # Seed all data for form 123
    python manage.py flow_data_seeder -f 123 --email user@example.com

    # Seed with limit
    python manage.py flow_data_seeder -f 123 \\
        --email user@example.com --limit 100

    # Seed registration data only (exclude monitoring)
    python manage.py flow_data_seeder -f 123 \\
        --email user@example.com --registration

    # Revert seeded data
    python manage.py flow_data_seeder -f 123 --revert
"""

import os
import logging
import pandas as pd
from django.core.management import BaseCommand

from api.v1.v1_visualization.functions import refresh_materialized_data

from utils.seeder_config import (
    CsvColumns,
    FilePaths,
    ValidationError,
    ConfigurationError,
    validate_and_prepare_config,
    get_form_by_flow_id,
    FLOW_PREFIX,
)
from utils.seeder_data_loader import (
    load_and_prepare_data,
    load_questions,
    load_administration_mappings,
    load_administration_db_mappings,
    get_administration_id,
)
from utils.seeder_data_processor import (
    process_child_data_for_parent,
    create_form_data,
    prepare_answer_data,
    bulk_create_answers,
    revert_form_data,
)
from utils.seeder_answer_processor import AnswerProcessor

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
        parser.add_argument(
            "--registration",
            action="store_true",
            help=(
                "Seed registration (parent) data only,"
                "exclude monitoring (child) data"
            ),
        )

    def handle(self, *args, **options):
        """Main entry point - orchestrates seeding process.

        Args:
            *args: Additional positional arguments
            **options: Command-line options
        """
        try:
            config = validate_and_prepare_config(options)
            registration_only = options.get("registration", False)

            form = get_form_by_flow_id(config.flow_form_id)

            if options.get("revert"):
                self._log_info(
                    f"\n{'='*60}\n"
                    f"Reverting Flow Data Seeding\n"
                    f"Form ID: {config.flow_form_id}\n"
                )
                total_reverted = revert_form_data(form=form)
                self._log_info(
                    "Total reverted records"
                    f"including children: {total_reverted}"
                )
                return

            self._log_info(
                f"\n{'='*60}\n"
                f"Starting Flow Data Seeding\n"
                f"Form ID: {config.flow_form_id}\n"
            )

            if registration_only:
                self._log_info(
                    "Mode: Registration only (monitoring data will be skipped)"
                )

            # Load and prepare data
            parent_df, child_df = load_and_prepare_data(config)

            # Add success column (default 'No')
            parent_df['success'] = 'No'
            if child_df is not None and not child_df.empty:
                child_df['success'] = 'No'

            # load administration mappings
            adm_mappings = load_administration_mappings(config)
            adm_db_mappings = load_administration_db_mappings()

            # Load existing seeded records
            seeded_parents = form.form_form_data.filter(
                name__startswith=FLOW_PREFIX,
            ).all()
            seeded_children = [
                c
                for d in seeded_parents
                for c in d.children.all()
            ]

            # Process data
            total_existing_parent = len(seeded_parents)
            total_existing_child = len(seeded_children)
            total_new_parent = 0
            total_new_child = 0
            invalid_answers = []

            # Build parent-children mapping from child CSV for logging
            parent_children_map = {}  # parent_datapoint_id -> [child_ids]

            if (
                not registration_only and
                child_df is not None and
                not child_df.empty
            ):
                for _, child_row in child_df.iterrows():
                    parent_dp_id = child_row[CsvColumns.PARENT]
                    child_dp_id = child_row[CsvColumns.DATAPOINT_ID]
                    if parent_dp_id not in parent_children_map:
                        parent_children_map[parent_dp_id] = []
                    parent_children_map[parent_dp_id].append(child_dp_id)

            # Prepare questions
            child_questions = None
            child_data_groups = None
            if (
                not registration_only and
                child_df is not None and
                not child_df.empty
            ):
                child_questions = load_questions(child_df)
                child_data_groups = child_df.groupby(CsvColumns.PARENT)

            parent_questions = load_questions(parent_df)

            # Process parent data
            for idx, parent_row in parent_df.iterrows():
                try:
                    # Get administration ID for parent
                    admin_id = get_administration_id(
                        row=parent_row,
                        adm_mappings=adm_mappings,
                        adm_db_mappings=adm_db_mappings,
                    )
                    if not admin_id:
                        invalid_answers.append({
                            "mis_form_id": form.pk,
                            "mis_question_id": None,
                            "mis_question_type": "administration",
                            "flow_data_id": (
                                parent_row[CsvColumns.DATAPOINT_ID]
                            ),
                            "value": parent_row[CsvColumns.ADMINISTRATION],
                        })
                        continue

                    # Create parent answers
                    p_answers, p_invalid = prepare_answer_data(
                        row=parent_row,
                        questions=parent_questions,
                        administration_id=admin_id,
                        answer_processor=self.answer_processor,
                    )

                    invalid_answers.extend(p_invalid)

                    if len(p_answers) == 0:
                        continue

                    parent_exists = next(filter(
                        lambda er: er.id == int(
                            parent_row[CsvColumns.DATAPOINT_ID]
                        ),
                        seeded_parents
                    ), None)
                    # Create parent FormData
                    parent_form_data = create_form_data(
                        row=parent_row,
                        user=config.user,
                        administration_id=admin_id,
                        existing_record=parent_exists,
                    )

                    if not parent_form_data:
                        print(
                            "No parent form data created",
                            parent_row[CsvColumns.DATAPOINT_ID]
                        )
                        continue

                    bulk_create_answers(
                        parent_form_data,
                        p_answers,
                        config.user,
                    )
                    if not parent_exists:
                        total_new_parent += 1

                    # Mark parent as success
                    parent_df.at[idx, 'success'] = 'Yes'

                    # Process child rows (only if not registration-only mode)
                    if child_data_groups is not None:
                        c_results, c_invalid = process_child_data_for_parent(
                            parent_row=parent_row,
                            config=config,
                            parent_form_data=parent_form_data,
                            child_data_groups=child_data_groups,
                            child_questions=child_questions,
                            existing_records=seeded_children,
                        )
                        # Count only new records, not updates
                        total_new_child += sum(
                            1 for r in c_results if r.get('is_new', True)
                        )
                        invalid_answers.extend(c_invalid)

                        # Mark successful children in child_df
                        for result in c_results:
                            child_mask = (
                                child_df[CsvColumns.DATAPOINT_ID] ==
                                result['flow_data_id']
                            )
                            child_df.loc[child_mask, 'success'] = 'Yes'

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

            # Write back CSVs with success column
            parent_csv_path = os.path.join(
                config.source_dir,
                FilePaths.OUTPUT_DIR,
                f"{config.flow_form_id}_parent_data.csv",
            )
            parent_df.to_csv(parent_csv_path, index=False, encoding="utf-8")
            self._log_info(f"Updated parent CSV: {parent_csv_path}")

            if (
                not registration_only and
                child_df is not None and
                not child_df.empty
            ):
                child_csv_path = os.path.join(
                    config.source_dir,
                    FilePaths.OUTPUT_DIR,
                    f"{config.flow_form_id}_child_data.csv",
                )
                child_df.to_csv(child_csv_path, index=False, encoding="utf-8")
                self._log_info(f"Updated child CSV: {child_csv_path}")

            # Log success summary
            parent_success = (parent_df['success'] == 'Yes').sum()
            parent_total = len(parent_df)
            self._log_info(
                f"Parent success: {parent_success}/{parent_total}"
            )
            if (
                not registration_only and
                child_df is not None and
                not child_df.empty
            ):
                child_success = (child_df['success'] == 'Yes').sum()
                child_total = len(child_df)
                self._log_info(
                    f"Child success: {child_success}/{child_total}"
                )

            # Refresh materialized view after seeding
            refresh_materialized_data()

        except ValidationError as e:
            # Validation errors should be logged but not re-raised
            self._log_error(str(e))
        except ConfigurationError as e:
            # Configuration errors should be logged but not re-raised
            self._log_error(str(e))
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
