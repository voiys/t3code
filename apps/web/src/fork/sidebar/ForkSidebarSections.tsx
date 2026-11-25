import type { ContextMenuItem } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import type {
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import { SortableSidebarMarker } from "~/components/sidebar/SidebarListMarkers";
import { contextMenuSourceOf } from "~/contextMenuSource";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";

import {
  headerDropTarget,
  parseForkSidebarMarker,
  sectionCounts,
  sectionOfThread,
  shownSections,
} from "./sections.logic";
import {
  ACTIVE_SECTION_KEY,
  PINNED_SECTION_KEY,
  sidebarSectionActions,
  useForkSidebarSectionsStore,
} from "./sectionsStore";
import "./fork-sidebar.css";

/** Fork-only: the section state the sidebar list is built from. */
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
        // A section toggled off in the filter is no destination: the thread would vanish.
        ...shownSections(state).map((section) => ({
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
  const hidden = useForkSidebarSectionsStore((state) => state.hidden);
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

  const counts = sectionCounts({ sections, membership }, props.activeKeys);
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
    const shown = shownSections({ sections, hidden });
    const index = shown.findIndex(({ id }) => id === key);
    const items: ContextMenuItem[] = [
      ...(section
        ? [
            { id: "rename", label: gt("Rename section") },
            { id: "up", label: gt("Move up"), disabled: index <= 0 },
            { id: "down", label: gt("Move down"), disabled: index >= shown.length - 1 },
            { id: "hide", label: gt("Hide section") },
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
    else if (choice === "hide" && section) sidebarSectionActions.toggleHidden(section.id);
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
        data-fork-section-header={section?.id}
        onPointerDown={section ? (event) => startHeaderDrag(event, section.id) : undefined}
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

/** Marks the sidebar filter button while sections are toggled off. */
export function ForkHiddenSectionsDot() {
  const gt = useGT();
  const sections = useForkSidebarSectionsStore((state) => state.sections);
  const hidden = useForkSidebarSectionsStore((state) => state.hidden);
  const hiddenCount = sections.length - shownSections({ sections, hidden }).length;
  if (hiddenCount === 0) return null;
  return (
    <span
      role="img"
      aria-label={gt("Hidden sections: {count}", { count: hiddenCount })}
      className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-primary"
    />
  );
}

/** The sidebar filter's section toggles: a checked section shows its threads. */
export function ForkSectionFilter() {
  const gt = useGT();
  const sections = useForkSidebarSectionsStore((state) => state.sections);
  const hidden = useForkSidebarSectionsStore((state) => state.hidden);
  if (sections.length === 0) return null;
  const anyHidden = sections.some((section) => hidden[section.id] === true);
  return (
    <div className="border-t border-border/60 px-1 pt-1 pb-1.5" data-testid="fork-section-filter">
      <div className="flex h-7 items-center justify-between px-2 text-xs text-muted-foreground">
        <T>Sections</T>
        {anyHidden ? (
          <button
            type="button"
            className="rounded px-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => sidebarSectionActions.showAll()}
          >
            <T>Show all</T>
          </button>
        ) : null}
      </div>
      <ul aria-label={gt("Sections")}>
        {sections.map((section) => {
          const shown = hidden[section.id] !== true;
          return (
            <li key={section.id}>
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/50 sm:h-7">
                <Checkbox
                  checked={shown}
                  onCheckedChange={() => sidebarSectionActions.toggleHidden(section.id)}
                  aria-label={gt("Show {name}", { name: section.name })}
                />
                <span className={cn("min-w-0 truncate", !shown && "text-muted-foreground")}>
                  {section.name}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const HEADER_DRAG_THRESHOLD_PX = 4;

/**
 * Drags a section header up or down among the shown sections. A line marks the gap it will
 * drop into; Pinned stays above and Active below, so neither is a gap. A press that never
 * moves stays a click, which folds the section. Modeled in ../tla/Sidebar.tla (HeaderDrop).
 */
function startHeaderDrag(event: ReactPointerEvent<HTMLElement>, sectionId: string) {
  if (event.button !== 0 || event.altKey || event.metaKey || event.ctrlKey) return;
  const header = event.currentTarget;
  const list = header.closest("ul, ol");
  if (!list) return;
  const startY = event.clientY;
  let dragging = false;
  let boundary = -1;
  let line: HTMLDivElement | null = null;

  const blocks = () => {
    const headers = [...list.querySelectorAll<HTMLElement>("[data-fork-section-header]")];
    const end = list.querySelector<HTMLElement>('[data-testid="fork-sidebar-active-header"]');
    const tops = headers.map((element) => element.getBoundingClientRect().top);
    const bottom = end?.getBoundingClientRect().top ?? header.getBoundingClientRect().bottom;
    return {
      ids: headers.map((element) => element.dataset.forkSectionHeader!),
      tops,
      ends: [...tops.slice(1), bottom],
    };
  };

  const placeLine = (y: number) => {
    const { tops, ends } = blocks();
    // The gap before the first block whose middle is below the pointer, or after the last.
    const index = tops.findIndex((top, at) => y < (top + ends[at]!) / 2);
    boundary = index === -1 ? tops.length : index;
    const lineY = boundary < tops.length ? tops[boundary]! : ends.at(-1)!;
    const rect = header.getBoundingClientRect();
    line ??= Object.assign(document.createElement("div"), {
      className: "pointer-events-none fixed z-50 h-0.5 rounded-full bg-primary",
    });
    if (!line.isConnected) document.body.append(line);
    Object.assign(line.style, {
      left: `${rect.left + 4}px`,
      width: `${rect.width - 8}px`,
      top: `${lineY - 1}px`,
    });
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", cleanup);
    window.removeEventListener("keydown", onKey, true);
    line?.remove();
    header.style.opacity = "";
    document.body.style.cursor = "";
  };
  const onMove = (move: PointerEvent) => {
    if (!dragging && Math.abs(move.clientY - startY) < HEADER_DRAG_THRESHOLD_PX) return;
    dragging = true;
    header.style.opacity = "0.6";
    document.body.style.cursor = "grabbing";
    placeLine(move.clientY);
  };
  const onUp = () => {
    cleanup();
    if (!dragging) return;
    // The click that ends a drag must not fold the section. The browser sends that click in the
    // same task as pointerup, or not at all (released outside the window), so disarm right after.
    const swallowClick = (click: MouseEvent) => click.stopPropagation();
    window.addEventListener("click", swallowClick, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
    const from = blocks().ids.indexOf(sectionId);
    if (from !== -1 && boundary !== -1) {
      sidebarSectionActions.reorderShown(sectionId, headerDropTarget(from, boundary));
    }
  };
  const onKey = (key: globalThis.KeyboardEvent) => {
    if (key.key !== "Escape") return;
    key.stopPropagation();
    dragging = false;
    cleanup();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", cleanup);
  window.addEventListener("keydown", onKey, true);
}
