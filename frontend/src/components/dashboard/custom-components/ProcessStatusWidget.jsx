import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import ReactECharts from "echarts-for-react";
import { Alert, Card, Skeleton, Typography } from "antd";
import { useDashboardValues } from "../../../util/hooks";
import {
  computeProcessBars,
  distinctParentCount,
} from "../compute/processStatus";
import FormulaInfo from "../widgets/FormulaInfo";

const { Text } = Typography;

/** Invisible fetcher; reports a keyed /values result up to the parent. */
const Fetcher = ({
  fetchKey,
  api,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  parentFormId,
  onData,
}) => {
  const { data, loading, error } = useDashboardValues(api, filterState, {
    fiscalYearStartMonth,
    customFilterDefs,
    parentFormId,
  });

  useEffect(() => {
    onData(fetchKey, { data, loading, error });
  }, [fetchKey, data, loading, error, onData]);

  return null;
};

Fetcher.propTypes = {
  fetchKey: PropTypes.string.isRequired,
  api: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onData: PropTypes.func.isRequired,
};

Fetcher.defaultProps = {
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  parentFormId: null,
};

const buildFooter = (template, { n, absentCount }) => {
  if (!template) {
    return null;
  }
  const operating = n - absentCount;
  return template
    .replace("{operating}", operating)
    .replace("{total}", n)
    .replace("{n}", n);
};

const chartOption = (bars, labelWidth) => ({
  grid: {
    left: labelWidth + 12,
    right: 28,
    top: 8,
    bottom: 28,
    containLabel: false,
  },
  tooltip: {
    trigger: "item",
    formatter: (p) => `${p.name}: <b>${p.value}</b>`,
  },
  xAxis: {
    type: "value",
    minInterval: 1,
    splitLine: { lineStyle: { color: "#eef1f4" } },
    axisLabel: { color: "#8a929b" },
  },
  yAxis: {
    type: "category",
    inverse: true,
    data: bars.map((b) => b.label),
    axisTick: { show: false },
    axisLine: { show: false },
    axisLabel: { width: labelWidth, overflow: "truncate", color: "#5a626b" },
  },
  series: [
    {
      type: "bar",
      barMaxWidth: 16,
      data: bars.map((b) => ({
        value: b.count,
        itemStyle: { color: b.color },
      })),
      label: { show: false },
    },
  ],
});

/**
 * Treatment Units Functionality per-process card.
 *
 * Renders one process question as a tone-colored horizontal bar (one bar per
 * status option) with a right-aligned subtitle and a footer caption such as
 * "12 plants have primary clarifier in use." Self-fetching like
 * StageFlowWidget: `api` (group_by:option) drives the bars and `usage_api`
 * (group_by:parent_id) counts the distinct plants for the footer.
 *
 * `footer_template` placeholders: {n} distinct plants, {operating} = {n} minus
 * the `absent_value` option's count (e.g. plants operating an influent pump
 * station), {total} = {n}.
 */
const ProcessStatusWidget = ({
  item,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  parentFormId,
}) => {
  const [results, setResults] = useState({});
  const onData = useCallback((key, payload) => {
    setResults((prev) =>
      prev[key] === payload ? prev : { ...prev, [key]: payload }
    );
  }, []);

  const fetchers = useMemo(() => {
    const list = [{ key: "options", api: item.api }];
    if (item.usage_api) {
      list.push({ key: "usage", api: item.usage_api });
    }
    return list;
  }, [item.api, item.usage_api]);

  const loading = fetchers.some(
    (f) => !results[f.key] || results[f.key]?.loading
  );
  const error = fetchers.map((f) => results[f.key]?.error).find(Boolean);

  const bars = useMemo(
    () => computeProcessBars(item.options, results.options?.data),
    [item.options, results.options]
  );
  const n = item.usage_api
    ? distinctParentCount(results.usage?.data)
    : bars.reduce((sum, b) => sum + b.count, 0);
  const absentCount = item.absent_value
    ? bars.find((b) => b.value === item.absent_value)?.count || 0
    : 0;
  const footer = buildFooter(item.footer_template, { n, absentCount });

  const labelWidth = item.label_width || 200;
  const height = item.height || Math.max(160, bars.length * 26 + 56);
  const title = item.title || item.label || "Process";

  return (
    <Card className="chart-card process-status">
      <div className="condition-matrix-head">
        <h4 className="condition-matrix-title">
          {title}
          <FormulaInfo info={item.info} title={title} />
        </h4>
        {item.subtitle && (
          <Text type="secondary" className="condition-matrix-subtitle">
            {item.subtitle}
          </Text>
        )}
      </div>
      {fetchers.map((f) => (
        <Fetcher
          key={f.key}
          fetchKey={f.key}
          api={f.api}
          filterState={filterState}
          fiscalYearStartMonth={fiscalYearStartMonth}
          customFilterDefs={customFilterDefs}
          parentFormId={parentFormId}
          onData={onData}
        />
      ))}
      {error ? (
        <Alert
          type="error"
          message={`Failed to load ${item.id}: ${error.message || "error"}`}
        />
      ) : loading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        <>
          <ReactECharts
            option={chartOption(bars, labelWidth)}
            notMerge
            style={{ height, width: "100%" }}
          />
          {footer && (
            <Text type="secondary" className="process-status-footer">
              {footer}
            </Text>
          )}
        </>
      )}
    </Card>
  );
};

ProcessStatusWidget.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string,
    label: PropTypes.string,
    subtitle: PropTypes.string,
    api: PropTypes.object.isRequired,
    usage_api: PropTypes.object,
    options: PropTypes.array.isRequired,
    footer_template: PropTypes.string,
    absent_value: PropTypes.string,
    label_width: PropTypes.number,
    height: PropTypes.number,
  }).isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

ProcessStatusWidget.defaultProps = {
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  parentFormId: null,
};

export default ProcessStatusWidget;
