import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Empty, Space, Table } from "antd";

import {
  formatAnswer,
  getQuestionLabel,
  renderPhotoThumb,
  renderValue,
  getText,
} from "../lib/utils";

const EMPTY_OBJECT = {};

const AssessmentWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || EMPTY_OBJECT;
  const latest = recordContext?.payload?.latest || EMPTY_OBJECT;
  const rows = useMemo(() => {
    return (item.rows || [])
      .map((row) => {
        const condition = latest[row.question];
        const photo = latest[row.photo];
        const notes = latest[row.notes];
        if (!condition && !photo && !notes) {
          return null;
        }
        return {
          key: row.question,
          component: getQuestionLabel(text, row),
          condition: renderValue(condition, row.question),
          photo: renderPhotoThumb(photo, row.photo, text),
          notes: formatAnswer(notes, row.notes) || item.default_notes || "—",
        };
      })
      .filter(Boolean);
  }, [item.rows, item.default_notes, latest, text]);

  return (
    <Card
      title={
        <Space>
          <span>{getText(text, item.label_key, item.label)}</span>
          {item.caption || item.caption_key ? (
            <small>{getText(text, item.caption_key, item.caption)}</small>
          ) : null}
        </Space>
      }
      bordered
    >
      {rows.length ? (
        <Table
          columns={[
            { title: text.siteProfileComponentCol, dataIndex: "component" },
            { title: text.siteProfileConditionCol, dataIndex: "condition" },
            { title: text.siteProfilePhotoCol, dataIndex: "photo" },
            { title: text.siteProfileNotesCol, dataIndex: "notes" },
          ]}
          dataSource={rows}
          pagination={false}
          size="small"
        />
      ) : (
        <Empty description={text.siteProfileNoAssessmentData} />
      )}
    </Card>
  );
};

AssessmentWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default AssessmentWidget;
