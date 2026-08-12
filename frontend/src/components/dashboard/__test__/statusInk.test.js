import { STATUS_COLORS, contrastRatio, statusInk } from "../constants";

const WHITE = "#ffffff";

describe("contrastRatio", () => {
  it("matches the WCAG reference points", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#0ca30c", WHITE)).toBeCloseTo(
      contrastRatio(WHITE, "#0ca30c"),
      6
    );
  });

  it("returns null when either colour is unusable", () => {
    expect(contrastRatio("nope", WHITE)).toBeNull();
    expect(contrastRatio(WHITE, "#fff")).toBeNull();
  });
});

describe("statusInk", () => {
  it("puts white only on the fill that carries it", () => {
    // Measured: white reaches AA (4.5) on the red alone — 4.80. On the green
    // it is 3.35 and on the amber 1.83, so those take dark ink instead.
    expect(statusInk(STATUS_COLORS.critical)).toBe(WHITE);
    expect(statusInk(STATUS_COLORS.good)).not.toBe(WHITE);
    expect(statusInk(STATUS_COLORS.warning)).not.toBe(WHITE);
    expect(statusInk(STATUS_COLORS.serious)).not.toBe(WHITE);
    expect(statusInk(STATUS_COLORS.noData)).not.toBe(WHITE);
  });

  it("clears AA for small text on every status fill", () => {
    // The card's small label is what binds, not its figure: the figure is
    // large enough to clear 3:1 either way. If a status colour is ever
    // retuned, this fails rather than shipping unreadable cards.
    Object.values(STATUS_COLORS).forEach((fill) => {
      expect(contrastRatio(fill, statusInk(fill))).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("returns null for a fill it cannot read", () => {
    // The caller spreads the fill only when this returns a value, so an
    // unusable colour yields a plain card rather than white-on-white.
    ["", "red", "#fff", "rgb(1,2,3)", null, 42].forEach((bad) =>
      expect(statusInk(bad)).toBeNull()
    );
    expect(statusInk()).toBeNull();
  });
});
