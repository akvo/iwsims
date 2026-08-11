import { getVisualizationConfigBySlug, listVisualizations } from "../index";

describe("visualization registry", () => {
  it("registers every dashboard, including the cross-asset one", () => {
    const slugs = listVisualizations().map((c) => c.slug);
    expect(slugs).toEqual(
      expect.arrayContaining([
        "wwtp-overview",
        "wtp-overview",
        "rws-overview",
        "eps-overview",
        "pump-overview",
        "national-overview",
        "all-alerts",
        "inspections-feed",
      ])
    );
  });

  it.each(["national-overview", "all-alerts", "inspections-feed"])(
    "%s resolves and is marked cross_asset with no root form",
    (slug) => {
      const config = getVisualizationConfigBySlug(slug);
      expect(config).not.toBeNull();
      expect(config.cross_asset).toBe(true);
      expect(config.parent_form_id).toBeUndefined();
    }
  );

  it.each(["national-overview", "all-alerts", "inspections-feed"])(
    "%s gives every api block its own form scope",
    (slug) => {
      // A cross-asset config has no root form, so each widget must name the
      // family it queries: parent_form_id for /values, form_id for the
      // escalation endpoint. One that names neither silently queries nothing.
      const config = getVisualizationConfigBySlug(slug);
      const apis = [];
      const walk = (items) =>
        (items || []).forEach((item) => {
          if (item.api) {
            apis.push({ id: item.id, api: item.api });
          }
          (item.segments || []).forEach((segment) =>
            apis.push({ id: `${item.id}::${segment.key}`, api: segment.api })
          );
          walk(item.items);
        });
      walk(config.items);

      expect(apis.length).toBeGreaterThan(0);
      const missing = apis
        .filter(
          (entry) =>
            typeof entry.api?.parent_form_id !== "number" &&
            typeof entry.api?.form_id !== "number"
        )
        .map((entry) => entry.id);
      expect(missing).toEqual([]);
    }
  );

  it("returns null for an unknown slug", () => {
    expect(getVisualizationConfigBySlug("nope")).toBeNull();
    expect(getVisualizationConfigBySlug("")).toBeNull();
  });

  it("orders the inspections feed by a real latest_date column", () => {
    // order_by names a column key; the backend silently falls back to id
    // ordering if it does not resolve, which would turn the feed into a
    // non-chronological list that still looks fine.
    const config = getVisualizationConfigBySlug("inspections-feed");
    const tables = [];
    const walk = (items) =>
      (items || []).forEach((item) => {
        if (item.chart_type === "table") {
          tables.push(item);
        }
        walk(item.items);
      });
    walk(config.items);

    expect(tables.length).toBeGreaterThan(0);
    tables.forEach((table) => {
      const key = table.api.order_by;
      expect(key).toBeTruthy();
      const column = (table.columns || []).find((c) => c.key === key);
      expect(column).toBeDefined();
      expect(column.source).toBe("latest_date");
      expect(typeof column.question_name).toBe("string");
    });
  });
});
