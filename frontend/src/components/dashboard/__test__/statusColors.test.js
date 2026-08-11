import { STATUS_COLORS, CONDITION_TONE_COLORS } from "../constants";
import epsOverview from "../../../config/visualizations/1749623934933.json";
import rwsOverview from "../../../config/visualizations/1749621221728.json";

/** Every colour a config assigns, with the role it plays. */
const colorsIn = (config) => {
  const out = [];
  const walk = (items) =>
    (items || []).forEach((item) => {
      if (item.color) {
        out.push({ id: item.id, role: "kpi", hex: item.color });
      }
      Object.entries(item.color_map || {}).forEach(([key, hex]) =>
        out.push({ id: item.id, role: `color_map:${key}`, hex })
      );
      ((item.config || {}).color || []).forEach((hex) =>
        out.push({ id: item.id, role: "series", hex })
      );
      walk(item.items);
    });
  walk(config.items);
  return out;
};

// The four green/red pairs that used to mean the same thing, plus the greys.
const RETIRED = [
  "#64a73b",
  "#2fb36d",
  "#2e7d32",
  "#3bb273", // good
  "#e41a1c",
  "#d93c35",
  "#c62828",
  "#e1503f", // critical
  "#e6ab02",
  "#fdae60",
  "#f5a623",
  "#f0ad4e", // warning
  "#999999",
  "#bfbfbf",
  "#90a4ae", // no data
];

describe("status palette", () => {
  it("drives the condition-matrix tones", () => {
    // One definition, so the matrix and the charts cannot drift apart.
    expect(CONDITION_TONE_COLORS.good).toBe(STATUS_COLORS.good);
    expect(CONDITION_TONE_COLORS.mid).toBe(STATUS_COLORS.warning);
    expect(CONDITION_TONE_COLORS.bad).toBe(STATUS_COLORS.critical);
    expect(CONDITION_TONE_COLORS.neutral).toBe(STATUS_COLORS.noData);
  });

  it.each([
    ["eps-overview", epsOverview],
    ["rws-overview", rwsOverview],
  ])("%s uses no retired status hex", (_slug, config) => {
    const stale = colorsIn(config).filter((c) =>
      RETIRED.includes(String(c.hex).toLowerCase())
    );
    expect(stale).toEqual([]);
  });

  it("colours a parameter the same on every dashboard", () => {
    // Turbidity was #ff7f00 on RWS and #ef6c00 on EPS — colour has to follow the
    // entity, not the page, or nobody can carry a mapping between screens.
    const stack = (config) => {
      let found = null;
      const walk = (items) =>
        (items || []).forEach((item) => {
          if (item.id === "chart_drinking_water_compliance") {
            found = item.color_map;
          }
          walk(item.items);
        });
      walk(config.items);
      return found;
    };
    const eps = stack(epsOverview);
    const rws = stack(rwsOverview);
    Object.keys(rws).forEach((key) => {
      expect(eps[key]).toBe(rws[key]);
    });
  });

  it("never gives a status colour to a parameter series", () => {
    // Reusing status red as "E-coli presence" is what made red stop meaning
    // "bad"; it also put the two most important categories at CVD ΔE 2.2.
    const reserved = [STATUS_COLORS.critical, STATUS_COLORS.warning];
    const params = Object.entries(stackOf(rwsOverview)).filter(
      ([key]) => key !== "Compliant" && key !== "No information available"
    );
    params.forEach(([, hex]) => expect(reserved).not.toContain(hex));
  });
});

function stackOf(config) {
  let found = null;
  const walk = (items) =>
    (items || []).forEach((item) => {
      if (item.id === "chart_drinking_water_compliance") {
        found = item.color_map;
      }
      walk(item.items);
    });
  walk(config.items);
  return found;
}
