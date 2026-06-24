/**
 * Build an equal-segment `conic-gradient(...)` CSS value for a
 * multi-value map marker — one slice per selected option. Shared by the
 * manage-data MapView and the dashboard map so a datapoint that selected
 * several options (e.g. multiple disinfection techniques) renders the
 * same segmented marker in both places.
 *
 * @param {Array<string>} colors  one colour per selected option
 * @returns {string} a `conic-gradient(...)` value, or "" when empty
 */
export const conicGradient = (colors) => {
  const list = (colors || []).filter(Boolean);
  const n = list.length;
  if (n === 0) {
    return "";
  }
  const stops = list
    .map((c, i) => `${c} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`)
    .join(", ");
  return `conic-gradient(${stops})`;
};

export default conicGradient;
