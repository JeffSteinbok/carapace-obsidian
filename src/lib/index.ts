/**
 * carapace-obsidian — public API barrel export.
 *
 * Shared types, parser, security, and schema used by both
 * the indexer service and the vault plugin.
 */

// Types
export type {
  ParsedNote,
  WikiLink,
  NoteRecord,
  SearchResult,
  RecentNote,
  VaultConfig,
} from "./types.js";
export { SCHEMA_VERSION } from "./types.js";

// Parser
export {
  parseFrontmatter,
  extractTags,
  extractWikilinks,
  deriveTitle,
  parseNote,
} from "./parser.js";

// Security
export {
  resolveSafePath,
  canonicalizeVaultRoot,
  validateIndexLocation,
} from "./security.js";

// Schema
export {
  SCHEMA_DDL,
  initSchema,
  validateSchemaVersion,
} from "./schema.js";
