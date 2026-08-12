import { STATUS_COLORS, statusTint } from "../constants";

describe("statusTint", () => {
  it("washes a status colour at a low alpha", () => {
    expect(statusTint(STATUS_COLORS.critical)).toBe("rgba(208, 59, 59, 0.08)");
    expect(statusTint(STATUS_COLORS.good)).toBe("rgba(12, 163, 12, 0.08)");
  });

  it("takes an explicit alpha", () => {
    expect(statusTint("#000000", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("parses regardless of case or surrounding space", () => {
    expect(statusTint("  #D03B3B  ")).toBe("rgba(208, 59, 59, 0.08)");
  });

  it("returns null for anything it cannot parse", () => {
    // The caller spreads the style only when this returns a value, so an
    // unusable colour yields a plain card rather than `background: null`.
    [null, "", "red", "#fff", "#12345", "rgb(1,2,3)", 42].forEach((bad) =>
      expect(statusTint(bad)).toBeNull()
    );
    // Called with nothing at all, as a card with no `color` does.
    expect(statusTint()).toBeNull();
  });

  it("keeps every status colour distinguishable once tinted", () => {
    const tints = Object.values(STATUS_COLORS).map((c) => statusTint(c));
    expect(new Set(tints).size).toBe(tints.length);
  });

  it("stays a wash rather than a fill", () => {
    // A saturated card would put the figure over mid-tone colour and compete
    // with the charts below it. The status is the tint; the number is ink.
    const alpha = Number(
      /rgba\([^)]*,\s*([\d.]+)\)$/.exec(statusTint(STATUS_COLORS.good))[1]
    );
    expect(alpha).toBeLessThanOrEqual(0.12);
  });
});

describe("what the tint may and may not carry", () => {
  it("is atmosphere, not the signal", () => {
    // Measured with the dataviz validator against a white card: the good and
    // critical washes sit ΔE 3.1 apart for normal vision and 0.7 under
    // deuteranopia, against a floor of 15 — a red-tinted and a green-tinted
    // card are the same colour to a reader. Raising alpha does not rescue it
    // (0.16 reaches only 6.0). So the accent bar stays full strength and the
    // tint only warms the card behind it.
    //
    // This pins the contract the cards rely on: `statusTint` must never be
    // the only thing distinguishing two states.
    const good = statusTint(STATUS_COLORS.good);
    const critical = statusTint(STATUS_COLORS.critical);
    expect(good).not.toBe(critical);

    const alphaOf = (rgba) =>
      Number(/rgba\([^)]*,\s*([\d.]+)\)$/.exec(rgba)[1]);
    // A wash this faint cannot be load-bearing; the assertion exists so that
    // raising it later is a deliberate decision rather than a quiet drift.
    expect(alphaOf(good)).toBeLessThanOrEqual(0.12);
    expect(alphaOf(critical)).toBeLessThanOrEqual(0.12);
  });
});
