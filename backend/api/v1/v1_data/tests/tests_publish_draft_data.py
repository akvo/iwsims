from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_forms.models import Forms
from api.v1.v1_profile.models import Administration
from api.v1.v1_data.models import FormData
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


@override_settings(USE_TZ=False)
class PublishDraftFormDataTestCase(TestCase, ProfileTestHelperMixin):
    def setUp(self):
        super().setUp()
        call_command("administration_seeder", "--test")
        call_command("form_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)
        self.form = Forms.objects.get(pk=1)

        # Deterministic pick — order_by("?") made this setUp intermittently
        # 400 on submission (flaky under --shuffle --parallel).
        self.administration = (
            Administration.objects.filter(level__level=3)
            .order_by("id")
            .first()
        )

        self.user = self.create_user(
            email="admin@akvo.org",
            role_level=self.IS_ADMIN,
            administration=self.administration,
            form=self.form,
        )
        self.user.set_password("password")
        self.user.save()

        self.token = self.get_auth_token(self.user.email, "password")
        self.reg_uuid = "8d1822c2-0b01-43e2-97f3-67ab71e5f946"
        payload = {
            "data": {
                "name": "Testing Data",
                "administration": self.administration.id,
                "geo": [6.2088, 106.8456],
                "uuid": self.reg_uuid,
            },
            "answer": [
                {"question": 101, "value": "Jane"},
                {"question": 102, "value": ["female"]},
                {"question": 103, "value": 6212111},
                {"question": 104, "value": 2.0},
                {"question": 105, "value": [6.2088, 106.8456]},
                {"question": 106, "value": ["parent"]},
                {"question": 109, "value": 0},
            ],
        }

        response = self.client.post(
            f"/api/v1/draft-submissions/{self.form.id}/",
            data=payload,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 201)

        self.draft_data = FormData.objects_draft.first()

        self.url = (
            f"/api/v1/publish-draft-submission"
            f"/{self.draft_data.id}"
        )

    def test_draft_data_list_empty_after_publish(self):
        # Ensure the draft data list is not empty before publishing
        response = self.client.get(
            f"/api/v1/draft-submissions/{self.form.id}/",
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.json()["data"]), 0)

        # Publish the draft data
        response = self.client.post(
            self.url,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 200)

        # Verify that the draft data list is now empty
        response = self.client.get(
            f"/api/v1/draft-submissions/{self.form.id}/",
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["data"]), 0)

    def test_publish_draft_data_into_manage_data(self):
        response = self.client.post(
            self.url,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 200)

        # Check if the draft data is published
        published_data = FormData.objects.get(pk=self.draft_data.id)
        self.assertIsNotNone(published_data)

        self.assertFalse(published_data.is_pending)
        self.assertFalse(published_data.is_draft)

        # Verify that the data is now in the manage data via api
        response = self.client.get(
            f"/api/v1/form-data/{self.draft_data.form.id}/",
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 200)
        find_data = list(
            filter(
                lambda x: x["id"] == self.draft_data.id,
                response.json()["data"],
            )
        )
        self.assertEqual(len(find_data), 1)

    def test_publish_draft_data_into_pending_data(self):
        # Create all approvers based on administration and form

        for index, adm in enumerate(self.administration.ancestors.all()):
            self.create_user(
                email=f"approver.{index+1}@test.com",
                role_level=self.IS_APPROVER,
                administration=adm,
                form=self.form,
            )

        response = self.client.post(
            self.url,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 200)
        # Check if the draft data is published
        published_data = FormData.objects.get(pk=self.draft_data.id)
        self.assertIsNotNone(published_data)
        # But is_pending should be True
        self.assertTrue(published_data.is_pending)

        # Verify that the data is now in the pending data via api
        response = self.client.get(
            f"/api/v1/form-pending-data/{self.form.id}/",
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 200)
        find_data = list(
            filter(
                lambda x: x["id"] == self.draft_data.id,
                response.json()["data"],
            )
        )
        self.assertEqual(len(find_data), 1)

    def test_publish_draft_data_unauthorized(self):
        # Attempt to publish without authentication
        response = self.client.post(
            self.url,
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_publish_draft_data_forbidden(self):
        # Create a different user and try to publish the data
        other_user = self.create_user(
            email="other.123@test.com",
            role_level=self.IS_ADMIN,
            administration=self.administration,
            form=self.form,
        )
        other_user.set_password("password")
        other_user.save()

        other_token = self.get_auth_token(other_user.email, "password")
        response = self.client.post(
            self.url,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {other_token}'}
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json()["detail"],
            "You do not have permission to perform this action."
        )
