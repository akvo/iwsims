import { CONDITION_TONE_COLORS } from "../constants";

/**
 * Per-process status transform for the Treatment Units Functionality bars.
 *
 * Each process is one `option`/`multiple_option` question rendered as a
 * horizontal bar — one bar per status option, tone-colored. Two responses feed
 * a process card:
 *
 *  - the per-option counts (`group_by: "option"`) → bar lengths
 *  - the per-parent rows (`group_by: "parent_id"`) → distinct plants "in use"
 *    (the footer caption numerator; a multi-select question's option counts
 *    overlap, so they cannot be summed to a plant count).
 *
 * Tone resolution: an explicit `option.tone` wins; otherwise it is derived from
 * the option value — "normal"/"normal_operation"/"operational" read as good
 * (green), "not_operational"/"non_operational" as bad (red), everything else as
 * a mid problem state (amber). Influent Pumping overrides per option (problems
 * are red, "no station" is neutral grey).
 */
const GOOD_VALUES = new Set(["normal", "normal_operation", "operational"]);
const BAD_VALUES = new Set(["not_operational", "non_operational"]);

export const processToneColor = (value = "") => {
  const v = String(value).toLowerCase();
  if (GOOD_VALUES.has(v)) {
    return CONDITION_TONE_COLORS.good;
  }
  if (BAD_VALUES.has(v)) {
    return CONDITION_TONE_COLORS.bad;
  }
  return CONDITION_TONE_COLORS.mid;
};

/**
 * @param {{value:string,label:string,tone?:string}[]} options  ordered categories
 * @param {object} response  /values group_by:option response
 * @returns {{value:string,label:string,count:number,color:string}[]}
 */
export const computeProcessBars = (options = [], response = null) => {
  const rows = response?.data || [];
  const byGroup = {};
  rows.forEach((r) => {
    if (r.group === "_no_info") {
      return;
    }
    byGroup[r.group] = (byGroup[r.group] || 0) + (r.value || 0);
  });
  return (options || []).map((o) => ({
    value: o.value,
    label: o.label,
    count: byGroup[o.value] || 0,
    color: CONDITION_TONE_COLORS[o.tone] || processToneColor(o.value),
  }));
};

/** Distinct parents with a latest answer = plants that use the process. */
export const distinctParentCount = (response = null) =>
  (response?.data || []).length;

export default computeProcessBars;
