import { clampHex, darken, applyOverrides, palettes } from "../theme";

describe("clampHex", () => {
  it("accepts #rrggbb and bare rrggbb, lowercasing", () => {
    expect(clampHex("#FF6600")).toBe("#ff6600");
    expect(clampHex("00bc8c")).toBe("#00bc8c");
  });
  it("rejects junk", () => {
    expect(clampHex("")).toBeUndefined();
    expect(clampHex("red")).toBeUndefined();
    expect(clampHex("#fff")).toBeUndefined();
  });
});

describe("darken", () => {
  it("scales each channel toward black", () => {
    expect(darken("#ffffff", 0.5)).toBe("#808080");
    expect(darken("#ff0000", 0.2)).toBe("#cc0000");
    expect(darken("#000000", 0.5)).toBe("#000000");
  });
});

describe("applyOverrides", () => {
  it("overrides accent + derives a darker active variant", () => {
    const p = applyOverrides(palettes.dark, "dark", "#ff6600");
    expect(p.accent).toBe("#ff6600");
    expect(p.accentActive).not.toBe(palettes.dark.accentActive);
    expect(p.accentActive).toBe(darken("#ff6600", 0.18));
  });

  it("ignores an invalid accent", () => {
    const p = applyOverrides(palettes.dark, "dark", "nope");
    expect(p.accent).toBe(palettes.dark.accent);
  });

  it("applies OLED black only in dark mode", () => {
    expect(applyOverrides(palettes.dark, "dark", "", true).bg).toBe("#000000");
    expect(applyOverrides(palettes.light, "light", "", true).bg).toBe(
      palettes.light.bg,
    );
  });
});
