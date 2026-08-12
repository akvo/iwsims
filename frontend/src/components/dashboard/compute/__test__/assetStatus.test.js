import {
  FUNCTIONAL,
  NON_FUNCTIONAL,
  STATUS_TONE,
  UNKNOWN,
  buildStatusPoints,
  classifySite,
  countByStatus,
  valuesByParent,
} from "../assetStatus";
import { STATUS_COLORS } from "../../constants";

const PUMP = {
  key: "pump",
  label: "Pump Stations",
  question_name: "station_status",
  functional_values: ["operational"],
};
const WWTP = { key: "wwtp", label: "WWTP" };

describe("classifySite", () => {
  it("calls a site functional when every answer is a functional value", () => {
    expect(classifySite(["operational"], PUMP)).toBe(FUNCTIONAL);
  });

  it("calls any other answer non-functional", () => {
    expect(classifySite(["blocked"], PUMP)).toBe(NON_FUNCTIONAL);
    expect(classifySite(["overflowing"], PUMP)).toBe(NON_FUNCTIONAL);
    expect(classifySite(["not_operational"], PUMP)).toBe(NON_FUNCTIONAL);
  });

  it("treats a mixed multi-option answer as non-functional", () => {
    // One blocked pump means the station is not fully operational.
    expect(classifySite(["operational", "blocked"], PUMP)).toBe(NON_FUNCTIONAL);
  });

  it("does not colour a missing answer as a fault", () => {
    // The distinction that matters is "not working" vs "we do not know".
    // Colouring an unmonitored site red would invent non-functional assets.
    expect(classifySite([], PUMP)).toBe(UNKNOWN);
    expect(classifySite(null, PUMP)).toBe(UNKNOWN);
    expect(classifySite([null, ""], PUMP)).toBe(UNKNOWN);
  });

  it("returns unknown for a family with no status question", () => {
    // WWTP and WTP ask nothing plant-level; silence is not "working".
    expect(classifySite(["operational"], WWTP)).toBe(UNKNOWN);
  });

  it("treats an empty functional list as nothing being functional", () => {
    expect(
      classifySite(["operational"], { question_name: "station_status" })
    ).toBe(NON_FUNCTIONAL);
  });
});

describe("buildStatusPoints", () => {
  const responses = [
    {
      source: PUMP,
      points: [
        { id: 1, name: "PS 1" },
        { id: 2, name: "PS 2" },
        { id: 3, name: "PS 3" },
      ],
      byParent: { 1: ["operational"], 2: ["blocked"] },
    },
    {
      source: WWTP,
      points: [{ id: 9, name: "Kinoya" }],
      byParent: {},
    },
  ];

  it("tags every point with its asset and status", () => {
    const points = buildStatusPoints(responses);
    expect(points).toHaveLength(4);
    expect(points[0]).toMatchObject({
      name: "PS 1",
      __asset: "Pump Stations",
      __sourceKey: "pump",
      __status: FUNCTIONAL,
    });
    expect(points[1].__status).toBe(NON_FUNCTIONAL);
    // Monitored family, unmonitored site.
    expect(points[2].__status).toBe(UNKNOWN);
    // Family with no question at all.
    expect(points[3].__status).toBe(UNKNOWN);
  });

  it("survives an asset that returned no points", () => {
    const points = buildStatusPoints([
      { source: PUMP, points: [], byParent: {} },
      { source: WWTP, points: [{ id: 1, name: "One" }], byParent: {} },
    ]);
    expect(points).toHaveLength(1);
  });

  it("returns nothing before any asset has answered", () => {
    expect(buildStatusPoints([])).toEqual([]);
  });
});

describe("countByStatus", () => {
  it("counts each bucket and the total", () => {
    const counts = countByStatus([
      { __status: FUNCTIONAL },
      { __status: FUNCTIONAL },
      { __status: NON_FUNCTIONAL },
      { __status: UNKNOWN },
    ]);
    expect(counts[FUNCTIONAL]).toBe(2);
    expect(counts[NON_FUNCTIONAL]).toBe(1);
    expect(counts[UNKNOWN]).toBe(1);
    expect(counts.total).toBe(4);
  });

  it("reports zeroes rather than gaps for an empty map", () => {
    expect(countByStatus([])).toEqual({
      [FUNCTIONAL]: 0,
      [NON_FUNCTIONAL]: 0,
      [UNKNOWN]: 0,
      total: 0,
    });
  });
});

describe("valuesByParent", () => {
  it("keeps every option of a multi-option answer", () => {
    expect(valuesByParent([{ group: 7, value: ["a", "b"] }])).toEqual({
      7: ["a", "b"],
    });
  });

  it("wraps a single value into an array", () => {
    expect(valuesByParent([{ group: 7, value: "a" }])).toEqual({ 7: ["a"] });
  });

  it("maps an absent value to an empty array, not a null entry", () => {
    expect(valuesByParent([{ group: 7, value: null }])).toEqual({ 7: [] });
  });
});

describe("status colours", () => {
  it("draws from the reserved status palette", () => {
    // The question differs per family but the meaning does not, so the map
    // must not invent its own greens and reds.
    expect(STATUS_TONE[FUNCTIONAL]).toBe(STATUS_COLORS.good);
    expect(STATUS_TONE[NON_FUNCTIONAL]).toBe(STATUS_COLORS.critical);
    expect(STATUS_TONE[UNKNOWN]).toBe(STATUS_COLORS.noData);
  });
});
