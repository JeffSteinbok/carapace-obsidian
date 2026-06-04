/**
 * Obsidian plugin entry — creates the plugin registration for OpenClaw.
 *
 * Read-only access to an Obsidian vault. Queries the FTS5 index
 * maintained by the obsidian-indexer service.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  canonicalizeVaultRoot,
  validateIndexLocation,
  type VaultConfig,
} from "../lib/index.js";
import { VaultReader } from "./reader.js";
import {
  handleSearch,
  handleRead,
  handleRecent,
  handleTags,
  handleBacklinks,
  handleRelated,
} from "./handlers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

interface ResolvedConfig extends VaultConfig {
  _reader?: VaultReader;
}

function resolveConfig(raw: { vaultRoot: string; indexLocation?: string }): ResolvedConfig {
  const vaultRoot = raw.vaultRoot.trim();
  if (!vaultRoot) throw new Error("obsidian plugin requires 'vaultRoot' configuration");

  const rawIndex = (raw.indexLocation ?? "").trim() || "~/.openclaw/obsidian-index.db";
  const canonicalRoot = canonicalizeVaultRoot(expandHome(vaultRoot));
  const indexLocation = resolve(expandHome(rawIndex));
  validateIndexLocation(canonicalRoot, indexLocation);

  return { vaultRoot: canonicalRoot, indexLocation };
}

/** Lazily create and cache a VaultReader per config. */
function getReader(config: { vaultRoot: string; indexLocation?: string }): VaultReader {
  const resolved = config as ResolvedConfig;
  if (!resolved._reader) {
    const cfg = resolveConfig(config);
    resolved._reader = new VaultReader(cfg.indexLocation);
    // Copy resolved paths back
    resolved.vaultRoot = cfg.vaultRoot;
    resolved.indexLocation = cfg.indexLocation;
  }
  return resolved._reader;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export const createEntry = definePlugin({
  id: "obsidian",
  name: "Obsidian Vault",
  description: "Read-only access to an Obsidian vault — search, read, and explore notes securely",

  configSchema: Type.Object({
    vaultRoot: Type.String({
      description: "Absolute path to the Obsidian vault root directory",
    }),
    indexLocation: Type.Optional(
      Type.String({
        description: "Path for the SQLite index database (must be outside vaultRoot)",
        default: "~/.openclaw/obsidian-index.db",
      }),
    ),
  }),

  tools: (tool) => [
    tool({
      name: "vault_search",
      label: "Vault Search",
      description:
        "Full-text search across all notes in the Obsidian vault. Returns ranked results with snippets. " +
        "Uses prefix matching by default (e.g. 'wash' finds 'washer', 'washing'). " +
        "Falls back to substring search if no FTS results found. " +
        "Tip: try multiple related terms with OR (e.g. 'washer OR washing OR laundry').",
      parameters: Type.Object({
        query: Type.String({ description: "Search query string (FTS5 syntax supported)" }),
        limit: Type.Optional(
          Type.Number({ description: "Maximum number of results (default: 20)", default: 20, minimum: 1, maximum: 100 }),
        ),
      }),
      async execute(params, config) {
        const reader = getReader(config);
        const query = (params.query ?? "").trim();
        const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
        return handleSearch(reader, query, limit);
      },
    }),

    tool({
      name: "vault_read",
      label: "Vault Read",
      description:
        "Read a single note from the Obsidian vault. Returns parsed content, frontmatter, tags, and wikilinks.",
      parameters: Type.Object({
        path: Type.String({
          description: "Relative path to the note within the vault (e.g. 'Projects/Home Assistant/Battery Monitoring.md')",
        }),
      }),
      async execute(params, config) {
        getReader(config); // ensure config is resolved
        const resolved = resolveConfig(config);
        const notePath = (params.path ?? "").trim();
        return handleRead(resolved, notePath);
      },
    }),

    tool({
      name: "vault_recent",
      label: "Vault Recent Notes",
      description: "List recently modified notes, sorted by modification time.",
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Number({ description: "Maximum number of results (default: 20)", default: 20, minimum: 1, maximum: 100 }),
        ),
      }),
      async execute(params, config) {
        const reader = getReader(config);
        const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
        return handleRecent(reader, limit);
      },
    }),

    tool({
      name: "vault_tags",
      label: "Vault Tags",
      description: "List all tags used across the Obsidian vault.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        const reader = getReader(config);
        return handleTags(reader);
      },
    }),

    tool({
      name: "vault_backlinks",
      label: "Vault Backlinks",
      description: "Find notes that link to a given note using [[wikilinks]].",
      parameters: Type.Object({
        path: Type.String({ description: "Path of the target note to find backlinks for" }),
      }),
      async execute(params, config) {
        const reader = getReader(config);
        const notePath = (params.path ?? "").trim();
        return handleBacklinks(reader, notePath);
      },
    }),

    tool({
      name: "vault_related",
      label: "Vault Related Notes",
      description:
        "Find notes related to a given note via wikilinks and shared tags. " +
        "Returns results sorted by relevance with relationship reasons.",
      parameters: Type.Object({
        path: Type.String({ description: "Path of the note to find related notes for" }),
      }),
      async execute(params, config) {
        const reader = getReader(config);
        const notePath = (params.path ?? "").trim();
        return handleRelated(reader, notePath);
      },
    }),
  ],
});
