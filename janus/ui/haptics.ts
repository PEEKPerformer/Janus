import * as Haptics from "expo-haptics";

/**
 * Tactile vocabulary. Apollo's "feel" was as much haptic as visual: the tap
 * fires the instant the UI flips state (an icon fills, a threshold arms), never
 * on touch-up, and it *escalates* — a light tick to acknowledge, a firmer impact
 * to confirm something stronger. Keep that mapping consistent across the app.
 *
 *  - `selection` — a step crossed (swipe arms a tier, a segmented control moves)
 *  - `light`     — a soft confirm
 *  - `medium`    — a stronger confirm (the long-throw / super action arms)
 *  - `success` / `warning` — a committed outcome, used sparingly
 *
 * Every call is fire-and-forget and self-guarded: haptics are absent in the
 * simulator and on some devices, and this is routinely invoked from a gesture
 * worklet via `runOnJS`, where a throw would surface as an unhandled rejection.
 */
export type Haptic = "selection" | "light" | "medium" | "success" | "warning";

export function playHaptic(kind: Haptic, enabled = true): void {
  if (!enabled) return;
  try {
    switch (kind) {
      case "selection":
        void Haptics.selectionAsync();
        return;
      case "light":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case "medium":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      case "success":
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        return;
      case "warning":
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning,
        );
        return;
    }
  } catch {
    /* haptics unavailable — non-fatal */
  }
}
