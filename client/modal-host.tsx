import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { HostSyncScreen } from "./screen";

/**
 * Module-level store so the Command Center and the sidebar item can open the
 * same dialog. `Modal` is Paseo's own component (the ⌘K look).
 */
const listeners = new Set<(open: boolean) => void>();
let opened = false;

export function openHostSync(): void {
  opened = true;
  for (const listener of listeners) listener(true);
}

export function HostSyncModal({ theme, host, layout }: PluginHostProps) {
  const [open, setOpen] = useState(opened);
  const colors = theme.colors as Record<string, string>;

  useEffect(() => {
    const listener = (next: boolean) => setOpen(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <Modal
      title="Host 备份"
      icon={<Icon name="CloudUpload" color={colors.foreground} />}
      open={open}
      onOpenChange={(next) => {
        opened = next;
        setOpen(next);
      }}
    >
      {/* No fixed height: content-sized, scrolls once it outgrows the viewport. */}
      <Modal.Content style={{ maxHeight: 620 }} contentContainerStyle={{ paddingBottom: 8 }}>
        <View>
          <HostSyncScreen theme={theme} host={host} layout={layout} />
        </View>
      </Modal.Content>
    </Modal>
  );
}
