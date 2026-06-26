import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card, Empty } from "antd";
import { Line } from "akvo-charts";

import {
  findQuestionByName,
  formatDate,
  getText,
  optionSeverity,
  resolveOption,
} from "../utils";

const RISK_BUCKETS = 5; // OK · Low · Med · High · Critical

const scoreSubmission = (submission, questions) =>
  (questions || []).reduce((score, name) => {
    const answer = submission.answers?.[name];
    const value = Array.isArray(answer) ? answer[0] : answer;
    const sev = optionSeverity(
      resolveOption(findQuestionByName(name), value).color
    );
    return score + (sev === "red" ? 2 : sev === "amber" ? 1 : 0);
  }, 0);

const toBucket = (score) => {
  if (score === 0) {
    return 0;
  }
  if (score <= 2) {
    return 1;
  }
  if (score <= 4) {
    return 2;
  }
  if (score <= 6) {
    return 3;
  }
  return 4;
};

// Legend explaining the OK · Low · Med · High · Critical risk-score levels.
const RISK_LEGEND = [
  { key: "Ok", color: "#52c41a" },
  { key: "Low", color: "#a0d911" },
  { key: "Med", color: "#faad14" },
  { key: "High", color: "#fa8c16" },
  { key: "Critical", color: "#f5222d" },
];

const RiskLegend = ({ text }) => (
  <div className="site-profile-risk-legend">
    {RISK_LEGEND.map((level) => (
      <span key={level.key} className="site-profile-risk-legend-item">
        <i style={{ backgroundColor: level.color }} />
        <b>{getText(text, `siteProfileRisk${level.key}`, level.key)}</b>
        <span>{getText(text, `siteProfileRisk${level.key}Desc`, "")}</span>
      </span>
    ))}
  </div>
);

RiskLegend.propTypes = {
  text: PropTypes.object,
};

/**
 * akvo-charts <Line> with a compact grid and optional overrides (threshold
 * band + dashed limit lines, or a categorical y-axis). akvo-charts doesn't
 * expose these, so we grab the ECharts instance via a ref and setOption.
 */
const ConfiguredLine = ({ config, data, bounds, lines, yAxis }) => {
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
    const opts = {
      grid: { top: 16, right: 12, bottom: 36, left: 8, containLabel: true },
      xAxis: { axisLabel: { rotate: 30, hideOverlap: true } },
      yAxis: yAxis || { min: 0 },
    };
    const series = {};
    if (bounds) {
      series.markArea = {
        silent: true,
        itemStyle: { color: "rgba(82, 196, 26, 0.12)" },
        data: [[{ yAxis: bounds.lo }, { yAxis: bounds.hi }]],
      };
    }
    if (lines.length) {
      series.markLine = {
        silent: true,
        symbol: "none",
        label: { show: false },
        lineStyle: { type: "dashed", color: "#999" },
        data: lines.map((y) => ({ yAxis: y })),
      };
    }
    if (bounds || lines.length) {
      opts.series = [series];
    }
    chart.setOption(opts, false);
  }, [chart, config, data, bounds, lines, yAxis]);

  return <Line ref={setRef} config={config} data={data} />;
};

ConfiguredLine.propTypes = {
  config: PropTypes.object.isRequired,
  data: PropTypes.array.isRequired,
  bounds: PropTypes.shape({ lo: PropTypes.number, hi: PropTypes.number }),
  lines: PropTypes.array.isRequired,
  yAxis: PropTypes.object,
};

const HistoryChart = ({ item, recordContext }) => {
  const text = useMemo(() => recordContext?.text || {}, [recordContext]);
  const question = findQuestionByName(item.question);
  const isRiskScore = item.source === "risk_score";

  const data = useMemo(() => {
    if (isRiskScore) {
      const submissions = recordContext?.payload?.submissions || [];
      return submissions
        .slice()
        .reverse()
        .map((submission) => ({
          label: formatDate(submission.date),
          value: toBucket(scoreSubmission(submission, item.questions)),
        }));
    }
    const history = recordContext?.payload?.history?.[item.question] || [];
    return history
      .map((row) => ({ label: formatDate(row.date), value: Number(row.value) }))
      .filter((row) => !Number.isNaN(row.value));
  }, [recordContext, item.question, item.questions, isRiskScore]);

  const riskLabels = useMemo(
    () => [
      getText(text, "siteProfileRiskOk", "OK"),
      getText(text, "siteProfileRiskLow", "Low"),
      getText(text, "siteProfileRiskMed", "Med"),
      getText(text, "siteProfileRiskHigh", "High"),
      getText(text, "siteProfileRiskCritical", "Critical"),
    ],
    [text]
  );

  const yAxis = useMemo(() => {
    if (!isRiskScore) {
      return null;
    }
    return {
      min: 0,
      max: RISK_BUCKETS,
      interval: 1,
      axisLabel: { formatter: (value) => riskLabels[value] || "" },
    };
  }, [isRiskScore, riskLabels]);

  const bounds = useMemo(() => {
    const min = item.threshold?.min;
    const max = item.threshold?.max;
    const hasMin = typeof min === "number";
    const hasMax = typeof max === "number";
    if (isRiskScore || (!hasMin && !hasMax)) {
      return null;
    }
    const lo = hasMin ? min : 0;
    const hi = hasMax ? max : min;
    return hi > lo ? { lo, hi } : null;
  }, [item.threshold, isRiskScore]);

  const lines = useMemo(
    () =>
      isRiskScore
        ? []
        : [item.threshold?.min, item.threshold?.max].filter(
            (v) => typeof v === "number"
          ),
    [item.threshold, isRiskScore]
  );

  const title = getText(text, item.label_key, item.label || question?.label);
  const config = useMemo(
    () => ({
      title: "",
      xAxisLabel: "",
      yAxisLabel: isRiskScore ? "" : item.unit || "",
      legend: { show: false },
      ...(item.config || {}),
    }),
    [item.unit, item.config, isRiskScore]
  );

  return (
    <Card title={title} size="small" className="history-chart-card" bordered>
      {data.length ? (
        <>
          <ConfiguredLine
            config={config}
            data={data}
            bounds={bounds}
            lines={lines}
            yAxis={yAxis}
          />
          {isRiskScore ? <RiskLegend text={text} /> : null}
        </>
      ) : (
        <Empty description={text.siteProfileNoData} />
      )}
    </Card>
  );
};

HistoryChart.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default HistoryChart;
