import { describe, expect, it } from "vite-plus/test";

import { bundledLocalAcpIconUrl, isBundledAcpIconUrl } from "./index";

describe("bundledLocalAcpIconUrl", () => {
  it("matches bare, absolute, and Windows nodecode command paths", () => {
    const bare = bundledLocalAcpIconUrl("nodecode");
    expect(bare).toBeTruthy();
    expect(isBundledAcpIconUrl(bare)).toBe(true);
    expect(bundledLocalAcpIconUrl("/opt/homebrew/bin/nodecode")).toBe(bare);
    expect(bundledLocalAcpIconUrl("C:\\Program Files\\Nodecode\\NODECODE.EXE")).toBe(bare);
  });

  it("returns null for other commands and non-strings", () => {
    expect(bundledLocalAcpIconUrl("other-agent")).toBeNull();
    expect(bundledLocalAcpIconUrl("")).toBeNull();
    expect(bundledLocalAcpIconUrl(undefined)).toBeNull();
    expect(isBundledAcpIconUrl("https://cdn.agentclientprotocol.com/registry/v1/x.svg")).toBe(
      false,
    );
  });
});
