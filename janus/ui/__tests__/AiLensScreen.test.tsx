import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import { AiLensScreen } from "../screens/AiLensScreen";
import { setPangramState } from "../../app/pangramModel";
import { getAiLensPolicy } from "../../app/aiLensPolicy";
import { mockNavigation, mockRoute } from "./testUtils";

const renderScreen = () =>
  render(
    <AiLensScreen
      navigation={mockNavigation as never}
      route={mockRoute() as never}
    />,
  );

describe("AiLensScreen", () => {
  it("walks the gate → token → download steps when nothing is installed", () => {
    const { getByText, getByLabelText } = renderScreen();
    getByText("Accept the license on Hugging Face");
    getByText("Paste a read token");
    getByText("Download the model");
    getByLabelText("Open the model page");
    // Download is disabled until a token is saved.
    const btn = getByLabelText("Download and install the model");
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it("preempts the manual-approval wait (days, sometimes weeks)", () => {
    const { getByText } = renderScreen();
    getByText(/approves requests by hand/);
    getByText(/sometimes\s+weeks/);
    getByText(/Save your token below now/);
  });

  it("shows the policy ladder once installed and persists chip taps", () => {
    setPangramState({ phase: "ready", sha: "abc1234def", numLabels: 4 });
    const { getByText, getByLabelText } = renderScreen();
    getByText("WHAT A VERDICT DOES");
    getByText("Fully AI-generated");
    fireEvent.press(getByLabelText("Fully AI-generated: Fold"));
    expect(getAiLensPolicy().full).toBe("collapse");
    fireEvent.press(getByLabelText("Moderately AI-assisted: Dim"));
    expect(getAiLensPolicy()).toMatchObject({
      full: "collapse",
      moderate: "dim",
      light: "label",
    });
  });

  it("offers automatic-check modes once installed and persists the choice", () => {
    setPangramState({ phase: "ready", sha: "abc1234def", numLabels: 4 });
    const { getByText, getByLabelText } = renderScreen();
    getByText("AUTOMATIC CHECKS");
    fireEvent.press(getByLabelText("Automatic checks: Open thread"));
    expect(getAiLensPolicy().auto).toBe("threads");
    fireEvent.press(getByLabelText("Automatic checks: Off"));
    expect(getAiLensPolicy().auto).toBe("off");
    getByText(/judge only when you tap/);
  });

  it("shows readiness and the delete affordance once installed", () => {
    setPangramState({
      phase: "ready",
      sha: "abc1234def",
      numLabels: 4,
      weightsBytes: 1_421_000_000,
    });
    const { getByLabelText, getByText, queryByText } = renderScreen();
    getByText(/Ready/);
    getByText(/4 levels · rev abc1234/);
    getByLabelText("Delete the model");
    expect(queryByText("Download the model")).toBeNull();
  });

  it("explains the half-installed state (checkpoint without bundled graph)", () => {
    setPangramState({ phase: "downloaded", sha: "abc1234def", numLabels: 4 });
    const { getByText } = renderScreen();
    getByText(/doesn't bundle the inference graph yet/);
  });

  it("surfaces install errors verbatim", () => {
    setPangramState({ phase: "error", error: "Your token works, but…" });
    const { getByText } = renderScreen();
    getByText("Your token works, but…");
  });
});
