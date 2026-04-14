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
    expect(config.tabs).toHaveLength(3);
    expect(Object.keys(config.kpis)).toEqual(
      expect.arrayContaining([
        "total_registered",
        "under_construction",
        "under_construction_pct",
        "lab_tested",
        "cbt_tested",
        "monitored_last_12_months",
        "water_sample_last_12_months",
        "construction_past_due",
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
