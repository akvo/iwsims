import {
  STATUS_COLORS,
  CONDITION_TONE_COLORS,
  toneTagColor,
} from "../constants";
import epsOverview from "../../../config/visualizations/1749623934933.json";
import rwsOverview from "../../../config/visualizations/1749621221728.json";
import wwtpOverview from "../../../config/visualizations/1748903240763.json";
import wtpOverview from "../../../config/visualizations/1749634736797.json";
import pumpOverview from "../../../config/visualizations/1749611049520.json";

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

describe("indicator pills", () => {
  it("maps every tone to a legible AntD preset", () => {
    // Presets give a tinted background with dark text. Passing our own status
    // hex would render white-on-fill, and white on warning (#fab219, 1.79:1)
    // is unreadable — so pills use presets even though the charts use hexes.
    expect(toneTagColor("good")).toBe("green");
    expect(toneTagColor("warning")).toBe("gold");
    expect(toneTagColor("serious")).toBe("orange");
    expect(toneTagColor("critical")).toBe("red");
  });

  it("falls back to neutral for an unknown or missing tone", () => {
    expect(toneTagColor("mystery")).toBe("default");
    expect(toneTagColor()).toBe("default");
  });

  it("tones the same answer differently per column where it means the opposite", () => {
    // "yes" is good for OHS equipment and bad for production constraints —
    // which is why tones are declared per column rather than globally.
    const ohs = columnTones(wwtpOverview, "ohs");
    const constraints = columnTones(wtpOverview, "constraints");
    expect(ohs.yes).toBe("good");
    expect(constraints.yes).toBe("critical");
  });

  it("declares a tone for every option a pilled column can show", () => {
    // A value with no tone silently renders as plain text, so a pilled column
    // that misses one option looks broken only for that answer.
    const pump = columnTones(pumpOverview, "status");
    ["operational", "overflowing", "blocked", "not_operational"].forEach((v) =>
      expect(pump[v]).toBeTruthy()
    );
  });
});

function columnTones(config, key) {
  let tones = null;
  const walk = (items) =>
    (items || []).forEach((item) => {
      if (item.chart_type === "table") {
        (item.columns || []).forEach((c) => {
          if (c.key === key && c.tones) {
            tones = c.tones;
          }
        });
      }
      walk(item.items);
    });
  walk(config.items);
  return tones || {};
}

describe("KPI card accents", () => {
  const cards = (config) => {
    const out = [];
    const walk = (items) =>
      (items || []).forEach((item) => {
        if (item.chart_type === "card" || item.chart_type === "metric_card") {
          out.push(item);
        }
        walk(item.items);
      });
    walk(config.items);
    return out;
  };

  const ALL = [
    wwtpOverview,
    wtpOverview,
    rwsOverview,
    epsOverview,
    pumpOverview,
  ];

  it("only ever accents a card with a status colour", () => {
    // A card's colour means "this is a state", so a decorative hue on a plain
    // count (#1890ff on "Total EPS registered", #fa8c16 on "under
    // construction") is what made the row look arbitrary.
    const allowed = [STATUS_COLORS.good, STATUS_COLORS.critical];
    ALL.flatMap(cards).forEach((card) => {
      if (card.color) {
        expect(allowed).toContain(card.color);
      }
    });
  });

  it("leaves plain counts unaccented", () => {
    // "Total EPS operational" starts with Total but IS a state; match on the
    // measurement, not the leading word.
    const plain = ALL.flatMap(cards).filter((c) => {
      const label = c.label || "";
      const isCount =
        /registered|inspected|monitored|under construction|^total (wwtp|wtp|rws|eps|pump)/i.test(
          label
        );
      const isStatus = /operational|critical|compliance|committee|issues/i.test(
        label
      );
      return isCount && !isStatus;
    });
    expect(plain.length).toBeGreaterThan(0);
    plain.forEach((card) => expect(card.color).toBeUndefined());
  });

  it("gives the same metric the same accent on every dashboard", () => {
    // DW Compliance was orange on WTP and green on RWS — the same measurement
    // reading as a warning on one page and a success on another.
    const byLabel = {};
    ALL.flatMap(cards).forEach((c) => {
      const key = (c.label || "").toLowerCase();
      if (/compliance|operational/.test(key)) {
        byLabel[key] = byLabel[key] || new Set();
        byLabel[key].add(card_color(c));
      }
    });
    Object.entries(byLabel).forEach(([, colors]) => {
      expect(colors.size).toBe(1);
    });
  });
});

function card_color(card) {
  return card.color || "none";
}
