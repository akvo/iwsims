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

/**
 * Tone → AntD Tag preset, for indicator pills in tables.
 *
 * Presets rather than our own hexes on purpose: AntD renders them as a tinted
 * background with dark text, which stays legible. Passing a solid status hex
 * gives white-on-fill instead, and white on `warning` (#fab219, 1.79:1 on a
 * light surface) is unreadable. The pill always shows its label, so colour is
 * never the only channel either way.
 */
export const STATUS_TAG_COLORS = {
  good: "green",
  warning: "gold",
  serious: "orange",
  critical: "red",
  neutral: "default",
};

/** Resolve a config-declared tone to its Tag preset; unknown tones stay neutral. */
export const toneTagColor = (tone) =>
  STATUS_TAG_COLORS[tone] || STATUS_TAG_COLORS.neutral;

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

/**
 * The card wash for a status accent.
 *
 * KPI cards used to state their status with a 3px top border, which made an
 * accented card three pixels taller than a plain one — so a row mixing
 * "Total WWTP" with "Operational" never quite lined up. A background tint
 * carries the same meaning and occupies no space, so every card in a row is
 * the same height by construction.
 *
 * Kept faint on purpose: the tint says "this number is a state", while the
 * figure itself stays in ink. A saturated fill would make the card compete
 * with the charts below it and put light text over mid-tone colour.
 *
 * @param {string} hex   a status colour, e.g. STATUS_COLORS.critical
 * @param {number} alpha 0–1
 * @returns {string|null} an rgba() string, or null for anything unparseable
 *                        so the caller simply renders an unaccented card
 */
export const statusTint = (hex, alpha = 0.08) => {
  if (typeof hex !== "string") {
    return null;
  }
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return null;
  }
  const int = parseInt(match[1], 16);
  /* eslint-disable no-bitwise */
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  /* eslint-enable no-bitwise */
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
