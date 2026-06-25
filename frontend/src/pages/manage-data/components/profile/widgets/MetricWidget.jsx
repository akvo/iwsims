import React from "react";
import PropTypes from "prop-types";
import { Card, Statistic, Tag } from "antd";

import {
  answerValue,
  latestEntry,
  passThreshold,
  renderValue,
  getText,
} from "../lib/utils";

const MetricWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const entry = latestEntry(recordContext, item.question);
  const value = answerValue(entry);
  const status = passThreshold(value, item.threshold);

  return (
    <Card bordered>
      <Statistic
        title={getText(text, item.label_key, item.label)}
        value={renderValue(entry, item.question)}
        suffix={item.unit || null}
      />
      {status !== null && (
        <Tag color={status ? "green" : "red"}>
          {status ? text.siteProfileStatusPass : text.siteProfileStatusFail}
        </Tag>
      )}
    </Card>
  );
};

MetricWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default MetricWidget;
