import { computeComplianceRate } from "../complianceRate";

const DOMAINS = [
  {
    id: "domain_drinking_water",
    families: [{ key: "wtp" }, { key: "rws" }, { key: "eps" }],
  },
  { id: "domain_effluent", families: [{ key: "wwtp" }] },
];

const counts = (pass, fail, notAssessed) => ({
  pass,
  fail,
  notAssessed,
  total: pass + fail + notAssessed,
});

const ALL = {
  domain_drinking_water: {
    wtp: counts(10, 2, 1),
    rws: counts(30, 10, 60),
    eps: counts(50, 25, 100),
  },
  domain_effluent: { wwtp: counts(20, 3, 5) },
};

describe("computeComplianceRate", () => {
  it("pools every family's verdicts into one rate", () => {
    const rate = computeComplianceRate(DOMAINS, ALL);
    expect(rate.pass).toBe(110);
    expect(rate.fail).toBe(40);
    expect(rate.assessed).toBe(150);
    expect(rate.passRate).toBe(73);
    expect(rate.settled).toBe(true);
  });

  it("rates against assessed sites, not the whole fleet", () => {
    // 166 sites were never tested. Counting them as failures would report a
    // gap in monitoring as a breach, which is the mistake the snapshot's
    // rings were built to avoid.
    const rate = computeComplianceRate(DOMAINS, ALL);
    expect(rate.notAssessed).toBe(166);
    expect(rate.passRate).not.toBe(Math.round((100 * 110) / 316));
  });

  it("narrows to one asset family", () => {
    const rate = computeComplianceRate(DOMAINS, ALL, "wwtp");
    expect(rate.assessed).toBe(23);
    expect(rate.passRate).toBe(87);
  });

  it("reports an asset no domain judges as not applicable", () => {
    // Pump stations neither supply drinking water nor treat effluent. 0%
    // compliant would invent a failure out of a question nobody asks.
    const rate = computeComplianceRate(DOMAINS, ALL, "pump");
    expect(rate.applicable).toBe(false);
    expect(rate.passRate).toBeNull();
  });

  it("holds until every family has answered", () => {
    // A pool that is still filling reads as a real rate rather than a
    // loading state, and would move once more as you watch it.
    const partial = { domain_effluent: { wwtp: counts(20, 3, 5) } };
    const rate = computeComplianceRate(DOMAINS, partial);
    expect(rate.settled).toBe(false);
  });

  it("counts a family listed in two domains once, and says so", () => {
    const overlapping = [
      DOMAINS[0],
      { id: "domain_effluent", families: [{ key: "wwtp" }, { key: "wtp" }] },
    ];
    const rate = computeComplianceRate(overlapping, {
      ...ALL,
      domain_effluent: { wwtp: counts(20, 3, 5), wtp: counts(10, 2, 1) },
    });
    expect(rate.duplicated).toEqual(["wtp"]);
    expect(rate.pass).toBe(110);
  });
});
