/**
 * Drinking-water compliance transform: classifies each EPS as compliant /
 * non-compliant by comparing its per-parameter values against the
 * per-parameter thresholds from config.water_quality.parameters, then
 * returns data shaped for <StackBar>.
 *
 * Pure function — no fetching. Caller fans out /values calls per parameter
 * and passes the responses in as a { [paramKey]: { data: [...] } } map.
 */

/**
 * Returns true if `value` is outside the threshold band. null/undefined
 * values are treated as "no data" (not a violation).
 *
 * @param {{min?: number, max?: number}} threshold
 * @param {number|null|undefined} value
 * @returns {boolean}
 */
export const fails = (threshold = {}, value) => {
  if (value === null || typeof value === "undefined") {
    return false;
  }
  if (typeof threshold.min !== "undefined" && value < threshold.min) {
    return true;
  }
  if (typeof threshold.max !== "undefined" && value > threshold.max) {
    return true;
  }
  return false;
};

/**
 * Merge per-parameter /values responses into a per-EPS lookup keyed by
 * parent_id (data[].group). Shared by computeComplianceStackData and
 * getCompliantCount so the two stay in lock-step.
 *
 * @param {Array<object>} activeParams          parameters with `.hide !== true`
 * @param {Object.<string,object>} responsesByKey { [param.key]: /values response }
 * @returns {Object.<string,object>} { [parent_id]: { _label, [param.key]: value } }
 */
const buildByEps = (activeParams, responsesByKey) => {
  const byEps = {};
  activeParams.forEach((p) => {
    const rows = responsesByKey?.[p.key]?.data || [];
    rows.forEach((row) => {
      if (!byEps[row.group]) {
        byEps[row.group] = { _label: row.label };
      }
      byEps[row.group][p.key] = row.value;
    });
  });
  return byEps;
};

/**
 * Count parents whose measurements are all within their parameter
 * thresholds. Missing values for a parameter are treated as "no data"
 * (not a violation) — matches the existing computeComplianceStackData
 * semantics. Parents that don't appear in any response are not counted.
 *
 * Exposed separately from computeComplianceStackData so the compliance
 * KPI card can reuse the same classification without running the full
 * stacked-bar transform. Single source of truth for compliance counts.
 *
 * @param {Array<object>} parameters       water-quality params (with threshold, key, hide?)
 * @param {Object.<string,object>} responsesByKey  { [param.key]: /values response }
 * @returns {number} count of compliant parents
 */
export const getCompliantCount = (parameters, responsesByKey) => {
  const activeParams = (parameters || []).filter((p) => !p.hide);
  if (activeParams.length === 0) {
    return 0;
  }
  const byEps = buildByEps(activeParams, responsesByKey);
  let count = 0;
  Object.values(byEps).forEach((eps) => {
    const failed = activeParams.filter((p) => fails(p.threshold, eps[p.key]));
    if (failed.length === 0) {
      count += 1;
    }
  });
  return count;
};

/**
 * Compute the Yes/No stacked-bar data for the drinking-water compliance chart.
 *
 * @param {Array<object>} parameters       config.water_quality.parameters (with threshold + label + key)
 * @param {Object.<string,object>} responsesByKey  { [param.key]: /values response }
 * @returns {{
 *   data: Array<object>,
 *   stackLabels: string[],
 *   yesCount: number,
 *   noCount: number,
 * }}
 */
export const computeComplianceStackData = (parameters, responsesByKey) => {
  const activeParams = (parameters || []).filter((p) => !p.hide);
  const byEps = buildByEps(activeParams, responsesByKey);

  const yesRow = { compliance: "Yes", Compliant: 0 };
  const noRow = { compliance: "No" };
  activeParams.forEach((p) => {
    noRow[p.label] = 0;
  });

  let yesCount = 0;
  let noCount = 0;
  Object.values(byEps).forEach((eps) => {
    const failed = activeParams.filter((p) => fails(p.threshold, eps[p.key]));
    if (failed.length === 0) {
      yesRow.Compliant += 1;
      yesCount += 1;
    } else {
      failed.forEach((p) => {
        noRow[p.label] += 1;
      });
      noCount += 1;
    }
  });

  return {
    data: [yesRow, noRow],
    stackLabels: ["Compliant", ...activeParams.map((p) => p.label)],
    yesCount,
    noCount,
  };
};

export default computeComplianceStackData;
