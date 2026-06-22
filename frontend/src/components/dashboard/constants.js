/**
 * Shared dashboard rendering constants.
 */

/**
 * Semantic tone palette for the Structural & Site Condition matrix
 * (`ConditionMatrixWidget`). The monitoring form's stored per-option colors
 * are inconsistent across questions (e.g. "electrical hazard" is green in the
 * form definition), so the matrix classifies each option by a `tone` in config
 * and resolves the color here. `good` is the share counted as "% good".
 */
export const CONDITION_TONE_COLORS = {
  good: "#3bb273",
  mid: "#f0ad4e",
  bad: "#e1503f",
  neutral: "#9aa0a6",
  // Light track grey for the "off" side of a warning/progress indicator
  // (e.g. a yes/no row where "no" should read as an empty track, not a
  // red failure).
  track: "#e6e9ed",
};

/**
 * Control-center datapoint detail URL, used by widgets that deep-link a row to
 * its monitoring record (map, ranking). Placeholders {parent_form_id} and
 * {data_id} are filled per row; configs may override via `click_url_template`.
 */
export const DETAIL_URL_TEMPLATE =
  "/control-center/data/{parent_form_id}/monitoring/{data_id}";

export default CONDITION_TONE_COLORS;
