/**
 * A fleet-wide compliance rate from the per-family verdicts the National
 * Compliance Snapshot already computes.
 *
 * Each family is judged against the rule its own dashboard owns — drinking
 * water for WTP, RWS and EPS; effluent for WWTP — so the headline is the same
 * arithmetic as the rings below it, only pooled.
 *
 * The two domains are disjoint by construction: no asset both supplies
 * drinking water and treats effluent, so pooling them counts every site once.
 * A config that broke that would double-count, so it is detected rather than
 * assumed — a family already counted is skipped and named in `duplicated`.
 *
 * Pure function — the caller supplies the counts.
 *
 * @param {Array<{id: string, families?: Array<{key: string}>}>} domains
 * @param {Object.<string, Object.<string, object|null>>} formulaCounts
 *        { [domainId]: { [familyKey]: {pass, fail, notAssessed, total} } }
 * @param {string|null} [family]  restrict to one asset family; null = all
 */
export const computeComplianceRate = (
  domains = [],
  formulaCounts = {},
  family = null
) => {
  const seen = new Set();
  const duplicated = [];
  let pass = 0;
  let fail = 0;
  let notAssessed = 0;
  let resolved = 0;
  let expected = 0;

  (domains || []).forEach((domain) => {
    (domain.families || [])
      .filter((f) => !family || f.key === family)
      .forEach((f) => {
        if (seen.has(f.key)) {
          duplicated.push(f.key);
          return;
        }
        seen.add(f.key);
        expected += 1;
        const counts = formulaCounts?.[domain.id]?.[f.key];
        if (!counts) {
          return;
        }
        resolved += 1;
        pass += counts.pass;
        fail += counts.fail;
        notAssessed += counts.notAssessed;
      });
  });

  const assessed = pass + fail;
  return {
    pass,
    fail,
    assessed,
    notAssessed,
    duplicated,
    // "Applicable" means the selected asset is judged by at least one of these
    // domains at all. A pump station is not — it neither supplies drinking
    // water nor is tested for effluent — and reporting that as 0% compliant
    // would invent a failure out of a question nobody asks.
    applicable: expected > 0,
    // Hold the card at "—" until every family has answered. A partial pool
    // reads as a real rate rather than a loading state, and a fleet rate that
    // moves once more as you watch it is worse than one that arrives late.
    settled: expected > 0 && resolved === expected,
    passRate: assessed > 0 ? Math.round((100 * pass) / assessed) : null,
  };
};

export default computeComplianceRate;
