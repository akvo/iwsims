import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import ReactECharts from "echarts-for-react";
import { Alert, Card, Skeleton, Typography } from "antd";
import { useDashboardValues } from "../../../util/hooks";
import { computeStageFlow } from "../compute/stageFlow";

const { Text } = Typography;

const StageFetcher = ({
  stage,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  parentFormId,
  onData,
}) => {
  const { data, loading, error } = useDashboardValues(stage.api, filterState, {
    fiscalYearStartMonth,
    customFilterDefs,
    parentFormId,
  });

  useEffect(() => {
    onData(stage.key, { data, loading, error });
  }, [stage.key, data, loading, error, onData]);

  return null;
};

StageFetcher.propTypes = {
  stage: PropTypes.shape({
    key: PropTypes.string.isRequired,
    api: PropTypes.object.isRequired,
  }).isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onData: PropTypes.func.isRequired,
};

StageFetcher.defaultProps = {
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  parentFormId: null,
};

const firstError = (stageResults) =>
  Object.values(stageResults).find((result) => result?.error)?.error;

const stageCards = (flow, item) => [
  {
    key: "__root",
    label: item.root_label || "All",
    value: flow.counts.all,
    tone: "root",
  },
  ...flow.steps.map((step) => ({
    key: step.key,
    label: step.label,
    value: step.passed,
    tone: "pass",
  })),
];

const failedBranches = (flow) =>
  flow.steps
    .filter((step) => step.failed > 0)
    .map((step) => ({
      key: `${step.key}-failed`,
      label: step.failLabel,
      value: step.failed,
    }));

const buildSummary = (flow, item) => {
  if (item.summary_template) {
    return item.summary_template
      .replace("{total}", flow.counts.all)
      .replace("{final}", flow.steps[flow.steps.length - 1]?.passed || 0);
  }
  const finalStep = flow.steps[flow.steps.length - 1];
  if (!finalStep) {
    return `Total: ${flow.counts.all}`;
  }
  return `Of ${flow.counts.all}: ${finalStep.passed} reached ${finalStep.label}.`;
};

const StageFlowWidget = ({
  item,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  parentFormId,
}) => {
  const [stageResults, setStageResults] = useState({});

  const onStageData = useCallback((key, payload) => {
    setStageResults((prev) =>
      prev[key] === payload ? prev : { ...prev, [key]: payload }
    );
  }, []);

  const totalResult = useDashboardValues(item.denominator_api, filterState, {
    fiscalYearStartMonth,
    customFilterDefs,
    parentFormId,
  });

  const loading =
    totalResult.loading ||
    (item.stages || []).some(
      (stage) => !stageResults[stage.key] || stageResults[stage.key]?.loading
    );
  const error = totalResult.error || firstError(stageResults);

  const responses = useMemo(() => {
    const out = {};
    (item.stages || []).forEach((stage) => {
      out[stage.key] = stageResults[stage.key]?.data;
    });
    return out;
  }, [item.stages, stageResults]);

  const flow = useMemo(() => {
    const total = totalResult.data?.data?.[0]?.value;
    return computeStageFlow({
      total,
      stages: item.stages || [],
      responses,
      rootLabel: item.root_label || "All",
    });
  }, [item.stages, item.root_label, responses, totalResult.data]);

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          if (params.dataType === "edge") {
            return `${params.data.source} → ${params.data.target}: <b>${params.data.value}</b>`;
          }
          return `${params.name}: <b>${params.data.value}</b>`;
        },
      },
      series: [
        {
          type: "sankey",
          top: 28,
          left: 16,
          right: 16,
          bottom: 20,
          nodeWidth: 22,
          nodeGap: 18,
          draggable: false,
          emphasis: { focus: "adjacency" },
          label: {
            show: false,
          },
          data: flow.nodes.map((node) => ({
            name: node.name,
            value: node.value,
            itemStyle: { color: node.color },
          })),
          links: flow.links.map((link) => ({
            source: link.source,
            target: link.target,
            value: link.value,
            lineStyle: {
              color: link.color,
              opacity: 0.45,
              curveness: 0.45,
            },
          })),
          lineStyle: { color: "source", curveness: 0.45 },
        },
      ],
    }),
    [flow]
  );

  const title = item.title || item.label || "Stage Flow";
  const cards = stageCards(flow, item);
  const branches = failedBranches(flow);

  return (
    <Card title={title} className="chart-card">
      {(item.stages || []).map((stage) => (
        <StageFetcher
          key={stage.key}
          stage={stage}
          filterState={filterState}
          fiscalYearStartMonth={fiscalYearStartMonth}
          customFilterDefs={customFilterDefs}
          parentFormId={parentFormId}
          onData={onStageData}
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
        <div className="stage-flow-widget">
          <div className="stage-flow-labels" aria-label={`${title} stages`}>
            {cards.map((card, index) => (
              <div
                key={card.key}
                className={`stage-flow-label stage-flow-label-${card.tone}`}
                title={`${card.label}: ${card.value}`}
              >
                <span className="stage-flow-label-index">{index + 1}</span>
                <span className="stage-flow-label-text">{card.label}</span>
                <strong className="stage-flow-label-value">{card.value}</strong>
              </div>
            ))}
          </div>
          <ReactECharts
            option={option}
            notMerge
            className="stage-flow-chart"
            style={{ height: item.height || 280, width: "100%" }}
          />
          {branches.length > 0 && (
            <div className="stage-flow-branches" aria-label={`${title} exits`}>
              {branches.map((branch) => (
                <span
                  key={branch.key}
                  className="stage-flow-branch"
                  title={`${branch.label}: ${branch.value}`}
                >
                  <span>{branch.label}</span>
                  <strong>{branch.value}</strong>
                </span>
              ))}
            </div>
          )}
          <Text type="secondary" className="stage-flow-summary">
            {buildSummary(flow, item)}
          </Text>
        </div>
      )}
    </Card>
  );
};

const stageShape = PropTypes.shape({
  key: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  fail_label: PropTypes.string,
  positive_value: PropTypes.string,
  color: PropTypes.string,
  fail_color: PropTypes.string,
  link_color: PropTypes.string,
  fail_link_color: PropTypes.string,
  api: PropTypes.object.isRequired,
});

StageFlowWidget.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string,
    label: PropTypes.string,
    root_label: PropTypes.string,
    height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    denominator_api: PropTypes.object,
    stages: PropTypes.arrayOf(stageShape),
    summary_template: PropTypes.string,
  }).isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

StageFlowWidget.defaultProps = {
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  parentFormId: null,
};

export default StageFlowWidget;
