import { shareImage } from "../shareMedia";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";

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
