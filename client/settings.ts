import { getGlobal } from "./dom";

const KEY = "@paseo:host-sync:settings";

export interface GitHubSettings {
  /** "owner/repo" or a full GitHub URL */
  repo: string;
  /** empty = repository default branch */
  branch: string;
  /** empty = repository root */
  dir: string;
  token: string;
  encrypt: boolean;
  password: string;
  rememberPassword: boolean;
  /** how many snapshots to keep; 0 = unlimited */
  keep: number;
}

export const EMPTY_SETTINGS: GitHubSettings = {
  repo: "",
  branch: "",
  dir: "",
  token: "",
  encrypt: true,
  password: "",
  rememberPassword: true,
  keep: 10,
};

function store(): any {
  try {
    return getGlobal()?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(): GitHubSettings {
  try {
    const raw = store()?.getItem(KEY);
    if (typeof raw !== "string") return { ...EMPTY_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GitHubSettings>;
    return {
      repo: typeof parsed.repo === "string" ? parsed.repo : "",
      branch: typeof parsed.branch === "string" ? parsed.branch : "",
      dir: typeof parsed.dir === "string" ? parsed.dir : "",
      token: typeof parsed.token === "string" ? parsed.token : "",
      encrypt: parsed.encrypt !== false,
      password: typeof parsed.password === "string" ? parsed.password : "",
      rememberPassword: parsed.rememberPassword !== false,
      keep: typeof parsed.keep === "number" && parsed.keep >= 0 ? Math.floor(parsed.keep) : 10,
    };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

export function saveSettings(settings: GitHubSettings): void {
  const next: GitHubSettings = {
    ...settings,
    repo: settings.repo.trim(),
    branch: settings.branch.trim(),
    dir: settings.dir.trim().replace(/^\/+|\/+$/g, ""),
    token: settings.token.trim(),
    password: settings.rememberPassword ? settings.password : "",
    keep: Number.isFinite(settings.keep) ? Math.max(0, Math.floor(settings.keep)) : 10,
  };
  try {
    store()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}

export function isConfigured(settings: GitHubSettings): boolean {
  return settings.repo.length > 0 && settings.token.length > 0;
}
