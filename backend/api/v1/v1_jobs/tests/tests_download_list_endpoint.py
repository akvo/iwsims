from io import StringIO
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from rest_framework import status

from api.v1.v1_forms.models import Forms
from api.v1.v1_jobs.constants import JobStatus, JobTypes
from api.v1.v1_jobs.models import Jobs
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


@override_settings(USE_TZ=False, TEST_ENV=True)
class DownloadListTestCase(TestCase, ProfileTestHelperMixin):
    def call_command(self, *args, **kwargs):
        out = StringIO()
        call_command(
            "fake_complete_data_seeder",
            "--test=true",
            *args,
            stdout=out,
            stderr=StringIO(),
            **kwargs,
        )
        return out.getvalue()

    def setUp(self):
        call_command("administration_seeder", "--test", 1)
        call_command("default_roles_seeder", "--test", 1)
        call_command("form_seeder", "--test", 1)
        self.call_command(repeat=2, approved=True)

        self.form = Forms.objects.get(pk=1)

        datapoints = self.form.form_form_data.filter(is_pending=False).all()
        self.selection_ids = [datapoint.id for datapoint in datapoints][:5]
        self.submitter = datapoints.first().created_by
        self.submitter.set_password("test")
        self.submitter.save()

        self.token = self.get_auth_token(
            email=self.submitter.email, password="test"
        )

        # Seed a job for download
        job_download = Jobs.objects.create(
            user=self.submitter,
            type=JobTypes.download,
            status=JobStatus.done,
            info={
                "form_id": self.form.id,
                "user_id": self.submitter.id,
                "file_name": f"download-{self.form.name}.csv",
            },
        )
        job_download.save()

        job_report = Jobs.objects.create(
            user=self.submitter,
            type=JobTypes.download_datapoint_report,
            status=JobStatus.done,
            info={
                "form_id": self.form.id,
                "user_id": self.submitter.id,
                "file_name": f"datapoint-report-{self.form.name}.csv",
                "selection_ids": self.selection_ids,
            },
        )
        job_report.save()

        self.url = "/api/v1/download/list"

    def test_get_download_list(self):
        response = self.client.get(
            self.url, HTTP_AUTHORIZATION=f"Bearer {self.token}"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(len(data), 2)
        self.assertEqual(
            list(data[0].keys()),
            [
                "id",
                "task_id",
                "type",
                "status",
                "form",
                "category",
                "administration",
                "date",
                "result",
                "attributes",
                "download_type",
                "date_from",
                "date_to",
            ],
        )

    def test_get_download_list_by_type(self):
        response = self.client.get(
            f"{self.url}?type=download",
            HTTP_AUTHORIZATION=f"Bearer {self.token}"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["type"], "download")
