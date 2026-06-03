"""
TDD: Pending data list — approval filter

Feature: approvers with the same or higher administration level can see
pending data submissions.

Scenarios covered:
  1. Approver sees data at their OWN administration (exact match)
  2. Approver sees data at a LOWER (descendant) administration level
  3. Approver does NOT see data at a SIBLING administration
     (same level, different parent)
  4. Upper approver sees data across entire subtree
  5. Non-approver sees ONLY their own submitted data
  6. Original submitter always sees their own data regardless of role
"""
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from api.v1.v1_data.models import FormData
from api.v1.v1_forms.models import Forms
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin
from api.v1.v1_data.functions import add_fake_answers


def _pending(form, created_by, administration, name="Pending Data"):
    data = FormData.objects.create(
        name=name,
        form=form,
        created_by=created_by,
        administration=administration,
        geo=[7.2088, 126.8456],
        is_pending=True,
        is_draft=False,
    )
    add_fake_answers(data)
    return data


@override_settings(USE_TZ=False, TEST_ENV=True)
class PendingDataApprovalFilterTestCase(TestCase, ProfileTestHelperMixin):
    """
    Hierarchy structure (resolved dynamically):
      level 1: level1_adm
        level 2: level2_adm  (approver's administration)
          level 3: level3_adm  (descendant)
      level 2: sibling_level2  (different parent — out of subtree)
    """

    def setUp(self):
        call_command("administration_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)
        call_command("form_seeder", "--test")

        self.form = Forms.objects.get(pk=1)

        # Pick a level-2 admin that has at least one level-3 child
        self.level2_adm = (
            Administration.objects
            .filter(level__level=2)
            .filter(parent_administration__level__level=3)
            .order_by("id")
            .first()
        )
        self.assertIsNotNone(
            self.level2_adm,
            "Need a level-2 admin with level-3 children"
        )
        self.level1_adm = self.level2_adm.parent
        self.level3_adm = (
            Administration.objects
            .filter(level__level=3, parent=self.level2_adm)
            .order_by("id")
            .first()
        )
        self.sibling_level2 = (
            Administration.objects
            .filter(level__level=2)
            .exclude(parent=self.level1_adm)
            .order_by("id")
            .first()
        )
        self.assertIsNotNone(
            self.sibling_level2,
            "Need a sibling level-2 admin"
        )

        self.submitter = self.create_user(
            email="submitter@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.level2_adm,
            form=self.form,
        )
        self.submitter.set_password("test")
        self.submitter.save()
        self.submitter_token = self.get_auth_token(
            self.submitter.email, "test"
        )

        self.approver = self.create_user(
            email="approver@test.com",
            role_level=self.IS_APPROVER,
            password="test",
            administration=self.level2_adm,
            form=self.form,
        )
        self.approver.set_password("test")
        self.approver.save()
        self.approver_token = self.get_auth_token(
            self.approver.email, "test"
        )

        self.upper_approver = self.create_user(
            email="upper.approver@test.com",
            role_level=self.IS_APPROVER,
            password="test",
            administration=self.level1_adm,
            form=self.form,
        )
        self.upper_approver.set_password("test")
        self.upper_approver.save()
        self.upper_approver_token = self.get_auth_token(
            self.upper_approver.email, "test"
        )

        self.data_at_level2 = _pending(
            self.form, self.submitter, self.level2_adm,
            "Data at level2_adm"
        )
        self.data_at_level3 = _pending(
            self.form, self.submitter, self.level3_adm,
            "Data at level3_adm"
        )
        self.data_at_sibling = _pending(
            self.form, self.submitter, self.sibling_level2,
            "Data at sibling"
        )

    def _get_ids(self, token):
        response = self.client.get(
            f"/api/v1/form-pending-data/{self.form.id}/",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 200)
        return {item["id"] for item in response.json()["data"]}

    # --- Scenario 1: Approver sees data at their OWN administration ---

    def test_approver_sees_data_at_own_administration(self):
        ids = self._get_ids(self.approver_token)
        self.assertIn(
            self.data_at_level2.id, ids,
            "Approver should see data at their own administration"
        )

    # --- Scenario 2: Approver sees data at LOWER (descendant) admin ---

    def test_approver_sees_data_at_descendant_administration(self):
        ids = self._get_ids(self.approver_token)
        self.assertIn(
            self.data_at_level3.id, ids,
            "Approver should see data at a descendant administration"
        )

    # --- Scenario 3: Approver does NOT see data at SIBLING admin ---

    def test_approver_does_not_see_data_at_sibling_administration(self):
        ids = self._get_ids(self.approver_token)
        self.assertNotIn(
            self.data_at_sibling.id, ids,
            "Approver should NOT see data at a sibling administration"
        )

    # --- Scenario 4: Upper approver sees their own subtree ---

    def test_upper_approver_sees_data_across_own_subtree(self):
        ids = self._get_ids(self.upper_approver_token)
        self.assertIn(
            self.data_at_level2.id, ids,
            "Upper approver should see data at level-2 child admin"
        )
        self.assertIn(
            self.data_at_level3.id, ids,
            "Upper approver should see data at level-3 grandchild admin"
        )
        # sibling_level2 is under a DIFFERENT level-1 parent — not visible
        self.assertNotIn(
            self.data_at_sibling.id, ids,
            "Upper approver should NOT see data outside their subtree"
        )

    # --- Scenario 5: Non-approver sees ONLY their own submitted data ---

    def test_non_approver_sees_only_own_data(self):
        ids = self._get_ids(self.submitter_token)
        self.assertIn(self.data_at_level2.id, ids)
        self.assertIn(self.data_at_level3.id, ids)
        self.assertIn(self.data_at_sibling.id, ids)

    def test_non_approver_cannot_see_others_data(self):
        other = self.create_user(
            email="other.submitter@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.level2_adm,
            form=self.form,
        )
        other.set_password("test")
        other.save()
        other_token = self.get_auth_token(other.email, "test")

        ids = self._get_ids(other_token)
        self.assertNotIn(
            self.data_at_level2.id, ids,
            "Non-approver should not see data they did not create"
        )
        self.assertNotIn(
            self.data_at_level3.id, ids,
            "Non-approver should not see data they did not create"
        )

    # --- Scenario 6: Approver always sees their own created data ---

    def test_approver_sees_own_created_data_regardless_of_level(self):
        own_data = _pending(
            self.form, self.approver, self.sibling_level2,
            "Approver own data outside subtree"
        )
        ids = self._get_ids(self.approver_token)
        self.assertIn(
            own_data.id, ids,
            "Approver should always see data they created"
        )
