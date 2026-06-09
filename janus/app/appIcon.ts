import {
  setAlternateAppIcon,
  getAppIconName,
  supportsAlternateIcons,
  type AlternateAppIcons,
} from "expo-alternate-app-icons";

/**
 * Alternate app-icon support. The selectable icons are declared by the
 * expo-alternate-app-icons config plugin (icon assets in app config); this
 * module is the runtime surface the Settings picker drives. Until alternate
 * assets are added, only the default is offered — new ids slot into
 * {@link APP_ICON_CHOICES} as assets land, with zero further wiring.
 */

export interface AppIconChoice {
  /** null = the default icon. */
  id: string | null;
  label: string;
}

export const APP_ICON_CHOICES: AppIconChoice[] = [
  { id: null, label: "Default" },
];

export const canChangeAppIcon = supportsAlternateIcons;

export function currentAppIcon(): string | null {
  try {
    return getAppIconName();
  } catch {
    return null;
  }
}

export async function applyAppIcon(id: string | null): Promise<boolean> {
  try {
    await setAlternateAppIcon(id as AlternateAppIcons | null);
    return true;
  } catch {
    return false;
  }
}
