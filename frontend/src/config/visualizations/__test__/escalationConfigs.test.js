import {
  serializeCriteria,
  serializeColumns,
} from "../../../util/hooks/useDashboardEscalation";
import { listVisualizations, getVisualizationConfigBySlug } from "../index";
import { resolveSegmentColumns } from "../../../components/dashboard/compute/mergeInspections";

/** Every item of the given chart_type across every registered dashboard. */
const allOfType = (chartType) =>
  listVisualizations().flatMap(({ slug }) => {
    const config = getVisualizationConfigBySlug(slug);
    const out = [];
    const walk = (items) =>
      (items || []).forEach((item) => {
        if (item.chart_type === chartType) {
          out.push({ slug, item });
        }
        walk(item.items);
      });
    walk(config.items);
    return out;
  });

const allTables = () => allOfType("table");

/** Every (merged_table, segment) pair — one request each at runtime. */
const allMergedSegments = () =>
  allOfType("merged_table").flatMap(({ slug, item }) =>
    (item.segments || []).map((segment) => ({ slug, item, segment }))
  );

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

describe("merged inspection table configs", () => {
  it("finds merged_table segments to check", () => {
    expect(allMergedSegments().length).toBeGreaterThan(0);
  });

  // Driven through the SAME resolver + serializer the widget uses at runtime.
  // Every previous bug in this area came from a probe that built the query
  // string by hand and so agreed with nothing the app actually sends.
  it.each(
    allMergedSegments().map(({ slug, item, segment }) => [
      `${slug}/${item.id}/${segment.key}`,
      item,
      segment,
    ])
  )("%s serializes backend-resolvable columns", (_name, item, segment) => {
    const serialized = serializeColumns(
      resolveSegmentColumns(item.columns, segment)
    );
    expect(serialized).not.toBe("");
    // The column the feed sorts and windows on must survive resolution for
    // THIS segment — its absence would silently sort by insertion order.
    const dateKey = item.date_key || "last_inspected";
    expect(serialized).toContain(`${dateKey}:latest_date:`);
  });

  it.each(
    allMergedSegments().map(({ slug, item, segment }) => [
      `${slug}/${item.id}/${segment.key}`,
      item,
      segment,
    ])
  )("%s names its own form and date question", (_name, item, segment) => {
    // A cross-asset page has no root form; a segment naming neither a form
    // nor its date question queries nothing, or windows on the wrong field.
    expect(typeof segment.api?.form_id).toBe("number");
    const dateKey = item.date_key || "last_inspected";
    expect(typeof segment.questions?.[dateKey]).toBe("string");
  });

  it("gives every segment a distinct key, since rows are keyed by it", () => {
    allOfType("merged_table").forEach(({ item }) => {
      const keys = (item.segments || []).map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });
});
