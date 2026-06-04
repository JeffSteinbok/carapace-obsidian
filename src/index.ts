/**
 * carapace-obsidian — public API barrel export.
 */
export * from "./lib/index.js";

// Re-export the reader for programmatic use
export { VaultReader } from "./plugin/reader.js";
export type { ReaderStatus } from "./plugin/reader.js";
