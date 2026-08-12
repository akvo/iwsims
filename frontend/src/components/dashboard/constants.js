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
 * Ink for text sitting on a solid status fill.
 *
 * A status card is filled with the status colour itself — the same value the
 * charts and pills use, so the meaning cannot drift — which means the text
 * colour has to be chosen per fill rather than fixed. Measured against WCAG:
 *
 *   good     #0ca30c   white 3.35   ink 4.71  -> ink
 *   warning  #fab219   white 1.83   ink 8.60  -> ink
 *   serious  #ec835a   white 2.64   ink 5.98  -> ink
 *   critical #d03b3b   white 4.80   ink 3.29  -> white
 *   noData   #9aa0a6   white 2.64   ink 5.98  -> ink
 *
 * White reads on the red alone. Darkening the others so white would work
 * everywhere was the obvious alternative and it fails on the one that matters:
 * warning has to drop to #9c6b03 before white passes, by which point it is
 * olive and no longer reads as a warning at all.
 *
 * The 4.5 threshold is the card's small label, not its figure — the figure is
 * large enough to clear 3:1 either way, so the label is what binds.
 */
const CARD_INK = "#12212f";
const CARD_ON_DARK = "#ffffff";

const relativeLuminance = (hex) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) {
    return null;
  }
  const channels = [0, 2, 4]
    .map((i) => parseInt(match[1].slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

/** WCAG contrast ratio between two hex colours, or null if either is unusable. */
export const contrastRatio = (a, b) => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) {
    return null;
  }
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * The readable text colour for a solid status card.
 *
 * @param {string} fill a status colour
 * @returns {string|null} null when the fill is unusable, so the caller can
 *                        render an unfilled card rather than guess
 */
export const statusInk = (fill) => {
  const onDark = contrastRatio(fill, CARD_ON_DARK);
  if (onDark === null) {
    return null;
  }
  return onDark >= 4.5 ? CARD_ON_DARK : CARD_INK;
};
