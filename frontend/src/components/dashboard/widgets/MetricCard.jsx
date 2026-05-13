import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Skeleton, Statistic } from "antd";
import { useDashboardValues } from "../../../util/hooks";

/**
 * Generic metric tile with single-fetch share/scalar support — a slimmer
 * alternative to KPICard that derives the denominator from the same
 * `/visualization/values` response as the numerator instead of issuing a
 * separate `denominator_api` fetch.
 *
 * Four display modes, dispatched on the presence of `target_group` and
 * the `show_percentage` flag:
 *
 *  - **Scalar count** (no `target_group`, no `show_percentage`): renders
 *    `data[0].value` directly — e.g. `"Total EPS registered: 40"`.
 *  - **Scalar percentage** (no `target_group`, `show_percentage: true`):
 *    renders `data[0].value` with a `%` suffix — e.g. `"40%"`.
 *  - **Share** (`target_group` set, no `show_percentage`): backend
 *    returns one row per group (`{ value, label, group }[]`). The matching
 *    `group` row's value is the numerator, the sum of every row's value is
 *    the denominator — e.g. `"2/3"`.
 *  - **Share with percentage** (`target_group` set, `show_percentage:
 *    true`): same as share, with `(P%)` appended — e.g. `"2/3 (66%)"`.
 *
 * In share modes a missing/zero denominator renders `"—"`.
 *
 * `target_group` is a frontend-only signal and is stripped before the api
 * block hits `/visualization/values` (the backend rejects unknown fields on
 * its enum-validated request schema).
 */
const stripFrontendApiFields = (api) => {
  const rest = { ...api };
  delete rest.target_group;
  return rest;
};

const isMissingPair = (numerator, denominator) =>
  numerator === null ||
  typeof numerator === "undefined" ||
  denominator === null ||
  typeof denominator === "undefined" ||
  denominator === 0;

const formatRatioPercentage = (numerator, denominator) => {
  if (isMissingPair(numerator, denominator)) {
    return "—";
  }
  const pct = (numerator / denominator) * 100;
  return `${numerator}/${denominator} (${parseFloat(pct.toFixed(2))}%)`;
};

const formatShare = (numerator, denominator) => {
  if (isMissingPair(numerator, denominator)) {
    return "—";
  }
  return `${numerator}/${denominator}`;
};

const MetricCard = ({
  item,
  filterState,
  today,
  fiscalYearStartMonth,
  customFilterDefs,
}) => {
  const target = item?.target_group;
  const showPercentage = Boolean(item.show_percentage);

  const apiForFetch = useMemo(
    () => (item.api ? stripFrontendApiFields(item.api) : null),
    [item.api]
  );

  const { data, loading, error } = useDashboardValues(
    apiForFetch,
    filterState,
    {
      today,
      fiscalYearStartMonth,
      customFilterDefs,
      enabled: Boolean(apiForFetch),
    }
  );

  const rows = data?.data || [];

  let displayValue = "—";
  if (target) {
    const targetRow = rows.find((r) => r.group === target);
    if (targetRow) {
      const numerator = targetRow.value ?? 0;
      const denominator = rows.reduce((acc, r) => acc + (r.value || 0), 0);
      displayValue = showPercentage
        ? formatRatioPercentage(numerator, denominator)
        : formatShare(numerator, denominator);
    }
  } else {
    const v = rows[0]?.value;
    if (v !== null && typeof v !== "undefined") {
      displayValue = showPercentage ? `${v}%` : v;
    }
  }

  return (
    <Card
      {...(item.color
        ? { style: { borderTop: `3px solid ${item.color}` } }
        : {})}
      data-testid={`metric-card-${item.id}`}
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

MetricCard.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  today: PropTypes.instanceOf(Date),
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
};

export default MetricCard;
