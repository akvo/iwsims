/**
 * KPI-stack transform for dashboard stack_bar widgets with
 * `compute: "kpi_stack"`. Assembles a single-column StackBar from N
 * independent KPI-style /values responses — each segment contributes
 * one field to the one-and-only row.
 *
 * Used for FR-2c "Operational Status" column where the two stacked
 * segments are INDEPENDENT measures (share no denominator) so the
 * visual total can exceed 100%.
 *
 * Pure function — no fetching. Caller fans out per-segment api calls
 * upstream and passes the response map in, keyed by segment.key.
 *
 * @param {Array<{key:string,label:string}>} segments
 * @param {Object.<string,object>} responses  { [segment.key]: /values response }
 * @param {string} [category]                 x-axis category label for the column
 * @returns {Array<object>} single-row StackBar data
 */
export const computeKpiStack = (segments, responses, category = "Total") => {
  const row = { category };
  (segments || []).forEach((seg) => {
    const rows = responses?.[seg.key]?.data || [];
    row[seg.label] = rows.length > 0 ? rows[0].value ?? 0 : 0;
  });
  return [row];
};

export default computeKpiStack;
