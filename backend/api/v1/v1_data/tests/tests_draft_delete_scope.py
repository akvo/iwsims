"""
TDD: Draft DELETE — scope-based access control

Rules:
  - Owner (created_by) can always delete their own draft.
  - User with DataAccessTypes.delete access at the same or higher
    administration level can delete a draft within their scope.
  - Users without delete access (e.g. Approver role) cannot delete
    others' drafts even if they are in-scope for viewing.
  - Users with delete access outside their scope cannot delete.

Scenarios:
  1. Owner deletes own draft → 204
  2. Admin supervisor (level 2) deletes draft from level-3 submitter → 204
  3. Admin at level 1 (upper) deletes draft from level-3 → 204
  4. Approver (no delete access) cannot delete in-scope draft → 403
  5. Admin at sibling (out of scope) cannot delete → 403
"""
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from rest_framework import status

from api.v1.v1_data.models import FormData
from api.v1.v1_forms.models import Forms
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


def _draft(form, created_by, administration, name="Draft"):
    return FormData.objects.create(
        name=name,
        form=form,
        created_by=created_by,
        administration=administration,
        geo=[7.2088, 126.8456],
        is_pending=False,
        is_draft=True,
    )


@override_settings(USE_TZ=False, TEST_ENV=True)
class DraftDeleteScopeTestCase(TestCase, ProfileTestHelperMixin):
    """
    Hierarchy (resolved dynamically):
      level 0: root_adm
        level 1: level1_adm
          level 2: level2_adm  <- supervisor's administration
            level 3: level3_adm  <- submitter's administration
          level 2: sibling_adm   <- outside scope
    """

    def setUp(self):
        call_command("administration_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)
        call_command("form_seeder", "--test")

        self.form = Forms.objects.get(pk=1)

        self.level2_adm = (
            Administration.objects
            .filter(level__level=2)
            .filter(parent_administration__level__level=3)
            .order_by("id")
            .first()
        )
        self.level1_adm = self.level2_adm.parent
        self.level3_adm = (
            Administration.objects
            .filter(level__level=3, parent=self.level2_adm)
            .order_by("id")
            .first()
        )
        self.sibling_adm = (
            Administration.objects
            .filter(level__level=2)
            .exclude(parent=self.level1_adm)
            .order_by("id")
            .first()
        )

        # Submitter: IS_ADMIN at level 3 (has delete access for own scope)
        self.submitter = self.create_user(
            email="submitter.delscope@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.level3_adm,
            form=self.form,
        )
        self.submitter.set_password("test")
        self.submitter.save()
        self.submitter_token = self.get_auth_token(
            self.submitter.email, "test"
        )

        # Supervisor: IS_ADMIN at level 2 (delete scope covers level 3)
        self.supervisor = self.create_user(
            email="supervisor.delscope@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.level2_adm,
            form=self.form,
        )
        self.supervisor.set_password("test")
        self.supervisor.save()
        self.supervisor_token = self.get_auth_token(
            self.supervisor.email, "test"
        )

        # Upper supervisor: IS_ADMIN at level 1
        self.upper_supervisor = self.create_user(
            email="upper.delscope@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.level1_adm,
            form=self.form,
        )
        self.upper_supervisor.set_password("test")
        self.upper_supervisor.save()
        self.upper_supervisor_token = self.get_auth_token(
            self.upper_supervisor.email, "test"
        )

        # Approver: IS_APPROVER at level 2 (no delete access)
        self.approver = self.create_user(
            email="approver.delscope@test.com",
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

        # Sibling admin: IS_ADMIN at unrelated level-2 admin
        self.sibling_admin = self.create_user(
            email="sibling.delscope@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.sibling_adm,
            form=self.form,
        )
        self.sibling_admin.set_password("test")
        self.sibling_admin.save()
        self.sibling_token = self.get_auth_token(
            self.sibling_admin.email, "test"
        )

    def _delete(self, token, draft_id):
        return self.client.delete(
            f"/api/v1/draft-submission/{draft_id}/",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def _make_draft(self, name="Draft"):
        return _draft(self.form, self.submitter, self.level3_adm, name)

    # --- Scenario 1: Owner deletes own draft ---

    def test_owner_can_delete_own_draft(self):
        draft = self._make_draft("Owner draft")
        response = self._delete(self.submitter_token, draft.id)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        with self.assertRaises(FormData.DoesNotExist):
            FormData.objects.get(id=draft.id)

    # --- Scenario 2: Supervisor (level 2) can delete level-3 draft ---

    def test_supervisor_can_delete_in_scope_draft(self):
        draft = self._make_draft("Supervisor scope draft")
        response = self._delete(self.supervisor_token, draft.id)
        self.assertEqual(
            response.status_code, status.HTTP_204_NO_CONTENT,
            f"Supervisor should be able to delete in-scope draft: "
            f"{response.content}"
        )

    # --- Scenario 3: Upper admin (level 1) can delete level-3 draft ---

    def test_upper_supervisor_can_delete_in_scope_draft(self):
        draft = self._make_draft("Upper scope draft")
        response = self._delete(self.upper_supervisor_token, draft.id)
        self.assertEqual(
            response.status_code, status.HTTP_204_NO_CONTENT,
            f"Upper supervisor should be able to delete in-scope draft: "
            f"{response.content}"
        )

    # --- Scenario 4: Approver (no delete access) cannot delete ---

    def test_approver_cannot_delete_in_scope_draft(self):
        draft = self._make_draft("Approver no-delete draft")
        response = self._delete(self.approver_token, draft.id)
        self.assertEqual(
            response.status_code, status.HTTP_403_FORBIDDEN,
            "Approver has no delete access and should be rejected"
        )
        self.assertTrue(FormData.objects.filter(id=draft.id).exists())

    # --- Scenario 5: Out-of-scope admin cannot delete ---

    def test_sibling_admin_cannot_delete_out_of_scope_draft(self):
        draft = self._make_draft("Sibling scope draft")
        response = self._delete(self.sibling_token, draft.id)
        self.assertEqual(
            response.status_code, status.HTTP_403_FORBIDDEN,
            "Admin outside scope should not delete the draft"
        )
        self.assertTrue(FormData.objects.filter(id=draft.id).exists())
