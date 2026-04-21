import React from "react";
import PropTypes from "prop-types";
import { Card, Skeleton, Statistic } from "antd";
import { useDashboardValues } from "../../../util/hooks";

/**
 * Single KPI tile — owns its own fetch so each tile can resolve independently.
 * Value formatting picks between percentage and number based on the api
 * block's `value_type`.
 *
 * Replaces the old KPICard (from KPICardRow.jsx). Layout (columns) now emerges
 * from sibling `col_span` values rather than a hardcoded row container.
 *
 * @param {object} item              A config item with chart_type "card"
 * @param {object} filterState       useDashboardFilters.queryParams
 * @param {number} [fiscalYearStartMonth]
 * @param {Array}  [customFilterDefs]
 * @param {Date}   [today]
 */
const KPICard = ({
  item,
  filterState,
  today,
  fiscalYearStartMonth,
  customFilterDefs,
}) => {
  const { data, loading, error } = useDashboardValues(item.api, filterState, {
    today,
    fiscalYearStartMonth,
    customFilterDefs,
  });

  const rawValue =
    data?.data && data.data.length > 0 ? data.data[0].value : null;

  const isPercentage = item.api?.value_type === "percentage";
  let displayValue = "—";
  if (rawValue !== null && typeof rawValue !== "undefined") {
    displayValue = isPercentage ? `${rawValue}%` : rawValue;
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
};

export default KPICard;
