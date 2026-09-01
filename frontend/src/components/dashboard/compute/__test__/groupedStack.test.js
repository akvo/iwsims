import { computeGroupedStack } from "../groupedStack";

const STACKS = [
  { key: "functioning", label: "No risk" },
  { key: "risk", label: "Risk" },
  { key: "not_in_use", label: "Not in use", derive_remainder: true },
];

const SEGMENTS = [
  { key: "alum__ok", group: "alum", group_label: "Alum", stack: "functioning" },
  { key: "alum__risk", group: "alum", group_label: "Alum", stack: "risk" },
  {
    key: "lime__ok",
    group: "lime",
    group_label: "Lime",
    stack: "functioning",
  },
  { key: "lime__risk", group: "lime", group_label: "Lime", stack: "risk" },
];

const scalar = (value) => ({ data: [{ value }] });

const ALL_LOADED = {
  alum__ok: scalar(20),
  alum__risk: scalar(4),
  lime__ok: scalar(7),
  lime__risk: scalar(1),
};

describe("computeGroupedStack", () => {
  it("derives the remainder so every bar sums to the registered fleet", () => {
    const rows = computeGroupedStack(SEGMENTS, STACKS, ALL_LOADED, {
      totalRegistered: 50,
    });
    expect(rows).toEqual([
      { category: "Alum", "No risk": 20, Risk: 4, "Not in use": 26 },
      { category: "Lime", "No risk": 7, Risk: 1, "Not in use": 42 },
    ]);
    rows.forEach((row) => {
      expect(row["No risk"] + row.Risk + row["Not in use"]).toBe(50);
    });
  });

  it("omits the derived stack entirely when no universe count is supplied", () => {
    const rows = computeGroupedStack(SEGMENTS, STACKS, ALL_LOADED);
    expect(rows).toEqual([
      { category: "Alum", "No risk": 20, Risk: 4 },
      { category: "Lime", "No risk": 7, Risk: 1 },
    ]);
    // A zero-width series would still claim a legend entry, telling the
    // reader the category was measured and found empty.
    expect("Not in use" in rows[0]).toBe(false);
  });

  it("does not derive until every segment has responded", () => {
    // Mid-flight, `total - 0` would paint every bar entirely as the
    // remainder — "nothing is in use anywhere" — while the chart is merely
    // still loading.
    const partial = { alum__ok: scalar(20), alum__risk: scalar(4) };
    const rows = computeGroupedStack(SEGMENTS, STACKS, partial, {
      totalRegistered: 50,
    });
    expect(rows.every((row) => !("Not in use" in row))).toBe(true);
  });

  it("clamps the remainder at zero when the universe count lags behind", () => {
    const rows = computeGroupedStack(SEGMENTS, STACKS, ALL_LOADED, {
      totalRegistered: 5,
    });
    expect(rows[0]["Not in use"]).toBe(0);
  });

  it("still renders plain two-stack charts unchanged", () => {
    const plain = STACKS.slice(0, 2);
    expect(computeGroupedStack(SEGMENTS, plain, ALL_LOADED)).toEqual([
      { category: "Alum", "No risk": 20, Risk: 4 },
      { category: "Lime", "No risk": 7, Risk: 1 },
    ]);
  });

  it("treats a missing segment response as zero", () => {
    const rows = computeGroupedStack(
      SEGMENTS,
      STACKS.slice(0, 2),
      { ...ALL_LOADED, lime__risk: { data: [] } },
      {}
    );
    expect(rows[1]).toEqual({ category: "Lime", "No risk": 7, Risk: 0 });
  });
});
