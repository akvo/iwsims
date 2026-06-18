# Materialized Views Reference

This document describes the structure and contents of each materialized view. Use this as a reference when writing queries or debugging.

---

## 1. mv_latest_monitoring

**Purpose**: Pre-computes the latest monitoring submission for each parent registration per form.

**Replaces**: The expensive correlated subquery in `latest_monitoring_subquery()`.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `latest_data_id` | BIGINT (PK) | ID of the latest monitoring submission |
| `parent_id` | BIGINT | ID of the parent registration (FormData.id) |
| `form_id` | BIGINT | Monitoring form ID |
| `form_name` | TEXT | Name of the monitoring form |
| `administration_id` | BIGINT | Administration of the monitoring submission |
| `parent_administration_id` | BIGINT | Administration of the parent registration |
| `created` | TIMESTAMP | When the monitoring was submitted |
| `data_name` | TEXT | Name/label of the monitoring submission |
| `parent_name` | TEXT | Name/label of the parent registration |

### Indexes

- `idx_mv_latest_pk` (UNIQUE): `(parent_id, form_id)`
- `idx_mv_latest_form`: `(form_id)`
- `idx_mv_latest_admin`: `(administration_id)`
- `idx_mv_latest_parent_admin`: `(parent_administration_id)`

### Example Data

```
latest_data_id | parent_id | form_id | form_name          | created             | parent_name
---------------+-----------+---------+--------------------+---------------------+------------------
1001           | 500       | 10      | Monthly Monitoring | 2024-06-10 08:30:00 | Water Point Alpha
1002           | 501       | 10      | Monthly Monitoring | 2024-06-09 14:15:00 | Water Point Beta
1003           | 500       | 11      | Quality Testing    | 2024-06-08 10:00:00 | Water Point Alpha
```

### Example Queries

```sql
-- Get latest monitoring for a specific form
SELECT * FROM mv_latest_monitoring WHERE form_id = 10;

-- Get latest monitoring for a specific parent
SELECT * FROM mv_latest_monitoring WHERE parent_id = 500;

-- Get all parents with their latest monitoring in an administration
SELECT * FROM mv_latest_monitoring
WHERE form_id = 10 AND parent_administration_id = 5;

-- Count of monitored parents per form
SELECT form_id, form_name, COUNT(*) as monitored_count
FROM mv_latest_monitoring
GROUP BY form_id, form_name;
```

### Django ORM Usage

```python
from api.v1.v1_visualization.models import MVLatestMonitoring

# Get latest monitoring data IDs for a form
data_ids = list(
    MVLatestMonitoring.objects
    .filter(form_id=10)
    .values_list('latest_data_id', flat=True)
)

# Filter by administration
qs = MVLatestMonitoring.objects.filter(
    form_id=10,
    parent_administration_id__in=[5, 6, 7]
)
```

---

## 2. mv_answer_denormalized

**Purpose**: Pre-joins answers with form data and question metadata. Includes `question_name` for cross-form queries.

**Replaces**: Multiple JOIN operations between `answer`, `data`, and `question` tables.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `answer_id` | BIGINT (PK) | Original answer ID |
| `data_id` | BIGINT | FormData ID this answer belongs to |
| `question_id` | BIGINT | Question ID |
| `question_name` | TEXT | Question name/identifier (e.g., "ph", "turbidity") |
| `question_type` | INT | Question type (4=number, 5=option, 6=multiple_option) |
| `answer_name` | TEXT | Text/date answer value |
| `answer_value` | FLOAT | Numeric answer value |
| `answer_options` | JSONB | Selected option values `["yes"]` or `["a", "b"]` |
| `answer_index` | INT | Repeat group index (0 for non-repeating) |
| `form_id` | BIGINT | Form ID |
| `parent_id` | BIGINT | Parent registration ID (NULL for registrations) |
| `administration_id` | BIGINT | Administration ID |
| `data_created` | TIMESTAMP | When the submission was created |

### Indexes

- `idx_mv_answer_pk` (UNIQUE): `(answer_id)`
- `idx_mv_answer_data`: `(data_id)`
- `idx_mv_answer_question`: `(question_id)`
- `idx_mv_answer_form_question`: `(form_id, question_id)`
- `idx_mv_answer_parent`: `(parent_id)` WHERE parent_id IS NOT NULL
- `idx_mv_answer_question_name`: `(question_name)`
- `idx_mv_answer_options`: GIN index on `(answer_options)`

### Example Data

```
answer_id | data_id | question_id | question_name | question_type | answer_value | answer_options
----------+---------+-------------+---------------+---------------+--------------+----------------
5001      | 1001    | 201         | ph            | 4             | 7.2          | NULL
5002      | 1001    | 202         | turbidity     | 4             | 3.5          | NULL
5003      | 1001    | 203         | water_source  | 5             | NULL         | ["borehole"]
5004      | 1001    | 204         | issues        | 6             | NULL         | ["leakage", "low_pressure"]
```

### Example Queries

```sql
-- Get all pH answers for a form
SELECT parent_id, answer_value, data_created
FROM mv_answer_denormalized
WHERE form_id = 10 AND question_name = 'ph';

-- Find submissions with specific option selected
SELECT DISTINCT data_id, parent_id
FROM mv_answer_denormalized
WHERE answer_options @> '["functional"]';

-- Get latest answers for a question across all monitoring
SELECT DISTINCT ON (parent_id)
    parent_id, answer_value, data_created
FROM mv_answer_denormalized
WHERE question_name = 'ph'
ORDER BY parent_id, data_created DESC;

-- Count submissions by option value
SELECT
    jsonb_array_elements_text(answer_options) as option_value,
    COUNT(DISTINCT parent_id) as parent_count
FROM mv_answer_denormalized
WHERE question_id = 203
GROUP BY option_value;
```

### Django ORM Usage

```python
from api.v1.v1_visualization.models import MVAnswerDenormalized

# Get all pH values for monitoring form
ph_answers = MVAnswerDenormalized.objects.filter(
    form_id=10,
    question_name='ph',
    answer_value__isnull=False
).values('parent_id', 'answer_value', 'data_created')

# Filter by option contains
functional = MVAnswerDenormalized.objects.filter(
    question_id=203,
    answer_options__contains=['functional']
).values_list('data_id', flat=True)
```

---

## 3. mv_cross_form_latest

**Purpose**: Aggregates the latest value for each `(parent_id, question_name)` across ALL monitoring forms.

**Use Case**: When a registration has multiple monitoring forms (e.g., "Quick Monitoring" + "Comprehensive Monitoring") that share question names like "ph", this view returns the most recent value regardless of which form it came from.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGINT (PK) | Row ID (auto-generated) |
| `parent_id` | BIGINT | Parent registration ID |
| `parent_form_id` | BIGINT | Registration form the parent belongs to (`parent.form_id`). Filter by this to scope a `question_name` query to one registration family; omit for a national / cross-family overview |
| `administration_id` | BIGINT | Administration of the latest submission |
| `question_name` | TEXT | Question name/identifier |
| `question_type` | INT | Question type |
| `latest_text_value` | TEXT | Latest text/date answer |
| `latest_numeric_value` | FLOAT | Latest numeric answer |
| `latest_option_values` | JSONB | Latest selected options |
| `latest_created` | TIMESTAMP | When the latest answer was submitted |

### Indexes

- `idx_mv_cross_form_pk` (UNIQUE): `(id)`
- `idx_mv_cross_form_parent_qname`: `(parent_id, question_name)`
- `idx_mv_cross_form_parent_form_qname`: `(parent_form_id, question_name)`
- `idx_mv_cross_form_qname`: `(question_name)`
- `idx_mv_cross_form_admin`: `(administration_id)`

### Example Data

Consider this scenario:
- Parent "Water Point Alpha" (id=500) has two monitoring forms
- Quick Monitoring (June 1): ph = 7.2
- Comprehensive Monitoring (June 10): ph = 7.5, e_coli = 0

```
id  | parent_id | question_name | question_type | latest_numeric_value | latest_created
----+-----------+---------------+---------------+----------------------+---------------------
1   | 500       | ph            | 4             | 7.5                  | 2024-06-10 10:00:00
2   | 500       | e_coli        | 4             | 0                    | 2024-06-10 10:00:00
3   | 500       | status        | 5             | NULL                 | 2024-06-10 10:00:00
```

Note: `ph` shows 7.5 from Comprehensive (June 10), not 7.2 from Quick (June 1).

### Example Queries

```sql
-- Get latest pH for all parents
SELECT parent_id, latest_numeric_value as ph, latest_created
FROM mv_cross_form_latest
WHERE question_name = 'ph';

-- Get latest status across all parents
SELECT parent_id, latest_option_values as status
FROM mv_cross_form_latest
WHERE question_name = 'status';

-- Compare multiple water quality params
SELECT
    parent_id,
    MAX(CASE WHEN question_name = 'ph' THEN latest_numeric_value END) as ph,
    MAX(CASE WHEN question_name = 'turbidity' THEN latest_numeric_value END) as turbidity,
    MAX(CASE WHEN question_name = 'e_coli' THEN latest_numeric_value END) as e_coli
FROM mv_cross_form_latest
WHERE question_name IN ('ph', 'turbidity', 'e_coli')
GROUP BY parent_id;

-- Find parents where latest pH is out of range
SELECT parent_id, latest_numeric_value as ph
FROM mv_cross_form_latest
WHERE question_name = 'ph'
  AND (latest_numeric_value < 6.5 OR latest_numeric_value > 8.5);
```

### Django ORM Usage

```python
from api.v1.v1_visualization.models import MVCrossFormLatest

# Family-scoped: latest pH only for parents of ONE registration form
# (e.g. EPS family 1749623934933 -> only its monitoring forms contribute)
latest_ph_eps = MVCrossFormLatest.objects.filter(
    question_name='ph',
    parent_form_id=1749623934933,
).values('parent_id', 'latest_numeric_value', 'latest_created')

# National / cross-family overview: omit parent_form_id to span every family
latest_ph_national = MVCrossFormLatest.objects.filter(
    question_name='ph'
).values('parent_id', 'latest_numeric_value', 'latest_created')

# Get parents with functional status
functional_parents = MVCrossFormLatest.objects.filter(
    question_name='status',
    latest_option_values__contains=['functional']
).values_list('parent_id', flat=True)
```

---

## 4. mv_parent_aggregates

**Purpose**: Pre-aggregates answer data per `(parent_id, form_id, question_id)` from the latest monitoring submission.

**Replaces**: The N+1 query pattern in `_stack_option_by_parent()`.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGINT (PK) | Row ID (auto-generated) |
| `parent_id` | BIGINT | Parent registration ID |
| `form_id` | BIGINT | Monitoring form ID |
| `administration_id` | BIGINT | Administration ID |
| `question_id` | BIGINT | Question ID |
| `question_name` | TEXT | Question name/identifier |
| `question_type` | INT | Question type |
| `option_values` | JSONB | All selected option values (for type 5, 6) |
| `avg_value` | FLOAT | Average of numeric values (for type 4) |
| `sum_value` | FLOAT | Sum of numeric values (for type 4) |
| `max_value` | FLOAT | Maximum numeric value (for type 4) |
| `min_value` | FLOAT | Minimum numeric value (for type 4) |
| `answer_count` | INT | Number of answers (useful for repeat groups) |

### Indexes

- `idx_mv_parent_agg_pk` (UNIQUE): `(id)`
- `idx_mv_parent_agg_form_question`: `(form_id, question_id)`
- `idx_mv_parent_agg_parent`: `(parent_id)`
- `idx_mv_parent_agg_admin`: `(administration_id)`
- `idx_mv_parent_agg_question_name`: `(question_name)`

### Example Data

```
id | parent_id | form_id | question_id | question_name | question_type | option_values        | avg_value | answer_count
---+-----------+---------+-------------+---------------+---------------+----------------------+-----------+--------------
1  | 500       | 10      | 201         | ph            | 4             | NULL                 | 7.2       | 1
2  | 500       | 10      | 203         | water_source  | 5             | ["borehole"]         | NULL      | 1
3  | 500       | 10      | 204         | issues        | 6             | ["leakage", "rust"]  | NULL      | 1
4  | 501       | 10      | 201         | ph            | 4             | NULL                 | 6.8       | 1
5  | 501       | 10      | 203         | water_source  | 5             | ["well"]             | NULL      | 1
```

### Example Queries

```sql
-- Count parents by water source option
SELECT
    opt.value as water_source,
    COUNT(DISTINCT parent_id) as parent_count
FROM mv_parent_aggregates,
     jsonb_array_elements_text(option_values) as opt(value)
WHERE form_id = 10 AND question_name = 'water_source'
GROUP BY opt.value;

-- Get average pH per administration
SELECT
    administration_id,
    AVG(avg_value) as avg_ph,
    COUNT(*) as parent_count
FROM mv_parent_aggregates
WHERE question_name = 'ph'
GROUP BY administration_id;

-- Stack data: count each option per parent (for stacked bar charts)
SELECT
    parent_id,
    question_id,
    option_values
FROM mv_parent_aggregates
WHERE form_id = 10 AND question_type IN (5, 6);

-- Find parents with specific issue
SELECT parent_id
FROM mv_parent_aggregates
WHERE question_name = 'issues'
  AND option_values @> '["leakage"]';
```

### Django ORM Usage

```python
from api.v1.v1_visualization.models import MVParentAggregates

# Get all option values for a question
agg_data = MVParentAggregates.objects.filter(
    form_id=10,
    question_id=203
).values('parent_id', 'option_values')

# Build option counts per parent
parent_options = {}
for row in agg_data:
    parent_options[row['parent_id']] = row['option_values'] or []

# Count specific option
leakage_count = MVParentAggregates.objects.filter(
    question_name='issues',
    option_values__contains=['leakage']
).count()
```

---

## Question Type Reference

| Type | Name | `answer_name` | `answer_value` | `answer_options` |
|------|------|---------------|----------------|------------------|
| 1 | input (text) | Has value | NULL | NULL |
| 2 | text (multiline) | Has value | NULL | NULL |
| 3 | date | Has value (ISO) | NULL | NULL |
| 4 | number | NULL | Has value | NULL |
| 5 | option (single) | NULL | NULL | `["value"]` |
| 6 | multiple_option | NULL | NULL | `["a", "b"]` |
| 7 | cascade | Has value | NULL | NULL |
| 8 | geo | Has value | NULL | NULL |
| 9 | photo | Has value (URL) | NULL | NULL |

---

## Relationships Between Views

```
                    ┌─────────────────────────┐
                    │   mv_latest_monitoring  │
                    │   (latest per parent)   │
                    └───────────┬─────────────┘
                                │ latest_data_id
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                  mv_answer_denormalized                      │
│              (all answers with metadata)                     │
└─────────────────────────────────────────────────────────────┘
        │                                           │
        │ GROUP BY parent_id, question_name         │ GROUP BY parent_id, form_id, question_id
        ▼                                           ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│  mv_cross_form_latest   │         │   mv_parent_aggregates  │
│ (latest across forms)   │         │   (per-form aggregates) │
└─────────────────────────┘         └─────────────────────────┘
```

**When to use which view:**

| Use Case | View |
|----------|------|
| Get latest monitoring data IDs for a form | `mv_latest_monitoring` |
| Filter answers by criteria | `mv_answer_denormalized` |
| Query by question name across forms | `mv_cross_form_latest` |
| Build stacked charts per parent | `mv_parent_aggregates` |
