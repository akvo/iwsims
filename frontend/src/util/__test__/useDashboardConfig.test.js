/* eslint-disable no-console, no-undefined */
import React from "react";
import { render } from "@testing-library/react";
import { useDashboardConfig } from "../hooks";
import {
  getVisualizationConfigBySlug,
  listVisualizations,
} from "../../config/visualizations";

/**
 * Minimal harness that captures the hook's return value for each render.
 * Avoids @testing-library/react-hooks (not in deps; RTL v12).
 */
const HookProbe = ({ slug, onResult }) => {
  const result = useDashboardConfig(slug);
  onResult(result);
  return null;
};

describe("config/visualizations registry", () => {
  test("registers the EPS Overview config under its slug", () => {
    const entries = listVisualizations();
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "eps-overview",
          name: "EPS Overview",
          parent_form_id: 1749623934933,
        }),
      ])
    );
  });

  test("getVisualizationConfigBySlug returns the EPS config for the matching slug", () => {
    const config = getVisualizationConfigBySlug("eps-overview");
    expect(config).not.toBeNull();
    expect(config.name).toBe("EPS Overview");
    expect(config.parent_form_id).toBe(1749623934933);
    // Flat schema: top-level `items[]` with a `tabs` container holding 4 panes
    // (Monitoring overview, Water quality, Construction monitoring,
    // Individual Overview — the latter is gated by `is_public: false`).
    expect(Array.isArray(config.items)).toBe(true);
    const tabsItem = config.items.find((it) => it.chart_type === "tabs");
    expect(tabsItem).toBeDefined();
    expect(tabsItem.items).toHaveLength(4);
    const individualTab = tabsItem.items.find(
      (pane) => pane.id === "tab_individual_overview"
    );
    expect(individualTab).toBeDefined();
    expect(individualTab.is_public).toBe(false);
    // Collect every item id recursively, assert key KPI cards are present.
    const allIds = [];
    const walk = (items = []) => {
      items.forEach((it) => {
        if (it.id) {
          allIds.push(it.id);
        }
        if (Array.isArray(it.items)) {
          walk(it.items);
        }
      });
    };
    walk(config.items);
    expect(allIds).toEqual(
      expect.arrayContaining([
        "kpi_total_registered",
        "kpi_under_construction",
        "kpi_under_construction_pct",
        "kpi_lab_tested",
        "kpi_cbt_tested",
        "kpi_monitored_last_12_months",
        "kpi_water_sample_last_12_months",
        "kpi_construction_past_due",
      ])
    );
  });

  test("getVisualizationConfigBySlug returns null for unknown slugs", () => {
    expect(getVisualizationConfigBySlug("does-not-exist")).toBeNull();
  });

  test("getVisualizationConfigBySlug returns null for falsy input", () => {
    expect(getVisualizationConfigBySlug("")).toBeNull();
    expect(getVisualizationConfigBySlug(undefined)).toBeNull();
    expect(getVisualizationConfigBySlug(null)).toBeNull();
  });
});

describe("useDashboardConfig", () => {
  const originalWarn = console.warn;
  beforeEach(() => {
    console.warn = jest.fn();
  });
  afterEach(() => {
    console.warn = originalWarn;
  });

  test("returns { config, loading: false, error: null } for a known slug", () => {
    let latest;
    render(
      <HookProbe
        slug="eps-overview"
        onResult={(r) => {
          latest = r;
        }}
      />
    );
    expect(latest.loading).toBe(false);
    expect(latest.error).toBeNull();
    expect(latest.config).not.toBeNull();
    expect(latest.config.name).toBe("EPS Overview");
  });

  test("returns { config: null } and warns for an unknown slug", () => {
    let latest;
    render(
      <HookProbe
        slug="does-not-exist"
        onResult={(r) => {
          latest = r;
        }}
      />
    );
    expect(latest.config).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  test("returns { config: null } without warning when slug is falsy", () => {
    let latest;
    render(
      <HookProbe
        slug={undefined}
        onResult={(r) => {
          latest = r;
        }}
      />
    );
    expect(latest.config).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("memoizes across renders with the same slug", () => {
    let first;
    let second;
    const { rerender } = render(
      <HookProbe
        slug="eps-overview"
        onResult={(r) => {
          first = r;
        }}
      />
    );
    rerender(
      <HookProbe
        slug="eps-overview"
        onResult={(r) => {
          second = r;
        }}
      />
    );
    expect(second.config).toBe(first.config);
  });
});
