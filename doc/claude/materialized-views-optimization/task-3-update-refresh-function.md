# Task 3: Update Refresh Function for All Materialized Views

## Overview

Update the `refresh_materialized_data()` function to refresh all 5 materialized views (1 existing + 4 new). Add logging and support for concurrent refresh.

## File to Modify

**Path**: `backend/api/v1/v1_visualization/functions.py`

## Current State (lines 1-21)

```python
from django.db import transaction, connection
from django.db.models import (
    Q, Subquery, OuterRef,
)
from datetime import datetime as dt_datetime, timedelta, date
from rest_framework.exceptions import ValidationError

from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_forms.models import Questions
from api.v1.v1_profile.models import Administration


@transaction.atomic
def refresh_materialized_data():
    with connection.cursor() as cursor:
        cursor.execute(
            """
            REFRESH MATERIALIZED VIEW view_data_options;
            """
        )
```

## Updated Code

Replace the imports and `refresh_materialized_data` function (lines 1-21) with:

```python
import logging

from django.db import transaction, connection
from django.db.models import (
    Q, Subquery, OuterRef,
)
from datetime import datetime as dt_datetime, timedelta, date
from rest_framework.exceptions import ValidationError

from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_forms.models import Questions
from api.v1.v1_profile.models import Administration


logger = logging.getLogger(__name__)

# All materialized views managed by this module
MATERIALIZED_VIEWS = [
    'mv_latest_monitoring',
    'mv_answer_denormalized',
    'mv_cross_form_latest',
    'mv_parent_aggregates',
    'view_data_options',
]


@transaction.atomic
def refresh_materialized_data(views=None, concurrent=False):
    """Refresh materialized views.

    Args:
        views: List of view names to refresh. If None, refreshes all.
        concurrent: If True, uses REFRESH CONCURRENTLY (non-blocking).
                   Requires unique index on the view.

    Example:
        # Refresh all views
        refresh_materialized_data()

        # Refresh specific views
        refresh_materialized_data(views=['mv_latest_monitoring'])

        # Non-blocking refresh (for production)
        refresh_materialized_data(concurrent=True)
    """
    views_to_refresh = views or MATERIALIZED_VIEWS
    concurrently = "CONCURRENTLY" if concurrent else ""

    with connection.cursor() as cursor:
        for view in views_to_refresh:
            try:
                sql = f"REFRESH MATERIALIZED VIEW {concurrently} {view};"
                cursor.execute(sql)
                logger.info(f"Refreshed materialized view: {view}")
            except Exception as e:
                logger.error(f"Failed to refresh {view}: {e}")
                # If concurrent refresh fails, try regular refresh
                if concurrent:
                    try:
                        cursor.execute(f"REFRESH MATERIALIZED VIEW {view};")
                        logger.info(
                            f"Refreshed {view} (fallback to non-concurrent)"
                        )
                    except Exception as e2:
                        logger.error(
                            f"Fallback refresh also failed for {view}: {e2}"
                        )
                        raise
                else:
                    raise
```

## Additional: Ensure Refresh is Called After Data Approval

Check that `refresh_materialized_data()` is called in the data approval flow.

**File**: `backend/api/v1/v1_data/tasks.py`

Look for `seed_approved_data()` function - it should already call `refresh_materialized_data()`. Verify this exists:

```python
from api.v1.v1_visualization.functions import refresh_materialized_data

def seed_approved_data(...):
    # ... existing code ...

    # At the end of the function:
    refresh_materialized_data()
```

If not present, add the call at the end of `seed_approved_data()`.

## Verification

1. Test refresh function manually:
   ```bash
   ./dc.sh exec backend python manage.py shell
   ```

   ```python
   from api.v1.v1_visualization.functions import refresh_materialized_data

   # Test all views
   refresh_materialized_data()

   # Test concurrent refresh
   refresh_materialized_data(concurrent=True)

   # Test specific view
   refresh_materialized_data(views=['mv_latest_monitoring'])
   ```

2. Check logs:
   ```bash
   ./dc.sh logs backend | grep "Refreshed materialized view"
   ```

3. Verify data is fresh after form submission approval:
   ```sql
   -- Check when views were last refreshed (implicit via data timestamps)
   SELECT MAX(created) FROM mv_latest_monitoring;
   ```

## Performance Notes

- **Regular refresh**: Locks the view for reads during refresh. Fast for small datasets.
- **Concurrent refresh**: No lock, but requires unique index. Slightly slower but production-safe.
- Views are refreshed in order; `mv_latest_monitoring` should refresh first as others may depend on similar data patterns.

## Dependencies

- Requires Task 1 (migration) to be completed first
