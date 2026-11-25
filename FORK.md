# T3 Code Fork: Sidecar Plugins & Upstream Sync Guide

This fork keeps custom UI extensions isolated as toggleable sidecar plugins so rebasing onto fast-moving `upstream/main` stays small, typed, and agent-reconcilable.

## Architecture

- **Plugin host & UI:** `apps/web/src/plugins/`
  - `types.ts` — `T3Plugin`, `PluginContext` (Cordis-style reversible disposers), and narrow typed seam contracts.
  - `host.ts` — reactive plugin registry backed by `localStorage` (`t3code:fork:plugins:v1`), zero server/contracts edits.
  - `PluginsSettingsPanel.tsx` + `apps/web/src/routes/_chat.settings.plugins.tsx` — **Settings → Plugins** live toggle UI.
  - `bootstrap.ts` — registers compiled-in sidecar plugins at startup (imported by 1 line in `apps/web/src/main.tsx`).
- **Sidecar plugin packs (`apps/web/src/plugins/packs/`):**
  1. `split-view.ts` — wraps thread views with `apps/web/src/fork/split/*` (collapses cleanly on disable).
  2. `sidebar-sections.ts` — wires `apps/web/src/fork/sidebar/*` through `SidebarPluginExtension` (preserves stored sections on disable).
  3. `nodecode-icon/` — resolves bundled `nodecode-axolotl.svg` for local `nodecode` ACP providers.

## Upstream Glue Surface (~12 files)

All upstream files call generic plugin seams (no direct `fork/*` imports):

- `apps/web/src/main.tsx` — `import "./plugins/bootstrap";`
- `apps/web/src/components/ThreadRouteView.tsx` — `<ThreadLayoutSlot>`
- `apps/web/src/components/Sidebar.tsx`, `Sidebar.drag.ts`, `Sidebar.logic.ts`, `SidebarListMarkers.tsx` — `useSidebarPlugin()` / `getSidebarPlugin()`
- `apps/web/src/providerInstances.ts`, `ProviderInstanceIcon.tsx`, `ProviderInstanceCard.tsx`, `AcpRegistryIcon.tsx` — `resolveLocalAcpIconUrl` / `useLocalAcpIconUrl` / `useIsPluginBundledAcpIconUrl`
- `apps/web/src/components/settings/{settingsSearch.ts,SettingsSidebarNav.tsx,SettingsScopeSentence.tsx}` + `apps/web/src/routeTree.gen.ts` — **Settings → Plugins** nav & route entry
- `knip.jsonc` — entry allowlist for standalone fork scripts

## Agent Reconciliation Loop (on new upstream release)

1. **Inspect drift:**
   ```bash
   node scripts/fork-sync.ts status --json
   ```
2. **Rebase onto upstream (on a fresh `sync/<sha>` branch):**
   ```bash
   node scripts/fork-sync.ts rebase --ref upstream/main --json
   ```
   If conflicts occur, the JSON output lists every conflicted file plus the recent upstream commits that touched it. Keep upstream refactors and re-apply only the generic plugin seam calls.
3. **Verify types & plugin tests (fast):**
   ```bash
   node scripts/fork-sync.ts check --json
   ```
   (Run `vp run --filter @t3tools/web build` if a new route was added so TanStack Router refreshes `apps/web/src/routeTree.gen.ts`.)
4. **Open a reconciliation PR against `origin/mat`** and optionally rebuild desktop:
   ```bash
   node scripts/fork-sync.ts build-desktop        # fast local build
   node scripts/fork-sync.ts build-desktop --dmg  # macOS installable DMG
   ```
