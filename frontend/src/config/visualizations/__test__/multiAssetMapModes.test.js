import { getVisualizationConfigBySlug, listVisualizations } from "../index";
import {
  UNKNOWN,
  modeBuckets,
  resolveFamilies,
  resolveModes,
} from "../../../components/dashboard/compute/mapModes";
import { resolveFamilyFormula } from "../../../components/dashboard/compute/complianceFormula";
import {
  FUNCTIONAL,
  NON_FUNCTIONAL,
} from "../../../components/dashboard/compute/assetStatus";

/**
 * A map mode is a set of question names, option values and cross-config
 * references. Every one of them is a string that renders as a grey pin when
 * it stops matching, which looks exactly like "not monitored yet" — so
 * nothing but a test tells the difference.
 */

const mapsWithModes = listVisualizations().flatMap(({ slug }) => {
  const config = getVisualizationConfigBySlug(slug);
  return (config?.items || [])
    .filter((i) => i.chart_type === "multi_asset_map")
    .flatMap((item) =>
      resolveModes(item).map((mode) => [
        `${slug}#${item.id}`,
        mode.key,
        item,
        mode,
      ])
    );
});

describe("multi_asset_map modes", () => {
  it("finds the maps to check", () => {
    expect(mapsWithModes.length).toBeGreaterThan(0);
  });

  it.each(mapsWithModes)(
    "%s / %s draws only declared families",
    (m, k, item, mode) => {
      const families = resolveFamilies(item).map((f) => f.key);
      expect(families.length).toBeGreaterThan(0);
      (mode.sources || []).forEach((source) => {
        // A source for a family the map does not draw fetches answers for pins
        // that never appear.
        expect(families).toContain(source.key);
      });
    }
  );

  it.each(mapsWithModes)("%s / %s gives every family a form", (m, k, item) => {
    resolveFamilies(item).forEach((family) => {
      expect(typeof family.form_id).toBe("number");
    });
  });

  it.each(
    mapsWithModes.filter(([, , , mode]) => (mode.type || "option") === "option")
  )(
    "%s / %s buckets what its classifier actually returns",
    (m, k, item, mode) => {
      // classifySite answers with exactly these three. A mode inventing its
      // own keys would colour every pin the no-data grey and still look
      // plausible.
      const keys = modeBuckets(mode).map((b) => b.key);
      expect(keys).toEqual(
        expect.arrayContaining([FUNCTIONAL, NON_FUNCTIONAL, UNKNOWN])
      );
      (mode.sources || []).forEach((source) => {
        expect(source.question_name).toBeTruthy();
        expect(source.functional_values?.length).toBeGreaterThan(0);
      });
    }
  );

  it.each(mapsWithModes.filter(([, , , mode]) => mode.type === "recency"))(
    "%s / %s ends its bands in a catch-all",
    (m, k, item, mode) => {
      const bands = mode.bands || [];
      expect(bands.length).toBeGreaterThan(0);
      // Without one, a site older than the last band falls through to
      // UNKNOWN and reads as never inspected.
      expect(typeof bands[bands.length - 1].max_months).not.toBe("number");
      bands.slice(0, -1).forEach((band) => {
        expect(typeof band.max_months).toBe("number");
      });
      (mode.sources || []).forEach((source) => {
        expect(source.question_name).toBeTruthy();
      });
    }
  );

  it.each(mapsWithModes.filter(([, , , mode]) => mode.type === "formula"))(
    "%s / %s resolves every family's rule to a formula",
    (m, k, item, mode) => {
      expect((mode.sources || []).length).toBeGreaterThan(0);
      (mode.sources || []).forEach((source) => {
        const formula = resolveFamilyFormula(source);
        expect(formula).not.toBeNull();
        expect(formula.buckets.length).toBeGreaterThan(0);
        // The endpoint rejects a formula with no default bucket.
        expect(formula.default).toBeTruthy();
      });
      const keys = modeBuckets(mode).map((b) => b.key);
      expect(keys).toEqual(
        expect.arrayContaining(["compliant", "non_compliant", UNKNOWN])
      );
    }
  );

  it.each(mapsWithModes)(
    "%s / %s has a unique mode key",
    (mapId, key, item) => {
      const keys = resolveModes(item).map((mode) => mode.key);
      expect(keys.filter((k) => k === key)).toHaveLength(1);
    }
  );
});
