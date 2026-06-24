const toNumber = (value) => {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const matchesBucket = (value, bucket) => {
  if (typeof bucket.value !== "undefined") {
    return value === Number(bucket.value);
  }
  const min =
    typeof bucket.min === "undefined" ? -Infinity : Number(bucket.min);
  const max = typeof bucket.max === "undefined" ? Infinity : Number(bucket.max);
  const includeMax = bucket.include_max !== false;
  const aboveMin = value >= min;
  const belowMax = includeMax ? value <= max : value < max;
  return aboveMin && belowMax;
};

export const computeValueBuckets = (rows = [], buckets = []) => {
  if (!Array.isArray(rows) || !Array.isArray(buckets) || buckets.length === 0) {
    return [];
  }

  const counts = buckets.map(() => 0);
  rows.forEach((row) => {
    const value = toNumber(row?.value);
    if (value === null) {
      return;
    }
    const idx = buckets.findIndex((bucket) => matchesBucket(value, bucket));
    if (idx !== -1) {
      counts[idx] += 1;
    }
  });

  return buckets.map((bucket, index) => ({
    label: bucket.label,
    value: counts[index],
  }));
};

export default computeValueBuckets;
