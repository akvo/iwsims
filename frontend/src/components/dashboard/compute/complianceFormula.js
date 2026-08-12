import { resolveCrossConfigRef } from "../../../config/visualizations";

/**
 * Build a per-site compliance verdict for a family, reusing the rule that
 * family's own dashboard already displays.
 *
 * Two shapes exist in the configs and both are honoured rather than unified,
 * because a national figure that disagrees with the dashboard it summarises is
 * worse than one that is late:
 *
 *   formula_ref  RWS and EPS declare a `compliance_formula` on their
 *                water_quality_globals item, including the test-method rule
 *                that makes a site "not applicable". Used verbatim.
 *   params_ref   WWTP and WTP declare thresholds on `dot_strip` items and
 *                let the frontend `compliance` compute judge them. Those
 *                thresholds are synthesised into the same formula shape here.
 *
 * Either way the thresholds live in exactly one place — the owning dashboard.
 */

/** Conditions that make a value violate a `{min, max}` threshold. */
const violations = (questionName, threshold, label) => {
  const out = [];
  if (!questionName || !threshold) {
    return out;
  }
  if (threshold.max !== null && typeof threshold.max !== "undefined") {
    out.push({
      question_name: questionName,
      op: ">",
      value: Number(threshold.max),
      label,
    });
  }
  if (threshold.min !== null && typeof threshold.min !== "undefined") {
    out.push({
      question_name: questionName,
      op: "<",
      value: Number(threshold.min),
      label,
    });
  }
  return out;
};

/**
 * Synthesise the buckets a family's threshold parameters imply.
 *
 * Mirrors the hand-written formulas: a site is non-compliant if ANY parameter
 * is out of range, and "no information" only when EVERY parameter is empty.
 * Ordering matters — the backend takes the first matching bucket, so an
 * all-empty site must not fall through to a compliant verdict.
 */
export const formulaFromParams = (refs = []) => {
  const params = refs
    .map((ref) => ({ ref, item: resolveCrossConfigRef(ref) }))
    .filter(({ item }) => item?.api?.question_name && item?.threshold);
  if (!params.length) {
    return null;
  }

  const anyOf = params.flatMap(({ item }) =>
    violations(
      item.api.question_name,
      item.threshold,
      item.config?.title || item.label || item.api.question_name
    )
  );
  const allEmpty = params.map(({ item }) => ({
    question_name: item.api.question_name,
    op: "is_empty",
  }));

  // Same shape the hand-written formulas use: buckets are the exceptions,
  // tested in order, and `default` catches everything else. "No information"
  // has to be tested before the violations — a site with nothing recorded
  // violates no threshold and would otherwise be reported as compliant.
  return {
    buckets: [
      {
        value: "_no_info",
        label: "No information available",
        all_of: allEmpty,
      },
      { value: "non_compliant", label: "No", any_of: anyOf },
    ],
    default: { value: "compliant", label: "Yes" },
  };
};

/** The formula a family contributes, from whichever shape it declares. */
export const resolveFamilyFormula = (family = {}) => {
  if (family.formula_ref) {
    const source = resolveCrossConfigRef(family.formula_ref);
    return source?.compliance_formula || null;
  }
  if (family.params_ref?.length) {
    return formulaFromParams(family.params_ref);
  }
  return null;
};

/**
 * Bucket counts → the three numbers a compliance ring needs.
 *
 * "Not assessed" folds together the site that was never tested (`_no_info`)
 * and the one the rule does not apply to (`not_applicable`, e.g. an EPS site
 * whose sample never went to a lab). Neither passed nor failed anything, and
 * counting either as a failure would invent non-compliance out of a gap in
 * testing.
 */
export const countsFromBuckets = (rows = []) => {
  let pass = 0;
  let fail = 0;
  let notAssessed = 0;
  rows.forEach((row) => {
    // The endpoint returns {group: parent_id, label: bucket_value} — `label`
    // carries the verdict, `group` identifies the site.
    const bucket = row?.label;
    if (bucket === "compliant") {
      pass += 1;
    } else if (bucket === "non_compliant") {
      fail += 1;
    } else {
      notAssessed += 1;
    }
  });
  return { pass, fail, notAssessed, total: rows.length };
};

export default resolveFamilyFormula;
