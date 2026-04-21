/* eslint-disable no-console, no-undefined */
import React from "react";
import { render } from "@testing-library/react";
import { useDashboardConfig } from "../hooks";
import {
  getVisualizationConfig,
  listVisualizationFormIds,
} from "../../config/visualizations";

/**
 * Minimal harness that captures the hook's return value for each render.
 * Avoids @testing-library/react-hooks (not in deps; RTL v12).
 */
const HookProbe = ({ formId, onResult }) => {
  const result = useDashboardConfig(formId);
  onResult(result);
  return null;
};

describe("config/visualizations registry", () => {
  test("registers the EPS Overview config under its parent_form_id", () => {
    const ids = listVisualizationFormIds();
    expect(ids).toContain(1749623934933);
  });

  test("getVisualizationConfig returns the EPS config when passed the matching id", () => {
    const config = getVisualizationConfig(1749623934933);
    expect(config).not.toBeNull();
    expect(config.name).toBe("EPS Overview");
    // Flat schema: top-level `items[]` with a `tabs` container holding 3 panes.
    expect(Array.isArray(config.items)).toBe(true);
    const tabsItem = config.items.find((it) => it.chart_type === "tabs");
    expect(tabsItem).toBeDefined();
    expect(tabsItem.items).toHaveLength(3);
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

  test("getVisualizationConfig accepts numeric strings (route params)", () => {
    const config = getVisualizationConfig("1749623934933");
    expect(config).not.toBeNull();
    expect(config.parent_form_id).toBe(1749623934933);
  });

  test("getVisualizationConfig returns null for unknown ids", () => {
    expect(getVisualizationConfig(99999)).toBeNull();
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

  test("returns { config, loading: false, error: null } for a known formId", () => {
    let latest;
    render(
      <HookProbe
        formId={1749623934933}
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

  test("returns { config: null } and warns for an unknown formId", () => {
    let latest;
    render(
      <HookProbe
        formId={42}
        onResult={(r) => {
          latest = r;
        }}
      />
    );
    expect(latest.config).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  test("returns { config: null } without warning when formId is falsy", () => {
    let latest;
    render(
      <HookProbe
        formId={undefined}
        onResult={(r) => {
          latest = r;
        }}
      />
    );
    expect(latest.config).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("memoizes across renders with the same formId", () => {
    let first;
    let second;
    const { rerender } = render(
      <HookProbe
        formId={1749623934933}
        onResult={(r) => {
          first = r;
        }}
      />
    );
    rerender(
      <HookProbe
        formId={1749623934933}
        onResult={(r) => {
          second = r;
        }}
      />
    );
    expect(second.config).toBe(first.config);
  });
});
