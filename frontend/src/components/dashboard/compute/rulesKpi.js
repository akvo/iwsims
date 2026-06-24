/**
 * Generic rule-matching KPI transform — counts parents (stations/plants)
 * matching an OR-of-AND rule set, evaluated against per-parent latest
 * /values responses (group_by=parent_id).
 *
 * Used for both:
 *   - a scalar count    (e.g. "Critical issues": stations meeting any rule)
 *   - a ratio           (e.g. "% Operational": matching / total stations),
 *                       when the card supplies a denominator_api
 *
 * A parent matches when ANY rule group matches. A group matches when ALL
 * of its conditions match. Each condition targets a question_name + op:
 *   - option_in         latest option array intersects `values`
 *   - option_equals     latest option array contains `value`
 *   - option_not_equals latest option array does NOT contain `value`
 *   - gt / lt / gte / lte  numeric comparison against `value`
 *   - between           numeric in [`min`, `max`]
 *
 * A missing answer never satisfies option_in / option_equals / numeric
 * conditions (empty option array / undefined value), so a group requiring
 * those fails when data is absent. option_not_equals passes on a missing
 * answer.
 *
 * Pure function — no fetching. The dashboard fans out one /values call per
 * referenced question_name and passes the responses in keyed by name.
 */

/**
 * Collect the distinct question_names referenced by a rule set.
 * @param {Array<object>} rules  [{ all_of: [{ question_name, ... }] }]
 * @returns {string[]}
 */
export const collectRuleQuestionNames = (rules) => {
  const names = new Set();
  (rules || []).forEach((group) => {
    (group.all_of || []).forEach((cond) => {
      if (cond.question_name) {
        names.add(cond.question_name);
      }
    });
  });
  return Array.from(names);
};

/**
 * Evaluate one condition against a per-parent value. `value` is an array
 * of option values (option_*) or a number (numeric ops).
 */
export const conditionMatches = (cond, value) => {
  const opts = Array.isArray(value) ? value : [];
  switch (cond.op) {
    case "option_in":
      return (cond.values || []).some((v) => opts.includes(v));
    case "option_equals":
      return opts.includes(cond.value);
    case "option_not_equals":
      return !opts.includes(cond.value);
    case "gt":
      return typeof value === "number" && value > cond.value;
    case "lt":
      return typeof value === "number" && value < cond.value;
    case "gte":
      return typeof value === "number" && value >= cond.value;
    case "lte":
      return typeof value === "number" && value <= cond.value;
    case "between":
      return (
        typeof value === "number" && value >= cond.min && value <= cond.max
      );
    default:
      return false;
  }
};

const groupMatches = (group, vals) => {
  const conds = group.all_of || [];
  return (
    conds.length > 0 &&
    conds.every((c) => conditionMatches(c, vals[c.question_name]))
  );
};

/**
 * Count parents matching the rule set.
 *
 * Universe = every parent that appears in a referenced question's response
 * (i.e. monitored parents). Parents with no monitoring data are not counted.
 *
 * @param {Array<object>} rules                 [{ all_of: [conditions] }]
 * @param {Object.<string,object>} responsesByQuestion { [question_name]: /values response }
 * @returns {number} count of matching parents
 */
export const getRulesMatchCount = (rules, responsesByQuestion) => {
  const names = collectRuleQuestionNames(rules);
  const byParent = {};
  names.forEach((qn) => {
    const rows = responsesByQuestion?.[qn]?.data || [];
    rows.forEach((row) => {
      const id = String(row.group);
      if (!byParent[id]) {
        byParent[id] = {};
      }
      byParent[id][qn] = row.value;
    });
  });

  let count = 0;
  Object.values(byParent).forEach((vals) => {
    if ((rules || []).some((group) => groupMatches(group, vals))) {
      count += 1;
    }
  });
  return count;
};

export default getRulesMatchCount;
