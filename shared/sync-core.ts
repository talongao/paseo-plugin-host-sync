/**
 * Pure merge logic shared by the daemon and the client.
 * No node: imports, no React Native imports.
 */

export interface HostConnection {
  id?: string;
  [key: string]: unknown;
}

export interface HostProfile {
  serverId: string;
  label?: string;
  password?: string;
  updatedAt?: string;
  preferredConnectionId?: string | null;
  connections?: HostConnection[];
  [key: string]: unknown;
}

/** serverId -> ISO timestamp of the removal */
export type RemovedMap = Record<string, string>;

export function parseProfiles(raw: string | null | undefined): HostProfile[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const result: HostProfile[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && typeof (item as HostProfile).serverId === "string") {
      result.push(item as HostProfile);
    }
  }
  return result;
}

function sortConnections(connections: unknown): HostConnection[] {
  if (!Array.isArray(connections)) return [];
  return connections
    .filter((c): c is HostConnection => !!c && typeof c === "object" && typeof (c as HostConnection).id === "string")
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function stamp(profile: HostProfile): string {
  return typeof profile.updatedAt === "string" ? profile.updatedAt : "";
}

function mergePair(a: HostProfile, b: HostProfile): HostProfile {
  const newer = stamp(a) >= stamp(b) ? a : b;
  const older = newer === a ? b : a;
  const connections = new Map<string, HostConnection>();
  for (const c of sortConnections(older.connections)) connections.set(String(c.id), c);
  for (const c of sortConnections(newer.connections)) connections.set(String(c.id), c);
  const merged: HostProfile = { ...older, ...newer, connections: [...connections.values()] };
  const preferred = merged.preferredConnectionId;
  if (typeof preferred !== "string" || !connections.has(preferred)) {
    merged.preferredConnectionId = [...connections.keys()][0] ?? null;
  }
  return merged;
}

/**
 * Union of two registries, keyed by serverId.
 * `local` wins on ties so the current device keeps its own naming/colour edits.
 * A tombstone drops a host only when the host itself was not updated after the removal.
 */
export function mergeProfiles(
  local: readonly HostProfile[],
  incoming: readonly HostProfile[],
  removed: RemovedMap = {},
): HostProfile[] {
  const merged = new Map<string, HostProfile>();
  for (const profile of incoming) merged.set(profile.serverId, profile);
  for (const profile of local) {
    const previous = merged.get(profile.serverId);
    merged.set(profile.serverId, previous ? mergePair(profile, previous) : profile);
  }
  const result: HostProfile[] = [];
  for (const profile of merged.values()) {
    const removedAt = removed[profile.serverId];
    if (typeof removedAt === "string" && stamp(profile) <= removedAt) continue;
    result.push(profile);
  }
  return result.sort((a, b) => a.serverId.localeCompare(b.serverId));
}

/** Stable serialisation used to decide whether a write is actually needed. */
export function canonicalProfiles(profiles: readonly HostProfile[]): string {
  const normalized = profiles
    .filter((p) => !!p && typeof p.serverId === "string")
    .map((p) => ({ ...p, connections: sortConnections(p.connections) }))
    .sort((a, b) => a.serverId.localeCompare(b.serverId));
  return JSON.stringify(normalized);
}

export function serverIdsOf(profiles: readonly HostProfile[]): string[] {
  return profiles.map((p) => p.serverId).sort();
}

/** Which previously known hosts disappeared from a registry (used for tombstones). */
export function missingIds(known: readonly string[], present: readonly HostProfile[]): string[] {
  const live = new Set(present.map((p) => p.serverId));
  return known.filter((id) => !live.has(id));
}
