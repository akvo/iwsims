import { toneTagColor } from "../../../../components/dashboard/constants";

// Pure helpers for the Site Profile (no React/JSX).
// Holds shared value/format helpers and the config query-collector.

export const findQuestionByName = (name) => {
  if (!name) {
    return null;
  }
  const forms = window.forms || [];
  for (let i = 0; i < forms.length; i += 1) {
    const groups = forms[i]?.content?.question_group || [];
    for (let j = 0; j < groups.length; j += 1) {
      const found = (groups[j]?.question || []).find((q) => q?.name === name);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

export const resolveOption = (question, value) => {
  const opt = (question?.option || question?.options || []).find(
    (o) => o?.value === value
  );
  return opt
    ? { label: opt.label || opt.value, color: opt.color || null }
    : { label: value, color: null };
};

const SEVERITY_BY_COLOR = {
  "#009b77": "green",
  "#64a73b": "green",
  "#4a90e2": "green",
  "#efc050": "amber",
  "#dd4124": "red",
  "#e41a1c": "red",
  "#666666": "red",
};

export const optionSeverity = (color) =>
  color
    ? SEVERITY_BY_COLOR[String(color).toLowerCase()] || "neutral"
    : "neutral";

// Maps the profile's severity vocabulary onto the shared tone → Tag preset
// table, so a pill looks the same on a site profile as in a dashboard table.
export const severityTagColor = (sev) =>
  toneTagColor(
    { green: "good", amber: "warning", red: "critical" }[sev] || "neutral"
  );

export const getText = (text, key, fallback = "") => {
  if (key && text?.[key]) {
    return text[key];
  }
  return fallback;
};

export const emptyMark = "—";

export const latestEntry = (recordContext, questionName) =>
  questionName ? recordContext?.payload?.latest?.[questionName] : null;

export const answerValue = (entry) => {
  if (!entry) {
    return null;
  }
  if (Array.isArray(entry.options) && entry.options.length) {
    return entry.options;
  }
  if (entry.value !== null && typeof entry.value !== "undefined") {
    return entry.value;
  }
  return entry.name || null;
};

export const formatDate = (value) => {
  if (!value) {
    return emptyMark;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

export const formatAnswer = (entry, questionName) => {
  const value = answerValue(entry);
  if (value === null || value === "") {
    return null;
  }
  const question = findQuestionByName(questionName);
  if (Array.isArray(value)) {
    if (question?.type === "multiple_option" || entry?.options) {
      return value.map((v) => resolveOption(question, v).label);
    }
    return value.join(", ");
  }
  if (question?.type === "option" || question?.type === "multiple_option") {
    return resolveOption(question, value).label;
  }
  if (question?.type === "date") {
    return formatDate(value);
  }
  return String(value);
};

export const getQuestionLabel = (text, item, keyName = "question") => {
  const questionName = item?.[keyName];
  const question = findQuestionByName(questionName);
  return getText(
    text,
    item?.label_key,
    item?.label || question?.label || questionName
  );
};

export const passThreshold = (rawValue, threshold) => {
  const numeric = Number(rawValue);
  if (!threshold || Number.isNaN(numeric)) {
    return null;
  }
  if (
    threshold.min !== null &&
    typeof threshold.min !== "undefined" &&
    numeric < Number(threshold.min)
  ) {
    return false;
  }
  if (
    threshold.max !== null &&
    typeof threshold.max !== "undefined" &&
    numeric > Number(threshold.max)
  ) {
    return false;
  }
  return true;
};

export const thresholdLabel = (threshold, unit = "") => {
  if (!threshold) {
    return emptyMark;
  }
  const suffix = unit ? ` ${unit}` : "";
  const hasMin = threshold.min !== null && typeof threshold.min !== "undefined";
  const hasMax = threshold.max !== null && typeof threshold.max !== "undefined";
  if (hasMin && hasMax) {
    return `${threshold.min}${suffix} - ${threshold.max}${suffix}`;
  }
  if (hasMax) {
    return `< ${threshold.max}${suffix}`;
  }
  if (hasMin) {
    return `> ${threshold.min}${suffix}`;
  }
  return emptyMark;
};

const IMAGE_REF = /^(https?:|data:|\/)|\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i;

export const imageUrlsFromValue = (value) => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => (Array.isArray(entry) ? entry : entry))
    .filter(
      (entry) =>
        typeof entry === "string" &&
        entry.trim().length > 0 &&
        IMAGE_REF.test(entry.trim())
    );
};

// Resolve a registration answer (GET /data/{id} array of { question:<id>, value })
// by question name, formatted for display. Mirrors the Registration Data tab.
export const registrationAnswer = (registration, questionName) => {
  const question = findQuestionByName(questionName);
  if (!question || !Array.isArray(registration)) {
    return null;
  }
  const answer = registration.find((a) => `${a.question}` === `${question.id}`);
  const value = answer?.value;
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }
  if (question.type === "option" || question.type === "multiple_option") {
    const arr = Array.isArray(value) ? value : [value];
    return arr.map((v) => resolveOption(question, v).label).join(", ");
  }
  if (question.type === "date") {
    return formatDate(value);
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
};

// Raw registration answer value (no formatting) — for administration paths
// like "Fiji|Western" that the header formats itself.
export const registrationRawValue = (registration, questionName) => {
  const question = findQuestionByName(questionName);
  if (!question || !Array.isArray(registration)) {
    return null;
  }
  const answer = registration.find((a) => `${a.question}` === `${question.id}`);
  const value = answer?.value;
  return value === null || typeof value === "undefined" || value === ""
    ? null
    : value;
};

// Most recent cross-monitoring answer date (= last inspection), from the
// site-profile payload's latest{} entries.
export const lastInspectionDate = (payload) => {
  const latest = payload?.latest || {};
  let max = null;
  Object.values(latest).forEach((entry) => {
    if (!entry?.created) {
      return;
    }
    const time = new Date(entry.created).getTime();
    if (!Number.isNaN(time) && (max === null || time > max)) {
      max = time;
    }
  });
  return max === null ? null : formatDate(max);
};

// ── Config query-collector ─────────────────────────────────────────────
// Derives the questions / history / records request params from a config so
// the provider fetches exactly what the tabs need.

const pushUnique = (list, value) => {
  if (value && !list.includes(value)) {
    list.push(value);
  }
};

const visitChild = (child, query) => {
  if (!child || child.hide) {
    return;
  }
  const type = child.chart_type;
  if (type === "line") {
    if (child.source === "risk_score") {
      (child.questions || []).forEach((name) =>
        pushUnique(query.records, name)
      );
      pushUnique(query.records, child.date_question);
    } else {
      // A trend line may alias the same measurement across monitoring forms
      // (`questions: [...]`); fetch every alias so the widget can pick the one
      // this datapoint actually has history for.
      pushUnique(query.history, child.question);
      (child.questions || []).forEach((name) =>
        pushUnique(query.history, name)
      );
    }
    return;
  }
  if (type === "record" && child.source === "submissions") {
    (child.cols || []).forEach((col) =>
      pushUnique(query.records, col.dataIndex || col.question)
    );
    (child.questions || []).forEach((name) => pushUnique(query.records, name));
    return;
  }
  if (type === "record") {
    (child.rows || []).forEach((row) => {
      pushUnique(query.questions, row.question);
      // Rows may alias the same parameter across monitoring forms; every alias
      // has to be fetched or the row resolves to a question we never asked for.
      (row.questions || []).forEach((name) =>
        pushUnique(query.questions, name)
      );
      pushUnique(query.questions, row.photo);
      pushUnique(query.questions, row.notes);
    });
    return;
  }
  if (type === "field") {
    pushUnique(query.questions, child.question);
    (child.questions || []).forEach((name) =>
      pushUnique(query.questions, name)
    );
    (child.rows || []).forEach((row) =>
      pushUnique(query.questions, row.question)
    );
    return;
  }
  if (type === "photo") {
    if (child.source === "submissions") {
      pushUnique(query.records, child.question);
    } else {
      pushUnique(query.questions, child.question);
    }
  }
};

export const collectSiteProfileQueries = (config) => {
  const query = { questions: [], history: [], records: [] };
  const header = config?.header;
  if (header) {
    const photos = Array.isArray(header.photo) ? header.photo : [header.photo];
    photos.forEach((photo) => pushUnique(query.questions, photo));
    pushUnique(query.questions, header.location);
    pushUnique(query.questions, header.village);
    (header.meta || []).forEach((meta) =>
      pushUnique(query.questions, meta.question)
    );
  }
  (config?.children || []).forEach((child) => visitChild(child, query));
  return query;
};
