import React, { useCallback, useMemo, useState, useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Alert, Col, Row, Typography } from "antd";
import {
  useDashboardConfig,
  useDashboardFilters,
  useDashboardProgress,
  useDashboardValues,
} from "../../util/hooks";
import DashboardRenderer from "../../components/dashboard/DashboardRenderer";
import { fails } from "../../components/dashboard/compute/compliance";
import "./style.scss";

const { Title, Paragraph } = Typography;

/**
 * Invisible per-parameter fetcher used for the compliance stacked-bar chart.
 *
 * One instance is rendered per non-hidden `histogram` item whose id appears
 * in a `params_ref[]` of any compliance chart. It fires the /values call and
 * reports back via `onData` keyed by item id.
 *
 * Rules-of-hooks-compliant fan-out: the hook call is unconditional inside
 * this component; the parent decides how many instances to render.
 */
const WqParamFetcher = ({
  paramItem,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  onData,
}) => {
  const { data } = useDashboardValues(paramItem.api, filterState, {
    fiscalYearStartMonth,
    customFilterDefs,
  });
  useEffect(() => {
    if (data) {
      onData(paramItem.id, data);
    }
  }, [data, paramItem.id, onData]);
  return null;
};

/**
 * Invisible progress fetcher. One instance per `progress_definition` item
 * in the config tree. Reports back via `onData` keyed by item id.
 */
const ProgressFetcher = ({
  progressItem,
  filterState,
  customFilterDefs,
  onData,
}) => {
  const { data, error } = useDashboardProgress(progressItem, filterState, {
    customFilterDefs,
  });
  useEffect(() => {
    if (data || error) {
      onData(progressItem.id, { data, error });
    }
  }, [progressItem.id, data, error, onData]);
  return null;
};

/**
 * Invisible fetcher for a cross_tab widget. Fires both category_api and
 * series_api, then reports {category, series} via onData once both have
 * resolved.
 *
 * Rules-of-hooks-compliant: hook count is fixed at 2 per instance.
 */
const CrossTabFetcher = ({
  item,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  onData,
}) => {
  const opts = { fiscalYearStartMonth, customFilterDefs };
  const { data: category } = useDashboardValues(
    item.category_api,
    filterState,
    opts
  );
  const { data: series } = useDashboardValues(
    item.series_api,
    filterState,
    opts
  );
  useEffect(() => {
    if (category && series) {
      onData(item.id, { category, series });
    }
  }, [item.id, category, series, onData]);
  return null;
};

/**
 * Invisible fetcher for items whose per-parent derivation takes two
 * option-question /values responses (sample + issues). Used by both
 * compute=accessibility_bucket (chart) and compute=accessibility_no_issues_kpi
 * (KPI card) — identical fetch shape, different storage slot.
 */
const SampleIssuesFetcher = ({
  item,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  onData,
}) => {
  const opts = { fiscalYearStartMonth, customFilterDefs };
  const { data: sample } = useDashboardValues(
    item.sample_api,
    filterState,
    opts
  );
  const { data: issues } = useDashboardValues(
    item.issues_api,
    filterState,
    opts
  );
  useEffect(() => {
    if (sample && issues) {
      onData(item.id, { sample, issues });
    }
  }, [item.id, sample, issues, onData]);
  return null;
};

/**
 * Invisible fetcher for a single kpi_stack segment. Parent renders one
 * instance per item × segment so the hook count per instance stays at 1.
 * Reports (itemId, segmentKey, data) via onSegmentData.
 */
const KpiSegmentFetcher = ({
  itemId,
  segment,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  onSegmentData,
}) => {
  const { data } = useDashboardValues(segment.api, filterState, {
    fiscalYearStartMonth,
    customFilterDefs,
  });
  useEffect(() => {
    if (data) {
      onSegmentData(itemId, segment.key, data);
    }
  }, [itemId, segment.key, data, onSegmentData]);
  return null;
};

/**
 * Walk the flat item tree and collect all items of a given chart_type.
 * Tab panes (no chart_type) are walked for their children transparently.
 *
 * @param {Array}  items
 * @param {string} chartType
 * @returns {Array}
 */
const collectByType = (items = [], chartType) => {
  const result = [];
  items.forEach((item) => {
    if (!item.chart_type && Array.isArray(item.items)) {
      result.push(...collectByType(item.items, chartType));
      return;
    }
    if (item.chart_type === chartType) {
      result.push(item);
    }
    if (Array.isArray(item.items)) {
      result.push(...collectByType(item.items, chartType));
    }
  });
  return result;
};

/**
 * Walk the flat item tree and collect all items matching a compute mode.
 * Tab panes (no chart_type) are walked transparently.
 *
 * @param {Array}  items
 * @param {string} computeMode
 * @returns {Array}
 */
const collectByCompute = (items = [], computeMode) => {
  const result = [];
  items.forEach((item) => {
    if (!item.chart_type && Array.isArray(item.items)) {
      result.push(...collectByCompute(item.items, computeMode));
      return;
    }
    if (item.compute === computeMode) {
      result.push(item);
    }
    if (Array.isArray(item.items)) {
      result.push(...collectByCompute(item.items, computeMode));
    }
  });
  return result;
};

/**
 * Walk items and collect all ids listed in any `params_ref[]` arrays found
 * on compliance charts (`compute: "compliance"`).
 *
 * @param {Array} items
 * @returns {Set<string>}
 */
const collectComplianceParamIds = (items = []) => {
  const ids = new Set();
  items.forEach((item) => {
    if (!item.chart_type && Array.isArray(item.items)) {
      collectComplianceParamIds(item.items).forEach((id) => ids.add(id));
      return;
    }
    if (item.compute === "compliance" && Array.isArray(item.params_ref)) {
      item.params_ref.forEach((id) => ids.add(id));
    }
    if (Array.isArray(item.items)) {
      collectComplianceParamIds(item.items).forEach((id) => ids.add(id));
    }
  });
  return ids;
};

/**
 * Config-driven dashboard page.
 *
 * Renders the flat item tree from `config.items` via `<DashboardRenderer>`.
 * Also runs invisible background fetchers for:
 *   - Progress definitions  (`progress_definition` items)
 *   - Water-quality parameters referenced by compliance charts (`params_ref[]`)
 *
 * These pre-fetched responses are assembled into `complianceResponses` (keyed
 * by param item id) and `cellComputersById` (keyed by table item id) then
 * injected into DashboardRenderer as context.
 *
 * Route: /dashboard/:slug
 */
const Dashboard = () => {
  const { slug } = useParams();
  const { config, definitionsById } = useDashboardConfig(slug);

  // Component-scoped "now" anchor; threaded into DashboardRenderer so
  // mark_lines with type="today" can resolve to an axis-matching label.
  const today = useMemo(() => new Date(), []);

  // Build a minimal config shell for the filters hook when config is absent.
  const filtersConfig = useMemo(
    () => config || { parent_form_id: null, items: [] },
    [config]
  );
  const filters = useDashboardFilters(filtersConfig);

  const fyStart = config?.fiscal_year_start_month || 1;

  // Flat list of custom filter items for hint expansion inside useDashboardValues.
  const customFilterDefs = useMemo(() => {
    if (!config) {
      return [];
    }
    return collectByType(config.items, "filter_option").concat(
      collectByType(config.items, "filter_multi_option")
    );
  }, [config]);

  // ── Compliance fan-out ─────────────────────────────────────────────────────
  // Collect param item ids referenced by any compliance chart, then derive
  // the param items themselves from definitionsById.
  const complianceParamItems = useMemo(() => {
    if (!config) {
      return [];
    }
    const ids = collectComplianceParamIds(config.items);
    return Array.from(ids)
      .map((id) => definitionsById.get(id))
      .filter(Boolean);
  }, [config, definitionsById]);

  const [complianceResponses, setComplianceResponses] = useState({});
  const onParamData = useCallback((id, data) => {
    setComplianceResponses((prev) =>
      prev[id] === data ? prev : { ...prev, [id]: data }
    );
  }, []);

  // ── Cross-form & derived-compute fan-out ──────────────────────────────────
  // Items with compute=cross_tab / accessibility_bucket / kpi_stack /
  // accessibility_no_issues_kpi each need pre-fetched /values responses
  // combined into a single `computeResponses` tree keyed by
  // {[mode]: {[itemId]: payload}}. This mirrors the compliance fan-out but
  // supports 2-call cross-form joins and N-call segment fetches.
  const crossTabItems = useMemo(
    () => (config ? collectByCompute(config.items, "cross_tab") : []),
    [config]
  );
  const accessibilityBucketItems = useMemo(
    () =>
      config ? collectByCompute(config.items, "accessibility_bucket") : [],
    [config]
  );
  const kpiStackItems = useMemo(
    () => (config ? collectByCompute(config.items, "kpi_stack") : []),
    [config]
  );
  const accessibilityNoIssuesKpiItems = useMemo(
    () =>
      config
        ? collectByCompute(config.items, "accessibility_no_issues_kpi")
        : [],
    [config]
  );

  const [crossTabByItem, setCrossTabByItem] = useState({});
  const [accessibilityBucketByItem, setAccessibilityBucketByItem] = useState(
    {}
  );
  const [kpiStackByItem, setKpiStackByItem] = useState({});
  const [accessibilityNoIssuesKpiByItem, setAccessibilityNoIssuesKpiByItem] =
    useState({});

  const onCrossTabData = useCallback((id, payload) => {
    setCrossTabByItem((prev) =>
      prev[id] === payload ? prev : { ...prev, [id]: payload }
    );
  }, []);
  const onAccessibilityBucketData = useCallback((id, payload) => {
    setAccessibilityBucketByItem((prev) =>
      prev[id] === payload ? prev : { ...prev, [id]: payload }
    );
  }, []);
  const onAccessibilityNoIssuesKpiData = useCallback((id, payload) => {
    setAccessibilityNoIssuesKpiByItem((prev) =>
      prev[id] === payload ? prev : { ...prev, [id]: payload }
    );
  }, []);
  const onKpiStackSegmentData = useCallback((itemId, segmentKey, data) => {
    setKpiStackByItem((prev) => {
      const inner = prev[itemId] || {};
      if (inner[segmentKey] === data) {
        return prev;
      }
      return { ...prev, [itemId]: { ...inner, [segmentKey]: data } };
    });
  }, []);

  // Merge into one tree, with legacy complianceResponses under `compliance`.
  const computeResponses = useMemo(
    () => ({
      compliance: complianceResponses,
      cross_tab: crossTabByItem,
      accessibility_bucket: accessibilityBucketByItem,
      kpi_stack: kpiStackByItem,
      accessibility_no_issues_kpi: accessibilityNoIssuesKpiByItem,
    }),
    [
      complianceResponses,
      crossTabByItem,
      accessibilityBucketByItem,
      kpiStackByItem,
      accessibilityNoIssuesKpiByItem,
    ]
  );

  // ── Progress fetching ──────────────────────────────────────────────────────
  const progressItems = useMemo(() => {
    if (!config) {
      return [];
    }
    return collectByType(config.items, "progress_definition");
  }, [config]);

  const [progressById, setProgressById] = useState({});
  const onProgressData = useCallback((id, payload) => {
    setProgressById((prev) =>
      prev[id]?.data === payload.data && prev[id]?.error === payload.error
        ? prev
        : { ...prev, [id]: payload }
    );
  }, []);

  const progressResponses = useMemo(() => {
    const out = {};
    Object.entries(progressById).forEach(([id, v]) => {
      if (v?.data) {
        out[id] = v.data;
      }
    });
    return out;
  }, [progressById]);

  const progressErrors = useMemo(
    () =>
      Object.entries(progressById)
        .filter(([, v]) => v?.error)
        .map(([id, v]) => ({ id, error: v.error })),
    [progressById]
  );

  // ── Cell computers for escalation tables ─────────────────────────────────
  // Each `table` item that has computed columns with a `progress_ref` needs a
  // per-column function that joins progress response data.
  //
  // `critical_issues` in the monitoring escalation table is special: it
  // classifies an EPS by scanning compliance param responses.
  //
  // We build `cellComputersById` keyed by table item id.
  //
  // Per-EPS list of failing parameter labels. Uses complianceResponses (keyed
  // by param item id) and the param items' threshold + label.
  const criticalIssuesByEps = useMemo(() => {
    const out = {};
    complianceParamItems.forEach((p) => {
      const rows = complianceResponses[p.id]?.data || [];
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
  }, [complianceParamItems, complianceResponses]);

  const formatPct = (n) => {
    if (n === null || typeof n === "undefined" || Number.isNaN(n)) {
      return null;
    }
    return `${Math.round(n)}%`;
  };

  const computeExpectedProgress = (startIso, deadlineIso) => {
    if (!startIso || !deadlineIso) {
      return null;
    }
    const start = new Date(startIso);
    const deadline = new Date(deadlineIso);
    const today = new Date();
    const total = (deadline - start) / (1000 * 60 * 60 * 24);
    const elapsed = (today - start) / (1000 * 60 * 60 * 24);
    if (total <= 0) {
      return null;
    }
    const pct = Math.max(0, Math.min(100, (elapsed / total) * 100));
    return pct;
  };

  // Build construction detail lookup from progress response keyed by
  // `progress_construction` item id.
  const constructionItemId = useMemo(() => {
    if (!config) {
      return null;
    }
    const items = collectByType(config.items, "progress_definition");
    // Find the construction progress definition (convention: key === "construction")
    const found = items.find((i) => i.key === "construction");
    return found?.id || null;
  }, [config]);

  const constructionDetailsByEps = useMemo(() => {
    const details = constructionItemId
      ? progressResponses[constructionItemId]?.details || []
      : [];
    const out = {};
    details.forEach((d) => {
      out[String(d.group)] = d;
    });
    return out;
  }, [constructionItemId, progressResponses]);

  // Build cellComputersById by scanning all table items for computed columns.
  const cellComputersById = useMemo(() => {
    if (!config) {
      return {};
    }
    const tableItems = collectByType(config.items, "table");
    const out = {};

    tableItems.forEach((tableItem) => {
      const computers = {};
      (tableItem.columns || []).forEach((col) => {
        if (!col.computed) {
          return;
        }
        if (col.key === "critical_issues") {
          computers.critical_issues = (row) => {
            const issues = criticalIssuesByEps[String(row.id)] || [];
            return issues.length > 0 ? issues.join(", ") : null;
          };
          return;
        }
        // Progress-ref computed columns: resolve via constructionDetailsByEps.
        if (col.progress_ref && col.component_key) {
          const compKey = col.component_key;
          computers[col.key] = (row) =>
            formatPct(
              constructionDetailsByEps[String(row.id)]?.components?.[compKey]
            );
          return;
        }
        if (col.key === "overall_progress" && col.progress_ref) {
          computers.overall_progress = (row) =>
            formatPct(constructionDetailsByEps[String(row.id)]?.overall);
          return;
        }
        if (col.key === "expected_progress" && col.progress_ref) {
          computers.expected_progress = (row) =>
            formatPct(computeExpectedProgress(row._start_date, row.deadline));
          return;
        }
      });

      if (Object.keys(computers).length > 0) {
        out[tableItem.id] = computers;
      }
    });

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, criticalIssuesByEps, constructionDetailsByEps]);

  const filterActions = useMemo(
    () => ({
      setDateRange: filters.setDateRange,
      setAdministrationId: filters.setAdministrationId,
      setCustomFilter: filters.setCustomFilter,
    }),
    [filters.setDateRange, filters.setAdministrationId, filters.setCustomFilter]
  );

  if (!config) {
    // eslint-disable-next-line no-console
    console.warn(
      `No dashboard config registered for slug="${slug}". Drop a JSON file in src/config/visualizations/ with a matching "slug" field and register it in index.js.`
    );
    return <Navigate to="/control-center" replace />;
  }

  return (
    <div className="dashboard">
      {/* Invisible compliance param fetchers */}
      {complianceParamItems.map((paramItem) => (
        <WqParamFetcher
          key={paramItem.id}
          paramItem={paramItem}
          filterState={filters.queryParams}
          fiscalYearStartMonth={fyStart}
          customFilterDefs={customFilterDefs}
          onData={onParamData}
        />
      ))}

      {/* Invisible progress fetchers */}
      {progressItems.map((progressItem) => (
        <ProgressFetcher
          key={progressItem.id}
          progressItem={progressItem}
          filterState={filters.queryParams}
          customFilterDefs={customFilterDefs}
          onData={onProgressData}
        />
      ))}

      {/* Invisible cross_tab fetchers */}
      {crossTabItems.map((item) => (
        <CrossTabFetcher
          key={item.id}
          item={item}
          filterState={filters.queryParams}
          fiscalYearStartMonth={fyStart}
          customFilterDefs={customFilterDefs}
          onData={onCrossTabData}
        />
      ))}

      {/* Invisible accessibility_bucket fetchers */}
      {accessibilityBucketItems.map((item) => (
        <SampleIssuesFetcher
          key={item.id}
          item={item}
          filterState={filters.queryParams}
          fiscalYearStartMonth={fyStart}
          customFilterDefs={customFilterDefs}
          onData={onAccessibilityBucketData}
        />
      ))}

      {/* Invisible accessibility_no_issues_kpi fetchers (same shape, distinct slot) */}
      {accessibilityNoIssuesKpiItems.map((item) => (
        <SampleIssuesFetcher
          key={item.id}
          item={item}
          filterState={filters.queryParams}
          fiscalYearStartMonth={fyStart}
          customFilterDefs={customFilterDefs}
          onData={onAccessibilityNoIssuesKpiData}
        />
      ))}

      {/* Invisible kpi_stack segment fetchers — one per (item, segment) pair */}
      {kpiStackItems.flatMap((item) =>
        (item.segments || []).map((segment) => (
          <KpiSegmentFetcher
            key={`${item.id}::${segment.key}`}
            itemId={item.id}
            segment={segment}
            filterState={filters.queryParams}
            fiscalYearStartMonth={fyStart}
            customFilterDefs={customFilterDefs}
            onSegmentData={onKpiStackSegmentData}
          />
        ))
      )}

      <Row gutter={[0, 0]} className="dashboard-header">
        <Col span={24}>
          <Title level={3} className="dashboard-title">
            {config.name}
          </Title>
          {config.description && (
            <Paragraph type="secondary" className="dashboard-subtitle">
              {config.description}
            </Paragraph>
          )}
        </Col>
      </Row>

      {progressErrors.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Some dashboard data failed to load"
          description={progressErrors
            .map(({ id, error }) => `${id}: ${error?.message || "error"}`)
            .join(" · ")}
        />
      )}

      <DashboardRenderer
        items={config.items}
        filterState={filters.queryParams}
        filters={filters}
        filterActions={filterActions}
        definitionsById={definitionsById}
        fiscalYearStartMonth={fyStart}
        customFilterDefs={customFilterDefs}
        computeResponses={computeResponses}
        cellComputersById={cellComputersById}
        today={today}
      />
    </div>
  );
};

export default Dashboard;
