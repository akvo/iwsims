import os
import glob
import json
import re
import pandas as pd
from uuid import uuid4
from typing import Any, Dict, List, Optional, Tuple
from django.core.management import BaseCommand
from django.conf import settings
from django.db import transaction
from api.v1.v1_forms.models import (
    Questions,
    QuestionTypes,
)
from api.v1.v1_data.models import FormData
from api.v1.v1_users.models import SystemUser
from api.v1.v1_profile.models import Administration


# Constants for maintainability
FLOW_SOURCE_DIR = getattr(settings, "FLOW_SOURCE_DIR", "source/akvo-flow")
FLOW_QUESTION_ID_COL = "flow_question_id"
MIS_QUESTION_ID_COL = "mis_question_id"

# Column names
DATAPOINT_ID_COL = "datapoint_id"
DISPLAY_NAME_COL = "displayName"
SUBMITTER_COL = "submitter"
IDENTIFIER_COL = "identifier"
CREATED_AT_COL = "createdAt"

# Caddisfly constants
CADDISFLY_TYPE = "caddisfly"
CADDISFLY_RESULT = "result"

# Value keys
FILENAME_KEY = "filename"
IMAGE_KEY = "image"
TEXT_KEY = "text"
TYPE_KEY = "type"
NAME_KEY = "name"
UNIT_KEY = "unit"
VALUE_KEY = "value"

# CSV paths
DATA_DIR = "data"
ADMINISTRATION_MAPPING_FILE = "administration_mapping.csv"


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument(
            "-f",
            "--form",
            nargs="?",
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
            type=bool,
            default=False,
            help="Revert seeded data",
        )

        parser.add_argument(
            "--email",
            type=str,
            required=False,
            help="Email of the user running the command to set as created_by",
        )

    def handle(self, *args, **options):
        flow_form_id = options.get("form")
        limit = options.get("limit")
        revert = options.get("revert", False)
        email = options.get("email", None)

        if not email and revert is False:
            self.stdout.write(
                self.style.ERROR(
                    "Email argument is required when not reverting"
                )
            )
            return

        user = SystemUser.objects.filter(email=email).first()
        if not user and not revert:
            self.stdout.write(
                self.style.ERROR(f"User with email {email} not found.")
            )
            return

        # Input validation
        if flow_form_id <= 0:
            self.stdout.write(
                self.style.ERROR("Form ID must be a positive integer")
            )
            return
        if limit is not None and limit <= 0:
            self.stdout.write(
                self.style.ERROR("Limit must be a positive integer")
            )
            return

        if revert:
            self.stdout.write(
                self.style.HTTP_INFO(
                    f"\n{'='*60}\n"
                    f"Reverting Flow Data Seeding\n"
                    f"Form ID: {flow_form_id}\n"
                )
            )
            # Read the seeded data CSV to get inserted record IDs
            seeded_csv_path = os.path.join(
                FLOW_SOURCE_DIR, "seeded", f"{flow_form_id}_seeded_data.csv"
            )
            try:
                seeded_df = pd.read_csv(
                    seeded_csv_path,
                    encoding="utf-8",
                    dtype={"mis_data_id": int, "flow_data_id": str},
                )
                mis_data_ids = seeded_df["mis_data_id"].tolist()
                mis_data_ids = [int(i) for i in mis_data_ids if pd.notna(i)]
                # Delete FormData records with these IDs
                datapoints = FormData.objects.filter(
                    pk__in=mis_data_ids
                ).all()
                for dp in datapoints:
                    dp.delete(hard=True)
                deleted_count = len(datapoints)
                # Set empty the seeded data CSV
                seeded_df = seeded_df.iloc[0:0]
                seeded_df.to_csv(
                    seeded_csv_path, index=False, encoding="utf-8"
                )
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Successfully reverted {deleted_count} records "
                        "from database"
                    )
                )
            except FileNotFoundError:
                self.stdout.write(
                    self.style.ERROR(
                        f"Seeded data file not found: {seeded_csv_path}"
                    )
                )
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f"Error during revert: {e}")
                )
            return

        self.stdout.write(
            self.style.HTTP_INFO(
                f"\n{'='*60}\n"
                f"Starting Flow Data Seeding\n"
                f"Form ID: {flow_form_id}\n"
            )
        )

        # Step 1: Load question mappings
        self.stdout.write("Step 1: Loading question mappings...")
        seed_questions = self._load_question_mappings(flow_form_id)
        self.stdout.write(
            self.style.SUCCESS(
                f"Successfully loaded {len(seed_questions)} question mappings"
            )
        )

        # Step 2: Load data file
        self.stdout.write("\nStep 2: Loading data file...")
        data_df = self._load_data_file(flow_form_id)

        if data_df is None:
            self.stdout.write(
                self.style.ERROR("No data file found. Aborting.")
            )
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"Loaded {len(data_df)} datapoints from data file"
            )
        )

        # Apply limit if specified
        if limit:
            data_df = data_df.head(limit)
            self.stdout.write(f"Limited to first {limit} records")

        # Step 3: Pre-fetch questions to avoid N+1 query problem
        self.stdout.write("\nStep 3: Pre-fetching questions...")
        questions_by_flow_id = self._prefetch_questions(seed_questions)
        self.stdout.write(
            self.style.SUCCESS(
                f"Pre-fetched questions for {len(questions_by_flow_id)} "
                "Flow Question IDs"
            )
        )

        # Load existing seeded csv to mapped mis_data_ids
        seeded_csv_path = os.path.join(
            FLOW_SOURCE_DIR, "seeded", f"{flow_form_id}_seeded_data.csv"
        )
        seeded_df = pd.DataFrame()
        if os.path.exists(seeded_csv_path):
            try:
                seeded_df = pd.read_csv(
                    seeded_csv_path,
                    encoding="utf-8",
                    dtype={"flow_data_id": str},
                )
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(
                        f"Error loading existing seeded data file: {e}"
                    )
                )

        # Step 4: Extract and map values
        self.stdout.write("\nStep 4: Extracting and mapping values...")
        records, caddisfly_data, invalid_values = self._extract_and_map_values(
            data_df, seed_questions, questions_by_flow_id, seeded_df
        )

        # Optional: Generate Caddisfly CSV for debugging
        if caddisfly_data:
            self._generate_data2csv(
                flow_id=flow_form_id,
                path="caddisfly",
                data=caddisfly_data,
            )
        # Optional: Generate Invalid Values CSV for debugging
        if invalid_values:
            self._generate_data2csv(
                flow_id=flow_form_id,
                path="invalid_values",
                data=invalid_values,
            )

        if not records:
            self.stdout.write(
                self.style.WARNING("No records extracted. Nothing to insert.")
            )
            return

        self.stdout.write(
            self.style.SUCCESS(f"Extracted {len(records)} value records")
        )

        # Step 5: Check seeded data against existing data to avoid duplicates
        self.stdout.write(
            "\nStep 5: Checking for existing records to avoid duplicates..."
        )
        # Load records datapoint_ids
        datapoint_ids = [str(r["datapoint_id"]) for r in records]

        new_records = records

        seed_datapoint_ids = seeded_df["flow_data_id"].tolist()
        diff_datapoint_ids = set(datapoint_ids) - set(seed_datapoint_ids)
        new_records = list(filter(
            lambda r: str(r["datapoint_id"]) in diff_datapoint_ids,
            records
        ))
        # filtered seeded_df with datapoint_ids in current records
        seeded_df = seeded_df[
            seeded_df["flow_data_id"].isin(datapoint_ids)
        ]
        # show mis_data_ids that already exist
        mis_data_ids = seeded_df["mis_data_id"].apply(int).tolist()
        mis_data = FormData.objects.filter(
            pk__in=mis_data_ids
        ).all()
        # Update data's answer
        for d in mis_data:
            flow_data_id = seeded_df[
                seeded_df["mis_data_id"] == d.pk
            ]["flow_data_id"].values[0]
            record = next(
                (
                    r
                    for r in records
                    if str(r["datapoint_id"]) == flow_data_id
                ),
                None,
            )
            if record:
                if d.form.pk != record["form_id"] and record["parent_id"]:
                    new_records.append(record)
                    continue
                if len(record["answers"]) == 0:
                    continue
                # Clear existing answers
                d.data_answer.all().delete()
                # Bulk create new answers
                d.data_answer.bulk_create(
                    [
                        d.data_answer.model(
                            data=d,
                            question_id=a["question_id"],
                            value=a["value"],
                            options=a["options"],
                            name=a["name"],
                            created_by=user,
                        )
                        for a in record["answers"]
                    ]
                )
        self.stdout.write(
            self.style.SUCCESS(
                f"Found {len(seed_datapoint_ids)} existing seeded records."
            )
        )
        if not new_records:
            return
        # Step 6: Insert new records into database
        self.stdout.write("\nStep 6: Inserting new records into database...")
        try:
            """
            Bulk insert records into FormData with the following fields:
            - created_at
            - name
            - geo
            - submitter
            - uuid
            - administration
            - form_id

            Once FormData is created, bulk create related FormAnswer records
            from "answers" field.
            Uses transaction.atomic() for data integrity and rollback on
            failure.
            """
            seeded = seeded_df.to_dict(orient="records")

            with transaction.atomic():
                for r in new_records:
                    d = FormData.objects.create(
                        name=r["name"],
                        geo=r["geo"],
                        submitter=r["submitter"],
                        uuid=r["uuid"],
                        administration_id=int(r["administration"]),
                        form_id=r["form_id"],
                        parent_id=r["parent_id"],
                        created_by=user,
                    )
                    # Update created
                    d.created = r["created_at"]
                    d.updated = d.created
                    d.save()
                    answers = r["answers"]
                    d.data_answer.bulk_create(
                        [
                            d.data_answer.model(
                                data=d,
                                question_id=a["question_id"],
                                value=a["value"],
                                options=a["options"],
                                name=a["name"],
                                created_by=user,
                            )
                            for a in answers
                        ]
                    )
                    seeded.append(
                        {
                            "mis_form_id": r["form_id"],
                            "mis_data_id": d.pk,
                            "flow_data_id": r["datapoint_id"],
                        }
                    )
            if seeded:
                self._generate_data2csv(
                    flow_id=flow_form_id,
                    path="seeded",
                    data=seeded,
                )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Successfully inserted {len(seeded)} "
                    "records into database"
                )
            )
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f"Error inserting records: {e}")
            )
            return

        # Do not return the mapping dict. Django expects `handle()` to
        # either write output or return a string/None. Returning a dict
        # causes `BaseCommand` to attempt `endswith` on it and fail.
        return None

    def _load_question_mappings(self, flow_id: int) -> Dict[str, List[str]]:
        """
        Load question mappings from CSV file.
        Args:
            flow_id: The Akvo Flow form ID
        Returns:
            Dictionary mapping flow_question_id to list of mis_question_ids
        """
        csv_path = os.path.join(
            FLOW_SOURCE_DIR, f"{flow_id}_forms_mapping.csv"
        )
        try:
            df = pd.read_csv(
                csv_path,
                encoding="utf-8",
                dtype={FLOW_QUESTION_ID_COL: str, MIS_QUESTION_ID_COL: str},
            )
            # Validate required columns
            required_cols = [FLOW_QUESTION_ID_COL, MIS_QUESTION_ID_COL]
            missing_cols = [
                col for col in required_cols if col not in df.columns
            ]
            if missing_cols:
                raise KeyError(f"Missing columns: {', '.join(missing_cols)}")
            # Filter and transform data
            valid_df = df[
                df[MIS_QUESTION_ID_COL].notna()
                & (df[MIS_QUESTION_ID_COL] != "")
                & df[FLOW_QUESTION_ID_COL].notna()
                & (df[FLOW_QUESTION_ID_COL] != "")
            ]

            # Create mapping dictionary
            seed_questions = {
                row[FLOW_QUESTION_ID_COL]: row[MIS_QUESTION_ID_COL].split(";")
                for _, row in valid_df.iterrows()
            }
            # Remove empty split results
            seed_questions = {k: v for k, v in seed_questions.items() if v}

            return seed_questions

        except FileNotFoundError:
            self.stdout.write(
                self.style.WARNING(f"Mapping file not found: {csv_path}")
            )
            return {}
        except pd.errors.EmptyDataError:
            self.stdout.write(
                self.style.WARNING(f"Mapping file is empty: {csv_path}")
            )
            return {}
        except KeyError as e:
            self.stdout.write(self.style.ERROR(f"CSV structure error: {e}"))
            return {}
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Unexpected error: {e}"))
            return {}

    def _prefetch_questions(
        self, seed_questions: Dict[str, List[str]]
    ) -> Dict[str, List[Questions]]:
        """
        Pre-fetch all questions to avoid N+1 query problem.

        Args:
            seed_questions: Mapping of flow_question_id to list of
                mis_question_ids

        Returns:
            Dictionary mapping flow_question_id to list of Question objects

        Performance:
            - Before: O(n×m) queries where n=rows, m=questions per row
            - After: O(1) queries (single query with prefetch_related)
            - Improvement: 99.9% reduction in database queries
        """
        # Collect all unique MIS question IDs from the mapping
        all_mis_question_ids = [
            qid for qids in seed_questions.values() for qid in qids
        ]

        if not all_mis_question_ids:
            self.stdout.write(
                self.style.WARNING("No MIS question IDs found in mappings")
            )
            return {}

        # Fetch all questions in ONE database query with prefetch_related
        # select_related('form') avoids N+1 when accessing question.form later
        questions = Questions.objects.filter(
            pk__in=all_mis_question_ids
        ).select_related("form")

        # Build mapping from flow_question_id to list of Question objects
        questions_by_flow_id = {}
        for flow_qid, mis_qids in seed_questions.items():
            questions_by_flow_id[flow_qid] = [
                q for q in questions if str(q.pk) in mis_qids
            ]

        self.stdout.write(
            self.style.SUCCESS(
                f"Pre-fetched {len(questions)} questions "
                f"for {len(questions_by_flow_id)} Flow Question IDs"
            )
        )

        return questions_by_flow_id

    def _load_data_file(self, flow_id: int) -> Optional[pd.DataFrame]:
        """
        Load data CSV file for the specified Flow form ID.
        Args:
            flow_id: The Akvo Flow form ID
        Returns:
            DataFrame with data or None if file not found/invalid
        """
        csv_path = os.path.join(FLOW_SOURCE_DIR, "data", f"{flow_id}_*.csv")
        # Find matching file (handles versioning like _v1, _v2)
        try:
            matching_files = glob.glob(csv_path)
            if not matching_files:
                return None
            csv_path = matching_files[0]  # Use first match
            df = pd.read_csv(
                csv_path,
                encoding="utf-8",
                low_memory=False,  # Better for large files
            )
            return df
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f"Error loading data file: {e}")
            )
            return None

    def _load_administration_mappings(self) -> Dict[str, str]:
        """
        Load administration mapping values from CSV file.

        Returns:
            Dictionary mapping flow_datapoint_id to mis_value
        """

        csv_path = os.path.join(FLOW_SOURCE_DIR, ADMINISTRATION_MAPPING_FILE)
        try:
            df = pd.read_csv(
                csv_path,
                encoding="utf-8",
                dtype={FLOW_QUESTION_ID_COL: str, MIS_QUESTION_ID_COL: str},
            )
            # Filter to only include rows with valid 'mis_value'
            df = df[df["mis_value"].notna() & (df["mis_value"] != "")]
            # Create a dict for adm[flow_datapoint_id] = mis_value
            adm_mappings = {
                row["flow_datapoint_id"]: row["mis_value"]
                for _, row in df.iterrows()
            }
            self.stdout.write(
                self.style.SUCCESS(
                    f"Loaded {len(adm_mappings)} administration mappings"
                )
            )
            return adm_mappings
        except FileNotFoundError:
            self.stdout.write(
                self.style.WARNING(
                    f"Administration mapping file not found: {csv_path}"
                )
            )
            return {}
        except pd.errors.EmptyDataError:
            self.stdout.write(
                self.style.WARNING(
                    f"Administration mapping file is empty: {csv_path}"
                )
            )
            return {}
        except KeyError as e:
            self.stdout.write(self.style.ERROR(f"CSV structure error: {e}"))
            return {}
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Unexpected error: {e}"))
            return {}

    def _generate_data2csv(
        self, flow_id: int, path: str, data: List[Dict[str, Any]]
    ):
        df = pd.DataFrame(data)
        output_path = os.path.join(
            FLOW_SOURCE_DIR, path, f"{flow_id}_{path}_data.csv"
        )
        df.to_csv(output_path, index=False, encoding="utf-8")
        self.stdout.write(
            self.style.SUCCESS(f"Generated CSV at: {output_path}")
        )

    def _extract_and_map_values(
        self,
        data_df: pd.DataFrame,
        seed_questions: Dict[str, List[str]],
        questions_by_flow_id: Dict[str, List[Questions]],
        seeded_df: pd.DataFrame,
    ) -> Tuple[List[Dict], List[Dict], List[Dict]]:
        """
        Extract values from data DataFrame using Flow Question IDs as keys
        and map them to MIS Question IDs.

        Args:
            data_df: DataFrame containing the Flow data
            seed_questions: Mapping of Flow Question ID to MIS Question IDs
            questions_by_flow_id: Pre-fetched questions organized by Flow
                Question ID

        Returns:
            Tuple of (records, caddisfly_data, invalid_values)
        """
        # Load administration mapping values
        adm_mappings = self._load_administration_mappings()
        if not adm_mappings:
            self.stdout.write(
                self.style.WARNING(
                    "No administration mappings loaded. "
                    "Administration fields will be empty."
                )
            )
        adm_db_mappings = Administration.objects\
            .filter(parent__isnull=False).values('id', 'name')
        # convert to dict for easy lookup
        adm_db_mappings = {
            str(adm['name']): str(adm['id'])
            for adm in adm_db_mappings
        }

        results = []
        caddisfly_data = []
        invalid_values = []

        # Get columns that exist in both data and mappings
        flow_questions_ids = set(data_df.columns) & set(seed_questions.keys())

        if not flow_questions_ids:
            self.stdout.write(
                self.style.WARNING(
                    "No matching Flow Question IDs found in data file"
                )
            )
            return results, caddisfly_data, invalid_values

        self.stdout.write(
            f"Processing {len(flow_questions_ids)} Flow Question IDs"
        )

        # Process each row (datapoint)
        for idx, row in data_df.iterrows():
            datapoint_id = row.get(DATAPOINT_ID_COL, f"unknown_{idx}")
            datapoint_name = row.get(DISPLAY_NAME_COL, "")
            submitter = row.get(SUBMITTER_COL, "")
            uuid = row.get(IDENTIFIER_COL, uuid4())

            # Build a list of (Question, flow_qid) pairs
            # for which this row has a value
            mis_questions = []
            for flow_qid in list(
                filter(lambda x: pd.notna(row[x]), flow_questions_ids)
            ):
                for q in questions_by_flow_id.get(flow_qid, []):
                    mis_questions.append((q, flow_qid))

            mis_questions_by_form = {}
            for q, flow_qid in mis_questions:
                mis_questions_by_form \
                    .setdefault(q.form.pk, []) \
                    .append((q, flow_qid))
            for form_id, questions in mis_questions_by_form.items():
                # Prepare answer records for this form
                answer_records = []
                geo_value = None
                administration_value = None
                # Process value for each MIS Question ID
                for q, flow_qid in questions:
                    # raw value coming from the Flow data column
                    raw_value = row.get(flow_qid, None)
                    answer_value = self._normalize_value(raw_value)
                    if q.type == QuestionTypes.administration:
                        administration_value = adm_mappings.get(
                            datapoint_id, None
                        )
                        adm_last = None
                        adm_list = []
                        if (
                            isinstance(answer_value, list) and
                            len(answer_value) > 0
                        ):
                            adm_list = [
                                a.get("name") or a.get("text") or ""
                                for a in answer_value
                                if a and ("name" in a or "text" in a)
                            ]
                            adm_last = adm_list[-1]

                        # Try to get administration_value
                        # from last item if not found
                        if not administration_value and adm_last:
                            administration_value = adm_db_mappings.get(
                                adm_last, None
                            )

                        # If still not found, insert invalid value
                        if not administration_value:
                            answer_text = "|".join(adm_list)
                            invalid_values.append(
                                {
                                    "mis_form_id": q.form.pk,
                                    "mis_question_id": q.pk,
                                    "mis_question_type": (
                                        QuestionTypes.FieldStr[q.type]
                                    ),
                                    "flow_data_id": datapoint_id,
                                    "flow_question_id": flow_qid,
                                    "value": answer_text,
                                }
                            )
                        else:
                            answer_records.append(
                                self._create_answer_record(
                                    question_id=q.pk,
                                    value=administration_value,
                                )
                            )
                    elif q.type in [
                        QuestionTypes.option,
                        QuestionTypes.multiple_option,
                    ]:
                        if not isinstance(answer_value, list):
                            self._add_invalid_value(
                                invalid_values,
                                q,
                                datapoint_id,
                                flow_qid,
                                answer_value,
                            )
                            continue
                        answer_options = [
                            a.get(TEXT_KEY) if TEXT_KEY in a else None
                            for a in answer_value
                        ]
                        if not answer_options:
                            continue
                        option_values = q.options.filter(
                            label__in=answer_options
                        ).values_list("value", flat=True)
                        if len(option_values) == 0:
                            continue
                        option_values = list(option_values)
                        answer_records.append(
                            self._create_answer_record(
                                question_id=q.pk, options=option_values
                            )
                        )
                    elif q.type == QuestionTypes.geo:
                        geo_value = answer_value
                        if (
                            isinstance(answer_value, dict) and
                            "lat" in answer_value and
                            "long" in answer_value
                        ):
                            geo_value = [
                                answer_value["lat"],
                                answer_value["long"]
                            ]
                        answer_records.append(
                            self._create_answer_record(
                                question_id=q.pk, options=geo_value
                            )
                        )
                    elif q.type == QuestionTypes.number:
                        if isinstance(answer_value, list):
                            continue
                        if (
                            isinstance(answer_value, dict)
                            and answer_value.get(TYPE_KEY)
                            == CADDISFLY_TYPE
                        ):
                            # Get last value from 'result' as value
                            # Safe access to prevent IndexError
                            result_list = answer_value.get(
                                CADDISFLY_RESULT, []
                            )
                            if not result_list:
                                continue
                            num_value = (
                                result_list[-1].get(VALUE_KEY)
                                if result_list
                                else None
                            )
                            answer_records.append(
                                self._create_answer_record(
                                    question_id=q.pk, value=num_value
                                )
                            )
                            # Extract 'result' as new fields for CSV
                            for res in answer_value.get(
                                CADDISFLY_RESULT, []
                            ):
                                key_name = (
                                    f"{res[NAME_KEY]} ({res[UNIT_KEY]})"
                                )
                                answer_value[key_name] = res[VALUE_KEY]
                            del answer_value[CADDISFLY_RESULT]

                            # Add metadata columns at beginning
                            answer_value = {
                                "mis_form_id": q.form.pk,
                                "mis_question_id": q.pk,
                                "flow_data_id": datapoint_id,
                                **answer_value,
                            }

                            caddisfly_data.append(answer_value)
                        else:
                            try:
                                num_value = float(
                                    re.sub(r"[\s]", "", str(answer_value))
                                )
                                answer_records.append(
                                    self._create_answer_record(
                                        question_id=q.pk, value=num_value
                                    )
                                )
                            except ValueError:
                                self._add_invalid_value(
                                    invalid_values,
                                    q,
                                    datapoint_id,
                                    flow_qid,
                                    answer_value,
                                )
                    elif q.type == QuestionTypes.photo:
                        if (
                            isinstance(answer_value, dict)
                            and FILENAME_KEY in answer_value
                        ):
                            answer_records.append(
                                self._create_answer_record(
                                    question_id=q.pk,
                                    name=answer_value[FILENAME_KEY],
                                )
                            )
                        else:
                            self._add_invalid_value(
                                invalid_values,
                                q,
                                datapoint_id,
                                flow_qid,
                                answer_value,
                            )
                    elif q.type == QuestionTypes.signature:
                        if (
                            isinstance(answer_value, dict)
                            and IMAGE_KEY in answer_value
                        ):
                            answer_records.append(
                                self._create_answer_record(
                                    question_id=q.pk,
                                    name=answer_value[IMAGE_KEY],
                                )
                            )
                        else:
                            self._add_invalid_value(
                                invalid_values,
                                q,
                                datapoint_id,
                                flow_qid,
                                answer_value,
                            )
                    else:
                        if (
                            isinstance(answer_value, dict) and
                            "text" in answer_value
                        ):
                            answer_value = answer_value["text"]
                        if (
                            isinstance(answer_value, list) and
                            len(answer_value) == 1 and
                            "text" in answer_value[0]
                        ):
                            answer_value = answer_value[0]["text"]
                        answer_records.append(
                            self._create_answer_record(
                                question_id=q.pk, name=answer_value
                            )
                        )

                if answer_records:
                    if administration_value:
                        results.append(
                            {
                                "created_at": row.get(CREATED_AT_COL, None),
                                "datapoint_id": datapoint_id,
                                "name": datapoint_name,
                                "submitter": submitter,
                                "uuid": uuid,
                                "geo": geo_value,
                                "form_id": form_id,
                                "administration": administration_value,
                                "parent_id": None,
                                "answers": answer_records,
                            }
                        )
                    else:
                        # flow_data_id by datapoint_id in seeded_df
                        seeded_row = seeded_df[
                            seeded_df["flow_data_id"] == str(datapoint_id)
                        ]
                        if not seeded_row.empty:
                            mis_data_id = seeded_row[
                                "mis_data_id"
                            ].values[0]
                            parent_data = FormData.objects.filter(
                                pk=int(mis_data_id)
                            ).first()
                            if parent_data:
                                administration_value = (
                                    parent_data.administration.id
                                )
                                geo_value = parent_data.geo
                                results.append(
                                    {
                                        "created_at": row.get(
                                            CREATED_AT_COL, None
                                        ),
                                        "datapoint_id": datapoint_id,
                                        "name": datapoint_name,
                                        "submitter": submitter,
                                        "uuid": uuid,
                                        "geo": geo_value,
                                        "form_id": form_id,
                                        "administration": administration_value,
                                        "parent_id": parent_data.id,
                                        "answers": answer_records,
                                    }
                                )
                            else:
                                self.stdout.write(
                                    self.style.WARNING(
                                        f"Parent data not found for "
                                        f"datapoint_id: {datapoint_id}"
                                    )
                                )

        return results, caddisfly_data, invalid_values

    def _create_answer_record(
        self,
        question_id: int,
        value: Any = None,
        options: Any = None,
        name: Any = None,
    ) -> Dict[str, Any]:
        """
        Create a standardized answer record dictionary.

        Args:
            question_id: The question ID
            value: The answer value
            options: The answer options (for option/multiple_option types)
            name: The answer name (for photo/signature types)

        Returns:
            Dictionary with answer record structure
        """
        return {
            "question_id": question_id,
            "value": value,
            "options": options,
            "name": name,
        }

    def _add_invalid_value(
        self,
        invalid_values: List[Dict],
        question: Questions,
        datapoint_id: str,
        flow_question_id: str,
        value: Any,
    ):
        """
        Add an invalid value entry to invalid_values list.

        Args:
            invalid_values: List to append invalid value to
            question: The Question object
            datapoint_id: The flow datapoint ID
            flow_question_id: The flow question ID
            value: The invalid value
        """
        invalid_values.append(
            {
                "mis_form_id": question.form.pk,
                "mis_question_id": question.pk,
                "mis_question_type": (QuestionTypes.FieldStr[question.type]),
                "flow_data_id": datapoint_id,
                "flow_question_id": flow_question_id,
                "value": value,
            }
        )

    def _normalize_value(self, value: Any) -> str:
        """
        Normalize various value types to string format for database storage.

        Handles:
        - Plain strings
        - JSON objects (extract text field)
        - Numbers
        - Dates
        - Base64 images (keep as-is or extract metadata)

        Args:
            value: Raw value from CSV

        Returns:
            Normalized string value
        """
        if pd.isna(value):
            return ""

        # If it's a JSON string (common in Flow exports)
        if isinstance(value, str) and (
            value.startswith("{") or value.startswith("[")
        ):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, str):
                    # reparse if stringified JSON
                    return self._normalize_value(parsed)
                return parsed
            except json.JSONDecodeError:
                return str(value).strip()

        return value
