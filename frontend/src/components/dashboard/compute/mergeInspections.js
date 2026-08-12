/**
 * Merge per-asset inspection feeds into one chronological list.
 *
 * The escalation endpoint is scoped to one registration family, so a
 * fleet-wide "Latest Inspections" cannot be a single request. It fans out one
 * request per asset and merges here.
 *
 * Taking the newest N from each family and keeping the newest N of the union
 * is exact, not an approximation: a row in the true global top N must be in
 * its own family's top N, since every row it beats globally it also beats
 * within its family. So N per segment is all that has to be fetched, however
 * many families there are.
 */

/** Column keys that name a per-segment question rather than a fixed one. */
const QUESTION_SOURCES = ["latest_date", "answer", "parent_answer"];

/**
 * Resolve a shared column list against one segment's question names.
 *
 * Families ask the same thing under different names — the inspection date is
 * `date_of_inspection` on WTP and `inspection_date` elsewhere; the inspector is
 * `dws_staff_name`, `dws_officer_name` or `officer_name` depending on the form.
 * The config declares each column once and each segment supplies its own names,
 * so a new asset is a segment rather than a second column list to keep in step.
 *
 * A column whose question this segment does not ask is dropped from that
 * segment's request — asking for a question a form has no copy of would return
 * nothing for every row, not just the missing cell.
 */
export const resolveSegmentColumns = (columns = [], segment = {}) => {
  const questions = segment.questions || {};
  return columns
    .filter((col) => !col.computed)
    .map((col) => {
      if (!QUESTION_SOURCES.includes(col.source)) {
        return col;
      }
      const questionName = questions[col.key];
      return questionName ? { ...col, question_name: questionName } : null;
    })
    .filter(Boolean);
};

/** ISO date (or datetime) → comparable YYYY-MM-DD, or "" when unusable. */
const dateKey = (value) => {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.slice(0, 10);
};

/**
 * Whole days between an inspection date and `today`.
 * Returns null for a missing or unparseable date rather than a bogus 0.
 */
export const daysSince = (value, today = new Date()) => {
  const key = dateKey(value);
  if (!key) {
    return null;
  }
  const then = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) {
    return null;
  }
  const now = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  return Math.round((now - then) / 86400000);
};

/**
 * Flatten per-segment responses into one list, newest first.
 *
 * @param {Array<{segment: object, rows: object[]}>} responses
 * @param {string} dateKeyName  column key holding the inspection date
 * @param {number} limit        rows to keep
 */
export const mergeInspectionRows = (
  responses = [],
  dateKeyName = "last_inspected",
  limit = 8
) => {
  const rows = responses.flatMap(({ segment, rows: segmentRows }) =>
    (segmentRows || []).map((row) => ({
      ...row,
      __segment: segment?.key,
      __assetLabel: segment?.label || segment?.key,
    }))
  );
  // A row with no date cannot be placed on a chronological list at all, so it
  // is dropped rather than sorted to one end where it would read as either the
  // most or least recent inspection.
  return rows
    .filter((row) => dateKey(row[dateKeyName]))
    .sort((a, b) => {
      const diff = dateKey(b[dateKeyName]).localeCompare(
        dateKey(a[dateKeyName])
      );
      // Ties are common — several plants share an inspection date — so break
      // them by name to keep the order stable between renders.
      return diff !== 0
        ? diff
        : String(a.name || "").localeCompare(String(b.name || ""));
    })
    .slice(0, limit);
};

/**
 * `from_date` for a rolling window, as the YYYY-MM-DD the endpoint expects.
 * Returns null when the item declares no window, so the param is omitted.
 */
export const rollingFromDate = (rollingMonths, today = new Date()) => {
  if (!rollingMonths) {
    return null;
  }
  const from = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  from.setUTCMonth(from.getUTCMonth() - Number(rollingMonths));
  return from.toISOString().slice(0, 10);
};
