import { buildDashboardMenu } from "../Header";

const label = (d) => d.name;

const PER_ASSET = [
  { slug: "wwtp-overview", name: "WWTP", cross_asset: false },
  { slug: "wtp-overview", name: "WTP", cross_asset: false },
];
const CROSS_ASSET = [
  { slug: "national-overview", name: "National Overview", cross_asset: true },
  { slug: "all-alerts", name: "All Alerts", cross_asset: true },
  { slug: "inspections-feed", name: "Inspections Feed", cross_asset: true },
];

describe("buildDashboardMenu", () => {
  it("leads with the fleet-wide dashboards, then a rule, then the assets", () => {
    // The fleet pages are the entry point — what the country looks like, what
    // needs attention, what was inspected. Below the rule you are already
    // asking about one asset.
    const items = buildDashboardMenu([...PER_ASSET, ...CROSS_ASSET], label);
    expect(items.map((i) => i.type || i.key)).toEqual([
      "national-overview",
      "all-alerts",
      "inspections-feed",
      "divider",
      "wwtp-overview",
      "wtp-overview",
    ]);
  });

  it("keeps each group in registry order", () => {
    // National Overview first of the three, not whichever config happens to
    // be imported first.
    const items = buildDashboardMenu(CROSS_ASSET, label);
    expect(items.map((i) => i.key)).toEqual([
      "national-overview",
      "all-alerts",
      "inspections-feed",
    ]);
  });

  it("groups by kind rather than by registry order", () => {
    // An asset config registered between two cross-asset ones must still land
    // below the rule, or the divider would separate an arbitrary pair.
    const items = buildDashboardMenu(
      [CROSS_ASSET[0], PER_ASSET[0], CROSS_ASSET[1]],
      label
    );
    expect(items.map((i) => i.type || i.key)).toEqual([
      "national-overview",
      "all-alerts",
      "divider",
      "wwtp-overview",
    ]);
  });

  it("omits the divider when only one kind is present", () => {
    expect(buildDashboardMenu(PER_ASSET, label).map((i) => i.key)).toEqual([
      "wwtp-overview",
      "wtp-overview",
    ]);
    expect(buildDashboardMenu(CROSS_ASSET, label).map((i) => i.key)).toEqual([
      "national-overview",
      "all-alerts",
      "inspections-feed",
    ]);
  });

  it("renders nothing for an empty menu", () => {
    expect(buildDashboardMenu([], label)).toEqual([]);
    // Header calls this before the form list has been read on a bare instance.
    expect(buildDashboardMenu()).toEqual([]);
  });

  it("labels each entry through the supplied renderer", () => {
    const items = buildDashboardMenu(PER_ASSET, (d) => `label:${d.name}`);
    expect(items[0]).toEqual({ key: "wwtp-overview", label: "label:WWTP" });
  });
});
