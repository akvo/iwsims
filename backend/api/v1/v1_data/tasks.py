from django.utils import timezone
from api.v1.v1_data.models import FormData
from django.conf import settings
from api.v1.v1_visualization.functions import refresh_materialized_data


def seed_approved_data(data: FormData):
    """
    Update FormData object from pending status to approved status
    """
    # No need to create new data, just update existing FormData
    data.updated = timezone.now()
    data.is_pending = False
    data.save()

    # Save to file after approval
    if not data.form.parent and not settings.TEST_ENV:
        # If the form is a parent form, save to file
        data.save_to_file
    # Refresh materialized view after saving data
    concurrency = not settings.TEST_ENV
    refresh_materialized_data(concurrent=concurrency)

    return data
