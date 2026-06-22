import React from "react";
import { render, screen } from "@testing-library/react";
import axios from "axios";
import RankingWidget, { rankRows } from "../RankingWidget";
import { __clearVisualizationCache } from "../../../../util/hooks/useVisualizationRequest";

jest.mock("axios");

const emptyFilters = {
  from_date: null,
  to_date: null,
  administration_id: null,
  custom: [],
};

const item = {
  id: "rank_recent",
  chart_type: "ranking",
  label: "Most recently monitored",
  api: {
    question_name: "inspection_date",
    sort: "desc",
    limit: 2,
    monitoring: "latest",
  },
};

beforeEach(() => {
  axios.mockReset();
  __clearVisualizationCache();
});

describe("rankRows", () => {
  test("sorts by date descending and applies limit", () => {
    const rows = rankRows(
      [
        { label: "A", value: "2025-01-10T00:00:00.000Z" },
        { label: "B", value: "2025-03-10T00:00:00.000Z" },
        { label: "C", value: "2024-12-01T00:00:00.000Z" },
      ],
      "desc",
      2
    );

    expect(rows.map((row) => row.label)).toEqual(["B", "A"]);
  });

  test("sorts by date ascending for needs-monitoring lists", () => {
    const rows = rankRows(
      [
        { label: "A", value: "2025-01-10T00:00:00.000Z" },
        { label: "B", value: "2025-03-10T00:00:00.000Z" },
      ],
      "asc",
      2
    );

    expect(rows.map((row) => row.label)).toEqual(["A", "B"]);
  });
});

describe("RankingWidget", () => {
  test("fetches parent rows, strips frontend ranking fields, and renders rows", async () => {
    axios.mockResolvedValueOnce({
      data: {
        data: [
          {
            group: "1",
            label: "Site Alpha",
            value: "2025-01-10T00:00:00.000Z",
          },
          {
            group: "2",
            label: "Site Beta",
            value: "2025-03-10T00:00:00.000Z",
          },
        ],
      },
    });

    render(
      <RankingWidget
        item={item}
        filterState={emptyFilters}
        parentFormId={1748903240763}
      />
    );

    expect(await screen.findByText("Site Beta")).toBeInTheDocument();
    expect(screen.getByText("Site Alpha")).toBeInTheDocument();

    const call = axios.mock.calls[0][0];
    expect(call.url).toBe("visualization/values");
    expect(call.params.question_name).toBe("inspection_date");
    expect(call.params.group_by).toBe("parent_id");
    expect(call.params.parent_form_id).toBe(1748903240763);
    expect(call.params.sort).toBeUndefined();
    expect(call.params.limit).toBeUndefined();
  });

  test("links each row to its control-center monitoring detail", async () => {
    axios.mockResolvedValueOnce({
      data: {
        data: [
          {
            group: "1",
            label: "Site Alpha",
            value: "2025-01-10T00:00:00.000Z",
          },
          { group: "2", label: "Site Beta", value: "2025-03-10T00:00:00.000Z" },
        ],
      },
    });

    render(
      <RankingWidget
        item={item}
        filterState={emptyFilters}
        parentFormId={1748903240763}
      />
    );

    const link = await screen.findByRole("link", { name: "Site Beta" });
    expect(link).toHaveAttribute(
      "href",
      "/control-center/data/1748903240763/monitoring/2"
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("renders plain text (no link) when no parent form id is available", async () => {
    axios.mockResolvedValueOnce({
      data: {
        data: [
          {
            group: "1",
            label: "Site Alpha",
            value: "2025-01-10T00:00:00.000Z",
          },
        ],
      },
    });

    render(<RankingWidget item={item} filterState={emptyFilters} />);

    expect(await screen.findByText("Site Alpha")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("shows the date question label, humanized from question_name", async () => {
    axios.mockResolvedValueOnce({
      data: {
        data: [
          {
            group: "1",
            label: "Site Alpha",
            value: "2025-01-10T00:00:00.000Z",
          },
        ],
      },
    });

    render(<RankingWidget item={item} filterState={emptyFilters} />);

    expect(await screen.findByText("Inspection date")).toBeInTheDocument();
  });

  test("prefers an explicit date_label over the humanized question_name", async () => {
    axios.mockResolvedValueOnce({
      data: {
        data: [
          {
            group: "1",
            label: "Site Alpha",
            value: "2025-01-10T00:00:00.000Z",
          },
        ],
      },
    });

    render(
      <RankingWidget
        item={{ ...item, date_label: "Last inspected" }}
        filterState={emptyFilters}
      />
    );

    expect(await screen.findByText("Last inspected")).toBeInTheDocument();
  });
});
