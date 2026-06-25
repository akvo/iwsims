import React from "react";
import PropTypes from "prop-types";
import { Card, Empty, Tag } from "antd";

import { answerValue, latestEntry, getText } from "../lib/utils";

const TagsWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const values = answerValue(latestEntry(recordContext, item.question));
  const tags = Array.isArray(values) ? values : values ? [values] : [];

  return (
    <Card title={getText(text, item.label_key, item.label)} bordered>
      {tags.length ? (
        tags.map((tag) => <Tag key={tag}>{tag}</Tag>)
      ) : (
        <Empty description={text.siteProfileNoneRecorded} />
      )}
    </Card>
  );
};

TagsWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default TagsWidget;
