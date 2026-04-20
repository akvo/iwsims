import React, { useCallback } from "react";
import PropTypes from "prop-types";
import { Card, Col, Row, Typography } from "antd";
import ChartRenderer from "./ChartRenderer";
import DashboardMap from "./DashboardMap";
import EscalationTable from "./EscalationTable";
import KPICard from "./widgets/KPICard";
import SectionTitleWidget from "./widgets/SectionTitleWidget";
import FilterBarWidget from "./widgets/FilterBarWidget";
import TabsWidget from "./widgets/TabsWidget";

const { Paragraph } = Typography;

/**
 * chart_types that are hidden definition entries only — never rendered.
 * They are still indexed into `definitionsById` for cross-ref resolution.
 */
const HIDDEN_TYPES = new Set(["progress_definition", "water_quality_globals"]);

/**
 * chart_types that are chart-library widgets (dispatched to ChartRenderer).
 */
const CHART_TYPES = new Set([
  "bar",
  "line",
  "doughnut",
  "pie",
  "stack_bar",
  "histogram",
  "dots",
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
 * @param {object} [complianceResponses]  { [itemId]: /values response }
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
  cellComputersById,
}) => {
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
        complianceResponses={complianceResponses}
        cellComputersById={cellComputersById}
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
      complianceResponses,
      cellComputersById,
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
        />
      );
    }

    if (CHART_TYPES.has(type)) {
      const { title: cardTitle, ...restConfig } = item.config || {};
      const itemForChart = { ...item, config: restConfig };
      return (
        <Card
          title={cardTitle}
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
            complianceResponses={complianceResponses}
          />
        </Card>
      );
    }

    if (type === "table") {
      return (
        <Card
          title={item.label || "Escalation list"}
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
        />
      );
    }

    if (type === "tabs") {
      return <TabsWidget item={item} renderItems={renderItems} />;
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
  cellComputersById: PropTypes.object,
};

export default DashboardRenderer;
