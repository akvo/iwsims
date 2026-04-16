from drf_spectacular.utils import OpenApiExample

VALUES_EXAMPLES = [
    OpenApiExample(
        name="Count Mode — no grouping",
        summary="Total count; no question_id, no group_by",
        description=(
            "Request: ?form_id=6001\n"
            "Returns a single aggregate row. `labels` is always"
            " ['Total']."
        ),
        value={
            "data": [{"value": 150, "label": "Total"}],
            "labels": ["Total"],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="Count Mode — grouped by month",
        summary="Submissions per month",
        description=(
            "Request: ?form_id=6001&group_by=month. Each row has a"
            " machine-readable `group` (YYYY-MM) and a human"
            " `label`. Zero-filled if from_date and to_date set."
        ),
        value={
            "data": [
                {
                    "value": 12,
                    "label": "Jan 2025",
                    "group": "2025-01",
                },
                {
                    "value": 8,
                    "label": "Feb 2025",
                    "group": "2025-02",
                },
            ],
            "labels": ["Jan 2025", "Feb 2025"],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="Option Donut — group_by=option",
        summary="Option breakdown with color and zero-rows",
        description=(
            "Request: ?form_id=6002&question_id=600203"
            "&group_by=option. Every defined option is returned,"
            " including zero-count options (legend stability)."
            " `color` comes from QuestionOptions.color."
        ),
        value={
            "data": [
                {
                    "value": 5,
                    "label": "Active",
                    "group": "active",
                    "color": "#64A73B",
                },
                {
                    "value": 0,
                    "label": "Inactive",
                    "group": "inactive",
                    "color": "#e41a1c",
                },
            ],
            "labels": ["Active", "Inactive"],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="Option Percentage",
        summary="Donut with value_type=percentage",
        description=(
            "Slice values expressed as percentages summing to 100."
        ),
        value={
            "data": [
                {
                    "value": 66.67,
                    "label": "Active",
                    "group": "active",
                    "color": "#64A73B",
                },
                {
                    "value": 33.33,
                    "label": "Inactive",
                    "group": "inactive",
                    "color": "#e41a1c",
                },
            ],
            "labels": ["Active", "Inactive"],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="KPI — filtered by option_value",
        summary="Single-number KPI for a specific option",
        description=(
            "Request: ?form_id=6002&question_id=600203"
            "&option_value=active. Returns a one-row count or"
            " percentage."
        ),
        value={
            "data": [{"value": 42, "label": "active"}],
            "labels": ["active"],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="Stacked Bar — stack_by=option",
        summary="Operational status per month, stacked",
        description=(
            "Request: ?form_id=6002&question_id=600203"
            "&group_by=month&stack_by=option&monitoring=all."
            " Each row carries one column per option;"
            " `stack_labels` + `colors` drive the legend."
        ),
        value={
            "data": [
                {
                    "group": "2025-01",
                    "label": "Jan 2025",
                    "Active": 3,
                    "Inactive": 1,
                },
                {
                    "group": "2025-02",
                    "label": "Feb 2025",
                    "Active": 5,
                    "Inactive": 2,
                },
            ],
            "labels": ["Jan 2025", "Feb 2025"],
            "stack_labels": ["Active", "Inactive"],
            "colors": ["#64A73B", "#e41a1c"],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="Multi-line — stack_by=parent_id",
        summary="Number question per parent over time",
        description=(
            "Request: ?form_id=6002&question_id=600202"
            "&group_by=month&stack_by=parent_id. Each row is a"
            " month; each parent's name becomes a column."
            " `stack_labels` lists the parents."
        ),
        value={
            "data": [
                {
                    "month": "Jan 2025",
                    "Site Alpha": 10.0,
                    "Site Beta": 30.0,
                },
                {
                    "month": "Feb 2025",
                    "Site Alpha": 12.5,
                    "Site Beta": 28.0,
                },
            ],
            "labels": ["Jan 2025", "Feb 2025"],
            "stack_labels": ["Site Alpha", "Site Beta"],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="Validation error",
        summary="400 for malformed criteria / missing form",
        value={
            "message": (
                "Invalid criteria type: 'option_matches'."
            ),
        },
        response_only=True,
        status_codes=["400"],
    ),
]

ESCALATION_EXAMPLES = [
    OpenApiExample(
        name="Escalated sites — inactive",
        summary="Paginated table with criteria + columns",
        description=(
            "Request: ?monitoring_form_id=6002"
            "&criteria=option_equals:600203:inactive"
            "&columns=name:parent_name,status:answer:600203"
            ",date:latest_date:600201."
            " Column keys in `results[]` follow the request spec."
        ),
        value={
            "count": 2,
            "next": (
                "?monitoring_form_id=6002"
                "&criteria=option_equals:600203:inactive"
                "&page=2"
            ),
            "previous": None,
            "results": [
                {
                    "id": 7200,
                    "name": "Site Alpha",
                    "status": "inactive",
                    "date": "2025-03-10",
                },
                {
                    "id": 7201,
                    "name": "Site Beta",
                    "status": "inactive",
                    "date": "2025-03-15",
                },
            ],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="Overdue criterion",
        summary="overdue:completion_qid:deadline_qid",
        description=(
            "Incomplete and past deadline, with admin column."
        ),
        value={
            "count": 1,
            "next": None,
            "previous": None,
            "results": [
                {
                    "id": 7201,
                    "name": "Site Beta",
                    "admin": "Fiji / Central / Suva",
                    "status": "no",
                },
            ],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="Empty page",
        summary="No records match the criteria",
        value={
            "count": 0,
            "next": None,
            "previous": None,
            "results": [],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="Validation error",
        summary="400 for missing/malformed criteria or columns",
        value={
            "message": (
                "Invalid criteria format: 'option_equals:600203'."
                " Expected type:qid:value"
            ),
        },
        response_only=True,
        status_codes=["400"],
    ),
]

PROGRESS_EXAMPLES = [
    OpenApiExample(
        name="Construction progress — two EPSes",
        summary="Histogram + per-EPS component scores",
        description=(
            "Request: ?monitoring_form_id=6002"
            "&components=base:any_yes:111:222,"
            "pipes:ratio:555:556."
            " `histogram` always has 10 buckets (10% bins)."
            " `details[*].components` keys follow the"
            " component `key` names from the request."
        ),
        value={
            "histogram": [
                {"progress": "0-10%", "count": 0},
                {"progress": "11-20%", "count": 0},
                {"progress": "21-30%", "count": 0},
                {"progress": "31-40%", "count": 0},
                {"progress": "41-50%", "count": 1},
                {"progress": "51-60%", "count": 0},
                {"progress": "61-70%", "count": 0},
                {"progress": "71-80%", "count": 0},
                {"progress": "81-90%", "count": 1},
                {"progress": "91-100%", "count": 0},
            ],
            "details": [
                {
                    "label": "Site Alpha",
                    "group": "7200",
                    "components": {
                        "base": 100.0,
                        "pipes": 75.0,
                    },
                    "overall": 87.5,
                },
                {
                    "label": "Site Beta",
                    "group": "7201",
                    "components": {
                        "base": 0.0,
                        "pipes": 100.0,
                    },
                    "overall": 50.0,
                },
            ],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="No matching records",
        summary="Empty details + all-zero histogram",
        value={
            "histogram": [
                {"progress": f"{b}%", "count": 0}
                for b in [
                    "0-10", "11-20", "21-30", "31-40", "41-50",
                    "51-60", "61-70", "71-80", "81-90", "91-100",
                ]
            ],
            "details": [],
        },
        response_only=True,
    ),
    OpenApiExample(
        name="Validation error",
        summary="400 for missing/invalid components or criteria",
        value={
            "message": (
                "Invalid formula: 'bogus_formula'."
                " Options: ['any_yes', 'completed_binary',"
                " 'multi_select_proportion', 'ratio']"
            ),
        },
        response_only=True,
        status_codes=["400"],
    ),
]
