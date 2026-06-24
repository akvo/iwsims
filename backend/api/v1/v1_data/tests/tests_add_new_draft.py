from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_forms.models import Forms
from api.v1.v1_profile.models import Administration
from api.v1.v1_data.models import FormData
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


@override_settings(USE_TZ=False, TEST_ENV=True)
class AddNewDraftFormDataTestCase(TestCase, ProfileTestHelperMixin):
    def setUp(self):
        super().setUp()
        call_command("administration_seeder", "--test")
        call_command("form_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)
        self.form = Forms.objects.get(pk=1)

        # Deterministic pick — order_by("?") is a flaky source under
        # --shuffle --parallel.
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

    def test_add_new_draft(self):
        url = f"/api/v1/draft-submissions/{self.form.id}/"
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
            url,
            data=payload,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(
            data,
            {"message": "Draft created successfully"}
        )

        # Verify the draft was created
        draft_data = FormData.objects_draft.filter(
            name="Testing Data",
            administration=self.administration,
            uuid=self.reg_uuid
        ).first()
        self.assertIsNotNone(draft_data)
        self.assertTrue(draft_data.is_draft)

    def test_add_new_draft_with_incomplete_submission(self):
        url = f"/api/v1/draft-submissions/{self.form.id}/"
        payload = {
            "data": {
                "name": "Testing Data",
                "administration": self.administration.id,
                # Missing geo field
                "uuid": self.reg_uuid,
            },
            "answer": [
                {"question": 101, "value": "Jane"},
                {"question": 102, "value": ["female"]},
            ]
        }
        response = self.client.post(
            url,
            data=payload,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 201)

    def test_add_new_draft_with_invalid_data(self):
        url = f"/api/v1/draft-submissions/{self.form.id}/"
        payload = {
            "data": {
                "name": "",
                "administration": self.administration.id,
                "geo": [6.2088, 106.8456],
                "uuid": self.reg_uuid,
            },
            "answer": [
                {"question": 101, "value": "Jane"},
                {"question": 102, "value": ["some_invalid_value"]},
                {"question": 103, "value": 6212111},
                {"question": 104, "value": 2.0},
                {"question": 105, "value": [6.2088, 106.8456]},
                {"question": 106, "value": ["parent", "children"]},
                {"question": 109, "value": 0},
            ],
        }
        response = self.client.post(
            url,
            data=payload,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 400)

    def test_add_new_draft_with_missing_fields(self):
        url = f"/api/v1/draft-submissions/{self.form.id}/"
        payload = {
            "data": {
                "name": "Testing Data",
                "uuid": self.reg_uuid,
                # Missing administration and geo fields
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
            url,
            data=payload,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 400)

    def test_add_new_draft_monitoring_form(self):
        # Test adding a draft for a monitoring form
        monitoring_form = self.form.children.first()
        url = f"/api/v1/draft-submissions/{monitoring_form.id}/"
        payload = {
            "data": {
                "name": "Monitoring Data",
                "administration": self.administration.id,
                "geo": [6.2088, 106.8456],
                "uuid": self.reg_uuid,
            },
            "answer": [
                {"question": 10103, "value": "61299123"},
                {
                    "question": 10106,
                    "value": ["wife__husband__partner", "children"]
                },
                {"question": 10109, "value": 77.5},
            ]
        }
        response = self.client.post(
            url,
            data=payload,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 201)

    def test_add_new_draft_with_invalid_monitoring_data(self):
        # Test adding a draft for a monitoring form with invalid data
        monitoring_form = self.form.children.first()
        url = f"/api/v1/draft-submissions/{monitoring_form.id}/"
        payload = {
            "data": {
                "name": "Monitoring Data",
                "administration": self.administration.id,
                "geo": [6.2088, 106.8456],
                "uuid": self.reg_uuid,
            },
            "answer": [
                {"question": 10103, "value": "invalid_phone_number"},
                {"question": 10106, "value": ["invalid_relation"]},
                {"question": 10109, "value": [-10.0]},  # Invalid value
            ]
        }
        response = self.client.post(
            url,
            data=payload,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 400)

    def test_add_new_draft_with_missing_fields_in_monitoring_form(self):
        # Test adding a draft for a monitoring form with missing fields
        monitoring_form = self.form.children.first()
        url = f"/api/v1/draft-submissions/{monitoring_form.id}/"
        payload = {
            "data": {
                "name": "Monitoring Data",
                "uuid": self.reg_uuid,
                # Missing administration and geo fields
            },
            "answer": [
                {"question": 10103, "value": "61299123"},
                {
                    "question": 10106,
                    "value": ["wife__husband__partner", "children"]
                },
                {"question": 10109, "value": 77.5},
            ]
        }
        response = self.client.post(
            url,
            data=payload,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 400)

    def test_add_new_draft_with_missing_question_in_answer(self):
        # Test adding a draft with a missing question in the answer
        url = f"/api/v1/draft-submissions/{self.form.id}/"
        payload = {
            "data": {
                "name": "Testing Data",
                "administration": self.administration.id,
                "geo": [6.2088, 106.8456],
                "uuid": self.reg_uuid,
            },
            "answer": [
                {"value": "Jane"},  # Missing question field
                {"question": 102, "value": ["female"]},
                {"question": 103, "value": 6212111},
            ]
        }
        response = self.client.post(
            url,
            data=payload,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 400)

    def test_add_new_draft_without_submit_permission(self):
        # Test adding a draft without submit permission
        self.user.user_user_role.all().delete()
        self.user.save()
        url = f"/api/v1/draft-submissions/{self.form.id}/"
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
            url,
            data=payload,
            content_type="application/json",
            **{'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        )
        self.assertEqual(response.status_code, 403)
        data = response.json()
        self.assertEqual(
            data,
            {"detail": "You do not have permission to perform this action."}
        )
