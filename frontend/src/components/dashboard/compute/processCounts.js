/**
 * Multi-question process-count transform for horizontal bar charts.
 *
 * Each segment is fetched independently as a scalar /values response, then
 * rendered as one bar row: {label, value}.
 */
export const computeProcessCounts = (segments, responses, options = {}) => {
  const rows = (segments || []).map((seg) => {
    const data = responses?.[seg.key]?.data || [];
    return {
      label: seg.label,
      value: data.length > 0 ? data[0].value ?? 0 : 0,
    };
  });

  if (options.sort === "desc") {
    return [...rows].sort((a, b) => b.value - a.value);
  }
  if (options.sort === "asc") {
    return [...rows].sort((a, b) => a.value - b.value);
  }
  return rows;
};

export default computeProcessCounts;
