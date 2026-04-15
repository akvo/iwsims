import React from "react";
import { act, render } from "@testing-library/react";
import { useDashboardFilters } from "../hooks";

const config = {
  items: [
    {
      id: "filters_main",
      chart_type: "filter_bar",
      items: [
        {
          id: "filter_water_committee",
          chart_type: "filter_option",
          key: "water_committee",
          form_id: 1,
          question_id: 10,
        },
        {
          id: "filter_implementing_agency",
          chart_type: "filter_multi_option",
          key: "implementing_agency",
          form_id: 1,
          question_id: 11,
        },
      ],
    },
  ],
};

const HookProbe = ({ onResult, config: c = config }) => {
  const filters = useDashboardFilters(c);
  onResult(filters);
  return null;
};

const mount = () => {
  let latest;
  const utils = render(
    <HookProbe
      onResult={(r) => {
        latest = r;
      }}
    />
  );
  return Object.assign(() => latest, utils);
};

describe("useDashboardFilters", () => {
  test("initial state has null dates and null custom values derived from config", () => {
    const latest = mount();
    const { state } = latest();
    expect(state.from_date).toBeNull();
    expect(state.to_date).toBeNull();
    expect(state.administration_id).toBeNull();
    expect(state.custom).toEqual([
      { key: "water_committee", value: null },
      { key: "implementing_agency", value: null },
    ]);
  });

  test("setDateRange updates both from_date and to_date", () => {
    const latest = mount();
    act(() => {
      latest().setDateRange("2026-01-01", "2026-03-31");
    });
    expect(latest().state.from_date).toBe("2026-01-01");
    expect(latest().state.to_date).toBe("2026-03-31");
  });

  test("setAdministrationId updates administration_id", () => {
    const latest = mount();
    act(() => {
      latest().setAdministrationId(42);
    });
    expect(latest().state.administration_id).toBe(42);
  });

  test("setCustomFilter only mutates the targeted key", () => {
    const latest = mount();
    act(() => {
      latest().setCustomFilter("water_committee", "yes");
    });
    const custom = latest().state.custom;
    expect(custom.find((c) => c.key === "water_committee").value).toBe("yes");
    expect(
      custom.find((c) => c.key === "implementing_agency").value
    ).toBeNull();
  });

  test("resetFilters restores initial shape", () => {
    const latest = mount();
    act(() => {
      latest().setDateRange("2026-01-01", "2026-03-31");
      latest().setAdministrationId(42);
      latest().setCustomFilter("water_committee", "yes");
    });
    act(() => {
      latest().resetFilters();
    });
    const { state } = latest();
    expect(state.from_date).toBeNull();
    expect(state.to_date).toBeNull();
    expect(state.administration_id).toBeNull();
    expect(state.custom.every((c) => c.value === null)).toBe(true);
  });

  test("queryParams identity changes when state changes", () => {
    const latest = mount();
    const first = latest().queryParams;
    act(() => {
      latest().setAdministrationId(7);
    });
    expect(latest().queryParams).not.toBe(first);
    expect(latest().queryParams.administration_id).toBe(7);
  });

  test("re-initialises state when the config (formId) changes", () => {
    const configA = {
      parent_form_id: 100,
      items: [
        {
          id: "fb_a",
          chart_type: "filter_bar",
          items: [
            {
              id: "filter_alpha",
              chart_type: "filter_option",
              key: "alpha",
              form_id: 100,
              question_id: 1,
            },
          ],
        },
      ],
    };
    const configB = {
      parent_form_id: 200,
      items: [
        {
          id: "fb_b",
          chart_type: "filter_bar",
          items: [
            {
              id: "filter_beta",
              chart_type: "filter_option",
              key: "beta",
              form_id: 200,
              question_id: 2,
            },
          ],
        },
      ],
    };
    let latest;
    const { rerender } = render(
      <HookProbe
        config={configA}
        onResult={(r) => {
          latest = r;
        }}
      />
    );
    act(() => {
      latest.setDateRange("2026-01-01", "2026-03-31");
      latest.setAdministrationId(42);
      latest.setCustomFilter("alpha", "x");
    });
    expect(latest.state.from_date).toBe("2026-01-01");
    expect(latest.state.custom).toEqual([{ key: "alpha", value: "x" }]);

    rerender(
      <HookProbe
        config={configB}
        onResult={(r) => {
          latest = r;
        }}
      />
    );
    // State reset to configB's shape; previous values dropped.
    expect(latest.state.from_date).toBeNull();
    expect(latest.state.to_date).toBeNull();
    expect(latest.state.administration_id).toBeNull();
    expect(latest.state.custom).toEqual([{ key: "beta", value: null }]);
  });
});
