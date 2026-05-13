import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import * as echarts from "echarts";

/**
 * Returns true when v satisfies all defined threshold bounds.
 * threshold.max: v must be ≤ max; threshold.min: v must be ≥ min.
 */
const checkCompliant = (v, threshold) => {
  if (!threshold) {
    return true;
  }
  if (typeof threshold.max === "number" && v > threshold.max) {
    return false;
  }
  if (typeof threshold.min === "number" && v < threshold.min) {
    return false;
  }
  return true;
};

/**
 * Sort values, assign rank-based jitter in [-JITTER, +JITTER], split into
 * compliant (blue) and non-compliant (red) scatter datasets.
 * Deterministic rank ordering keeps the chart stable across re-renders.
 */
const buildSeries = (rows, threshold) => {
  const values = rows
    .map((r) => Number(r.value))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  const JITTER = 0.38;
  const compliant = [];
  const nonCompliant = [];

  // Count occurrences per value for tooltip and jitter calculation.
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));

  // Track rank within each value group so jitter is per-group, not global.
  // Single dots (count=1) get y=0. Groups spread evenly in [-JITTER, +JITTER].
  // This prevents the "ascending curve" artifact where high-x dots accumulate
  // high global-rank jitter, falsely implying a value–density correlation.
  const rankWithin = new Map();
  values.forEach((v) => {
    const rank = rankWithin.get(v) || 0;
    const n = counts.get(v);
    const jitter = n > 1 ? (rank / (n - 1) - 0.5) * 2 * JITTER : 0;
    rankWithin.set(v, rank + 1);
    if (checkCompliant(v, threshold)) {
      compliant.push([v, jitter]);
    } else {
      nonCompliant.push([v, jitter]);
    }
  });

  return { compliant, nonCompliant, counts };
};

const BLUE_ZONE = "rgba(91,143,249,0.08)";
const RED_ZONE = "rgba(231,76,60,0.08)";
const LARGE = 1e9;

const buildMarkAreaData = (threshold) => {
  if (!threshold) {
    return [];
  }
  const hasMax = typeof threshold.max === "number";
  const hasMin = typeof threshold.min === "number";
  if (hasMax && !hasMin) {
    const zones = [];
    if (threshold.max > 0) {
      zones.push([
        { xAxis: 0, itemStyle: { color: BLUE_ZONE } },
        { xAxis: threshold.max },
      ]);
    }
    zones.push([
      { xAxis: threshold.max, itemStyle: { color: RED_ZONE } },
      { xAxis: LARGE },
    ]);
    return zones;
  }
  if (hasMin && !hasMax) {
    return [
      [{ xAxis: 0, itemStyle: { color: RED_ZONE } }, { xAxis: threshold.min }],
      [
        { xAxis: threshold.min, itemStyle: { color: BLUE_ZONE } },
        { xAxis: LARGE },
      ],
    ];
  }
  if (hasMin && hasMax) {
    return [
      [{ xAxis: 0, itemStyle: { color: RED_ZONE } }, { xAxis: threshold.min }],
      [
        { xAxis: threshold.min, itemStyle: { color: BLUE_ZONE } },
        { xAxis: threshold.max },
      ],
      [
        { xAxis: threshold.max, itemStyle: { color: RED_ZONE } },
        { xAxis: LARGE },
      ],
    ];
  }
  return [];
};

const buildOption = (rows, threshold, config) => {
  const axisLabel = config?.xAxisLabel || "";
  const entityLabel = config?.entity_label || "";
  const { compliant, nonCompliant, counts } = buildSeries(rows, threshold);

  const allValues = rows
    .map((r) => Number(r.value))
    .filter((v) => Number.isFinite(v));
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 0;
  const threshMax = typeof threshold?.max === "number" ? threshold.max : 0;
  const threshMin = typeof threshold?.min === "number" ? threshold.min : 0;
  const rawMax = Math.max(dataMax, threshMax, threshMin);
  const axisMax = rawMax === 0 ? 1 : null;

  const markLineData = [];
  if (threshold) {
    if (typeof threshold.max === "number") {
      markLineData.push({
        xAxis: threshold.max,
        lineStyle: { color: "#e74c3c", width: 2, type: "dashed" },
        label: { show: false },
      });
    }
    if (typeof threshold.min === "number") {
      markLineData.push({
        xAxis: threshold.min,
        lineStyle: { color: "#e74c3c", width: 2, type: "dashed" },
        label: { show: false },
      });
    }
  }

  const markAreaData = buildMarkAreaData(threshold);

  const tooltipFormatter = (params) => {
    const v = params.value[0];
    const cnt = counts.get(v) || 1;
    const noun = entityLabel ? ` ${entityLabel}` : "";
    const suffix = cnt > 1 ? ` (${cnt}${noun})` : "";
    return `Value: ${v} ${axisLabel}${suffix}`;
  };

  const scatterBase = { type: "scatter", symbolSize: 8 };

  return {
    grid: { top: 16, right: 24, bottom: 48, left: 24 },
    tooltip: { trigger: "item", formatter: tooltipFormatter },
    xAxis: {
      type: "value",
      name: axisLabel,
      nameLocation: "middle",
      nameGap: 32,
      min: 0,
      ...(axisMax !== null ? { max: axisMax } : {}),
    },
    yAxis: {
      type: "value",
      min: -0.5,
      max: 0.5,
      show: false,
      splitLine: { show: false },
    },
    series: [
      {
        ...scatterBase,
        name: "Compliant",
        data: compliant,
        itemStyle: { color: "#5b8ff9" },
        ...(markLineData.length > 0
          ? {
              markLine: {
                symbol: "none",
                silent: true,
                animation: false,
                data: markLineData,
              },
            }
          : {}),
        ...(markAreaData.length > 0
          ? { markArea: { silent: true, data: markAreaData } }
          : {}),
      },
      {
        ...scatterBase,
        name: "Above threshold",
        data: nonCompliant,
        itemStyle: { color: "#e74c3c" },
      },
    ],
  };
};

const DotStripChart = ({ rows, threshold, config }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || rows.length === 0) {
      return () => {};
    }

    const chart =
      echarts.getInstanceByDom(container) || echarts.init(container);
    chart.setOption(buildOption(rows, threshold, config), true);
    chart.resize();

    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
    };
  }, [rows, threshold, config]);

  return <div ref={containerRef} style={{ height: 120, width: "100%" }} />;
};

DotStripChart.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  threshold: PropTypes.shape({
    min: PropTypes.number,
    max: PropTypes.number,
  }),
  config: PropTypes.shape({
    xAxisLabel: PropTypes.string,
    entity_label: PropTypes.string,
  }),
};

export default DotStripChart;
