import { STATUS_COLORS } from "../constants";

/**
 * Functional / non-functional classification for a fleet-wide map.
 *
 * Every asset family answers "is it working" under its own question with its
 * own option set — `station_status` on pump stations (operational, blocked,
 * overflowing, not_operational), `system_status` on EPS (operational,
 * issue_with_system), `infrastructure_status` on RWS. Each source therefore
 * declares its own question and which of its values count as functional; a
 * source that declares no question has nothing to say, not "working".
 */

export const FUNCTIONAL = "functional";
export const NON_FUNCTIONAL = "non_functional";
export const UNKNOWN = "unknown";

export const STATUS_TONE = {
  [FUNCTIONAL]: STATUS_COLORS.good,
  [NON_FUNCTIONAL]: STATUS_COLORS.critical,
  [UNKNOWN]: STATUS_COLORS.noData,
};

/**
 * Classify one site from its latest answer.
 *
 * The distinction that matters is "not working" versus "we do not know". An
 * unanswered status is not evidence of a fault, and colouring it as one would
 * invent non-functional sites out of missing monitoring — so an absent answer,
 * an absent question, and an empty array all land on UNKNOWN.
 *
 * @param {string[]|string|null|undefined} values latest option values for the
 *   site. A bare value is accepted as a one-element answer — /values returns a
 *   scalar for a single-option question and an array for a multi-option one.
 * @param {{question_name?: string, functional_values?: string[]}} source
 */
export const classifySite = (values, source = {}) => {
  if (!source.question_name) {
    return UNKNOWN;
  }
  const list = Array.isArray(values) ? values : [values];
  const answered = list.filter(
    (v) => v !== null && typeof v !== "undefined" && v !== ""
  );
  if (!answered.length) {
    return UNKNOWN;
  }
  const functional = source.functional_values || [];
  // A multi-option answer counts as functional only if nothing in it is a
  // fault: one blocked pump makes the station not fully operational.
  return answered.every((v) => functional.includes(v))
    ? FUNCTIONAL
    : NON_FUNCTIONAL;
};

/**
 * Merge per-source geolocation points with their status answers.
 *
 * @param {Array<{source: object, points: object[], byParent: object}>} responses
 * @returns {object[]} points tagged with __asset, __sourceKey and __status
 */
export const buildStatusPoints = (responses = []) =>
  responses.flatMap(({ source, points, byParent }) =>
    (points || []).map((point) => ({
      ...point,
      __sourceKey: source?.key,
      __asset: source?.label || source?.key,
      __status: classifySite(byParent?.[point.id], source),
    }))
  );

/** Count sites per status bucket, for the legend. */
export const countByStatus = (points = []) =>
  points.reduce(
    (acc, point) => {
      const key = point.__status || UNKNOWN;
      acc[key] = (acc[key] || 0) + 1;
      acc.total += 1;
      return acc;
    },
    { [FUNCTIONAL]: 0, [NON_FUNCTIONAL]: 0, [UNKNOWN]: 0, total: 0 }
  );

/**
 * Normalise a /visualization/values response into parent_id → values[].
 * Mirrors useMapByParent so a marker means the same thing on both maps.
 */
export const valuesByParent = (rows = []) => {
  const map = {};
  rows.forEach((row) => {
    if (Array.isArray(row.value)) {
      map[row.group] = row.value;
    } else if (row.value !== null && typeof row.value !== "undefined") {
      map[row.group] = [row.value];
    } else {
      map[row.group] = [];
    }
  });
  return map;
};
