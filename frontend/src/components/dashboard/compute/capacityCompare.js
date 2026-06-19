/**
 * Total capacity comparison transform.
 *
 * Each measure is fetched independently through /visualization/values. Most
 * configs request a scalar Total row, but summing all rows keeps the transform
 * valid when a filtered scope returns multiple grouped rows later.
 */
const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const round2 = (value) => Math.round(value * 100) / 100;

export const computeCapacityCompare = (measures, responses) =>
  (measures || []).map((measure) => {
    const rows = responses?.[measure.key]?.data || [];
    const value = rows.reduce((total, row) => total + toNumber(row.value), 0);
    return {
      label: measure.label,
      value: round2(value),
    };
  });

export default computeCapacityCompare;
