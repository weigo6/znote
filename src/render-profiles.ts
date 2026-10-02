import { validateRenderSettings } from "./render-config";
import type { RenderSettings } from "./render-config";

export interface RenderProfile {
  name: string;
  settings: RenderSettings;
}
const key = "znote:render-profiles";
/** Profiles are explicit application choices, never auto-discovered beside notes. */
export function readRenderProfiles(
  storage: Pick<Storage, "getItem">,
): RenderProfile[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || "[]");
    if (!Array.isArray(value)) return [];
    return value.slice(0, 20).flatMap((profile) => {
      if (
        !profile ||
        typeof profile.name !== "string" ||
        !profile.name.trim() ||
        profile.name.length > 60
      )
        return [];
      const result = validateRenderSettings(profile.settings);
      return result.issues.length
        ? []
        : [{ name: profile.name, settings: result.settings }];
    });
  } catch {
    return [];
  }
}
export function writeRenderProfiles(
  storage: Pick<Storage, "setItem">,
  profiles: RenderProfile[],
) {
  storage.setItem(key, JSON.stringify(profiles));
}
