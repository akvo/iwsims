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

describe("RankingWidget date rendering", () => {
  test("renders the formatted inspection date for each row", async () => {
    // Row shape copied verbatim from GET /visualization/values for the WWTP
    // rankings (question_name=inspection_date, group_by=parent_id).
    axios.mockResolvedValueOnce({
      data: {
        data: [
          {
            group: "243250955",
            label: "FLOW-243250955 - Votua WWTP - Western",
            value: "2026-01-21T02:28:04.481Z",
          },
          {
            group: "13840931",
            label: "FLOW-13840931 - ACS  STP - Central",
            value: "2016-07-20T00:00:00Z",
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

    expect(
      await screen.findByText("FLOW-243250955 - Votua WWTP - Western")
    ).toBeInTheDocument();
    expect(screen.getByText("Jan 21, 2026")).toBeInTheDocument();
    expect(screen.getByText("Jul 20, 2016")).toBeInTheDocument();
    expect(screen.queryByText("No date")).not.toBeInTheDocument();
  });
});

describe("RankingWidget table columns", () => {
  const rows = {
    data: {
      data: [
        {
          group: "1",
          label: "Votua WWTP",
          value: "2026-06-01T00:00:00.000Z",
        },
      ],
    },
  };
  // Fixed "today" so elapsed assertions do not drift with the clock.
  const today = new Date("2026-08-11T00:00:00.000Z");

  test("renders entity, date and Days ago columns by default", async () => {
    axios.mockResolvedValueOnce(rows);
    render(
      <RankingWidget
        item={{ ...item, entity_label: "Plant", date_label: "Last inspected" }}
        filterState={emptyFilters}
        parentFormId={1748903240763}
        today={today}
      />
    );

    expect(await screen.findByText("Votua WWTP")).toBeInTheDocument();
    expect(screen.getByText("Plant")).toBeInTheDocument();
    expect(screen.getByText("Last inspected")).toBeInTheDocument();
    expect(screen.getByText("Days ago")).toBeInTheDocument();
    expect(screen.getByText("71")).toBeInTheDocument(); // 1 Jun -> 11 Aug
  });

  test("switches to whole calendar Months ago when elapsed_unit is months", async () => {
    axios.mockResolvedValueOnce(rows);
    render(
      <RankingWidget
        item={{ ...item, elapsed_unit: "months" }}
        filterState={emptyFilters}
        parentFormId={1748903240763}
        today={today}
      />
    );

    expect(await screen.findByText("Votua WWTP")).toBeInTheDocument();
    expect(screen.getByText("Months ago")).toBeInTheDocument();
    // 1 Jun -> 11 Aug is 2 whole months, not 71/30 rounded to 2.4.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("Days ago")).not.toBeInTheDocument();
  });
});
