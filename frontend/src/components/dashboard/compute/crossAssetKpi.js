import { STATUS_COLORS } from "../constants";

/**
 * Arithmetic for the National Overview's fleet KPI row.
 *
 * Every card there answers a question about the whole fleet — how many assets,
 * how many inspected, what share operational — from numbers other widgets on
 * the page have already fetched. Nothing here fetches or derives a rule; it
 * sums, divides and formats, so a card can never disagree with the ring, bar
 * or map it summarises.
 */

export const NUMERATOR = "numerator";
export const DENOMINATOR = "denominator";

/** Scalar count out of a /values response, 0 when it has not arrived. */
export const scalar = (response) => {
  const rows = response?.data || [];
  return rows.length > 0 ? rows[0].value ?? 0 : 0;
};

/**
 * Sum every segment playing one role.
 *
 * A segment with no `role` is a numerator: the commonest card (Total Assets)
 * is a plain sum with no denominator at all, and making it say so five times
 * would be noise.
 */
export const sumRole = (segments = [], responses = {}, role = NUMERATOR) =>
  (segments || [])
    .filter((seg) => (seg.role || NUMERATOR) === role)
    .reduce((total, seg) => total + scalar(responses?.[seg.key]), 0);

/** Whether any segment plays a role — i.e. whether the card is a ratio. */
export const hasRole = (segments = [], role) =>
  (segments || []).some((seg) => (seg.role || NUMERATOR) === role);

/**
 * Whole-percent share, or null when there is nothing to divide by.
 *
 * Null rather than 0: a card with no denominator yet has not measured 0%, and
 * rendering it as such would report an empty fleet as a total failure.
 */
export const percentOf = (numerator, denominator) => {
  if (!denominator || denominator <= 0) {
    return null;
  }
  return Math.round((100 * numerator) / denominator);
};

/**
 * Fill a caption template from the card's own numbers.
 *
 * Templates keep the wording in config next to the rule it describes — the
 * difference between "of assets" and "of assessed sites" is the difference
 * between an honest denominator and a misleading one, and that belongs where
 * the denominator is declared, not in a component.
 *
 * An unknown placeholder is left standing rather than blanked, so a typo in a
 * config reads as a typo instead of a silently missing number.
 */
export const formatCaption = (template, values = {}) => {
  if (!template) {
    return null;
  }
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => {
    const value = values[key];
    if (value === null || typeof value === "undefined") {
      return whole;
    }
    return String(value);
  });
};

/**
 * The status a card's own value earns.
 *
 * The design hard-codes a green tile for "% Operational" and an amber one for
 * "Compliance Rate". Hard-coding either is a claim the number cannot back: the
 * same green card would still be green at 20% operational. So the thresholds
 * are declared in config and the fill follows the value.
 *
 * `status_thresholds` reads as "good at or above X, warning at or above Y,
 * critical below that". `status_when_positive` covers the cards where a count
 * above zero is itself the bad news.
 *
 * Returns null for a card that has no state to show — which `cardFill` renders
 * as the plain navy, so an unmeasurable card looks deliberate rather than
 * green by default.
 */
export const statusColorFor = (item = {}, { percent, count } = {}) => {
  if (item.status_when_positive) {
    if (count === null || typeof count === "undefined") {
      return null;
    }
    return count > 0
      ? STATUS_COLORS[item.status_when_positive] || null
      : STATUS_COLORS.good;
  }
  const thresholds = item.status_thresholds;
  if (!thresholds || percent === null || typeof percent === "undefined") {
    return null;
  }
  if (typeof thresholds.good === "number" && percent >= thresholds.good) {
    return STATUS_COLORS.good;
  }
  if (typeof thresholds.warning === "number" && percent >= thresholds.warning) {
    return STATUS_COLORS.warning;
  }
  return STATUS_COLORS.critical;
};

export default sumRole;
