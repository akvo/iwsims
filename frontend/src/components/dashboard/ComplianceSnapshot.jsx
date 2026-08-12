import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card, Col, Empty, Progress, Row, Tabs, Typography } from "antd";
import { api } from "../../lib";
import {
  computeComplianceDonut,
  domainFamilies,
} from "./compute/complianceDonut";
import {
  countsFromBuckets,
  resolveFamilyFormula,
} from "./compute/complianceFormula";
import { STATUS_COLORS } from "./constants";
import FormulaInfo from "./widgets/FormulaInfo";

const { Paragraph, Text } = Typography;

const ALL = "__all__";

/**
 * National Compliance Snapshot — one ring per domain, with an asset-type
 * selector.
 *
 * Every ring is drawn from counts already fetched for the whole fleet, so the
 * selector is arithmetic over responses in hand: switching assets is instant
 * and issues no request.
 *
 * The ring shows the share of ASSESSED sites passing. Rating a domain against
 * its whole fleet would turn thin monitoring coverage into an apparent
 * compliance failure — RWS answers its status question for 4 of 112 sites,
 * which is a fact about monitoring, not about the sites. The uncounted
 * remainder is stated beneath the ring instead.
 */
/**
 * One family's compliance verdicts, from the rule its own dashboard uses.
 *
 * Renders nothing — it exists so each family gets its own hook call. The
 * endpoint returns one bucket per site, which is counted client-side; that
 * keeps the national verdict literally the same computation the per-asset
 * dashboard performs, rather than a second implementation of it.
 */
const FormulaFamily = ({ domainId, family, onCounts }) => {
  const formula = useMemo(() => resolveFamilyFormula(family), [family]);
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    if (!formula) {
      // An unresolvable reference must not be reported as a fleet of passes.
      onCounts(domainId, family.key, null);
      return () => {};
    }
    let cancelled = false;
    api
      .get("visualization/values/formula", {
        params: {
          parent_form_id: family.form_id,
          group_by: "parent_id",
          monitoring: "latest",
          formula: JSON.stringify(formula),
        },
      })
      .then((res) => {
        if (!cancelled) {
          setCounts(countsFromBuckets(res?.data?.data || []));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCounts(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [formula, family, domainId, onCounts]);

  useEffect(() => {
    onCounts(domainId, family.key, counts);
  }, [counts, domainId, family.key, onCounts]);

  return null;
};

FormulaFamily.propTypes = {
  domainId: PropTypes.string.isRequired,
  family: PropTypes.object.isRequired,
  onCounts: PropTypes.func.isRequired,
};

const ComplianceSnapshot = ({ item, computeResponses }) => {
  const [asset, setAsset] = useState(ALL);
  const [formulaCounts, setFormulaCounts] = useState({});
  const domains = useMemo(() => item.domains || [], [item.domains]);

  const onCounts = useCallback((domainId, familyKey, counts) => {
    setFormulaCounts((prev) => {
      const inner = prev[domainId] || {};
      if (inner[familyKey] === counts) {
        return prev;
      }
      return { ...prev, [domainId]: { ...inner, [familyKey]: counts } };
    });
  }, []);

  // Union of the families across domains, so the toggle offers an asset even
  // when only one domain measures it — picking it then shows the other domain
  // honestly as "not measured here" rather than hiding the option.
  const families = useMemo(() => {
    const labels = item.family_labels || {};
    const keys = [];
    domains.forEach((domain) => {
      const fromSegments = domainFamilies(domain.segments);
      const fromFormulas = (domain.families || []).map((f) => f.key);
      [...fromSegments, ...fromFormulas].forEach((family) => {
        if (family && !keys.includes(family)) {
          keys.push(family);
        }
      });
    });
    return keys.map((key) => ({ value: key, label: labels[key] || key }));
  }, [domains, item.family_labels]);

  const options = useMemo(
    () => [{ value: ALL, label: item.all_label || "All assets" }, ...families],
    [families, item.all_label]
  );

  const results = useMemo(
    () =>
      domains.map((domain) => {
        if (domain.families) {
          const scoped = domain.families.filter(
            (f) => asset === ALL || f.key === asset
          );
          const counts = scoped
            .map((f) => formulaCounts[domain.id]?.[f.key])
            .filter(Boolean);
          const pass = counts.reduce((n, c) => n + c.pass, 0);
          const fail = counts.reduce((n, c) => n + c.fail, 0);
          const notAssessed = counts.reduce((n, c) => n + c.notAssessed, 0);
          return {
            domain,
            meta: {
              pass,
              fail,
              notAssessed,
              assessed: pass + fail,
              total: pass + fail + notAssessed,
              applicable: scoped.length > 0,
              passRate:
                pass + fail > 0
                  ? Math.round((100 * pass) / (pass + fail))
                  : null,
            },
          };
        }
        return {
          domain,
          ...computeComplianceDonut(
            domain.segments,
            computeResponses?.compliance_donut?.[domain.id],
            domain.labels,
            asset === ALL ? null : asset
          ),
        };
      }),
    [domains, computeResponses, asset, formulaCounts]
  );

  const span = Math.max(6, Math.floor(24 / Math.max(1, domains.length)));

  return (
    <Card
      title={
        <>
          {item.label || "National Compliance Snapshot"}
          <FormulaInfo info={item.info} title={item.label} />
        </>
      }
      size="small"
      style={{ marginBottom: 0 }}
    >
      {domains.flatMap((domain) =>
        (domain.families || []).map((family) => (
          <FormulaFamily
            key={`${domain.id}::${family.key}`}
            domainId={domain.id}
            family={family}
            onCounts={onCounts}
          />
        ))
      )}
      {item.description && (
        <Paragraph type="secondary">{item.description}</Paragraph>
      )}
      {options.length > 1 && (
        // Rendered as Tabs rather than a Segmented control so narrowing the
        // snapshot by asset looks like every other view switch on the
        // dashboards. Nav only — the panes stay empty and the rings below
        // re-read from responses already in hand.
        <Tabs
          className="compliance-snapshot-nav"
          activeKey={asset}
          onChange={setAsset}
          items={options.map((o) => ({ key: o.value, label: o.label }))}
        />
      )}
      {results.length === 0 ? (
        <Empty description="No domains configured" />
      ) : (
        <Row gutter={[16, 16]}>
          {results.map(({ domain, meta }) => (
            <Col key={domain.id} span={span} style={{ textAlign: "center" }}>
              {meta.applicable ? (
                <>
                  <Progress
                    type="circle"
                    width={132}
                    percent={meta.passRate ?? 0}
                    strokeColor={STATUS_COLORS.good}
                    trailColor="#e6e9ed"
                    format={() =>
                      meta.passRate === null ? (
                        <Text type="secondary" style={{ fontSize: 15 }}>
                          No data
                        </Text>
                      ) : (
                        <span style={{ fontSize: 26 }}>{meta.passRate}%</span>
                      )
                    }
                  />
                  <div style={{ marginTop: 8, fontWeight: 500 }}>
                    {domain.label}
                  </div>
                  <div style={{ fontSize: 12, color: "#8c8c8c" }}>
                    {meta.pass} of {meta.assessed} assessed pass
                  </div>
                  {meta.notAssessed > 0 && (
                    <div style={{ fontSize: 12, color: STATUS_COLORS.noData }}>
                      {meta.notAssessed} not assessed
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Progress
                    type="circle"
                    width={132}
                    percent={100}
                    strokeColor="#e6e9ed"
                    trailColor="#e6e9ed"
                    format={() => (
                      <Text type="secondary" style={{ fontSize: 15 }}>
                        Not measured
                      </Text>
                    )}
                  />
                  <div style={{ marginTop: 8, fontWeight: 500 }}>
                    {domain.label}
                  </div>
                  <div style={{ fontSize: 12, color: "#8c8c8c" }}>
                    {domain.not_applicable_note ||
                      "This form asks no such question"}
                  </div>
                </>
              )}
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );
};

ComplianceSnapshot.propTypes = {
  item: PropTypes.object.isRequired,
  computeResponses: PropTypes.object,
};

export default ComplianceSnapshot;
