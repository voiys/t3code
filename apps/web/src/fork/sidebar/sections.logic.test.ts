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
  projectForkRegions,
  sectionAtDrop,
} from "./sections.logic";

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
};

// pinned p · active a, b (b in Work) · settled s
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
  it("groups active threads under their section headers, loose ones first", () => {
    expect(
      ids(groupActiveItems([thread("b", "active"), thread("a", "active")], state, null)),
    ).toEqual(["sidebar-marker-fork-active-header", "a", "sidebar-marker-fork-section:w", "b"]);
  });

  it("leaves the list untouched without sections", () => {
    const rows = [thread("a", "active")];
    expect(groupActiveItems(rows, { sections: [], membership: {}, collapsed: {} }, null)).toBe(
      rows,
    );
  });

  it("keeps only the open thread in a collapsed section", () => {
    const collapsed = { ...state, membership: { a: "w", b: "w" }, collapsed: { w: true } };
    const rows = [thread("a", "active"), thread("b", "active")];
    expect(ids(groupActiveItems(rows, collapsed, "b"))).toEqual([
      "sidebar-marker-fork-active-header",
      "sidebar-marker-fork-section:w",
      "b",
    ]);
  });

  it("puts a row dropped below a section header into that section", () => {
    expect(sectionAtDrop(list(), "a", "b")).toBe("w");
  });

  it("puts a row dragged up past the header back in Active", () => {
    expect(sectionAtDrop(list(), "b", "sidebar-marker-fork-section:w")).toBeNull();
  });

  it("reports no section for drops into pinned or settled", () => {
    expect(sectionAtDrop(list(), "a", "p")).toBeUndefined();
    expect(sectionAtDrop(list(), "a", "s")).toBeUndefined();
  });

  it("agrees with upstream on the target section and keeps headers out of its order", () => {
    const target = resolveSidebarDropTarget(list(), "a", "b");
    expect(target?.section).toBe("active");
    expect(target?.activeOrder).toEqual(["b", "a"]);
  });

  it("projects the active region with its headers in place during a drag", () => {
    const items = list();
    const from = items.findIndex((item) => sidebarListItemId(item) === "a");
    const over = items.findIndex((item) => sidebarListItemId(item) === "b");
    const projection = projectForkRegions(items, from, over, "active");
    expect(projection && ids(projection.active)).toEqual([
      "sidebar-marker-fork-active-header",
      "sidebar-marker-fork-section:w",
      "b",
      "a",
    ]);
    expect(projection?.coveredLabels).toEqual(new Set(["pinned-header", "pinned-divider"]));
  });

  it("reserves no placeholder space when headers fill the active region", () => {
    // Open A sits in a section; loose B is hidden by a collapsed Active; A drags toward Settled.
    const collapsedActive = {
      sections: [{ id: "w", name: "Work" }],
      membership: { a: "w" },
      collapsed: { active: true },
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
      "sidebar-marker-fork-active-header",
      "sidebar-marker-fork-section:w",
    ]);
  });
});
