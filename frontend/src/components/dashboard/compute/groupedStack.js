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
 * ## Derived remainder stacks
 *
 * A stack marked `derive_remainder: true` is not fetched. Its value per row
 * is `totalRegistered - (sum of that row's measured stacks)`, which turns a
 * set of bars with different denominators into bars that all sum to the
 * registered fleet.
 *
 * That matters because the questions behind these bars are conditional: a
 * plant is only asked about a chemical it actually doses. Without the
 * remainder, a short bar is ambiguous between "few plants have a problem
 * here" and "few plants use this at all" — and those carry opposite
 * operational meanings. The remainder makes the denominator visible instead
 * of leaving it to the ⓘ text.
 *
 * Two guards, both of which fall back to rendering the measured stacks only:
 *
 *   - No universe count yet. Without it there is no remainder to compute.
 *   - Not every segment has responded. Deriving mid-flight would compute
 *     `total - 0` and paint every bar entirely as the remainder, which reads
 *     as "nothing is in use anywhere" — the most alarming possible reading of
 *     a chart that is merely still loading.
 *
 * The remainder is clamped at zero. It should never go negative, but a stale
 * universe count racing a fresh segment response could get there, and a
 * negative segment renders as a bar growing in the wrong direction.
 *
 * @param {Array<{key:string,group:string,group_label?:string,stack:string}>} segments
 * @param {Array<{key:string,label:string,derive_remainder?:boolean}>} stacks
 * @param {Object.<string,object>} responses  { [segment.key]: /values response }
 * @param {object} [options]
 * @param {number} [options.totalRegistered]  Registered-fleet size used as the shared bar total.
 * @returns {Array<object>} one row per group, in first-seen group order
 */
export const computeGroupedStack = (
  segments = [],
  stacks = [],
  responses = {},
  options = {}
) => {
  const allStacks = stacks || [];
  const measuredStacks = allStacks.filter((s) => s.derive_remainder !== true);
  const derivedStacks = allStacks.filter((s) => s.derive_remainder === true);
  const derivedStackKeys = new Set(derivedStacks.map((s) => s.key));

  const { totalRegistered } = options;
  const everySegmentLoaded =
    (segments || []).length > 0 &&
    (segments || []).every((seg) => Boolean(responses?.[seg.key]));
  const canDerive =
    derivedStacks.length > 0 &&
    typeof totalRegistered === "number" &&
    Number.isFinite(totalRegistered) &&
    everySegmentLoaded;

  // Drop the derived stacks entirely when they cannot be computed, rather
  // than emitting them as zero. A zero-width series still claims a legend
  // entry and a colour, telling the reader the category was measured and
  // found empty.
  const activeStacks = canDerive ? allStacks : measuredStacks;

  const labelByStackKey = {};
  activeStacks.forEach((s) => {
    labelByStackKey[s.key] = s.label;
  });

  const order = [];
  const byGroup = {};
  (segments || []).forEach((seg) => {
    if (!byGroup[seg.group]) {
      const row = { category: seg.group_label || seg.group };
      activeStacks.forEach((s) => {
        row[s.label] = 0;
      });
      byGroup[seg.group] = row;
      order.push(seg.group);
    }
    // A segment pointing at a derived stack that could not be computed is
    // dropped; anything else keeps the original fall-back of naming the
    // series after the raw stack key.
    if (!canDerive && derivedStackKeys.has(seg.stack)) {
      return;
    }
    const label = labelByStackKey[seg.stack] || seg.stack;
    const rows = responses?.[seg.key]?.data || [];
    byGroup[seg.group][label] = rows.length > 0 ? rows[0].value ?? 0 : 0;
  });

  if (canDerive) {
    order.forEach((g) => {
      const row = byGroup[g];
      const measured = measuredStacks.reduce(
        (sum, s) => sum + (row[s.label] || 0),
        0
      );
      derivedStacks.forEach((s) => {
        row[s.label] = Math.max(0, totalRegistered - measured);
      });
    });
  }

  return order.map((g) => byGroup[g]);
};

export default computeGroupedStack;
