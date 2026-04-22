import React from "react";
import PropTypes from "prop-types";
import { Card, Tabs } from "antd";
import store from "../../../lib/store";

/**
 * Renders a `tabs` container item as an Ant Design <Tabs> component.
 *
 * Each child of `item.items[]` is a tab pane — a plain config object with
 * `{ id, label, items[] }` and NO `chart_type`. The `renderItems` function
 * is injected by `DashboardRenderer` to allow recursive rendering of each
 * pane's children.
 *
 * Panes carrying `is_public: false` are rendered as disabled tabs when the
 * viewer is anonymous (`UIState.isLoggedIn === false`). The default-active
 * tab falls through to the first non-disabled pane so anonymous viewers do
 * not land on a disabled tab on first paint. Combined with
 * `destroyInactiveTabPane`, this guarantees the pane's children never mount
 * (and so never fetch authenticated APIs) until the user is signed in and
 * activates the tab.
 *
 * @param {object}   item         A config item with chart_type "tabs" and items[]
 * @param {Function} renderItems  (items: Array) => ReactNode — provided by DashboardRenderer
 */
const TabsWidget = ({ item, renderItems }) => {
  const isLoggedIn = store.useState((s) => s.isLoggedIn);
  const panes = item.items || [];

  const isPaneDisabled = (pane) => pane.is_public === false && !isLoggedIn;

  const tabItems = panes.map((pane) => ({
    key: pane.id,
    label: pane.label,
    disabled: isPaneDisabled(pane),
    children: <div>{renderItems(pane.items || [])}</div>,
  }));

  const firstEnabledKey = panes.find((pane) => !isPaneDisabled(pane))?.id;

  return (
    <Card className="tabs-card">
      <Tabs
        defaultActiveKey={firstEnabledKey}
        destroyInactiveTabPane
        items={tabItems}
      />
    </Card>
  );
};

TabsWidget.propTypes = {
  item: PropTypes.shape({
    items: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string.isRequired,
        label: PropTypes.string,
        is_public: PropTypes.bool,
        items: PropTypes.array,
      })
    ),
  }).isRequired,
  renderItems: PropTypes.func.isRequired,
};

export default TabsWidget;
