/**
 * Referential comparator for ChartRenderer's React.memo.
 *
 * The page keeps its fetched responses in one `computeResponses` object
 * memoised over sixteen separate state maps, so *any* request finishing
 * anywhere on the dashboard gives that object a new identity. Without a
 * comparator every chart re-renders on every arrival — and akvo-charts calls
 * `chart.setOption` on each of its own renders regardless of whether its props
 * changed (its internal `getOptions` dependency is a fresh function each time,
 * see the note above PieWithHiddenLabels). ECharts animates on setOption, so
 * the chart visibly re-draws.
 *
 * The WTP dashboard issues about 100 requests and the national one about 50,
 * which is how many times each chart was re-drawing.
 *
 * Charts do not read that whole object though — each reads a handful of
 * slices, and the page's setters are written so a slice keeps its identity
 * when a *different* item's response lands:
 *
 *     { ...prev, [itemId]: { ...inner, [segmentKey]: data } }
 *
 * The outer object is replaced; every other item's inner object is not. So
 * comparing the slices an item actually reads is both correct and effective.
 *
 * This does not suppress a chart's own updates. React.memo only skips
 * re-renders caused by the parent; a chart's own `useDashboardValues` hook
 * still re-renders it when its data arrives.
 */

/** Props that are compared by identity. All are stable references upstream:
 * `filterState` is memoised in useDashboardFilters (its identity is already
 * documented there as load-bearing), `today` and `customFilterDefs` are
 * useMemo'd on the page, and `item`/`definitionsById` come from the config. */
const IDENTITY_PROPS = [
  "item",
  "filterState",
  "fiscalYearStartMonth",
  "customFilterDefs",
  "today",
  "definitionsById",
  "parentFormId",
];

/**
 * The response values a given item actually reads, in a stable order.
 *
 * Every `computeResponses` lookup in ChartRenderer has the shape
 * `computeResponses[compute][item.id]`, with two exceptions: the universe
 * count lives under a fixed `compliance_totals` key, and compute=compliance
 * reads its parameters from the separate `complianceResponses` prop.
 *
 * @param {object} item
 * @param {object} computeResponses
 * @param {object} complianceResponses
 * @returns {Array<*>} referenced values, positionally comparable
 */
export const referencedResponses = (
  item,
  computeResponses,
  complianceResponses
) => {
  const slices = [];
  if (item?.compute) {
    slices.push(computeResponses?.[item.compute]?.[item.id]);
  }
  slices.push(computeResponses?.compliance_totals?.[item.id]);
  (item?.params_ref || []).forEach((id) => {
    slices.push(complianceResponses?.[id]);
  });
  return slices;
};

/**
 * True when re-rendering would produce the same chart.
 *
 * Deliberately conservative: any change to a non-response prop re-renders, and
 * an item with no compute and no params_ref still compares its universe-count
 * slice, so nothing is skipped on the strength of an assumption about which
 * charts read what.
 *
 * @param {object} prev previous props
 * @param {object} next next props
 * @returns {boolean} true to skip the re-render
 */
export const chartPropsEqual = (prev, next) => {
  if (IDENTITY_PROPS.some((key) => prev[key] !== next[key])) {
    return false;
  }
  // `next.item` for both: the identity check above has already established
  // that prev.item === next.item, so which one is read cannot differ.
  const before = referencedResponses(
    next.item,
    prev.computeResponses,
    prev.complianceResponses
  );
  const after = referencedResponses(
    next.item,
    next.computeResponses,
    next.complianceResponses
  );
  return (
    before.length === after.length &&
    before.every((value, i) => value === after[i])
  );
};

export default chartPropsEqual;
