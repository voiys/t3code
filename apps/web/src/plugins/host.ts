import { useSyncExternalStore, type ComponentType } from "react";

import type {
  LocalAcpIconResolver,
  PluginContext,
  PluginSnapshot,
  SidebarPluginExtension,
  T3Plugin,
  ThreadLayoutWrapperProps,
} from "./types";

export const PLUGINS_STORAGE_KEY = "t3code:fork:plugins:v1";

interface PluginRecord {
  readonly plugin: T3Plugin;
  enabled: boolean;
  disposers: Array<() => void>;
  error: string | null;
}

export interface ActiveSidebarPlugin<State = unknown> {
  readonly extension: SidebarPluginExtension<State>;
  readonly state: State;
}

export interface PluginStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

function getDefaultStorage(): PluginStorage | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return null;
  }
  return window.localStorage;
}

function readStoredEnabledMap(storage: PluginStorage | null): Record<string, boolean> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(PLUGINS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function writeStoredEnabledMap(
  storage: PluginStorage | null,
  map: Readonly<Record<string, boolean>>,
): void {
  if (!storage) return;
  try {
    storage.setItem(PLUGINS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage quota or private browsing; keep in-memory state working.
  }
}

export function createPluginHost(options: { readonly storage?: PluginStorage | null } = {}) {
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  const records = new Map<string, PluginRecord>();
  const threadLayouts: Array<ComponentType<ThreadLayoutWrapperProps>> = [];
  const sidebarExtensions: Array<SidebarPluginExtension<any>> = [];
  const acpIconResolvers: Array<LocalAcpIconResolver> = [];
  const listeners = new Set<() => void>();

  let version = 0;
  let storedEnabled = readStoredEnabledMap(storage);
  let snapshotsCache: ReadonlyArray<PluginSnapshot> = [];
  let threadLayoutsCache: ReadonlyArray<ComponentType<ThreadLayoutWrapperProps>> = [];

  const notify = () => {
    version += 1;
    snapshotsCache = Array.from(records.values(), (record) => ({
      id: record.plugin.id,
      name: record.plugin.name,
      description: record.plugin.description,
      version: record.plugin.version,
      category: record.plugin.category,
      enabled: record.enabled,
      defaultEnabled: record.plugin.defaultEnabled ?? true,
      error: record.error,
      ...(record.plugin.renderSettings ? { renderSettings: record.plugin.renderSettings } : {}),
    }));
    threadLayoutsCache = [...threadLayouts];
    for (const listener of listeners) {
      listener();
    }
  };

  const removeFrom = <T>(list: T[], item: T) => {
    const index = list.indexOf(item);
    if (index >= 0) list.splice(index, 1);
  };

  const runDisposers = (record: PluginRecord) => {
    const toRun = record.disposers.splice(0).reverse();
    for (const dispose of toRun) {
      try {
        dispose();
      } catch {
        // Disposer errors should never leave other disposers unrun.
      }
    }
  };

  const activateRecord = (record: PluginRecord) => {
    runDisposers(record);
    record.error = null;
    const ctx: PluginContext = {
      addDisposer(dispose) {
        record.disposers.push(dispose);
      },
      registerThreadLayout(wrapper) {
        threadLayouts.push(wrapper);
        const dispose = () => removeFrom(threadLayouts, wrapper);
        record.disposers.push(dispose);
        return dispose;
      },
      registerSidebarExtension(extension) {
        sidebarExtensions.push(extension);
        const dispose = () => removeFrom(sidebarExtensions, extension);
        record.disposers.push(dispose);
        return dispose;
      },
      registerLocalAcpIconResolver(resolver) {
        acpIconResolvers.push(resolver);
        const dispose = () => removeFrom(acpIconResolvers, resolver);
        record.disposers.push(dispose);
        return dispose;
      },
    };
    try {
      const cleanup = record.plugin.activate(ctx);
      if (typeof cleanup === "function") {
        record.disposers.push(cleanup);
      }
    } catch (error) {
      runDisposers(record);
      record.error = error instanceof Error ? error.message : String(error);
    }
  };

  const persistEnabled = () => {
    const next: Record<string, boolean> = { ...storedEnabled };
    for (const record of records.values()) {
      const def = record.plugin.defaultEnabled ?? true;
      if (record.enabled === def) {
        delete next[record.plugin.id];
      } else {
        next[record.plugin.id] = record.enabled;
      }
    }
    storedEnabled = next;
    writeStoredEnabledMap(storage, next);
  };

  return {
    registerPlugin(plugin: T3Plugin): void {
      const existing = records.get(plugin.id);
      if (existing) {
        runDisposers(existing);
      }
      const defaultEnabled = plugin.defaultEnabled ?? true;
      const enabled = Object.hasOwn(storedEnabled, plugin.id)
        ? storedEnabled[plugin.id]!
        : defaultEnabled;
      const record: PluginRecord = {
        plugin,
        enabled,
        disposers: [],
        error: null,
      };
      records.set(plugin.id, record);
      if (enabled) {
        activateRecord(record);
      }
      notify();
    },

    setPluginEnabled(id: string, enabled: boolean): void {
      const record = records.get(id);
      if (!record || record.enabled === enabled) return;
      record.enabled = enabled;
      if (enabled) {
        activateRecord(record);
      } else {
        runDisposers(record);
        record.error = null;
      }
      persistEnabled();
      notify();
    },

    resetAllPlugins(): void {
      let changed = false;
      for (const record of records.values()) {
        const def = record.plugin.defaultEnabled ?? true;
        if (record.enabled !== def || record.error !== null) {
          record.enabled = def;
          if (def) {
            activateRecord(record);
          } else {
            runDisposers(record);
            record.error = null;
          }
          changed = true;
        }
      }
      storedEnabled = {};
      writeStoredEnabledMap(storage, {});
      if (changed) notify();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getVersion(): number {
      return version;
    },

    getSnapshots(): ReadonlyArray<PluginSnapshot> {
      return snapshotsCache;
    },

    getThreadLayouts(): ReadonlyArray<ComponentType<ThreadLayoutWrapperProps>> {
      return threadLayoutsCache;
    },

    getSidebarExtension(): SidebarPluginExtension | null {
      return sidebarExtensions.length > 0 ? sidebarExtensions[sidebarExtensions.length - 1]! : null;
    },

    resolveLocalAcpIconUrl(command: unknown): string | null {
      for (const resolver of acpIconResolvers) {
        const url = resolver.resolveUrl(command);
        if (url !== null) return url;
      }
      return null;
    },

    isBundledAcpIconUrl(url: string | null | undefined): url is string {
      if (typeof url !== "string") return false;
      for (const resolver of acpIconResolvers) {
        if (resolver.isBundledUrl(url)) return true;
      }
      return false;
    },
  };
}

export const pluginHost = createPluginHost();

function usePluginVersion(): number {
  return useSyncExternalStore(
    (listener) => pluginHost.subscribe(listener),
    () => pluginHost.getVersion(),
  );
}

export function usePluginSnapshots(): ReadonlyArray<PluginSnapshot> {
  return useSyncExternalStore(
    (listener) => pluginHost.subscribe(listener),
    () => pluginHost.getSnapshots(),
  );
}

export function useThreadLayoutWrappers(): ReadonlyArray<ComponentType<ThreadLayoutWrapperProps>> {
  return useSyncExternalStore(
    (listener) => pluginHost.subscribe(listener),
    () => pluginHost.getThreadLayouts(),
  );
}

let cachedSidebarResult: ActiveSidebarPlugin | null = null;
let cachedSidebarExtension: SidebarPluginExtension | null = null;
let cachedSidebarState: unknown = undefined;

/**
 * Unconditional React hook for `Sidebar.tsx`. Subscribes to both the plugin
 * registry and the active sidebar plugin's own state store so live toggling
 * never changes React hook counts.
 */
export function useSidebarPlugin(): ActiveSidebarPlugin | null {
  return useSyncExternalStore(
    (listener) => {
      let unsubExtension: (() => void) | null = null;
      const syncExtensionSubscription = () => {
        unsubExtension?.();
        unsubExtension = null;
        const ext = pluginHost.getSidebarExtension();
        if (ext) {
          unsubExtension = ext.subscribeState(listener);
        }
      };
      syncExtensionSubscription();
      const unsubHost = pluginHost.subscribe(() => {
        syncExtensionSubscription();
        listener();
      });
      return () => {
        unsubExtension?.();
        unsubHost();
      };
    },
    () => {
      const ext = pluginHost.getSidebarExtension();
      if (!ext) {
        cachedSidebarResult = null;
        cachedSidebarExtension = null;
        cachedSidebarState = undefined;
        return null;
      }
      const state = ext.getStateSnapshot();
      if (
        cachedSidebarResult !== null &&
        cachedSidebarExtension === ext &&
        Object.is(cachedSidebarState, state)
      ) {
        return cachedSidebarResult;
      }
      cachedSidebarExtension = ext;
      cachedSidebarState = state;
      cachedSidebarResult = { extension: ext, state };
      return cachedSidebarResult;
    },
  );
}

export function getSidebarPlugin(): SidebarPluginExtension | null {
  return pluginHost.getSidebarExtension();
}

export function resolveLocalAcpIconUrl(command: unknown): string | null {
  return pluginHost.resolveLocalAcpIconUrl(command);
}

export function isPluginBundledAcpIconUrl(url: string | null | undefined): url is string {
  return pluginHost.isBundledAcpIconUrl(url);
}

export function useLocalAcpIconUrl(command: unknown): string | null {
  usePluginVersion();
  return pluginHost.resolveLocalAcpIconUrl(command);
}

export function useIsPluginBundledAcpIconUrl(url: string | null | undefined): url is string {
  usePluginVersion();
  return pluginHost.isBundledAcpIconUrl(url);
}
