import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  applyBackupBodies,
  buildBackupBody,
  hostRows,
  openBackup,
  readRegistry,
  reloadPage,
  sealBackup,
} from "./backup";
import {
  backupFileName,
  clearAllBackups,
  isEncryptedName,
  listBackups,
  parseBackupName,
  pruneBackups,
  readBackupFile,
  settingsSummary,
  verifyRepo,
  writeBackupFile,
  type RemoteFile,
} from "./github";
import { isConfigured, loadSettings, saveSettings, type GitHubSettings } from "./settings";

type Tab = "backup" | "restore" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "backup", label: "备份" },
  { id: "restore", label: "恢复" },
  { id: "settings", label: "设置" },
];

const FONT = "var(--paseo-ui-font)";

function formatSize(bytes: number): string {
  if (!bytes) return "";
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function describeRestore(result: ReturnType<typeof applyBackupBodies>): string {
  const parts = [`写入 ${result.added + result.replaced} 台 host`];
  if (result.cleaned > 0) parts.push(`清理 ${result.cleaned} 条失效连接`);
  if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 台只有本机 TCP`);
  return `已恢复：${parts.join(" · ")}`;
}

export function HostSyncScreen({ theme, host }: PluginSurfaceProps) {
  const toast = useToast();
  const colors = theme.colors as Record<string, string>;

  const [settings, setSettings] = useState<GitHubSettings>(() => loadSettings());
  const [draft, setDraft] = useState<GitHubSettings>(() => loadSettings());
  const [tab, setTab] = useState<Tab>(() => (isConfigured(loadSettings()) ? "backup" : "settings"));
  const [hostCount, setHostCount] = useState(() => readRegistry().length);
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [refreshPrompt, setRefreshPrompt] = useState<string | null>(null);

  const patch = (changes: Partial<GitHubSettings>) => setDraft((current) => ({ ...current, ...changes }));

  const refreshFiles = useCallback(
    async (config: GitHubSettings, quiet = false) => {
      if (!isConfigured(config)) {
        setFiles([]);
        return;
      }
      try {
        setFiles(await listBackups(config));
      } catch (error) {
        if (!quiet) toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [toast],
  );

  useEffect(() => {
    void refreshFiles(settings, true);
  }, [refreshFiles, settings]);

  const onBackup = async () => {
    if (!isConfigured(settings)) {
      setTab("settings");
      toast.error("先在设置里填好仓库和 token");
      return;
    }
    if (settings.encrypt && settings.password.length < 8) {
      setTab("settings");
      toast.error("已开启加密，但密码不足 8 位");
      return;
    }
    setBusy(true);
    try {
      const body = buildBackupBody();
      if (body.hosts.length === 0) {
        toast.error("本地没有 host 可备份");
        return;
      }
      const sealed = await sealBackup(body, settings.encrypt ? settings.password : null);
      const name = backupFileName(new Date(), settings.encrypt, host.label || host.id);
      await writeBackupFile(settings, name, sealed);

      const after = await listBackups(settings);
      const pruned = await pruneBackups(settings, after);
      const notes = [`已备份 ${body.hosts.length} 台 host`];
      if (pruned.removed.length > 0) notes.push(`清理 ${pruned.removed.length} 份旧快照`);
      toast.show(notes.join(" · "));
      await refreshFiles(settings, true);
      setHostCount(readRegistry().length);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async (file: RemoteFile) => {
    if (isEncryptedName(file.name) && settings.password.length === 0) {
      setTab("settings");
      toast.error("这份备份是加密的，先在设置里填密码");
      return;
    }
    setBusy(true);
    try {
      const json = await readBackupFile(settings, file.name);
      const body = await openBackup(json, settings.password || null);
      const result = applyBackupBodies([body], { selfServerId: host.id });
      setDirty(true);
      setHostCount(readRegistry().length);
      setRefreshPrompt(describeRestore(result));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onSave = () => {
    saveSettings(draft);
    const next = loadSettings();
    setSettings(next);
    setDraft(next);
    toast.show("设置已保存");
    void refreshFiles(next, true);
  };

  const onTest = async () => {
    setBusy(true);
    try {
      const result = await verifyRepo(draft);
      if (result.canWrite) toast.show(`连接成功 · 默认分支 ${result.defaultBranch || "未知"}`);
      else toast.error("能连上仓库，但 token 没有写权限");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      const removed = await clearAllBackups(settings);
      setFiles([]);
      toast.show(`已删除 ${removed} 份快照`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const rows = hostRows(host.id);

  return (
    <View style={{ gap: 16, paddingBottom: 24 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(item.id)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 7,
                backgroundColor: active ? colors.accent : "transparent",
                borderWidth: active ? 0 : 1,
                borderColor: colors.border,
              }}
            >
              <Text
                style={{
                  fontFamily: FONT,
                  fontSize: 13,
                  fontWeight: active ? "600" : "400",
                  color: active ? colors.accentForeground : colors.foregroundMuted ?? colors.foreground,
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === "backup" ? (
        <>
          <SettingsSection
            title="备份"
            info="把当前浏览器的 host 列表加密后推到 GitHub。恢复时合并进本地，不覆盖已有 host。"
          >
            <SettingsCard>
              <SettingsAction
                label="立即备份"
                hint={`${hostCount} 台 host → ${settingsSummary(settings)}`}
                actionLabel={busy ? "处理中…" : "备份"}
                disabled={busy}
                onPress={() => void onBackup()}
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={`当前 host（${rows.length}）`} info="带「当前」标记的是这个浏览器连着的 daemon。">
            <SettingsCard>
              {rows.length === 0 ? <SettingsRow label="还没有 host" hint="先在 Paseo 里添加一个 host" /> : null}
              {rows.map((row) => (
                <SettingsRow
                  key={row.serverId}
                  label={row.isSelf ? `${row.label}（当前）` : row.label}
                  hint={`${row.address}${row.connectionCount > 1 ? ` +${row.connectionCount - 1}` : ""}`}
                />
              ))}
            </SettingsCard>
          </SettingsSection>
        </>
      ) : null}

      {tab === "restore" ? (
        <SettingsSection title="快照" info="点「恢复」合并这一份；同名 host 会合并连接，不会删除本机已有的项。">
          <SettingsCard>
            <SettingsAction
              label="刷新列表"
              hint={`${files.length} 份备份`}
              actionLabel="刷新"
              disabled={busy}
              onPress={() => void refreshFiles(settings)}
            />
            {files.length === 0 ? (
              <SettingsRow
                label={isConfigured(settings) ? "还没有备份" : "还没配置仓库"}
                hint={isConfigured(settings) ? "切到「备份」点立即备份" : "切到「设置」填仓库和 token"}
              />
            ) : null}
            {files.map((file) => {
              const meta = parseBackupName(file.name);
              const encrypted = meta.encrypted || isEncryptedName(file.name);
              return (
                <SettingsAction
                  key={file.name}
                  label={meta.tag ? `${meta.at} · ${meta.tag}` : meta.at}
                  hint={[encrypted ? "加密" : "明文", formatSize(file.size)].filter(Boolean).join(" · ")}
                  actionLabel="恢复"
                  disabled={busy}
                  onPress={() => void onRestore(file)}
                />
              );
            })}
            {files.length > 0 ? (
              <SettingsAction
                label="清空全部快照"
                hint="只删除 GitHub 上的备份文件"
                actionLabel="清空"
                disabled={busy}
                onPress={() => void onClear()}
              />
            ) : null}
          </SettingsCard>
        </SettingsSection>
      ) : null}

      {tab === "settings" ? (
        <>
          <SettingsSection title="GitHub" info="token 和密码只保存在这个浏览器，不会上传到 daemon。">
            <SettingsCard>
              <SettingsInput
                label="仓库"
                hint="owner/repo 或完整链接"
                placeholder="owner/repo"
                initialValue={draft.repo}
                onChangeText={(value) => patch({ repo: value })}
              />
              <SettingsInput
                label="分支"
                hint="留空使用默认分支"
                placeholder="main"
                initialValue={draft.branch}
                onChangeText={(value) => patch({ branch: value })}
              />
              <SettingsInput
                label="目录"
                hint="留空使用仓库根目录"
                placeholder="hosts"
                initialValue={draft.dir}
                onChangeText={(value) => patch({ dir: value })}
              />
              <SettingsInput
                label="Token"
                hint="需要 Contents 读写权限"
                placeholder="github_pat_…"
                initialValue={draft.token}
                secureTextEntry
                onChangeText={(value) => patch({ token: value })}
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="加密">
            <SettingsCard>
              <SettingsSwitch
                label="加密备份"
                hint="PBKDF2-SHA256（310k）+ AES-256-GCM，GitHub 上只存密文"
                value={draft.encrypt}
                onValueChange={(value) => patch({ encrypt: value })}
              />
              {draft.encrypt ? (
                <SettingsInput
                  label="备份密码"
                  hint="至少 8 位，用于加解密备份文件"
                  placeholder="至少 8 位"
                  initialValue={draft.password}
                  secureTextEntry
                  onChangeText={(value) => patch({ password: value })}
                />
              ) : null}
              <SettingsSwitch
                label="记住密码"
                hint="关闭后不写入本地存储，只在本页使用"
                value={draft.rememberPassword}
                onValueChange={(value) => patch({ rememberPassword: value })}
              />
              <SettingsInput
                label="保留份数"
                hint="备份后自动删除超出份数的最旧快照，0 表示不限"
                placeholder="10"
                initialValue={String(draft.keep)}
                onChangeText={(value) => patch({ keep: Number(value.replace(/\D/g, "")) || 0 })}
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="保存">
            <SettingsCard>
              <SettingsAction
                label="保存设置"
                hint={settingsSummary(settings)}
                actionLabel="保存"
                disabled={busy}
                onPress={onSave}
              />
              <SettingsAction
                label="测试连接"
                hint="验证仓库可访问且 token 有写权限"
                actionLabel="测试"
                disabled={busy}
                onPress={() => void onTest()}
              />
            </SettingsCard>
          </SettingsSection>
        </>
      ) : null}

      <Modal
        title="恢复完成"
        icon={<Icon name="CloudUpload" color={colors.foreground} />}
        open={refreshPrompt !== null}
        onOpenChange={(next) => {
          if (!next) setRefreshPrompt(null);
        }}
      >
        <Modal.Content contentContainerStyle={{ padding: 18, gap: 16 }}>
          <Text
            style={{
              fontFamily: FONT,
              fontSize: 14,
              lineHeight: 20,
              color: colors.foreground,
            }}
          >
            {refreshPrompt}
          </Text>
          <Text
            style={{
              fontFamily: FONT,
              fontSize: 13,
              lineHeight: 18,
              color: colors.foregroundMuted ?? colors.foreground,
            }}
          >
            新的 host 列表要刷新页面后才会出现在侧边栏里。现在刷新吗？
          </Text>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setRefreshPrompt(null)}
              style={{
                paddingVertical: 7,
                paddingHorizontal: 14,
                borderRadius: 7,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ fontFamily: FONT, fontSize: 13, color: colors.foreground }}>稍后</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setRefreshPrompt(null);
                reloadPage();
              }}
              style={{
                paddingVertical: 7,
                paddingHorizontal: 14,
                borderRadius: 7,
                backgroundColor: colors.accent,
              }}
            >
              <Text style={{ fontFamily: FONT, fontSize: 13, color: colors.accentForeground }}>
                立即刷新
              </Text>
            </Pressable>
          </View>
        </Modal.Content>
      </Modal>

      {dirty ? (
        <SettingsSection title="需要刷新">
          <SettingsCard>
            <SettingsAction
              label="本地 host 列表已更新"
              hint="刷新页面后侧边栏才会显示新的 host"
              actionLabel="刷新"
              onPress={reloadPage}
            />
          </SettingsCard>
        </SettingsSection>
      ) : null}
    </View>
  );
}
