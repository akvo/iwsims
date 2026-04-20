import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PropTypes from "prop-types";
import { Bar, Doughnut, Line, Pie, StackBar } from "akvo-charts";
import { Alert, Skeleton } from "antd";
import { useDashboardValues, useDashboardProgress } from "../../util/hooks";
import { toHistogramBarData } from "./compute/progressHistogram";
import { computeComplianceStackData } from "./compute/compliance";
import { rotateToFiscalOrder } from "./compute/fiscalMonthRotation";
import { toValueHistogramBins } from "./compute/valueHistogramBins";
import DotsChart from "./DotsChart";

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

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Resolve a mark-line descriptor's on-axis position. Literal `value` wins;
 * otherwise `type: "today"` is rendered against `today` using `format`:
 *  - month_short     → "Apr"       (fiscal-year month axes)
 *  - month_year_short→ "Apr 2026"  (backend "%b %Y" labels)
 *  - iso_date        → "2026-04-16"
 *  - year            → "2026"
 */
const resolveMarkValue = (mark, today) => {
  if (mark.type === "today" && today instanceof Date) {
    const fmt = mark.format || "month_short";
    if (fmt === "month_short") {
      return MONTHS_SHORT[today.getUTCMonth()];
    }
    if (fmt === "month_year_short") {
      return `${MONTHS_SHORT[today.getUTCMonth()]} ${today.getUTCFullYear()}`;
    }
    if (fmt === "iso_date") {
      return today.toISOString().slice(0, 10);
    }
    if (fmt === "year") {
      return String(today.getUTCFullYear());
    }
  }
  return mark.value;
};

const toEchartsMarkData = (marks, today) =>
  marks
    .map((m) => {
      const v = resolveMarkValue(m, today);
      if (typeof v === "undefined" || v === null) {
        return null;
      }
      // Histograms use category axes with string labels — passing a number
      // would be treated by ECharts as a category *index* (wrong). Coerce
      // to string so threshold 6.5 lands on the "6.5" bin. For true value
      // axes, ECharts parses the string back to a number transparently.
      const axisValue = typeof v === "number" ? String(v) : v;
      const point =
        m.axis === "y" ? { yAxis: axisValue } : { xAxis: axisValue };
      point.lineStyle = {
        color: m.color || "#e74c3c",
        width: m.width || 2,
        type: m.dash ? "dashed" : "solid",
      };
      if (m.label) {
        point.label = {
          show: true,
          formatter: m.label,
          position: m.label_position || "end",
          color: m.color || "#e74c3c",
        };
      } else {
        point.label = { show: false };
      }
      return point;
    })
    .filter(Boolean);

/**
 * Wrap a non-pie Component so we can draw configurable reference lines
 * (threshold, today, arbitrary values) on top. Uses ECharts' native
 * `series.markLine` (https://echarts.apache.org/en/option.html#series-bar.markLine)
 * via setOption({series:[{markLine:{...}}]}, notMerge=false) so the markLine
 * is merged into the existing dataset/encode series.
 *
 * akvo-charts exposes the ECharts instance via useImperativeHandle but the
 * instance only becomes non-null on its 2nd internal render (after init).
 * A plain useRef + useEffect misses that transition because the parent
 * doesn't re-render when the child updates its own state. A *callback ref*
 * routes the imperative-handle value into our own state, forcing a parent
 * re-render when the instance becomes available — so our effect runs with
 * a valid chart, after akvo-charts' own setOption (child effects run first).
 */
const ChartWithMarkLines = ({ Component, commonProps, markLines, today }) => {
  const [chart, setChart] = useState(null);
  const setRef = useCallback((instance) => {
    if (instance && typeof instance.setOption === "function") {
      // useImperativeHandle re-invokes callback refs every child render;
      // bail if we already captured the instance to avoid a state-update loop.
      setChart((prev) => prev || instance);
    }
  }, []);
  useEffect(() => {
    if (!chart) {
      return;
    }
    const data = toEchartsMarkData(markLines, today);
    if (data.length === 0) {
      return;
    }
    chart.setOption(
      {
        // On narrow viewports (e.g. 1024×768) many-entry legends wrap onto
        // multiple rows and collide with the y-axis title. Pagination via
        // `type: "scroll"` keeps the legend on a single row.
        legend: { type: "scroll" },
        series: [
          {
            markLine: {
              symbol: "none",
              silent: true,
              animation: false,
              data,
            },
          },
        ],
      },
      false
    );
  }); // No deps: re-apply after every render because akvo-charts' own
  // setOption re-runs on each render (its getOptions dep is a fresh fn).
  return <Component ref={setRef} {...commonProps} />;
};

ChartWithMarkLines.propTypes = {
  Component: PropTypes.elementType.isRequired,
  commonProps: PropTypes.object.isRequired,
  markLines: PropTypes.array.isRequired,
  today: PropTypes.instanceOf(Date),
};

/**
 * Wrap a Cartesian akvo-chart (bar/line/stack_bar) so we can force the
 * legend into pagination mode — otherwise many-entry legends wrap onto
 * multiple rows on narrow viewports and collide with the y-axis title.
 * Uses the same callback-ref + setOption(notMerge=false) trick as
 * ChartWithMarkLines to layer the override on top of akvo-charts' own
 * setOption (which runs first each render).
 */
const ChartWithScrollLegend = ({ Component, commonProps }) => {
  const [chart, setChart] = useState(null);
  const setRef = useCallback((instance) => {
    if (instance && typeof instance.setOption === "function") {
      setChart((prev) => prev || instance);
    }
  }, []);
  useEffect(() => {
    if (!chart) {
      return;
    }
    chart.setOption({ legend: { type: "scroll" } }, false);
  }); // No deps: see ChartWithMarkLines note.
  return <Component ref={setRef} {...commonProps} />;
};

ChartWithScrollLegend.propTypes = {
  Component: PropTypes.elementType.isRequired,
  commonProps: PropTypes.object.isRequired,
};

/**
 * Build the resolved mark-lines list for an item. Explicit `item.mark_lines`
 * takes precedence; otherwise we auto-derive from the `threshold` block that
 * histogram items already carry ({ max?: number, min?: number }) so existing
 * configs get a threshold line for free.
 */
const deriveMarkLines = (item) => {
  if (Array.isArray(item.mark_lines) && item.mark_lines.length > 0) {
    return item.mark_lines;
  }
  if (item.chart_type === "histogram" && item.threshold) {
    const result = [];
    if (typeof item.threshold.max === "number") {
      result.push({ axis: "x", value: item.threshold.max });
    }
    if (typeof item.threshold.min === "number") {
      result.push({ axis: "x", value: item.threshold.min });
    }
    return result;
  }
  return [];
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
  const isDots = item.chart_type === "dots";

  const isApiDriven =
    (Boolean(Component) || isDots) &&
    Boolean(item.api) &&
    !item.compute &&
    !item.source;

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
      // Value-axis histograms (water-quality parameters): bin per-EPS
      // numeric measurements into [binStart, binStart+binWidth) buckets.
      // Thresholds are forced into the bin range so markLines anchor even
      // when data is sparse (single-sample pH would otherwise hide the
      // 6.5 / 8.5 reference lines).
      if (
        item.display?.mode === "histogram" &&
        typeof item.display?.bin_width === "number"
      ) {
        const extendTo = [];
        if (typeof item.threshold?.min === "number") {
          extendTo.push(item.threshold.min);
        }
        if (typeof item.threshold?.max === "number") {
          extendTo.push(item.threshold.max);
        }
        return toValueHistogramBins(rows, item.display.bin_width, {
          extendTo,
        });
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

  if (!Component && !isDots) {
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

  // Empty state: no rows, OR all-zero for pie/doughnut/dots (these
  // render a blank canvas or equal-sized slices otherwise — misleading).
  const allZero =
    (chartType === "doughnut" || chartType === "pie" || isDots) &&
    data.every((d) => !d.value);
  if (!data || data.length === 0 || allZero) {
    return (
      <div style={{ padding: 16, color: "#999", textAlign: "center" }}>
        No data
      </div>
    );
  }

  if (isDots) {
    return <DotsChart data={data} colors={item.colors} height={item.height} />;
  }

  const rawOverrides =
    chartType === "bar" && item.chart_type !== "histogram"
      ? {
          xAxis: { axisTick: { alignWithLabel: true } },
          ...(item.raw_overrides || {}),
        }
      : item.raw_overrides;

  const commonProps = {
    config: item.config || {},
    data,
    rawConfig: item.raw_config,
    rawOverrides,
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

  const markLines = deriveMarkLines(item);
  if (markLines.length > 0) {
    return (
      <ChartWithMarkLines
        commonProps={commonProps}
        Component={Component}
        markLines={markLines}
        today={today}
      />
    );
  }

  return (
    <ChartWithScrollLegend commonProps={commonProps} Component={Component} />
  );
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
