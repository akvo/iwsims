import React from "react";
import PropTypes from "prop-types";

import TrendWidget from "./TrendWidget";

const RiskScoreTrend = ({ item, recordContext }) => (
  <TrendWidget
    item={{
      ...item,
      question:
        item.question || item.questions?.[0] || "has_final_recommendation",
      label: item.label || recordContext?.text?.siteProfileComplianceTrend,
    }}
    recordContext={recordContext}
  />
);

RiskScoreTrend.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default RiskScoreTrend;
