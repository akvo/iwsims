import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Bar, Doughnut, Line, Pie, StackBar } from "akvo-charts";
import { Alert, Skeleton } from "antd";
import { useDashboardValues, useDashboardProgress } from "../../util/hooks";
import { toHistogramBarData } from "./compute/progressHistogram";
import { computeComplianceStackData } from "./compute/compliance";
import { rotateToFiscalOrder } from "./compute/fiscalMonthRotation";

const COMPONENT_BY_TYPE = {
  bar: Bar,
  doughnut: Doughnut,
  line: Line,
  pie: Pie,
  stack_bar: StackBar,
};

/**
 * Generic chart wrapper. Dispatches on `chart_type` and handles three
 * data-source modes defined by the config:
 *
 *  - `api`       — hit /visualization/values with the chart's api block
 *  - `source: "progress"` — reuse a /progress response (histogram field)
 *  - `compute: "compliance"` — frontend-compute drinking-water stacked bar
 */
const ChartRenderer = ({
  chartKey,
  chart,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  today,
  // Shared refs used by cross-referenced / compute charts
  progressResponses,
  complianceResponses,
  waterQualityParameters,
}) => {
  const Component = COMPONENT_BY_TYPE[chart.chart_type];
  const isApiDriven =
    Boolean(Component) && Boolean(chart.api) && !chart.compute && !chart.source;

  const {
    data: apiData,
    loading: apiLoading,
    error: apiError,
  } = useDashboardValues(isApiDriven ? chart.api : null, filterState, {
    today,
    fiscalYearStartMonth,
    customFilterDefs,
    enabled: isApiDriven,
  });

  const data = useMemo(() => {
    if (chart.compute === "compliance") {
      return computeComplianceStackData(
        waterQualityParameters || [],
        complianceResponses || {}
      ).data;
    }
    if (chart.source === "progress") {
      const progressResp = progressResponses?.[chart.progress_ref];
      return chart.field === "histogram"
        ? toHistogramBarData(progressResp)
        : progressResp?.details || [];
    }
    if (isApiDriven) {
      // Rotate on raw rows first (they still carry .group = YYYY-MM), then
      // strip to {label, value} for akvo-charts dimension inference.
      let rows = apiData?.data || [];
      if (chart.api?.group_by === "month" && chart.api?.fiscal_year) {
        rows = rotateToFiscalOrder(rows, fiscalYearStartMonth);
      }
      return rows.map((r) => ({ label: r.label, value: r.value }));
    }
    return [];
  }, [
    chart,
    apiData,
    isApiDriven,
    progressResponses,
    complianceResponses,
    waterQualityParameters,
    fiscalYearStartMonth,
  ]);

  if (!Component) {
    return (
      <Alert
        type="error"
        message={`Unsupported chart_type: ${chart.chart_type} (${chartKey})`}
      />
    );
  }
  if (apiLoading) {
    return <Skeleton active paragraph={{ rows: 4 }} />;
  }
  if (apiError) {
    return (
      <Alert
        type="error"
        message={`Failed to load ${chartKey}: ${apiError.message || "error"}`}
      />
    );
  }

  if (!data || data.length === 0) {
    return (
      <div style={{ padding: 16, color: "#999", textAlign: "center" }}>
        No data
      </div>
    );
  }

  const commonProps = {
    config: chart.config || {},
    data,
    rawConfig: chart.raw_config,
    rawOverrides: chart.raw_overrides,
  };

  return <Component {...commonProps} />;
};

ChartRenderer.propTypes = {
  chartKey: PropTypes.string.isRequired,
  chart: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  today: PropTypes.instanceOf(Date),
  progressResponses: PropTypes.object,
  complianceResponses: PropTypes.object,
  waterQualityParameters: PropTypes.array,
};

export { useDashboardProgress };
export default ChartRenderer;
