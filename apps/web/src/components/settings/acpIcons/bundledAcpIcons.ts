import nodecodeAxolotl from "./nodecode-axolotl.svg";

/**
 * Icons for local ACP commands that are not in the ACP registry, keyed by the
 * executable's file name. They ship with the app, so they are drawn as they are:
 * no fetch, and none of the one-color recoloring registry icons get.
 */
const BUNDLED_LOCAL_ACP_ICONS: Readonly<Record<string, string>> = {
  nodecode: nodecodeAxolotl,
};

const BUNDLED_ICON_URLS = new Set(Object.values(BUNDLED_LOCAL_ACP_ICONS));

/** The bundled icon for a local ACP command such as `nodecode` or `/usr/local/bin/nodecode`. */
export function bundledLocalAcpIconUrl(command: unknown): string | null {
  if (typeof command !== "string") return null;
  const name = command
    .trim()
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.exe$/i, "")
    .toLowerCase();
  if (!name) return null;
  return Object.hasOwn(BUNDLED_LOCAL_ACP_ICONS, name) ? BUNDLED_LOCAL_ACP_ICONS[name]! : null;
}

export function isBundledAcpIconUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && BUNDLED_ICON_URLS.has(url);
}
