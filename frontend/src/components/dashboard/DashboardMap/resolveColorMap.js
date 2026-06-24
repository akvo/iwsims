import getCrossFormQuestionOptions from "./getCrossFormQuestionOptions";

// Neutral grey used when a datapoint has no answer for the active filter
// and the config does not override `_no_info`.
export const DEFAULT_NO_INFO_COLOR = "#999999";

// Fallback bucket colour when neither the option nor the config supplies
// one (e.g. options without a `color`, or formula buckets).
export const DEFAULT_BUCKET_COLOR = "#1890ff";

/**
 * Build the value→colour map for a map select filter.
 *
 * Colours default to each QuestionOption's `color` (read cross-form from
 * window.forms) and are overridden per-value by the filter's explicit
 * `color_map`, so a config only needs to list the values it wants to
 * recolour. A `_no_info` entry is always present (config value or the
 * neutral grey default). Formula filters have no options, so only the
 * config `color_map` (plus the `_no_info` default) applies.
 *
 * @param {Object|null} filter        a select filter from item.filters[]
 * @param {number|string} sourceFormId the registration (parent) form id
 * @returns {Object<string,string>}   value → hex colour
 */
const resolveColorMap = (filter, sourceFormId) => {
  if (!filter) {
    return {};
  }
  const configMap = filter.color_map || {};
  const derived = {};
  if (filter.question_name && !filter.formula) {
    getCrossFormQuestionOptions(sourceFormId, filter.question_name).forEach(
      (o) => {
        if (o.color) {
          derived[o.value] = o.color;
        }
      }
    );
  }
  const merged = { ...derived, ...configMap };
  if (!merged._no_info) {
    merged._no_info = DEFAULT_NO_INFO_COLOR;
  }
  return merged;
};

export default resolveColorMap;
