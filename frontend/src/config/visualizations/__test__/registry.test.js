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
      ])
    );
  });

  it.each(["national-overview", "all-alerts"])(
    "%s resolves and is marked cross_asset with no root form",
    (slug) => {
      const config = getVisualizationConfigBySlug(slug);
      expect(config).not.toBeNull();
      expect(config.cross_asset).toBe(true);
      expect(config.parent_form_id).toBeUndefined();
    }
  );

  it.each(["national-overview", "all-alerts"])(
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
});
