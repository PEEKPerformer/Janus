import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Current on-screen keyboard height (0 when hidden). Used to lift a bottom sheet
 * so its inline toolbar sits directly above the keyboard — InputAccessoryView is
 * unreliable here because iOS doesn't support it for multiline TextInputs.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt =
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvt =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      const h = e.endCoordinates?.height ?? 0;
      setHeight(h > 0 ? h : 0);
    });
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
