# 🦞🐚📝 carapace-obsidian

[![CI](https://github.com/JeffSteinbok/carapace-obsidian/actions/workflows/ci.yml/badge.svg)](https://github.com/JeffSteinbok/carapace-obsidian/actions/workflows/ci.yml)

Obsidian vault integration for [OpenClaw](https://github.com/JeffSteinbok/openclaw) — full-text search, note reading, graph exploration, and note management powered by SQLite FTS5.

Built with [carapace-plugin-sdk](https://github.com/JeffSteinbok/carapace-plugin-sdk). Pairs with [obsidian-onedrive](https://github.com/JeffSteinbok/obsidian-onedrive) for vault sync.

---

## Architecture

```
┌────────────────────┐        ┌───────────────────┐       ┌────────────────┐
│  Obsidian Vault    │        │  Indexer Service  │       │  Plugin (r/w)  │
│  (markdown files)  │──────> │  (chokidar watch) │──────>│  (VaultReader) │
│                    │ watch  │  SQLite FTS5 DB   │ read  │  9 tools       │
└────────────────────┘        └───────────────────┘       └────────────────┘
```

- **Indexer service** — long-running systemd service that watches the vault directory, parses markdown (frontmatter, tags, wikilinks), and maintains a SQLite FTS5 index in WAL mode.
- **Plugin** — OpenClaw plugin that queries the index for reads and writes directly to the vault for mutations. Reads open the DB with `readonly: true` so they never conflict with the indexer; writes go to the filesystem and the indexer picks up changes automatically.

---

## Tools

| Tool | Description |
|------|-------------|
| `vault_search` | Full-text search with FTS5. Auto prefix matching (`wash` → `washer`, `washing`). Falls back to LIKE substring search if no FTS results. Supports OR syntax. |
| `vault_read` | Read a single note — returns parsed content, frontmatter, tags, and wikilinks. |
| `vault_recent` | List recently modified notes, sorted by modification time. |
| `vault_tags` | List all tags used across the vault with note counts. |
| `vault_backlinks` | Find notes that link to a given note via `[[wikilinks]]`. |
| `vault_related` | Find related notes via shared wikilinks and tags, ranked by relevance. |
| `vault_write` | Create or overwrite a note. Provide a vault-relative path and full Markdown content. Creates parent directories by default. The indexer picks up the change automatically. |
| `vault_append` | Append text to an existing note. A newline is inserted automatically if the file doesn't end with one. |
| `vault_delete` | Permanently delete a note from the vault. Irreversible — the indexer removes it from the search index automatically. |

---

## Installation

### 1. Clone and build

```bash
git clone https://github.com/JeffSteinbok/carapace-obsidian.git
cd carapace-obsidian
npm install && npm run build
```

### 2. Vault sync (OneDrive)

If your Obsidian vault lives on OneDrive, use [obsidian-onedrive](https://github.com/JeffSteinbok/obsidian-onedrive) to keep it synced to your server:

```bash
# Install and configure obsidian-onedrive to sync your vault to e.g. ~/OneDrive/MyVault
# The indexer will watch this directory for changes
```

### 3. Indexer service (systemd)

The indexer is a long-running service that watches your vault directory and maintains the FTS5 search index. It must be running for the plugin to return results.

```bash
# Copy the service file
cp obsidian-indexer.service ~/.config/systemd/user/

# Edit to match your paths:
#   ExecStart=/usr/bin/node /path/to/carapace-obsidian/dist/service/index.js
#   Environment=OBSIDIAN_VAULT_ROOT=/path/to/your/vault
#   Environment=OBSIDIAN_INDEX_LOCATION=/home/you/.openclaw/obsidian-index.db
nano ~/.config/systemd/user/obsidian-indexer.service

# Enable and start
systemctl --user daemon-reload
systemctl --user enable --now obsidian-indexer

# Verify it's running
systemctl --user status obsidian-indexer
journalctl --user -u obsidian-indexer -f
```

Environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `OBSIDIAN_VAULT_ROOT` | Absolute path to the Obsidian vault directory | *(required)* |
| `OBSIDIAN_INDEX_LOCATION` | Path for the SQLite FTS5 database (must be outside the vault) | `~/.openclaw/obsidian-index.db` |

### 4. Register in OpenClaw

Add the plugin to your `openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/carapace-obsidian"]
    },
    "entries": {
      "obsidian-vault": {
        "enabled": true,
        "config": {
          "vaultRoot": "/path/to/your/vault",
          "indexLocation": "~/.openclaw/obsidian-index.db"
        }
      }
    }
  }
}
```

Then restart the gateway:

```bash
systemctl --user restart openclaw-gateway
```

The plugin will appear in the gateway's plugin list and its 9 tools will be available to all agents.

---

## CLI Usage

Every tool is available as a standalone CLI:

```bash
npm run build
./dist/bin/obsidian-vault.js --help
```

```bash
# Search (config via env vars)
export OBSIDIAN_VAULT_VAULT_ROOT="/path/to/vault"
export OBSIDIAN_VAULT_INDEX_LOCATION="~/.openclaw/obsidian-index.db"

./dist/bin/obsidian-vault.js vault-search "washing machine"
./dist/bin/obsidian-vault.js vault-read "Projects/My Note.md"
./dist/bin/obsidian-vault.js vault-recent
./dist/bin/obsidian-vault.js vault-tags
./dist/bin/obsidian-vault.js vault-write "Notes/New.md" "# Hello"
./dist/bin/obsidian-vault.js vault-append "Journal/2024-01-15.md" "- Added a note"
./dist/bin/obsidian-vault.js vault-delete "Drafts/OldNote.md"
```

---

## Development

```bash
npm install
npm run build
npm test          # 114 tests across 5 suites
```

### Project structure

```
src/
  lib/            Shared library — parser, security, schema, types
  plugin/         OpenClaw plugin — VaultReader, handlers, entry (definePlugin)
  service/        Indexer service — VaultIndexer, structured logging
tests/            Unit + integration tests
obsidian-indexer.service   systemd unit template
```

### Key design decisions

- **WAL mode** — one writer (indexer) + multiple readers (plugin, CLI) without conflicts
- **FTS5 with prefix matching** — queries like `wash` automatically become `wash*` to match `washer`, `washing`, etc.
- **LIKE fallback** — if FTS5 returns 0 results or throws a syntax error, falls back to `WHERE content LIKE '%query%'`
- **Schema versioning** — uses `PRAGMA user_version` so the plugin can detect incompatible index schemas
- **Security** — path traversal prevention ensures notes can only be read within the vault root

---

## License

MIT
