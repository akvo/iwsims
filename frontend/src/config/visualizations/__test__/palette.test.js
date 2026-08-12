import { listVisualizations, getVisualizationConfigBySlug } from "../index";
import { STATUS_COLORS } from "../../../components/dashboard/constants";

/**
 * The dashboards draw from two closed sets and nothing else.
 *
 * CATEGORICAL is a fixed slot order, and the order is the colourblind-safety
 * mechanism rather than a style choice: the same eight hues in their previous
 * arrangement put Total coliform beside Turbidity at ΔE 13.7, below the
 * normal-vision floor of 15 — a pair full-colour readers could not reliably
 * tell apart. Re-ordering to these slots passes every check with no new hex.
 *
 * Validated with the dataviz validator (light surface #fcfcfb):
 *   node scripts/validate_palette.js "<the CATEGORICAL list>" --mode light
 * Re-run it if a slot ever changes. Do not eyeball ΔE.
 */
const CATEGORICAL = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
];

const STATUS = Object.values(STATUS_COLORS);
const ALLOWED = new Set(
  [...CATEGORICAL, ...STATUS].map((c) => c.toLowerCase())
);

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Every colour a config declares, with a trail describing where it sits. */
const coloursIn = (config) => {
  const out = [];
  const walk = (node, trail) => {
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, trail));
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }
    Object.entries(node).forEach(([key, value]) => {
      if (typeof value === "string" && HEX.test(value)) {
        out.push({ where: [...trail, key].join("."), colour: value });
        return;
      }
      walk(value, [...trail, key]);
    });
  };
  walk(config.items, []);
  return out;
};

const allConfigs = () =>
  listVisualizations().map(({ slug }) => ({
    slug,
    config: getVisualizationConfigBySlug(slug),
  }));

describe("dashboard palette", () => {
  it("finds colours to check", () => {
    const total = allConfigs().reduce(
      (n, { config }) => n + coloursIn(config).length,
      0
    );
    expect(total).toBeGreaterThan(50);
  });

  it.each(allConfigs().map(({ slug, config }) => [slug, config]))(
    "%s draws only from the categorical and status sets",
    (_slug, config) => {
      // Before this was enforced there were 45 off-palette uses: three parallel
      // green/amber/red vocabularies and six different colours for "no answer",
      // one of them a saturated blue that read as a real category.
      const strays = coloursIn(config).filter(
        (c) => !ALLOWED.has(c.colour.toLowerCase())
      );
      expect(strays).toEqual([]);
    }
  );

  it("keeps the categorical slots distinct from the status colours", () => {
    // A series wearing a status colour claims a meaning it does not have.
    const status = new Set(STATUS.map((c) => c.toLowerCase()));
    CATEGORICAL.forEach((slot) => {
      expect(status.has(slot.toLowerCase())).toBe(false);
    });
  });

  it("never repeats a colour among one chart's own series", () => {
    // Two series sharing a colour in the same chart are indistinguishable.
    // The one deliberate exception is an entity measured two ways — colour
    // follows the entity, so both of its rows keep the same slot.
    const SAME_ENTITY = [["E-coli presence", "E-coli CBT"]];
    allConfigs().forEach(({ slug, config }) => {
      const walk = (node) => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (!node || typeof node !== "object") {
          return;
        }
        if (node.color_map) {
          const entries = Object.entries(node.color_map).filter(
            ([, v]) => typeof v === "string" && HEX.test(v)
          );
          const byColour = {};
          entries.forEach(([key, colour]) => {
            byColour[colour] = [...(byColour[colour] || []), key];
          });
          Object.entries(byColour).forEach(([colour, keys]) => {
            if (keys.length < 2) {
              return;
            }
            // Neutrals legitimately cover several "no answer" states.
            if (colour.toLowerCase() === STATUS_COLORS.noData.toLowerCase()) {
              return;
            }
            const isSameEntity = SAME_ENTITY.some((group) =>
              keys.every((k) => group.includes(k))
            );
            expect(
              isSameEntity ? [] : { slug, id: node.id, colour, keys }
            ).toEqual([]);
          });
        }
        if (Array.isArray(node.domains)) {
          const colours = node.domains
            .map((d) => d.color)
            .filter((c) => typeof c === "string");
          expect(new Set(colours).size).toBe(colours.length);
        }
        Object.values(node).forEach(walk);
      };
      walk(config.items);
    });
  });

  it("gives every 'no answer' state the one reserved neutral", () => {
    // Six colours meant this once, so a site with no data looked different on
    // every dashboard — and on one of them looked like a real category.
    const NONE_KEYS = [
      "_no_info",
      "not_active",
      "n/a",
      "not_applicable",
      "no information available",
    ];
    allConfigs().forEach(({ slug, config }) => {
      const walk = (node) => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (!node || typeof node !== "object") {
          return;
        }
        if (node.color_map) {
          Object.entries(node.color_map).forEach(([key, colour]) => {
            if (NONE_KEYS.includes(key.toLowerCase())) {
              expect({ slug, key, colour }).toEqual({
                slug,
                key,
                colour: STATUS_COLORS.noData,
              });
            }
          });
        }
        Object.values(node).forEach(walk);
      };
      walk(config.items);
    });
  });
});
