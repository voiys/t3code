import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { PLUGINS_STORAGE_KEY, createPluginHost, type PluginStorage } from "./host";
import type { T3Plugin } from "./types";

function createMemoryStorage(): PluginStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("createPluginHost", () => {
  let storage: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it("activates enabled plugins and unwinds disposers in reverse order on disable", () => {
    const events: string[] = [];
    const host = createPluginHost({ storage });
    const plugin: T3Plugin = {
      id: "demo",
      name: "Demo",
      description: "Test plugin",
      version: "0.1.0",
      category: "other",
      activate(ctx) {
        events.push("activate");
        ctx.addDisposer(() => events.push("dispose-1"));
        ctx.registerLocalAcpIconResolver({
          resolveUrl: (command) => (command === "demo" ? "data:demo" : null),
          isBundledUrl: (url) => url === "data:demo",
        });
        return () => events.push("dispose-return");
      },
    };

    host.registerPlugin(plugin);
    expect(host.resolveLocalAcpIconUrl("demo")).toBe("data:demo");
    expect(host.isBundledAcpIconUrl("data:demo")).toBe(true);
    expect(host.getSnapshots()[0]?.enabled).toBe(true);

    host.setPluginEnabled("demo", false);
    expect(host.resolveLocalAcpIconUrl("demo")).toBeNull();
    expect(host.isBundledAcpIconUrl("data:demo")).toBe(false);
    expect(events).toEqual(["activate", "dispose-return", "dispose-1"]);
    expect(JSON.parse(storage.getItem(PLUGINS_STORAGE_KEY) ?? "{}")).toEqual({
      demo: false,
    });

    // Re-enabling restores registrations and clears the non-default override.
    host.setPluginEnabled("demo", true);
    expect(host.resolveLocalAcpIconUrl("demo")).toBe("data:demo");
    expect(JSON.parse(storage.getItem(PLUGINS_STORAGE_KEY) ?? "{}")).toEqual({});
  });

  it("respects persisted disabled state across fresh hosts", () => {
    storage.setItem(PLUGINS_STORAGE_KEY, JSON.stringify({ demo: false }));
    const activate = vi.fn();
    const host = createPluginHost({ storage });
    host.registerPlugin({
      id: "demo",
      name: "Demo",
      description: "Test",
      version: "0.1.0",
      category: "other",
      activate,
    });
    expect(activate).not.toHaveBeenCalled();
    expect(host.getSnapshots()[0]?.enabled).toBe(false);
  });

  it("isolates activation errors and cleans up partial registrations", () => {
    const host = createPluginHost({ storage });
    host.registerPlugin({
      id: "broken",
      name: "Broken",
      description: "Throws during activate",
      version: "0.1.0",
      category: "other",
      activate(ctx) {
        ctx.registerLocalAcpIconResolver({
          resolveUrl: () => "data:leaked",
          isBundledUrl: () => true,
        });
        throw new Error("boom");
      },
    });
    expect(host.resolveLocalAcpIconUrl("anything")).toBeNull();
    expect(host.getSnapshots()[0]?.error).toBe("boom");
  });

  it("resets all plugins back to their defaults", () => {
    const host = createPluginHost({ storage });
    host.registerPlugin({
      id: "a",
      name: "A",
      description: "Default on",
      version: "0.1.0",
      category: "layout",
      defaultEnabled: true,
      activate() {},
    });
    host.registerPlugin({
      id: "b",
      name: "B",
      description: "Default off",
      version: "0.1.0",
      category: "sidebar",
      defaultEnabled: false,
      activate() {},
    });

    host.setPluginEnabled("a", false);
    host.setPluginEnabled("b", true);
    host.resetAllPlugins();

    expect(host.getSnapshots().map((snapshot) => [snapshot.id, snapshot.enabled])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });
});
