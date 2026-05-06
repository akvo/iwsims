import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card, Empty } from "antd";
import { Line } from "akvo-charts";
import { sortByDateAscending } from "./helpers";

const baseConfig = {
  horizontal: false,
  legend: { show: false },
  textStyle: { fontFamily: "Arial" },
};

const numericValue = (raw) => {
  if (raw === null || typeof raw === "undefined" || raw === "") {
    return null;
  }
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
};

// pages/dashboard/style.scss applies `min-height: 320px` to every
// akvo-charts `div[role="figure"]`, so we match the empty state to the
// same floor — empty cards then align with chart cards in the same row.
const FIGURE_MIN_HEIGHT = 320;

/**
 * <Line> with rotated x-axis labels. akvo-charts doesn't expose axisLabel
 * config, so we grab the ECharts instance via callback ref and setOption
 * after mount — same pattern as ChartRenderer's ChartWithScrollLegend.
 */
const LineWithRotatedAxis = ({ config, data }) => {
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
        xAxis: {
          axisTick: { alignWithLabel: true },
          axisLabel: { rotate: 45, interval: "auto", hideOverlap: true },
          nameGap: 64,
          nameLocation: "middle",
        },
      },
      false
    );
  }); // No deps: re-apply after every render (akvo-charts re-runs setOption each render).
  return <Line ref={setRef} config={config} data={data} />;
};

LineWithRotatedAxis.propTypes = {
  config: PropTypes.object.isRequired,
  data: PropTypes.array.isRequired,
};

/**
 * akvo-charts <Line> wrapped with optional threshold band (markArea). Sorts
 * data ascending by `label` (treated as a date string) before render.
 */
const HistoricalLineChart = ({
  title,
  data,
  thresholdMin,
  thresholdMax,
  unit,
}) => {
  const sorted = useMemo(() => {
    return sortByDateAscending(
      (data || []).map((row) => ({ date: row?.label, ...row }))
    );
  }, [data]);

  const seriesData = useMemo(() => {
    return sorted
      .map((row) => ({
        label: row?.label,
        value: numericValue(row?.value),
      }))
      .filter((row) => row.value !== null);
  }, [sorted]);

  const chartConfig = useMemo(() => {
    // No `title` here — the AntD <Card> header already shows it. Height is
    // driven by div[role="figure"]'s SCSS min-height.
    const cfg = {
      ...baseConfig,
      xAxisLabel: "Date",
      yAxisLabel: unit || "",
    };
    const hasMin = typeof thresholdMin === "number";
    const hasMax = typeof thresholdMax === "number";
    if (hasMin || hasMax) {
      const lo = hasMin ? thresholdMin : -Infinity;
      const hi = hasMax ? thresholdMax : Infinity;
      cfg.rawConfig = {
        markArea: {
          itemStyle: { color: "rgba(82, 196, 26, 0.12)" },
          data: [[{ yAxis: lo }, { yAxis: hi }]],
        },
      };
    }
    return cfg;
  }, [unit, thresholdMin, thresholdMax]);

  const body =
    seriesData.length === 0 ? (
      <div
        style={{
          minHeight: FIGURE_MIN_HEIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Empty description="No history yet" />
      </div>
    ) : (
      <LineWithRotatedAxis config={chartConfig} data={seriesData} />
    );

  return (
    <Card title={title} size="small" bordered>
      {body}
    </Card>
  );
};

HistoricalLineChart.propTypes = {
  title: PropTypes.string.isRequired,
  data: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string,
      value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    })
  ),
  thresholdMin: PropTypes.number,
  thresholdMax: PropTypes.number,
  unit: PropTypes.string,
};

HistoricalLineChart.defaultProps = {
  data: [],
};

export default HistoricalLineChart;
