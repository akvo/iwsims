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
      ])
    );
  });

  it("resolves the national overview and marks it cross_asset", () => {
    const config = getVisualizationConfigBySlug("national-overview");
    expect(config).not.toBeNull();
    expect(config.cross_asset).toBe(true);
    // A cross-asset config must NOT claim a root form — every api names its own.
    expect(config.parent_form_id).toBeUndefined();
  });

  it("gives every api block in the national overview its own parent_form_id", () => {
    const config = getVisualizationConfigBySlug("national-overview");
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
      .filter((entry) => typeof entry.api?.parent_form_id !== "number")
      .map((entry) => entry.id);
    expect(missing).toEqual([]);
  });

  it("returns null for an unknown slug", () => {
    expect(getVisualizationConfigBySlug("nope")).toBeNull();
    expect(getVisualizationConfigBySlug("")).toBeNull();
  });
});
