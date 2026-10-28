# Host Backup

Encrypted backup of your Paseo **host list** to your own GitHub repository, with merge-on-restore across devices.

Paseo stores the host list in browser `localStorage`. It is not tied to an account, so a new browser or a new machine starts from an empty list. This plugin snapshots that list into a repository you control and merges it back when you need it.

## Features

- **Backup** — every run adds a new snapshot; previous snapshots are kept
- **Encryption** — PBKDF2-SHA256 (310k iterations) + AES-256-GCM, on by default; the repository only ever holds ciphertext
- **Restore** — pick any snapshot and merge it into the current browser
- **Retention** — keep the newest N snapshots and delete the rest
- **Cross-device safety** — connections that can only work on another machine (`localhost:6767`) are dropped, and the local daemon keeps its direct connection only

## Setup

Open **Settings → Hosts → ⋯ → Plugins → Host Backup**. A `⌘K` entry and a sidebar icon are registered as well.

| Field | Meaning |
|---|---|
| Repository | `owner/repo` or a GitHub URL |
| Branch | empty = repository default branch |
| Directory | empty = repository root |
| Token | GitHub personal access token with **Contents: Read and write** on that repository |
| Password | at least 8 characters, used to derive the AES key |
| Keep | number of snapshots to retain, `0` = unlimited |

Snapshots are named `paseo-hosts-<timestamp>-<host-label>.enc.json`; `.enc` is present when encryption is on.

## Where data goes

- Encrypted snapshots are written to **your** GitHub repository through the GitHub Contents API.
- The token and the password live in this browser's `localStorage`. They are never sent to the Paseo daemon and never leave the browser, except as the `Authorization` header when calling `api.github.com`.
- No telemetry, no third-party services, no other network calls.

## Merge rules

Restoring never deletes anything:

| Situation | Result |
|---|---|
| In the snapshot, not local | added |
| Local, not in the snapshot | left untouched |
| Same `serverId` on both sides | connections are unioned |
| Restoring the same snapshot twice | idempotent |

Loopback TCP connections (`localhost`, `127.0.0.1`, `::1`) are dropped for every host except the daemon this browser is attached to — otherwise `localhost:6767` would point at the wrong machine.

## Notes

- Turning encryption off stores the host list in plain text, including any daemon password inside a connection entry. Use that mode only with a private repository.
- A lost password cannot be recovered; older snapshots stay readable only with the password they were encrypted with, and snapshots may use different passwords.
- After a restore, reload the Paseo window so the sidebar picks up the new host list.

## License

MIT
