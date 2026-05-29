"""
TDD: Batch creation — approver validation + administration LCA assignment

Features:
  A. Approvers with the same or higher administration level can create
     batches from pending submissions within their approval scope.
  B. Batch.administration is set to the LCA (lowest common ancestor) of
     all data items' administrations, not the user's role administration.

Scenarios:
  1. Approver creates a batch from another user's data within scope — succeeds
  2. Approver cannot create a batch from data outside their scope
  3. Approver at higher level can batch data from lower-level submissions
  4. Regular submitter (no approve role) cannot batch others' data
  5. Existing happy path (submitter batches own data) is preserved
  6. Batch with items from different level-3 admins → administration is
     their common parent (level 2), not the user's role administration
  7. Batch with items all at the same administration → administration is
     that administration (no change)
"""
from django.test import TestCase
from django.test.utils import override_settings
from django.core.management import call_command
from api.v1.v1_data.models import FormData
from api.v1.v1_forms.models import Forms
from api.v1.v1_profile.models import Administration, Levels
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin
from api.v1.v1_data.functions import add_fake_answers
from api.v1.v1_approval.models import DataBatch


def _pending(form, created_by, administration, name="Pending"):
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
class CreateBatchByApproverTestCase(TestCase, ProfileTestHelperMixin):
    """
    Hierarchy (resolved dynamically):
      level 1: level1_adm
        level 2: level2_adm      <- approver's administration
          level 3: level3_adm   <- submitter submits data here
      level 2: sibling_adm      <- different parent, out of scope
    """

    def setUp(self):
        call_command("administration_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)
        call_command("form_seeder", "--test")

        self.form = Forms.objects.get(pk=1)

        # Resolve hierarchy dynamically
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

        # Submitter: submit role at level 3 — creates the data
        self.submitter = self.create_user(
            email="submitter.batch@test.com",
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

        # Approver: approve role at level 2 (scope covers level 3)
        self.approver = self.create_user(
            email="approver.batch@test.com",
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

        # Upper approver: approve role at level 1
        self.upper_approver = self.create_user(
            email="upper.approver.batch@test.com",
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

        # Another admin user at level 2 — no approve role
        self.other_admin = self.create_user(
            email="other.admin.batch@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.level2_adm,
            form=self.form,
        )
        self.other_admin.set_password("test")
        self.other_admin.save()
        self.other_admin_token = self.get_auth_token(
            self.other_admin.email, "test"
        )

        # A second level-3 admin that is a SIBLING of level3_adm
        # (different level-3 admin, but same level-2 parent)
        self.level3_adm_sibling = (
            Administration.objects
            .filter(level__level=3, parent=self.level2_adm)
            .exclude(id=self.level3_adm.id)
            .order_by("id")
            .first()
        )

        # Pending data at level 3, submitted by submitter
        self.data_in_scope = _pending(
            self.form, self.submitter, self.level3_adm,
            "In-scope pending data"
        )
        # Pending data at sibling branch, submitted by submitter
        self.data_out_of_scope = _pending(
            self.form, self.submitter, self.sibling_adm,
            "Out-of-scope pending data"
        )
        # Pending data at sibling level-3 admin (different level-3 but same
        # level-2 parent) — still within level-2 approver's scope
        self.data_in_scope_sibling_level3 = _pending(
            self.form, self.submitter,
            self.level3_adm_sibling or self.level3_adm,
            "In-scope sibling level-3 data"
        )

    def _create_batch(self, token, data_ids, name="Test Batch"):
        return self.client.post(
            "/api/v1/batch",
            {"name": name, "data": data_ids},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    # --- Scenario 1: Approver batches others' data within scope ---

    def test_approver_can_batch_data_within_approval_scope(self):
        response = self._create_batch(
            self.approver_token,
            [self.data_in_scope.id],
            "Approver Batch In-Scope",
        )
        self.assertEqual(
            response.status_code, 201,
            f"Expected 201, got {response.status_code}: {response.json()}"
        )
        self.assertEqual(
            response.json()["message"], "Batch created successfully"
        )

    # --- Scenario 2: Approver cannot batch data outside their scope ---

    def test_approver_cannot_batch_data_outside_approval_scope(self):
        response = self._create_batch(
            self.approver_token,
            [self.data_out_of_scope.id],
            "Approver Batch Out-of-Scope",
        )
        self.assertEqual(
            response.status_code, 400,
            "Should reject data outside the approver's administration scope"
        )

    # --- Scenario 3: Upper approver batches level-3 data ---

    def test_upper_approver_can_batch_data_at_lower_levels(self):
        response = self._create_batch(
            self.upper_approver_token,
            [self.data_in_scope.id],
            "Upper Approver Batch",
        )
        self.assertEqual(
            response.status_code, 201,
            f"Expected 201, got {response.status_code}: {response.json()}"
        )

    # --- Scenario 4: Non-approver admin cannot batch others' data ---

    def test_non_approver_cannot_batch_others_data(self):
        response = self._create_batch(
            self.other_admin_token,
            [self.data_in_scope.id],
            "Other Admin Batch",
        )
        self.assertEqual(
            response.status_code, 400,
            "Admin without approve role should not batch others' data"
        )
        self.assertIn(
            "One or more data items were not submitted by the user",
            str(response.json()),
        )

    # --- Scenario 5: Submitter can still batch their own data (regression) ---

    def test_submitter_can_batch_own_data(self):
        response = self._create_batch(
            self.submitter_token,
            [self.data_in_scope.id],
            "Submitter Own Batch",
        )
        self.assertEqual(
            response.status_code, 201,
            f"Regression: submitter batching own data should still work: "
            f"{response.json()}"
        )

    # --- Scenario 6: LCA administration when items span multiple level-3 ---

    def test_batch_administration_is_lca_of_data_items(self):
        """
        When items are from two different level-3 administrations (siblings
        under the same level-2 parent), the batch administration should be
        set to level2_adm (the LCA), not the approver's role administration.
        """
        # If test data only has one level-3 under this parent, create one
        sibling = self.level3_adm_sibling
        if not sibling:
            level3 = Levels.objects.get(level=3)
            sibling = Administration.objects.create(
                parent=self.level2_adm,
                level=level3,
                name="Test Level3 Sibling",
            )

        data2 = _pending(
            self.form, self.submitter, sibling,
            "Sibling level-3 data for LCA test"
        )
        response = self._create_batch(
            self.approver_token,
            [self.data_in_scope.id, data2.id],
            "LCA Admin Batch",
        )
        self.assertEqual(
            response.status_code, 201,
            f"Expected 201, got {response.status_code}: {response.json()}"
        )
        batch = DataBatch.objects.get(name="LCA Admin Batch")
        self.assertEqual(
            batch.administration_id, self.level2_adm.id,
            f"Batch administration should be level2_adm (LCA), "
            f"got: {batch.administration.name}"
        )

    # --- Scenario 7: Single administration — keep same administration ---

    def test_batch_administration_is_item_admin_when_same(self):
        """
        When all items are from the same administration, the batch
        administration should be that administration.
        """
        response = self._create_batch(
            self.approver_token,
            [self.data_in_scope.id],
            "Same Admin Batch",
        )
        self.assertEqual(response.status_code, 201)
        batch = DataBatch.objects.get(name="Same Admin Batch")
        self.assertEqual(
            batch.administration_id, self.level3_adm.id,
            f"Single-admin batch should keep level3_adm, "
            f"got: {batch.administration.name}"
        )
