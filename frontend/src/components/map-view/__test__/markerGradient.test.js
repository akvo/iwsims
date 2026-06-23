import { conicGradient } from "../markerGradient";

describe("conicGradient", () => {
  it("returns empty string for no colours", () => {
    expect(conicGradient([])).toBe("");
    // No argument → params default to no colours.
    expect(conicGradient()).toBe("");
    expect(conicGradient([null, false])).toBe("");
  });

  it("renders a single full-circle slice for one colour", () => {
    expect(conicGradient(["#1b9e77"])).toBe("conic-gradient(#1b9e77 0% 100%)");
  });

  it("splits into equal slices in order for multiple colours", () => {
    expect(conicGradient(["#a", "#b"])).toBe(
      "conic-gradient(#a 0% 50%, #b 50% 100%)"
    );
    expect(conicGradient(["#a", "#b", "#c", "#d"])).toBe(
      "conic-gradient(#a 0% 25%, #b 25% 50%, #c 50% 75%, #d 75% 100%)"
    );
  });

  it("ignores falsy colours when sizing the slices", () => {
    expect(conicGradient(["#a", null, "#b"])).toBe(
      "conic-gradient(#a 0% 50%, #b 50% 100%)"
    );
  });
});
