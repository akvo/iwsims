import {
  CARD_ON_DARK,
  CARD_PLAIN_FILL,
  STATUS_COLORS,
  cardFill,
  contrastRatio,
} from "../constants";

describe("contrastRatio", () => {
  it("matches the WCAG reference points", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#0ca30c", CARD_ON_DARK)).toBeCloseTo(
      contrastRatio(CARD_ON_DARK, "#0ca30c"),
      6
    );
  });

  it("returns null when either colour is unusable", () => {
    expect(contrastRatio("nope", CARD_ON_DARK)).toBeNull();
    expect(contrastRatio(CARD_ON_DARK, "#fff")).toBeNull();
  });
});

describe("cardFill", () => {
  it("carries white text on every fill it can produce", () => {
    // This is the whole reason a separate fill scale exists. The status
    // colours are tuned as marks on a light surface: #0ca30c reaches only
    // 3.35 against white, under the 4.5 a small label needs. If a status
    // colour is ever retuned, this fails rather than shipping a card nobody
    // can read.
    const fills = [
      CARD_PLAIN_FILL,
      ...Object.values(STATUS_COLORS).map((c) => cardFill(c)),
    ];
    fills.forEach((fill) => {
      expect(contrastRatio(fill, CARD_ON_DARK)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("gives a card with no state the navy", () => {
    expect(cardFill(null)).toBe(CARD_PLAIN_FILL);
    expect(cardFill()).toBe(CARD_PLAIN_FILL);
    expect(cardFill("")).toBe(CARD_PLAIN_FILL);
  });

  it("keeps the critical fill as the status colour itself", () => {
    // It already carried white at 4.80, so stepping it down would have moved
    // the card away from the chart beside it for no gain.
    expect(cardFill(STATUS_COLORS.critical)).toBe(STATUS_COLORS.critical);
  });

  it("steps the green down far enough to hold white", () => {
    expect(cardFill(STATUS_COLORS.good)).not.toBe(STATUS_COLORS.good);
    expect(
      contrastRatio(cardFill(STATUS_COLORS.good), CARD_ON_DARK)
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the fills distinguishable from each other and from the navy", () => {
    const inUse = [
      CARD_PLAIN_FILL,
      cardFill(STATUS_COLORS.good),
      cardFill(STATUS_COLORS.critical),
    ];
    expect(new Set(inUse).size).toBe(inUse.length);
  });

  it("falls back to the navy rather than using a colour it cannot vouch for", () => {
    // An unknown fill might not hold white, and an unreadable card is worse
    // than one that has simply lost its accent.
    ["#123456", "red", "rgb(1,2,3)", 42].forEach((unknown) =>
      expect(cardFill(unknown)).toBe(CARD_PLAIN_FILL)
    );
  });

  it("is case-insensitive about the status colour it is handed", () => {
    expect(cardFill("#0CA30C")).toBe(cardFill("#0ca30c"));
  });
});
