# 🦞🐚📝 carapace-obsidian

[![CI](https://github.com/JeffSteinbok/carapace-obsidian/actions/workflows/ci.yml/badge.svg)](https://github.com/JeffSteinbok/carapace-obsidian/actions/workflows/ci.yml)

Read-only Obsidian vault integration for [OpenClaw](https://github.com/JeffSteinbok/openclaw) — full-text search, note reading, and graph exploration powered by SQLite FTS5.

Built with [carapace-plugin-sdk](https://github.com/JeffSteinbok/carapace-plugin-sdk). Pairs with [obsidian-onedrive](https://github.com/JeffSteinbok/obsidian-onedrive) for vault sync.

---

## Architecture

```
┌────────────────────┐       ┌──────────────────┐       ┌────────────────┐
│  Obsidian Vault    │       │  Indexer Service  │       │  Plugin (r/o)  │
│  (markdown files)  │──────▶│  (chokidar watch) │──────▶│  (VaultReader) │
│                    │ watch  │  SQLite FTS5 DB   │ read  │  6 tools       │
└────────────────────┘       └──────────────────┘       └────────────────┘
```

- **Indexer service** — long-running systemd service that watches the vault directory, parses markdown (frontmatter, tags, wikilinks), and maintains a SQLite FTS5 index in WAL mode.
- **Plugin** — read-only OpenClaw plugin that queries the index. Opens the DB with `readonly: true` so it never conflicts with the indexer.

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

---

## Installation

### As an OpenClaw plugin

Add the repo path to your `openclaw.json` plugin directories:

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
          "vaultRoot": "/path/to/your/obsidian/vault",
          "indexLocation": "~/.openclaw/obsidian-index.db"
        }
      }
    }
  }
}
```

### Indexer service (systemd)

```bash
# Copy and edit the service file
cp obsidian-indexer.service ~/.config/systemd/user/
# Edit ExecStart path and Environment vars to match your setup
systemctl --user daemon-reload
systemctl --user enable --now obsidian-indexer
```

Environment variables for the indexer:

| Variable | Description | Default |
|----------|-------------|---------|
| `OBSIDIAN_VAULT_ROOT` | Absolute path to the Obsidian vault | *(required)* |
| `OBSIDIAN_INDEX_LOCATION` | Path for the SQLite FTS5 database | `~/.openclaw/obsidian-index.db` |

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
```

---

## Development

```bash
npm install
npm run build
npm test          # 100 tests across 5 suites
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
