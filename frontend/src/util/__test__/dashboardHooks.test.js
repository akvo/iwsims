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
      { type: "option_equals", question_id: 1, value: "no" },
      { type: "threshold_gt", question_id: 2, value: 5 },
      { type: "overdue", completion_qid: 10, deadline_qid: 11 },
    ]);
    expect(out).toBe("option_equals:1:no,threshold_gt:2:5,overdue:10:11");
  });

  test("skips hidden criteria", () => {
    const out = serializeCriteria([
      { type: "option_equals", question_id: 1, value: "no", hide: true },
      { type: "option_equals", question_id: 2, value: "yes" },
    ]);
    expect(out).toBe("option_equals:2:yes");
  });
});

describe("serializeColumns", () => {
  test("emits source-specific formats and skips computed/hidden", () => {
    const out = serializeColumns([
      { key: "name", source: "parent_name" },
      { key: "village", source: "parent_answer", question_id: 10 },
      { key: "admin", source: "administration" },
      { key: "status", source: "answer", question_id: 20 },
      { key: "date", source: "latest_date", question_id: 30 },
      { key: "progress", computed: true },
      { key: "secret", source: "answer", question_id: 99, hide: true },
    ]);
    expect(out).toBe(
      "name:parent_name,village:parent_answer:10,admin:administration,status:answer:20,date:latest_date:30"
    );
  });
});

describe("serializeComponents", () => {
  test("formats formula:qid1:qid2... with optional total_items", () => {
    const out = serializeComponents([
      { key: "concrete", formula: "any_yes", question_ids: [1, 2, 3] },
      { key: "urf", formula: "completed_binary", question_ids: [10] },
      { key: "pipes", formula: "ratio", question_ids: [20, 21] },
      {
        key: "security",
        formula: "multi_select_proportion",
        question_ids: [30],
        total_items: 3,
      },
      {
        key: "hidden",
        formula: "completed_binary",
        question_ids: [99],
        hide: true,
      },
    ]);
    expect(out).toBe(
      "concrete:any_yes:1:2:3,urf:completed_binary:10,pipes:ratio:20:21,security:multi_select_proportion:30:3"
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
        form_id: 1749623934933,
        monitoring_form_id: 1749632545233,
        criteria: [
          { type: "option_equals", question_id: 1749632647507, value: "no" },
        ],
      },
      columns: [
        { key: "name", source: "parent_name" },
        { key: "village", source: "parent_answer", question_id: 1749624452991 },
      ],
    };

    const { latest } = mount(() =>
      useDashboardEscalation(block, emptyFilters, { page: 2, pageSize: 50 })
    );

    await waitFor(() => expect(latest().loading).toBe(false));

    const call = axios.mock.calls[0][0];
    expect(call.url).toBe("visualization/escalation/1749623934933");
    expect(call.params.criteria).toBe("option_equals:1749632647507:no");
    expect(call.params.columns).toBe(
      "name:parent_name,village:parent_answer:1749624452991"
    );
    expect(call.params.page).toBe(2);
    expect(call.params.page_size).toBe(50);
  });
});

describe("useDashboardProgress", () => {
  test("fetches /visualization/progress/{formId} with serialized components", async () => {
    axios.mockResolvedValue({ data: { histogram: [], details: [] } });

    const block = {
      deadline_question_id: 1749630516825,
      api: {
        form_id: 1749623934933,
        monitoring_form_id: 1749624452908,
        filter_question_id: 1749630516826,
        filter_option_value: "no",
        components: [
          { key: "urf", formula: "completed_binary", question_ids: [1] },
          { key: "pipes", formula: "ratio", question_ids: [2, 3] },
        ],
      },
    };

    const { latest } = mount(() => useDashboardProgress(block, emptyFilters));

    await waitFor(() => expect(latest().loading).toBe(false));

    const call = axios.mock.calls[0][0];
    expect(call.url).toBe("visualization/progress/1749623934933");
    expect(call.params.components).toBe(
      "urf:completed_binary:1,pipes:ratio:2:3"
    );
    expect(call.params.filter_option_value).toBe("no");
    expect(call.params.deadline_question_id).toBe(1749630516825);
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
