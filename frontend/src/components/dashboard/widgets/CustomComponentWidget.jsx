import React from "react";
import PropTypes from "prop-types";
import { Alert } from "antd";
import * as customComponents from "../custom-components";

/**
 * Resolves an item with chart_type "custom_component" against the named-export
 * registry in `custom-components/index.js`. Unknown names render an Alert and
 * log to console.error rather than throwing, so a typo in the JSON config does
 * not crash the rest of the dashboard.
 */
const CustomComponentWidget = ({ item }) => {
  const Component = customComponents[item.component];

  if (!Component) {
    // eslint allows console.error
    console.error(
      `[CustomComponentWidget] Unknown component: "${item.component}" (id: ${item.id})`
    );
    return (
      <Alert
        type="warning"
        message={`Custom component "${item.component}" not found`}
      />
    );
  }

  return <Component />;
};

CustomComponentWidget.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    component: PropTypes.string.isRequired,
  }).isRequired,
};

export default CustomComponentWidget;
