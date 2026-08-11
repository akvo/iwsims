/**
 * Shared dashboard rendering constants.
 */

/**
 * Reserved status palette — one set for every good / warning / critical / no-data
 * signal in the product.
 *
 * Before this there were four green-red pairs meaning the same thing
 * (#64A73B/#e41a1c, #2fb36d/#d93c35, #3bb273/#e1503f, #2e7d32/#c62828) and three
 * greys for "no information". Worse, the EPS pair measured OKLab ΔE 4.2 under
 * deuteranopia — "Compliant" and "E-coli presence", the two categories that
 * matter most on that chart, were indistinguishable to roughly 8% of men.
 *
 * These steps are reserved: never reuse one as a categorical series colour, or
 * red stops meaning "bad" and starts meaning "this particular parameter". Pair
 * them with a label or icon — warning is deliberately sub-3:1 on a light
 * surface, so colour must never be the only channel.
 */
export const STATUS_COLORS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
  noData: "#9aa0a6",
};

/**
 * Semantic tone palette for the Structural & Site Condition matrix
 * (`ConditionMatrixWidget`). The monitoring form's stored per-option colors
 * are inconsistent across questions (e.g. "electrical hazard" is green in the
 * form definition), so the matrix classifies each option by a `tone` in config
 * and resolves the color here. `good` is the share counted as "% good".
 */
export const CONDITION_TONE_COLORS = {
  good: STATUS_COLORS.good,
  mid: STATUS_COLORS.warning,
  bad: STATUS_COLORS.critical,
  neutral: STATUS_COLORS.noData,
  // Light track grey for the "off" side of a warning/progress indicator
  // (e.g. a yes/no row where "no" should read as an empty track, not a
  // red failure).
  track: "#e6e9ed",
};

export const buildSiteDetailHref = (formId, dataId) => {
  if (
    !formId ||
    dataId === null ||
    typeof dataId === "undefined" ||
    dataId === ""
  ) {
    return null;
  }
  return `/control-center/data/${formId}/monitoring/${dataId}`;
};

export default CONDITION_TONE_COLORS;

export const COMPLIANCE_PARAM_COMPUTES = [
  "compliance",
  "compliance_kpi",
  // critical_kpi reuses the same water-quality param responses to decide the
  // "non-compliant" half of its critical predicate.
  "critical_kpi",
];
