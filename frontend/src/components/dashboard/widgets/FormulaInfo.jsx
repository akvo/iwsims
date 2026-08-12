import React from "react";
import PropTypes from "prop-types";
import { Popover } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";

/**
 * Small "(i)" affordance that reveals the business-authored calculation
 * behind a widget. The text comes from each config item's `info` field
 * (generated from the source CSV's "Calculation Comprehensive monitoring"
 * column, with question ids converted to question_names). Renders nothing
 * when the item has no `info`, so it is safe to drop next to every title.
 */
const FormulaInfo = ({ info, title }) => {
  if (!info || typeof info !== "string") {
    return null;
  }
  const lines = info.split(/\r?\n/).filter((line) => line.trim() !== "");
  return (
    <Popover
      placement="topRight"
      title={title || "How this is calculated"}
      content={
        <div
          style={{ maxWidth: 380, fontSize: 12, whiteSpace: "pre-wrap" }}
          className="formula-info-content"
        >
          {lines.map((line, index) => (
            <div key={index}>{line}</div>
          ))}
        </div>
      }
    >
      <InfoCircleOutlined
        className="formula-info-icon"
        // The colour is routed through a custom property rather than fixed
        // here so a surface that sets its own ink — a solid status card, where
        // a fixed grey is invisible — can override it. Everywhere else the
        // fallback applies and nothing changes.
        style={{
          marginLeft: 6,
          color: "var(--formula-info-color, #8c8c8c)",
          cursor: "help",
        }}
        aria-label="How this is calculated"
      />
    </Popover>
  );
};

FormulaInfo.propTypes = {
  info: PropTypes.string,
  title: PropTypes.string,
};

FormulaInfo.defaultProps = {
  info: null,
  title: null,
};

export default FormulaInfo;
