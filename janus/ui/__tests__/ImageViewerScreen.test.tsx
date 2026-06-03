import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { ImageViewerScreen } from "../screens/ImageViewerScreen";
import * as Sharing from "expo-sharing";

function renderViewer(images: string[], index = 0) {
  const navigation = { goBack: jest.fn() } as never;
  const route = { params: { images, index } } as never;
  render(<ImageViewerScreen navigation={navigation} route={route} />);
  return { navigation };
}

describe("ImageViewerScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows a page counter for a gallery", () => {
    renderViewer(["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"], 0);
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("shares the current image as a file", async () => {
    renderViewer(["https://a/1.jpg"]);
    fireEvent.press(screen.getByLabelText("Share image"));
    await waitFor(() =>
      expect(Sharing.shareAsync).toHaveBeenCalledWith(
        expect.stringMatching(/^file:\/\//),
        expect.objectContaining({ UTI: "public.image" }),
      ),
    );
  });

  it("closes via the close button", () => {
    const { navigation } = renderViewer(["https://a/1.jpg"]);
    fireEvent.press(screen.getByLabelText("Close image viewer"));
    expect((navigation as { goBack: jest.Mock }).goBack).toHaveBeenCalled();
  });
});
