import { describe, expect, it } from "vite-plus/test";

import {
  resolveSidebarDropTarget,
  sidebarListItemId,
  type SidebarListItem,
  type SidebarListMarker,
} from "../../components/Sidebar.logic";
import {
  groupActiveItems,
  groupPinnedItems,
  headerDropTarget,
  projectForkRegions,
  reorderShownSections,
  sectionAtDrop,
  withoutHiddenSections,
} from "./sections.logic";
import { sidebarSectionActions, useForkSidebarSectionsStore } from "./sectionsStore";

const thread = (key: string, section: "pinned" | "active" | "settled"): SidebarListItem => ({
  kind: "thread",
  key,
  section,
});
const marker = (name: string): SidebarListItem => ({
  kind: "marker",
  marker: name as SidebarListMarker,
});
const ids = (items: readonly SidebarListItem[]) => items.map(sidebarListItemId);

const state = {
  sections: [{ id: "w", name: "Work" }],
  membership: { b: "w" },
  collapsed: {},
  hidden: {},
};

// pinned p · Work: b · Active: a · settled s
const list = (): SidebarListItem[] => [
  marker("pinned-header"),
  ...groupPinnedItems([thread("p", "pinned")], state, null),
  marker("pinned-divider"),
  marker("active-placeholder"),
  ...groupActiveItems([thread("a", "active"), thread("b", "active")], state, null),
  marker("settled-header"),
  marker("settled-placeholder"),
  thread("s", "settled"),
];

describe("fork sidebar sections", () => {
  it("groups active threads under their section headers, in order, with Active last", () => {
    const two = { ...state, sections: [{ id: "x", name: "X" }, ...state.sections] };
    expect(
      ids(groupActiveItems([thread("b", "active"), thread("a", "active")], two, null)),
    ).toEqual([
      "sidebar-marker-fork-section:x",
      "sidebar-marker-fork-section-empty:x",
      "sidebar-marker-fork-section:w",
      "b",
      "sidebar-marker-fork-active-header",
      "a",
    ]);
  });

  it("leaves the list untouched without sections", () => {
    const rows = [thread("a", "active")];
    const none = { sections: [], membership: {}, collapsed: {}, hidden: {} };
    expect(groupActiveItems(rows, none, null)).toBe(rows);
  });

  it("keeps only the open thread in a collapsed section", () => {
    const collapsed = { ...state, membership: { a: "w", b: "w" }, collapsed: { w: true } };
    const rows = [thread("a", "active"), thread("b", "active")];
    expect(ids(groupActiveItems(rows, collapsed, "b"))).toEqual([
      "sidebar-marker-fork-section:w",
      "b",
      "sidebar-marker-fork-active-header",
    ]);
  });

  it("puts a row dropped below a section header into that section", () => {
    expect(sectionAtDrop(list(), "a", "b")).toBe("w");
  });

  it("puts a row dragged down past the Active header back in Active", () => {
    expect(sectionAtDrop(list(), "b", "a")).toBeNull();
  });

  it("puts a row dropped above every header into the first group below it", () => {
    // B lands between the divider and Work's header, so the preview shows it atop Work.
    expect(sectionAtDrop(list(), "b", "sidebar-marker-fork-section:w")).toBe("w");
    expect(sectionAtDrop(list(), "a", "sidebar-marker-fork-section:w")).toBe("w");
  });

  it("reports no section for drops into pinned or settled", () => {
    expect(sectionAtDrop(list(), "a", "p")).toBeUndefined();
    expect(sectionAtDrop(list(), "a", "s")).toBeUndefined();
  });

  it("agrees with upstream on the target section and keeps headers out of its order", () => {
    const target = resolveSidebarDropTarget(list(), "a", "b");
    expect(target?.section).toBe("active");
    expect(target?.activeOrder).toEqual(["a", "b"]);
  });

  it("projects the active region with its headers in place during a drag", () => {
    const items = list();
    const from = items.findIndex((item) => sidebarListItemId(item) === "a");
    const over = items.findIndex((item) => sidebarListItemId(item) === "b");
    const projection = projectForkRegions(items, from, over, "active");
    expect(projection && ids(projection.active)).toEqual([
      "sidebar-marker-fork-section:w",
      "a",
      "b",
      "sidebar-marker-fork-active-header",
    ]);
    expect(projection?.coveredLabels).toEqual(new Set(["pinned-header", "pinned-divider"]));
  });

  it("reserves no placeholder space when headers fill the active region", () => {
    // Open A sits in a section; loose B is hidden by a collapsed Active; A drags toward Settled.
    const collapsedActive = {
      sections: [{ id: "w", name: "Work" }],
      membership: { a: "w" },
      collapsed: { active: true },
      hidden: {},
    };
    const items: SidebarListItem[] = [
      marker("pinned-header"),
      marker("pinned-divider"),
      marker("active-placeholder"),
      ...groupActiveItems([thread("a", "active"), thread("b", "active")], collapsedActive, "a"),
      marker("settled-header"),
      marker("settled-placeholder"),
    ];
    const from = items.findIndex((item) => sidebarListItemId(item) === "a");
    const over = items.findIndex(
      (item) => sidebarListItemId(item) === "sidebar-marker-settled-header",
    );
    const projection = projectForkRegions(items, from, over, "settled");
    expect(projection && ids(projection.active)).toEqual([
      "sidebar-marker-fork-section:w",
      "sidebar-marker-fork-active-header",
    ]);
  });
});

describe("hidden sections", () => {
  const hiddenWork = { ...state, hidden: { w: true } };

  it("drops a hidden section's threads from every list, not just Active", () => {
    const keys = ["a", "b", "p"];
    const pinnedInWork = { ...hiddenWork, membership: { b: "w", p: "w" } };
    expect(withoutHiddenSections(keys, pinnedInWork, (key) => key)).toEqual(["a"]);
    expect(withoutHiddenSections(keys, state, (key) => key)).toBe(keys);
  });

  it("shows no header for a hidden section, and no Active header without shown sections", () => {
    const rows = [thread("a", "active")];
    expect(ids(groupActiveItems(rows, hiddenWork, null))).toEqual(["a"]);
    const two = { ...hiddenWork, sections: [...state.sections, { id: "x", name: "X" }] };
    expect(ids(groupActiveItems(rows, two, null))).toEqual([
      "sidebar-marker-fork-section:x",
      "sidebar-marker-fork-section-empty:x",
      "sidebar-marker-fork-active-header",
      "a",
    ]);
  });

  it("forgets a deleted section's hidden flag and reorders the rest", () => {
    useForkSidebarSectionsStore.setState({
      sections: [],
      membership: {},
      collapsed: {},
      hidden: {},
    });
    const one = sidebarSectionActions.create("One");
    const two = sidebarSectionActions.create("Two");
    const three = sidebarSectionActions.create("Three");
    sidebarSectionActions.toggleHidden(one);
    sidebarSectionActions.reorderShown(three, 0);
    // One is hidden, so Three moves above Two only; One keeps its place in front.
    expect(useForkSidebarSectionsStore.getState().sections.map(({ id }) => id)).toEqual([
      one,
      three,
      two,
    ]);
    sidebarSectionActions.remove(one);
    expect(useForkSidebarSectionsStore.getState().hidden).toEqual({});
  });
});

describe("dragging section headers", () => {
  const sections = ["a", "h", "b", "c"].map((id) => ({ id }));
  const order = (result: { id: string }[] | null) => result?.map(({ id }) => id) ?? null;

  it("drops at the line the pointer showed, counted among shown sections", () => {
    // Shown: a, b, c (h hidden). C dragged to the line before A.
    expect(order(reorderShownSections(sections, { h: true }, "c", headerDropTarget(2, 0)))).toEqual(
      ["c", "a", "h", "b"],
    );
    // A dragged to the last line, right above Active.
    expect(order(reorderShownSections(sections, { h: true }, "a", headerDropTarget(0, 3)))).toEqual(
      ["h", "b", "c", "a"],
    );
  });

  it("leaves the order alone for the lines on either side of the dragged header", () => {
    expect(reorderShownSections(sections, {}, "b", headerDropTarget(2, 2))).toBeNull();
    expect(reorderShownSections(sections, {}, "b", headerDropTarget(2, 3))).toBeNull();
  });
});
