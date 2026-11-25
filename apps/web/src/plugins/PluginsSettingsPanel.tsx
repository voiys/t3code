import { T, useGT, useMessages, Var } from "gt-react";
import { RotateCcwIcon } from "lucide-react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { pluginHost, usePluginSnapshots } from "./host";
import type { T3PluginCategory } from "./types";

const CATEGORY_LABEL: Readonly<Record<T3PluginCategory, string>> = {
  layout: "Layout",
  sidebar: "Sidebar",
  providers: "Providers",
  other: "Other",
};

export function PluginsSettingsPanel() {
  const gt = useGT();
  const m = useMessages();
  const plugins = usePluginSnapshots();
  const hasOverrides = plugins.some((plugin) => plugin.enabled !== plugin.defaultEnabled);

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="plugins"
        title={gt("Plugins")}
        headerAction={
          hasOverrides ? (
            <Button size="xs" variant="ghost" onClick={() => pluginHost.resetAllPlugins()}>
              <RotateCcwIcon className="size-3.5" />
              <span>
                <T>Reset defaults</T>
              </span>
            </Button>
          ) : undefined
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">
          <T>
            Sidecar extensions bundled in this fork. Toggle any plugin on or off live without
            restarting.
          </T>
        </p>
        {plugins.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            <T>No plugins registered.</T>
          </p>
        ) : (
          plugins.map((plugin) => (
            <SettingsRow
              key={plugin.id}
              id={`plugin-${plugin.id}`}
              title={
                <span className="inline-flex items-center gap-2">
                  <span>{plugin.name}</span>
                  <Badge variant="outline" size="sm">
                    {CATEGORY_LABEL[plugin.category]}
                  </Badge>
                  <span className="font-mono text-2xs font-normal text-muted-foreground">
                    v{plugin.version}
                  </span>
                </span>
              }
              description={
                plugin.error ? (
                  <span className="text-destructive">
                    <T>
                      Activation error: <Var>{plugin.error}</Var>
                    </T>
                  </span>
                ) : (
                  m(plugin.description)
                )
              }
              control={
                <Switch
                  checked={plugin.enabled}
                  onCheckedChange={(checked) =>
                    pluginHost.setPluginEnabled(plugin.id, Boolean(checked))
                  }
                  aria-label={gt("Toggle {name}", { name: plugin.name })}
                />
              }
            >
              {plugin.enabled && plugin.renderSettings ? (
                <div className="mt-2">{plugin.renderSettings()}</div>
              ) : null}
            </SettingsRow>
          ))
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
