import { computeComplianceDonut } from "../complianceDonut";
import {
  getVisualizationConfigBySlug,
  listVisualizations,
} from "../../../../config/visualizations";

const value = (n) => ({ data: [{ value: n }] });

const SEGMENTS = [
  { key: "a__total", role: "total" },
  { key: "a__assessed", role: "assessed" },
  { key: "a__pass", role: "pass" },
  { key: "b__total", role: "total" },
  { key: "b__assessed", role: "assessed" },
  { key: "b__pass", role: "pass" },
];

describe("computeComplianceDonut", () => {
  it("derives failing and not-assessed rather than enumerating options", () => {
    // fail = assessed - pass, so an option added to a form later is counted as
    // a failure automatically instead of vanishing from the donut.
    const { rows, meta } = computeComplianceDonut(SEGMENTS, {
      a__total: value(100),
      a__assessed: value(80),
      a__pass: value(60),
      b__total: value(50),
      b__assessed: value(50),
      b__pass: value(40),
    });
    expect(rows).toEqual([
      { label: "Passing", value: 100 },
      { label: "Failing", value: 30 },
      { label: "Not assessed", value: 20 },
    ]);
    expect(meta).toMatchObject({
      pass: 100,
      fail: 30,
      notAssessed: 20,
      assessed: 130,
      total: 150,
    });
  });

  it("rates compliance against assessed sites, not the whole fleet", () => {
    // A domain measured on a tenth of its fleet with nothing failing is at
    // 100% compliance and 90% unmeasured — not 10% compliance.
    const { meta } = computeComplianceDonut(SEGMENTS.slice(0, 3), {
      a__total: value(100),
      a__assessed: value(10),
      a__pass: value(10),
    });
    expect(meta.passRate).toBe(100);
    expect(meta.notAssessed).toBe(90);
  });

  it("reports no rate at all when nothing has been assessed", () => {
    const { meta } = computeComplianceDonut(SEGMENTS.slice(0, 3), {
      a__total: value(100),
      a__assessed: value(0),
      a__pass: value(0),
    });
    expect(meta.passRate).toBeNull();
    expect(meta.notAssessed).toBe(100);
  });

  it("never renders a negative slice", () => {
    // The three counts are independent requests; one still in flight would
    // otherwise make a subtraction negative and punch a gap in the ring.
    const { rows } = computeComplianceDonut(SEGMENTS.slice(0, 3), {
      a__total: value(0),
      a__assessed: value(80),
      a__pass: value(100),
    });
    rows.forEach((row) => expect(row.value).toBeGreaterThanOrEqual(0));
  });

  it("treats a missing response as zero rather than crashing", () => {
    const { rows, meta } = computeComplianceDonut(SEGMENTS, {});
    expect(rows.map((r) => r.value)).toEqual([0, 0, 0]);
    expect(meta.passRate).toBeNull();
  });

  it("ignores a segment with an unrecognised role", () => {
    const { meta } = computeComplianceDonut(
      [...SEGMENTS.slice(0, 3), { key: "junk", role: "nonsense" }],
      {
        a__total: value(10),
        a__assessed: value(10),
        a__pass: value(5),
        junk: value(999),
      }
    );
    expect(meta.total).toBe(10);
    expect(meta.assessed).toBe(10);
  });

  it("honours configured slice labels", () => {
    const { rows } = computeComplianceDonut(
      SEGMENTS.slice(0, 3),
      { a__total: value(3), a__assessed: value(2), a__pass: value(1) },
      { pass: "Compliant", fail: "Non-compliant", notAssessed: "No data" }
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Compliant",
      "Non-compliant",
      "No data",
    ]);
  });

  it("sums every family in the domain", () => {
    const { meta } = computeComplianceDonut(SEGMENTS, {
      a__total: value(1),
      a__assessed: value(1),
      a__pass: value(1),
      b__total: value(2),
      b__assessed: value(2),
      b__pass: value(0),
    });
    expect(meta.total).toBe(3);
    expect(meta.pass).toBe(1);
    expect(meta.fail).toBe(2);
  });
});

describe("compliance donut configs", () => {
  const donuts = () =>
    listVisualizations().flatMap(({ slug }) => {
      const config = getVisualizationConfigBySlug(slug);
      const out = [];
      const walk = (items) =>
        (items || []).forEach((item) => {
          if (item.compute === "compliance_donut") {
            out.push({ slug, item });
          }
          walk(item.items);
        });
      walk(config.items);
      return out;
    });

  it("finds compliance donuts to check", () => {
    expect(donuts().length).toBeGreaterThan(0);
  });

  it.each(donuts().map(({ slug, item }) => [`${slug}/${item.id}`, item]))(
    "%s gives every family a total, an assessed and a pass segment",
    (_name, item) => {
      // A family missing its `total` still contributes passes and failures
      // while its unassessed sites vanish — the donut would look complete
      // and quietly understate the gap.
      const byFamily = {};
      item.segments.forEach((seg) => {
        const family = seg.key.split("__")[0];
        byFamily[family] = [...(byFamily[family] || []), seg.role];
      });
      Object.values(byFamily).forEach((roles) => {
        expect(roles.sort()).toEqual(["assessed", "pass", "total"]);
      });
    }
  );

  it.each(donuts().map(({ slug, item }) => [`${slug}/${item.id}`, item]))(
    "%s scopes every segment to a form and ignores the date filter",
    (_name, item) => {
      item.segments.forEach((seg) => {
        expect(typeof seg.api.parent_form_id).toBe("number");
        // A registered site does not stop existing outside the monitoring
        // window, so a date filter must not move the denominator.
        expect(seg.api.ignore_date_filter).toBe(true);
      });
    }
  );

  it.each(donuts().map(({ slug, item }) => [`${slug}/${item.id}`, item]))(
    "%s asks the same question for assessed and pass within a family",
    (_name, item) => {
      // pass must be a subset of assessed, which only holds if both count the
      // same question; otherwise `fail` is a difference of unrelated sets.
      const byFamily = {};
      item.segments.forEach((seg) => {
        const family = seg.key.split("__")[0];
        byFamily[family] = { ...(byFamily[family] || []), [seg.role]: seg.api };
      });
      Object.values(byFamily).forEach((roles) => {
        expect(roles.pass.question_name).toBe(roles.assessed.question_name);
        expect(roles.pass.option_value).toBeTruthy();
        expect(roles.assessed.option_value).toBeUndefined();
      });
    }
  );

  it.each(donuts().map(({ slug, item }) => [`${slug}/${item.id}`, item]))(
    "%s keys every segment uniquely",
    (_name, item) => {
      const keys = item.segments.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  );
});
