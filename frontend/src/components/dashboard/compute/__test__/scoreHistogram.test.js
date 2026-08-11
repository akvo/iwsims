import { computeScoreHistogram } from "../scoreHistogram";

const seg = (key, pass) => ({ key, ...(pass ? { pass_value: pass } : {}) });

/** Build a /values-shaped response: one row per parent. */
const resp = (byParent) => ({
  data: Object.entries(byParent).map(([group, value]) => ({
    group,
    label: `Plant ${group}`,
    value,
  })),
});

describe("computeScoreHistogram", () => {
  const segments = [seg("a"), seg("b"), seg("c")];

  it("returns an empty result when there are no segments", () => {
    expect(computeScoreHistogram([], {})).toEqual({
      data: [],
      scored: 0,
      excluded: 0,
    });
  });

  it("bins each parent by how many segments it passed", () => {
    const responses = {
      a: resp({ p1: ["yes"], p2: ["yes"], p3: ["no"] }),
      b: resp({ p1: ["yes"], p2: ["no"], p3: ["no"] }),
      c: resp({ p1: ["yes"], p2: ["no"], p3: ["no"] }),
    };
    const { data, scored, excluded } = computeScoreHistogram(
      segments,
      responses
    );
    expect(data).toEqual([
      { label: "0", value: 1 }, // p3
      { label: "1", value: 1 }, // p2
      { label: "2", value: 0 },
      { label: "3", value: 1 }, // p1
    ]);
    expect(scored).toBe(3);
    expect(excluded).toBe(0);
  });

  it("unwraps the single-element array /values returns for option answers", () => {
    const responses = { a: resp({ p1: ["yes"] }), b: resp({ p1: "yes" }) };
    const { data } = computeScoreHistogram([seg("a"), seg("b")], responses);
    expect(data[2]).toEqual({ label: "2", value: 1 });
  });

  it("honours a per-segment pass_value so an inverted check scores correctly", () => {
    // "urgent maintenance programs" is healthy when answered no.
    const inverted = [seg("a"), seg("urgent", "no")];
    const responses = {
      a: resp({ p1: ["yes"], p2: ["yes"] }),
      urgent: resp({ p1: ["no"], p2: ["yes"] }),
    };
    const { data } = computeScoreHistogram(inverted, responses);
    expect(data).toEqual([
      { label: "0", value: 0 },
      { label: "1", value: 1 }, // p2 passed a, failed urgent
      { label: "2", value: 1 }, // p1 passed both
    ]);
  });

  it("excludes parents that did not answer every segment", () => {
    const responses = {
      a: resp({ p1: ["yes"], p2: ["yes"] }),
      b: resp({ p1: ["yes"] }),
      c: resp({ p1: ["yes"] }),
    };
    const { data, scored, excluded } = computeScoreHistogram(
      segments,
      responses
    );
    // p2 answered 1 of 3 — dropped rather than scored 1/3.
    expect(data[3]).toEqual({ label: "3", value: 1 });
    expect(scored).toBe(1);
    expect(excluded).toBe(1);
  });

  it("scores partially answered parents when partial is set", () => {
    const responses = {
      a: resp({ p1: ["yes"], p2: ["yes"] }),
      b: resp({ p1: ["yes"] }),
      c: resp({ p1: ["yes"] }),
    };
    const { scored, excluded, data } = computeScoreHistogram(
      segments,
      responses,
      { partial: true }
    );
    expect(scored).toBe(2);
    expect(excluded).toBe(0);
    expect(data[1]).toEqual({ label: "1", value: 1 }); // p2 scored 1 of 3
  });

  it("ignores parents with no answer at all", () => {
    const { scored, excluded } = computeScoreHistogram(segments, {
      a: resp({ p1: [null] }),
    });
    expect(scored).toBe(0);
    expect(excluded).toBe(0);
  });

  it("appends label_suffix to every bar", () => {
    const responses = { a: resp({ p1: ["yes"] }) };
    const { data } = computeScoreHistogram([seg("a")], responses, {
      label_suffix: "/1",
    });
    expect(data.map((d) => d.label)).toEqual(["0/1", "1/1"]);
  });
});
