import {
  getNonCompliantParentIds,
  segmentPasses,
  getCriticalCount,
} from "../critical";

// Water-quality params (same shape the dashboard derives from params_ref).
const PARAMS = [
  { key: "ph", threshold: { min: 6.5, max: 8.5 } },
  { key: "turbidity", threshold: { max: 5 } },
];

// Operational segments mirroring the WTP config.
const SEGMENTS = [
  { key: "no_constraints", rule: { op: "option_equals", value: "no" } },
  { key: "production", rule: { op: "number_gt", value: 0 } },
  { key: "pump_ok", rule: { op: "option_not_equals", value: "yes" } },
];

const valuesResp = (rows) => ({ data: rows });

describe("critical compute — segmentPasses", () => {
  it("option_equals fails on a missing answer", () => {
    expect(segmentPasses({ op: "option_equals", value: "no" }, ["no"])).toBe(
      true
    );
    expect(segmentPasses({ op: "option_equals", value: "no" }, ["yes"])).toBe(
      false
    );
    // Missing answer (no second arg) → option_equals fails.
    expect(segmentPasses({ op: "option_equals", value: "no" })).toBe(false);
  });

  it("option_not_equals passes on a missing answer (N/A pump)", () => {
    // Missing answer (no second arg) → option_not_equals passes.
    expect(segmentPasses({ op: "option_not_equals", value: "yes" })).toBe(true);
    expect(
      segmentPasses({ op: "option_not_equals", value: "yes" }, ["no"])
    ).toBe(true);
    expect(
      segmentPasses({ op: "option_not_equals", value: "yes" }, ["yes"])
    ).toBe(false);
  });

  it("number_gt fails on a missing or non-positive value", () => {
    expect(segmentPasses({ op: "number_gt", value: 0 }, 5)).toBe(true);
    expect(segmentPasses({ op: "number_gt", value: 0 }, 0)).toBe(false);
    // Missing value (no second arg) → number_gt fails.
    expect(segmentPasses({ op: "number_gt", value: 0 })).toBe(false);
  });
});

describe("critical compute — getNonCompliantParentIds", () => {
  it("flags parents whose latest value is outside any threshold band", () => {
    const responsesByKey = {
      ph: valuesResp([
        { group: "1", value: 7.0 }, // ok
        { group: "2", value: 9.0 }, // out of range
      ]),
      turbidity: valuesResp([
        { group: "1", value: 9 }, // out of range
        { group: "2", value: 1 }, // ok
      ]),
    };
    const set = getNonCompliantParentIds(PARAMS, responsesByKey);
    expect(set.has("1")).toBe(true); // turbidity fails
    expect(set.has("2")).toBe(true); // ph fails
  });

  it("treats a missing param value as no-data, not a violation", () => {
    const set = getNonCompliantParentIds(PARAMS, {
      ph: valuesResp([{ group: "1", value: 7.0 }]),
      // turbidity absent
    });
    expect(set.size).toBe(0);
  });
});

describe("critical compute — getCriticalCount", () => {
  it("counts non-compliant OR non-operational plants", () => {
    // Parent 1: compliant + operational            → not critical
    // Parent 2: compliant but has constraints       → critical (non-operational)
    // Parent 3: non-compliant but operational       → critical (non-compliant)
    // Parent 4: compliant, pump risk = yes          → critical (non-operational)
    const compliance = {
      ph: valuesResp([
        { group: "1", value: 7 },
        { group: "2", value: 7 },
        { group: "3", value: 9 }, // out of range → non-compliant
        { group: "4", value: 7 },
      ]),
      turbidity: valuesResp([
        { group: "1", value: 1 },
        { group: "2", value: 1 },
        { group: "3", value: 1 },
        { group: "4", value: 1 },
      ]),
    };
    const segmentResponses = {
      no_constraints: valuesResp([
        { group: "1", value: ["no"] },
        { group: "2", value: ["yes"] }, // has constraints
        { group: "3", value: ["no"] },
        { group: "4", value: ["no"] },
      ]),
      production: valuesResp([
        { group: "1", value: 10 },
        { group: "2", value: 10 },
        { group: "3", value: 10 },
        { group: "4", value: 10 },
      ]),
      pump_ok: valuesResp([
        { group: "1", value: ["no"] },
        // parent 2 + 3 have no pump answer → N/A passes
        { group: "4", value: ["yes"] }, // pump risk → non-operational
      ]),
    };
    const count = getCriticalCount(
      PARAMS,
      compliance,
      SEGMENTS,
      segmentResponses
    );
    expect(count).toBe(3); // parents 2, 3, 4
  });

  it("does not count plants with no monitoring data at all", () => {
    const count = getCriticalCount(PARAMS, {}, SEGMENTS, {});
    expect(count).toBe(0);
  });

  it("a missing production answer makes a plant non-operational", () => {
    const segmentResponses = {
      no_constraints: valuesResp([{ group: "5", value: ["no"] }]),
      // production missing for parent 5 → number_gt fails → non-operational
    };
    const count = getCriticalCount(PARAMS, {}, SEGMENTS, segmentResponses);
    expect(count).toBe(1);
  });
});
