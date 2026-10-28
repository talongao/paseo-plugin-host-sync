# Host Backup for Paseo

Encrypted backup of your Paseo **host list** to your own GitHub repository, with merge-on-restore across devices.

Paseo keeps the list of hosts in browser `localStorage`. That list does not follow an account, so switching browsers or machines starts from an empty list. This plugin snapshots the list into a repository you control, and merges it back when you need it.

[中文说明](OVERVIEW.zh-CN.md)

## What it does

- **Backup** — every run adds a new snapshot file; nothing is overwritten
- **Encrypt (optional, on by default)** — PBKDF2-SHA256 (310k) + AES-256-GCM, so the repository only ever holds ciphertext
- **Restore** — pick any snapshot and merge it into the current browser
- **Prune** — keep the newest N snapshots, delete the rest
- **Cross-device safety** — connections that can only work on another machine (`localhost:6767`) are dropped; the local daemon keeps only its direct connection

## Install

```bash
paseo plugin add git:talongao/paseo-plugin-host-sync
```

Then open **Settings → Hosts → ⋯ → Plugins → Host Backup**. A `⌘K` entry and a sidebar icon are also registered.

## Configuration

| Field | Meaning |
|---|---|
| Repository | `owner/repo` or a GitHub URL |
| Branch | empty = repository default branch |
| Directory | empty = repository root |
| Token | GitHub personal access token with **Contents: Read and write** on that repository |
| Password | ≥ 8 chars, used to derive the AES key |
| Keep | how many snapshots to retain, `0` = unlimited |

Snapshot names look like `paseo-hosts-20261028-112233-mac-mini.enc.json`: timestamp, host label, `.enc` when encrypted.

## Where data goes

- The encrypted snapshot is written to **your** GitHub repository through the GitHub Contents API.
- The token and the password are stored in this browser's `localStorage`. They are never sent to the Paseo daemon and never leave the browser except as the `Authorization` header to `api.github.com`.
- No telemetry, no third-party services, no network calls to anything other than `api.github.com`.

## Merge rules

Restoring never deletes anything:

| Situation | Result |
|---|---|
| In the snapshot, not local | added |
| Local, not in the snapshot | untouched |
| Same `serverId` on both sides | connections unioned |
| Restoring the same snapshot twice | idempotent |

Loopback TCP connections (`localhost`, `127.0.0.1`, `::1`) are dropped for every host except the daemon this browser is attached to, since `localhost:6767` would otherwise point at the wrong machine.

## Development

```bash
npm install
npm run typecheck
```

Paseo compiles the TypeScript itself; there is no build step. The plugin uses only host-provided libraries (`@getpaseo/plugin`, `react`, `react-native`), so it has no runtime dependencies.

## License

MIT
