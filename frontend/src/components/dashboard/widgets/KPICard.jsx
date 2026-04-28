import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Skeleton, Statistic } from "antd";
import { useDashboardValues } from "../../../util/hooks";
import { getCompliantCount } from "../compute/compliance";
import { computeAccessibilityBucket } from "../compute/accessibility";

/**
 * Single KPI tile. Owns its own fetch(es) so each tile resolves
 * independently. The display value is one of:
 *
 *  - Scalar number (default, no value_type)
 *  - "{N}%" (legacy api.value_type === "percentage")
 *  - "{N}/{M} ({P}%)" ratio, selected by either:
 *      a) api.value_type === "ratio_percentage" + sibling denominator_api,
 *      b) compute === "compliance_kpi" — numerator reuses the dashboard's
 *         pre-fetched complianceResponses via getCompliantCount (single
 *         source of truth with the FR-2c compliance column),
 *      c) compute === "accessibility_no_issues_kpi" — numerator is the
 *         easily_accessible bucket from the A.2 derivation over this KPI's
 *         pre-fetched sample/issues responses.
 *
 *  In all ratio variants, a denominator of 0 renders "—" (no div-by-zero).
 *
 * @param {object} item              A config item with chart_type "card"
 * @param {object} filterState       useDashboardFilters.queryParams
 * @param {number} [fiscalYearStartMonth]
 * @param {Array}  [customFilterDefs]
 * @param {Date}   [today]
 * @param {Map}    [definitionsById] id → item map (needed for params_ref
 *                                    resolution in compliance_kpi)
 * @param {object} [computeResponses] { [mode]: { [itemId]: /values response } }
 *                                    Unified prefetch map; provides
 *                                    complianceResponses (under key
 *                                    "compliance") and accessibility_no_issues_kpi
 *                                    responses.
 */

const ACCESSIBILITY_LABELS = {
  easily_accessible: "Easily accessible",
  accessible_with_issues: "Accessible with issues",
  not_accessible: "Not accessible",
};

const formatRatio = (numerator, denominator) => {
  if (
    numerator === null ||
    typeof numerator === "undefined" ||
    denominator === null ||
    typeof denominator === "undefined" ||
    denominator === 0
  ) {
    return "—";
  }
  const pct = Math.round((numerator / denominator) * 100);
  return `${numerator}/${denominator} (${pct}%)`;
};

const resolveComplianceNumerator = (
  item,
  definitionsById,
  computeResponses
) => {
  const complianceResponses = computeResponses?.compliance || {};
  const params = (item.params_ref || [])
    .map((id) => definitionsById?.get(id))
    .filter(Boolean)
    .map((p) => ({ ...p, key: p.id }));
  if (params.length === 0) {
    return null;
  }
  const responsesByKey = {};
  params.forEach((p) => {
    if (complianceResponses[p.id]) {
      responsesByKey[p.id] = complianceResponses[p.id];
    }
  });
  // Distinguish "responses not yet fetched" from "fetched, 0 compliant".
  // Without this guard the card flashes "0/M (0%)" during the gap between
  // KPICard mount and the parent dashboard's compliance fetcher resolving,
  // which falsely implies zero records are compliant. Mirrors the null-return
  // contract of resolveAccessibilityNoIssuesNumerator below (akvo-mis-ddw).
  if (Object.keys(responsesByKey).length === 0) {
    return null;
  }
  return getCompliantCount(params, responsesByKey);
};

const resolveAccessibilityNoIssuesNumerator = (item, computeResponses) => {
  const responses =
    computeResponses?.accessibility_no_issues_kpi?.[item.id] || null;
  if (!responses) {
    return null;
  }
  const row = computeAccessibilityBucket(responses, ACCESSIBILITY_LABELS)[0];
  return row[ACCESSIBILITY_LABELS.easily_accessible] ?? 0;
};

const KPICard = ({
  item,
  filterState,
  today,
  fiscalYearStartMonth,
  customFilterDefs,
  definitionsById,
  computeResponses,
}) => {
  const compute = item.compute;
  const hasDenominator = Boolean(item.denominator_api);
  // api-driven ratio: an item with an api block AND a denominator_api is
  // always a ratio card. We also accept the legacy marker
  // `api.value_type === "ratio_percentage"` for readability in configs, but
  // the marker is NOT forwarded to the backend (it's not a valid /values
  // enum value).
  const isRatioApi = Boolean(item.api) && hasDenominator && !compute;
  const isRatioCompute =
    compute === "compliance_kpi" || compute === "accessibility_no_issues_kpi";
  const wantsDenominator = isRatioApi || isRatioCompute;

  // Primary /values fetch (only for non-compute items). Strip the
  // frontend-only `value_type: "ratio_percentage"` marker before handing the
  // api block to useDashboardValues — the backend validator rejects it.
  const primaryApi = useMemo(() => {
    if (compute) {
      return null;
    }
    if (!item.api) {
      return null;
    }
    if (item.api.value_type === "ratio_percentage") {
      const stripped = { ...item.api };
      delete stripped.value_type;
      return stripped;
    }
    return item.api;
  }, [compute, item.api]);
  const {
    data: primaryData,
    loading: primaryLoading,
    error: primaryError,
  } = useDashboardValues(primaryApi, filterState, {
    today,
    fiscalYearStartMonth,
    customFilterDefs,
    enabled: Boolean(primaryApi),
  });

  // Denominator fetch (any ratio variant)
  const denominatorApi = wantsDenominator ? item.denominator_api : null;
  const {
    data: denominatorData,
    loading: denominatorLoading,
    error: denominatorError,
  } = useDashboardValues(denominatorApi, filterState, {
    today,
    fiscalYearStartMonth,
    customFilterDefs,
    enabled: Boolean(denominatorApi),
  });

  // Numerator resolution
  let numerator = null;
  if (isRatioApi) {
    numerator = primaryData?.data?.[0]?.value ?? null;
  } else if (compute === "compliance_kpi") {
    numerator = resolveComplianceNumerator(
      item,
      definitionsById,
      computeResponses
    );
  } else if (compute === "accessibility_no_issues_kpi") {
    numerator = resolveAccessibilityNoIssuesNumerator(item, computeResponses);
  } else {
    numerator = primaryData?.data?.[0]?.value ?? null;
  }

  const denominator = denominatorData?.data?.[0]?.value ?? null;
  const isLegacyPct =
    item.api?.value_type === "percentage" && !wantsDenominator;

  const loading = primaryLoading || (wantsDenominator && denominatorLoading);
  const error = primaryError || denominatorError;

  let displayValue = "—";
  if (wantsDenominator) {
    displayValue = formatRatio(numerator, denominator);
  } else if (numerator !== null && typeof numerator !== "undefined") {
    displayValue = isLegacyPct ? `${numerator}%` : numerator;
  }

  return (
    <Card
      {...(item.color
        ? { style: { borderTop: `3px solid ${item.color}` } }
        : {})}
      data-testid={`kpi-card-${item.id}`}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} />
      ) : (
        <Statistic
          title={item.label}
          value={displayValue}
          {...(item.color ? { valueStyle: { color: item.color } } : {})}
        />
      )}
      {error && (
        <div role="alert" style={{ color: "#e41a1c", fontSize: 12 }}>
          {error.message || "Failed to load"}
        </div>
      )}
    </Card>
  );
};

KPICard.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  today: PropTypes.instanceOf(Date),
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  definitionsById: PropTypes.instanceOf(Map),
  computeResponses: PropTypes.object,
};

export default KPICard;
