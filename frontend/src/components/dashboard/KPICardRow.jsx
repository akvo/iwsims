import React from "react";
import PropTypes from "prop-types";
import { Card, Col, Row, Skeleton, Statistic } from "antd";
import { useDashboardValues } from "../../util/hooks";

/**
 * One KPI tile — owns its own fetch so each tile can resolve independently.
 * Value formatting picks between percentage and number based on the api
 * block's `value_type`.
 */
const KPICard = ({
  kpiKey,
  kpi,
  filterState,
  today,
  fiscalYearStartMonth,
  customFilterDefs,
}) => {
  const { data, loading, error } = useDashboardValues(kpi.api, filterState, {
    today,
    fiscalYearStartMonth,
    customFilterDefs,
  });

  const rawValue =
    data?.data && data.data.length > 0 ? data.data[0].value : null;

  const isPercentage = kpi.api?.value_type === "percentage";
  let displayValue = "—";
  if (rawValue !== null) {
    displayValue = isPercentage ? `${rawValue}%` : rawValue;
  }

  return (
    <Card
      {...(kpi.color ? { style: { borderTop: `3px solid ${kpi.color}` } } : {})}
      data-testid={`kpi-card-${kpiKey}`}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} />
      ) : (
        <Statistic
          title={kpi.label}
          value={displayValue}
          {...(kpi.color ? { valueStyle: { color: kpi.color } } : {})}
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
  kpiKey: PropTypes.string.isRequired,
  kpi: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  today: PropTypes.instanceOf(Date),
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
};

/**
 * Renders an Ant Design row of KPI tiles from a list of KPI keys. The actual
 * KPI definitions come from `kpisByKey` (typically `config.kpis`).
 */
const KPICardRow = ({
  kpiKeys,
  kpisByKey,
  filterState,
  today,
  fiscalYearStartMonth,
  customFilterDefs,
}) => {
  const visible = (kpiKeys || [])
    .map((k) => ({ key: k, def: kpisByKey?.[k] }))
    .filter(({ def }) => def && !def.hide);

  if (visible.length === 0) {
    return null;
  }

  const span = Math.max(4, Math.floor(24 / visible.length));

  return (
    <Row gutter={[16, 16]}>
      {visible.map(({ key, def }) => (
        <Col key={key} xs={24} sm={12} md={span}>
          <KPICard
            kpiKey={key}
            kpi={def}
            filterState={filterState}
            today={today}
            fiscalYearStartMonth={fiscalYearStartMonth}
            customFilterDefs={customFilterDefs}
          />
        </Col>
      ))}
    </Row>
  );
};

KPICardRow.propTypes = {
  kpiKeys: PropTypes.arrayOf(PropTypes.string).isRequired,
  kpisByKey: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  today: PropTypes.instanceOf(Date),
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
};

export { KPICard };
export default KPICardRow;
