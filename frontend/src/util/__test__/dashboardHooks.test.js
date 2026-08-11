import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import axios from "axios";
import {
  useDashboardValues,
  useDashboardEscalation,
  useDashboardProgress,
} from "../hooks";
import {
  serializeCriteria,
  serializeColumns,
} from "../../util/hooks/useDashboardEscalation";
import { serializeComponents } from "../../util/hooks/useDashboardProgress";
import {
  __clearVisualizationCache,
  __visualizationCacheStats,
} from "../../util/hooks/useVisualizationRequest";

jest.mock("axios");

const today = new Date(Date.UTC(2026, 3, 14)); // 2026-04-14

const emptyFilters = {
  from_date: null,
  to_date: null,
  administration_id: null,
  custom: [],
};

beforeEach(() => {
  axios.mockReset();
  __clearVisualizationCache();
});

describe("serializeCriteria", () => {
  test("formats option_equals, threshold_gt, and overdue entries", () => {
    const out = serializeCriteria([
      { type: "option_equals", question_name: "ph", value: "no" },
      { type: "threshold_gt", question_name: "bod", value: 5 },
      {
        type: "overdue",
        completion_qname: "is_done",
        deadline_qname: "due_date",
      },
    ]);
    expect(out).toBe(
      "option_equals:ph:no,threshold_gt:bod:5,overdue:is_done:due_date:no:option"
    );
  });

  test("skips hidden criteria", () => {
    const out = serializeCriteria([
      { type: "option_equals", question_name: "ph", value: "no", hide: true },
      { type: "option_equals", question_name: "status", value: "yes" },
    ]);
    expect(out).toBe("option_equals:status:yes");
  });
});

describe("serializeColumns", () => {
  test("emits source-specific formats and skips computed/hidden", () => {
    const out = serializeColumns([
      { key: "name", source: "parent_name" },
      { key: "village", source: "parent_answer", question_name: "village" },
      { key: "admin", source: "administration" },
      { key: "status", source: "answer", question_name: "status" },
      { key: "date", source: "latest_date", question_name: "inspected_at" },
      { key: "progress", computed: true },
      { key: "secret", source: "answer", question_name: "secret", hide: true },
    ]);
    expect(out).toBe(
      "name:parent_name,village:parent_answer:village,admin:administration,status:answer:status,date:latest_date:inspected_at"
    );
  });
});

describe("serializeComponents", () => {
  test("formats formula:qid1:qid2... with optional total_items", () => {
    const out = serializeComponents([
      { key: "concrete", formula: "any_yes", question_names: ["a", "b", "c"] },
      { key: "urf", formula: "completed_binary", question_names: ["d"] },
      { key: "pipes", formula: "ratio", question_names: ["impl", "plan"] },
      {
        key: "security",
        formula: "multi_select_proportion",
        question_names: ["sec"],
        total_items: 3,
      },
      {
        key: "hidden",
        formula: "completed_binary",
        question_names: ["x"],
        hide: true,
      },
    ]);
    expect(out).toBe(
      "concrete:any_yes:a:b:c,urf:completed_binary:d,pipes:ratio:impl:plan,security:multi_select_proportion:sec:3"
    );
  });
});

const HookProbe = ({ render: renderHook, onResult }) => {
  const r = renderHook();
  onResult(r);
  return null;
};

const mount = (renderHook) => {
  let latest;
  const utils = render(
    <HookProbe
      render={renderHook}
      onResult={(r) => {
        latest = r;
      }}
    />
  );
  return { latest: () => latest, ...utils };
};

describe("useDashboardValues", () => {
  test("fetches /visualization/values with expanded hints + merged filters", async () => {
    axios.mockResolvedValue({
      data: { data: [{ value: 42 }], labels: ["Total"] },
    });

    const apiBlock = {
      form_id: 1749632545233,
      monitoring: "latest",
      sum_by: "parent_id",
      value_type: "percentage",
      date_question_id: 1749632545235,
      rolling_months: 12,
    };

    const { latest } = mount(() =>
      useDashboardValues(apiBlock, emptyFilters, { today })
    );

    await waitFor(() => expect(latest().loading).toBe(false));

    expect(axios).toHaveBeenCalledTimes(1);
    const call = axios.mock.calls[0][0];
    expect(call.url).toBe("visualization/values");
    expect(call.params.from_date).toBe("2025-04-14");
    expect(call.params.to_date).toBe("2026-04-14");
    expect(call.params.rolling_months).toBeUndefined();
    expect(latest().data.data[0].value).toBe(42);
  });

  test("adds parent_form_id when parentFormId option is provided", async () => {
    axios.mockResolvedValue({
      data: { data: [{ value: 7 }], labels: ["WTP"] },
    });

    const { latest } = mount(() =>
      useDashboardValues(
        {
          form_id: 1749634736797,
          question_name: "water_testing_method",
          group_by: "option",
        },
        emptyFilters,
        {
          today,
          parentFormId: 1748903240763,
        }
      )
    );

    await waitFor(() => expect(latest().loading).toBe(false));

    const call = axios.mock.calls[0][0];
    expect(call.url).toBe("visualization/values");
    expect(call.params.question_name).toBe("water_testing_method");
    expect(call.params.parent_form_id).toBe(1748903240763);
  });

  test("an api block's own parent_form_id wins over the dashboard root", async () => {
    // Cross-asset dashboards (National Overview) have no single root form:
    // each segment queries a different registration family and names it in its
    // own api block, so the root must not overwrite it.
    axios.mockResolvedValue({ data: { data: [{ value: 3 }] } });

    const { latest } = mount(() =>
      useDashboardValues(
        {
          parent_form_id: 1749611049520,
          question_name: "inspection_date",
          sum_by: "parent_id",
        },
        emptyFilters,
        { today, parentFormId: 1748903240763 }
      )
    );

    await waitFor(() => expect(latest().loading).toBe(false));

    expect(axios.mock.calls[0][0].params.parent_form_id).toBe(1749611049520);
  });

  test("omits parent_form_id entirely when neither root nor api supplies one", async () => {
    axios.mockResolvedValue({ data: { data: [] } });

    const { latest } = mount(() =>
      useDashboardValues(
        { question_name: "inspection_date", sum_by: "parent_id" },
        emptyFilters,
        { today }
      )
    );

    await waitFor(() => expect(latest().loading).toBe(false));

    expect(axios.mock.calls[0][0].params.parent_form_id).toBeUndefined();
  });

  test("deduplicates concurrent requests with the same params", async () => {
    axios.mockResolvedValue({ data: { data: [] } });

    const apiBlock = { form_id: 1 };
    mount(() => useDashboardValues(apiBlock, emptyFilters, { today }));
    mount(() => useDashboardValues(apiBlock, emptyFilters, { today }));

    await waitFor(() => expect(axios).toHaveBeenCalledTimes(1));
  });

  test("does not fetch when enabled=false", async () => {
    axios.mockResolvedValue({ data: {} });
    mount(() =>
      useDashboardValues({ form_id: 1 }, emptyFilters, {
        today,
        enabled: false,
      })
    );
    await act(() => Promise.resolve());
    expect(axios).not.toHaveBeenCalled();
  });

  test("surfaces axios errors via error field", async () => {
    const err = new Error("boom");
    axios.mockRejectedValue(err);
    const { latest } = mount(() =>
      useDashboardValues({ form_id: 1 }, emptyFilters, { today })
    );
    await waitFor(() => expect(latest().loading).toBe(false));
    expect(latest().error).toBe(err);
    expect(latest().data).toBeNull();
  });
});

describe("useDashboardEscalation", () => {
  test("fetches /visualization/escalation/{formId} with serialized criteria + columns", async () => {
    axios.mockResolvedValue({ data: { count: 0, results: [] } });

    const block = {
      api: {
        monitoring_form_id: 1749632545233,
        criteria: [
          {
            type: "option_equals",
            question_name: "can_take_sample",
            value: "no",
          },
        ],
      },
      columns: [
        { key: "name", source: "parent_name" },
        {
          key: "village",
          source: "parent_answer",
          question_name: "village_name",
        },
      ],
    };

    const { latest } = mount(() =>
      useDashboardEscalation(block, emptyFilters, {
        page: 2,
        pageSize: 50,
        parentFormId: 1749623934933,
      })
    );

    await waitFor(() => expect(latest().loading).toBe(false));

    const call = axios.mock.calls[0][0];
    expect(call.url).toBe("visualization/escalation/1749623934933");
    expect(call.params.criteria).toBe("option_equals:can_take_sample:no");
    expect(call.params.columns).toBe(
      "name:parent_name,village:parent_answer:village_name"
    );
    expect(call.params.page).toBe(2);
    expect(call.params.page_size).toBe(50);
  });
});

describe("useDashboardProgress", () => {
  test("fetches /visualization/progress/{formId} with serialized components", async () => {
    axios.mockResolvedValue({ data: { histogram: [], details: [] } });

    const block = {
      deadline_question_name: "proposed_completion_date",
      api: {
        monitoring_form_id: 1749624452908,
        filter_question_name: "is_project_completed",
        filter_option_value: "no",
      },
      components: [
        { key: "urf", formula: "completed_binary", question_names: ["urf"] },
        { key: "pipes", formula: "ratio", question_names: ["impl", "plan"] },
      ],
    };

    const { latest } = mount(() =>
      useDashboardProgress(block, emptyFilters, {
        parentFormId: 1749623934933,
      })
    );

    await waitFor(() => expect(latest().loading).toBe(false));

    const call = axios.mock.calls[0][0];
    expect(call.url).toBe("visualization/progress/1749623934933");
    expect(call.params.components).toBe(
      "urf:completed_binary:urf,pipes:ratio:impl:plan"
    );
    expect(call.params.filter_option_value).toBe("no");
    expect(call.params.deadline_question_name).toBe("proposed_completion_date");
  });
});

describe("useVisualizationRequest cache (LRU)", () => {
  test("evicts the oldest entry when the cache is full", async () => {
    axios.mockResolvedValue({ data: { data: [{ value: 1 }] } });
    const stats = __visualizationCacheStats();
    const max = stats.max;

    // Fill to capacity with `max` distinct param sets, each one becoming a
    // unique cache key. Use direct fetches to bypass React lifecycle noise.
    const fetchOnce = (i) =>
      mount(() =>
        useDashboardValues({ form_id: 1, question_id: i }, emptyFilters, {
          today,
        })
      );

    for (let i = 0; i < max; i += 1) {
      fetchOnce(i);
    }
    await waitFor(() => expect(__visualizationCacheStats().size).toBe(max));

    const oldestKey = __visualizationCacheStats().keys[0];

    // Push one more entry over the cap → triggers eviction of the oldest.
    fetchOnce(max);
    await waitFor(() => expect(__visualizationCacheStats().size).toBe(max));
    expect(__visualizationCacheStats().keys).not.toContain(oldestKey);
  });
});
