import { describe, expect, it } from "vite-plus/test";

import { bundledLocalAcpIconUrl, isBundledAcpIconUrl } from "./bundledAcpIcons";

describe("bundledLocalAcpIconUrl", () => {
  it("finds the icon by the executable's file name, wherever it lives", () => {
    const bare = bundledLocalAcpIconUrl("nodecode");
    expect(bare).not.toBeNull();
    expect(bundledLocalAcpIconUrl("/Users/me/.local/bin/nodecode")).toBe(bare);
    expect(bundledLocalAcpIconUrl("C:\\tools\\NodeCode.exe")).toBe(bare);
    expect(isBundledAcpIconUrl(bare)).toBe(true);
  });

  it("has no icon for other commands or a missing command", () => {
    expect(bundledLocalAcpIconUrl("opencode")).toBeNull();
    expect(bundledLocalAcpIconUrl("/usr/bin/nodecode-wrapper")).toBeNull();
    expect(bundledLocalAcpIconUrl("")).toBeNull();
    expect(bundledLocalAcpIconUrl(undefined)).toBeNull();
    expect(isBundledAcpIconUrl("https://cdn.agentclientprotocol.com/x.svg")).toBe(false);
  });
});
