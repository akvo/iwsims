/**
 * Grouped stacked-bar transform.
 *
 * Each config `segment` is one (group × stack) cell, fetched independently
 * as a scalar /values response (one parent count). Segments that share a
 * `group` collapse into a single bar row; each distinct `stack` becomes a
 * stacked series keyed by that stack's label.
 *
 * Output row shape matches the StackBar dataset contract already used by
 * compute:kpi_stack — { category, [stackLabel]: value, ... } — so the
 * existing stack_bar render path needs no special-casing. Stack label keys
 * are inserted in `stacks` order so the series (and therefore the
 * config.color palette) line up deterministically.
 *
 * Pure function — no fetching. The caller fans out one /values call per
 * segment upstream and passes the response map in, keyed by segment.key.
 *
 * @param {Array<{key:string,group:string,group_label?:string,stack:string}>} segments
 * @param {Array<{key:string,label:string}>} stacks
 * @param {Object.<string,object>} responses  { [segment.key]: /values response }
 * @returns {Array<object>} one row per group, in first-seen group order
 */
export const computeGroupedStack = (
  segments = [],
  stacks = [],
  responses = {}
) => {
  const labelByStackKey = {};
  (stacks || []).forEach((s) => {
    labelByStackKey[s.key] = s.label;
  });

  const order = [];
  const byGroup = {};
  (segments || []).forEach((seg) => {
    if (!byGroup[seg.group]) {
      const row = { category: seg.group_label || seg.group };
      (stacks || []).forEach((s) => {
        row[s.label] = 0;
      });
      byGroup[seg.group] = row;
      order.push(seg.group);
    }
    const label = labelByStackKey[seg.stack] || seg.stack;
    const rows = responses?.[seg.key]?.data || [];
    byGroup[seg.group][label] = rows.length > 0 ? rows[0].value ?? 0 : 0;
  });

  return order.map((g) => byGroup[g]);
};

export default computeGroupedStack;
