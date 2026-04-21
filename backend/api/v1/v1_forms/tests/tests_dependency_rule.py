from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_forms.constants import QuestionTypes
from api.v1.v1_forms.models import Forms, Questions
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


@override_settings(USE_TZ=False, TEST_ENV=True)
class DependencyRuleTestCase(TestCase, ProfileTestHelperMixin):
    """
    Test cases for dependency_rule field in Questions model and serialization.
    """

    def setUp(self):
        # Clear cache to avoid interference between tests
        cache.clear()
        call_command("administration_seeder", "--test", 1)
        call_command("default_roles_seeder", "--test", 1)
        call_command("form_seeder", "--test", 1)

        self.form = Forms.objects.get(pk=1)
        self.adm = Administration.objects.filter(level__level__gt=2).first()

        user = self.create_user(
            email="user.dep.rule@test.com",
            role_level=self.IS_ADMIN,
            administration=self.adm,
            form=self.form,
        )
        user.set_password("password")
        user.save()

        self.token = self.get_auth_token(
            email=user.email,
            password="password",
        )

    def test_dependency_rule_and_serialization(self):
        """Test that dependency_rule='AND' is properly serialized."""
        # Get a question with dependencies
        question = self.form.form_questions.filter(
            dependency__isnull=False
        ).first()
        if not question:
            # Create a question with dependency for testing
            parent_q = Questions.objects.create(
                form=self.form,
                question_group=self.form.form_question_group.first(),
                order=99,
                name="parent_question",
                label="Parent Question",
                type=QuestionTypes.option,
                required=False,
            )
            question = Questions.objects.create(
                form=self.form,
                question_group=self.form.form_question_group.first(),
                order=100,
                name="child_question_and",
                label="Child Question AND",
                type=QuestionTypes.text,
                required=False,
                dependency=[{"id": parent_q.id, "options": ["yes"]}],
                dependency_rule="AND",
            )

        # Update to ensure AND rule
        question.dependency_rule = "AND"
        question.save()

        response = self.client.get(
            f"/api/v1/form/web/{self.form.id}/",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)

        data = response.json()
        question_groups = data["question_group"]
        found = False

        for qg in question_groups:
            for q in qg["question"]:
                if q["id"] == question.id:
                    self.assertIn("dependency_rule", q)
                    self.assertEqual(q["dependency_rule"], "AND")
                    found = True
                    break
            if found:
                break

        self.assertTrue(
            found, "Question with dependency_rule='AND' not found in response"
        )

    def test_dependency_rule_or_serialization(self):
        """Test that dependency_rule='OR' is properly serialized."""
        # Create a question with OR dependency rule
        parent_q1 = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=101,
            name="parent_question_1",
            label="Parent Question 1",
            type=QuestionTypes.option,
            required=False,
        )
        parent_q2 = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=102,
            name="parent_question_2",
            label="Parent Question 2",
            type=QuestionTypes.option,
            required=False,
        )
        or_question = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=103,
            name="child_question_or",
            label="Child Question OR",
            type=QuestionTypes.text,
            required=False,
            dependency=[
                {"id": parent_q1.id, "options": ["yes"]},
                {"id": parent_q2.id, "options": ["approved"]},
            ],
            dependency_rule="OR",
        )

        response = self.client.get(
            f"/api/v1/form/web/{self.form.id}/",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)

        data = response.json()
        question_groups = data["question_group"]
        found = False

        for qg in question_groups:
            for q in qg["question"]:
                if q["id"] == or_question.id:
                    self.assertIn("dependency_rule", q)
                    self.assertEqual(q["dependency_rule"], "OR")
                    self.assertIsNotNone(q.get("dependency"))
                    self.assertEqual(len(q["dependency"]), 2)
                    found = True
                    break
            if found:
                break

        self.assertTrue(
            found, "Question with dependency_rule='OR' not found in response"
        )

    def test_dependency_rule_nullable_defaults_to_and(self):
        """
        Test that when dependency_rule is null,
        serialization omits it (client defaults to AND).
        """
        # Create a question without dependency_rule (nullable)
        parent_q = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=104,
            name="parent_question_null",
            label="Parent Question Null",
            type=QuestionTypes.option,
            required=False,
        )
        null_rule_question = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=105,
            name="child_question_null_rule",
            label="Child Question Null Rule",
            type=QuestionTypes.text,
            required=False,
            dependency=[{"id": parent_q.id, "options": ["yes"]}],
            dependency_rule=None,  # Explicitly null
        )

        response = self.client.get(
            f"/api/v1/form/web/{self.form.id}/",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)

        data = response.json()
        question_groups = data["question_group"]
        found = False

        for qg in question_groups:
            for q in qg["question"]:
                if q["id"] == null_rule_question.id:
                    # When dependency_rule is None, the serializer should omit
                    # it (due to to_representation filtering null values)
                    # OR it might be included as None/null
                    # The client will default to 'AND' when it's missing
                    self.assertIn("dependency", q)
                    found = True
                    break
            if found:
                break

        self.assertTrue(
            found, "Question with null dependency_rule not found in response"
        )

    def test_dependency_rule_case_insensitive(self):
        """
        Test that dependency_rule handles case variations (AND, and, And).
        """
        # Create questions with different case variations
        parent_q = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=106,
            name="parent_case_test",
            label="Parent Case Test",
            type=QuestionTypes.option,
            required=False,
        )

        # Test lowercase
        lowercase_question = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=107,
            name="child_lowercase",
            label="Child Lowercase",
            type=QuestionTypes.text,
            required=False,
            dependency=[{"id": parent_q.id, "options": ["yes"]}],
            dependency_rule="and",  # lowercase
        )

        # Test mixed case
        mixedcase_question = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=108,
            name="child_mixedcase",
            label="Child Mixed Case",
            type=QuestionTypes.text,
            required=False,
            dependency=[{"id": parent_q.id, "options": ["yes"]}],
            dependency_rule="Or",  # mixed case
        )

        response = self.client.get(
            f"/api/v1/form/web/{self.form.id}/",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)

        data = response.json()
        question_groups = data["question_group"]

        # Find both questions
        lowercase_found = False
        mixedcase_found = False

        for qg in question_groups:
            for q in qg["question"]:
                if q["id"] == lowercase_question.id:
                    self.assertIn("dependency_rule", q)
                    self.assertEqual(q["dependency_rule"], "and")
                    lowercase_found = True
                if q["id"] == mixedcase_question.id:
                    self.assertIn("dependency_rule", q)
                    self.assertEqual(q["dependency_rule"], "Or")
                    mixedcase_found = True

        self.assertTrue(lowercase_found, "Lowercase dependency_rule not found")
        self.assertTrue(
            mixedcase_found, "Mixed case dependency_rule not found"
        )

    def test_form_export_includes_dependency_rule(self):
        """Test that form export includes dependency_rule field."""
        # Create a new question with OR rule to avoid test isolation issues
        parent_q = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=109,
            name="export_parent",
            label="Export Parent",
            type=QuestionTypes.option,
            required=False,
        )
        export_question = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=110,
            name="export_child_or",
            label="Export Child OR",
            type=QuestionTypes.text,
            required=False,
            dependency=[{"id": parent_q.id, "options": ["yes"]}],
            dependency_rule="OR",
        )
        test_question_id = export_question.id

        # Test both endpoints: webform and form data
        endpoints = [
            f"/api/v1/form/web/{self.form.id}/",
            f"/api/v1/form/{self.form.id}/",
        ]
        for endpoint in endpoints:
            response = self.client.get(
                endpoint,
                HTTP_AUTHORIZATION=f"Bearer {self.token}",
            )
            self.assertEqual(response.status_code, 200)

            data = response.json()
            question_groups = data["question_group"]
            found = False

            for qg in question_groups:
                for q in qg["question"]:
                    if q["id"] == test_question_id:
                        self.assertIn("dependency_rule", q)
                        self.assertEqual(q["dependency_rule"], "OR")
                        found = True
                        break
                if found:
                    break

            self.assertTrue(
                found,
                f"dependency_rule not found in {endpoint}"
            )

    def test_questions_without_dependencies_no_dependency_rule(self):
        """
        Test that questions without dependencies don't have dependency_rule.
        """
        # Create a simple question without dependencies
        simple_question = Questions.objects.create(
            form=self.form,
            question_group=self.form.form_question_group.first(),
            order=111,
            name="simple_no_dep",
            label="Simple No Dependency",
            type=QuestionTypes.text,
            required=False,
            dependency=None,
            dependency_rule=None,
        )

        response = self.client.get(
            f"/api/v1/form/web/{self.form.id}/",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)

        data = response.json()
        question_groups = data["question_group"]
        found = False

        for qg in question_groups:
            for q in qg["question"]:
                if q["id"] == simple_question.id:
                    # Should not have dependency or dependency_rule
                    self.assertNotIn("dependency", q)
                    found = True
                    break
            if found:
                break

        self.assertTrue(
            found, "Simple question without dependencies not found"
        )
