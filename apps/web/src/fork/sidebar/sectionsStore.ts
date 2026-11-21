import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

/**
 * Fork-only sidebar sections: named groups of active threads, kept on this device. Pinned and
 * Active (the threads in no section) collapse too, under the keys below.
 */
export const PINNED_SECTION_KEY = "pinned";
export const ACTIVE_SECTION_KEY = "active";

export interface SidebarSectionDef {
  readonly id: string;
  readonly name: string;
}

export interface ForkSidebarSectionsState {
  sections: SidebarSectionDef[];
  /** Section id by scoped thread key. */
  membership: Record<string, string>;
  /** Collapsed sections by section id, PINNED_SECTION_KEY or ACTIVE_SECTION_KEY. */
  collapsed: Record<string, boolean>;
  /** The section whose name is being edited inline; not persisted. */
  editingSectionId: string | null;
}

const INITIAL_STATE: ForkSidebarSectionsState = {
  sections: [],
  membership: {},
  collapsed: {},
  editingSectionId: null,
};

export const useForkSidebarSectionsStore = create<ForkSidebarSectionsState>()(
  persist(() => INITIAL_STATE, {
    name: "t3code-fork:sidebar-sections:v1",
    storage: createJSONStorage(() =>
      resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    ),
    version: 1,
    partialize: ({ sections, membership, collapsed }) => ({ sections, membership, collapsed }),
    migrate: () => INITIAL_STATE,
  }),
);

const get = () => useForkSidebarSectionsStore.getState();
const set = (partial: Partial<ForkSidebarSectionsState>) =>
  useForkSidebarSectionsStore.setState(partial);

let sectionSeq = 0;
const newSectionId = () =>
  `sec-${Date.now().toString(36)}${(sectionSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const sidebarSectionActions = {
  /** Creates a section (moving `threadKeys` into it) and starts editing its name. */
  create(name: string, threadKeys: readonly string[] = []): string {
    const id = newSectionId();
    const membership = { ...get().membership };
    for (const key of threadKeys) membership[key] = id;
    set({ sections: [...get().sections, { id, name }], membership, editingSectionId: id });
    return id;
  },
  rename(id: string, name: string) {
    const trimmed = name.trim();
    set({
      editingSectionId: null,
      ...(trimmed.length === 0
        ? {}
        : {
            sections: get().sections.map((section) =>
              section.id === id ? { ...section, name: trimmed } : section,
            ),
          }),
    });
  },
  startEditing(id: string | null) {
    set({ editingSectionId: id });
  },
  /** Deletes a section; its threads go back to Active. */
  remove(id: string) {
    const membership = Object.fromEntries(
      Object.entries(get().membership).filter(([, sectionId]) => sectionId !== id),
    );
    const { [id]: _removed, ...collapsed } = get().collapsed;
    set({ sections: get().sections.filter((section) => section.id !== id), membership, collapsed });
  },
  move(id: string, delta: -1 | 1) {
    const sections = [...get().sections];
    const from = sections.findIndex((section) => section.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= sections.length) return;
    [sections[from], sections[to]] = [sections[to]!, sections[from]!];
    set({ sections });
  },
  /** Puts threads in a section, or back in Active when `sectionId` is null. */
  assign(threadKeys: readonly string[], sectionId: string | null) {
    const membership = { ...get().membership };
    for (const key of threadKeys) {
      if (sectionId === null) delete membership[key];
      else membership[key] = sectionId;
    }
    set({ membership });
  },
  toggleCollapsed(key: string) {
    set({ collapsed: { ...get().collapsed, [key]: !get().collapsed[key] } });
  },
  /** Collapses or expands Pinned, Active and every section at once. */
  setAllCollapsed(collapsed: boolean) {
    const keys = [PINNED_SECTION_KEY, ACTIVE_SECTION_KEY, ...get().sections.map(({ id }) => id)];
    set({ collapsed: Object.fromEntries(keys.map((key) => [key, collapsed])) });
  },
};
