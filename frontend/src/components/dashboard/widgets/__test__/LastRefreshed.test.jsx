import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import LastRefreshed, { formatRefreshedAt } from "../LastRefreshed";

describe("formatRefreshedAt", () => {
  it("formats a date as weekday, date and 24h time", () => {
    // Weekday is included because the question a refresh stamp answers is
    // usually "was this today?". Month-first ordering matches the `en` locale
    // the rest of the app formats dates with (see RankingWidget) — one page
    // should not mix "Aug 11" and "11 Aug".
    const out = formatRefreshedAt(new Date("2026-08-11T22:14:00"));
    expect(out).toMatch(/^Tue, Aug 11, 2026 · \d{2}:\d{2}$/);
  });

  it("returns null for anything that is not a usable date", () => {
    expect(formatRefreshedAt(null)).toBeNull();
    expect(formatRefreshedAt("2026-08-11")).toBeNull();
    expect(formatRefreshedAt(new Date("nonsense"))).toBeNull();
  });
});

describe("LastRefreshed", () => {
  it("shows the stamp and calls onRefresh when clicked", () => {
    const onRefresh = jest.fn();
    render(
      <LastRefreshed
        refreshedAt={new Date("2026-08-11T22:14:00")}
        onRefresh={onRefresh}
      />
    );

    expect(screen.getByText(/Last refresh: Tue, Aug 11, 2026/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("still offers refresh when there is no stamp yet", () => {
    const onRefresh = jest.fn();
    render(<LastRefreshed onRefresh={onRefresh} />);

    expect(screen.queryByText(/Last refresh/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeVisible();
  });
});
