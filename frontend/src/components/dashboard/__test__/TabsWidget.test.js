import React from "react";
import { render, screen, act, cleanup } from "@testing-library/react";
import TabsWidget from "../widgets/TabsWidget";
import store from "../../../lib/store";

const renderItems = (items) => (
  <div data-testid={`pane-children-${items?.[0]?.id || "empty"}`}>
    {items?.length || 0} child(ren)
  </div>
);

const buildItem = (panes) => ({ id: "tabs", chart_type: "tabs", items: panes });

const setIsLoggedIn = (value) => {
  act(() => {
    store.update((s) => {
      s.isLoggedIn = value;
    });
  });
};

describe("TabsWidget — is_public gating", () => {
  afterEach(() => {
    // Unmount before resetting store state so Pullstate's listeners on the
    // mounted TabsWidget do not fire a state-update outside an act() boundary.
    cleanup();
    setIsLoggedIn(false);
  });

  test("when anonymous, panes with is_public=false render as disabled tabs", () => {
    setIsLoggedIn(false);
    const item = buildItem([
      { id: "public_tab", label: "Public", items: [{ id: "a" }] },
      {
        id: "private_tab",
        label: "Private",
        is_public: false,
        items: [{ id: "b" }],
      },
    ]);

    render(<TabsWidget item={item} renderItems={renderItems} />);

    const privateTab = screen.getByRole("tab", { name: "Private" });
    expect(privateTab).toHaveAttribute("aria-disabled", "true");

    const publicTab = screen.getByRole("tab", { name: "Public" });
    expect(publicTab).not.toHaveAttribute("aria-disabled", "true");
  });

  test("when anonymous and the first pane is private, default-active falls through to the first enabled pane", () => {
    setIsLoggedIn(false);
    const item = buildItem([
      {
        id: "private_first",
        label: "Private",
        is_public: false,
        items: [{ id: "a" }],
      },
      { id: "public_second", label: "Public", items: [{ id: "b" }] },
    ]);

    render(<TabsWidget item={item} renderItems={renderItems} />);

    const publicTab = screen.getByRole("tab", { name: "Public" });
    expect(publicTab).toHaveAttribute("aria-selected", "true");
  });

  test("when signed in, is_public=false panes are not disabled", () => {
    setIsLoggedIn(true);
    const item = buildItem([
      { id: "public_tab", label: "Public", items: [{ id: "a" }] },
      {
        id: "private_tab",
        label: "Private",
        is_public: false,
        items: [{ id: "b" }],
      },
    ]);

    render(<TabsWidget item={item} renderItems={renderItems} />);

    const privateTab = screen.getByRole("tab", { name: "Private" });
    expect(privateTab).not.toHaveAttribute("aria-disabled", "true");
  });

  test("panes without is_public behave unchanged regardless of auth state", () => {
    setIsLoggedIn(false);
    const item = buildItem([
      { id: "tab_a", label: "A", items: [{ id: "a" }] },
      { id: "tab_b", label: "B", items: [{ id: "b" }] },
    ]);

    render(<TabsWidget item={item} renderItems={renderItems} />);

    const tabA = screen.getByRole("tab", { name: "A" });
    const tabB = screen.getByRole("tab", { name: "B" });
    expect(tabA).not.toHaveAttribute("aria-disabled", "true");
    expect(tabB).not.toHaveAttribute("aria-disabled", "true");
    expect(tabA).toHaveAttribute("aria-selected", "true");
  });
});
