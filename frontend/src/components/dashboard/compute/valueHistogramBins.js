/**
 * Bin per-entity numeric rows into a value-axis histogram. The backend
 * returns one row per grouping key (e.g. per EPS with group_by=parent_id)
 * with a numeric measurement in `value`; this helper buckets those values
 * by `binWidth` and emits [{ label: binStartAsString, value: count }] with
 * gap-filling across [minBin, maxBin] so the x-axis is contiguous.
 *
 * Labels are strings so ECharts treats the x-axis as a category — that's
 * what lets `series.markLine[].xAxis = "6.5"` land exactly on the "6.5"
 * bin for pH-style thresholds (a numeric xAxis on a category axis is
 * interpreted as an *index* by ECharts, which is almost never what we
 * want for numeric thresholds).
 *
 * `extendTo` forces the bin range to *also* include the bins containing
 * the given values (typically threshold bounds), so markLines always
 * have a matching category even when data is sparse.
 *
 * @param {Array<{label?:string,value:number}>} rows
 * @param {number} binWidth  must be > 0
 * @param {{extendTo?: Array<number>}} [options]
 * @returns {Array<{label:string,value:number}>}
 */
export const toValueHistogramBins = (rows, binWidth, options = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  if (!binWidth || binWidth <= 0) {
    return [];
  }

  // `mult` + Math.round avoids floating-point drift when binWidth is
  // fractional (e.g. 0.1: 0.1 + 0.1 + 0.1 ≠ 0.3 in IEEE-754).
  const mult = 1 / binWidth;
  const formatBin = (n) => {
    const snapped = Math.round(n * mult) / mult;
    const s = parseFloat(snapped.toFixed(6)).toString();
    return s;
  };

  const counts = new Map();
  let minBin = Infinity;
  let maxBin = -Infinity;
  rows.forEach((r) => {
    // Skip null/undefined explicitly — Number(null) === 0 would otherwise
    // silently contribute to the "0" bin and bias the histogram.
    if (
      r === null ||
      typeof r === "undefined" ||
      r.value === null ||
      typeof r.value === "undefined"
    ) {
      return;
    }
    const n = Number(r.value);
    if (!Number.isFinite(n)) {
      return;
    }
    const bin = Math.floor(n / binWidth) * binWidth;
    const label = formatBin(bin);
    counts.set(label, (counts.get(label) || 0) + 1);
    if (bin < minBin) {
      minBin = bin;
    }
    if (bin > maxBin) {
      maxBin = bin;
    }
  });
  // Pull the range out to include any "must-show" bins (typically the
  // bins that contain threshold values — without this, a histogram with
  // a single sample at 7.0 would hide the pH 6.5/8.5 markLines because
  // ECharts can't anchor a markLine on a category that doesn't exist.
  const extendTo = Array.isArray(options.extendTo) ? options.extendTo : [];
  extendTo.forEach((raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return;
    }
    const bin = Math.floor(n / binWidth) * binWidth;
    if (bin < minBin) {
      minBin = bin;
    }
    if (bin > maxBin) {
      maxBin = bin;
    }
  });

  if (minBin === Infinity) {
    return [];
  }

  const result = [];
  // Fill every bin between min and max so the x-axis stays contiguous
  // (empty bins render as zero-height bars, preserving the histogram shape).
  for (let b = minBin; b <= maxBin + binWidth / 2; b += binWidth) {
    const label = formatBin(b);
    result.push({ label, value: counts.get(label) || 0 });
  }
  return result;
};

export default toValueHistogramBins;
