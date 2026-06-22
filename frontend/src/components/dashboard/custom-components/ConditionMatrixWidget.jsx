import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Alert, Card, Col, Row, Skeleton, Typography } from "antd";
import { useDashboardValues } from "../../../util/hooks";
import { computeConditionField } from "../compute/conditionMatrix";

const { Text } = Typography;

/**
 * Invisible per-field fetcher. Mirrors StageFlowWidget's StageFetcher: each
 * field's `option` question is a standalone /values call, reported back up via
 * `onData` so the parent can render the whole matrix once.
 */
const FieldFetcher = ({
  field,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  parentFormId,
  onData,
}) => {
  const { data, loading, error } = useDashboardValues(field.api, filterState, {
    fiscalYearStartMonth,
    customFilterDefs,
    parentFormId,
  });

  useEffect(() => {
    onData(field.key, { data, loading, error });
  }, [field.key, data, loading, error, onData]);

  return null;
};

FieldFetcher.propTypes = {
  field: PropTypes.shape({
    key: PropTypes.string.isRequired,
    api: PropTypes.object.isRequired,
  }).isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onData: PropTypes.func.isRequired,
};

FieldFetcher.defaultProps = {
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  parentFormId: null,
};

/**
 * One indicator: title + a readout, a stacked good→bad bar, and a dot legend.
 * `readout` selects the right-aligned summary: "% good" (default) or the
 * "{primary} / {total}" count used by yes/no panels.
 */
const ConditionField = ({ field, result, readout }) => {
  const computed = useMemo(
    () => computeConditionField(field.options, result?.data),
    [field.options, result]
  );
  const visible = computed.options.filter((o) => o.count > 0);
  const readoutText =
    readout === "count_of_total"
      ? computed.total > 0
        ? `${computed.primaryCount} / ${computed.total}`
        : null
      : computed.goodPct !== null
      ? `${computed.goodPct}% good`
      : null;

  return (
    <div className="condition-field">
      <div className="condition-field-head">
        <span className="condition-field-title">{field.label}</span>
        {readoutText !== null && (
          <span className="condition-field-pct">{readoutText}</span>
        )}
      </div>
      {computed.total > 0 ? (
        <>
          <div
            className="condition-field-bar"
            role="img"
            aria-label={`${field.label} breakdown`}
          >
            {visible.map((o) => (
              <span
                key={o.value}
                className="condition-field-segment"
                style={{
                  width: `${(o.count / computed.total) * 100}%`,
                  backgroundColor: o.color,
                }}
                title={`${o.label}: ${o.count}`}
              />
            ))}
          </div>
          <div className="condition-field-legend">
            {visible.map((o) => (
              <span
                key={o.value}
                className="condition-field-legend-item"
                style={{ color: o.color }}
              >
                <span
                  className="condition-field-dot"
                  style={{ backgroundColor: o.color }}
                />
                <span className="condition-field-legend-text">
                  {o.count} {o.label}
                </span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="condition-field-empty">No data</div>
      )}
    </div>
  );
};

ConditionField.propTypes = {
  field: PropTypes.shape({
    key: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    options: PropTypes.array.isRequired,
  }).isRequired,
  result: PropTypes.object,
  readout: PropTypes.oneOf(["pct_good", "count_of_total"]),
};

ConditionField.defaultProps = { result: null, readout: "pct_good" };

/**
 * Condition matrix panel.
 *
 * Renders a dense per-field option breakdown for `option` questions that share
 * one monitoring form: each field is a horizontal tone-colored bar with a
 * right-aligned readout and a colored dot legend, laid out in `columns`
 * columns. Used for both multi-option condition scales (e.g. Structural & Site
 * Condition, Plant Condition) and yes/no program panels.
 *
 * `item.readout` picks the summary per field: "pct_good" (default — "X% good")
 * or "count_of_total" ("{yes} / {total}"). Self-fetching (one /values call per
 * field) like StageFlowWidget — the dashboard's compute fan-out is not
 * involved. Each option's `tone` drives both the segment color and (for
 * pct_good) which slice counts as good (see compute/conditionMatrix.js).
 */
const ConditionMatrixWidget = ({
  item,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  parentFormId,
}) => {
  const [results, setResults] = useState({});

  const onFieldData = useCallback((key, payload) => {
    setResults((prev) =>
      prev[key] === payload ? prev : { ...prev, [key]: payload }
    );
  }, []);

  const fields = item.fields || [];
  const loading = fields.some(
    (f) => !results[f.key] || results[f.key]?.loading
  );
  const error = fields.map((f) => results[f.key]?.error).find(Boolean);

  const span = 24 / (item.columns || 2);
  const title = item.title || item.label || "Condition";

  return (
    <Card className="chart-card condition-matrix">
      <div className="condition-matrix-head">
        <h4 className="condition-matrix-title">{title}</h4>
        {item.subtitle && (
          <Text type="secondary" className="condition-matrix-subtitle">
            {item.subtitle}
          </Text>
        )}
      </div>
      {fields.map((field) => (
        <FieldFetcher
          key={field.key}
          field={field}
          filterState={filterState}
          fiscalYearStartMonth={fiscalYearStartMonth}
          customFilterDefs={customFilterDefs}
          parentFormId={parentFormId}
          onData={onFieldData}
        />
      ))}
      {error ? (
        <Alert
          type="error"
          message={`Failed to load ${item.id}: ${error.message || "error"}`}
        />
      ) : loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Row gutter={[32, 8]} className="condition-matrix-grid">
          {fields.map((field) => (
            <Col key={field.key} xs={24} md={span}>
              <ConditionField
                field={field}
                result={results[field.key]}
                readout={item.readout}
              />
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );
};

ConditionMatrixWidget.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string,
    label: PropTypes.string,
    subtitle: PropTypes.string,
    columns: PropTypes.number,
    readout: PropTypes.oneOf(["pct_good", "count_of_total"]),
    fields: PropTypes.arrayOf(
      PropTypes.shape({
        key: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        api: PropTypes.object.isRequired,
        options: PropTypes.array.isRequired,
      })
    ).isRequired,
  }).isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

ConditionMatrixWidget.defaultProps = {
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  parentFormId: null,
};

export default ConditionMatrixWidget;
