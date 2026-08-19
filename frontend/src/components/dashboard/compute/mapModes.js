import { STATUS_COLORS } from "../constants";
import { UNKNOWN, classifySite } from "./assetStatus";

/**
 * Modes for the national asset map — the same pins, asked a different question.
 *
 * The map already had the hard part: every family declares its own question
 * and its own passing values, because "is it working" is a different question
 * on every form. A mode is one more set of those declarations, so asking
 * about water committees instead of operational status is config, not code.
 *
 * Two questions cannot be answered from an option value and get their own
 * classifier: how recently a site was inspected (a date), and whether it meets
 * its water-quality rule (a formula the owning dashboard declares).
 *
 * Every mode ends in the same place — a bucket key per site — so the marker,
 * the legend and the popup stay one mechanism.
 */

export { UNKNOWN } from "./assetStatus";

/** Tone name → the reserved status colour. Modes name tones, never hexes. */
export const toneColor = (tone) => STATUS_COLORS[tone] || STATUS_COLORS.noData;

const DEFAULT_OPTION_BUCKETS = [
  { key: "functional", label: "Functional", tone: "good" },
  { key: "non_functional", label: "Non-functional", tone: "critical" },
  { key: UNKNOWN, label: "No status recorded", tone: "noData" },
];

/**
 * The modes a map offers.
 *
 * A config that predates modes declares `sources` at the top level and means
 * exactly one mode. Wrapping it here rather than migrating every config keeps
 * the per-asset maps working untouched.
 */
export const resolveModes = (item = {}) => {
  if (item.modes?.length) {
    return item.modes;
  }
  return [
    {
      key: "default",
      label: item.label || "Status",
      type: "option",
      sources: item.sources || [],
      buckets: DEFAULT_OPTION_BUCKETS,
    },
  ];
};

/** A mode's legend, in the order it should read: best first, unknown last. */
export const modeBuckets = (mode = {}) => {
  if (mode.type === "recency") {
    return [
      ...(mode.bands || []).map((band) => ({
        key: band.key,
        label: band.label,
        color: toneColor(band.tone),
      })),
      {
        key: UNKNOWN,
        label: mode.unknown_label || "Never inspected",
        color: toneColor("noData"),
      },
    ];
  }
  return (mode.buckets || DEFAULT_OPTION_BUCKETS).map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    color: toneColor(bucket.tone),
  }));
};

const parseDate = (value) => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Whole months between an answer and now, or null when there is no usable date.
 *
 * Counts calendar months the way the inspection histogram does, so a site the
 * histogram puts in the "7–12 months" band lands in the same band here.
 */
export const monthsSince = (value, today) => {
  const then = parseDate(value);
  const now = parseDate(today) || new Date();
  if (!then) {
    return null;
  }
  const diff =
    (now.getUTCFullYear() - then.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    then.getUTCMonth();
  return diff < 0 ? 0 : diff;
};

/**
 * Band a site by how long ago it was inspected.
 *
 * Bands are tested in order and the first whose `max_months` the site is
 * within wins; a band with no `max_months` is the catch-all. A site that was
 * never inspected is UNKNOWN, not overdue — those are the same colour of bad
 * news but not the same fact, and only one of them is about the site.
 */
export const classifyRecency = (value, bands = [], today) => {
  const months = monthsSince(value, today);
  if (months === null) {
    return UNKNOWN;
  }
  const band = bands.find(
    (b) => typeof b.max_months !== "number" || months <= b.max_months
  );
  return band ? band.key : UNKNOWN;
};

/**
 * The map bucket a formula verdict lands in.
 *
 * `_no_info` and `not_applicable` both mean the rule reached no verdict — an
 * untested site, or an EPS sample that never went to a lab. Neither is a
 * breach, so neither is coloured as one.
 */
export const classifyVerdict = (verdict) => {
  if (verdict === "compliant") {
    return "compliant";
  }
  if (verdict === "non_compliant") {
    return "non_compliant";
  }
  return UNKNOWN;
};

/**
 * Classify every site of one source, given whatever that mode fetched for it.
 *
 * @param {object} mode      the active mode
 * @param {object} source    the mode's entry for this asset family
 * @param {object} byParent  parent_id → raw answer(s) for this source
 * @param {Date}   [today]
 * @returns {(parentId: number|string) => string} bucket key for a site
 */
export const classifierFor = (mode, source, byParent = {}, today) => {
  if (mode.type === "recency") {
    return (id) => classifyRecency(byParent[id], mode.bands, today);
  }
  if (mode.type === "formula") {
    return (id) => classifyVerdict(byParent[id]);
  }
  return (id) => classifySite(byParent[id], source);
};

/**
 * The asset families a map draws, whatever mode is active.
 *
 * Declared once at the top level so a family stays on the map even in a mode
 * that has nothing to say about it. A config that predates modes lists them
 * as `sources` and means both things at once.
 */
export const resolveFamilies = (item = {}) => {
  if (item.families?.length) {
    return item.families;
  }
  return (item.sources || []).map((source) => ({
    key: source.key,
    label: source.label,
    form_id: source.form_id,
  }));
};

/** Rows of `{group, value}` → parent_id → the single latest answer. */
export const latestByParent = (rows = []) => {
  const map = {};
  rows.forEach((row) => {
    map[row.group] = Array.isArray(row.value) ? row.value[0] : row.value;
  });
  return map;
};

/** Rows of `{group, label}` from the formula endpoint → parent_id → verdict. */
export const verdictsByParent = (rows = []) => {
  const map = {};
  rows.forEach((row) => {
    map[row.group] = row.label;
  });
  return map;
};

/**
 * Merge the map's points with the active mode's verdicts.
 *
 * A family the mode says nothing about — no entry in its `sources` — is not
 * dropped from the map. Its sites stay, unclassified: leaving them out would
 * make "we do not ask this here" look like "there is nothing here".
 *
 * @param {Array<{key: string, label: string}>} families
 * @param {Object.<string, object[]>} pointsByFamily
 * @param {object} mode
 * @param {Object.<string, object>} answersByFamily  family key → parent map
 */
export const buildModePoints = (
  families = [],
  pointsByFamily = {},
  mode = {},
  answersByFamily = {},
  today = null
) =>
  (families || []).flatMap((family) => {
    const source = (mode.sources || []).find((s) => s.key === family.key);
    const classify = source
      ? classifierFor(mode, source, answersByFamily[family.key] || {}, today)
      : () => UNKNOWN;
    return (pointsByFamily[family.key] || []).map((point) => ({
      ...point,
      __sourceKey: family.key,
      __asset: family.label || family.key,
      __status: classify(point.id),
    }));
  });

export default resolveModes;
