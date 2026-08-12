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
 * Solid fills for KPI cards, and the one ink that sits on all of them.
 *
 * Every KPI card is filled and every one carries white text, so a row reads as
 * one object rather than a mix of white tiles and coloured ones. That costs a
 * separate fill scale: the status colours are tuned to be marks on a light
 * surface, and white does not carry on all of them — #0ca30c reaches only
 * 3.35 against white, below the 4.5 a small label needs.
 *
 * So a card fill is the status hue stepped down until white clears AA. The
 * marks themselves are untouched: charts, pills and map pins keep STATUS_COLORS,
 * and only filled surfaces use these. Measured, white on each:
 *
 *   good      #0a890a   4.57      (from #0ca30c, 3.35)
 *   warning   #9c6b03   4.65      (from #fab219, 1.83)
 *   serious   #cd4a18   4.58      (from #ec835a, 2.64)
 *   critical  #d03b3b   4.80      unchanged — it already carried white
 *   noData    #6f767e   4.60      (from #9aa0a6, 2.64)
 *   plain     #081c40  16.79      the app's navy, for a card with no state
 *
 * One caveat worth knowing before a warning card is ever configured: amber
 * has to go so dark to hold white that #9c6b03 reads olive rather than
 * cautionary. No card uses it today. If one does, it is worth reopening
 * whether that card should carry dark ink instead, as the design does for its
 * amber tile.
 */
export const CARD_ON_DARK = "#ffffff";
export const CARD_PLAIN_FILL = "#081c40";

const STATUS_CARD_FILLS = {
  "#0ca30c": "#0a890a",
  "#fab219": "#9c6b03",
  "#ec835a": "#cd4a18",
  "#d03b3b": "#d03b3b",
  "#9aa0a6": "#6f767e",
};

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
 * The fill for a KPI card. A card with no status takes the navy, so the row
 * is uniform; a status card takes its hue stepped down to hold white text.
 *
 * An unrecognised colour falls back to the navy rather than being used raw —
 * a fill that cannot hold white would render an unreadable card, and losing
 * the accent is the safer failure.
 */
export const cardFill = (statusColor) => {
  if (!statusColor) {
    return CARD_PLAIN_FILL;
  }
  return (
    STATUS_CARD_FILLS[String(statusColor).toLowerCase()] || CARD_PLAIN_FILL
  );
};
