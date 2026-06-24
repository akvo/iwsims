/**
 * Derived single-series bar transform.
 *
 * Each config `bucket` becomes one bar `{ label, value }`. A bucket's value is
 * either a direct segment count (`segment`) or the difference of two segment
 * counts (`subtract: [a, b]` → a − b, floored at 0). Subtraction lets a bucket
 * express an "only" set that the criteria grammar cannot (it has AND but no
 * NOT) — e.g. inflow-only = (parents with inflow) − (parents with inflow AND
 * outflow).
 *
 * Pure function — no fetching. The caller fans out one scalar /values call per
 * segment upstream and passes the response map in, keyed by segment.key.
 *
 * @param {Array<{label:string,segment?:string,subtract?:[string,string]}>} buckets
 * @param {Object.<string,object>} responses  { [segment.key]: /values response }
 * @returns {Array<{label:string,value:number}>}
 */
export const computeBucketBar = (buckets = [], responses = {}) => {
  const valueOf = (key) => {
    const rows = responses?.[key]?.data || [];
    return rows.length > 0 ? rows[0].value ?? 0 : 0;
  };

  return (buckets || []).map((bucket) => {
    if (Array.isArray(bucket.subtract)) {
      const [minuend, subtrahend] = bucket.subtract;
      return {
        label: bucket.label,
        value: Math.max(0, valueOf(minuend) - valueOf(subtrahend)),
      };
    }
    return { label: bucket.label, value: valueOf(bucket.segment) };
  });
};

export default computeBucketBar;
