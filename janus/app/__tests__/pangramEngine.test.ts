import { padToBucket } from "../pangramEngine";

describe("padToBucket (fixed shapes for Core ML)", () => {
  it("pads ids to the next bucket with mask zeros over the padding", () => {
    const { ids, mask } = padToBucket([0, 5, 6, 2], 1);
    expect(ids).toHaveLength(64);
    expect(mask).toHaveLength(64);
    expect(ids.slice(0, 4)).toEqual([0, 5, 6, 2]);
    expect(ids.slice(4).every((x) => x === 1)).toBe(true);
    expect(mask.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(mask.slice(4).every((x) => x === 0)).toBe(true);
  });

  it("steps through the bucket ladder and never shrinks", () => {
    expect(padToBucket(new Array(64).fill(7), 1).ids).toHaveLength(64);
    expect(padToBucket(new Array(65).fill(7), 1).ids).toHaveLength(128);
    expect(padToBucket(new Array(200).fill(7), 1).ids).toHaveLength(256);
    expect(padToBucket(new Array(512).fill(7), 1).ids).toHaveLength(512);
    // Anything beyond the largest bucket passes through unpadded.
    expect(padToBucket(new Array(513).fill(7), 1).ids).toHaveLength(513);
  });
});
