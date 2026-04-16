from django.db import migrations


class Migration(migrations.Migration):
    """Pattern-ops index on administrator.path for startswith scans.

    apply_administration_filter uses administration__path__startswith
    to match every descendant. On Postgres, prefix LIKE can only use a
    btree if the index is declared with text_pattern_ops (the default
    collation-aware operator class can't answer prefix matches from
    the index).
    """

    atomic = False

    dependencies = [
        ("v1_profile", "0004_rolefeatureaccess"),
    ]

    operations = [
        migrations.RunSQL(
            sql=(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
                "idx_administrator_path_pattern "
                "ON administrator (path text_pattern_ops);"
            ),
            reverse_sql=(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "idx_administrator_path_pattern;"
            ),
        ),
    ]
