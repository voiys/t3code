import { pluginHost } from "./host";
import { nodecodeIconPlugin } from "./packs/nodecode-icon";
import { sidebarSectionsPlugin } from "./packs/sidebar-sections";
import { splitViewPlugin } from "./packs/split-view";

const BUILTIN_PLUGINS = [splitViewPlugin, sidebarSectionsPlugin, nodecodeIconPlugin] as const;

let booted = false;

function bootstrapPlugins(): void {
  if (booted) return;
  booted = true;
  for (const plugin of BUILTIN_PLUGINS) {
    pluginHost.registerPlugin(plugin);
  }
}

bootstrapPlugins();
