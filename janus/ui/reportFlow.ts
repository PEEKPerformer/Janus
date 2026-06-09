import { Alert, Platform } from "react-native";

/**
 * Prompt for a report reason, then run the report. iOS shows a text field via
 * Alert.prompt; Android (which has no Alert.prompt) falls back to a plain
 * confirm with an empty reason. `onResult` reports success so the caller can
 * toast. Source-agnostic — the caller supplies `submit`, which is just the
 * active adapter's reportContent bound to the target.
 */
export function promptReport(
  what: "post" | "comment",
  submit: (reason: string) => Promise<void>,
  onResult?: (ok: boolean) => void,
): void {
  const run = (reason: string) => {
    submit(reason.trim())
      .then(() => onResult?.(true))
      .catch(() => onResult?.(false));
  };
  if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
    Alert.prompt(
      `Report ${what}`,
      "Briefly, what's wrong with it? (optional)",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: (v?: string) => run(v ?? ""),
        },
      ],
      "plain-text",
    );
  } else {
    Alert.alert(`Report ${what}`, "Send a report to the moderators?", [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: () => run("") },
    ]);
  }
}
