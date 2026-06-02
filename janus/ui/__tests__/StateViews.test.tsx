import React from "react";
import { render, fireEvent, screen } from "@testing-library/react-native";
import { LoadingView, ErrorView, EmptyView } from "../components/StateViews";
import { NotAuthenticatedError, NetworkError } from "../../core/errors";

describe("StateViews", () => {
  it("LoadingView exposes an accessible progress label", () => {
    render(<LoadingView label="Loading feed" />);
    expect(screen.getByLabelText("Loading feed")).toBeTruthy();
  });

  it("ErrorView maps typed errors to human copy and retries", () => {
    const onRetry = jest.fn();
    render(<ErrorView error={new NotAuthenticatedError()} onRetry={onRetry} />);
    expect(screen.getByText("Sign in required")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("ErrorView maps network errors", () => {
    render(<ErrorView error={new NetworkError("down", 0)} />);
    expect(screen.getByText("Connection problem")).toBeTruthy();
  });

  it("EmptyView renders its title and detail", () => {
    render(<EmptyView title="Nothing here yet" detail="No posts." />);
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    expect(screen.getByText("No posts.")).toBeTruthy();
  });
});
