import { getVisualizationConfigBySlug, listVisualizations } from "../index";

/**
 * A score histogram's axis either implies a denominator or it does not, and
 * the two flags that decide it live apart: `partial` picks the population,
 * `label_suffix` prints the fraction. Set only one and the chart still
 * renders — it just says "2/8" about a plant that was asked two questions,
 * or drops a third of the fleet to protect a denominator it no longer shows.
 */

const histograms = listVisualizations().flatMap(({ slug }) => {
  const config = getVisualizationConfigBySlug(slug);
  return (config?.items || [])
    .filter((i) => i.compute === "score_histogram")
    .map((item) => [`${slug}#${item.id}`, item]);
});

const DENOMINATOR_PHRASE = /out of \d|\/\s*\d/i;

describe("score_histogram configs", () => {
  it("finds the histograms to check", () => {
    expect(histograms.length).toBeGreaterThan(0);
  });

  it.each(histograms)(
    "%s does not print a fraction over a partial population",
    (id, item) => {
      if (item.display?.partial) {
        expect(item.display.label_suffix).toBeFalsy();
      }
    }
  );

  it.each(histograms)(
    "%s keeps its axis wording and its population in step",
    (id, item) => {
      // An axis reading "out of 8" makes a claim about all eight checks, so
      // it may only describe entities that answered all eight.
      const wording = [item.config?.title, item.config?.xAxisLabel]
        .filter(Boolean)
        .join(" ");
      if (item.display?.partial) {
        expect(wording).not.toMatch(DENOMINATOR_PHRASE);
      }
    }
  );

  it.each(histograms)("%s scores against real segments", (id, item) => {
    expect(item.segments?.length).toBeGreaterThan(0);
    item.segments.forEach((segment) => {
      expect(segment.key).toBeTruthy();
      // Without it the segment silently defaults to "yes", which is wrong for
      // an inverted check such as urgent_maintenance_programs.
      expect(segment.pass_value).toBeTruthy();
      expect(segment.api?.group_by).toBe("parent_id");
    });
  });
});
