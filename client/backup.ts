import { mergeProfiles, parseProfiles, type HostProfile } from "../shared/sync-core";
import { decryptBackup, encryptBackup } from "../shared/crypto";
import { getGlobal } from "./dom";

export const REGISTRY_KEY = "@paseo:daemon-registry";

export interface HostRow {
  serverId: string;
  label: string;
  address: string;
  connectionCount: number;
  isSelf: boolean;
}

export interface BackupBody {
  v: 2;
  at: string;
  app: string;
  hosts: HostProfile[];
}

export interface RestoreResult {
  /** backups handed in */
  backups: number;
  total: number;
  added: number;
  replaced: number;
  /** backup entries dropped because only a foreign loopback TCP was available */
  skipped: number;
  skippedLabels: string[];
  /** stale loopback connections stripped from this browser's existing entries */
  cleaned: number;
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])(:|$)/i;

function store(): any {
  try {
    return getGlobal()?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readRegistry(): HostProfile[] {
  try {
    return parseProfiles(store()?.getItem(REGISTRY_KEY) ?? null);
  } catch {
    return [];
  }
}

function writeRegistry(hosts: HostProfile[]): void {
  try {
    store()?.setItem(REGISTRY_KEY, JSON.stringify(hosts));
  } catch {
    // ignore
  }
}

export function reloadPage(): void {
  try {
    getGlobal()?.location?.reload?.();
  } catch {
    // ignore
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function describeConnection(connection: unknown): string {
  if (!connection || typeof connection !== "object") return "";
  const c = connection as Record<string, unknown>;
  const type = text(c.type);
  const listen = text(c.listen);
  const host = text(c.host);
  const endpoint = text(c.endpoint);
  const socketPath = text(c.path) || text(c.socketPath);
  switch (type) {
    case "directTcp": {
      const where = listen || [host, c.port].filter((v) => v !== undefined && v !== "").join(":");
      return where ? `${where}${c.useTls ? " · tls" : ""}` : "";
    }
    case "relay":
      return endpoint ? `relay ${endpoint}` : "relay";
    case "unixSocket":
    case "socket":
      return socketPath ? `unix ${socketPath}` : "";
    case "ssh":
      return host ? `ssh ${host}` : "ssh";
    default:
      return listen || endpoint || host || socketPath || type;
  }
}

/** A direct TCP connection that can only ever reach the daemon on the same machine. */
export function isLoopbackConnection(connection: unknown): boolean {
  if (!connection || typeof connection !== "object") return false;
  const c = connection as Record<string, unknown>;
  if (c.type !== "directTcp" && c.type !== undefined) return false;
  const listen = text(c.listen);
  const host = text(c.host);
  const candidate = listen || (host ? `${host}:${c.port ?? ""}` : "");
  if (!candidate) return false;
  if (LOOPBACK.test(candidate)) return true;
  const hostPart = candidate.replace(/^\[|\]$/g, "").split(":")[0] ?? "";
  return !hostPart.includes(".") && hostPart !== "::1";
}

export function hostRows(selfServerId = ""): HostRow[] {
  const hosts = readRegistry();
  const selfId = selfServerId;
  return hosts
    .map((host) => {
      const connections = Array.isArray(host.connections) ? host.connections : [];
      const preferred =
        connections.find((c) => c && c.id === host.preferredConnectionId) ?? connections[0] ?? null;
      return {
        serverId: host.serverId,
        label: text(host.label) || host.serverId,
        address: describeConnection(preferred),
        connectionCount: connections.length,
        isSelf: host.serverId === selfId,
      };
    })
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.label.localeCompare(b.label));
}

function preferConnection(host: HostProfile, preferLoopback: boolean): HostProfile {
  const connections = Array.isArray(host.connections) ? host.connections : [];
  const wanted = (connection: unknown) =>
    preferLoopback ? isLoopbackConnection(connection) : !isLoopbackConnection(connection);
  const current = connections.find((c) => c && c.id === host.preferredConnectionId);
  if (current && wanted(current)) return host;
  const target = connections.find(wanted);
  if (!target) return host;
  return { ...host, preferredConnectionId: (target.id as string | undefined) ?? null };
}

function fold(hosts: readonly HostProfile[]): HostProfile[] {
  let acc: HostProfile[] = [];
  for (const host of hosts) acc = mergeProfiles(acc, [host], {});
  return acc;
}

export function buildBackupBody(): BackupBody {
  // Loopback TCP stays in the backup: it is how a later restore recognises this machine.
  return { v: 2, at: new Date().toISOString(), app: "paseo", hosts: readRegistry() };
}

/** Accepts both an encrypted envelope and a plaintext backup body. */
export function looksEncrypted(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return typeof parsed?.data === "string" && typeof parsed?.iv === "string" && typeof parsed?.salt === "string";
  } catch {
    return false;
  }
}

export async function sealBackup(body: BackupBody, password: string | null): Promise<string> {
  const plaintext = JSON.stringify(body);
  return password ? encryptBackup(password, plaintext) : plaintext;
}

export async function openBackup(json: string, password: string | null): Promise<BackupBody> {
  const plaintext = looksEncrypted(json) ? await decryptBackup(password ?? "", json) : json;
  let parsed: any;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error("备份内容不是有效 JSON");
  }
  if (!parsed || !Array.isArray(parsed.hosts)) throw new Error("备份内容缺少 host 列表");
  const hosts = parseProfiles(JSON.stringify(parsed.hosts));
  if (hosts.length === 0) throw new Error("备份里没有可恢复的 host");
  return { v: 2, at: text(parsed.at), app: text(parsed.app), hosts };
}

/**
 * Merge every decrypted backup into the local registry.
 *
 * Loopback TCP connections of other machines are dropped, because on this
 * machine `localhost:6767` would point at the local daemon instead.
 */
export interface RestoreOptions {
  /** serverId of the daemon this client is attached to (plugin host.id) */
  selfServerId: string;
}

/**
 * Normalise one entry for this machine:
 *  - a loopback TCP only means something on the daemon that owns it, so for
 *    every other host it is dropped (`localhost:6767` would hit the wrong box)
 *  - keep only the direct connection for the local daemon
 */
function normalizeHost(
  host: HostProfile,
  options: RestoreOptions,
): { host: HostProfile; dropped: number } | null {
  const knowsSelf = options.selfServerId.length > 0;
  const isSelf = knowsSelf && host.serverId === options.selfServerId;

  let connections = Array.isArray(host.connections) ? host.connections : [];
  const before = connections.length;

  if (knowsSelf) {
    if (!isSelf) {
      connections = connections.filter((connection) => !isLoopbackConnection(connection));
    } else {
      // Local daemon: a direct connection always wins over relay/ssh.
      const loopback = connections.filter(isLoopbackConnection);
      if (loopback.length > 0) connections = loopback;
    }
  }

  if (connections.length === 0) return null;

  const preferred = connections.some((c) => c && c.id === host.preferredConnectionId)
    ? host.preferredConnectionId
    : ((connections[0]?.id as string | undefined) ?? null);

  return {
    host: preferConnection({ ...host, connections, preferredConnectionId: preferred }, isSelf),
    dropped: before - connections.length,
  };
}

/**
 * Merge every decrypted backup into the local registry.
 *
 * Never overwrites: connections are unioned, local-only hosts are kept, and
 * repeating the same restore is idempotent.
 */
export function applyBackupBodies(
  bodies: readonly BackupBody[],
  options: RestoreOptions,
): RestoreResult {
  const local = readRegistry();
  const localIds = new Set(local.map((host) => host.serverId));

  // Strip credentials that can only belong to another machine from what we already have.
  const cleanedLocal: HostProfile[] = [];
  let cleaned = 0;
  for (const host of local) {
    const normalised = normalizeHost(host, options);
    if (!normalised) continue;
    if (normalised.dropped > 0) cleaned += 1;
    cleanedLocal.push(normalised.host);
  }

  const candidates: HostProfile[] = [];
  const skippedLabels: string[] = [];
  let total = 0;

  for (const body of bodies) {
    total += body.hosts.length;
    for (const host of body.hosts) {
      const normalised = normalizeHost(host, options);
      if (!normalised) {
        skippedLabels.push(text(host.label) || host.serverId);
        continue;
      }
      candidates.push(normalised.host);
    }
  }

  const folded = fold(candidates);

  // Run the same normalisation again after the union: merging can bring a
  // relay back onto the local daemon, which `slimLocal` is supposed to strip.
  const merged: HostProfile[] = [];
  for (const host of mergeProfiles(cleanedLocal, folded, {})) {
    const normalised = normalizeHost(host, options);
    if (!normalised) continue;
    merged.push(normalised.host);
  }
  writeRegistry(merged);

  const mergedIds = new Set(folded.map((host) => host.serverId));
  return {
    backups: bodies.length,
    total,
    added: [...mergedIds].filter((id) => !localIds.has(id)).length,
    replaced: [...mergedIds].filter((id) => localIds.has(id)).length,
    skipped: skippedLabels.length,
    skippedLabels,
    cleaned,
  };
}
