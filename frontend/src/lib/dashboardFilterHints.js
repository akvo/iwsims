/**
 * Frontend expansion of config-only hints on a dashboard api block.
 *
 * Hints: `rolling_months`, `fiscal_year`, `past_due`.
 * These are never sent to the backend; they are resolved into concrete
 * `from_date` / `to_date` (plus a couple of param renames for `past_due`)
 * before a fetch is issued.
 *
 * Pure functions only — no React, no fetch, no clock access except through
 * the explicit `today` argument. Keeps the module unit-testable.
 */

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Format a Date as ISO `YYYY-MM-DD` in UTC.
 * @param {Date} d
 * @returns {string}
 */
export const toIsoDate = (d) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/**
 * Subtract N months from a date without mutating the input.
 * @param {Date} d
 * @param {number} months
 * @returns {Date}
 */
export const subtractMonths = (d, months) => {
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())
  );
  return out;
};

/**
 * Subtract one UTC day.
 * @param {Date} d
 * @returns {Date}
 */
export const subtractOneDay = (d) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1));

/**
 * Given a reference date and fiscal-year start month (1-12), return the
 * inclusive `[from, to]` Date pair for the fiscal year containing `today`.
 *
 * Example: today = 2026-04-14, startMonth = 7
 *   → 2025-07-01 .. 2026-06-30
 *
 * Example: today = 2026-04-14, startMonth = 1
 *   → 2026-01-01 .. 2026-12-31
 *
 * @param {Date} today
 * @param {number} startMonth  1 = January … 12 = December
 * @returns {{ from: Date, to: Date }}
 */
export const fiscalYearRange = (today, startMonth) => {
  const m0 = startMonth - 1; // 0-indexed
  const y = today.getUTCFullYear();
  const startYear = today.getUTCMonth() >= m0 ? y : y - 1;
  const from = new Date(Date.UTC(startYear, m0, 1));
  const to = new Date(Date.UTC(startYear + 1, m0, 0)); // day 0 = last day of prev month
  return { from, to };
};

/**
 * Given an api block from the dashboard config and a context
 * (today + filters.date.fiscal_year_start_month), return a plain object
 * of API query params with all hints resolved and stripped.
 *
 * The returned object is safe to merge directly into URLSearchParams.
 *
 * @param {object} apiBlock
 * @param {{ today?: Date, fiscalYearStartMonth?: number }} [ctx]
 * @returns {object}
 */
export const expandApiHints = (apiBlock, ctx = {}) => {
  const today = ctx.today || new Date();
  const fyStart = ctx.fiscalYearStartMonth || 1;

  const {
    rolling_months,
    fiscal_year,
    past_due,
    completion_question_id,
    deadline_question_id,
    ...rest
  } = apiBlock || {};

  const out = { ...rest };

  if (rolling_months && typeof rolling_months === "number") {
    out.from_date = toIsoDate(subtractMonths(today, rolling_months));
    out.to_date = toIsoDate(today);
  }

  if (fiscal_year === true) {
    const { from, to } = fiscalYearRange(today, fyStart);
    out.from_date = toIsoDate(from);
    out.to_date = toIsoDate(to);
  }

  if (past_due === true) {
    if (completion_question_id) {
      out.question_id = completion_question_id;
      out.option_value = "no";
    }
    if (deadline_question_id) {
      out.date_question_id = deadline_question_id;
    }
    out.to_date = toIsoDate(subtractOneDay(today));
  }

  return out;
};

/**
 * Merge a base filter block (date range, administration_id, custom filters)
 * into an already-hint-expanded api params object. Dashboard-level filters
 * win over widget defaults except where the widget pins a specific value
 * (e.g. a fiscal_year hint already fixed from_date/to_date).
 *
 * Custom filters apply only when their `form_id` matches the api block.
 *
 * @param {object} params      hint-expanded api params (already has form_id)
 * @param {object} filterState output of useDashboardFilters.toQueryParams()
 * @param {object[]} [customFilterDefs]  config.filters.custom entries
 * @returns {object}
 */
export const applyDashboardFilters = (
  params,
  filterState,
  customFilterDefs = []
) => {
  const out = { ...params };

  // Date range: only apply when the widget didn't already pin dates.
  if (filterState?.from_date && !out.from_date) {
    out.from_date = filterState.from_date;
  }
  if (filterState?.to_date && !out.to_date) {
    out.to_date = filterState.to_date;
  }

  // Administration filter is always safe to propagate.
  if (filterState?.administration_id && !out.administration_id) {
    out.administration_id = filterState.administration_id;
  }

  // Custom filters: emit as `criteria=type:qid:value,...` so /values
  // narrows every widget on the dashboard, not just those whose own
  // api.question_id happens to match. Criteria AND across questions
  // server-side; option_in handles OR within a multiple_option.
  const criteria = [];
  (filterState?.custom || []).forEach((entry) => {
    const def = customFilterDefs.find((d) => d.key === entry.key);
    if (!def || !def.question_id) {
      return;
    }
    const raw = Array.isArray(entry.value) ? entry.value : [entry.value];
    const values = raw.filter(
      (v) => v !== null && v !== "" && typeof v !== "undefined"
    );
    if (values.length === 0) {
      return;
    }
    const isMulti = def.chart_type === "filter_multi_option";
    if (isMulti) {
      if (values.length === 1) {
        criteria.push(`option_contains:${def.question_id}:${values[0]}`);
      } else {
        criteria.push(`option_in:${def.question_id}:${values.join("|")}`);
      }
    } else if (values.length === 1) {
      criteria.push(`option_equals:${def.question_id}:${values[0]}`);
    } else {
      criteria.push(`option_in:${def.question_id}:${values.join("|")}`);
    }
  });
  if (criteria.length > 0) {
    out.criteria = criteria.join(",");
  }

  return out;
};
