import React from "react";
import PropTypes from "prop-types";
import { Typography } from "antd";

/**
 * Renders a section heading from a `section_title` config item.
 *
 * @param {object} item  A config item with chart_type "section_title" and a `text` field.
 */
const SectionTitleWidget = ({ item }) => (
  <Typography.Title level={4} style={{ marginTop: 16 }}>
    {item.text}
  </Typography.Title>
);

SectionTitleWidget.propTypes = {
  item: PropTypes.shape({
    text: PropTypes.string.isRequired,
  }).isRequired,
};

export default SectionTitleWidget;
