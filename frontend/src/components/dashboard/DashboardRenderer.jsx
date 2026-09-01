import React, { useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Col, Row, Typography } from "antd";
import ChartRenderer from "./ChartRenderer";
import DashboardMap from "./DashboardMap";
import EscalationTable from "./EscalationTable";
import MergedInspectionsTable from "./MergedInspectionsTable";
import MultiAssetMap from "./MultiAssetMap";
import ComplianceSnapshot from "./ComplianceSnapshot";
import KPICard from "./widgets/KPICard";
import MetricCard from "./widgets/MetricCard";
import CrossAssetKPICard from "./widgets/CrossAssetKPICard";
import RankingWidget from "./widgets/RankingWidget";
import SectionTitleWidget from "./widgets/SectionTitleWidget";
import FilterBarWidget from "./widgets/FilterBarWidget";
import TabsWidget from "./widgets/TabsWidget";
import CustomComponentWidget from "./widgets/CustomComponentWidget";
import FormulaInfo from "./widgets/FormulaInfo";

const { Paragraph } = Typography;

/**
 * chart_types that are hidden definition entries only — never rendered.
 * They are still indexed into `definitionsById` for cross-ref resolution.
 */
// Definition-only items: they hold a rule other items reference by id and
// have nothing to draw. `hide: true` already keeps them off the grid; naming
// the types here means a definition added without that flag still cannot
// render as a broken tile.
/**
 * The card renders `config.title` itself, so the chart underneath receives a
 * copy of the item with that key removed — otherwise the title is drawn twice.
 *
 * Cached per source item, because the derived object's IDENTITY matters:
 * ChartRenderer is wrapped in React.memo and compares `item` by reference, so
 * building a fresh copy on every render would defeat the memo entirely and
 * every chart would re-draw on every unrelated request. Keyed by the config
 * item in a WeakMap, so entries disappear with the config rather than
 * accumulating per dashboard.
 */
const chartItemCache = new WeakMap();

export const toChartItem = (item) => {
  const cached = chartItemCache.get(item);
  if (cached) {
    return cached;
  }
  const restConfig = { ...(item.config || {}) };
  delete restConfig.title;
  const derived = { ...item, config: restConfig };
  chartItemCache.set(item, derived);
  return derived;
};

const HIDDEN_TYPES = new Set([
  "progress_definition",
  "water_quality_globals",
  "operational_globals",
]);

/**
 * chart_types that are chart-library widgets (dispatched to ChartRenderer).
 */
const CHART_TYPES = new Set([
  "bar",
  "line",
  "doughnut",
  "half_doughnut",
  "pie",
  "stack_bar",
  "histogram",
  "dots",
  "dot_strip",
]);

/**
 * Recursive dashboard layout engine.
 *
 * Walks `items[]`, sorts siblings by `order` ascending, skips items where
 * `hide === true` or `chart_type` is in HIDDEN_TYPES, wraps each visible
 * item in `<Col span={col_span ?? 24}>`, and dispatches by `chart_type`.
 *
 * Containers (`tabs`, `filter_bar`) recurse by passing their own
 * renderItems callback down into child widgets.
 *
 * Context props (filterState, definitionsById, etc.) are forwarded unchanged
 * to every widget.
 *
 * @param {Array}  items            Siblings to render (pane children or root items)
 * @param {object} filterState      useDashboardFilters.queryParams
 * @param {object} filters          Full useDashboardFilters return (for FilterBarWidget)
 * @param {object} filterActions    { setDateRange, setAdministrationId, setCustomFilter }
 * @param {Map}    definitionsById  id → item, built by useDashboardConfig
 * @param {number} [fiscalYearStartMonth]
 * @param {Array}  [customFilterDefs]  flat list of filter items for hint expansion
 * @param {Date}   [today]
 * @param {object} [complianceResponses]  DEPRECATED — use computeResponses.compliance.
 *                                         Kept for one release as a back-compat alias.
 * @param {object} [computeResponses]     { [computeMode]: { [itemId]: /values response } }
 *                                         Unified map for all compute-mode pre-fetches
 *                                         (compliance, cross_tab, accessibility_bucket,
 *                                         kpi_stack, compliance_kpi, accessibility_no_issues_kpi).
 * @param {object} [cellComputersById]    { [itemId]: { [columnKey]: fn(row) => value } }
 */
const DashboardRenderer = ({
  items,
  filterState,
  filters,
  filterActions,
  definitionsById,
  fiscalYearStartMonth,
  customFilterDefs,
  today,
  complianceResponses,
  computeResponses,
  cellComputersById,
  parentFormId,
}) => {
  // Back-compat: fold legacy `complianceResponses` into the unified map under
  // `compliance`. New consumers should read `computeResponses.compliance`.
  // Precedence: if a caller supplies both, `computeResponses.compliance` wins.
  const resolvedComputeResponses = useMemo(() => {
    if (!computeResponses && !complianceResponses) {
      return null;
    }
    const legacy = complianceResponses
      ? { compliance: complianceResponses }
      : {};
    return { ...legacy, ...(computeResponses || {}) };
  }, [computeResponses, complianceResponses]);
  // Sort by order ascending, then filter out hidden / definition-only items.
  const visible = [...(items || [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((item) => !item.hide && !HIDDEN_TYPES.has(item.chart_type));

  // Stable recursive callback passed into container widgets (TabsWidget).
  const renderItems = useCallback(
    (children) => (
      <DashboardRenderer
        items={children}
        filterState={filterState}
        filters={filters}
        filterActions={filterActions}
        definitionsById={definitionsById}
        fiscalYearStartMonth={fiscalYearStartMonth}
        customFilterDefs={customFilterDefs}
        today={today}
        computeResponses={resolvedComputeResponses}
        cellComputersById={cellComputersById}
        parentFormId={parentFormId}
      />
    ),
    [
      filterState,
      filters,
      filterActions,
      definitionsById,
      fiscalYearStartMonth,
      customFilterDefs,
      today,
      resolvedComputeResponses,
      cellComputersById,
      parentFormId,
    ]
  );

  const renderWidget = (item) => {
    const { chart_type: type } = item;

    if (type === "card") {
      return (
        <KPICard
          item={item}
          filterState={filterState}
          fiscalYearStartMonth={fiscalYearStartMonth}
          customFilterDefs={customFilterDefs}
          today={today}
          definitionsById={definitionsById}
          computeResponses={resolvedComputeResponses}
          parentFormId={parentFormId}
        />
      );
    }

    if (type === "cross_asset_card") {
      return (
        <CrossAssetKPICard
          item={item}
          filterState={filterState}
          customFilterDefs={customFilterDefs}
          definitionsById={definitionsById}
          computeResponses={resolvedComputeResponses}
        />
      );
    }

    if (type === "metric_card") {
      return (
        <MetricCard
          item={item}
          filterState={filterState}
          fiscalYearStartMonth={fiscalYearStartMonth}
          customFilterDefs={customFilterDefs}
          today={today}
          parentFormId={parentFormId}
        />
      );
    }

    if (type === "ranking") {
      return (
        <RankingWidget
          item={item}
          filterState={filterState}
          fiscalYearStartMonth={fiscalYearStartMonth}
          customFilterDefs={customFilterDefs}
          today={today}
          parentFormId={parentFormId}
        />
      );
    }

    if (CHART_TYPES.has(type)) {
      const cardTitle = item.config?.title;
      const itemForChart = toChartItem(item);
      return (
        <Card
          title={
            <>
              {cardTitle}
              <FormulaInfo info={item.info} title={cardTitle} />
            </>
          }
          style={{ marginBottom: 0 }}
          className="chart-card"
        >
          {item.description && (
            <Paragraph type="secondary">{item.description}</Paragraph>
          )}
          <ChartRenderer
            item={itemForChart}
            filterState={filterState}
            fiscalYearStartMonth={fiscalYearStartMonth}
            customFilterDefs={customFilterDefs}
            today={today}
            definitionsById={definitionsById}
            complianceResponses={resolvedComputeResponses?.compliance}
            computeResponses={resolvedComputeResponses}
            parentFormId={parentFormId}
          />
        </Card>
      );
    }

    if (type === "table") {
      return (
        <Card
          title={
            <>
              {item.label || "Escalation list"}
              <FormulaInfo
                info={item.info}
                title={item.label || "Escalation list"}
              />
            </>
          }
          size="small"
          style={{ marginBottom: 0 }}
          className="escalation-table-card"
        >
          {item.description && (
            <Paragraph type="secondary">{item.description}</Paragraph>
          )}
          <EscalationTable
            item={item}
            filterState={filterState}
            customFilterDefs={customFilterDefs}
            cellComputers={cellComputersById?.[item.id] || {}}
            parentFormId={parentFormId}
          />
        </Card>
      );
    }

    if (type === "merged_table") {
      return (
        <Card
          title={
            <>
              {item.label || "Latest inspections"}
              <FormulaInfo
                info={item.info}
                title={item.label || "Latest inspections"}
              />
            </>
          }
          size="small"
          style={{ marginBottom: 0 }}
          className="escalation-table-card"
        >
          {item.description && (
            <Paragraph type="secondary">{item.description}</Paragraph>
          )}
          <MergedInspectionsTable
            item={item}
            filterState={filterState}
            customFilterDefs={customFilterDefs}
          />
        </Card>
      );
    }

    if (type === "compliance_snapshot") {
      return (
        <ComplianceSnapshot
          item={item}
          computeResponses={resolvedComputeResponses}
        />
      );
    }

    if (type === "multi_asset_map") {
      return (
        <Card
          title={
            <>
              {item.label || "Asset status"}
              <FormulaInfo info={item.info} title={item.label} />
            </>
          }
          size="small"
          style={{ marginBottom: 0 }}
        >
          {item.description && (
            <Paragraph type="secondary">{item.description}</Paragraph>
          )}
          <MultiAssetMap
            item={item}
            filterState={filterState}
            height={item.height || 480}
            today={today}
          />
        </Card>
      );
    }

    if (type === "map") {
      return (
        <DashboardMap
          item={item}
          filterState={filterState}
          customFilterDefs={customFilterDefs}
          definitionsById={definitionsById}
          parentFormId={parentFormId}
          height={item.height || 400}
        />
      );
    }

    if (type === "section_title") {
      return <SectionTitleWidget item={item} />;
    }

    if (type === "filter_bar") {
      return (
        <FilterBarWidget
          item={item}
          filters={filters}
          onChange={filterActions}
          parentFormId={parentFormId}
        />
      );
    }

    if (type === "tabs") {
      return <TabsWidget item={item} renderItems={renderItems} />;
    }

    if (type === "custom_component") {
      return (
        <CustomComponentWidget
          item={item}
          filterState={filterState}
          fiscalYearStartMonth={fiscalYearStartMonth}
          customFilterDefs={customFilterDefs}
          today={today}
          parentFormId={parentFormId}
        />
      );
    }

    // Unknown type — silently skip in production.
    // eslint-disable-next-line no-console
    console.warn(
      `[DashboardRenderer] Unknown chart_type: "${type}" (id: ${item.id})`
    );
    return null;
  };

  return (
    <Row gutter={[16, 16]}>
      {visible.map((item) => {
        const span = item.col_span ?? 24;
        const node = renderWidget(item);
        if (node === null) {
          return null;
        }
        return (
          <Col
            key={item.id}
            xs={24}
            md={span}
            className={item.className || null}
          >
            {node}
          </Col>
        );
      })}
    </Row>
  );
};

DashboardRenderer.propTypes = {
  items: PropTypes.arrayOf(PropTypes.object).isRequired,
  filterState: PropTypes.object,
  filters: PropTypes.object,
  filterActions: PropTypes.shape({
    setDateRange: PropTypes.func,
    setAdministrationId: PropTypes.func,
    setCustomFilter: PropTypes.func,
  }),
  definitionsById: PropTypes.instanceOf(Map),
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  today: PropTypes.instanceOf(Date),
  complianceResponses: PropTypes.object,
  computeResponses: PropTypes.object,
  cellComputersById: PropTypes.object,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

export default DashboardRenderer;
