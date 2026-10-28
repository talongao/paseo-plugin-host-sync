import type { GitHubSettings } from "./settings";
import { getGlobal } from "./dom";

const API = "https://api.github.com";
const BACKUP_PREFIX = "paseo-hosts-";
const BACKUP_SUFFIX = ".json";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RemoteFile {
  name: string;
  path: string;
  size: number;
  sha: string;
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

/** Accepts "owner/repo", a GitHub URL, or an ssh remote. */
export function parseRepo(input: string): RepoRef | null {
  const value = input.trim();
  if (!value) return null;
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(value);
  if (ssh) return { owner: ssh[1] as string, repo: (ssh[2] as string).replace(/\.git$/, "") };
  const url = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)/.exec(value);
  if (url) return { owner: url[1] as string, repo: (url[2] as string).replace(/\.git$/, "") };
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(value);
  if (short) return { owner: short[1] as string, repo: short[2] as string };
  return null;
}

function slugify(label: string): string {
  return label
    .replace(/[\\/:*?"<>|']/g, "")
    .replace(/[\s.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function localStamp(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}

export function backupFileName(at: Date, encrypted: boolean, label = ""): string {
  const tag = slugify(label);
  const middle = tag ? `-${tag}` : "";
  return `${BACKUP_PREFIX}${localStamp(at)}${middle}${encrypted ? ".enc" : ""}${BACKUP_SUFFIX}`;
}

export interface BackupName {
  at: string;
  tag: string;
  encrypted: boolean;
}

export function parseBackupName(name: string): BackupName {
  const match = /^paseo-hosts-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(.+?))?(\.enc)?\.json$/.exec(name);
  if (!match) return { at: name, tag: "", encrypted: name.includes(".enc.") };
  const [, y, mo, d, h, mi, se, tag, enc] = match;
  return {
    at: `${y}-${mo}-${d} ${h}:${mi}:${se}`,
    tag: tag ?? "",
    encrypted: Boolean(enc) || name.includes(".enc."),
  };
}

export function isEncryptedName(name: string): boolean {
  return name.includes(".enc.");
}

function encodeBase64(input: string): string {
  const g = getGlobal();
  const bytes = new g.TextEncoder().encode(input) as Uint8Array;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
  return g.btoa(binary) as string;
}

function decodeBase64(input: string): string {
  const g = getGlobal();
  const binary = g.atob(input.replace(/\s/g, "")) as string;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new g.TextDecoder().decode(bytes) as string;
}

function explain(status: number, body: string): GitHubError {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { message?: string };
    detail = typeof parsed.message === "string" ? parsed.message : "";
  } catch {
    detail = body.slice(0, 200);
  }
  const hint =
    status === 401
      ? "Token 无效或已过期"
      : status === 403
        ? "权限不足：token 需要 Contents 读写权限；也可能是触发了 GitHub 的限流"
        : status === 404
          ? "仓库、分支或目录不存在（也可能是 token 没有该仓库的访问权限）"
          : status === 409 || status === 422
            ? "文件冲突，请重试一次"
            : `GitHub 返回 ${status}`;
  return new GitHubError(status, detail ? `${hint}（${detail}）` : hint);
}

function repoPath(ref: RepoRef, rest: string): string {
  const encoded = rest
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}${encoded ? `/${encoded}` : ""}`;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function requireRepo(settings: GitHubSettings): RepoRef {
  const ref = parseRepo(settings.repo);
  if (!ref) throw new GitHubError(0, "仓库地址无效，请填 owner/repo 或 https://github.com/owner/repo");
  if (!settings.token) throw new GitHubError(0, "还没有填 token");
  return ref;
}

function contentPath(settings: GitHubSettings, name?: string): string {
  const dir = settings.dir.replace(/^\/+|\/+$/g, "");
  if (!name) return dir ? `contents/${dir}` : "contents";
  return dir ? `contents/${dir}/${name}` : `contents/${name}`;
}

async function request(url: string, init: RequestInit): Promise<any> {
  const g = getGlobal();
  let response: any;
  try {
    response = await g.fetch(url, init);
  } catch (error) {
    throw new GitHubError(0, `无法访问 GitHub：${error instanceof Error ? error.message : String(error)}`);
  }
  const body = await response.text();
  if (!response.ok) throw explain(response.status, body);
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function verifyRepo(settings: GitHubSettings): Promise<{ defaultBranch: string; canWrite: boolean }> {
  const ref = requireRepo(settings);
  const data = await request(repoPath(ref, ""), { headers: headers(settings.token) });
  return {
    defaultBranch: typeof data?.default_branch === "string" ? data.default_branch : "",
    canWrite: data?.permissions?.push === true,
  };
}

export async function listBackups(settings: GitHubSettings): Promise<RemoteFile[]> {
  const ref = requireRepo(settings);
  const query = settings.branch ? `?ref=${encodeURIComponent(settings.branch)}` : "";
  let data: any;
  try {
    data = await request(repoPath(ref, contentPath(settings)) + query, { headers: headers(settings.token) });
  } catch (error) {
    // A missing directory simply means nothing has been backed up yet.
    if (error instanceof GitHubError && error.status === 404) return [];
    throw error;
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (item: any) =>
        item && item.type === "file" && typeof item.name === "string" && item.name.startsWith(BACKUP_PREFIX),
    )
    .map((item: any) => ({
      name: item.name as string,
      path: item.path as string,
      size: typeof item.size === "number" ? item.size : 0,
      sha: item.sha as string,
    }))
    .sort((a: RemoteFile, b: RemoteFile) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

export async function readBackupFile(settings: GitHubSettings, name: string): Promise<string> {
  const ref = requireRepo(settings);
  const query = settings.branch ? `?ref=${encodeURIComponent(settings.branch)}` : "";
  const data = await request(repoPath(ref, contentPath(settings, name)) + query, {
    headers: headers(settings.token),
  });
  if (!data || typeof data.content !== "string") throw new GitHubError(0, "文件内容为空或不是文件");
  return decodeBase64(data.content);
}

export async function writeBackupFile(
  settings: GitHubSettings,
  name: string,
  content: string,
): Promise<{ sha: string }> {
  const ref = requireRepo(settings);
  const payload: Record<string, unknown> = {
    message: `paseo host backup ${new Date().toISOString()}`,
    content: encodeBase64(content),
  };
  if (settings.branch) payload.branch = settings.branch;
  const data = await request(repoPath(ref, contentPath(settings, name)), {
    method: "PUT",
    headers: { ...headers(settings.token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { sha: typeof data?.content?.sha === "string" ? data.content.sha : "" };
}

export function settingsSummary(settings: GitHubSettings): string {
  const ref = parseRepo(settings.repo);
  if (!ref) return "未配置";
  const dir = settings.dir ? `/${settings.dir}` : "/";
  return `${ref.owner}/${ref.repo} · ${settings.branch || "默认分支"} · ${dir}`;
}


export async function deleteBackupFile(settings: GitHubSettings, file: RemoteFile): Promise<void> {
  const ref = requireRepo(settings);
  const payload: Record<string, unknown> = {
    message: `remove old paseo host backup ${file.name}`,
    sha: file.sha,
  };
  if (settings.branch) payload.branch = settings.branch;
  await request(repoPath(ref, contentPath(settings, file.name)), {
    method: "DELETE",
    headers: { ...headers(settings.token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Delete the oldest snapshots so at most `keep` remain. Returns the removed names. */
export async function pruneBackups(
  settings: GitHubSettings,
  files: readonly RemoteFile[],
): Promise<{ removed: string[]; failed: string[] }> {
  const keep = Math.max(0, Math.floor(settings.keep));
  if (keep === 0 || files.length <= keep) return { removed: [], failed: [] };
  // Newest first, regardless of how the caller ordered the list.
  const sorted = [...files].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const stale = sorted.slice(keep);
  const removed: string[] = [];
  const failed: string[] = [];
  for (const file of stale) {
    try {
      await deleteBackupFile(settings, file);
      removed.push(file.name);
    } catch {
      failed.push(file.name);
    }
  }
  return { removed, failed };
}

/** Delete every snapshot in the configured directory. Returns how many were removed. */
export async function clearAllBackups(settings: GitHubSettings): Promise<number> {
  const files = await listBackups(settings);
  let removed = 0;
  for (const file of files) {
    try {
      await deleteBackupFile(settings, file);
      removed += 1;
    } catch {
      // keep going: a single failure should not block the rest
    }
  }
  return removed;
}
