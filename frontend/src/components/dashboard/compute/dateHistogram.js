import { STATUS_COLORS } from "../constants";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Fallback bands for a config that declares no `display.colors`. Drawn from
// the reserved status set rather than a private trio, so a new histogram
// cannot quietly reintroduce a second vocabulary for good/warning/critical.
const DEFAULT_COLORS = {
  recent: STATUS_COLORS.good,
  watch: STATUS_COLORS.warning,
  overdue: STATUS_COLORS.critical,
};

const parseDate = (value) => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const monthDiff = (later, earlier) =>
  (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 +
  later.getUTCMonth() -
  earlier.getUTCMonth();

const addMonths = (date, offset) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));

const monthLabel = (date) =>
  `${MONTHS_SHORT[date.getUTCMonth()]} '${String(date.getUTCFullYear()).slice(
    -2
  )}`;

const bucketColor = (monthsAgo, colors) => {
  if (monthsAgo <= 6) {
    return colors.recent;
  }
  if (monthsAgo <= 12) {
    return colors.watch;
  }
  return colors.overdue;
};

/**
 * Bucket latest inspection dates by recency.
 *
 * The visible shape is: one overdue bucket followed by one bucket for each
 * month in the recent window, oldest-to-newest. `months` is the number of
 * monthly buckets, so months=18 produces month offsets 17..0 plus overdue.
 */
export const computeDateHistogram = (rows, today, options = {}) => {
  const anchor = parseDate(today) || new Date();
  const anchorMonth = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)
  );
  const months = Math.max(1, Number(options.months) || 18);
  const colors = { ...DEFAULT_COLORS, ...(options.colors || {}) };
  const overdueLabel = options.overdue_label || `> ${months} mo`;

  const buckets = new Map();
  buckets.set("overdue", {
    label: overdueLabel,
    value: 0,
    color: colors.overdue,
  });

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = addMonths(anchorMonth, -offset);
    const key = `${date.getUTCFullYear()}-${String(
      date.getUTCMonth() + 1
    ).padStart(2, "0")}`;
    buckets.set(key, {
      label: monthLabel(date),
      value: 0,
      color: bucketColor(offset, colors),
    });
  }

  (rows || []).forEach((row) => {
    const inspectedAt = parseDate(row.value);
    if (!inspectedAt) {
      return;
    }
    const diff = monthDiff(anchorMonth, inspectedAt);
    if (diff < 0) {
      return;
    }
    if (diff >= months) {
      buckets.get("overdue").value += 1;
      return;
    }
    const bucketDate = addMonths(anchorMonth, -diff);
    const key = `${bucketDate.getUTCFullYear()}-${String(
      bucketDate.getUTCMonth() + 1
    ).padStart(2, "0")}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.value += 1;
    }
  });

  return Array.from(buckets.values());
};

export default computeDateHistogram;
