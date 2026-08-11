import {
  serializeCriteria,
  serializeColumns,
} from "../../../util/hooks/useDashboardEscalation";
import { listVisualizations, getVisualizationConfigBySlug } from "../index";

/** Every `table` item across every registered dashboard. */
const allTables = () =>
  listVisualizations().flatMap(({ slug }) => {
    const config = getVisualizationConfigBySlug(slug);
    const out = [];
    const walk = (items) =>
      (items || []).forEach((item) => {
        if (item.chart_type === "table") {
          out.push({ slug, item });
        }
        walk(item.items);
      });
    walk(config.items);
    return out;
  });

describe("escalation table configs", () => {
  it("finds table items to check", () => {
    expect(allTables().length).toBeGreaterThan(0);
  });

  // Criteria are optional — a whole-fleet listing declares none and the param
  // is omitted. But a table that DOES declare criteria must produce a non-empty
  // string: serializeCriteria drops anything marked `hide: true`, so a table
  // whose criteria are all hidden serializes to "" and 400s at runtime while
  // looking perfectly fine in config. Asserting through the real serializer is
  // the point — building the query string by hand in a test missed exactly this.
  it.each(allTables().map(({ slug, item }) => [`${slug}/${item.id}`, item]))(
    "%s either declares no criteria or serializes them all",
    (_name, item) => {
      const criteria = item.api?.criteria;
      if (!criteria) {
        return;
      }
      expect(criteria.length).toBeGreaterThan(0);

      const serialized = serializeCriteria(criteria);
      expect(serialized).not.toBe("");
      expect(serialized.split(",").length).toBe(
        criteria.filter((c) => !c.hide).length
      );
    }
  );

  it.each(allTables().map(({ slug, item }) => [`${slug}/${item.id}`, item]))(
    "%s serializes at least one backend-resolvable column",
    (_name, item) => {
      // Computed columns are rendered client-side and serialize to nothing;
      // a table made only of those would ask the backend for no columns.
      expect(serializeColumns(item.columns || [])).not.toBe("");
    }
  );
});
