from django.utils import timezone
from api.v1.v1_data.models import FormData
from django.conf import settings
from api.v1.v1_visualization.constants import MATERIALIZED_VIEWS
from api.v1.v1_visualization.functions import refresh_materialized_data


NON_CONCURRENT_REFRESH_VIEWS = {"view_data_options"}


def refresh_mv_concurrency():
    """
    This function is designed to be called
    asynchronously after a direct update to FormData.
    It checks if the environment is a test environment and
    refreshes the materialized views accordingly,
    using concurrency in non-test environments for better performance.

    view_data_options is intentionally refreshed without CONCURRENTLY:
    its materialized view does not have a full unique index, so asking
    PostgreSQL for a concurrent refresh only produces a noisy fallback
    warning on every data update.
    """
    if settings.TEST_ENV:
        refresh_materialized_data(concurrent=False)
        return

    concurrent_views = [
        view for view in MATERIALIZED_VIEWS
        if view not in NON_CONCURRENT_REFRESH_VIEWS
    ]
    regular_views = [
        view for view in MATERIALIZED_VIEWS
        if view in NON_CONCURRENT_REFRESH_VIEWS
    ]

    if concurrent_views:
        refresh_materialized_data(
            views=concurrent_views, concurrent=True
        )
    if regular_views:
        refresh_materialized_data(
            views=regular_views, concurrent=False
        )


def generate_data_as_json(data: FormData):
    if not data.form.parent and not settings.TEST_ENV:
        # If the form is a parent form, save to file
        data.save_to_file


def seed_approved_data(data: FormData):
    """
    Update FormData object from pending status to approved status
    """
    # No need to create new data, just update existing FormData
    data.updated = timezone.now()
    data.is_pending = False
    data.save()
    # Save to file after approval
    generate_data_as_json(data=data)
    # Refresh materialized view after saving data
    refresh_mv_concurrency()

    return data
