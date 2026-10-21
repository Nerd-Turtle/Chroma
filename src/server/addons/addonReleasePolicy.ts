import type { AddonReleaseChannel } from "../../shared/types/index.js";
import type { CurseForgeModFile } from "./curseForgeClient.js";

// CurseForge FileReleaseType: 1 = Release, 2 = Beta, 3 = Alpha.
export function isAllowedAddonRelease(file: CurseForgeModFile, channel: AddonReleaseChannel): boolean {
  if (file.isAvailable !== true) return false;
  return file.releaseType === 1
    || (file.releaseType === 2 && (channel === "beta" || channel === "alpha"))
    || (file.releaseType === 3 && channel === "alpha");
}
