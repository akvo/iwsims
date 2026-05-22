from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from rest_framework import status

from api.v1.v1_forms.models import Forms
from api.v1.v1_jobs.constants import JobStatus, JobTypes
from api.v1.v1_jobs.models import Jobs
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


@override_settings(USE_TZ=False, TEST_ENV=True)
class DownloadRetryAPITestCase(TestCase, ProfileTestHelperMixin):
    def setUp(self):
        call_command("administration_seeder", "--test", 1)
        call_command("default_roles_seeder", "--test", 1)
        call_command("form_seeder", "--test", 1)

        self.form = Forms.objects.get(pk=1)
        self.administration = Administration.objects.filter(
            level__level=1
        ).order_by("?").first()
        self.user = self.create_user(
            email="admin@akvo.org",
            password="Test105*",
            role_level=self.IS_ADMIN,
            administration=self.administration,
            form=self.form,
        )
        self.token = self.get_auth_token(
            email=self.user.email,
            password="Test105*",
        )
        self.other_user = self.create_user(
            email="other@akvo.org",
            password="Test105*",
            role_level=self.IS_ADMIN,
            administration=self.administration,
            form=self.form,
        )
        self.job_info = {
            "form_id": self.form.id,
            "administration": None,
            "download_type": "all",
            "use_label": False,
            "child_form_ids": [],
            "selection_ids": [],
            "date_from": None,
            "date_to": None,
        }

    def _make_job(self, job_status, user=None, result="download-test-240101-abc.xlsx"):
        return Jobs.objects.create(
            type=JobTypes.download,
            user=user or self.user,
            status=job_status,
            result=result,
            task_id="old-task-id",
            info=self.job_info,
        )

    def test_retry_failed_job_returns_200(self):
        # TC-3: retry a failed job → 200 with new task_id, job reset to on_progress
        job = self._make_job(JobStatus.failed)
        response = self.client.post(
            f"/api/v1/download/retry/{job.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("task_id", response.data)
        self.assertIn("file_url", response.data)
        job.refresh_from_db()
        self.assertEqual(job.status, JobStatus.on_progress)
        self.assertEqual(job.attempt, 0)
        self.assertNotEqual(job.task_id, "old-task-id")

    def test_retry_pending_job_returns_200(self):
        job = self._make_job(JobStatus.pending)
        response = self.client.post(
            f"/api/v1/download/retry/{job.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        job.refresh_from_db()
        self.assertEqual(job.status, JobStatus.on_progress)

    def test_retry_done_job_returns_400(self):
        # TC-4: retrying a completed job must be rejected
        job = self._make_job(JobStatus.done)
        response = self.client.post(
            f"/api/v1/download/retry/{job.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("message", response.data)

    def test_retry_other_users_job_returns_404(self):
        # TC-5: a user cannot retry another user's job
        job = self._make_job(JobStatus.failed, user=self.other_user)
        response = self.client.post(
            f"/api/v1/download/retry/{job.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_retry_unauthenticated_returns_401(self):
        job = self._make_job(JobStatus.failed)
        response = self.client.post(f"/api/v1/download/retry/{job.id}")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_retry_generates_new_filename(self):
        old_result = "download-test_form-240101-old-uuid.xlsx"
        job = self._make_job(JobStatus.failed, result=old_result)
        response = self.client.post(
            f"/api/v1/download/retry/{job.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        job.refresh_from_db()
        self.assertNotEqual(job.result, old_result)
        self.assertTrue(job.result.startswith("download-"))
        self.assertTrue(job.result.endswith(".xlsx"))
