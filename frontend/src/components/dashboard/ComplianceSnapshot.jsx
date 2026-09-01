import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card, Col, Empty, Progress, Row, Tabs, Typography } from "antd";
import {
  computeComplianceDonut,
  domainFamilies,
} from "./compute/complianceDonut";
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
const ComplianceSnapshot = ({ item, computeResponses }) => {
  const [asset, setAsset] = useState(ALL);
  const domains = useMemo(() => item.domains || [], [item.domains]);
  // Formula verdicts are fetched by the page, not here, so the fleet
  // Compliance Rate card reads the same counts these rings do.
  const formulaCounts = useMemo(
    () => computeResponses?.compliance_formula || {},
    [computeResponses]
  );

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
        // A domain may declare families, segments, or both. Both is what a
        // domain looks like when its families do not all answer the same
        // way: the operational domain reads a single status question on RWS,
        // EPS and Pump Stations (segments), while WWTP and WTP have no such
        // question and are judged by a derived rule instead (families). The
        // two sets are disjoint by construction — a family belongs to one
        // mechanism or the other — so their counts simply add up.
        const scopedFamilies = (domain.families || []).filter(
          (f) => asset === ALL || f.key === asset
        );
        const familyCounts = scopedFamilies
          .map((f) => formulaCounts[domain.id]?.[f.key])
          .filter(Boolean);
        const fromFamilies = {
          pass: familyCounts.reduce((n, c) => n + c.pass, 0),
          fail: familyCounts.reduce((n, c) => n + c.fail, 0),
          notAssessed: familyCounts.reduce((n, c) => n + c.notAssessed, 0),
        };

        const segmentResult = domain.segments
          ? computeComplianceDonut(
              domain.segments,
              computeResponses?.compliance_donut?.[domain.id],
              domain.labels,
              asset === ALL ? null : asset
            )
          : null;
        const fromSegments = segmentResult?.meta || {
          pass: 0,
          fail: 0,
          notAssessed: 0,
          applicable: false,
        };

        const pass = fromFamilies.pass + (fromSegments.pass || 0);
        const fail = fromFamilies.fail + (fromSegments.fail || 0);
        const notAssessed =
          fromFamilies.notAssessed + (fromSegments.notAssessed || 0);
        // "Applicable" is about whether this domain measures the selected
        // asset at all, not about whether any data has arrived — a domain
        // that applies but has no submissions yet must read as unmeasured,
        // never as "not applicable to this asset".
        const applicable =
          scopedFamilies.length > 0 || Boolean(fromSegments.applicable);

        // computeComplianceDonut also returns `rows`, which this widget does
        // not read. Deliberately not forwarded: it describes the segment
        // families alone and would contradict the merged meta below.
        return {
          domain,
          meta: {
            pass,
            fail,
            notAssessed,
            assessed: pass + fail,
            total: pass + fail + notAssessed,
            applicable,
            passRate:
              pass + fail > 0 ? Math.round((100 * pass) / (pass + fail)) : null,
          },
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
