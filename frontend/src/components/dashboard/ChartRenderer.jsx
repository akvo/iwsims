import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Bar, Doughnut, Line, Pie, StackBar } from "akvo-charts";
import { Alert, Skeleton } from "antd";
import { useDashboardValues, useDashboardProgress } from "../../util/hooks";
import uiText from "../../lib/ui-text";
import { toHistogramBarData } from "./compute/progressHistogram";
import { computeComplianceStackData } from "./compute/compliance";
import { rotateToFiscalOrder } from "./compute/fiscalMonthRotation";
import { toValueHistogramBins } from "./compute/valueHistogramBins";
import { computeCrossTab } from "./compute/crossTab";
import { computeAccessibilityBucket } from "./compute/accessibility";
import { computeKpiStack } from "./compute/kpiStack";
import DotsChart from "./DotsChart";
import DotStripChart from "./DotStripChart";

const COMPONENT_BY_TYPE = {
  bar: Bar,
  doughnut: Doughnut,
  half_doughnut: Doughnut,
  line: Line,
  pie: Pie,
  stack_bar: StackBar,
};

const NO_INFO_COLOR = "#bfbfbf";

/**
 * akvo-charts' `transformConfig` hardcodes its default tooltip and does NOT
 * read `config.tooltip` — so a tooltip block in the visualization JSON is
 * silently dropped. Surface it here as a setOption patch so configs can
 * customise trigger / formatter (string template, HTML, or rich-text via
 * https://echarts.apache.org/examples/en/editor.html?c=pie-rich-text) per
 * chart. Returned object is spread into the wrapper's setOption call with
 * notMerge=false so unspecified fields keep akvo-charts' defaults.
 */
const tooltipPatch = (config) =>
  config?.tooltip ? { tooltip: config.tooltip } : {};

/**
 * Reshape ChartRenderer's `[{label, value}]` rows into ECharts' native
 * pie data format `[{name, value}]`. Used by the pie/doughnut wrappers to
 * override `series[0].data` post-mount and bypass akvo-charts' dataset
 * +encode binding — that binding causes the tooltip's `{c}` placeholder
 * to render the dataset row object as "[object Object]" instead of the
 * scalar value (only an issue for pie series; bar/line resolve scalars
 * correctly from dataset+encode because they have axes).
 */
const toPieSeriesData = (rows) =>
  (rows || []).map((r) => ({
    name: r.label,
    value: r.value,
    ...(r.label === uiText.en.noInformationAvailable
      ? { itemStyle: { color: NO_INFO_COLOR } }
      : {}),
  }));

/**
 * Wrap a pie/doughnut Component so we can hide the outer slice callout
 * labels after mount AND swap dataset+encode for direct `series.data` so
 * tooltip `{c}` resolves to the scalar value (matches the official
 * https://echarts.apache.org/examples/en/editor.html?c=pie-rich-text
 * tooltip-formatter behaviour).
 *
 * akvo-charts doesn't expose label-config or data-binding props, so we
 * grab the ECharts instance via ref and setOption with notMerge=false to
 * layer overrides on top of akvo-charts' own setOption (which runs first
 * each render).
 *
 * Uses the same callback-ref + empty-deps pattern as ChartWithMarkLines
 * (see long comment there): akvo-charts' useImperativeHandle only
 * exposes a non-null instance on its 2nd internal render, so a plain
 * useRef would never fire setOption against a real chart.
 */
const PieWithHiddenLabels = ({ Component, commonProps }) => {
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
    chart.setOption(
      {
        series: [
          {
            label: { show: false },
            labelLine: { show: false },
            data: toPieSeriesData(commonProps.data),
          },
        ],
        ...tooltipPatch(commonProps.config),
      },
      false
    );
  }); // No deps: re-apply after every render because akvo-charts' own
  // setOption re-runs on each render (its getOptions dep is a fresh fn).
  return <Component ref={setRef} {...commonProps} />;
};

PieWithHiddenLabels.propTypes = {
  Component: PropTypes.elementType.isRequired,
  commonProps: PropTypes.object.isRequired,
};

/**
 * Render akvo-charts' <Doughnut> as an upper half-donut (arc from 180°
 * to 360°, opening at the bottom — see
 * https://echarts.apache.org/examples/en/editor.html?c=pie-half-donut).
 *
 * akvo-charts' Doughnut doesn't expose start/end-angle props, so we grab
 * the ECharts instance and setOption(..., notMerge=false) which merges
 * into the existing dataset + encode binding. Legend is pushed to the
 * bottom so the two halves balance visually.
 *
 * Uses the callback-ref + empty-deps pattern (see ChartWithMarkLines
 * comment) because akvo-charts' useImperativeHandle exposes the instance
 * only on its 2nd render, and it re-runs its own setOption on every
 * render — so our override has to re-apply on every render too.
 */
const HalfDoughnut = ({ Component, commonProps }) => {
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
    chart.setOption(
      {
        legend: { bottom: 0, left: "center", type: "scroll" },
        series: [
          {
            startAngle: 180,
            endAngle: 360,
            center: ["50%", "72%"],
            radius: ["55%", "85%"],
            label: { show: false },
            labelLine: { show: false },
            data: toPieSeriesData(commonProps.data),
          },
        ],
        ...tooltipPatch(commonProps.config),
      },
      false
    );
  }); // No deps: see ChartWithMarkLines note.
  return <Component ref={setRef} {...commonProps} />;
};

HalfDoughnut.propTypes = {
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
        // Align x-axis ticks with labels (instead of between them) so each
        // bar sits directly under its category — see
        // https://echarts.apache.org/examples/en/editor.html?c=bar-tick-align.
        // Harmless for line/stack_bar with category axes.
        xAxis: { axisTick: { alignWithLabel: true } },
        ...(commonProps.config?.yAxis
          ? { yAxis: commonProps.config.yAxis }
          : {}),
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
        ...tooltipPatch(commonProps.config),
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
  // Horizontal stack/bar charts (bar-y-category style — see
  // https://echarts.apache.org/examples/en/editor.html?c=bar-y-category)
  // put the category labels on the y-axis, so the per-item axis override
  // must follow the category axis rather than always landing on x.
  const horizontal = Boolean(commonProps.config?.horizontal);
  // Per-item overrides via config.xAxis: { rotate, interval, nameGap }.
  // Lets horizontal bar charts (numeric x-axis) opt out of the default
  // 20° rotation that exists for long category labels.
  const xAxisOverride = commonProps.config?.xAxis || {};
  useEffect(() => {
    if (!chart) {
      return;
    }
    // Align category-axis ticks with labels (not between them) — see
    // https://echarts.apache.org/examples/en/editor.html?c=bar-tick-align.
    // Force interval=0 so every category label renders; ECharts' default
    // "auto" silently drops labels it judges overlapping — which hid
    // Settlements / Government Stations / Healthcare Facility on the RWS
    // Beneficiaries bar (akvo-mis-db9). Modest rotate keeps long
    // multi-word labels from colliding horizontally. nameGap=64 pushes
    // the axis name (e.g. "Target group") below the rotated labels —
    // default nameGap=15 lands right on top of them (akvo-mis-c01).
    const categoryAxisOverride = {
      axisTick: { alignWithLabel: true },
      axisLabel: {
        interval: xAxisOverride?.axisLabel?.interval ?? 0,
        rotate: xAxisOverride?.axisLabel?.rotate ?? 0,
      },
      nameGap: xAxisOverride?.nameGap ?? 48,
      nameLocation: "middle",
    };
    const overrides = {
      legend: { type: "scroll" },
      ...(horizontal
        ? { yAxis: categoryAxisOverride }
        : { xAxis: categoryAxisOverride }),
      ...(commonProps.config?.yAxis && !horizontal
        ? { yAxis: commonProps.config.yAxis }
        : {}),
      ...tooltipPatch(commonProps.config),
    };

    // Color the "No information available" entry gray regardless of palette.
    // Two shapes of data arrive here:
    //  • Simple bar  [{label, value}, ...] — one series, per-item color via
    //    series.data + xAxis.data (switching away from dataset+encode).
    //  • kpi_stack   [{category, SeriesA: N, "No information available": M}]
    //    — one series per stack key; target by series name via chart.getOption().
    const noInfoLabel = uiText.en.noInformationAvailable;
    const chartData = commonProps.data || [];
    if (chartData.length > 0 && "label" in chartData[0]) {
      // Simple bar chart path.
      if (chartData.some((r) => r.label === noInfoLabel)) {
        const categoryLabels = chartData.map((r) => r.label);
        const axisWithData = {
          ...categoryAxisOverride,
          data: categoryLabels,
        };
        overrides.series = [
          {
            data: chartData.map((r) => ({
              value: r.value,
              ...(r.label === noInfoLabel
                ? { itemStyle: { color: NO_INFO_COLOR } }
                : {}),
            })),
          },
        ];
        if (horizontal) {
          overrides.yAxis = axisWithData;
        } else {
          overrides.xAxis = axisWithData;
        }
      }
    } else if (chartData.length > 0 && noInfoLabel in chartData[0]) {
      // kpi_stack path: find the series by name and set its itemStyle.
      const existingSeries = chart.getOption()?.series || [];
      const noInfoIdx = existingSeries.findIndex((s) => s.name === noInfoLabel);
      if (noInfoIdx !== -1) {
        overrides.series = existingSeries.map((_, i) =>
          i === noInfoIdx ? { itemStyle: { color: NO_INFO_COLOR } } : {}
        );
      }
    }

    chart.setOption(overrides, false);
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
 * @param {object} [complianceResponses]  DEPRECATED — use computeResponses.compliance.
 * @param {object} [computeResponses]     { [mode]: { [itemId]: /values response } }
 *                                         Unified prefetch map (mode ∈ {compliance,
 *                                         cross_tab, accessibility_bucket, kpi_stack}).
 */
const ChartRenderer = ({
  item,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  today,
  definitionsById,
  complianceResponses,
  computeResponses,
}) => {
  const chartType = item.chart_type === "histogram" ? "bar" : item.chart_type;
  const Component = COMPONENT_BY_TYPE[chartType];
  const isDots = item.chart_type === "dots";
  const isDotStrip = item.chart_type === "dot_strip";

  const isApiDriven =
    (Boolean(Component) || isDots || isDotStrip) &&
    Boolean(item.api) &&
    (!item.compute || (item.compute === "kpi_stack" && !item.segments)) &&
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
    if (item.compute === "cross_tab") {
      const responses = computeResponses?.cross_tab?.[item.id];
      return computeCrossTab(responses);
    }

    if (item.compute === "accessibility_bucket") {
      const responses = computeResponses?.accessibility_bucket?.[item.id];
      return computeAccessibilityBucket(responses, item.labels || {});
    }

    if (item.compute === "kpi_stack") {
      if (item.segments) {
        const responses = computeResponses?.kpi_stack?.[item.id];
        return computeKpiStack(
          item.segments,
          responses,
          item.config?.title || "Total"
        );
      }
      // api-driven kpi_stack: single /values call with group_by=option;
      // rows become stack segments dynamically
      const rows = apiData?.data || [];
      if (!rows.length) {
        return [];
      }
      const category = item.config?.title || "Total";
      const row = { category };
      rows.forEach((r) => {
        const label =
          r.group === "_no_info" ? uiText.en.noInformationAvailable : r.label;
        row[label] = r.value ?? 0;
      });
      return [row];
    }

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
      // When the chart opts into include_unanswered, read the universe
      // count fetched by ComplianceTotalsFetcher in Dashboard.jsx and
      // forward it to the compute helper so a third "_no_info" bar can
      // be appended. Spec: doc/claude/compliance-chart-no-info/.
      const complianceOptions = {
        noInfoLabel: uiText.en.noInformationAvailable,
      };
      if (item.include_unanswered === true) {
        const total = computeResponses?.compliance_totals?.[item.id];
        if (typeof total === "number") {
          // Only apply the universe count once every active parameter has a
          // response. If totalRegistered arrives before the param fetches the
          // gap formula (totalRegistered - 0 - 0) would render the entire
          // registered universe as "No information available".
          const activeNormalised = normalised.filter((p) => !p.hide);
          const allParamsLoaded =
            activeNormalised.length > 0 &&
            activeNormalised.every((p) => p.key in responsesByKey);
          if (allParamsLoaded) {
            complianceOptions.totalRegistered = total;
          }
        }
      }
      return computeComplianceStackData(
        normalised,
        responsesByKey,
        complianceOptions
      ).data;
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
      return rows.map((r) => ({
        label:
          r.group === "_no_info" ? uiText.en.noInformationAvailable : r.label,
        value: r.value,
      }));
    }
    return [];
  }, [
    item,
    apiData,
    isApiDriven,
    progressData,
    complianceResponses,
    complianceParams,
    computeResponses,
    fiscalYearStartMonth,
  ]);

  if (!Component && !isDots && !isDotStrip) {
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

  // Empty state: no rows, OR all-zero for pie/doughnut/half-donut/dots
  // (these render a blank canvas or equal-sized slices otherwise — misleading).
  const allZero =
    (chartType === "doughnut" ||
      chartType === "pie" ||
      chartType === "half_doughnut" ||
      isDots) &&
    data.every((d) => !d.value);
  if (!data || data.length === 0 || allZero) {
    return (
      <div style={{ padding: 16, color: "#999", textAlign: "center" }}>
        No data
      </div>
    );
  }

  if (isDotStrip) {
    const boxRows = apiData?.data || [];
    if (boxRows.length === 0) {
      return (
        <div style={{ padding: 16, color: "#999", textAlign: "center" }}>
          No data
        </div>
      );
    }
    return (
      <DotStripChart
        rows={boxRows}
        threshold={item.threshold}
        config={item.config}
      />
    );
  }

  if (isDots) {
    return <DotsChart data={data} colors={item.colors} height={item.height} />;
  }

  // NB: akvo-charts spreads `rawOverrides` into each *series* object
  // (not as top-level options), so axis/legend/grid overrides passed here
  // are no-ops — those live in the setOption-after-mount wrappers above.
  const rawOverrides = item.raw_overrides;

  // Schema flag → akvo-charts' StackBar/Bar `config.horizontal`, which
  // swaps axes (xAxis becomes value, yAxis becomes category) per
  // https://echarts.apache.org/examples/en/editor.html?c=bar-y-category.
  const horizontal = item.orientation === "horizontal";

  const commonProps = {
    config: {
      ...(item.config || {}),
      ...(horizontal ? { horizontal: true } : {}),
    },
    data,
    rawConfig: item.raw_config,
    rawOverrides,
  };

  // Half-donut variant (see https://echarts.apache.org/examples/en/editor.html?c=pie-half-donut).
  // Branches before the generic pie/doughnut path because it needs a
  // different ECharts overlay (start/end-angle + re-centered geometry).
  if (chartType === "half_doughnut") {
    return <HalfDoughnut commonProps={commonProps} Component={Component} />;
  }

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
  computeResponses: PropTypes.object,
};

export { useDashboardProgress };
export default ChartRenderer;
