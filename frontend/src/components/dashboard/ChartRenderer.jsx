import React, { useEffect, useMemo, useRef } from "react";
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
 * Wrap a pie/doughnut Component so we can hide the outer slice callout
 * labels after mount. akvo-charts doesn't expose a label-config prop
 * and its internal setOption replaces rather than merges — so we grab
 * the ECharts instance via ref and setOption with notMerge=false to
 * layer label:{show:false} on top while preserving dataset + encode.
 */
const PieWithHiddenLabels = ({ Component, commonProps }) => {
  const ref = useRef(null);
  useEffect(() => {
    const chart = ref.current;
    if (!chart || typeof chart.setOption !== "function") {
      return;
    }
    chart.setOption(
      {
        series: [{ label: { show: false }, labelLine: { show: false } }],
      },
      false
    );
  }, [commonProps.data, commonProps.config, commonProps.rawConfig]);
  return <Component ref={ref} {...commonProps} />;
};

PieWithHiddenLabels.propTypes = {
  Component: PropTypes.elementType.isRequired,
  commonProps: PropTypes.object.isRequired,
};

/**
 * Generic chart wrapper. Dispatches on `item.chart_type` and handles three
 * data-source modes defined by the flat schema item:
 *
 *  - `api`                — hit /visualization/values with the item's api block
 *  - `source: "progress"` — reuse a /progress response resolved via definitionsById
 *  - `compute: "compliance"` — frontend-compute drinking-water stacked bar
 *
 * Also handles `chart_type: "histogram"` which renders as <Bar> with
 * binned data from a direct api call.
 *
 * @param {object} item           The config item (chart_type, api, config, ...)
 * @param {object} filterState    useDashboardFilters.queryParams
 * @param {number} [fiscalYearStartMonth]
 * @param {Array}  [customFilterDefs]   flat list of filter items (for hint expansion)
 * @param {Date}   [today]
 * @param {Map}    [definitionsById]    id → item map for cross-ref resolution
 * @param {object} [complianceResponses]  { [itemId]: /values response }
 */
const ChartRenderer = ({
  item,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  today,
  definitionsById,
  complianceResponses,
}) => {
  const chartType = item.chart_type === "histogram" ? "bar" : item.chart_type;
  const Component = COMPONENT_BY_TYPE[chartType];

  const isApiDriven =
    Boolean(Component) && Boolean(item.api) && !item.compute && !item.source;

  const {
    data: apiData,
    loading: apiLoading,
    error: apiError,
  } = useDashboardValues(isApiDriven ? item.api : null, filterState, {
    today,
    fiscalYearStartMonth,
    customFilterDefs,
    enabled: isApiDriven,
  });

  // For progress-sourced charts, fetch the referenced progress definition.
  const progressDef = useMemo(() => {
    if (item.source !== "progress" || !item.progress_ref) {
      return null;
    }
    return definitionsById?.get(item.progress_ref) || null;
  }, [item, definitionsById]);

  const { data: progressData } = useDashboardProgress(
    progressDef,
    filterState,
    {
      enabled: Boolean(progressDef),
      customFilterDefs,
    }
  );

  // Resolve params for compliance chart.
  const complianceParams = useMemo(() => {
    if (item.compute !== "compliance") {
      return [];
    }
    const paramsRef = item.params_ref || [];
    return paramsRef.map((id) => definitionsById?.get(id)).filter(Boolean);
  }, [item, definitionsById]);

  const data = useMemo(() => {
    if (item.compute === "compliance") {
      // complianceResponses is keyed by item id (not param.key).
      // We pass params with their ids as keys into computeComplianceStackData
      // which expects params with `.key` matching the responses keys.
      // Build a normalised map: param.id → response for the compute helper,
      // aliasing so that the helper can use param.key == param.id here.
      const responsesByKey = {};
      complianceParams.forEach((p) => {
        // In the flat schema, param items use `id` as their unique key.
        // complianceResponses is keyed by item id.
        const resp = complianceResponses?.[p.id];
        if (resp) {
          responsesByKey[p.id] = resp;
        }
      });
      // Normalise: computeComplianceStackData expects parameters with a `.key`
      // field that matches the responsesByKey keys. In the new schema, id IS
      // the key, so we pass params with key = id.
      const normalised = complianceParams.map((p) => ({
        ...p,
        key: p.id,
      }));
      return computeComplianceStackData(normalised, responsesByKey).data;
    }

    if (item.source === "progress" && progressData) {
      return item.field === "histogram"
        ? toHistogramBarData(progressData)
        : progressData?.details || [];
    }

    if (isApiDriven) {
      let rows = apiData?.data || [];
      if (item.api?.group_by === "month" && item.api?.fiscal_year) {
        rows = rotateToFiscalOrder(rows, fiscalYearStartMonth);
      }
      return rows.map((r) => ({ label: r.label, value: r.value }));
    }
    return [];
  }, [
    item,
    apiData,
    isApiDriven,
    progressData,
    complianceResponses,
    complianceParams,
    fiscalYearStartMonth,
  ]);

  if (!Component) {
    return (
      <Alert
        type="error"
        message={`Unsupported chart_type: ${item.chart_type} (${item.id})`}
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
        message={`Failed to load ${item.id}: ${apiError.message || "error"}`}
      />
    );
  }

  // Empty state: no rows, OR all-zero for pie/doughnut (the library
  // would otherwise draw equal-sized slices, misleading the viewer).
  const allZero =
    (chartType === "doughnut" || chartType === "pie") &&
    data.every((d) => !d.value);
  if (!data || data.length === 0 || allZero) {
    return (
      <div style={{ padding: 16, color: "#999", textAlign: "center" }}>
        No data
      </div>
    );
  }

  const commonProps = {
    config: item.config || {},
    data,
    rawConfig: item.raw_config,
    rawOverrides: item.raw_overrides,
  };

  // Pie/doughnut slice callout labels overlap badly when options have
  // long names on a cramped card. akvo-charts' Doughnut/Pie doesn't
  // accept a label-config prop, but the underlying ECharts instance
  // does — use a ref to setOption({series: [{label:{show:false}}]})
  // after mount. notMerge=false preserves dataset + encode bindings.
  const isPie = chartType === "doughnut" || chartType === "pie";
  if (isPie) {
    return (
      <PieWithHiddenLabels commonProps={commonProps} Component={Component} />
    );
  }

  return <Component {...commonProps} />;
};

ChartRenderer.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  today: PropTypes.instanceOf(Date),
  definitionsById: PropTypes.instanceOf(Map),
  complianceResponses: PropTypes.object,
};

export { useDashboardProgress };
export default ChartRenderer;
