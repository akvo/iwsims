# Site Profile — Snippet Code (Review Before Implementation)

> Companion to [`dashboard-visualization-site-profile.md`](./dashboard-visualization-site-profile.md).
> **Status: SNIPPETS for review — not yet wired into the app.** Updated to the final
> decisions: friendly widget names, form-driven pills, config-driven thresholds,
> `records`→`submissions[]`, prototype-aware table columns, no `default.json`.
>
> ```
> WWTP config (1748903240763.json)
>   → GET /api/v1/visualization/site-profile/{parent_id}?questions=&history=&records=
>     → ProfileRenderer
>       Infrastructure → assessment + tags + field_list
>       Effluent       → compliance + trend
>       Risks          → risks
>       Inspection     → record_table  [from submissions[]]
> ```
>
> `metric` renders compact latest-value KPI tiles from the prototype (for example
> WWTP Latest BOD, Pump Station Status). `photo` renders real image fields with AntD
> `<Image />`. `risks` matches the prototype's Risk / Severity / Recommended Action /
> Recurring shape, but the last two columns are optional per config. The risk-score
> `custom` widget reuses the dashboard's existing per-form compliance rules (design
> D-11, Option A) — no invented formula.

**Friendly chart_type vocabulary** (renderer dispatch keys):
`tabs` · `field_list` · `record_table` · `assessment` · `compliance` · `tags` ·
`trend` · `metric` · `risks` · `heading` · `photo` · `custom`.

**Photo naming note**: form definitions use `type: "photo"` for photo questions, and
profile configs use `chart_type: "photo"` for the widget that renders those answers.
Keep both names aligned; the context distinguishes input type vs renderer type.

**Photo audit from real prod forms** (`backend/source/forms/*.prod.json`):

| Asset | Registration form photo | Monitoring photo pattern |
|---|---|---|
| WWTP (`1748903240763`) | `plant_photo` | Quick monitoring also has `plant_photo`; full monitoring has many component photos plus repeatable `inspection_photo` |
| WTP (`1749634736797`) | none | Sampling/CBT photos, treatment-risk photos, reservoir/generator photos, repeatable `inspection_photo` |
| Pump (`1749611049520`) | `pump_station_photo` | Quick monitoring has `pump_station_photo`; monitoring has repeatable `inspection_photo` |
| EPS (`1749623934933`) | none | Project/construction photos, water-quality `eps_photo`, repeatable photo groups |
| RWP (`1749621221728`) | none | Component photos (`rainwater_harvesting_tank_photo`, `dam_photo`, `reservoir_photo`, etc.) and repeatable `infrastructure_photo` |

So the prototype's hero photo is not a guaranteed field. Use `chart_type: "photo"`
only when the profile config names a real photo question, and use `questions[]` when
an asset needs a fallback order.

**Prototype precision pass (`index.html`)**:

| Prototype area | Precise widget shape |
|---|---|
| Site hero | Separate profile header: name, location, meta chips, optional `photo`, status badge. This is not a generic metric grid. |
| Infrastructure Assessment | `assessment`: fixed columns `Component`, `Condition`, optional `Photo`, optional `Notes`. |
| Treatment Processes in Use | `tags`: pills from one multiple-option question. |
| Staff & OHS / Maintenance Programs | `field_list`: label/value rows with no visible header, using `rows[]` for display labels. |
| Latest Effluent Test | `compliance`: fixed columns `Parameter`, `Result`, `Threshold`, `Status`, with a verdict note. |
| BOD / COD / TDS charts | `trend`: line charts over history, with optional threshold line. |
| Operational Risks | `risks`: fixed columns `Risk`, `Severity`, optional `Recommended Action`, optional `Recurring?`. |
| Recommendations | Present in prototype, intentionally not part of this slice unless product confirms action lists should become scope. |
| Inspection History | `record_table`: configurable columns matching `Date`, `Inspector`, `Status`, `Issues Raised`, `Resolved?`. |

The 5 bespoke configs already exist under `frontend/src/config/site-profiles/` (one per
asset, **no `default.json`**). The MVs (`mv_cross_form_latest`, `mv_answer_denormalized`)
and their unmanaged models (`MVCrossFormLatest`, `MVAnswerDenormalized`) already exist —
**no migration**.

---

## Part 1 — Backend (`backend/api/v1/v1_visualization/`)

### 1.1 Serializer — query-param validation

> Append to `serializers.py`. Mirrors `FormulaValuesSerializer` (plain `Serializer`,
> comma-separated query fields parsed in `validate`).

```python
# serializers.py  (append)

class SiteProfileQuerySerializer(serializers.Serializer):
    parent_form_id = serializers.IntegerField(required=True)
    questions = serializers.CharField(required=False, allow_blank=True)  # latest{} filter
    history = serializers.CharField(required=False, allow_blank=True)    # time series
    records = serializers.CharField(required=False, allow_blank=True)    # per-submission

    def _question_name_list(self, value):
        if not value:
            return []
        return [v.strip() for v in value.split(",") if v.strip()]

    def validate(self, attrs):
        attrs["questions"] = self._question_name_list(attrs.get("questions"))
        attrs["history"] = self._question_name_list(attrs.get("history"))
        attrs["records"] = self._question_name_list(attrs.get("records"))
        return attrs
```

### 1.2 View — `SiteProfileDetailView`

> Append to `views.py`. `latest{}` ← `mv_cross_form_latest` (cross-form latest per
> `question_name`). `history{}` ← `mv_answer_denormalized` ascending. `submissions[]` ←
> `mv_answer_denormalized` grouped by `data_id`, newest first (only when `records=`).

```python
# views.py  (append — imports already present: MVCrossFormLatest, MVAnswerDenormalized,
#            APIView, Response, status, get_object_or_404, extend_schema, OpenApiParameter,
#            OpenApiTypes, FormData, validate_serializers_message)

class SiteProfileDetailView(APIView):
    # Control-center route auth already governs this page (design D-7); no extra gate.

    @extend_schema(
        tags=["Visualization"],
        summary="Per-site profile payload (latest + history + submissions)",
        parameters=[
            OpenApiParameter("parent_form_id", OpenApiTypes.NUMBER, OpenApiParameter.QUERY, required=True),
            OpenApiParameter("questions", OpenApiTypes.STR, OpenApiParameter.QUERY, required=False,
                             description="Comma-separated question_name list; omit = all latest"),
            OpenApiParameter("history", OpenApiTypes.STR, OpenApiParameter.QUERY, required=False,
                             description="Comma-separated question_name list to return as time series"),
            OpenApiParameter("records", OpenApiTypes.STR, OpenApiParameter.QUERY, required=False,
                             description="Comma-separated question_name list to return per submission"),
        ],
    )
    def get(self, request, parent_id, version):
        serializer = SiteProfileQuerySerializer(data=request.GET)
        if not serializer.is_valid():
            return Response(
                {"message": validate_serializers_message(serializer.errors)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        p = serializer.validated_data
        parent_form_id = p["parent_form_id"]

        point = get_object_or_404(
            FormData, pk=parent_id,
            is_pending=False, is_draft=False, parent__isnull=True,
        )

        # latest{} ── one cross-form latest value per question_name for this site.
        # Includes photo answers (`type: "photo"`) and free-text notes, so `assessment` reads
        # latest[question] + latest[photo] + latest[notes] per row.
        latest_qs = MVCrossFormLatest.objects.filter(
            parent_id=parent_id, parent_form_id=parent_form_id,
        )
        if p["questions"]:
            latest_qs = latest_qs.filter(question_name__in=p["questions"])
        latest = {}
        for row in latest_qs.values(
            "question_name", "question_type", "latest_text_value",
            "latest_numeric_value", "latest_option_values", "latest_created",
        ):
            latest[row["question_name"]] = {
                "question_name": row["question_name"],
                "type": row["question_type"],
                "name": row["latest_text_value"],
                "value": row["latest_numeric_value"],
                "options": row["latest_option_values"],
                "created": row["latest_created"],
            }

        # history{} ── numeric time series per question_name (ascending)
        history = {}
        if p["history"]:
            for r in (
                MVAnswerDenormalized.objects.filter(
                    parent_id=parent_id, question_name__in=p["history"],
                )
                .order_by("data_created")
                .values("question_name", "answer_value", "data_created")
            ):
                history.setdefault(r["question_name"], []).append(
                    {"date": r["data_created"], "value": r["answer_value"]}
                )

        # submissions[] ── one object per monitoring submission, newest first.
        # Duplicate question_name values can occur in repeatable groups (notably
        # photo questions). Preserve duplicates as arrays instead of overwriting.
        submissions = []
        if p["records"]:
            grouped = {}
            for r in (
                MVAnswerDenormalized.objects.filter(
                    parent_id=parent_id, question_name__in=p["records"],
                )
                .order_by("-data_created")
                .values(
                    "data_id", "data_created", "question_name",
                    "answer_name", "answer_value", "answer_options",
                    "answer_index",
                )
            ):
                entry = grouped.setdefault(
                    r["data_id"], {"data_id": r["data_id"], "date": r["data_created"], "answers": {}}
                )
                value = (
                    r["answer_options"] if r["answer_options"] is not None
                    else (r["answer_name"] if r["answer_name"] is not None else r["answer_value"])
                )
                existing = entry["answers"].get(r["question_name"])
                if existing is None:
                    entry["answers"][r["question_name"]] = value
                elif isinstance(existing, list):
                    existing.append(value)
                else:
                    entry["answers"][r["question_name"]] = [existing, value]
            submissions = sorted(grouped.values(), key=lambda e: e["date"], reverse=True)

        return Response(
            {
                "parent_id": point.id,
                "name": point.name,
                "latest": latest,
                "history": history,
                "submissions": submissions,
            },
            status=status.HTTP_200_OK,
        )
```

> **Open verify point**: `mv_answer_denormalized.parent_id` is the registration
> datapoint id for **monitoring** answers, but NULL for registration-form answers. WWTP
> trend/condition questions live on monitoring forms, so the `parent_id` filter is
> correct. Registration-form fields (Plant characteristics) need the `data_id = parent_id`
> branch — flagged in the design (D-4 note).

### 1.3 URL route

```python
# urls.py  (add to urlpatterns)
re_path(
    r"^(?P<version>(v1))/visualization/site-profile/(?P<parent_id>[0-9]+)",
    SiteProfileDetailView.as_view(),
),
```

### 1.4 Smoke test

```bash
# WWTP site id 500 — adjust to a real registration datapoint id in your DB
curl -s "http://localhost:8000/api/v1/visualization/site-profile/500\
?parent_form_id=1748903240763\
&questions=ground_conditions,treatment_processes,num_staff_at_plant\
&history=bod,chemical_oxygen_demand\
&records=inspection_date,dws_staff_name,has_final_recommendation" | python -m json.tool
```

### 1.5 Unit tests — `tests/test_site_profile.py`

> Endpoint tests should use small fixture data plus refreshed/materialized-view rows
> where possible. The assertions are on the response contract, not on frontend widget
> rendering.

#### Query validation

- `test_requires_parent_form_id`
  - Request omits `parent_form_id`.
  - Expect `400`.
  - Response message mentions `parent_form_id`.

- `test_rejects_non_numeric_parent_form_id`
  - Request passes `parent_form_id=abc`.
  - Expect `400`.

- `test_parses_comma_separated_question_name_lists`
  - Request passes whitespace and empty segments:
    `questions=bod, ph,, tds &history=bod,,ph&records=inspection_date, dws_staff_name`.
  - Expect the endpoint to behave as if the parsed lists were
    `["bod", "ph", "tds"]`, `["bod", "ph"]`, and
    `["inspection_date", "dws_staff_name"]`.

#### Parent datapoint lookup

- `test_returns_404_for_missing_parent_datapoint`
  - `parent_id` does not exist.
  - Expect `404`.

- `test_returns_404_for_child_monitoring_datapoint_as_parent_id`
  - `parent_id` points to a monitoring record (`parent__isnull=False`).
  - Expect `404`.

- `test_returns_404_for_pending_or_draft_parent_datapoint`
  - `parent_id` exists but is pending or draft.
  - Expect `404`.

#### Latest payload from `mv_cross_form_latest`

- `test_returns_latest_payload_for_parent_and_parent_form`
  - Fixture has two parent sites under the same registration form and latest rows for
    `bod`, `ph`, and `treatment_processes`.
  - Request one parent.
  - Expect only that parent's latest rows in `latest`.
  - Each `latest[name]` includes `question_name`, `type`, `name`, `value`,
    `options`, and `created`.

- `test_questions_filter_limits_latest_payload`
  - Request `questions=bod,ph`.
  - Expect `latest` contains only `bod` and `ph`, not other available latest rows.

- `test_omitting_questions_returns_all_latest_rows_for_site`
  - Request omits `questions`.
  - Expect all `mv_cross_form_latest` rows for the selected `parent_id` and
    `parent_form_id`.

- `test_parent_form_id_scopes_latest_rows`
  - Two registration families have a same-named question such as `ph`.
  - Request family A.
  - Expect family B rows are excluded even when `question_name` matches.

- `test_unknown_question_name_is_omitted_not_error`
  - Request `questions=bod,does_not_exist`.
  - Expect `200`, `latest.bod` present, `does_not_exist` absent.

#### History payload from `mv_answer_denormalized`

- `test_history_returns_time_series_ordered_ascending`
  - Fixture has three monitoring submissions for one parent with `bod`.
  - Request `history=bod`.
  - Expect `history.bod` dates sorted oldest → newest.

- `test_history_is_empty_when_history_param_omitted`
  - Request omits `history`.
  - Expect `history` is `{}` even when MV rows exist.

- `test_history_filter_limits_question_names`
  - Fixture has `bod` and `ph`.
  - Request `history=bod`.
  - Expect only `history.bod`.

#### Submissions payload from `mv_answer_denormalized`

- `test_records_returns_submissions_grouped_by_data_id_newest_first`
  - Fixture has two monitoring submissions with requested record fields.
  - Request `records=inspection_date,dws_staff_name`.
  - Expect one `submissions[]` entry per `data_id`, sorted newest → oldest.

- `test_records_maps_answer_options_before_answer_name_before_answer_value`
  - Fixture includes one option answer, one text answer, and one numeric answer.
  - Expect option values are used when present, otherwise text name, otherwise numeric value.

- `test_records_preserves_repeatable_question_duplicates_as_arrays`
  - Fixture has one monitoring submission with a repeatable photo group, e.g.
    two `inspection_photo` answers with different `answer_index` values.
  - Request `records=inspection_photo`.
  - Expect `submissions[0].answers.inspection_photo` is an array containing both
    photo URLs, not only the last row processed.

- `test_submissions_is_empty_when_records_param_omitted`
  - Request omits `records`.
  - Expect `submissions` is `[]`.

- `test_records_filter_limits_answers_inside_each_submission`
  - Fixture submission has more answers than requested.
  - Request `records=inspection_date`.
  - Expect each `answers` object contains only `inspection_date`.

#### Response contract

- `test_response_contains_parent_identity_and_sections`
  - Expect top-level keys: `parent_id`, `name`, `latest`, `history`,
    `submissions`.
  - `parent_id` equals the requested registration datapoint id.
  - `name` equals the parent datapoint name.

- `test_empty_mv_result_still_returns_empty_sections`
  - Parent datapoint exists but has no matching MV rows.
  - Expect `200` with `latest={}`, `history={}`, `submissions=[]`.

---

## Part 2 — Frontend (`frontend/src/`)

### 2.0 Directory structure

> Site Profile is mounted from `MonitoringDetail.jsx`, so the root component lives
> near the manage-data page instead of under dashboard custom components.

```text
frontend/src/
├── config/
│   └── site-profiles/
│       ├── index.js
│       ├── 1748903240763.json   # WWTP
│       ├── 1749611049520.json   # Pump
│       ├── 1749621221728.json   # RWP
│       ├── 1749623934933.json   # EPS
│       └── 1749634736797.json   # WTP
├── pages/
│   └── manage-data/
│       ├── MonitoringDetail.jsx
│       └── components/
│           └── profile/
│               ├── index.js              # barrel exports for root profile API
│               ├── ProfileHeader.jsx
│               ├── ProfileRenderer.jsx
│               ├── style.scss
│               ├── __test__/
│               │   ├── ProfileRenderer.test.jsx
│               │   └── siteProfileQueries.test.js
│               ├── lib/
│               │   ├── site-profile-queries.js
│               │   ├── use-site-profile.js
│               │   └── utils.js
│               └── widgets/
│                   ├── index.js          # barrel exports for widgets
│                   ├── AssessmentWidget.jsx
│                   ├── ComplianceWidget.jsx
│                   ├── FieldListWidget.jsx
│                   ├── MetricWidget.jsx
│                   ├── PhotoWidget.jsx
│                   ├── RecordTableWidget.jsx
│                   ├── RisksWidget.jsx
│                   ├── RiskScoreTrend.jsx
│                   ├── TagsWidget.jsx
│                   └── TrendWidget.jsx
└── components/
    └── dashboard/
        ├── widgets/
        │   ├── SectionTitleWidget.jsx  # reused by ProfileRenderer
        │   └── TabsWidget.jsx          # reused by ProfileRenderer
```

### 2.1 Registry — `config/site-profiles/index.js`

> One file per asset, keyed by `parent_form_id`. **No `default.json`** — EPS/RWP are
> their own files using the default layout. Lookup accepts more than one candidate id
> so callers can fall back from the route param to the fetched datapoint's form id
> without accidentally rendering the wrong asset profile.

```js
// config/site-profiles/index.js
import wwtpProfile from "./1748903240763.json";
import pumpProfile from "./1749611049520.json";
import rwpProfile from "./1749621221728.json";
import epsProfile from "./1749623934933.json";
import wtpProfile from "./1749634736797.json";

const siteProfiles = {
  [wwtpProfile.parent_form_id]: wwtpProfile,
  [pumpProfile.parent_form_id]: pumpProfile,
  [rwpProfile.parent_form_id]: rwpProfile,
  [epsProfile.parent_form_id]: epsProfile,
  [wtpProfile.parent_form_id]: wtpProfile,
};

const getProfileKey = (formId) => {
  if (formId === null || typeof formId === "undefined" || formId === "") {
    return null;
  }
  const key = String(formId);
  if (siteProfiles[key]) {
    return key;
  }
  return null;
};

export const getSiteProfileKey = (...formIds) =>
  formIds.map(getProfileKey).find(Boolean) || null;

export const getSiteProfileConfig = (...formIds) => {
  const key = getSiteProfileKey(...formIds);
  return key ? siteProfiles[key] : null;
};

export const hasSiteProfile = (...formIds) =>
  Boolean(getSiteProfileConfig(...formIds));

export default siteProfiles;
```

### 2.1a Profile barrel exports

> Public imports should come through the feature root or widget barrel, not individual
> component files.

```js
// pages/manage-data/components/profile/index.js
export { default as ProfileHeader } from "./ProfileHeader";
export { default as ProfileRenderer } from "./ProfileRenderer";
export { default as useSiteProfile } from "./lib/use-site-profile";
export { collectSiteProfileQueries } from "./lib/site-profile-queries";
```

```js
// pages/manage-data/components/profile/widgets/index.js
export { default as AssessmentWidget } from "./AssessmentWidget";
export { default as ComplianceWidget } from "./ComplianceWidget";
export { default as FieldListWidget } from "./FieldListWidget";
export { default as MetricWidget } from "./MetricWidget";
export { default as PhotoWidget } from "./PhotoWidget";
export { default as RecordTableWidget } from "./RecordTableWidget";
export { default as RisksWidget } from "./RisksWidget";
export { default as RiskScoreTrend } from "./RiskScoreTrend";
export { default as TagsWidget } from "./TagsWidget";
export { default as TrendWidget } from "./TrendWidget";
```

### 2.2 Profile lib helpers — name lookup + form-driven option pills

> Add to `pages/manage-data/components/profile/lib/utils.js`.
> `assessment`/`tags`/`risks` resolve each option answer's **label + color** from the
> live form definition (D-11 — pills are form-driven, not config-driven). Keep these
> helpers local to the profile feature; `text` still comes from `uiText[activeLang]`
> and is passed through `recordContext`.

```js
// pages/manage-data/components/profile/lib/utils.js
export const findQuestionByName = (name) => {
  if (!name) {
    return null;
  }
  const forms = window.forms || [];
  for (let i = 0; i < forms.length; i += 1) {
    const groups = forms[i]?.content?.question_group || [];
    for (let j = 0; j < groups.length; j += 1) {
      const found = (groups[j]?.question || []).find((q) => q?.name === name);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

// One option value → { label, color } from the question's option[] definitions.
export const resolveOption = (question, value) => {
  const opt = (question?.option || question?.options || []).find((o) => o?.value === value);
  return opt ? { label: opt.label || opt.value, color: opt.color || null } : { label: value, color: null };
};

// Coarse severity bucket from an option color (for risks + risk-score). Form palette:
//   green  #009b77 #64a73b #4a90e2 (good/satisfactory/yes)
//   amber  #efc050               (maintenance_in_progress/intermittent)
//   red    #dd4124 #e41a1c       (poor/not_available/no)
const SEVERITY_BY_COLOR = {
  "#009b77": "green", "#64a73b": "green", "#4a90e2": "green",
  "#efc050": "amber",
  "#dd4124": "red", "#e41a1c": "red", "#666666": "red",
};
export const optionSeverity = (color) =>
  color ? SEVERITY_BY_COLOR[String(color).toLowerCase()] || "neutral" : "neutral";

// AntD Tag color from severity
export const severityTagColor = (sev) =>
  ({ green: "green", amber: "gold", red: "red", neutral: "default" }[sev] || "default");

export const getText = (text, key, fallback = "") => {
  if (key && text?.[key]) {
    return text[key];
  }
  return fallback;
};
```

### 2.3 Query collector + data hook

> One request. Derives `questions` (latest answers), `history` (all `trend`
> questions), and `records` (per-submission answers for `custom` widgets and
> repeatable photo galleries) from the config tree.

```jsx
// pages/manage-data/components/profile/lib/site-profile-queries.js
export const collectSiteProfileQueries = (config) => {
  const query = { questions: [], history: [], records: [] };
  // Walk config.items recursively. `trend` -> history, `record_table` and
  // submission-backed `photo` -> records, all other question references -> latest.
  return query;
};
```

```jsx
// pages/manage-data/components/profile/lib/use-site-profile.js
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib";
import { collectSiteProfileQueries } from "./site-profile-queries";

const useSiteProfile = ({ parentId, parentFormId, config, enabled }) => {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const url = useMemo(() => {
    if (!parentId || !parentFormId || !config) {
      return null;
    }
    const query = collectSiteProfileQueries(config);
    const params = new URLSearchParams({ parent_form_id: parentFormId });
    if (query.questions.length) {
      params.set("questions", query.questions.join(","));
    }
    if (query.history.length) {
      params.set("history", query.history.join(","));
    }
    if (query.records.length) {
      params.set("records", query.records.join(","));
    }
    return `/visualization/site-profile/${parentId}?${params.toString()}`;
  }, [parentId, parentFormId, config]);

  useEffect(() => {
    if (!enabled || !url) {
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    api
      .get(url)
      .then((res) => !cancelled && setState({ data: res?.data || null, loading: false, error: null }))
      .catch((error) => !cancelled && setState({ data: null, loading: false, error }));

    return () => {
      cancelled = true;
    };
  }, [enabled, url]);

  return state;
};

export default useSiteProfile;
```

### 2.4a Profile header — `ProfileHeader.jsx`

> Mirrors the prototype's site hero above the tabs: optional site photo, name/location,
> configured meta rows, and a status badge. It is intentionally not a `metric` widget,
> because it frames the whole profile.

```jsx
// pages/manage-data/components/profile/ProfileHeader.jsx
import React from "react";
import PropTypes from "prop-types";
import { Card, Image, Tag, Typography } from "antd";
import { getText } from "./lib/utils";

const fmt = (entry) => {
  if (!entry) {
    return "—";
  }
  if (Array.isArray(entry.options) && entry.options.length) {
    return entry.options.join(", ");
  }
  if (entry.value !== null && typeof entry.value !== "undefined") {
    return String(entry.value);
  }
  return entry.name || "—";
};

const ProfileHeader = ({ header, recordContext }) => {
  if (!header) {
    return null;
  }
  const text = recordContext?.text || {};
  const latest = recordContext?.payload?.latest || {};
  const parentName = recordContext?.payload?.name;
  const photoEntry = header.photo ? latest[header.photo] : null;
  const photoUrl = photoEntry?.value || photoEntry?.name;
  const statusEntry = header.status?.question ? latest[header.status.question] : null;
  const statusText = getText(text, header.status?.label_key, header.status?.label || fmt(statusEntry));

  return (
    <Card className="profile-header" bordered>
      <div className="profile-header__media">
        {photoUrl ? (
          <Image src={photoUrl} width={160} height={120} style={{ objectFit: "cover" }} />
        ) : (
          <div className="profile-header__photo-placeholder">{text.siteProfileNoPhoto}</div>
        )}
      </div>
      <div className="profile-header__body">
        <Typography.Title level={3}>
          {parentName || getText(text, header.title_key, header.title || text.siteProfileTab)}
        </Typography.Title>
        {header.subtitle ? (
          <Typography.Text type="secondary">{fmt(latest[header.subtitle])}</Typography.Text>
        ) : null}
        <div className="profile-header__meta">
          {(header.meta || []).map((row) => (
            <span key={row.label}>
              <Typography.Text type="secondary">
                {getText(text, row.label_key, row.label)}
              </Typography.Text>{" "}
              <Typography.Text>
                {getText(text, row.value_key, row.value || fmt(latest[row.question]))}
              </Typography.Text>
            </span>
          ))}
        </div>
      </div>
      {header.status ? (
        <div className="profile-header__status">
          <Tag color={header.status.color || "default"}>{statusText}</Tag>
        </div>
      ) : null}
    </Card>
  );
};

ProfileHeader.propTypes = { header: PropTypes.object, recordContext: PropTypes.object };
export default ProfileHeader;
```

### 2.4 Renderer — `ProfileRenderer.jsx`

> Sorts by `order`, recurses for `tabs`, dispatches the friendly types. Threads one
> `recordContext` (`{ payload }`).

```jsx
// pages/manage-data/components/profile/ProfileRenderer.jsx
import React, { useCallback } from "react";
import PropTypes from "prop-types";
import { Row, Col } from "antd";
import TabsWidget from "../../../../components/dashboard/widgets/TabsWidget";
import SectionTitleWidget from "../../../../components/dashboard/widgets/SectionTitleWidget"; // chart_type "heading"
import { getText } from "./lib/utils";
import ProfileHeader from "./ProfileHeader";
import {
  AssessmentWidget,
  ComplianceWidget,
  FieldListWidget,
  MetricWidget,
  PhotoWidget,
  RecordTableWidget,
  RisksWidget,
  RiskScoreTrend,
  TagsWidget,
  TrendWidget,
} from "./widgets";

const CUSTOM_COMPONENTS = { RiskScoreTrend };

const localizeItem = (item, text) => ({
  ...item,
  label: getText(text, item.label_key, item.label),
  title: getText(text, item.title_key, item.title),
  items: (item.items || []).map((child) => localizeItem(child, text)),
});

const ProfileRenderer = ({ items, header, recordContext }) => {
  const text = recordContext?.text || {};
  const renderItems = useCallback(
    (children) => <ProfileRenderer items={children} recordContext={recordContext} />,
    [recordContext]
  );

  const renderWidget = (item) => {
    const ctx = recordContext;
    const localizedItem = localizeItem(item, text);
    switch (item.chart_type) {
      case "tabs": return <TabsWidget item={localizedItem} renderItems={renderItems} />;
      case "heading": return <SectionTitleWidget item={localizedItem} />;
      case "field_list": return <FieldListWidget item={localizedItem} recordContext={ctx} />;
      case "record_table": return <RecordTableWidget item={localizedItem} recordContext={ctx} />;
      case "assessment": return <AssessmentWidget item={localizedItem} recordContext={ctx} />;
      case "compliance": return <ComplianceWidget item={localizedItem} recordContext={ctx} />;
      case "tags": return <TagsWidget item={localizedItem} recordContext={ctx} />;
      case "trend": return <TrendWidget item={localizedItem} recordContext={ctx} />;
      case "metric": return <MetricWidget item={localizedItem} recordContext={ctx} />;
      case "photo": return <PhotoWidget item={localizedItem} recordContext={ctx} />;
      case "risks": return <RisksWidget item={localizedItem} recordContext={ctx} />;
      case "custom": {
        const Cmp = CUSTOM_COMPONENTS[item.component];
        if (!Cmp) {
          return null;
        }
        return <Cmp item={localizedItem} recordContext={ctx} />;
      }
      default:
        return null;
    }
  };

  const visible = [...(items || [])]
    .filter((item) => !item.hide)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <>
      <ProfileHeader header={header} recordContext={recordContext} />
      <Row gutter={[16, 16]}>
        {visible.map((item) => {
          const node = renderWidget(item);
          if (node === null) {
            return null;
          }
          return (
            <Col key={item.id} xs={24} md={item.col_span ?? 24}>
              {node}
            </Col>
          );
        })}
      </Row>
    </>
  );
};

ProfileRenderer.propTypes = {
  items: PropTypes.array,
  header: PropTypes.object,
  recordContext: PropTypes.shape({ payload: PropTypes.object }),
};

export default ProfileRenderer;
```

### 2.5 `field_list` — label/value field list

> This is intentionally a two-column **field list** for prototype blocks such as
> Staff & OHS and Maintenance Programs. Do **not** use this widget for multi-column
> record tables like Inspection History; those need `submissions[]` plus a column
> schema (`record_table` below).

```jsx
// widgets/FieldListWidget.jsx
import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Table, Empty, Tag } from "antd";
import {
  findQuestionByName,
  getText,
  resolveOption,
} from "../lib/utils";

const renderAnswer = (entry, question) => {
  if (!entry) {
    return null;
  }
  if (Array.isArray(entry.options) && entry.options.length) {
    return entry.options.map((v) => {
      const { label, color } = resolveOption(question, v);
      return <Tag key={v} color={color || "default"}>{label}</Tag>;
    });
  }
  if (entry.value !== null && typeof entry.value !== "undefined") {
    return String(entry.value);
  }
  return entry.name || null;
};

const FieldListWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const latest = recordContext?.payload?.latest || {};
  const rows = useMemo(
    () => {
      const configuredRows =
        item.rows || (item.questions || []).map((question) => ({ question }));
      return configuredRows
        .map((row) => {
          const name = row.question;
          const q = findQuestionByName(name);
          const answer = renderAnswer(latest[name], q);
          if (answer === null) {
            return null;
          }
          return {
            key: name,
            label: getText(text, row.label_key, row.label || q?.label || q?.name || name),
            value: answer,
          };
        })
        .filter(Boolean);
    },
    [item.rows, item.questions, latest, text]
  );

  const body =
    rows.length === 0 ? (
      <Empty description={text.siteProfileNoData} />
    ) : (
      <Table
        showHeader={false}
        pagination={false}
        size="small"
        bordered
        columns={[
          { dataIndex: "label", width: "50%" },
          { dataIndex: "value" },
        ]}
        dataSource={rows}
      />
    );

  return <Card title={getText(text, item.label_key, item.label)} bordered>{body}</Card>;
};

FieldListWidget.propTypes = { item: PropTypes.object.isRequired, recordContext: PropTypes.object };
export default FieldListWidget;
```

### 2.6 `assessment` — Component · Condition · Photo · (Notes auto-hidden)

> Pills use the form's `option.color`/`option.label`. The **Notes** column renders only
> when at least one row defines a `notes` question (D-11) — WWTP's rows don't, so it's
> hidden there.

```jsx
// widgets/AssessmentWidget.jsx
import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Table, Tag, Image, Empty } from "antd";
import {
  findQuestionByName,
  getText,
  resolveOption,
} from "../lib/utils";

const AssessmentWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const latest = recordContext?.payload?.latest || {};
  const showNotes = (item.rows || []).some((r) => r.notes);
  const showPhoto = (item.rows || []).some((r) => r.photo);

  const rows = useMemo(
    () =>
      (item.rows || [])
        .map((row) => {
          const q = findQuestionByName(row.question);
          const entry = latest[row.question];
          if (!q || !entry) {
            return null;
          }
          // condition = first option value of the latest answer
          const value = Array.isArray(entry.options) ? entry.options[0] : entry.value;
          const { label, color } = resolveOption(q, value);
          const photo = row.photo ? latest[row.photo]?.name || latest[row.photo]?.value : null;
          const notes = row.notes ? latest[row.notes]?.name || latest[row.notes]?.value : null;
          return {
            key: row.question,
            component: q.label || q.name,
            condition: <Tag color={color || "default"}>{label}</Tag>,
            photo,
            notes,
          };
        })
        .filter(Boolean),
    [item.rows, latest]
  );

  const columns = [
    { title: text.siteProfileComponentCol, dataIndex: "component", width: showNotes ? "30%" : "45%" },
    { title: text.siteProfileConditionCol, dataIndex: "condition", width: "20%" },
    ...(showPhoto
      ? [{
          title: text.siteProfilePhotoCol, dataIndex: "photo", width: "15%",
          render: (src) => (src ? <Image src={src} width={40} height={40} style={{ objectFit: "cover" }} /> : "—"),
        }]
      : []),
    ...(showNotes ? [{ title: text.siteProfileNotesCol, dataIndex: "notes", render: (t) => t || "—" }] : []),
  ];

  return (
    <Card
      title={getText(text, item.label_key, item.label)}
      extra={getText(text, item.caption_key, item.caption)}
      bordered
    >
      {rows.length === 0 ? (
        <Empty description={text.siteProfileNoAssessmentData} />
      ) : (
        <Table columns={columns} dataSource={rows} pagination={false} size="small" />
      )}
    </Card>
  );
};

AssessmentWidget.propTypes = { item: PropTypes.object.isRequired, recordContext: PropTypes.object };
export default AssessmentWidget;
```

### 2.7 `compliance` — Parameter · Result · Threshold · Status

> Thresholds are config-driven (external DWS limits). Status derives from latest value
> vs `threshold {min,max}`; `compliance_rule[]` drives the verdict line.

```jsx
// widgets/ComplianceWidget.jsx
import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Table, Tag, Typography } from "antd";
import {
  findQuestionByName,
  getText,
} from "../lib/utils";

const evaluate = (value, threshold) => {
  if (value === null || typeof value === "undefined" || !threshold) {
    return { textKey: "siteProfileStatusInfo", color: "default", pass: null };
  }
  if (typeof threshold.max === "number" && typeof threshold.min === "number") {
    if (value < threshold.min) { return { textKey: "siteProfileStatusBelow", color: "gold", pass: false }; }
    if (value > threshold.max) { return { textKey: "siteProfileStatusFail", color: "red", pass: false }; }
    return { textKey: "siteProfileStatusPass", color: "green", pass: true };
  }
  if (typeof threshold.max === "number") {
    return value <= threshold.max
      ? { textKey: "siteProfileStatusPass", color: "green", pass: true }
      : { textKey: "siteProfileStatusFail", color: "red", pass: false };
  }
  if (typeof threshold.min === "number") {
    return value >= threshold.min
      ? { textKey: "siteProfileStatusPass", color: "green", pass: true }
      : { textKey: "siteProfileStatusBelow", color: "gold", pass: false };
  }
  return { textKey: "siteProfileStatusInfo", color: "default", pass: null };
};

const thresholdText = (t) => {
  if (!t) { return "—"; }
  if (typeof t.min === "number" && typeof t.max === "number") { return `${t.min} – ${t.max}`; }
  if (typeof t.max === "number") { return `< ${t.max}`; }
  if (typeof t.min === "number") { return `> ${t.min}`; }
  return "—";
};

const ComplianceWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const latest = recordContext?.payload?.latest || {};
  const rows = useMemo(
    () =>
      (item.rows || []).map((r) => {
        const q = findQuestionByName(r.question);
        const value = latest[r.question]?.value ?? null;
        const status = evaluate(value, r.threshold);
        return {
          key: r.question,
          parameter: q?.label || q?.name || r.question,
          result: value === null ? "—" : `${value}${r.unit ? ` ${r.unit}` : ""}`,
          threshold: `${thresholdText(r.threshold)}${r.unit ? ` ${r.unit}` : ""}`,
          status: <Tag color={status.color}>{text[status.textKey]}</Tag>,
          _pass: status.pass,
        };
      }),
    [item.rows, latest]
  );

  const verdictPass = (item.compliance_rule || []).every((name) => {
    const r = rows.find((row) => row.key === name);
    return r ? r._pass !== false : true;
  });

  return (
    <Card title={getText(text, item.label_key, item.label)} bordered>
      <Table
        columns={[
          { title: text.siteProfileParameterCol, dataIndex: "parameter" },
          { title: text.siteProfileResultCol, dataIndex: "result" },
          { title: text.siteProfileThresholdCol, dataIndex: "threshold" },
          { title: text.siteProfileStatusCol, dataIndex: "status" },
        ]}
        dataSource={rows}
        pagination={false}
        size="small"
      />
      {(item.compliance_rule || []).length ? (
        <Typography.Text type="secondary">
          {text.siteProfileComplianceVerdict}{" "}
          <Typography.Text strong type={verdictPass ? "success" : "danger"}>
            {verdictPass ? text.siteProfileVerdictPass : text.siteProfileVerdictFail}
          </Typography.Text>
          {item.compliance_text ? ` — ${item.compliance_text}` : ""}
        </Typography.Text>
      ) : null}
    </Card>
  );
};

ComplianceWidget.propTypes = { item: PropTypes.object.isRequired, recordContext: PropTypes.object };
export default ComplianceWidget;
```

### 2.8 `tags` — colored tag list from a multiple_option answer

```jsx
// widgets/TagsWidget.jsx
import React from "react";
import PropTypes from "prop-types";
import { Card, Tag, Empty } from "antd";
import {
  findQuestionByName,
  getText,
  resolveOption,
} from "../lib/utils";

const TagsWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const entry = recordContext?.payload?.latest?.[item.question];
  const q = findQuestionByName(item.question);
  const values = Array.isArray(entry?.options) ? entry.options : [];

  return (
    <Card title={getText(text, item.label_key, item.label)} bordered>
      {values.length === 0 ? (
        <Empty description={text.siteProfileNoneRecorded} />
      ) : (
        values.map((v) => {
          const { label, color } = resolveOption(q, v);
          return <Tag key={v} color={color || "default"} style={{ marginBottom: 6 }}>{label}</Tag>;
        })
      )}
    </Card>
  );
};

TagsWidget.propTypes = { item: PropTypes.object.isRequired, recordContext: PropTypes.object };
export default TagsWidget;
```

### 2.9 `trend` — single numeric series

```jsx
// widgets/TrendWidget.jsx
import React from "react";
import PropTypes from "prop-types";
import ReactECharts from "echarts-for-react";
import { Card, Empty } from "antd";
import { formatDate, findQuestionByName, getText } from "../lib/utils";

const TrendWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const q = findQuestionByName(item.question);
  const rows = (recordContext?.payload?.history?.[item.question] || [])
    .map((row) => ({ date: row.created, value: Number(row.value) }))
    .filter((row) => !Number.isNaN(row.value));

  return (
    <Card title={getText(text, item.label_key, item.label || q?.label)} bordered>
      {rows.length ? (
        <ReactECharts
          style={{ height: 260 }}
          option={{
            xAxis: { type: "category", data: rows.map((row) => formatDate(row.date)) },
            yAxis: { type: "value", name: item.unit || "" },
            series: [{ type: "line", smooth: true, data: rows.map((row) => row.value) }],
          }}
        />
      ) : (
        <Empty description={text.siteProfileNoData} />
      )}
    </Card>
  );
};

TrendWidget.propTypes = { item: PropTypes.object.isRequired, recordContext: PropTypes.object };
export default TrendWidget;
```

### 2.10 `metric` — latest-value KPI tile

> Matches the prototype's compact one-value indicators, such as **Latest BOD** in
> WWTP Effluent Quality and **Station Status** in Pump Operations. It reads one latest
> answer from `latest[question]`; numeric values can show `unit`, while option answers
> render as form-colored tags.

```jsx
// widgets/MetricWidget.jsx
import React from "react";
import PropTypes from "prop-types";
import { Card, Empty, Statistic, Tag, Typography } from "antd";
import {
  findQuestionByName,
  getText,
  resolveOption,
} from "../lib/utils";

const renderOption = (entry, question) => {
  const values = Array.isArray(entry?.options) ? entry.options : [];
  if (!values.length) {
    return null;
  }
  return values.map((value) => {
    const { label, color } = resolveOption(question, value);
    return (
      <Tag key={value} color={color || "default"}>
        {label}
      </Tag>
    );
  });
};

const MetricWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const entry = recordContext?.payload?.latest?.[item.question];
  const question = findQuestionByName(item.question);
  const optionNode = renderOption(entry, question);
  const value =
    entry?.value !== null && typeof entry?.value !== "undefined"
      ? entry.value
      : entry?.name;
  const hasValue = value !== null && typeof value !== "undefined" && value !== "";

  return (
    <Card bordered>
      <Typography.Text type="secondary">
        {getText(text, item.label_key, item.label || question?.label || question?.name || item.question)}
      </Typography.Text>
      {optionNode || hasValue ? (
        optionNode || (
          <Statistic
            value={value}
            suffix={item.unit || null}
            valueStyle={{ fontSize: 28 }}
          />
        )
      ) : (
        <Empty description={text.siteProfileNoData} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Card>
  );
};

MetricWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};
export default MetricWidget;
```

### 2.11 `photo` — AntD Image card

> Uses AntD Image's previewable image component. AntD v4 documents `<Image />` as a
> previewable display component for pictures, with fault-tolerant loading support:
> https://4x.ant.design/components/image/
>
> Reflection against `backend/source/forms/*.prod.json`: there is no universal one-photo
> field across all asset registration forms. WWTP registration has `plant_photo`; Pump
> registration has `pump_station_photo`; WTP, EPS, and RWP registration forms have no
> photo field. Monitoring forms contain many contextual photos (sampling point,
> inspection, component/risk photos). Therefore `photo` should be explicit per profile
> and may accept `questions[]` as ordered fallbacks; do not assume every site has a
> prototype-style hero photo.
>
> Cardinality: if the form photo question lives inside a repeatable question group
> (`repeatable: true`), one submission can contain multiple answers for the same
> `question_name`. For those cases set `source: "submissions"` and render a gallery
> from the latest submission's answer array. Non-repeatable/canonical photos can use
> the default `source: "latest"`.

```jsx
// widgets/PhotoWidget.jsx
import React from "react";
import PropTypes from "prop-types";
import { Card, Empty, Image, Typography } from "antd";
import {
  findQuestionByName,
  getText,
} from "../lib/utils";

const toPhotoList = (value) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return value ? [value] : [];
};

const PhotoWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const latest = recordContext?.payload?.latest || {};
  const submissions = recordContext?.payload?.submissions || [];
  const candidates = item.questions || [item.question];
  const latestSubmission = submissions[0] || null;
  const source = item.source || "latest";
  const questionName = candidates.find((name) => {
    if (source === "submissions") {
      return toPhotoList(latestSubmission?.answers?.[name]).length > 0;
    }
    return latest[name]?.name || latest[name]?.value;
  });
  const question = findQuestionByName(questionName || item.question);
  const photos =
    source === "submissions"
      ? toPhotoList(latestSubmission?.answers?.[questionName])
      : toPhotoList(latest[questionName]?.name || latest[questionName]?.value);

  return (
    <Card title={getText(text, item.label_key, item.label || question?.label || text.siteProfilePhoto)} bordered>
      {photos.length ? (
        <>
          <Image.PreviewGroup>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {photos.map((src) => (
                <Image
                  key={src}
                  src={src}
                  width={item.thumbnailWidth || 160}
                  height={item.thumbnailHeight || 120}
                  style={{ objectFit: "cover", borderRadius: 6 }}
                />
              ))}
            </div>
          </Image.PreviewGroup>
          {item.caption ? (
            <Typography.Text type="secondary">
              {getText(text, item.caption_key, item.caption)}
            </Typography.Text>
          ) : null}
        </>
      ) : (
        <Empty description={text.siteProfileNoPhoto} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Card>
  );
};

PhotoWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};
export default PhotoWidget;
```

### 2.12 `risks` — Operational risk table

> For each configured condition question, derive severity from the latest option's
> color. Only amber/red conditions are listed (green = no risk). The prototype shows
> `Risk`, `Severity`, `Recommended Action`, and `Recurring?`; `action` and `recurring`
> are optional per row so real configs can start from available form data.

```jsx
// widgets/RisksWidget.jsx
import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Table, Tag, Empty } from "antd";
import {
  findQuestionByName, getText, resolveOption, optionSeverity, severityTagColor,
} from "../lib/utils";

const SEVERITY_TEXT_KEY = {
  red: "siteProfileSeverityHigh",
  amber: "siteProfileSeverityMedium",
};

const renderAnswer = (entry, question) => {
  if (!entry) {
    return null;
  }
  if (Array.isArray(entry.options) && entry.options.length) {
    return entry.options
      .map((v) => resolveOption(question, v).label)
      .join(", ");
  }
  if (entry.value !== null && typeof entry.value !== "undefined") {
    return String(entry.value);
  }
  return entry.name || null;
};

const renderRecurring = (value, text) => {
  if (value === null || typeof value === "undefined" || value === "") {
    return "—";
  }
  const normalized = String(value).toLowerCase();
  const yes = ["yes", "true", "recurring", "open"].includes(normalized);
  return <Tag color={yes ? "gold" : "green"}>{yes ? text.siteProfileYes : text.siteProfileNo}</Tag>;
};

const RisksWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const latest = recordContext?.payload?.latest || {};
  const hasAction = (item.rows || []).some((r) => r.action || r.action_key || r.action_question);
  const hasRecurring = (item.rows || []).some(
    (r) =>
      (r.recurring !== null && typeof r.recurring !== "undefined")
      || r.recurring_question
  );

  const rows = useMemo(
    () => {
      const configuredRows =
        item.rows || (item.questions || []).map((question) => ({ question }));
      return configuredRows
        .map((row) => {
          const name = row.question;
          const q = findQuestionByName(name);
          const entry = latest[name];
          if (!q || !entry) {
            return null;
          }
          const value = Array.isArray(entry.options) ? entry.options[0] : entry.value;
          const { label, color } = resolveOption(q, value);
          const sev = optionSeverity(color);
          if (sev !== "red" && sev !== "amber") {
            return null; // green / neutral → not a risk
          }
          const action = row.action_question
            ? renderAnswer(latest[row.action_question], findQuestionByName(row.action_question))
            : getText(text, row.action_key, row.action);
          const recurring = row.recurring_question
            ? renderAnswer(latest[row.recurring_question], findQuestionByName(row.recurring_question))
            : row.recurring;
          return {
            key: name,
            risk: getText(text, row.label_key, row.label || `${q.label || q.name} — ${label}`),
            severity: <Tag color={severityTagColor(sev)}>{text[SEVERITY_TEXT_KEY[sev]]}</Tag>,
            action: action || "—",
            recurring: renderRecurring(recurring, text),
          };
        })
        .filter(Boolean);
    },
    [item.rows, item.questions, latest, text]
  );

  const columns = [
    { title: text.siteProfileRiskCol, dataIndex: "risk", width: hasAction ? "34%" : "70%" },
    { title: text.siteProfileSeverityCol, dataIndex: "severity", width: "14%" },
  ];
  if (hasAction) {
    columns.push({ title: text.siteProfileRecommendedActionCol, dataIndex: "action" });
  }
  if (hasRecurring) {
    columns.push({ title: text.siteProfileRecurringCol, dataIndex: "recurring", width: "14%" });
  }

  return (
    <Card title={getText(text, item.label_key, item.label || text.siteProfileOperationalRisks)} bordered>
      {rows.length === 0 ? (
        <Empty description={text.siteProfileNoFlaggedRisks} />
      ) : (
        <Table
          columns={columns}
          dataSource={rows}
          pagination={false}
          size="small"
        />
      )}
    </Card>
  );
};

RisksWidget.propTypes = { item: PropTypes.object.isRequired, recordContext: PropTypes.object };
export default RisksWidget;
```

### 2.13 `record_table` — multi-column table from `submissions[]`

> Prototype columns are semantic (`Date`, `Inspector`, `Status`, `Issues Raised`,
> `Resolved?`), not generic question labels and not label/value pairs. Keep this widget
> configurable with `columns[]`, because each asset's monitoring form uses different
> question names.

```jsx
// widgets/RecordTableWidget.jsx
import React from "react";
import PropTypes from "prop-types";
import { Card, Table, Empty, Tag } from "antd";
import {
  findQuestionByName,
  getText,
  resolveOption,
  optionSeverity,
  severityTagColor,
} from "../lib/utils";

const fmt = (v) => (Array.isArray(v) ? v.join(", ") : v === null || typeof v === "undefined" ? "—" : String(v));

const fmtAnswer = (answers, name) => fmt(answers?.[name]);

const renderStatus = (answers, name) => {
  const question = findQuestionByName(name);
  const raw = answers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const { label, color } = resolveOption(question, value);
  const sev = optionSeverity(color);
  return <Tag color={severityTagColor(sev)}>{String(label || value || "—").toUpperCase()}</Tag>;
};

const renderResolved = (value, text) => {
  const normalized = String(value || "").toLowerCase();
  if (["yes", "true", "resolved", "closed"].includes(normalized)) {
    return "✓";
  }
  if (["recurring", "open", "no", "false"].includes(normalized)) {
    return (
      <Tag color={normalized === "recurring" ? "gold" : "red"}>
        {normalized === "recurring" ? text.siteProfileRecurring : text.siteProfileOpen}
      </Tag>
    );
  }
  return fmt(value);
};

const RecordTableWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const submissions = recordContext?.payload?.submissions || [];
  const configuredColumns =
    item.columns || (item.questions || []).map((question) => ({ question }));
  const cols = configuredColumns.map((column) => ({
    title: getText(
      text,
      column.title_key,
      column.title || findQuestionByName(column.question)?.label || column.question
    ),
    dataIndex: column.key || column.question || column.source,
    render: (_, row) => {
      if (column.source === "date") {
        return fmt(row.created || row.created_at || row.date);
      }
      if (column.render === "status") {
        return renderStatus(row.answers, column.question);
      }
      if (column.render === "resolved") {
        return renderResolved(fmtAnswer(row.answers, column.question), text);
      }
      return fmtAnswer(row.answers, column.question);
    },
  }));

  if (!submissions.length) {
    return (
      <Card title={getText(text, item.label_key, item.label || text.siteProfileRecords)} bordered>
        <Empty description={text.siteProfileNoInspections} />
      </Card>
    );
  }

  return (
    <Card title={getText(text, item.label_key, item.label || text.siteProfileRecords)} bordered>
      <Table
        columns={cols}
        dataSource={submissions.map((s) => ({ key: s.data_id, ...s }))}
        pagination={false}
        size="small"
      />
    </Card>
  );
};

RecordTableWidget.propTypes = { item: PropTypes.object.isRequired, recordContext: PropTypes.object };
export default RecordTableWidget;
```

### 2.14 `custom` — `RiskScoreTrend` (reuses existing compliance rules — D-11 Option A)

> **No invented formula.** Reuses the dashboard's per-form `rules_kpi` `rules[]` (the
> same "critical" definition behind the map/list pin colors) and applies them to each
> `submissions[]` inspection → plots the count of failing rules over time. The widget
> config carries the rules (inline `rules`, or `rules_ref` pointing at the visualization
> config item, e.g. `kpi_critical_issues`).

```jsx
// widgets/RiskScoreTrend.jsx
import React from "react";
import PropTypes from "prop-types";
import TrendWidget from "./TrendWidget";

const RiskScoreTrend = ({ item, recordContext }) => (
  <TrendWidget
    item={{
      ...item,
      question: item.question || item.questions?.[0] || "has_final_recommendation",
      label: item.label || recordContext?.text?.siteProfileComplianceTrend,
    }}
    recordContext={recordContext}
  />
);

RiskScoreTrend.propTypes = { item: PropTypes.object.isRequired, recordContext: PropTypes.object };
export default RiskScoreTrend;
```

> Wiring notes:
> - Thread `parentFormId` into `recordContext` (`{ payload, parentFormId }`) so the
>   widget can resolve `rules_ref` from the visualization config (done in §2.15 mount).
> - **`rules_ref` needs a form-id lookup**: `config/visualizations/index.js` currently
>   exports `getVisualizationConfigBySlug` (keyed by slug), not by form id. Add a small
>   `getVisualizationConfigByFormId` (the configs already carry `parent_form_id`), **or**
>   for v1 just inline the `rules[]` on the widget (copy) and skip the cross-registry
>   lookup. Inline = simplest; `rules_ref` = single-source-of-truth upgrade.
> - `useSiteProfile`'s `collect()` must add the rules' `question_name`s to `records` so
>   `submissions[]` carries them — extend it to read `item.rules` (and, for `rules_ref`,
>   the resolved rule names).

### 2.15 Mount — Site Profile tab in `MonitoringDetail.jsx`

```jsx
// imports
import { getSiteProfileConfig, getSiteProfileKey } from "../../config/site-profiles";
import { ProfileRenderer, useSiteProfile } from "./components/profile";
import { store, uiText } from "../../lib";

// inside the component — `form` = route param, `parentId` = datapoint id.
// Prefer the canonical route form id; fall back to the fetched datapoint's
// registration form id if the route param is missing/stale.
const profileFormId = useMemo(
  () => getSiteProfileKey(form, selectedFormData?.form),
  [form, selectedFormData?.form]
);
const profileConfig = useMemo(
  () => getSiteProfileConfig(profileFormId),
  [profileFormId]
);
const { language } = store.useState((s) => s);
const { active: activeLang } = language;
const text = useMemo(() => uiText[activeLang], [activeLang]);

const [dataTab, setDataTab] = useState(
  formIdFromUrl ? "monitoring-data" : profileConfig ? "site-profile" : "registration-data"
);

const { data: profilePayload, loading: profileLoading } = useSiteProfile({
  parentId,
  parentFormId: profileFormId,
  config: profileConfig,
  enabled: Boolean(profileConfig) && dataTab === "site-profile",
});
```

```jsx
{/* FIRST tab, only when a config exists */}
{profileConfig && (
  <TabPane tab={text.siteProfileTab} key="site-profile">
    <Spin spinning={profileLoading}>
      {profilePayload ? (
        <ProfileRenderer
          items={profileConfig.items}
          header={profileConfig.header}
          recordContext={{ payload: profilePayload, parentFormId: profileFormId, text }}
        />
      ) : null}
    </Spin>
  </TabPane>
)}
```

> Add the site-profile keys in §2.17 to `lib/ui-text.js` for each language. Do not use
> hardcoded fallback UI strings inside widgets.

### 2.16 Click-through route — replace `click_url_template`

```js
// components/dashboard/constants.js
export const buildSiteDetailHref = (formId, dataId) => {
  if (!formId || dataId === null || typeof dataId === "undefined" || dataId === "") {
    return null;
  }
  return `/control-center/data/${formId}/monitoring/${dataId}`;
};
```

```diff
// RankingWidget.jsx, DashboardMap/index.jsx, DashboardMap/MapPopupCard.jsx
- const template = item.click_url_template || DETAIL_URL_TEMPLATE;
- return template.replace("{parent_form_id}", formId).replace("{data_id}", dataId);
+ return buildSiteDetailHref(formId, dataId);
```

…and strip `"click_url_template"` from the 5 `config/visualizations/*.json` + the README row.

### 2.17 UI text keys — `lib/ui-text.js`

> All display text used by Site Profile widgets must come from `ui-text.js`.
> Profile configs should reference these keys via `label_key`, `title_key`,
> `caption_key`, `action_key`, `value_key`, and column `title_key`. Avoid hardcoded
> fallback strings in widgets.

```js
// lib/ui-text.js — add under each language object
siteProfileTab: "Site Profile",
siteProfileWwtpName: "WWTP Site Profile",
siteProfileWwtpDescription: "Wastewater treatment plant site profile",
siteProfileDerivedStatus: "Derived from latest monitoring rules",
siteProfileAssetTypeWwtp: "WWTP",

siteProfileType: "Type",
siteProfileCommissioned: "Commissioned",
siteProfileDesignCapacity: "Design Capacity",
siteProfilePopulationConnected: "Pop. Connected",
siteProfileSupervisor: "Supervisor",

siteProfileInfrastructureAssessment: "Infrastructure Assessment",
siteProfileTreatmentProcessesInUse: "Treatment Processes in Use",
siteProfileStaffOhs: "Staff & OHS",
siteProfileMaintenancePrograms: "Maintenance Programs",
siteProfileEffluentQuality: "Effluent Quality",
siteProfileLatestEffluentTest: "Latest Effluent Test",
siteProfileOperationalRisks: "Operational Risks",
siteProfileInspectionHistory: "Inspection History",
siteProfileComplianceTrend: "Compliance Trend",

siteProfileNumberOfStaff: "Number of staff",
siteProfileOhsPolicy: "OHS policy",
siteProfileOhsEquipmentCondition: "OHS equipment condition",
siteProfileWorkingTools: "Working tools",
siteProfileUrgentMaintenance: "Urgent maintenance",
siteProfilePlannedPreventative: "Planned preventative",
siteProfileUpgradingProgram: "Upgrading program",

siteProfileComponentCol: "Component",
siteProfileConditionCol: "Condition",
siteProfilePhotoCol: "Photo",
siteProfileNotesCol: "Notes",
siteProfileParameterCol: "Parameter",
siteProfileResultCol: "Result",
siteProfileThresholdCol: "Threshold",
siteProfileStatusCol: "Status",
siteProfileRiskCol: "Risk",
siteProfileSeverityCol: "Severity",
siteProfileRecommendedActionCol: "Recommended Action",
siteProfileRecurringCol: "Recurring?",
siteProfileDateCol: "Date",
siteProfileInspectorCol: "Inspector",
siteProfileIssuesRaisedCol: "Issues Raised",
siteProfileResolvedCol: "Resolved?",

siteProfileStatusInfo: "Info",
siteProfileStatusBelow: "Below",
siteProfileStatusFail: "Fail",
siteProfileStatusPass: "Pass",
siteProfileVerdictPass: "PASS",
siteProfileVerdictFail: "FAIL",
siteProfileComplianceVerdict: "Compliance verdict:",
siteProfileSeverityHigh: "High",
siteProfileSeverityMedium: "Medium",
siteProfileYes: "Yes",
siteProfileNo: "No",
siteProfileRecurring: "Recurring",
siteProfileOpen: "Open",
siteProfileIssuesUnit: "issues",

siteProfileNoData: "No data",
siteProfileNoPhoto: "No photo",
siteProfileNoAssessmentData: "No assessment data",
siteProfileNoneRecorded: "None recorded",
siteProfileNoFlaggedRisks: "No flagged risks",
siteProfileNoInspections: "No inspections",
siteProfilePhoto: "Photo",
siteProfileRecords: "Records",

siteProfileActionProcureMissingTools:
  "Procure missing tools; verify safe operation",
siteProfileActionProcureOhsItems:
  "Procure missing OHS items; staff training",
siteProfileActionScheduleCorrectiveMaintenance:
  "Schedule corrective maintenance",
```

---

## Part 3 — Manual test plan

1. **Backend**: `curl` §1.4 → `{ parent_id, name, latest{…}, history{…}, submissions[…] }`.
2. **Frontend**: open `/control-center/data/1748903240763/monitoring/<wwtp_id>` → lands on **Site Profile**.
   - **Infrastructure Assessment** → `assessment` (Component·Condition pill·Photo, no Notes column) + `tags` (treatment processes) + `field_list` (Staff & OHS, Maintenance).
   - **Effluent Quality** → `compliance` table (Pass/Fail/Below + verdict) + `metric` (Latest BOD) + `trend` charts.
   - **Operational Risks** → `risks` (Risk · Severity, plus Action/Recurring when configured; amber/red only).
   - **Inspection History** → `record_table` per-submission table from `submissions[]`.
3. Registration / Monitoring tabs unchanged.
4. Form without a config → no Site Profile tab.
5. `?form_id=…` deep-link → still forces Monitoring tab.

---

## Part 4 — Files this slice touches

**New (backend):** `serializers.py` (+`SiteProfileQuerySerializer`), `views.py`
(+`SiteProfileDetailView`), `urls.py` (+route).
**New (frontend):** `config/site-profiles/index.js`; `pages/manage-data/components/profile/`
(`index.js`, `ProfileHeader.jsx`, `ProfileRenderer.jsx`, `style.scss`,
`lib/{site-profile-queries,use-site-profile,utils}.js`,
`widgets/index.js`, `widgets/{FieldListWidget, RecordTableWidget, AssessmentWidget,
ComplianceWidget, TagsWidget, TrendWidget, MetricWidget, PhotoWidget, RisksWidget,
RiskScoreTrend}.jsx`).
**Edited (frontend):** `MonitoringDetail.jsx`, `constants.js` (`buildSiteDetailHref`),
`RankingWidget.jsx`, `DashboardMap/index.jsx`, `DashboardMap/MapPopupCard.jsx`,
`lib/ui-text.js`, 5 `config/visualizations/*.json` (drop `click_url_template`).

## Open items (from design §10)
- Registration-form fields (Plant characteristics) need the `data_id = parent_id`
  branch in the view (`mv_answer_denormalized.parent_id` is NULL for them).
- Risk-score formula weights — confirm with product (D-11).
