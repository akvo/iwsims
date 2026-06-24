from unittest.mock import call, patch

from django.test import SimpleTestCase, override_settings

from api.v1.v1_data.tasks import refresh_mv_concurrency


class RefreshMVConcurrencyTaskTest(SimpleTestCase):
    @override_settings(TEST_ENV=False)
    @patch("api.v1.v1_data.tasks.refresh_materialized_data")
    def test_non_test_refresh_splits_non_concurrent_view(self, refresh_mock):
        refresh_mv_concurrency()

        self.assertEqual(
            refresh_mock.call_args_list,
            [
                call(
                    views=[
                        "mv_latest_monitoring",
                        "mv_answer_denormalized",
                        "mv_cross_form_latest",
                        "mv_parent_aggregates",
                    ],
                    concurrent=True,
                ),
                call(views=["view_data_options"], concurrent=False),
            ],
        )

    @override_settings(TEST_ENV=True)
    @patch("api.v1.v1_data.tasks.refresh_materialized_data")
    def test_test_env_refreshes_all_views_without_concurrency(
        self, refresh_mock,
    ):
        refresh_mv_concurrency()

        refresh_mock.assert_called_once_with(concurrent=False)
