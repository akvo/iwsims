/**
 * Drinking-water compliance transform: classifies each EPS as compliant /
 * non-compliant by comparing its per-parameter values against the
 * per-parameter thresholds from config.water_quality.parameters, then
 * returns data shaped for <StackBar>.
 *
 * Pure function — no fetching. Caller fans out /values calls per parameter
 * and passes the responses in as a { [paramKey]: { data: [...] } } map.
 */
import { evaluateFormula, matchingFormulaLabels } from "./formula";

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
        byEps[row.group] = { _label: row.label, _answers: {} };
      }
      byEps[row.group][p.key] = row.value;
      if (p.api?.question_name) {
        byEps[row.group]._answers[p.api.question_name] = row.value;
      }
    });
  });
  return byEps;
};

const computeFormulaCompliance = (
  parameters,
  responsesByKey,
  formula,
  options
) => {
  const byEps = buildByEps(parameters || [], responsesByKey);
  const buckets = formula?.buckets || [];
  const defaultBucket = formula?.default || {};
  const byValue = new Map(
    [...buckets, defaultBucket].filter(Boolean).map((b) => [b.value, b])
  );
  const compliant = byValue.get("compliant") || {
    value: "compliant",
    label: "Yes",
  };
  const nonCompliant = byValue.get("non_compliant") || {
    value: "non_compliant",
    label: "No",
  };
  const noInfo = byValue.get("_no_info") || {
    value: "_no_info",
    label: options.noInfoLabel || "No information available",
  };
  const notApplicable = byValue.get("not_applicable") || {
    value: "not_applicable",
    label: "N/A",
  };

  const reasonLabels = Array.from(
    new Set(
      (nonCompliant.any_of || nonCompliant.all_of || [])
        .map((condition) => condition.label)
        .filter(Boolean)
    )
  );
  const yesRow = { compliance: compliant.label, Compliant: 0 };
  const noRow = { compliance: nonCompliant.label };
  reasonLabels.forEach((label) => {
    noRow[label] = 0;
  });

  const counts = {
    compliant: 0,
    non_compliant: 0,
    _no_info: 0,
    not_applicable: 0,
  };
  Object.values(byEps).forEach((eps) => {
    const bucket = evaluateFormula(formula, eps._answers);
    if (!bucket) {
      return;
    }
    counts[bucket.value] = (counts[bucket.value] || 0) + 1;
    if (bucket.value === "compliant") {
      yesRow.Compliant += 1;
    }
    if (bucket.value === "non_compliant") {
      // Failure conditions can overlap. Assign each EPS to the first
      // matching reason (the formula's priority order) so the stacked No
      // bar remains a count of unique EPS and matches the map marker count.
      const [primaryReason] = matchingFormulaLabels(bucket, eps._answers);
      if (primaryReason) {
        noRow[primaryReason] = (noRow[primaryReason] || 0) + 1;
      }
    }
  });

  const totalRegistered = options.totalRegistered;
  if (typeof totalRegistered === "number" && Number.isFinite(totalRegistered)) {
    const unobserved = Math.max(0, totalRegistered - Object.keys(byEps).length);
    const emptyBucket = evaluateFormula(formula, {});
    if (emptyBucket) {
      counts[emptyBucket.value] = (counts[emptyBucket.value] || 0) + unobserved;
    }
  }

  const data = [yesRow, noRow];
  if (counts._no_info > 0) {
    data.push({
      compliance: noInfo.label,
      [noInfo.label]: counts._no_info,
    });
  }
  if (counts.not_applicable > 0) {
    data.push({
      compliance: notApplicable.label,
      [notApplicable.label]: counts.not_applicable,
    });
  }

  return {
    data,
    stackLabels: [
      "Compliant",
      ...reasonLabels,
      ...(counts._no_info > 0 ? [noInfo.label] : []),
      ...(counts.not_applicable > 0 ? [notApplicable.label] : []),
    ],
    yesCount: counts.compliant,
    noCount: counts.non_compliant,
    noInfoCount: counts._no_info,
    notApplicableCount: counts.not_applicable,
  };
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
 * When a `formula` is supplied (a `compliance_formula` resolved from the
 * chart/card's `globals_ref`), classification is delegated to
 * `evaluateFormula` so the KPI card, the stacked-bar chart, and the map
 * marker all share one source of truth. In that mode hidden params are
 * NOT filtered out — the formula references question_names directly (e.g.
 * a `hide: true` fecal-coliform param still contributes its answer), so
 * dropping them would silently change the result.
 *
 * @param {Array<object>} parameters       water-quality params (with threshold, key, hide?)
 * @param {Object.<string,object>} responsesByKey  { [param.key]: /values response }
 * @param {object} [formula]               optional compliance_formula
 * @returns {number} count of compliant parents
 */
export const getCompliantCount = (parameters, responsesByKey, formula) => {
  // Formula mode keeps every param (incl. hidden) so the formula can read
  // their answers; threshold mode drops hidden params as before.
  const params = (parameters || []).filter((p) => formula || !p.hide);
  if (params.length === 0) {
    return 0;
  }
  const byEps = buildByEps(params, responsesByKey);
  let count = 0;
  if (formula) {
    Object.values(byEps).forEach((eps) => {
      const bucket = evaluateFormula(formula, eps._answers);
      if (bucket?.value === "compliant") {
        count += 1;
      }
    });
    return count;
  }
  Object.values(byEps).forEach((eps) => {
    const failed = params.filter((p) => fails(p.threshold, eps[p.key]));
    if (failed.length === 0) {
      count += 1;
    }
  });
  return count;
};

/**
 * Compute the Yes/No stacked-bar data for the drinking-water compliance chart.
 *
 * When `options.totalRegistered` is a finite number, appends a third
 * "No information available" row representing parents in the registered
 * universe that contributed to neither Yes nor No (e.g. EPS without any
 * water-quality measurements). Count is clamped to zero to defend against
 * transient races where param fetches resolve before the totals fetch.
 *
 * @param {Array<object>} parameters       config.water_quality.parameters (with threshold + label + key)
 * @param {Object.<string,object>} responsesByKey  { [param.key]: /values response }
 * @param {object} [options]
 * @param {number} [options.totalRegistered]  Universe size (count of registered parents in the filtered scope) used to derive the gap bucket.
 * @param {string} [options.noInfoLabel]      Translated label for the third X-axis category. Defaults to "No information available".
 * @returns {{
 *   data: Array<object>,
 *   stackLabels: string[],
 *   yesCount: number,
 *   noCount: number,
 *   noInfoCount: number,
 * }}
 */
export const computeComplianceStackData = (
  parameters,
  responsesByKey,
  options = {}
) => {
  if (options.formula) {
    return computeFormulaCompliance(
      parameters,
      responsesByKey,
      options.formula,
      options
    );
  }
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

  const data = [yesRow, noRow];
  const stackLabels = ["Compliant", ...activeParams.map((p) => p.label)];

  let noInfoCount = 0;
  const { totalRegistered, noInfoLabel } = options;
  if (typeof totalRegistered === "number" && Number.isFinite(totalRegistered)) {
    noInfoCount = Math.max(0, totalRegistered - yesCount - noCount);
    if (noInfoCount > 0) {
      const label = noInfoLabel || "No information available";
      data.push({ compliance: label, [label]: noInfoCount });
      stackLabels.push(label);
    }
  }

  return {
    data,
    stackLabels,
    yesCount,
    noCount,
    noInfoCount,
  };
};

export default computeComplianceStackData;
