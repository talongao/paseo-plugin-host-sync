import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { HostSyncModal, openHostSync } from "./client/modal-host";
import { HostSyncScreen } from "./client/screen";

const ICON = "CloudUpload";

function HostSyncItem(props: PluginSidebarItemProps) {
  return (
    <>
      <SidebarRow icon={ICON} onPress={openHostSync} />
      <HostSyncModal theme={props.theme} host={props.host} layout={props.layout} />
    </>
  );
}

export default function contribute(client: PluginClientContext) {
  // Sidebar icon → dialog
  client.addSidebarHeaderItem({ id: "host-sync", title: "Host 备份", Component: HostSyncItem });

  // ⌘K → same dialog
  client.addCommandCenterItem({
    id: "open-host-backup",
    title: "Host 备份",
    icon: ICON,
    keywords: ["backup", "host", "github", "restore", "备份", "恢复"],
    context: "global",
    onSelect: () => openHostSync(),
  });

  // Settings → Hosts → ⋯ → Plugins keeps working too.
  client.addSettingsScreen({
    id: "host-sync-settings",
    title: "Host 备份",
    icon: ICON,
    Component: HostSyncScreen,
  });

  return () => {};
}
