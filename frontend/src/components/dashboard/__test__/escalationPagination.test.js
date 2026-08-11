import React, { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import axios from "axios";
import { useDashboardEscalation } from "../../../util/hooks/useDashboardEscalation";
import { __clearVisualizationCache } from "../../../util/hooks/useVisualizationRequest";

jest.mock("axios");

const withCriteria = {
  id: "t",
  api: {
    form_id: 1748903240763,
    criteria: [
      { type: "threshold_gt", question_name: "x", value: 0, hide: false },
    ],
  },
  columns: [{ key: "name", source: "parent_name" }],
};

const noCriteria = {
  id: "t2",
  api: { form_id: 1748903240763 },
  columns: [{ key: "name", source: "parent_name" }],
};

const Probe = ({ item }) => {
  const [page, setPage] = useState(1);
  const { data } = useDashboardEscalation(item, {}, { page, pageSize: 10 });
  return (
    <div>
      <span data-testid="rows">{data?.results?.length ?? 0}</span>
      <button onClick={() => setPage(2)}>next</button>
    </div>
  );
};

beforeEach(() => {
  axios.mockReset();
  __clearVisualizationCache();
  axios.mockImplementation((cfg) =>
    Promise.resolve({
      data: {
        count: 764,
        results: new Array(10).fill({ id: cfg.params.page }),
      },
    })
  );
});

describe("escalation pagination", () => {
  it("fetches one page at a time rather than the whole table", async () => {
    render(<Probe item={withCriteria} />);
    await waitFor(() => expect(axios).toHaveBeenCalledTimes(1));
    expect(axios.mock.calls[0][0].params.page).toBe(1);
    expect(axios.mock.calls[0][0].params.page_size).toBe(10);

    fireEvent.click(screen.getByText("next"));
    await waitFor(() => expect(axios).toHaveBeenCalledTimes(2));
    expect(axios.mock.calls[1][0].params.page).toBe(2);

    // 764 rows exist; only 10 were ever requested, twice.
    expect(screen.getByTestId("rows").textContent).toBe("10");
  });

  it("omits criteria entirely for a whole-fleet table", async () => {
    // Sending a match-all criteria makes the backend materialise every parent
    // id per request instead of slicing the query, so the param must be absent
    // rather than blank.
    render(<Probe item={noCriteria} />);
    await waitFor(() => expect(axios).toHaveBeenCalledTimes(1));
    expect(axios.mock.calls[0][0].params).not.toHaveProperty("criteria");
  });
});
