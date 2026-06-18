import React from "react";
import { render } from "@testing-library/react-native";
import { ZoomableImage } from "../components/ZoomableImage";

// Reanimated + gesture-handler are mocked in jest.setup; this is a render smoke
// test (the gesture/motion behaviour is verified on-device). It guards against
// import/shape regressions in the reanimated rewrite.
function FakeBackdrop({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

describe("ZoomableImage", () => {
  it("renders an image page without crashing", () => {
    // useSharedValue is mocked to a plain { value } ref, fine to fabricate.
    const backdrop = { value: 1 } as any;
    const tree = render(
      <FakeBackdrop>
        <ZoomableImage
          uri="https://example.com/a.jpg"
          backdrop={backdrop}
          onRequestClose={() => {}}
        />
      </FakeBackdrop>,
    );
    expect(
      tree.getByLabelText(/Double-tap to zoom, swipe to close/),
    ).toBeTruthy();
  });

  it("accepts a low-res placeholder uri", () => {
    const backdrop = { value: 1 } as any;
    const tree = render(
      <ZoomableImage
        uri="https://example.com/full.jpg"
        placeholder="https://example.com/thumb.jpg"
        backdrop={backdrop}
        onRequestClose={() => {}}
        onZoomChange={() => {}}
      />,
    );
    expect(
      tree.getByLabelText(/Double-tap to zoom, swipe to close/),
    ).toBeTruthy();
  });
});
