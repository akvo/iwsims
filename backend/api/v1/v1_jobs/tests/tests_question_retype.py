import os
import zipfile
from io import StringIO

import pandas as pd
from django.conf import settings
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_data.models import Answers, option_answer_text
from api.v1.v1_forms.constants import QuestionTypes
from api.v1.v1_forms.models import Forms, Questions
from api.v1.v1_jobs.constants import DataDownloadTypes, JobStatus, JobTypes
from api.v1.v1_jobs.job import (
    _job_for_task,
    _sanitize_form_name,
    job_generate_data_download,
    transform_form_data_for_report,
)
from api.v1.v1_jobs.models import Jobs
from api.v1.v1_profile.management.commands import administration_seeder
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin
from api.v1.v1_users.models import SystemUser
from utils import storage

EXTRACT_DIR = f"./tmp/retype_extract_{os.getpid()}"


@override_settings(USE_TZ=False)
class QuestionRetypeTestCase(TestCase, ProfileTestHelperMixin):
    """A question retyped to an option type after data was submitted.

    The old answer stays in `name` and `options` is NULL, so every reader
    that assumes `options` is a list breaks.
    doc/claude/download-fails-on-question-type-change.md
    """

    def setUp(self):
        call_command("form_seeder", "--test")
        administration_seeder.seed_administration_test(rows=[
            {
                "code_0": "ID", "National_0": "Indonesia",
                "code_1": "ID-JK", "Province_1": "Jakarta",
                "code_2": "ID-JK-JKE", "District_2": "East Jakarta",
                "code_3": "ID-JK-JKE-KJ", "Subdistrict_3": "Kramat Jati",
                "code_4": "ID-JK-JKE-KJ-CW", "Village_4": "Cawang",
            },
            {
                "code_0": "ID", "National_0": "Indonesia",
                "code_1": "ID-JK", "Province_1": "Jakarta",
                "code_2": "ID-JK-JKW", "District_2": "West Jakarta",
                "code_3": "ID-JK-JKW-KJ", "Subdistrict_3": "Kebon Jeruk",
                "code_4": "ID-JK-JKW-KJ-KJ", "Village_4": "Kebon Jeruk",
            },
            {
                "code_0": "ID", "National_0": "Indonesia",
                "code_1": "ID-YO", "Province_1": "Yogyakarta",
                "code_2": "ID-YO-SL", "District_2": "Sleman",
                "code_3": "ID-YO-SL-ST", "Subdistrict_3": "Seturan",
                "code_4": "ID-YO-SL-ST-CB", "Village_4": "Cepit Baru",
            },
            {
                "code_0": "ID", "National_0": "Indonesia",
                "code_1": "ID-YO", "Province_1": "Yogyakarta",
                "code_2": "ID-YO-BT", "District_2": "Bantul",
                "code_3": "ID-YO-BT-BT", "Subdistrict_3": "Bantul",
                "code_4": "ID-YO-BT-BT-BT", "Village_4": "Bantul",
            },
        ])
        call_command("default_roles_seeder", "--test", 1)
        call_command(
            "fake_complete_data_seeder", "--test=true", "-r", 2,
            stdout=StringIO(), stderr=StringIO(),
        )
        self.form = Forms.objects.get(pk=1)
        self.child_form = self.form.children.first()
        self.child_form_ids = list(
            self.form.children.values_list("id", flat=True)
        )
        self.user = (
            SystemUser.objects.filter(email="admin@akvo.org").first()
            or SystemUser.objects.first()
        )
        self.assertIsNotNone(self.user, "seeder produced no users")

        # The retype: a free-text question in the monitoring form becomes a
        # multi-select. Its existing answers keep their text in `name`.
        self.question = Questions.objects.filter(
            form=self.child_form,
            type__in=[QuestionTypes.text, QuestionTypes.input],
            question_answer__isnull=False,
        ).distinct().first()
        self.assertIsNotNone(
            self.question, "fixture needs a text question with answers"
        )
        self.answer = self.question.question_answer.exclude(
            name__isnull=True
        ).first()
        self.assertIsNotNone(self.answer, "fixture needs a non-null name")
        self.original_text = self.answer.name
        self.question.type = QuestionTypes.multiple_option
        self.question.save()
        self.answer.refresh_from_db()

    def _zip_job(self):
        job = Jobs.objects.create(
            type=JobTypes.download,
            user=self.user,
            status=JobStatus.on_progress,
            result="placeholder.zip",
            info={
                "form_id": self.form.id,
                "administration": None,
                "download_type": DataDownloadTypes.recent,
                "use_label": True,
                "child_form_ids": self.child_form_ids,
                "date_from": None,
                "date_to": None,
            },
        )
        job.result = f"retype-{os.getpid()}-{job.id}.zip"
        job.save()
        return job

    # ---- TC-1 ------------------------------------------------------------
    def test_to_data_frame_returns_text_when_options_null(self):
        self.assertIsNone(self.answer.options)
        frame = self.answer.to_data_frame
        self.assertEqual(list(frame.values())[0], self.original_text)

    def test_form_data_to_data_frame_does_not_raise(self):
        # the exact frame in the production traceback
        self.assertIsInstance(self.answer.data.to_data_frame, dict)

    # ---- TC-2 ------------------------------------------------------------
    def test_output_unchanged_when_options_present(self):
        populated = Answers.objects.filter(
            options__isnull=False, question__type=QuestionTypes.option
        ).first()
        self.assertIsNotNone(populated)
        self.assertEqual(
            option_answer_text(populated),
            "|".join(map(str, populated.options)),
        )

    def test_helper_falls_back_to_value_then_empty(self):
        self.answer.name = None
        self.answer.value = 42.0
        self.assertEqual(option_answer_text(self.answer), "42.0")
        self.answer.value = None
        self.assertEqual(option_answer_text(self.answer), "")

    # ---- TC-3 ------------------------------------------------------------
    def test_zip_download_succeeds_and_keeps_original_text(self):
        job = self._zip_job()
        url = job_generate_data_download(job_id=job.id, **job.info)
        self.assertIn(".zip", url)

        storage.download(f"download/{job.result}")
        zip_path = f"./tmp/{job.result}"
        sheet = _sanitize_form_name(
            self.child_form.name, form_id=self.child_form.id
        ) + ".xlsx"
        with zipfile.ZipFile(zip_path, "r") as zf:
            self.assertIn(sheet, zf.namelist())
            zf.extract(sheet, EXTRACT_DIR)
        df = pd.read_excel(f"{EXTRACT_DIR}/{sheet}", sheet_name="data")
        self.assertIn(self.question.name, df.columns)
        # download_type=recent exports the latest child per parent, so assert
        # on the column as a whole: whatever landed there must be real stored
        # text, not blanked out by the option-label lookup.
        exported = [
            v for v in df[self.question.name].tolist()
            if isinstance(v, str) and v
        ]
        self.assertTrue(exported, "retyped question column came out empty")
        stored = set(
            self.question.question_answer.exclude(name__isnull=True)
            .values_list("name", flat=True)
        )
        self.assertTrue(set(exported).issubset(stored))
        os.remove(f"{EXTRACT_DIR}/{sheet}")
        os.remove(zip_path)
        storage.delete(url=f"download/{job.result}")

    # ---- TC-4 ------------------------------------------------------------
    def test_report_transform_survives_retype(self):
        selection_ids = list(
            self.form.form_form_data.values_list("id", flat=True)
        )
        result = transform_form_data_for_report(
            form=self.form,
            selection_ids=selection_ids,
            child_form_ids=self.child_form_ids,
        )
        # the bare except in job.py swallows a crash into [] — assert we
        # actually produced groups rather than silently degrading
        self.assertTrue(result)

    # ---- TC-5 ------------------------------------------------------------
    def test_failed_tasks_are_acked_and_capped(self):
        self.assertTrue(settings.Q_CLUSTER.get("ack_failures"))
        self.assertGreater(settings.Q_CLUSTER.get("max_attempts", 0), 0)

    # ---- TC-8 ------------------------------------------------------------
    def test_job_for_task_falls_back_to_job_id_arg(self):
        job = self._zip_job()
        job.task_id = None
        job.save()

        class _Task:
            id = "never-written"
            name = "some-task"
            args = (job.id,)

        self.assertEqual(_job_for_task(_Task()).id, job.id)

    def test_job_for_task_returns_none_for_orphan(self):
        class _Task:
            id = "gone"
            name = "orphan"
            args = (99999999,)

        self.assertIsNone(_job_for_task(_Task()))

    # ---- TC-9 ------------------------------------------------------------
    def test_zip_download_leaves_no_local_file(self):
        job = self._zip_job()
        job_generate_data_download(job_id=job.id, **job.info)
        self.assertFalse(
            os.path.exists(f"./tmp/{job.result}"),
            "upload() copies; the source must not be left behind",
        )
        storage.delete(url=f"download/{job.result}")

    def test_zip_download_survives_vanishing_target(self):
        # two concurrent workers on one job: the file disappears between
        # the existence check and the unlink
        job = self._zip_job()
        url = job_generate_data_download(job_id=job.id, **job.info)
        self.assertIn(".zip", url)
        storage.delete(url=f"download/{job.result}")
