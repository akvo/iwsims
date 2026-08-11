import React from "react";
import PropTypes from "prop-types";
import { Card, Empty, Image, Table, Tag, Typography } from "antd";
import { toneTagColor } from "../../../../../components/dashboard/constants";

import {
  answerValue,
  emptyMark,
  findQuestionByName,
  formatAnswer,
  formatDate,
  getQuestionLabel,
  getText,
  imageUrlsFromValue,
  optionSeverity,
  passThreshold,
  resolveOption,
  severityTagColor,
  thresholdLabel,
} from "../utils";

/**
 * Resolve which question name a `source: "rows"` row should read.
 *
 * A row normally names one question. Assets whose parameters are collected by
 * more than one monitoring form can instead list `questions: [...]` — the same
 * measurement under each form's name — and the first one this datapoint
 * actually answered wins. EPS records E. coli as `e_coli_level` on the
 * construction form and `e_coli_lab_count` on the water-quality form; RWS
 * splits nearly every parameter the same way. Resolving once here keeps the
 * label, value, threshold and status cells all reading the same question.
 *
 * Falls back to the first listed name so the row still renders (as "no data")
 * for a datapoint that answered none of them.
 */
export const resolveRowQuestion = (row = {}, latest = {}) => {
  if (row.question) {
    return row.question;
  }
  const names = row.questions || [];
  return names.find((name) => latest[name]) || names[0] || null;
};

const renderOptionPills = (entry, questionName) => {
  const question = findQuestionByName(questionName);
  const value = answerValue(entry);
  const values = Array.isArray(value) ? value : [value];
  const tags = values
    .filter((v) => v !== null && typeof v !== "undefined" && v !== "")
    .map((v) => {
      const option = resolveOption(question, v);
      return (
        <Tag
          key={v}
          className="status-pill"
          color={severityTagColor(optionSeverity(option.color))}
        >
          {option.label}
        </Tag>
      );
    });
  return tags.length ? tags : emptyMark;
};

const renderPhoto = (entry) => {
  const urls = imageUrlsFromValue(answerValue(entry));
  if (!urls.length) {
    return emptyMark;
  }
  return (
    <Image.PreviewGroup>
      {urls.map((url) => (
        <Image
          key={url}
          src={url}
          width={42}
          height={42}
          style={{ objectFit: "cover", borderRadius: 4 }}
        />
      ))}
    </Image.PreviewGroup>
  );
};

const renderCell = (col, record, ctx) => {
  const { latest, text, isSubmissions } = ctx;
  const render = col.render || "text";
  const name = isSubmissions
    ? col.dataIndex || col.question
    : record.__row?.[col.field || "question"];

  if (isSubmissions && (render === "date" || name === "date")) {
    // dataIndex "date" → FormData.created; a question name → that answer.
    return formatDate(name === "date" ? record.date : record.answers?.[name]);
  }

  let entry;
  if (isSubmissions) {
    const raw = record.answers?.[name];
    entry = Array.isArray(raw) ? { options: raw } : { value: raw };
  } else {
    entry = latest[name];
  }
  const threshold = col.threshold || record.__row?.threshold;
  const unit = col.unit || record.__row?.unit;

  switch (render) {
    case "question_label":
      return getQuestionLabel(text, { question: name });
    case "option_pills":
      return renderOptionPills(entry, name);
    case "photo":
      return renderPhoto(entry);
    case "date":
      return formatDate(answerValue(entry));
    case "threshold": {
      const status = passThreshold(answerValue(entry), threshold);
      if (status === null) {
        return <Tag className="status-pill">{text.siteProfileStatusInfo}</Tag>;
      }
      // Routed through the shared tone table rather than naming AntD presets
      // directly, so a pass/fail pill cannot drift from every other one.
      return (
        <Tag
          className="status-pill"
          color={toneTagColor(status ? "good" : "critical")}
        >
          {status ? text.siteProfileStatusPass : text.siteProfileStatusFail}
        </Tag>
      );
    }
    case "threshold_label":
      return thresholdLabel(threshold, unit);
    case "value": {
      const value = answerValue(entry);
      if (value === null || value === "") {
        return emptyMark;
      }
      return unit ? `${value} ${unit}` : String(value);
    }
    case "severity": {
      const value = answerValue(entry);
      if (value === null || typeof value === "undefined" || value === "") {
        return emptyMark;
      }
      const option = resolveOption(
        findQuestionByName(name),
        Array.isArray(value) ? value[0] : value
      );
      return (
        <Tag
          className="status-pill"
          color={severityTagColor(optionSeverity(option.color))}
        >
          {option.label}
        </Tag>
      );
    }
    default: {
      const formatted = formatAnswer(entry, name);
      if (formatted === null) {
        return emptyMark;
      }
      return Array.isArray(formatted) ? formatted.join(", ") : formatted;
    }
  }
};

const RecordTable = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const latest = recordContext?.payload?.latest || {};
  const submissions = recordContext?.payload?.submissions || [];
  const isSubmissions = item.source === "submissions";

  // Resolve each row's effective question up front so every cell — and the
  // compliance verdict below — agrees on which name it is reading.
  const resolvedRows = (item.rows || []).map((row) => ({
    ...row,
    question: resolveRowQuestion(row, latest),
  }));

  const dataSource = isSubmissions
    ? submissions.map((s) => ({ key: s.data_id, ...s }))
    : resolvedRows.map((row, idx) => ({
        key: row.id || row.question || idx,
        __row: row,
      }));

  const columns = (item.cols || []).map((col, idx) => ({
    key: col.key || col.dataIndex || col.field || idx,
    title: getText(text, col.title_key, col.title),
    render: (_, record) =>
      renderCell(col, record, { latest, text, isSubmissions }),
  }));

  const title = getText(text, item.label_key, item.label);
  const caption = getText(text, item.caption_key, item.caption);

  const complianceRule = item.compliance_rule || [];
  const verdictPass = complianceRule.every((name) => {
    // A rule may name the row's id or any of a multi-form row's aliases;
    // judge the row on whichever question that datapoint actually answered.
    const row = resolvedRows.find(
      (r) =>
        r.id === name ||
        r.question === name ||
        (r.questions || []).includes(name)
    );
    const questionName = row?.question || name;
    return (
      passThreshold(answerValue(latest[questionName]), row?.threshold) !== false
    );
  });
  const complianceText = getText(
    text,
    item.compliance_text_key,
    item.compliance_text
  );

  return (
    <Card
      title={title}
      extra={caption ? <small>{caption}</small> : null}
      bordered
    >
      {dataSource.length ? (
        <>
          <Table
            columns={columns}
            dataSource={dataSource}
            pagination={false}
            size="small"
          />
          {complianceRule.length ? (
            <Typography.Text type="secondary">
              {text.siteProfileComplianceVerdict}:{" "}
              <Typography.Text strong type={verdictPass ? "success" : "danger"}>
                {verdictPass
                  ? text.siteProfileVerdictPass
                  : text.siteProfileVerdictFail}
              </Typography.Text>
              {complianceText ? ` — ${complianceText}` : null}
            </Typography.Text>
          ) : null}
        </>
      ) : (
        <Empty description={text.siteProfileNoData} />
      )}
    </Card>
  );
};

RecordTable.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default RecordTable;
