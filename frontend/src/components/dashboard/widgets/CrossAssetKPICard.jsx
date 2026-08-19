import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card, Skeleton, Statistic } from "antd";
import { cardFill } from "../constants";
import { resolveCrossConfigRef } from "../../../config/visualizations";
import { useDashboardEscalation } from "../../../util/hooks";
import { computeComplianceDonut } from "../compute/complianceDonut";
import { computeComplianceRate } from "../compute/complianceRate";
import {
  DENOMINATOR,
  NUMERATOR,
  formatCaption,
  hasRole,
  percentOf,
  statusColorFor,
  sumRole,
} from "../compute/crossAssetKpi";
import FormulaInfo from "./FormulaInfo";

/**
 * One referenced alert table's row count — the table's own criteria, its own
 * form, one row fetched.
 *
 * Renders nothing. It exists so each reference gets its own hook call, and so
 * the count comes from `useDashboardEscalation` rather than a second
 * assembly of the same query string: an alert total that disagrees with the
 * tab it counts would be worse than no total at all.
 */
const EscalationCounter = ({
  refKey,
  item,
  filterState,
  customFilterDefs,
  onCount,
}) => {
  const { data } = useDashboardEscalation(item, filterState, {
    page: 1,
    pageSize: 1,
    customFilterDefs,
  });
  const count = data?.count;
  useEffect(() => {
    onCount(refKey, typeof count === "number" ? count : null);
  }, [refKey, count, onCount]);
  return null;
};

EscalationCounter.propTypes = {
  refKey: PropTypes.string.isRequired,
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  customFilterDefs: PropTypes.array,
  onCount: PropTypes.func.isRequired,
};

/** The snapshot item a card borrows its domains from, if it names one. */
const resolveDomains = (item, definitionsById) => {
  const snapshot = item.snapshot_ref
    ? definitionsById?.get(item.snapshot_ref)
    : null;
  return snapshot?.domains || [];
};

/**
 * A fleet-level KPI tile for a cross-asset dashboard.
 *
 * `KPICard` answers a question about one registration family; this answers one
 * about all five, and always from numbers another widget on the page has
 * already produced. Four sources, chosen by `source`:
 *
 *  - `segments`         sum of per-family /values scalars, fanned out by the
 *                       page (roles: `numerator`, `denominator`).
 *  - `donut_domain`     one compliance-snapshot domain's pass / assessed
 *                       counts, already fetched for the ring below.
 *  - `formula_domains`  per-site verdicts pooled across snapshot domains,
 *                       each family judged by its own dashboard's rule.
 *  - `escalation`       the row counts of referenced alert tables, summed.
 *
 * None of them restates a threshold, a question name or an option set: the
 * headline moves when the dashboard that owns the rule moves.
 */
const CrossAssetKPICard = ({
  item,
  filterState,
  customFilterDefs,
  definitionsById,
  computeResponses,
}) => {
  const source = item.source || "segments";
  const [alertCounts, setAlertCounts] = useState({});

  const onCount = useCallback((refKey, count) => {
    setAlertCounts((prev) =>
      prev[refKey] === count ? prev : { ...prev, [refKey]: count }
    );
  }, []);

  const alertRefs = useMemo(
    () =>
      source === "escalation"
        ? (item.refs || [])
            .map((ref) => ({ ref, target: resolveCrossConfigRef(ref) }))
            .filter(({ target }) => target?.api?.form_id)
        : [],
    [source, item.refs]
  );

  const resolved = useMemo(() => {
    if (source === "segments") {
      const responses = computeResponses?.cross_asset_kpi?.[item.id] || {};
      const segments = item.segments || [];
      const arrived = segments.filter((seg) => responses[seg.key]).length;
      return {
        numerator: sumRole(segments, responses, NUMERATOR),
        denominator: hasRole(segments, DENOMINATOR)
          ? sumRole(segments, responses, DENOMINATOR)
          : null,
        // Every segment counts towards one total, so a card rendered before
        // they all land would show a number that keeps climbing. Hold it.
        ready: segments.length > 0 && arrived === segments.length,
        applicable: true,
      };
    }

    if (source === "donut_domain") {
      const domain = resolveDomains(item, definitionsById).find(
        (d) => d.id === item.domain_id
      );
      if (!domain) {
        return { ready: false, applicable: false };
      }
      const responses = computeResponses?.compliance_donut?.[domain.id] || {};
      const arrived = (domain.segments || []).filter(
        (seg) => responses[seg.key]
      ).length;
      const { meta } = computeComplianceDonut(
        domain.segments,
        responses,
        domain.labels,
        item.family || null
      );
      return {
        numerator: meta.pass,
        denominator: meta.assessed,
        notAssessed: meta.notAssessed,
        total: meta.total,
        ready: arrived === (domain.segments || []).length,
        applicable: meta.applicable,
      };
    }

    if (source === "formula_domains") {
      const domains = resolveDomains(item, definitionsById).filter(
        (d) => !item.domain_ids || item.domain_ids.includes(d.id)
      );
      const rate = computeComplianceRate(
        domains,
        computeResponses?.compliance_formula || {},
        item.family || null
      );
      if (rate.duplicated.length > 0) {
        // eslint-disable-next-line no-console
        console.error(
          `[${item.id}] pooled domains list ${rate.duplicated.join(
            ", "
          )} more than once; counted once, but the config is wrong`
        );
      }
      return {
        numerator: rate.pass,
        denominator: rate.assessed,
        notAssessed: rate.notAssessed,
        ready: rate.settled,
        applicable: rate.applicable,
      };
    }

    const counts = alertRefs.map(({ ref }) => alertCounts[ref]);
    return {
      numerator: counts.reduce((total, c) => total + (c || 0), 0),
      denominator: null,
      ready: counts.length > 0 && counts.every((c) => typeof c === "number"),
      applicable: counts.length > 0,
    };
  }, [source, item, definitionsById, computeResponses, alertRefs, alertCounts]);

  const percent = percentOf(resolved.numerator, resolved.denominator);
  const displayPercentage = item.display === "percentage";

  let displayValue = "—";
  if (resolved.ready && resolved.applicable) {
    if (displayPercentage) {
      displayValue = percent === null ? "—" : `${percent}%`;
    } else {
      displayValue = resolved.numerator;
    }
  }

  const caption = resolved.ready
    ? formatCaption(
        resolved.applicable ? item.caption : item.not_applicable_caption,
        {
          value: displayValue,
          numerator: resolved.numerator,
          denominator: resolved.denominator,
          notAssessed: resolved.notAssessed,
          total: resolved.total,
          percent,
        }
      )
    : null;

  const statusColor = statusColorFor(item, {
    percent,
    count: displayPercentage ? null : resolved.numerator,
  });

  return (
    <Card
      className="has-status-fill"
      style={{ "--status-fill": cardFill(resolved.ready ? statusColor : null) }}
      data-testid={`kpi-card-${item.id}`}
    >
      {alertRefs.map(({ ref, target }) => (
        <EscalationCounter
          key={ref}
          refKey={ref}
          item={target}
          filterState={filterState}
          customFilterDefs={customFilterDefs}
          onCount={onCount}
        />
      ))}
      {resolved.ready ? (
        <>
          <Statistic
            title={
              <>
                {item.label}
                <FormulaInfo info={item.info} title={item.label} />
              </>
            }
            value={displayValue}
          />
          {caption && <div className="kpi-card-caption">{caption}</div>}
        </>
      ) : (
        <Skeleton active paragraph={{ rows: 1 }} />
      )}
    </Card>
  );
};

CrossAssetKPICard.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  customFilterDefs: PropTypes.array,
  definitionsById: PropTypes.instanceOf(Map),
  computeResponses: PropTypes.object,
};

export default CrossAssetKPICard;
