import {
  DENOMINATOR,
  NUMERATOR,
  formatCaption,
  hasRole,
  percentOf,
  scalar,
  statusColorFor,
  sumRole,
} from "../crossAssetKpi";
import { STATUS_COLORS } from "../../constants";

const response = (value) => ({ data: [{ value, label: "Total" }] });

describe("sumRole", () => {
  const segments = [
    { key: "a" },
    { key: "b", role: NUMERATOR },
    { key: "c", role: DENOMINATOR },
  ];
  const responses = { a: response(4), b: response(6), c: response(20) };

  it("treats a segment with no role as a numerator", () => {
    // Total Assets is a plain sum of five registration counts; making each
    // one declare role: "numerator" would be noise on the commonest card.
    expect(sumRole(segments, responses)).toBe(10);
  });

  it("sums only the requested role", () => {
    expect(sumRole(segments, responses, DENOMINATOR)).toBe(20);
  });

  it("counts a segment still in flight as nothing, not as an error", () => {
    expect(sumRole(segments, { a: response(4) })).toBe(4);
  });

  it("knows whether a card is a ratio at all", () => {
    expect(hasRole(segments, DENOMINATOR)).toBe(true);
    expect(hasRole([{ key: "a" }], DENOMINATOR)).toBe(false);
  });
});

describe("scalar", () => {
  it("is 0 for a response that has not arrived", () => {
    expect(scalar(null)).toBe(0);
    expect(scalar({ data: [] })).toBe(0);
  });
});

describe("percentOf", () => {
  it("rounds to whole percent", () => {
    expect(percentOf(340, 511)).toBe(67);
  });

  it("is null rather than 0 when there is nothing to divide by", () => {
    // A card whose denominator has not landed has not measured 0%. Rendering
    // it as such would report an empty fleet as a total failure.
    expect(percentOf(3, 0)).toBeNull();
    expect(percentOf(3, null)).toBeNull();
  });
});

describe("formatCaption", () => {
  it("fills placeholders from the card's own numbers", () => {
    expect(
      formatCaption("{numerator} of {denominator} assessed", {
        numerator: 383,
        denominator: 511,
      })
    ).toBe("383 of 511 assessed");
  });

  it("leaves a static caption alone", () => {
    expect(formatCaption("across 5 categories", {})).toBe(
      "across 5 categories"
    );
  });

  it("leaves an unknown placeholder standing", () => {
    // Blanking it would make a config typo look like a missing number.
    expect(formatCaption("{nope} of {denominator}", { denominator: 5 })).toBe(
      "{nope} of 5"
    );
  });

  it("is null for a card with no caption", () => {
    expect(formatCaption(null, {})).toBeNull();
  });
});

describe("statusColorFor", () => {
  const item = { status_thresholds: { good: 90, warning: 75 } };

  it("takes its status from the value, not from config", () => {
    expect(statusColorFor(item, { percent: 95 })).toBe(STATUS_COLORS.good);
    expect(statusColorFor(item, { percent: 80 })).toBe(STATUS_COLORS.warning);
    expect(statusColorFor(item, { percent: 40 })).toBe(STATUS_COLORS.critical);
  });

  it("is null when there is no value to judge", () => {
    // Which renders the plain navy — an unmeasurable card should look
    // deliberate, not green by default.
    expect(statusColorFor(item, { percent: null })).toBeNull();
    expect(statusColorFor({}, { percent: 95 })).toBeNull();
  });

  it("reads a count where any of them is the bad news", () => {
    const alerts = { status_when_positive: "critical" };
    expect(statusColorFor(alerts, { count: 92 })).toBe(STATUS_COLORS.critical);
    expect(statusColorFor(alerts, { count: 0 })).toBe(STATUS_COLORS.good);
    expect(statusColorFor(alerts, { count: null })).toBeNull();
  });
});
