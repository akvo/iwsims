import {
  collectFormIds,
  getVisualizationConfigBySlug,
  listAvailableVisualizations,
  listVisualizations,
} from "../index";

const ASSET_FORM_IDS = [
  1748903240763, // WWTP
  1749634736797, // WTP
  1749621221728, // RWS
  1749623934933, // EPS
  1749611049520, // Pump Stations
];

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

  it.each(["national-overview", "all-alerts", "inspections-feed"])(
    "%s reports the forms it reads even with no root form",
    (slug) => {
      // The menu filters on these ids. A cross-asset config has no root
      // parent_form_id by design, so reading that field alone reports
      // `undefined` and drops the page out of the Dashboards dropdown — which
      // is exactly how all three went missing from the menu.
      const found = listVisualizations().find((d) => d.slug === slug);
      expect(found.parent_form_id).toBeUndefined();
      expect(found.form_ids.sort()).toEqual([...ASSET_FORM_IDS].sort());
    }
  );

  it("reports a single-asset dashboard's own form", () => {
    const found = listVisualizations().find((d) => d.slug === "wwtp-overview");
    expect(found.form_ids).toEqual([1748903240763]);
  });

  it("ignores form ids that are not finite numbers", () => {
    expect(
      collectFormIds({
        parent_form_id: null,
        items: [
          { api: { form_id: "1748903240763" } },
          { api: { parent_form_id: NaN } },
          { api: {} },
        ],
      })
    ).toEqual([]);
  });

  it("offers every dashboard on an instance running all five assets", () => {
    const slugs = listAvailableVisualizations(ASSET_FORM_IDS).map(
      (d) => d.slug
    );
    expect(slugs).toEqual(
      expect.arrayContaining(listVisualizations().map((d) => d.slug))
    );
  });

  it("keeps a cross-asset page when only some of its assets are deployed", () => {
    // A national view of three assets is still worth opening; only a dashboard
    // whose every form is absent should disappear.
    const slugs = listAvailableVisualizations([1748903240763]).map(
      (d) => d.slug
    );
    expect(slugs).toContain("national-overview");
    expect(slugs).toContain("wwtp-overview");
    expect(slugs).not.toContain("wtp-overview");
  });

  it("offers nothing when no form is deployed", () => {
    expect(listAvailableVisualizations([])).toEqual([]);
  });

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
