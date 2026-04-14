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

  // Custom filters only apply when they target the SAME question that the
  // widget is already querying. This avoids clobbering KPI/chart queries
  // whose `api.question_id` has a specific semantic (e.g. operational_status,
  // construction-complete), and sidesteps the single-option_value limitation
  // of `/values` — which can't AND across multiple questions.
  //
  // Multi-question AND filtering + multi-value (multiple_option) filtering
  // need backend support on `/values`; until then, selecting a custom filter
  // only narrows charts whose own api.question_id matches it.
  (filterState?.custom || []).forEach((entry) => {
    const def = customFilterDefs.find((d) => d.key === entry.key);
    if (!def) {
      return;
    }
    if (
      typeof entry.value === "undefined" ||
      entry.value === null ||
      entry.value === ""
    ) {
      return;
    }
    if (Number(def.form_id) !== Number(out.form_id)) {
      return;
    }
    if (def.question_id && def.question_id === out.question_id) {
      out.option_value = Array.isArray(entry.value)
        ? entry.value[0]
        : entry.value;
    }
  });

  return out;
};
