from io import StringIO

from django.core.management import call_command, CommandError
from django.test import TestCase
from django.test.utils import override_settings
from api.v1.v1_forms.models import Forms
from api.v1.v1_jobs.models import Jobs
from api.v1.v1_jobs.job import (
    job_generate_data_download,
)
from api.v1.v1_users.models import SystemUser
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.functions import get_max_administration_level


@override_settings(USE_TZ=False)
class JobDownloadUnitTestCase(TestCase):
    def setUp(self):
        call_command("form_seeder", "--test")
        call_command("administration_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)
        user = {"email": "admin@akvo.org", "password": "Test105*"}
        user = self.client.post(
            '/api/v1/login',
            user,
            content_type='application/json'
        )

    def call_command(self, *args, **kwargs):
        out = StringIO()
        call_command(
            "job_download",
            *args,
            stdout=out,
            stderr=StringIO(),
            **kwargs,
        )
        return out.getvalue()

    def test_download_data_with_monitoring_forms(self):
        form = Forms.objects.get(pk=1)
        child_forms = form.children.all()[:1]
        admin = SystemUser.objects.first()
        result = self.call_command(
            form.id,
            admin.id,
            "-a",
            0,
            "-c",
            *child_forms.values_list("id", flat=True),
        )
        self.assertTrue(result)

        job = Jobs.objects.get(pk=result)
        self.assertEqual(
            job.info.get("child_form_ids"),
            list(child_forms.values_list("id", flat=True))
        )

        url = job_generate_data_download(job_id=job.id, **job.info)
        self.assertTrue("download-test_form" in url)

    def test_download_data_with_invalid_child_form(self):
        form = Forms.objects.get(pk=1)
        invalid_child_form_id = 9999
        admin = SystemUser.objects.first()
        with self.assertRaises(CommandError) as cm:
            self.call_command(
                form.id,
                admin.id,
                "-a",
                0,
                "-c",
                invalid_child_form_id,
            )
        self.assertIn("9999 is not a child of form id 1", str(cm.exception))

    def test_download_data_with_no_child_form(self):
        form = Forms.objects.get(pk=1)
        admin = SystemUser.objects.first()
        result = self.call_command(
            form.id,
            admin.id,
            "-a",
            0,
        )
        self.assertTrue(result)

        job = Jobs.objects.get(pk=result)
        self.assertEqual(
            job.info.get("child_form_ids"),
            []
        )

        url = job_generate_data_download(job_id=job.id, **job.info)
        self.assertTrue("download-test_form" in url)

    def test_download_data_with_administration(self):
        form = Forms.objects.get(pk=1)
        admin = SystemUser.objects.first()
        max_level = get_max_administration_level()
        administration = Administration.objects \
            .filter(level=max_level).order_by("?").first()
        result = self.call_command(
            form.id,
            admin.id,
            "-a",
            administration.id,
        )
        self.assertTrue(result)

        job = Jobs.objects.get(pk=result)
        self.assertEqual(
            job.info.get("administration"),
            administration.id
        )

        url = job_generate_data_download(job_id=job.id, **job.info)
        self.assertTrue("download-test_form" in url)

    def test_download_data_with_invalid_registration_form(self):
        form = Forms.objects.get(pk=10001)  # child form
        admin = SystemUser.objects.first()
        with self.assertRaises(CommandError) as cm:
            self.call_command(
                form.id,
                admin.id,
                "-a",
                0,
            )
        self.assertIn(
            "Form id 10001 is not a registration form", str(cm.exception)
        )
        # should not create job
        self.assertEqual(Jobs.objects.count(), 0)

    def test_download_data_with_invalid_form_id(self):
        with self.assertRaisesMessage(
            Forms.DoesNotExist,
            "Forms matching query does not exist"
        ):
            invalid_form_id = 9999
            admin = SystemUser.objects.first()
            result = self.call_command(
                invalid_form_id,
                admin.id,
                "-a",
                0,
            )
            self.assertIn("Forms matching query does not exist", result)
            # should not create job
            self.assertEqual(Jobs.objects.count(), 0)
