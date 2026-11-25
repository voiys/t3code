import { createFileRoute } from "@tanstack/react-router";
import { PluginsSettingsPanel } from "../plugins/PluginsSettingsPanel";

export const Route = createFileRoute("/_chat/settings/plugins")({
  component: PluginsSettingsPanel,
});
