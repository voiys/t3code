import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentType, ReactNode } from "react";

import type {
  SidebarListItem,
  SidebarListMarker,
  SidebarSection,
} from "../components/Sidebar.logic";

export type T3PluginCategory = "layout" | "sidebar" | "providers" | "other";

export interface ThreadLayoutWrapperProps {
  readonly mainRef: ScopedThreadRef | null;
  readonly hidden: boolean;
  readonly children: ReactNode;
}

export interface LocalAcpIconResolver {
  readonly resolveUrl: (command: unknown) => string | null;
  readonly isBundledUrl: (url: string) => boolean;
}

export interface SidebarSectionMenuLabels {
  readonly title: string;
  readonly active: string;
  readonly newSection: string;
}

export interface SidebarDragProjection {
  readonly pinnedHeader: ReadonlyArray<SidebarListItem>;
  readonly active: ReadonlyArray<SidebarListItem>;
  readonly coveredLabels: ReadonlySet<SidebarListMarker>;
}

/**
 * Narrow, typed extension contract for sidebar grouping/section plugins.
 * Kept intentionally small so upstream `Sidebar.tsx` / `Sidebar.drag.ts`
 * only depend on generic hook calls rather than concrete fork modules.
 */
export interface SidebarPluginExtension<State = unknown> {
  readonly subscribeState: (listener: () => void) => () => void;
  readonly getStateSnapshot: () => State;
  readonly filterThreads: <T>(
    threads: readonly T[],
    state: State,
    keyOf: (thread: T) => string,
  ) => readonly T[];
  readonly groupPinnedItems: (
    rows: SidebarListItem[],
    state: State,
    routeKey: string | null,
  ) => SidebarListItem[];
  readonly groupActiveItems: (
    rows: SidebarListItem[],
    state: State,
    routeKey: string | null,
  ) => SidebarListItem[];
  readonly projectDragRegions: (
    items: ReadonlyArray<SidebarListItem>,
    activeIndex: number,
    overIndex: number,
    targetSection: SidebarSection,
  ) => SidebarDragProjection | null;
  readonly sectionAtDrop: (
    items: ReadonlyArray<SidebarListItem>,
    activeKey: string,
    overId: string,
  ) => string | null | undefined;
  readonly sectionOfThread: (state: State, threadKey: string) => string | null;
  readonly assignThreads: (keys: readonly string[], sectionId: string | null) => void;
  readonly extendThreadContextMenu: <Id extends string>(
    items: ReadonlyArray<ContextMenuItem<Id>>,
    threadKey: string,
    labels: SidebarSectionMenuLabels,
  ) => ContextMenuItem<Id>[];
  readonly handleThreadContextMenuChoice: (
    value: string,
    threadKey: string,
    newSectionName: string,
  ) => boolean;
  readonly HiddenSectionsDot: ComponentType;
  readonly SectionFilter: ComponentType;
  readonly MarkerRow: ComponentType<{
    readonly marker: string;
    readonly pinnedCount: number;
    readonly activeKeys: readonly string[];
  }>;
}

/**
 * Reversible plugin activation context (Cordis-inspired).
 * Every `register*` call returns a disposer AND is automatically unwound in
 * reverse order when the plugin is disabled or reloaded.
 */
export interface PluginContext {
  readonly addDisposer: (dispose: () => void) => void;
  readonly registerThreadLayout: (wrapper: ComponentType<ThreadLayoutWrapperProps>) => () => void;
  readonly registerSidebarExtension: <State>(
    extension: SidebarPluginExtension<State>,
  ) => () => void;
  readonly registerLocalAcpIconResolver: (resolver: LocalAcpIconResolver) => () => void;
}

export interface T3Plugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly category: T3PluginCategory;
  readonly defaultEnabled?: boolean;
  readonly activate: (ctx: PluginContext) => void | (() => void);
  readonly renderSettings?: () => ReactNode;
}

export interface PluginSnapshot {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly category: T3PluginCategory;
  readonly enabled: boolean;
  readonly defaultEnabled: boolean;
  readonly error: string | null;
  readonly renderSettings?: () => ReactNode;
}
