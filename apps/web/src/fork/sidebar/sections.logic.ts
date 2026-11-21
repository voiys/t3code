import type { SidebarListItem, SidebarListMarker } from "../../components/Sidebar.logic";
import {
  ACTIVE_SECTION_KEY,
  PINNED_SECTION_KEY,
  type ForkSidebarSectionsState,
} from "./sectionsStore";

/**
 * Fork-only: sidebar sections as extra markers in the upstream list. The pinned header leads the
 * pinned rows; when sections exist, an Active header leads the threads in no section and each
 * section's header leads its own rows. Upstream drop logic ignores these markers, so rows still
 * reorder, pin and settle as before; the header above a dropped row decides its section.
 */

const PINNED_HEADER = "fork-pinned-header";
const ACTIVE_HEADER = "fork-active-header";
const SECTION_HEADER = "fork-section:";
const SECTION_EMPTY = "fork-section-empty:";

export type ForkSidebarMarker =
  | { readonly kind: "pinned-header" }
  | { readonly kind: "active-header" }
  | { readonly kind: "section-header"; readonly id: string }
  | { readonly kind: "section-empty"; readonly id: string };

export function parseForkSidebarMarker(marker: string): ForkSidebarMarker | null {
  if (marker === PINNED_HEADER) return { kind: "pinned-header" };
  if (marker === ACTIVE_HEADER) return { kind: "active-header" };
  if (marker.startsWith(SECTION_HEADER)) {
    return { kind: "section-header", id: marker.slice(SECTION_HEADER.length) };
  }
  if (marker.startsWith(SECTION_EMPTY)) {
    return { kind: "section-empty", id: marker.slice(SECTION_EMPTY.length) };
  }
  return null;
}

const markerItem = (marker: `fork-${string}`): SidebarListItem => ({ kind: "marker", marker });

const isForkMarkerItem = (item: SidebarListItem) =>
  item.kind === "marker" && item.marker.startsWith("fork-");

const isShelfMarker = (marker: SidebarListMarker) =>
  marker === "working-header" || marker === "snoozed-header" || marker === "settled-header";

type SectionsView = Pick<ForkSidebarSectionsState, "sections" | "membership" | "collapsed">;

/** The section a thread shows in: its saved one if that still exists, else null (Active). */
export function sectionOfThread(state: SectionsView, threadKey: string): string | null {
  const id = state.membership[threadKey];
  return id !== undefined && state.sections.some((section) => section.id === id) ? id : null;
}

/** A collapsed group keeps only the open thread, like upstream's collapsed shelves. */
const visibleRows = (rows: SidebarListItem[], collapsed: boolean, routeKey: string | null) =>
  collapsed ? rows.filter((row) => row.kind === "thread" && row.key === routeKey) : rows;

export function groupPinnedItems(
  rows: SidebarListItem[],
  state: SectionsView,
  routeKey: string | null,
): SidebarListItem[] {
  if (rows.length === 0) return rows;
  return [
    markerItem(PINNED_HEADER),
    ...visibleRows(rows, state.collapsed[PINNED_SECTION_KEY] === true, routeKey),
  ];
}

export function groupActiveItems(
  rows: SidebarListItem[],
  state: SectionsView,
  routeKey: string | null,
): SidebarListItem[] {
  if (state.sections.length === 0) return rows;
  const loose: SidebarListItem[] = [];
  const bySection = new Map<string, SidebarListItem[]>(
    state.sections.map((section) => [section.id, []]),
  );
  for (const row of rows) {
    const id = row.kind === "thread" ? sectionOfThread(state, row.key) : null;
    (id === null ? loose : bySection.get(id)!).push(row);
  }
  const items: SidebarListItem[] = [
    markerItem(ACTIVE_HEADER),
    ...visibleRows(loose, state.collapsed[ACTIVE_SECTION_KEY] === true, routeKey),
  ];
  for (const section of state.sections) {
    const collapsed = state.collapsed[section.id] === true;
    const sectionRows = bySection.get(section.id)!;
    items.push(markerItem(`${SECTION_HEADER}${section.id}`));
    if (!collapsed && sectionRows.length === 0) {
      items.push(markerItem(`${SECTION_EMPTY}${section.id}`));
    }
    items.push(...visibleRows(sectionRows, collapsed, routeKey));
  }
  return items;
}

/** Threads per group, counting rows hidden by a collapse. */
export function sectionCounts(state: SectionsView, activeKeys: readonly string[]) {
  const counts = new Map<string, number>();
  for (const key of activeKeys) {
    const id = sectionOfThread(state, key) ?? ACTIVE_SECTION_KEY;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** `items` with the dragged row moved to the hovered slot, as upstream's drop logic does. */
function moveItem(items: readonly SidebarListItem[], activeIndex: number, overIndex: number) {
  const moved = items.filter((_, index) => index !== activeIndex);
  moved.splice(overIndex, 0, items[activeIndex]!);
  return moved;
}

const itemId = (item: SidebarListItem) =>
  item.kind === "thread" ? item.key : `sidebar-marker-${item.marker}`;

/**
 * The section a drop puts `activeKey` in: a section id, null for Active, or undefined when the
 * row does not land among the active threads (pinned, settled, an invalid slot).
 */
export function sectionAtDrop(
  items: readonly SidebarListItem[],
  activeKey: string,
  overId: string,
): string | null | undefined {
  if (!items.some(isForkMarkerItem)) return undefined;
  const activeIndex = items.findIndex((item) => itemId(item) === activeKey);
  const overIndex = items.findIndex((item) => itemId(item) === overId);
  if (activeIndex === -1 || overIndex === -1 || items[activeIndex]?.kind !== "thread") {
    return undefined;
  }
  let inActive = false;
  let section: string | null = null;
  for (const item of moveItem(items, activeIndex, overIndex)) {
    if (item.kind === "thread") {
      if (item.key === activeKey) return inActive ? section : undefined;
      continue;
    }
    if (item.marker === "pinned-divider") inActive = true;
    else if (isShelfMarker(item.marker)) inActive = false;
    else {
      const fork = parseForkSidebarMarker(item.marker);
      if (fork?.kind === "section-header") section = fork.id;
      else if (fork?.kind === "active-header") section = null;
    }
  }
  return undefined;
}

/**
 * The drag preview's pinned header and active region. Upstream rebuilds that region from thread
 * rows alone; with fork markers present this keeps them in place instead, so headers hold their
 * space while rows slide between sections. Null when there are no fork markers.
 */
export function projectForkRegions(
  items: readonly SidebarListItem[],
  activeIndex: number,
  overIndex: number,
  targetSection: string,
): {
  pinnedHeader: SidebarListItem[];
  active: SidebarListItem[];
  /** Upstream drag labels that a fork header already shows; they take no space. */
  coveredLabels: ReadonlySet<SidebarListMarker>;
} | null {
  if (!items.some(isForkMarkerItem)) return null;
  const pinnedHeader = items.filter(
    (item) =>
      item.kind === "marker" && parseForkSidebarMarker(item.marker)?.kind === "pinned-header",
  );
  const active = items[activeIndex]!;
  const base =
    targetSection === "active"
      ? moveItem(items, activeIndex, overIndex)
      : items.filter((_, index) => index !== activeIndex);
  const start = base.findIndex(
    (item) => item.kind === "marker" && item.marker === "pinned-divider",
  );
  const end = base.findIndex(
    (item, index) => index > start && item.kind === "marker" && isShelfMarker(item.marker),
  );
  const region = base
    .slice(start + 1, end === -1 ? base.length : end)
    .filter((item) => !(item.kind === "marker" && item.marker === "active-placeholder"))
    .map((item) =>
      item === active && item.kind === "thread" ? { ...item, section: "active" as const } : item,
    );
  const coveredLabels = new Set<SidebarListMarker>();
  if (pinnedHeader.length > 0) coveredLabels.add("pinned-header");
  if (
    items.some(
      (item) =>
        item.kind === "marker" && parseForkSidebarMarker(item.marker)?.kind === "active-header",
    )
  ) {
    coveredLabels.add("pinned-divider");
  }
  return {
    pinnedHeader,
    coveredLabels,
    // Fork headers keep the region from looking empty, so it needs no placeholder space.
    active: region.some((item) => item.kind === "thread" || isForkMarkerItem(item))
      ? region
      : [{ kind: "marker", marker: "active-placeholder" }, ...region],
  };
}
