import { isSingleSeriesShape } from "../ChartRenderer";
import { STATUS_COLORS } from "../constants";
import { computeDateHistogram } from "../compute/dateHistogram";

describe("isSingleSeriesShape", () => {
  it("recognises the simple bar shape", () => {
    expect(isSingleSeriesShape([{ label: "Jan", value: 3 }])).toBe(true);
  });

  it("recognises it even when rows carry a per-bar colour", () => {
    // The inspection-date histogram colours each bar by recency band. Those
    // extra keys are style, not series — read as series they produced a legend
    // reading "value" and "color", naming the data's fields rather than
    // anything on screen.
    expect(
      isSingleSeriesShape([{ label: "Jan", value: 3, color: "#0ca30c" }])
    ).toBe(true);
  });

  it("does not claim the stacked shape", () => {
    expect(
      isSingleSeriesShape([{ category: "WWTP", Passing: 3, Failing: 1 }])
    ).toBe(false);
  });

  it("is false for no data at all", () => {
    expect(isSingleSeriesShape([])).toBe(false);
    expect(isSingleSeriesShape()).toBe(false);
  });
});

describe("date histogram bands", () => {
  const TODAY = new Date("2026-08-12T00:00:00Z");

  it("draws its bands from the reserved status set", () => {
    // A private trio here would be a second vocabulary for good/warning/
    // critical — exactly what the palette work removed from the configs.
    const rows = computeDateHistogram(
      [
        { group: 1, value: "2026-08-01T00:00:00Z" },
        { group: 2, value: "2025-12-01T00:00:00Z" },
        { group: 3, value: "2024-01-01T00:00:00Z" },
      ],
      TODAY,
      { months: 18, overdue_label: "> 18 mo" }
    );
    const used = new Set(rows.map((r) => r.color).filter(Boolean));
    expect(used.size).toBeGreaterThan(1);
    used.forEach((colour) => {
      expect([
        STATUS_COLORS.good,
        STATUS_COLORS.warning,
        STATUS_COLORS.critical,
      ]).toContain(colour);
    });
  });

  it("still lets a config override the bands", () => {
    const rows = computeDateHistogram([], TODAY, {
      months: 18,
      overdue_label: "> 18 mo",
      colors: { recent: "#111111", watch: "#222222", overdue: "#333333" },
    });
    const used = new Set(rows.map((r) => r.color));
    expect(used).toContain("#111111");
    expect(used).toContain("#333333");
  });

  it("keeps the per-bar colour on rows the chart reads as one series", () => {
    // These rows are {label, value, color}: the extra key is style, not a
    // second series, and the legend must not name it.
    const rows = computeDateHistogram([], TODAY, { months: 3 });
    expect(isSingleSeriesShape(rows)).toBe(true);
  });
});
