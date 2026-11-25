import { msg } from "gt-react";

import { ThreadSplitLayout } from "../../fork/split/ThreadSplitLayout";
import { useThreadSplitStore } from "../../fork/split/threadSplitStore";
import type { T3Plugin } from "../types";

export const splitViewPlugin: T3Plugin = {
  id: "split-view",
  name: "Split View Grid",
  description: msg(
    "Open multiple threads side by side in a resizable grid with settle-dissolve transitions and Cmd+W pane closing.",
  ),
  version: "0.1.0",
  category: "layout",
  defaultEnabled: true,
  activate(ctx) {
    ctx.registerThreadLayout(ThreadSplitLayout);
    return () => {
      // Collapse any open split grid cleanly back to the active route thread.
      useThreadSplitStore.setState({
        rows: [],
        focusedSlotId: null,
        columnWeights: {},
        rowWeights: [],
      });
    };
  },
};
