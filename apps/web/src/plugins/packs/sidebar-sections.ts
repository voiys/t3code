import { msg } from "gt-react";

import {
  ForkHiddenSectionsDot,
  ForkSectionFilter,
  ForkSidebarMarkerRow,
  handleSectionMenuChoice,
  withSectionMenu,
} from "../../fork/sidebar/ForkSidebarSections";
import {
  groupActiveItems,
  groupPinnedItems,
  projectForkRegions,
  sectionAtDrop,
  sectionOfThread,
  withoutHiddenSections,
} from "../../fork/sidebar/sections.logic";
import {
  sidebarSectionActions,
  useForkSidebarSectionsStore,
} from "../../fork/sidebar/sectionsStore";
import type { SidebarPluginExtension, T3Plugin } from "../types";

type SidebarSectionsState = ReturnType<typeof useForkSidebarSectionsStore.getState>;

const sidebarSectionsExtension: SidebarPluginExtension<SidebarSectionsState> = {
  subscribeState: (listener) => useForkSidebarSectionsStore.subscribe(listener),
  getStateSnapshot: () => useForkSidebarSectionsStore.getState(),
  filterThreads: withoutHiddenSections,
  groupPinnedItems,
  groupActiveItems,
  projectDragRegions: projectForkRegions,
  sectionAtDrop,
  sectionOfThread,
  assignThreads: sidebarSectionActions.assign,
  extendThreadContextMenu: withSectionMenu,
  handleThreadContextMenuChoice: handleSectionMenuChoice,
  HiddenSectionsDot: ForkHiddenSectionsDot,
  SectionFilter: ForkSectionFilter,
  MarkerRow: ForkSidebarMarkerRow,
};

export const sidebarSectionsPlugin: T3Plugin = {
  id: "sidebar-sections",
  name: "Sidebar Sections",
  description: msg(
    "Group sidebar threads into collapsible named sections with header drag reordering, section filtering, and context menu moves.",
  ),
  version: "0.1.0",
  category: "sidebar",
  defaultEnabled: true,
  activate(ctx) {
    ctx.registerSidebarExtension(sidebarSectionsExtension);
  },
};
