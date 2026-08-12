/**
 * Compliance-snapshot donut: how much of a domain passes, fails, or was
 * never assessed.
 *
 * A domain (OHS, Operational) spans several asset families, and each family
 * asks a different question with a different option set. Rather than
 * enumerate every failing option — which would silently miss a value added to
 * a form later — each family contributes three counts:
 *
 *   total     sites registered in that family
 *   assessed  sites whose latest monitoring answered the question at all
 *   pass      sites whose answer is one of the family's passing values
 *
 * from which `fail = assessed - pass` and `not_assessed = total - assessed`.
 * A new failing option therefore shows up as a failure automatically.
 *
 * Only families that ask the question belong in a domain at all; a family with
 * no such question is left out of the config rather than dragged in as a fleet
 * of "not assessed" sites, which would bury the domains that are measured.
 *
 * Pure function — the caller fans out one /values call per segment.
 */

/** Scalar count out of a /values response, 0 when it has not arrived. */
const scalar = (response) => {
  const rows = response?.data || [];
  return rows.length > 0 ? rows[0].value ?? 0 : 0;
};

/**
 * @param {Array<{key:string, role:"total"|"assessed"|"pass"}>} segments
 * @param {Object.<string,object>} responses  { [segment.key]: /values response }
 * @param {{pass?:string, fail?:string, notAssessed?:string}} [labels]
 * @returns {{rows: Array<{label:string,value:number}>, meta: object}}
 */
export const computeComplianceDonut = (
  segments = [],
  responses = {},
  labels = {}
) => {
  const totals = { total: 0, assessed: 0, pass: 0 };
  (segments || []).forEach((seg) => {
    if (Object.prototype.hasOwnProperty.call(totals, seg.role)) {
      totals[seg.role] += scalar(responses?.[seg.key]);
    }
  });

  // Clamp: the three counts come from independent requests, so a response
  // still in flight (or a family whose registrations and monitoring were
  // refreshed a moment apart) can briefly make a subtraction negative. A
  // negative slice would render as a gap in the ring rather than an obvious
  // error, so hold the floor at zero.
  const pass = Math.max(0, totals.pass);
  const fail = Math.max(0, totals.assessed - totals.pass);
  const notAssessed = Math.max(0, totals.total - totals.assessed);

  const rows = [
    { label: labels.pass || "Passing", value: pass },
    { label: labels.fail || "Failing", value: fail },
    { label: labels.notAssessed || "Not assessed", value: notAssessed },
  ];

  return {
    rows,
    meta: {
      pass,
      fail,
      notAssessed,
      assessed: pass + fail,
      total: totals.total,
      // Share of ASSESSED sites passing, not of all registered: a domain
      // measured on a tenth of its fleet would otherwise report a compliance
      // rate of 10% when nothing had failed. The uncounted sites are visible
      // as the "not assessed" slice instead of dragging the headline down.
      passRate:
        pass + fail > 0 ? Math.round((100 * pass) / (pass + fail)) : null,
    },
  };
};

export default computeComplianceDonut;
