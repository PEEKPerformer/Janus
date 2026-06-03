import { shareImage, saveImageToLibrary } from "../shareMedia";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";

describe("shareImage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("prefetches then shares the cached file as an image", async () => {
    const ok = await shareImage("https://img.example/cat.jpg");
    expect(ok).toBe(true);
    expect(Image.prefetch).toHaveBeenCalledWith("https://img.example/cat.jpg");
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\//),
      expect.objectContaining({ UTI: "public.image" }),
    );
  });

  it("returns false when sharing is unavailable", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    expect(await shareImage("https://img.example/cat.jpg")).toBe(false);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it("returns false for an empty url", async () => {
    expect(await shareImage("")).toBe(false);
  });

  it("returns false when the file can't be resolved", async () => {
    (Image.getCachePathAsync as jest.Mock).mockResolvedValueOnce(null);
    expect(await shareImage("https://img.example/cat.jpg")).toBe(false);
  });
});

describe("saveImageToLibrary", () => {
  beforeEach(() => jest.clearAllMocks());

  it("saves the cached file to the library when permission is granted", async () => {
    expect(await saveImageToLibrary("https://img.example/cat.jpg")).toBe(
      "saved",
    );
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\//),
    );
  });

  it("returns 'denied' without saving when permission is refused", async () => {
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
    });
    expect(await saveImageToLibrary("https://img.example/cat.jpg")).toBe(
      "denied",
    );
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  });
});
