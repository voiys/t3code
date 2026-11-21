import type { ContextMenuItem } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import { SortableSidebarMarker } from "~/components/sidebar/SidebarListMarkers";
import { contextMenuSourceOf } from "~/contextMenuSource";
import { readLocalApi } from "~/localApi";

import { parseForkSidebarMarker, sectionCounts, sectionOfThread } from "./sections.logic";
import {
  ACTIVE_SECTION_KEY,
  PINNED_SECTION_KEY,
  sidebarSectionActions,
  useForkSidebarSectionsStore,
} from "./sectionsStore";
import "./fork-sidebar.css";

/** Fork-only: the section state the sidebar list is built from. */
export function useForkSidebarSections() {
  const sections = useForkSidebarSectionsStore((state) => state.sections);
  const membership = useForkSidebarSectionsStore((state) => state.membership);
  const collapsed = useForkSidebarSectionsStore((state) => state.collapsed);
  return { sections, membership, collapsed };
}

const MENU_PREFIX = "fork-section:";

/** Adds "Move to section" to a thread's menu. */
export function withSectionMenu<Id extends string>(
  items: ReadonlyArray<ContextMenuItem<Id>>,
  threadKey: string,
  label: { title: string; active: string; newSection: string },
): ContextMenuItem<Id>[] {
  const state = useForkSidebarSectionsStore.getState();
  const current = sectionOfThread(state, threadKey);
  const id = (value: string) => `${MENU_PREFIX}${value}` as Id;
  // Sits with Pin, Settle and Snooze, before the group that starts at Rename.
  const renameIndex = items.findIndex((item) => item.id === "rename");
  const at = renameIndex === -1 ? items.length : renameIndex;
  return [
    ...items.slice(0, at),
    {
      id: id("menu"),
      label: label.title,
      icon: "folder",
      children: [
        { id: id("none"), label: label.active, checked: current === null },
        ...state.sections.map((section) => ({
          id: id(section.id),
          label: section.name,
          checked: current === section.id,
        })),
        { id: id("new"), label: label.newSection, separatorBefore: true },
      ],
    },
    ...items.slice(at),
  ];
}

/** Runs a "Move to section" choice; false when `value` is not one. */
export function handleSectionMenuChoice(
  value: string,
  threadKey: string,
  newSectionName: string,
): boolean {
  if (!value.startsWith(MENU_PREFIX)) return false;
  const choice = value.slice(MENU_PREFIX.length);
  if (choice === "new") sidebarSectionActions.create(newSectionName, [threadKey]);
  else if (choice === "none") sidebarSectionActions.assign([threadKey], null);
  else if (choice !== "menu") sidebarSectionActions.assign([threadKey], choice);
  return true;
}

/** Renders a fork marker from the sidebar list: a collapsible header or an empty-section slot. */
export function ForkSidebarMarkerRow(props: {
  readonly marker: string;
  readonly pinnedCount: number;
  readonly activeKeys: readonly string[];
}) {
  const gt = useGT();
  const fork = parseForkSidebarMarker(props.marker);
  const sections = useForkSidebarSectionsStore((state) => state.sections);
  const membership = useForkSidebarSectionsStore((state) => state.membership);
  const collapsed = useForkSidebarSectionsStore((state) => state.collapsed);
  const editingSectionId = useForkSidebarSectionsStore((state) => state.editingSectionId);
  if (fork === null) return null;
  const markerName = props.marker as `fork-${string}`;

  if (fork.kind === "section-empty") {
    return (
      <SortableSidebarMarker marker={markerName} className="relative mx-0.5 h-8">
        <div className="flex h-8 items-center rounded-md border border-dashed border-sidebar-border/70 px-2 text-xs text-sidebar-muted-foreground/70">
          <T>Drag threads here</T>
        </div>
      </SortableSidebarMarker>
    );
  }

  const counts = sectionCounts({ sections, membership, collapsed }, props.activeKeys);
  const key =
    fork.kind === "pinned-header"
      ? PINNED_SECTION_KEY
      : fork.kind === "active-header"
        ? ACTIVE_SECTION_KEY
        : fork.id;
  const section = fork.kind === "section-header" ? sections.find(({ id }) => id === fork.id) : null;
  const label =
    fork.kind === "pinned-header"
      ? gt("Pinned", { $context: "sidebar section" })
      : fork.kind === "active-header"
        ? gt("Active", { $context: "sidebar section" })
        : (section?.name ?? "");
  const count = fork.kind === "pinned-header" ? props.pinnedCount : (counts.get(key) ?? 0);
  const expanded = collapsed[key] !== true;

  const toggle = (event: ReactMouseEvent) => {
    // Option-click (Alt-click) folds or unfolds every group at once.
    if (event.altKey) sidebarSectionActions.setAllCollapsed(expanded);
    else sidebarSectionActions.toggleCollapsed(key);
  };
  const openMenu = async (event: ReactMouseEvent) => {
    event.preventDefault();
    const api = readLocalApi();
    if (!api) return;
    const index = sections.findIndex(({ id }) => id === key);
    const items: ContextMenuItem[] = [
      ...(section
        ? [
            { id: "rename", label: gt("Rename section") },
            { id: "up", label: gt("Move up"), disabled: index <= 0 },
            { id: "down", label: gt("Move down"), disabled: index >= sections.length - 1 },
          ]
        : []),
      { id: "new", label: gt("New section"), separatorBefore: section !== null },
      { id: "collapse-all", label: gt("Collapse all"), separatorBefore: true },
      { id: "expand-all", label: gt("Expand all") },
      ...(section
        ? [
            {
              id: "delete",
              label: gt("Delete section"),
              destructive: true,
              separatorBefore: true,
            },
          ]
        : []),
    ];
    const choice = await api.contextMenu.show(
      items,
      { x: event.clientX, y: event.clientY },
      contextMenuSourceOf(event.nativeEvent),
    );
    if (choice === "rename" && section) sidebarSectionActions.startEditing(section.id);
    else if (choice === "up" && section) sidebarSectionActions.move(section.id, -1);
    else if (choice === "down" && section) sidebarSectionActions.move(section.id, 1);
    else if (choice === "new") sidebarSectionActions.create(gt("New section"));
    else if (choice === "collapse-all") sidebarSectionActions.setAllCollapsed(true);
    else if (choice === "expand-all") sidebarSectionActions.setAllCollapsed(false);
    else if (choice === "delete" && section) sidebarSectionActions.remove(section.id);
  };

  if (section && editingSectionId === section.id) {
    const commit = (value: string) => sidebarSectionActions.rename(section.id, value);
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      // The sidebar's own shortcuts must not see keys typed into the name.
      event.stopPropagation();
      if (event.key === "Enter") commit(event.currentTarget.value);
      else if (event.key === "Escape") sidebarSectionActions.startEditing(null);
    };
    return (
      <SortableSidebarMarker marker={markerName} className="relative mx-0.5 h-8">
        <input
          autoFocus
          defaultValue={section.name}
          aria-label={gt("Section name")}
          onKeyDown={onKeyDown}
          onBlur={(event) => commit(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="h-8 w-full rounded-md border border-primary/50 bg-transparent px-2 text-xs font-medium text-sidebar-foreground outline-none"
        />
      </SortableSidebarMarker>
    );
  }

  return (
    <SortableSidebarMarker
      marker={markerName}
      data-testid={`fork-sidebar-${fork.kind}`}
      className="relative mx-0.5 h-8"
    >
      <CollapsibleSectionHeader
        expanded={expanded}
        onClick={toggle}
        onContextMenu={(event) => void openMenu(event)}
        onDoubleClick={section ? () => sidebarSectionActions.startEditing(section.id) : undefined}
        accessory={<span className="font-normal tabular-nums">{count}</span>}
      >
        {label}
      </CollapsibleSectionHeader>
    </SortableSidebarMarker>
  );
}
