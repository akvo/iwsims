import React from "react";
import { render, screen } from "@testing-library/react";
import CustomComponentWidget from "../widgets/CustomComponentWidget";

jest.mock("../custom-components", () => ({
  KnownComponent: ({ item, parentFormId }) => (
    <div
      data-testid="known-component"
      data-item-id={item.id}
      data-parent-form-id={parentFormId}
    >
      known component rendered
    </div>
  ),
}));

describe("CustomComponentWidget", () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test("renders the named component when present in the registry", () => {
    render(
      <CustomComponentWidget
        item={{ id: "ok-item", component: "KnownComponent" }}
        parentFormId={1749634736797}
      />
    );

    const component = screen.getByTestId("known-component");
    expect(component).toBeInTheDocument();
    expect(component).toHaveAttribute("data-item-id", "ok-item");
    expect(component).toHaveAttribute("data-parent-form-id", "1749634736797");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test("renders an Alert and logs an error when the component is unknown", () => {
    render(
      <CustomComponentWidget
        item={{ id: "missing-item", component: "DoesNotExist" }}
      />
    );

    expect(screen.queryByTestId("known-component")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Custom component "DoesNotExist" not found/)
    ).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("DoesNotExist");
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("missing-item");
  });
});
