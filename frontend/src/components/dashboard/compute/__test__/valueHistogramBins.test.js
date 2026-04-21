import { toValueHistogramBins } from "../valueHistogramBins";

describe("toValueHistogramBins", () => {
  test("returns [] for empty or invalid input", () => {
    expect(toValueHistogramBins([], 1)).toEqual([]);
    expect(toValueHistogramBins(null, 1)).toEqual([]);
    expect(toValueHistogramBins([{ value: 1 }], 0)).toEqual([]);
    expect(toValueHistogramBins([{ value: 1 }], -1)).toEqual([]);
  });

  test("buckets integer values with bin_width=1", () => {
    const rows = [
      { label: "A", value: 5 },
      { label: "B", value: 6 },
      { label: "C", value: 6.2 },
      { label: "D", value: 8 },
    ];
    expect(toValueHistogramBins(rows, 1)).toEqual([
      { label: "5", value: 1 },
      { label: "6", value: 2 },
      { label: "7", value: 0 },
      { label: "8", value: 1 },
    ]);
  });

  test("buckets fractional values with bin_width=0.5 (pH case)", () => {
    const rows = [
      { value: 6.2 },
      { value: 6.7 },
      { value: 7.1 },
      { value: 8.4 },
    ];
    expect(toValueHistogramBins(rows, 0.5)).toEqual([
      { label: "6", value: 1 },
      { label: "6.5", value: 1 },
      { label: "7", value: 1 },
      { label: "7.5", value: 0 },
      { label: "8", value: 1 },
    ]);
  });

  test("handles bin_width=0.1 without floating-point drift", () => {
    const rows = [
      { value: 0.1 },
      { value: 0.2 },
      { value: 0.3 },
      { value: 0.5 },
    ];
    const bins = toValueHistogramBins(rows, 0.1);
    expect(bins.map((b) => b.label)).toEqual([
      "0.1",
      "0.2",
      "0.3",
      "0.4",
      "0.5",
    ]);
  });

  test("extendTo widens bin range to include threshold bins (sparse data)", () => {
    // Sparse pH: single reading at 7.0. Without extendTo we'd get just
    // ["7"] and the 6.5/8.5 markLines would find no category.
    const rows = [{ value: 7 }];
    expect(toValueHistogramBins(rows, 0.5, { extendTo: [6.5, 8.5] })).toEqual([
      { label: "6.5", value: 0 },
      { label: "7", value: 1 },
      { label: "7.5", value: 0 },
      { label: "8", value: 0 },
      { label: "8.5", value: 0 },
    ]);
  });

  test("extendTo with no data at all still emits the threshold bins", () => {
    expect(toValueHistogramBins([], 0.5, { extendTo: [6.5, 8.5] })).toEqual([]);
    // At least one data row is required; extendTo only widens an existing range.
    expect(
      toValueHistogramBins([{ value: 7 }], 0.5, { extendTo: [6.5] })
    ).toEqual([
      { label: "6.5", value: 0 },
      { label: "7", value: 1 },
    ]);
  });

  test("skips rows with non-finite values", () => {
    const rows = [
      { value: null },
      {},
      { value: NaN },
      { value: "not a number" },
      { value: 3 },
    ];
    expect(toValueHistogramBins(rows, 1)).toEqual([{ label: "3", value: 1 }]);
  });
});
