import { playHaptic } from "../haptics";
import * as Haptics from "expo-haptics";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}));

const h = Haptics as jest.Mocked<typeof Haptics>;

afterEach(() => jest.clearAllMocks());

describe("playHaptic", () => {
  it("routes each tier to the right Taptic call", () => {
    playHaptic("selection");
    expect(h.selectionAsync).toHaveBeenCalledTimes(1);

    playHaptic("light");
    expect(h.impactAsync).toHaveBeenCalledWith("light");
    playHaptic("medium");
    expect(h.impactAsync).toHaveBeenCalledWith("medium");

    playHaptic("success");
    expect(h.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("stays silent when haptics are disabled (the user setting)", () => {
    playHaptic("medium", false);
    expect(h.impactAsync).not.toHaveBeenCalled();
  });

  it("swallows a throwing native module — a gesture must never reject", () => {
    h.impactAsync.mockImplementationOnce(() => {
      throw new Error("haptics unavailable");
    });
    expect(() => playHaptic("light")).not.toThrow();
  });
});
