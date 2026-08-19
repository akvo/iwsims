import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { api } from "../../lib";
import {
  countsFromBuckets,
  resolveFamilyFormula,
} from "./compute/complianceFormula";

/**
 * One asset family's compliance verdicts, from the rule its own dashboard uses.
 *
 * Renders nothing — it exists so each family gets its own hook call, and so
 * the counts land in the page-level compute map rather than inside one widget.
 * Both the National Compliance Snapshot and the fleet Compliance Rate card
 * read them, and neither can drift from the other or issue the request twice.
 *
 * The endpoint returns one bucket per site, counted client-side; that keeps the
 * national verdict literally the same computation the per-asset dashboard
 * performs, rather than a second implementation of it.
 */
/**
 * What a family contributes when its rule cannot be resolved or its request
 * fails. Reported rather than left silent, so a card that waits for every
 * family settles on a number instead of a permanent skeleton — and reports
 * nothing, rather than a fleet of passes.
 */
const NO_VERDICTS = { pass: 0, fail: 0, notAssessed: 0, total: 0 };

const FormulaFamilyFetcher = ({ domainId, family, onCounts }) => {
  const [counts, setCounts] = useState(null);
  const formula = resolveFamilyFormula(family);
  // The resolved formula is a fresh object every render, so it cannot be an
  // effect dependency; its inputs — the family's refs — are what actually
  // change. Serialising them keeps the fetch keyed on the rule, not on
  // identity.
  const formulaKey = formula ? JSON.stringify(formula) : null;

  useEffect(() => {
    if (!formulaKey) {
      // An unresolvable reference must not be reported as a fleet of passes.
      setCounts(NO_VERDICTS);
      return () => {};
    }
    let cancelled = false;
    api
      .get("visualization/values/formula", {
        params: {
          parent_form_id: family.form_id,
          group_by: "parent_id",
          monitoring: "latest",
          formula: formulaKey,
        },
      })
      .then((res) => {
        if (!cancelled) {
          setCounts(countsFromBuckets(res?.data?.data || []));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCounts(NO_VERDICTS);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [formulaKey, family.form_id]);

  // Nothing is reported until the fetch settles: an absent entry is how a
  // consumer knows a family has not answered yet.
  useEffect(() => {
    if (counts) {
      onCounts(domainId, family.key, counts);
    }
  }, [counts, domainId, family.key, onCounts]);

  return null;
};

FormulaFamilyFetcher.propTypes = {
  domainId: PropTypes.string.isRequired,
  family: PropTypes.object.isRequired,
  onCounts: PropTypes.func.isRequired,
};

export default FormulaFamilyFetcher;
