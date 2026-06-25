const pushUnique = (list, value) => {
  if (value && !list.includes(value)) {
    list.push(value);
  }
};

const addRows = (rows = [], list) => {
  rows.forEach((row) => {
    pushUnique(list, row.question);
    pushUnique(list, row.photo);
    pushUnique(list, row.notes);
    pushUnique(list, row.action_question);
    pushUnique(list, row.recurring_question);
  });
};

const addColumns = (columns = [], list) => {
  columns.forEach((column) => {
    pushUnique(list, column.question);
  });
};

const visitItem = (item, query) => {
  if (!item || item.hide) {
    return;
  }

  if (item.chart_type === "trend" && item.question) {
    pushUnique(query.history, item.question);
  } else if (
    item.chart_type === "custom" &&
    item.component === "RiskScoreTrend"
  ) {
    pushUnique(
      query.history,
      item.question || item.questions?.[0] || "has_final_recommendation"
    );
  } else if (item.chart_type === "record_table") {
    addColumns(item.columns, query.records);
    (item.questions || []).forEach((question) =>
      pushUnique(query.records, question)
    );
  } else if (item.chart_type === "photo" && item.source === "submissions") {
    pushUnique(query.records, item.question);
  } else {
    pushUnique(query.questions, item.question);
    (item.questions || []).forEach((question) =>
      pushUnique(query.questions, question)
    );
    addRows(item.rows, query.questions);
  }

  (item.items || []).forEach((child) => {
    if (child?.items) {
      child.items.forEach((nested) => visitItem(nested, query));
      return;
    }
    visitItem(child, query);
  });
};

export const collectSiteProfileQueries = (config) => {
  const query = { questions: [], history: [], records: [] };
  (config?.items || []).forEach((item) => visitItem(item, query));
  return query;
};
