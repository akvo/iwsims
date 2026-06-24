import { CONDITION_TONE_COLORS } from "../constants";

/**
 * Per-field condition transform for the Structural & Site Condition matrix.
 *
 * Each field is a single `option` question fetched as a per-option /values
 * response (`group_by: "option"`, `monitoring: "latest"`). This pure helper
 * turns one such response into the data a horizontal good/mid/bad bar plus an
 * option dot-legend needs:
 *
 *   { options: [{value,label,tone,color,count}], total, goodCount, goodPct, primaryCount }
 *
 * - `options` keep the config order (good → bad) so the stacked bar segments
 *   and the legend read left-to-right the same way.
 * - Each option's `color` is resolved from its `tone` via CONDITION_TONE_COLORS;
 *   an unknown/missing tone falls back to the neutral grey.
 * - Any option group returned by the backend but absent from `fieldOptions` is
 *   appended with the neutral tone so no answers are silently dropped.
 * - The `_no_info` group (unanswered) is excluded from both the bar and the
 *   denominator — the prototype shows answered breakdowns only.
 * - `goodPct` is the share of parents whose latest answer carries the `good`
 *   tone. `null` when there is no answered data.
 * - `primaryCount` is the first configured option's count — the numerator for
 *   the `count_of_total` readout (e.g. the "yes" count in a yes/no row).
 *
 * @param {{value:string,label:string,tone?:string}[]} fieldOptions
 * @param {object} response  /values response ({ data: [{label, group, value}] })
 * @returns {{options:Array, total:number, goodCount:number, goodPct:(number|null), primaryCount:number}}
 */
export const computeConditionField = (fieldOptions = [], response = null) => {
  const rows = response?.data || [];
  const countByGroup = {};
  rows.forEach((r) => {
    if (r.group === "_no_info") {
      return;
    }
    countByGroup[r.group] = (countByGroup[r.group] || 0) + (r.value || 0);
  });

  const known = new Set((fieldOptions || []).map((o) => o.value));
  const toColor = (tone) =>
    CONDITION_TONE_COLORS[tone] || CONDITION_TONE_COLORS.neutral;

  const options = (fieldOptions || []).map((o) => ({
    ...o,
    color: toColor(o.tone),
    count: countByGroup[o.value] || 0,
  }));
  Object.keys(countByGroup).forEach((group) => {
    if (!known.has(group)) {
      options.push({
        value: group,
        label: group,
        tone: "neutral",
        color: CONDITION_TONE_COLORS.neutral,
        count: countByGroup[group],
      });
    }
  });

  const total = options.reduce((sum, o) => sum + o.count, 0);
  const goodCount = options
    .filter((o) => o.tone === "good")
    .reduce((sum, o) => sum + o.count, 0);
  const goodPct = total > 0 ? Math.round((goodCount / total) * 100) : null;
  const primaryCount = options.length > 0 ? options[0].count : 0;

  return { options, total, goodCount, goodPct, primaryCount };
};

export default computeConditionField;
