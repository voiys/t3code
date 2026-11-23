import type { SidebarListItem, SidebarListMarker } from "../../components/Sidebar.logic";
import {
  ACTIVE_SECTION_KEY,
  PINNED_SECTION_KEY,
  type ForkSidebarSectionsState,
} from "./sectionsStore";

/**
 * Fork-only: sections as extra markers in the upstream list, which its drop logic ignores. Shown
 * sections lead their rows in saved order, then Active; the header above a dropped row decides
 * its section. Hidden sections leave the whole list, as the project filter does. See tla/Sidebar.
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

type SectionsView = Pick<
  ForkSidebarSectionsState,
  "sections" | "membership" | "collapsed" | "hidden"
>;

/** The section a thread shows in: its saved one if that still exists, else null (Active). */
export function sectionOfThread(
  state: Pick<SectionsView, "sections" | "membership">,
  threadKey: string,
): string | null {
  const id = state.membership[threadKey];
  return id !== undefined && state.sections.some((section) => section.id === id) ? id : null;
}

/** Sections the filter shows, in their saved order. */
export function shownSections(state: Pick<SectionsView, "sections" | "hidden">) {
  return state.sections.filter((section) => state.hidden[section.id] !== true);
}

function isThreadFiltered(state: SectionsView, threadKey: string): boolean {
  const id = sectionOfThread(state, threadKey);
  return id !== null && state.hidden[id] === true;
}

const anyHidden = (state: Pick<SectionsView, "hidden">) =>
  Object.values(state.hidden).some(Boolean);

const shownRows = (rows: SidebarListItem[], state: SectionsView) =>
  anyHidden(state)
    ? rows.filter((row) => row.kind !== "thread" || !isThreadFiltered(state, row.key))
    : rows;

/** `threads` without those in sections toggled off, wherever they sit (pinned, shelves too). */
export function withoutHiddenSections<T>(
  threads: readonly T[],
  state: SectionsView,
  keyOf: (thread: T) => string,
): readonly T[] {
  if (!anyHidden(state)) return threads;
  return threads.filter((thread) => !isThreadFiltered(state, keyOf(thread)));
}

/** A collapsed group keeps only the open thread, like upstream's collapsed shelves. */
const visibleRows = (rows: SidebarListItem[], collapsed: boolean, routeKey: string | null) =>
  collapsed ? rows.filter((row) => row.kind === "thread" && row.key === routeKey) : rows;

export function groupPinnedItems(
  rows: SidebarListItem[],
  state: SectionsView,
  routeKey: string | null,
): SidebarListItem[] {
  const shown = shownRows(rows, state);
  if (shown.length === 0) return shown;
  return [
    markerItem(PINNED_HEADER),
    ...visibleRows(shown, state.collapsed[PINNED_SECTION_KEY] === true, routeKey),
  ];
}

export function groupActiveItems(
  rows: SidebarListItem[],
  state: SectionsView,
  routeKey: string | null,
): SidebarListItem[] {
  const sections = shownSections(state);
  // Rows of filtered sections normally never get here; dropping them keeps headers honest.
  const shown = shownRows(rows, state);
  if (sections.length === 0) return shown;
  const loose: SidebarListItem[] = [];
  const bySection = new Map<string, SidebarListItem[]>(sections.map((section) => [section.id, []]));
  for (const row of shown) {
    const id = row.kind === "thread" ? sectionOfThread(state, row.key) : null;
    (id === null ? loose : bySection.get(id)!).push(row);
  }
  const items: SidebarListItem[] = [];
  for (const section of sections) {
    const collapsed = state.collapsed[section.id] === true;
    const sectionRows = bySection.get(section.id)!;
    items.push(markerItem(`${SECTION_HEADER}${section.id}`));
    if (!collapsed && sectionRows.length === 0) {
      items.push(markerItem(`${SECTION_EMPTY}${section.id}`));
    }
    items.push(...visibleRows(sectionRows, collapsed, routeKey));
  }
  items.push(
    markerItem(ACTIVE_HEADER),
    ...visibleRows(loose, state.collapsed[ACTIVE_SECTION_KEY] === true, routeKey),
  );
  return items;
}

/**
 * `sections` with shown section `id` moved to `to` among the shown ones; hidden sections keep
 * their places. Null when nothing moves.
 */
export function reorderShownSections<S extends { readonly id: string }>(
  sections: readonly S[],
  hidden: Readonly<Record<string, boolean>>,
  id: string,
  to: number,
): S[] | null {
  const shown = sections.filter((section) => hidden[section.id] !== true);
  const from = shown.findIndex((section) => section.id === id);
  if (from < 0 || to < 0 || to >= shown.length || to === from) return null;
  const section = shown[from]!;
  const newShown = shown.filter((_, index) => index !== from);
  newShown.splice(to, 0, section);
  const rest = sections.filter((candidate) => candidate.id !== id);
  // Anchor on the shown neighbour it now sits before (or after, at the end).
  const at =
    to < newShown.length - 1
      ? rest.findIndex((candidate) => candidate.id === newShown[to + 1]!.id)
      : rest.findIndex((candidate) => candidate.id === newShown[to - 1]!.id) + 1;
  rest.splice(at, 0, section);
  return rest;
}

/** The shown index a header dragged from `from` takes when dropped at the line before `boundary`. */
export const headerDropTarget = (from: number, boundary: number) =>
  boundary > from ? boundary - 1 : boundary;

/** Threads per group, counting rows hidden by a collapse. */
export function sectionCounts(
  state: Pick<SectionsView, "sections" | "membership">,
  activeKeys: readonly string[],
) {
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

/** The group of the first header after `from`, within the active region. */
function groupBelow(items: readonly SidebarListItem[], from: number): string | null {
  for (const item of items.slice(from)) {
    if (item.kind !== "marker") continue;
    if (isShelfMarker(item.marker)) return null;
    const fork = parseForkSidebarMarker(item.marker);
    if (fork?.kind === "section-header") return fork.id;
    if (fork?.kind === "active-header") return null;
  }
  return null;
}

/**
 * The section a drop puts `activeKey` in: a section id, null for Active, or undefined when the
 * row does not land among the active threads (pinned, settled, an invalid slot). A row above
 * every header joins the group of the first header below it.
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
  let section: string | null | undefined;
  const moved = moveItem(items, activeIndex, overIndex);
  for (const [index, item] of moved.entries()) {
    if (item.kind === "thread") {
      if (item.key !== activeKey) continue;
      if (!inActive) return undefined;
      return section === undefined ? groupBelow(moved, index + 1) : section;
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
