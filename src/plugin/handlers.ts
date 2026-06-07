/**
 * Handlers — core tool logic.
 *
 * Pure functions that accept config/reader and return structured results.
 * No knowledge of the plugin framework.
 */

import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, relative } from "node:path";
import { resolveSafePath, parseNote, type VaultConfig } from "../lib/index.js";
import type { VaultReader } from "./reader.js";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function checkReady(reader: VaultReader): { error: string } | null {
  const status = reader.getStatus();
  if (status.state === "ready") return null;
  return { error: status.message };
}

export function handleSearch(
  reader: VaultReader,
  query: string,
  limit: number,
): unknown {
  const err = checkReady(reader);
  if (err) return err;
  if (!query.trim()) {
    return { error: "Query must not be empty" };
  }
  try {
    const results = reader.search(query, limit);
    return { output: results };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Search failed: ${msg}` };
  }
}

export function handleRead(
  config: VaultConfig,
  notePath: string,
): unknown {
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }

  try {
    const safePath = resolveSafePath(config.vaultRoot, notePath);

    // Read directly from filesystem for freshest content
    const raw = readFileSync(safePath, "utf-8");
    const stat = statSync(safePath);
    const relPath = relative(config.vaultRoot, safePath);
    const parsed = parseNote(raw, relPath);

    return {
      output: {
        path: relPath,
        title: parsed.title,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        tags: parsed.tags,
        wikilinks: parsed.wikilinks,
        modified: new Date(stat.mtimeMs).toISOString(),
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("escapes vault root") || msg.includes("Invalid path")) {
      return { error: `Access denied: ${msg}` };
    }
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { error: `Note not found: ${notePath}` };
    }
    return { error: msg };
  }
}

export function handleRecent(
  reader: VaultReader,
  limit: number,
): unknown {
  const err = checkReady(reader);
  if (err) return err;
  const results = reader.listRecent(limit);
  return {
    output: results.map((r) => ({
      path: r.path,
      title: r.title,
      modified: new Date(r.mtime_ms).toISOString(),
    })),
  };
}

export function handleTags(reader: VaultReader): unknown {
  const err = checkReady(reader);
  if (err) return err;
  return { output: reader.listTags() };
}

export function handleBacklinks(
  reader: VaultReader,
  notePath: string,
): unknown {
  const err = checkReady(reader);
  if (err) return err;
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }
  return { output: reader.getBacklinks(notePath) };
}

// ---------------------------------------------------------------------------
// Write handlers
// ---------------------------------------------------------------------------

export function handleWrite(
  config: VaultConfig,
  notePath: string,
  content: string,
  createDirs: boolean,
): unknown {
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }

  try {
    const safePath = resolveSafePath(config.vaultRoot, notePath);
    const dir = dirname(safePath);

    if (!existsSync(dir)) {
      if (!createDirs) {
        return { error: `Parent directory does not exist: ${relative(config.vaultRoot, dir)}. Pass createDirs=true to create it.` };
      }
      mkdirSync(dir, { recursive: true });
    }

    const existed = existsSync(safePath);
    writeFileSync(safePath, content, "utf-8");
    const stat = statSync(safePath);
    const relPath = relative(config.vaultRoot, safePath);

    return {
      output: {
        path: relPath,
        action: existed ? "updated" : "created",
        size: stat.size,
        modified: new Date(stat.mtimeMs).toISOString(),
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("escapes vault root") || msg.includes("Invalid path")) {
      return { error: `Access denied: ${msg}` };
    }
    return { error: msg };
  }
}

export function handleAppend(
  config: VaultConfig,
  notePath: string,
  content: string,
): unknown {
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }

  try {
    const safePath = resolveSafePath(config.vaultRoot, notePath);

    if (!existsSync(safePath)) {
      return { error: `Note not found: ${notePath}` };
    }

    const existing = readFileSync(safePath, "utf-8");
    // Ensure we add a newline separator if the file doesn't end with one
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    writeFileSync(safePath, existing + separator + content, "utf-8");

    const stat = statSync(safePath);
    const relPath = relative(config.vaultRoot, safePath);

    return {
      output: {
        path: relPath,
        action: "appended",
        size: stat.size,
        modified: new Date(stat.mtimeMs).toISOString(),
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("escapes vault root") || msg.includes("Invalid path")) {
      return { error: `Access denied: ${msg}` };
    }
    return { error: msg };
  }
}

export function handleDelete(
  config: VaultConfig,
  notePath: string,
): unknown {
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }

  try {
    const safePath = resolveSafePath(config.vaultRoot, notePath);

    if (!existsSync(safePath)) {
      return { error: `Note not found: ${notePath}` };
    }

    const relPath = relative(config.vaultRoot, safePath);
    unlinkSync(safePath);

    return {
      output: {
        path: relPath,
        action: "deleted",
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("escapes vault root") || msg.includes("Invalid path")) {
      return { error: `Access denied: ${msg}` };
    }
    return { error: msg };
  }
}

export function handleRelated(
  reader: VaultReader,
  notePath: string,
): unknown {
  const err = checkReady(reader);
  if (err) return err;
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }
  return { output: reader.getRelatedNotes(notePath) };
}
