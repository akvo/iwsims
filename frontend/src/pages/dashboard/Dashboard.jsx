import React, { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert, Card, Col, Empty, Row, Tabs, Typography } from "antd";
import {
  useDashboardConfig,
  useDashboardFilters,
  useDashboardProgress,
  useDashboardValues,
} from "../../util/hooks";
import DashboardFilters from "../../components/dashboard/DashboardFilters";
import KPICardRow from "../../components/dashboard/KPICardRow";
import ChartRenderer from "../../components/dashboard/ChartRenderer";
import DashboardMap from "../../components/dashboard/DashboardMap";
import EscalationTable from "../../components/dashboard/EscalationTable";
import { fails } from "../../components/dashboard/compute/compliance";

const { Title, Paragraph } = Typography;

/**
 * Invisible per-parameter fetcher. One instance per non-hidden water-quality
 * parameter — rules-of-hooks-compliant fan-out feeding the compliance
 * stacked bar (compute=compliance in config.charts).
 */
const WqParamFetcher = ({
  param,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  onData,
}) => {
  const { data } = useDashboardValues(param.api, filterState, {
    fiscalYearStartMonth,
    customFilterDefs,
  });
  React.useEffect(() => {
    if (data) {
      onData(param.key, data);
    }
  }, [data, param.key, onData]);
  return null;
};

/**
 * Invisible per-progress-block fetcher. Lets the dashboard run
 * /progress for every entry in `config.progress` without hardcoding
 * the keys here.
 */
const ProgressFetcher = ({ blockKey, block, filterState, onData }) => {
  const { data, error } = useDashboardProgress(block, filterState);
  React.useEffect(() => {
    if (data || error) {
      onData(blockKey, { data, error });
    }
  }, [blockKey, data, error, onData]);
  return null;
};

/**
 * Resolves one layout section to a node. Dispatches on `section.type`;
 * skips sections with `hide: true`.
 */
const LayoutSection = ({ section, ctx }) => {
  if (section.hide) {
    return null;
  }

  const {
    config,
    filterState,
    fiscalYearStartMonth,
    customFilterDefs,
    progressResponses,
    complianceResponses,
    wqParameters,
  } = ctx;

  switch (section.type) {
    case "kpi_row":
      return (
        <div style={{ marginBottom: 24 }}>
          <KPICardRow
            kpiKeys={section.kpis || []}
            kpisByKey={config.kpis}
            filterState={filterState}
            fiscalYearStartMonth={fiscalYearStartMonth}
            customFilterDefs={customFilterDefs}
          />
        </div>
      );

    case "map":
      return (
        <Card size="small" style={{ marginBottom: 16 }}>
          <DashboardMap
            mapConfig={config.map}
            filterState={filterState}
            height={section.height || 400}
          />
        </Card>
      );

    case "section_title":
      return (
        <Title level={4} style={{ marginTop: 16 }}>
          {section.text}
        </Title>
      );

    case "chart": {
      const chart = config.charts?.[section.chart_key];
      if (!chart || chart.hide) {
        return null;
      }
      return (
        <Card title={chart.config?.title} style={{ marginBottom: 16 }}>
          <ChartRenderer
            chartKey={section.chart_key}
            chart={chart}
            filterState={filterState}
            fiscalYearStartMonth={fiscalYearStartMonth}
            customFilterDefs={customFilterDefs}
            progressResponses={progressResponses}
            complianceResponses={complianceResponses}
            waterQualityParameters={wqParameters}
          />
        </Card>
      );
    }

    case "chart_row":
    case "chart_grid": {
      const keys = (section.charts || []).filter(
        (k) => config.charts?.[k] && !config.charts[k].hide
      );
      const cols = section.columns || keys.length || 1;
      const span = Math.max(6, Math.floor(24 / cols));
      return (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          {keys.map((k) => (
            <Col key={k} xs={24} md={span}>
              <Card title={config.charts[k].config?.title}>
                <ChartRenderer
                  chartKey={k}
                  chart={config.charts[k]}
                  filterState={filterState}
                  fiscalYearStartMonth={fiscalYearStartMonth}
                  customFilterDefs={customFilterDefs}
                  progressResponses={progressResponses}
                  complianceResponses={complianceResponses}
                  waterQualityParameters={wqParameters}
                />
              </Card>
            </Col>
          ))}
        </Row>
      );
    }

    case "parameter_grid": {
      const params = (wqParameters || []).filter(
        (p) => !p.hide && p.group === section.group
      );
      const cols = section.columns || 2;
      const span = Math.max(6, Math.floor(24 / cols));
      return (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          {params.map((p) => (
            <Col key={p.key} xs={24} md={span}>
              <Card title={p.config?.title || p.label}>
                <ChartRenderer
                  chartKey={p.key}
                  chart={p}
                  filterState={filterState}
                  fiscalYearStartMonth={fiscalYearStartMonth}
                  customFilterDefs={customFilterDefs}
                />
              </Card>
            </Col>
          ))}
        </Row>
      );
    }

    case "escalation_table": {
      const block = config.escalation?.[section.escalation_key];
      if (!block || block.hide) {
        return null;
      }
      return (
        <Card
          title={block.label || "Escalation list"}
          size="small"
          style={{ marginBottom: 16 }}
        >
          {block.description && (
            <Paragraph type="secondary">{block.description}</Paragraph>
          )}
          <EscalationTable
            escalationBlock={block}
            filterState={filterState}
            cellComputers={
              ctx.escalationCellComputers?.[section.escalation_key] || {}
            }
          />
        </Card>
      );
    }

    default:
      return null;
  }
};

/**
 * Config-driven dashboard. Renders tabs from `config.tabs`; each tab body
 * is an ordered list of sections from `config.layout[tabKey].sections`.
 *
 * Route: /dashboard/:formId
 *
 * Shared page-level fetches (dedup'd by the request cache):
 *   - /progress for each entry in config.progress (construction, etc.)
 *   - /values per non-hidden water-quality parameter (fan-out for compliance)
 */
const Dashboard = () => {
  const { formId } = useParams();
  const { config } = useDashboardConfig(formId);
  const filters = useDashboardFilters(config || { filters: { custom: [] } });

  const fyStart = config?.filters?.date?.fiscal_year_start_month || 1;
  const customDefs = useMemo(() => config?.filters?.custom || [], [config]);

  const wqParams = useMemo(
    () => (config?.water_quality?.parameters || []).filter((p) => !p.hide),
    [config]
  );

  const [complianceResponses, setComplianceResponses] = useState({});
  const onParamData = useCallback((key, data) => {
    setComplianceResponses((prev) =>
      prev[key] === data ? prev : { ...prev, [key]: data }
    );
  }, []);

  const progressBlocks = useMemo(
    () => Object.entries(config?.progress || {}),
    [config]
  );
  const [progressByKey, setProgressByKey] = useState({});
  const onProgressData = useCallback((key, payload) => {
    setProgressByKey((prev) =>
      prev[key]?.data === payload.data && prev[key]?.error === payload.error
        ? prev
        : { ...prev, [key]: payload }
    );
  }, []);
  const progressResponses = useMemo(() => {
    const out = {};
    Object.entries(progressByKey).forEach(([k, v]) => {
      if (v?.data) {
        out[k] = v.data;
      }
    });
    return out;
  }, [progressByKey]);
  const progressErrors = useMemo(
    () =>
      Object.entries(progressByKey)
        .filter(([, v]) => v?.error)
        .map(([k, v]) => ({ key: k, error: v.error })),
    [progressByKey]
  );

  // Per-EPS list of failing parameter labels, for the monitoring escalation
  // table's `critical_issues` computed column. Reuses the same per-parameter
  // /values fetches that drive the compliance stack bar.
  const criticalIssuesByEps = useMemo(() => {
    const out = {};
    wqParams.forEach((p) => {
      const rows = complianceResponses[p.key]?.data || [];
      rows.forEach((row) => {
        if (fails(p.threshold, row.value)) {
          const key = String(row.group);
          if (!out[key]) {
            out[key] = [];
          }
          out[key].push(p.label);
        }
      });
    });
    return out;
  }, [wqParams, complianceResponses]);

  const escalationCellComputers = useMemo(
    () => ({
      monitoring: {
        critical_issues: (row) => {
          const issues = criticalIssuesByEps[String(row.id)] || [];
          return issues.length > 0 ? issues.join(", ") : null;
        },
      },
    }),
    [criticalIssuesByEps]
  );

  const filterActions = useMemo(
    () => ({
      setDateRange: filters.setDateRange,
      setAdministrationId: filters.setAdministrationId,
      setCustomFilter: filters.setCustomFilter,
    }),
    [filters.setDateRange, filters.setAdministrationId, filters.setCustomFilter]
  );

  const ctx = useMemo(
    () => ({
      config,
      filterState: filters.queryParams,
      fiscalYearStartMonth: fyStart,
      customFilterDefs: customDefs,
      progressResponses,
      complianceResponses,
      wqParameters: wqParams,
      escalationCellComputers,
    }),
    [
      config,
      filters.queryParams,
      fyStart,
      customDefs,
      progressResponses,
      complianceResponses,
      wqParams,
      escalationCellComputers,
    ]
  );

  if (!config) {
    // eslint-disable-next-line no-console
    console.warn(
      `No dashboard config registered for formId=${formId}. Drop a JSON file in src/config/visualizations/ and register it in index.js.`
    );
    return (
      <div style={{ padding: 24 }}>
        <Empty description="This dashboard isn't available yet." />
      </div>
    );
  }

  const visibleTabs = (config.tabs || []).filter((t) => !t.hide);

  return (
    <div style={{ padding: 24 }}>
      {wqParams.map((p) => (
        <WqParamFetcher
          key={p.key}
          param={p}
          filterState={filters.queryParams}
          fiscalYearStartMonth={fyStart}
          customFilterDefs={customDefs}
          onData={onParamData}
        />
      ))}

      {progressBlocks.map(([k, block]) => (
        <ProgressFetcher
          key={k}
          blockKey={k}
          block={block}
          filterState={filters.queryParams}
          onData={onProgressData}
        />
      ))}

      <Title level={2}>{config.name}</Title>
      {config.description && (
        <Paragraph type="secondary">{config.description}</Paragraph>
      )}

      {progressErrors.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Some dashboard data failed to load"
          description={progressErrors
            .map(({ key, error }) => `${key}: ${error?.message || "error"}`)
            .join(" · ")}
        />
      )}

      <Card size="small" style={{ marginBottom: 16 }}>
        <DashboardFilters
          config={config}
          filters={filters}
          onChange={filterActions}
        />
      </Card>

      <Tabs
        defaultActiveKey={visibleTabs[0]?.key}
        destroyInactiveTabPane
        items={visibleTabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          children: (
            <div>
              {(config.layout?.[tab.key]?.sections || []).map((section, i) => (
                <LayoutSection
                  key={`${tab.key}-${i}`}
                  section={section}
                  ctx={ctx}
                />
              ))}
            </div>
          ),
        }))}
      />
    </div>
  );
};

export default Dashboard;
