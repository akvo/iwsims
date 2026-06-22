/**
 * "Critical" KPI transform (card label: "Critical (RED)").
 *
 * A plant is critical when:
 *   DW Compliance = Non-compliant  OR  Plant is Non-Operational
 *
 * A plant is OPERATIONAL when ALL of its operational segments pass. Each
 * segment is a per-parent /values response (group_by=parent_id) plus a
 * rule:
 *   - option_equals      pass if the latest option array contains `value`
 *                        (a missing answer fails — used for required "no
 *                        production constraints")
 *   - option_not_equals  pass if the latest option array does NOT contain
 *                        `value` (a missing answer passes — used for the
 *                        pump-risk questions, which only apply when that
 *                        pump is part of the transport method)
 *   - number_gt          pass if the latest numeric value > `value`
 *                        (a missing answer fails — used for production > 0)
 *
 * Non-compliance reuses the water-quality param responses + thresholds
 * (same source as the DW Compliance KPI): a plant is non-compliant if any
 * param's latest value is outside its threshold band.
 *
 * Pure function — no fetching. The dashboard fans out the param and
 * operational-segment /values calls and passes the responses in.
 */
import { fails } from "./compliance";

/**
 * Parents whose latest value is outside any param threshold band.
 *
 * @param {Array<object>} params           water-quality params (threshold, key)
 * @param {Object.<string,object>} responsesByKey { [param.key]: /values response }
 * @returns {Set<string>} parent ids (as strings)
 */
export const getNonCompliantParentIds = (params, responsesByKey) => {
  const out = new Set();
  (params || []).forEach((p) => {
    const rows = responsesByKey?.[p.key]?.data || [];
    rows.forEach((row) => {
      if (fails(p.threshold, row.value)) {
        out.add(String(row.group));
      }
    });
  });
  return out;
};

/**
 * Evaluate a single operational segment rule against a per-parent value.
 * `value` is a number (number_gt) or an array of option values (option_*).
 */
export const segmentPasses = (rule, value) => {
  if (!rule) {
    return true;
  }
  if (rule.op === "number_gt") {
    return typeof value === "number" && value > rule.value;
  }
  const opts = Array.isArray(value) ? value : [];
  if (rule.op === "option_equals") {
    return opts.includes(rule.value);
  }
  if (rule.op === "option_not_equals") {
    return !opts.includes(rule.value);
  }
  return true;
};

/**
 * Index operational-segment responses into a per-parent value lookup.
 *
 * @param {Array<object>} segments         [{ key, rule }]
 * @param {Object.<string,object>} segmentResponses { [segment.key]: /values response }
 * @returns {Object.<string, Object.<string, any>>} { [parent_id]: { [key]: value } }
 */
const indexByParent = (segments, segmentResponses) => {
  const byParent = {};
  (segments || []).forEach((seg) => {
    const rows = segmentResponses?.[seg.key]?.data || [];
    rows.forEach((row) => {
      const id = String(row.group);
      if (!byParent[id]) {
        byParent[id] = {};
      }
      byParent[id][seg.key] = row.value;
    });
  });
  return byParent;
};

/**
 * Count plants flagged critical: non-compliant OR non-operational.
 *
 * Universe = every parent that appears in an operational-segment response
 * or is non-compliant (i.e. monitored plants we can evaluate). Plants with
 * no monitoring data at all are not counted.
 *
 * @param {Array<object>} params                 water-quality params
 * @param {Object.<string,object>} complianceResponsesByKey { [param.key]: response }
 * @param {Array<object>} segments               operational segments [{ key, rule }]
 * @param {Object.<string,object>} segmentResponses { [segment.key]: response }
 * @returns {number} count of critical plants
 */
export const getCriticalCount = (
  params,
  complianceResponsesByKey,
  segments,
  segmentResponses
) => {
  const nonCompliant = getNonCompliantParentIds(
    params,
    complianceResponsesByKey
  );
  const byParent = indexByParent(segments, segmentResponses);

  const universe = new Set(Object.keys(byParent));
  nonCompliant.forEach((id) => universe.add(id));

  let count = 0;
  universe.forEach((id) => {
    const vals = byParent[id] || {};
    const operational = (segments || []).every((seg) =>
      segmentPasses(seg.rule, vals[seg.key])
    );
    if (nonCompliant.has(id) || !operational) {
      count += 1;
    }
  });
  return count;
};

export default getCriticalCount;
