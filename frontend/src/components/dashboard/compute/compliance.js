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

  // Merge per-parameter rows into a per-EPS lookup keyed by data[].group (parent_id).
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

  // Classify each EPS and tally per-parameter failure segments for the "No" bar.
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
