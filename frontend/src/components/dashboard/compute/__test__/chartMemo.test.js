import { chartPropsEqual, referencedResponses } from "../chartMemo";

const item = { id: "chart", compute: "grouped_stack" };
const base = {
  item,
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  today: new Date("2026-01-01"),
  definitionsById: new Map(),
  parentFormId: 1,
  computeResponses: {},
  complianceResponses: {},
};

describe("referencedResponses", () => {
  it("reads the item's own compute slice and the universe count", () => {
    const slice = { a: 1 };
    const total = 57;
    expect(
      referencedResponses(
        item,
        {
          grouped_stack: { chart: slice },
          compliance_totals: { chart: total },
        },
        {}
      )
    ).toEqual([slice, total]);
  });

  it("reads each referenced param for compute=compliance", () => {
    const bod = { data: [] };
    const slices = referencedResponses(
      { id: "c", compute: "compliance", params_ref: ["param_bod"] },
      {},
      { param_bod: bod }
    );
    // compute slice, universe count, then one entry per referenced param —
    // the first two are absent here but still occupy their positions, which
    // is what keeps the comparison positional.
    expect(slices).toHaveLength(3);
    expect(slices[2]).toBe(bod);
  });
});

describe("chartPropsEqual", () => {
  it("skips the re-render when an unrelated chart's response lands", () => {
    // The page rebuilds computeResponses on every arrival, but the setters
    // preserve each item's inner object, so this chart's slice is untouched.
    const mine = { a: 1 };
    const prev = {
      ...base,
      computeResponses: { grouped_stack: { chart: mine, other: { x: 1 } } },
    };
    const next = {
      ...base,
      computeResponses: { grouped_stack: { chart: mine, other: { x: 2 } } },
    };
    expect(prev.computeResponses).not.toBe(next.computeResponses);
    expect(chartPropsEqual(prev, next)).toBe(true);
  });

  it("re-renders when this chart's own slice changes", () => {
    const prev = {
      ...base,
      computeResponses: { grouped_stack: { chart: { a: 1 } } },
    };
    const next = {
      ...base,
      computeResponses: { grouped_stack: { chart: { a: 1, b: 2 } } },
    };
    expect(chartPropsEqual(prev, next)).toBe(false);
  });

  it("re-renders when the universe count arrives", () => {
    const prev = { ...base, computeResponses: { compliance_totals: {} } };
    const next = {
      ...base,
      computeResponses: { compliance_totals: { chart: 57 } },
    };
    expect(chartPropsEqual(prev, next)).toBe(false);
  });

  it("re-renders when a compliance parameter arrives", () => {
    const complianceItem = {
      id: "c",
      compute: "compliance",
      params_ref: ["param_bod", "param_cod"],
    };
    const prev = {
      ...base,
      item: complianceItem,
      complianceResponses: { param_bod: {} },
    };
    const next = {
      ...base,
      item: complianceItem,
      complianceResponses: { param_bod: {}, param_cod: {} },
    };
    expect(chartPropsEqual(prev, next)).toBe(false);
  });

  it.each([
    ["filterState", {}],
    ["today", new Date("2026-02-02")],
    ["customFilterDefs", []],
    ["definitionsById", new Map()],
    ["fiscalYearStartMonth", 4],
    ["parentFormId", 2],
    ["item", { id: "chart", compute: "grouped_stack" }],
  ])("re-renders when %s changes identity", (key, value) => {
    expect(chartPropsEqual(base, { ...base, [key]: value })).toBe(false);
  });

  it("skips when nothing at all changed", () => {
    expect(chartPropsEqual(base, { ...base })).toBe(true);
  });
});
