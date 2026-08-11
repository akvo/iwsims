import React, { useCallback, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Alert, Table, Button, Tag } from "antd";
import { DownCircleOutlined, LeftCircleOutlined } from "@ant-design/icons";
import { useDashboardEscalation } from "../../util/hooks";
import { uiText, store } from "../../lib";
import { toneTagColor } from "./constants";

const MAX_COLUMNS = 6;

const renderValue = (column, row, cellComputers) => {
  if (column.computed) {
    const computer = cellComputers[column.key];
    const computed = computer ? computer(row) : null;
    if (computed === null || typeof computed === "undefined") {
      return null;
    }
    return typeof computed === "object"
      ? JSON.stringify(computed)
      : String(computed);
  }
  const value = row[column.key];
  if (value === null || typeof value === "undefined") {
    return null;
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

/**
 * Renders a paginated AntD Table from a flat-schema `table` item.
 *
 * Dynamic column definitions come from `item.columns`. Computed columns
 * (where `computed: true` — no backend source) delegate to a per-column
 * function in `cellComputers`, keyed by `column.key`.
 *
 * Columns with `progress_ref` and `component_key` are resolved client-side
 * from the progress response data passed in via `cellComputers`.
 */
const EscalationTable = ({
  item,
  filterState,
  customFilterDefs,
  pageSize = 10,
  cellComputers = {},
  parentFormId,
}) => {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useDashboardEscalation(item, filterState, {
    page,
    pageSize,
    customFilterDefs,
    parentFormId,
  });
  uiText;
  const { active: activeLang } = store.useState((s) => s.language);
  const text = useMemo(() => {
    return uiText?.[activeLang] || uiText.en;
  }, [activeLang]);

  const visibleColumns = useMemo(
    () => (item.columns || []).filter((c) => !c.hide),
    [item.columns]
  );

  // window.forms is populated once at app load — stable reference, no deps.
  const allQuestions = useMemo(
    () =>
      window.forms?.flatMap((f) =>
        f?.content?.question_group?.flatMap((qg) => qg?.question)
      ),
    []
  );

  const summaryColumns = useMemo(() => {
    const priority = visibleColumns.filter((c) => c.priority);
    return priority.length > 0
      ? priority
      : visibleColumns.slice(0, MAX_COLUMNS);
  }, [visibleColumns]);

  // Resolve a cell to its human display: option answers (e.g.
  // type_of_project) render the option label, not the stored value. Shared
  // by the summary table and the expanded detail so both stay consistent.
  const resolveDisplay = useCallback(
    (c, row) => {
      const display = renderValue(c, row, cellComputers);
      if (display === null) {
        return null;
      }
      const question = allQuestions?.find((q) => q?.name === c?.question_name);
      if (question?.option?.length) {
        const optionAnswer = question.option.find(
          (qo) => qo?.value === display
        );
        return optionAnswer?.label || display;
      }
      return display;
    },
    [cellComputers, allQuestions]
  );

  // Indicator columns declare `tones: { <option value>: good|warning|critical }`
  // in config rather than reading the form's own option colours: those are
  // inconsistent across questions (an "electrical hazard" option is green in
  // the form definition), and the same answer means opposite things in
  // different columns — "yes" is good for OHS equipment and bad for production
  // constraints. The pill always carries its label, so colour never stands alone.
  const renderCell = useCallback(
    (c, row) => {
      const display = resolveDisplay(c, row);
      if (display === null) {
        return <span style={{ color: "#bbb" }}>—</span>;
      }
      const tone = c.tones?.[renderValue(c, row, cellComputers)];
      if (!tone) {
        return <span>{display}</span>;
      }
      return (
        <Tag className="status-pill" color={toneTagColor(tone)}>
          {display}
        </Tag>
      );
    },
    [resolveDisplay, cellComputers]
  );

  const columns = useMemo(
    () => [
      ...summaryColumns.map((c) => ({
        title: c.label,
        dataIndex: c.key,
        key: c.key,
        render: (_value, row) => renderCell(c, row),
      })),
      Table.EXPAND_COLUMN,
    ],
    [summaryColumns, renderCell]
  );

  const renderExpandedRow = useCallback(
    (row, item, text) => {
      const rows = visibleColumns.map((c) => ({
        key: c.key,
        label: c.label,
        display: renderCell(c, row),
      }));
      return (
        <div>
          {(item?.api?.form_id || parentFormId) && (
            <div
              style={{
                textAlign: "right",
                marginRight: 20,
                paddingBottom: 4,
                paddingTop: 4,
              }}
            >
              <a
                href={`/control-center/data/${
                  item?.api?.form_id || parentFormId
                }/monitoring/${row.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button type="primary" shape="round">
                  {text.viewDetails}
                </Button>
              </a>
            </div>
          )}
          <div className="pending-data-wrapper">
            <h3>{item.label || "Details"}</h3>
            <Table
              pagination={false}
              dataSource={rows}
              rowKey="key"
              columns={[
                {
                  title: "Question",
                  dataIndex: "label",
                  width: "50%",
                  className: "table-col-question",
                },
                {
                  title: "Response",
                  dataIndex: "display",
                  width: "50%",
                  render: (display) =>
                    display === null ? (
                      <span style={{ color: "#bbb" }}>—</span>
                    ) : (
                      display
                    ),
                },
              ]}
            />
          </div>
        </div>
      );
    },
    [visibleColumns, renderCell, parentFormId]
  );

  if (error) {
    return (
      <Alert
        type="error"
        message={`Failed to load escalation list: ${error.message || "error"}`}
      />
    );
  }

  return (
    <Table
      rowKey="id"
      loading={loading}
      columns={columns}
      dataSource={data?.results || []}
      expandable={{
        expandedRowRender: (row) => renderExpandedRow(row, item, text),
        expandRowByClick: true,
        expandIcon: ({ expanded, onExpand, record }) =>
          expanded ? (
            <DownCircleOutlined
              onClick={(e) => onExpand(record, e)}
              style={{ color: "#1651B6", fontSize: "19px" }}
            />
          ) : (
            <LeftCircleOutlined
              onClick={(e) => onExpand(record, e)}
              style={{ color: "#1651B6", fontSize: "19px" }}
            />
          ),
      }}
      pagination={{
        current: page,
        pageSize,
        total: data?.count || 0,
        onChange: setPage,
        showSizeChanger: false,
      }}
    />
  );
};

EscalationTable.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  customFilterDefs: PropTypes.array,
  pageSize: PropTypes.number,
  cellComputers: PropTypes.object,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

export default EscalationTable;
