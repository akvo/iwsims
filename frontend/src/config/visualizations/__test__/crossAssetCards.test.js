import { getVisualizationConfigBySlug, resolveCrossConfigRef } from "../index";

/**
 * A fleet KPI card is nothing but references — to another item's domains, to
 * another dashboard's alert table, to a registration form. Every one of them
 * is a string, so nothing but a test notices when the thing it names is
 * renamed or removed; the card just renders a dash.
 */

const CROSS_ASSET_SLUGS = [
  "national-overview",
  "all-alerts",
  "inspections-feed",
];

const cardsOf = (config) =>
  (config?.items || []).filter((i) => i.chart_type === "cross_asset_card");

const allCards = CROSS_ASSET_SLUGS.flatMap((slug) =>
  cardsOf(getVisualizationConfigBySlug(slug)).map((item) => [
    slug,
    item.id,
    item,
  ])
);

const KNOWN_PLACEHOLDERS = [
  "value",
  "numerator",
  "denominator",
  "notAssessed",
  "total",
  "percent",
];

describe("cross_asset_card configs", () => {
  it("finds the cards to check", () => {
    expect(allCards.length).toBeGreaterThan(0);
  });

  it.each(allCards)("%s#%s names a source we implement", (slug, id, item) => {
    expect([
      "segments",
      "donut_domain",
      "formula_domains",
      "escalation",
    ]).toContain(item.source || "segments");
  });

  it.each(allCards)("%s#%s uses known caption placeholders", (s, i, item) => {
    const used = [...String(item.caption || "").matchAll(/\{(\w+)\}/g)].map(
      (m) => m[1]
    );
    used.forEach((key) => expect(KNOWN_PLACEHOLDERS).toContain(key));
  });

  it.each(
    allCards.filter(([, , i]) => (i.source || "segments") === "segments")
  )(
    "%s#%s gives every segment a unique key and its own form",
    (slug, id, item) => {
      const keys = (item.segments || []).map((s) => s.key);
      expect(keys.length).toBeGreaterThan(0);
      expect(new Set(keys).size).toBe(keys.length);
      (item.segments || []).forEach((seg) => {
        // A cross-asset page has no root form, so a segment that names none
        // would silently query nothing.
        expect(typeof seg.api?.parent_form_id).toBe("number");
      });
    }
  );

  it.each(
    allCards.filter(([, , i]) =>
      ["donut_domain", "formula_domains"].includes(i.source)
    )
  )("%s#%s resolves its snapshot and domains", (slug, id, item) => {
    const config = getVisualizationConfigBySlug(slug);
    const snapshot = (config.items || []).find(
      (i) => i.id === item.snapshot_ref
    );
    expect(snapshot?.domains?.length).toBeGreaterThan(0);
    const domainIds = snapshot.domains.map((d) => d.id);
    const wanted = item.domain_ids || [item.domain_id];
    wanted.forEach((domainId) => expect(domainIds).toContain(domainId));
  });

  it.each(allCards.filter(([, , i]) => i.source === "formula_domains"))(
    "%s#%s pools domains that judge no family twice",
    (slug, id, item) => {
      const config = getVisualizationConfigBySlug(slug);
      const snapshot = (config.items || []).find(
        (i) => i.id === item.snapshot_ref
      );
      const families = snapshot.domains
        .filter((d) => item.domain_ids.includes(d.id))
        .flatMap((d) => (d.families || []).map((f) => f.key));
      // Pooling counts is only sound while the domains are disjoint: a family
      // in two of them would have its sites counted twice.
      expect(new Set(families).size).toBe(families.length);
    }
  );

  it.each(allCards.filter(([, , i]) => i.source === "escalation"))(
    "%s#%s resolves every alert table it counts",
    (slug, id, item) => {
      expect(item.refs.length).toBeGreaterThan(0);
      item.refs.forEach((ref) => {
        const target = resolveCrossConfigRef(ref);
        expect(target).not.toBeNull();
        expect(typeof target.api?.form_id).toBe("number");
        expect(target.columns?.length).toBeGreaterThan(0);
      });
    }
  );
});
