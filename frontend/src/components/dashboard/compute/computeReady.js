/**
 * Whether every response a derived chart needs has already arrived.
 *
 * Charts with a `compute` are not driven by a single `api` block. The page
 * fans out one request per segment (or per referenced parameter) and each
 * reports back on its own, so `computeResponses` fills in progressively.
 * Without a gate the chart renders on the first paint with nothing, and again
 * on every arrival — a 14-segment chart repaints 14 times, bars growing in one
 * at a time. That reads as a glitch rather than as loading.
 *
 * `ChartRenderer`'s existing `apiLoading` cannot cover this: it comes from the
 * single-`api` hook, which is disabled precisely when `compute` is set, so it
 * is always false here.
 *
 * Three shapes exist, and all of them are keyed the same way per compute:
 *
 *   segments      grouped_stack, score_histogram, process_counts, kpi_stack
 *                 and bucket_bar all fan out one call per `item.segments[]`
 *                 and store it under `[compute][item.id][segment.key]`.
 *                 bucket_bar reads `item.buckets`, but those only *reference*
 *                 segment keys, so the expected set is still the segments.
 *   pairs         cross_tab and accessibility_bucket fetch two responses and
 *                 report a single object only once both resolve, so the
 *                 object's existence is itself the ready signal.
 *   params        compliance stores flat under `compliance[paramId]`, shared
 *                 across charts rather than nested per item.
 *
 * A failed request still counts as arrived: the segment fetcher reports an
 * empty response rather than staying silent, exactly so a waiting widget can
 * tell "still in flight" from "never coming". Treating an error as unarrived
 * would leave a permanent skeleton.
 *
 * Deliberately NOT gated on the `include_unanswered` universe count. That
 * fetcher reports null while loading AND on failure, so waiting for it would
 * turn a failed totals request into a chart that never renders. The cost is
 * one extra repaint when the remainder bar appears, against 7 of 8 repaints
 * removed by waiting for the parameters.
 *
 * @param {object} item              dashboard config item
 * @param {object} computeResponses  the page's fetched-response tree
 * @param {object} [complianceResponses]  the param map ChartRenderer reads for
 *   compute=compliance. Passed explicitly because that branch reads its own
 *   prop rather than computeResponses.compliance; falls back to the tree so a
 *   caller with only one of the two still gets the right answer.
 * @returns {boolean} false only when a needed response is still outstanding
 */
export const isComputeReady = (item, computeResponses, complianceResponses) => {
  const compute = item?.compute;
  if (!compute) {
    return true;
  }

  if (compute === "compliance") {
    const responses = complianceResponses || computeResponses?.compliance || {};
    return (item.params_ref || []).every((id) => id in responses);
  }

  if (compute === "cross_tab" || compute === "accessibility_bucket") {
    return Boolean(computeResponses?.[compute]?.[item.id]);
  }

  if (Array.isArray(item.segments) && item.segments.length > 0) {
    const responses = computeResponses?.[compute]?.[item.id] || {};
    return item.segments.every((segment) => segment.key in responses);
  }

  // Computes that derive everything from an already-resolved `api` response
  // (date_histogram, segment-less kpi_stack) have nothing extra to wait for.
  return true;
};

export default isComputeReady;
