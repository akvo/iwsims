import { isComputeReady } from "../computeReady";

const SEGMENTS = [{ key: "a" }, { key: "b" }, { key: "c" }];

describe("isComputeReady", () => {
  it("passes through charts with no compute", () => {
    expect(isComputeReady({ id: "x", api: {} }, {})).toBe(true);
    expect(isComputeReady({})).toBe(true);
  });

  describe("segment-keyed computes", () => {
    const item = { id: "chart", compute: "grouped_stack", segments: SEGMENTS };

    it("is not ready while any segment is outstanding", () => {
      expect(isComputeReady(item, {})).toBe(false);
      expect(
        isComputeReady(item, { grouped_stack: { chart: { a: {}, b: {} } } })
      ).toBe(false);
    });

    it("is ready once every segment has reported", () => {
      expect(
        isComputeReady(item, {
          grouped_stack: { chart: { a: {}, b: {}, c: {} } },
        })
      ).toBe(true);
    });

    it("counts a failed segment as arrived", () => {
      // The segment fetcher reports an empty response on error rather than
      // staying silent. Treating that as outstanding would leave the chart
      // showing a skeleton forever.
      expect(
        isComputeReady(item, {
          grouped_stack: {
            chart: { a: {}, b: {}, c: { data: [], error: new Error("500") } },
          },
        })
      ).toBe(true);
    });

    it("reads another chart's responses as its own", () => {
      expect(
        isComputeReady(item, {
          grouped_stack: { other: { a: {}, b: {}, c: {} } },
        })
      ).toBe(false);
    });

    it.each(["score_histogram", "process_counts", "bucket_bar", "kpi_stack"])(
      "applies the same rule to %s",
      (compute) => {
        const other = { id: "chart", compute, segments: SEGMENTS };
        expect(isComputeReady(other, { [compute]: { chart: { a: {} } } })).toBe(
          false
        );
        expect(
          isComputeReady(other, {
            [compute]: { chart: { a: {}, b: {}, c: {} } },
          })
        ).toBe(true);
      }
    );
  });

  describe("param-keyed compliance", () => {
    const item = {
      id: "chart",
      compute: "compliance",
      params_ref: ["param_bod", "param_cod"],
    };

    it("waits for every referenced parameter", () => {
      expect(isComputeReady(item, { compliance: { param_bod: {} } })).toBe(
        false
      );
      expect(
        isComputeReady(item, { compliance: { param_bod: {}, param_cod: {} } })
      ).toBe(true);
    });

    it("accepts the responses ChartRenderer passes as its own prop", () => {
      // The compliance branch reads a dedicated prop rather than
      // computeResponses.compliance, so the gate has to consult the same
      // source or it would hold a skeleton over data the chart already has.
      expect(isComputeReady(item, {}, { param_bod: {}, param_cod: {} })).toBe(
        true
      );
      expect(isComputeReady(item, {}, { param_bod: {} })).toBe(false);
    });

    it("does not wait on the include_unanswered universe count", () => {
      // That fetcher reports null both while loading and on failure, so
      // gating on it would turn a failed request into a permanent skeleton.
      expect(
        isComputeReady(
          { ...item, include_unanswered: true },
          { compliance: { param_bod: {}, param_cod: {} } }
        )
      ).toBe(true);
    });
  });

  describe("pair-keyed computes", () => {
    it.each(["cross_tab", "accessibility_bucket"])(
      "%s is ready only once its combined object exists",
      (compute) => {
        const item = { id: "chart", compute };
        expect(isComputeReady(item, {})).toBe(false);
        expect(isComputeReady(item, { [compute]: {} })).toBe(false);
        expect(
          isComputeReady(item, { [compute]: { chart: { sample: {} } } })
        ).toBe(true);
      }
    );
  });

  it("does not block a segment-less compute that reads its own api", () => {
    expect(isComputeReady({ id: "k", compute: "kpi_stack" }, {})).toBe(true);
    expect(isComputeReady({ id: "d", compute: "date_histogram" }, {})).toBe(
      true
    );
  });
});
