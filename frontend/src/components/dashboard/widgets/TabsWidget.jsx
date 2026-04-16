import React from "react";
import PropTypes from "prop-types";
import { Tabs } from "antd";

/**
 * Renders a `tabs` container item as an Ant Design <Tabs> component.
 *
 * Each child of `item.items[]` is a tab pane — a plain config object with
 * `{ id, label, items[] }` and NO `chart_type`. The `renderItems` function
 * is injected by `DashboardRenderer` to allow recursive rendering of each
 * pane's children.
 *
 * @param {object}   item         A config item with chart_type "tabs" and items[]
 * @param {Function} renderItems  (items: Array) => ReactNode — provided by DashboardRenderer
 */
const TabsWidget = ({ item, renderItems }) => {
  const panes = item.items || [];

  const tabItems = panes.map((pane) => ({
    key: pane.id,
    label: pane.label,
    children: <div>{renderItems(pane.items || [])}</div>,
  }));

  return (
    <Tabs
      defaultActiveKey={panes[0]?.id}
      destroyInactiveTabPane
      items={tabItems}
      type="card"
    />
  );
};

TabsWidget.propTypes = {
  item: PropTypes.shape({
    items: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string.isRequired,
        label: PropTypes.string,
        items: PropTypes.array,
      })
    ),
  }).isRequired,
  renderItems: PropTypes.func.isRequired,
};

export default TabsWidget;
