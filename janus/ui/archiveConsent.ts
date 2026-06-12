import { Alert } from "react-native";

/**
 * Archive recovery is on-tap: nothing reaches a third-party archive until the
 * user explicitly asks for a specific profile or comment. The first time they
 * do, this discloses the data flow and asks once; after they accept, the
 * acknowledgement is remembered (persisted as the `archiveRecovery` setting)
 * and later taps run straight away.
 *
 * @param acknowledged  whether the user has already accepted the disclosure
 * @param acknowledge   persist the acceptance (set the flag true)
 * @param run           perform the recovery once consent is in hand
 */
export function ensureArchiveConsent(
  acknowledged: boolean,
  acknowledge: () => void,
  run: () => void,
): void {
  if (acknowledged) {
    run();
    return;
  }
  Alert.alert(
    "Use archive recovery?",
    "This sends the profile or comment you're looking up to third-party archive services (Arctic Shift, PullPush) to find content Reddit no longer serves. Those services can see what you look up. Recovered content is always labelled as archived. You can turn this off later in Settings.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Continue",
        onPress: () => {
          acknowledge();
          run();
        },
      },
    ],
  );
}
