/**
 * Shape a `/progress/{formId}` response into the { label, value }[] rows
 * expected by <Bar> for the "Percentage of projects completed" chart.
 *
 * @param {{histogram: Array<{progress: string, count: number}>}|null} response
 * @returns {Array<{label: string, value: number, group: string}>}
 */
export const toHistogramBarData = (response) => {
  const histogram = response?.histogram || [];
  return histogram.map((bucket) => ({
    label: bucket.progress,
    value: bucket.count,
  }));
};

export default toHistogramBarData;
