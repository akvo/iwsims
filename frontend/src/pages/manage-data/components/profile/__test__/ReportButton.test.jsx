import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import axios from "axios";
import ReportButton from "../widgets/ReportButton";

jest.mock("axios");

const mockNavigate = jest.fn();
const mockNotify = jest.fn();

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock("../../../../../util/hooks", () => ({
  useNotification: () => ({ notify: mockNotify }),
}));

const text = {
  downloadReport: "Download Report",
  siteProfileReportQueued: "Report queued",
  downloadReportError: "Unable to download report",
};

beforeEach(() => {
  axios.mockReset();
  mockNavigate.mockReset();
  mockNotify.mockReset();
  // Two monitoring forms belong to 1748903240763; the third belongs elsewhere
  // and must not be included.
  window.forms = [
    { id: 1748905550055, content: { parent: 1748903240763 } },
    { id: 1748918946591, content: { parent: 1748903240763 } },
    { id: 1749611905372, content: { parent: 1749611049520 } },
  ];
});

describe("ReportButton", () => {
  it("requests the report for this datapoint with its monitoring forms", async () => {
    axios.mockResolvedValue({ data: { task_id: 1, file_url: "/x" } });

    render(
      <ReportButton
        parentId={13810928}
        parentFormId={1748903240763}
        text={text}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /download report/i }));

    await waitFor(() => expect(axios).toHaveBeenCalled());
    const url = axios.mock.calls[0][0].url || axios.mock.calls[0][0];
    expect(url).toContain("form_id=1748903240763");
    expect(url).toContain("selection_ids=13810928");
    // Monitoring answers only appear in the report when child forms are named.
    expect(url).toContain("child_form_ids=1748905550055");
    expect(url).toContain("child_form_ids=1748918946591");
    // A different family's monitoring form must not leak in.
    expect(url).not.toContain("1749611905372");
  });

  it("reports the job as queued and sends the user to Downloads", async () => {
    // The endpoint queues a job rather than streaming a file, so claiming the
    // download had completed would misrepresent what happened.
    axios.mockResolvedValue({ data: { task_id: 1 } });

    render(
      <ReportButton parentId={1} parentFormId={1748903240763} text={text} />
    );
    fireEvent.click(screen.getByRole("button", { name: /download report/i }));

    await waitFor(() => expect(mockNotify).toHaveBeenCalled());
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", message: "Report queued" })
    );
    expect(mockNavigate).toHaveBeenCalledWith("/downloads");
  });

  it("notifies on failure and stays on the page", async () => {
    axios.mockRejectedValue(new Error("boom"));

    render(
      <ReportButton parentId={1} parentFormId={1748903240763} text={text} />
    );
    fireEvent.click(screen.getByRole("button", { name: /download report/i }));

    await waitFor(() => expect(mockNotify).toHaveBeenCalled());
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" })
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders nothing without the ids it needs", () => {
    const { container } = render(<ReportButton text={text} />);
    expect(container).toBeEmptyDOMElement();
  });
});
