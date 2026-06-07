/**
 * Tests for the Obsidian plugin entry and VaultReader.
 *
 * Uses a temporary directory with a pre-built index to test
 * the read-only VaultReader and plugin registration.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { initSchema, parseNote } from "../src/lib/index.js";
import { VaultReader } from "../src/plugin/reader.js";
import { handleSearch, handleRead, handleRecent, handleTags, handleBacklinks, handleRelated, handleWrite, handleAppend, handleDelete } from "../src/plugin/handlers.js";

// ---------------------------------------------------------------------------
// Test vault setup
// ---------------------------------------------------------------------------

const TEST_ROOT = join(tmpdir(), `carapace-obsidian-test-${Date.now()}`);
const VAULT_ROOT = join(TEST_ROOT, "vault");
const INDEX_PATH = join(TEST_ROOT, "index.db");

function writeNote(relPath: string, content: string): void {
  const abs = join(VAULT_ROOT, relPath);
  const dir = abs.substring(0, abs.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

function indexNote(db: Database.Database, relPath: string, content: string): void {
  const parsed = parseNote(content, relPath);
  db.prepare(
    "INSERT OR REPLACE INTO notes (path, title, content, frontmatter_json, mtime_ms) VALUES (?, ?, ?, ?, ?)"
  ).run(relPath, parsed.title, parsed.content, JSON.stringify(parsed.frontmatter), Date.now());

  db.prepare("DELETE FROM tags WHERE note_path = ?").run(relPath);
  for (const tag of parsed.tags) {
    db.prepare("INSERT OR REPLACE INTO tags (note_path, tag) VALUES (?, ?)").run(relPath, tag);
  }
  db.prepare("DELETE FROM links WHERE source_path = ?").run(relPath);
  for (const link of parsed.wikilinks) {
    db.prepare("INSERT INTO links (source_path, target, alias) VALUES (?, ?, ?)").run(relPath, link.target, link.alias);
  }
}

const NOTES: Record<string, string> = {
  "Projects/Battery Monitoring.md": `---
title: Battery Monitoring
tags: [homeassistant, automation]
---

# Battery Monitoring

Monitor battery levels. See also [[Zigbee Devices]] and [[Home Dashboard|Dashboard]].

#monitoring #iot
`,
  "Projects/Zigbee Devices.md": `---
tags: homeassistant
---

# Zigbee Devices

List of Zigbee devices. Related to [[Battery Monitoring]].

#networking #iot
`,
  "Projects/Home Dashboard.md": `---
title: Home Dashboard
---

# Home Dashboard

Central dashboard. Links to [[Battery Monitoring]] and [[Zigbee Devices]].

#homeassistant #dashboard
`,
  "Notes/Daily/2024-01-15.md": `# Daily Note

Today's tasks.

#daily
`,
  "Notes/Recipes/Pasta.md": `---
title: Pasta Recipe
tag: cooking, food
---

# Pasta Recipe

A simple pasta recipe.
`,
  "Reference/Appliances.md": `---
title: Appliances
---

# Appliances

Washing Machine
LG WM3900HWA

Washer/Dryer combo available.

Dryer
LG: DLEX3900W
`,
};

beforeAll(() => {
  mkdirSync(VAULT_ROOT, { recursive: true });
  for (const [path, content] of Object.entries(NOTES)) {
    writeNote(path, content);
  }
  const db = new Database(INDEX_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  for (const [path, content] of Object.entries(NOTES)) {
    indexNote(db, path, content);
  }
  db.close();
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Plugin entry tests
// ---------------------------------------------------------------------------

describe("plugin entry", () => {
  it("creates a plugin with correct name", async () => {
    const { createEntry } = await import("../src/plugin/entry.js");
    const plugin = createEntry();
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("Obsidian Vault");
    expect(plugin.id).toBe("obsidian-vault");
  });

  it("declares all expected tools in contracts", async () => {
    const { createEntry } = await import("../src/plugin/entry.js");
    const entry = createEntry();
    expect(entry.contracts.tools.sort()).toEqual([
      "vault_append",
      "vault_backlinks",
      "vault_delete",
      "vault_read",
      "vault_recent",
      "vault_related",
      "vault_search",
      "vault_tags",
      "vault_write",
    ]);
  });
});

// ---------------------------------------------------------------------------
// VaultReader tests
// ---------------------------------------------------------------------------

describe("VaultReader", () => {
  let reader: VaultReader;

  beforeAll(() => {
    reader = new VaultReader(INDEX_PATH);
  });

  afterAll(() => {
    reader?.close();
  });

  it("reports ready status", () => {
    expect(reader.ready).toBe(true);
    expect(reader.getStatus().state).toBe("ready");
  });

  it("searches via FTS5", () => {
    const results = reader.search("battery", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("Battery Monitoring");
  });

  it("prefix-matches partial words", () => {
    const results = reader.search("batter", 10);
    expect(results.length).toBeGreaterThan(0);
  });

  it("supports OR queries", () => {
    const results = reader.search("battery OR pasta", 10);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to LIKE for no FTS match", () => {
    const results = reader.search("#iot", 10);
    expect(results.length).toBeGreaterThan(0);
  });

  it("finds LG appliances", () => {
    const results = reader.search("LG", 10);
    expect(results.some((r) => r.path.includes("Appliances"))).toBe(true);
  });

  it("finds washer", () => {
    const results = reader.search("washer", 10);
    expect(results.length).toBeGreaterThan(0);
  });

  it("finds washing machine", () => {
    const results = reader.search("washing machine", 10);
    expect(results.some((r) => r.path.includes("Appliances"))).toBe(true);
  });

  it("returns empty for nonexistent terms", () => {
    expect(reader.search("xyznonexistent123", 10)).toHaveLength(0);
  });

  it("reads notes by path", () => {
    const note = reader.readNote("Projects/Battery Monitoring.md");
    expect(note).not.toBeNull();
    expect(note!.title).toBe("Battery Monitoring");
  });

  it("returns null for missing notes", () => {
    expect(reader.readNote("nonexistent.md")).toBeNull();
  });

  it("lists recent notes", () => {
    const recent = reader.listRecent(3);
    expect(recent.length).toBeLessThanOrEqual(3);
    expect(recent.length).toBeGreaterThan(0);
  });

  it("lists tags", () => {
    const tags = reader.listTags();
    expect(tags).toContain("homeassistant");
    expect(tags).toContain("iot");
    expect(tags).toContain("cooking");
  });

  it("finds backlinks", () => {
    const backlinks = reader.getBacklinks("Battery Monitoring");
    expect(backlinks.length).toBeGreaterThanOrEqual(2);
  });

  it("finds related notes", () => {
    const related = reader.getRelatedNotes("Projects/Battery Monitoring.md");
    expect(related.length).toBeGreaterThan(0);
  });

  it("returns note count", () => {
    expect(reader.getNoteCount()).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// VaultReader — missing/empty index
// ---------------------------------------------------------------------------

describe("VaultReader (missing index)", () => {
  it("reports index_missing when DB doesn't exist", () => {
    const reader = new VaultReader("/nonexistent/path/index.db");
    expect(reader.getStatus().state).toBe("index_missing");
    expect(reader.ready).toBe(false);
    expect(reader.search("test")).toEqual([]);
    reader.close();
  });

  it("reports index_empty when DB has no notes", () => {
    const emptyIndex = join(TEST_ROOT, "empty.db");
    const db = new Database(emptyIndex);
    db.pragma("journal_mode = WAL");
    initSchema(db);
    db.close();
    const reader = new VaultReader(emptyIndex);
    expect(reader.getStatus().state).toBe("index_empty");
    reader.close();
  });

  it("reports schema_incompatible for wrong version", () => {
    const badIndex = join(TEST_ROOT, "bad.db");
    const db = new Database(badIndex);
    db.pragma("user_version = 999");
    db.exec("CREATE TABLE notes (path TEXT PRIMARY KEY, title TEXT, content TEXT, frontmatter_json TEXT, mtime_ms INTEGER)");
    db.exec("INSERT INTO notes VALUES ('t.md', 'T', 'c', '{}', 0)");
    db.close();
    const reader = new VaultReader(badIndex);
    expect(reader.getStatus().state).toBe("schema_incompatible");
    reader.close();
  });
});

// ---------------------------------------------------------------------------
// Handler tests
// ---------------------------------------------------------------------------

describe("handlers", () => {
  let reader: VaultReader;

  beforeAll(() => {
    reader = new VaultReader(INDEX_PATH);
  });

  afterAll(() => {
    reader?.close();
  });

  it("handleSearch returns results", () => {
    const result = handleSearch(reader, "battery", 10) as { output: unknown[] };
    expect(result.output.length).toBeGreaterThan(0);
  });

  it("handleSearch returns error for empty query", () => {
    const result = handleSearch(reader, "", 10) as { error: string };
    expect(result.error).toContain("empty");
  });

  it("handleRead reads from filesystem", () => {
    const result = handleRead(
      { vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH },
      "Notes/Recipes/Pasta.md",
    ) as { output: Record<string, unknown> };
    expect(result.output.title).toBe("Pasta Recipe");
    expect(result.output.tags).toContain("cooking");
  });

  it("handleRead rejects path traversal", () => {
    const result = handleRead(
      { vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH },
      "../../etc/passwd",
    ) as { error: string };
    expect(result.error).toContain("Access denied");
  });

  it("handleRead returns error for missing note", () => {
    const result = handleRead(
      { vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH },
      "nonexistent.md",
    ) as { error: string };
    expect(result.error).toContain("not found");
  });

  it("handleRecent returns notes", () => {
    const result = handleRecent(reader, 3) as { output: unknown[] };
    expect(result.output.length).toBeGreaterThan(0);
  });

  it("handleTags returns tags", () => {
    const result = handleTags(reader) as { output: string[] };
    expect(result.output).toContain("homeassistant");
  });

  it("handleBacklinks finds links", () => {
    const result = handleBacklinks(reader, "Battery Monitoring") as { output: unknown[] };
    expect(result.output.length).toBeGreaterThanOrEqual(2);
  });

  it("handleRelated finds related notes", () => {
    const result = handleRelated(reader, "Projects/Battery Monitoring.md") as { output: unknown[] };
    expect(result.output.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Write handler tests
// ---------------------------------------------------------------------------

describe("write handlers", () => {
  const vaultConfig = { vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH };

  it("handleWrite creates a new note", () => {
    const result = handleWrite(vaultConfig, "Notes/NewNote.md", "# New Note\n\nHello world.", true) as { output: Record<string, unknown> };
    expect(result.output.action).toBe("created");
    expect(result.output.path).toBe("Notes/NewNote.md");
    expect((result.output.size as number)).toBeGreaterThan(0);
  });

  it("handleWrite overwrites an existing note", () => {
    const result = handleWrite(vaultConfig, "Notes/NewNote.md", "# Updated\n\nChanged.", false) as { output: Record<string, unknown> };
    expect(result.output.action).toBe("updated");
  });

  it("handleWrite creates parent directories when createDirs=true", () => {
    const result = handleWrite(vaultConfig, "Deep/Nested/Dir/Note.md", "# Deep Note", true) as { output: Record<string, unknown> };
    expect(result.output.action).toBe("created");
    expect(result.output.path).toBe("Deep/Nested/Dir/Note.md");
  });

  it("handleWrite rejects missing dir when createDirs=false", () => {
    const result = handleWrite(vaultConfig, "NoSuchDir/Note.md", "content", false) as { error: string };
    expect(result.error).toContain("Parent directory does not exist");
  });

  it("handleWrite rejects path traversal", () => {
    const result = handleWrite(vaultConfig, "../../etc/shadow", "evil", false) as { error: string };
    expect(result.error).toContain("Access denied");
  });

  it("handleWrite rejects empty path", () => {
    const result = handleWrite(vaultConfig, "", "content", false) as { error: string };
    expect(result.error).toContain("empty");
  });

  it("handleAppend appends to existing note", () => {
    const before = readFileSync(join(VAULT_ROOT, "Notes/NewNote.md"), "utf-8");
    const result = handleAppend(vaultConfig, "Notes/NewNote.md", "\n## Appended Section") as { output: Record<string, unknown> };
    expect(result.output.action).toBe("appended");
    const after = readFileSync(join(VAULT_ROOT, "Notes/NewNote.md"), "utf-8");
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain("Appended Section");
  });

  it("handleAppend returns error for missing note", () => {
    const result = handleAppend(vaultConfig, "DoesNotExist.md", "text") as { error: string };
    expect(result.error).toContain("not found");
  });

  it("handleAppend rejects empty path", () => {
    const result = handleAppend(vaultConfig, "", "text") as { error: string };
    expect(result.error).toContain("empty");
  });

  it("handleAppend rejects path traversal", () => {
    const result = handleAppend(vaultConfig, "../../etc/passwd", "evil") as { error: string };
    expect(result.error).toContain("Access denied");
  });

  it("handleDelete deletes a note", () => {
    // Create a temp note to delete
    handleWrite(vaultConfig, "Temp/ToDelete.md", "# Delete me", true);
    const result = handleDelete(vaultConfig, "Temp/ToDelete.md") as { output: Record<string, unknown> };
    expect(result.output.action).toBe("deleted");
    expect(result.output.path).toBe("Temp/ToDelete.md");
  });

  it("handleDelete returns error for missing note", () => {
    const result = handleDelete(vaultConfig, "NonExistent.md") as { error: string };
    expect(result.error).toContain("not found");
  });

  it("handleDelete rejects empty path", () => {
    const result = handleDelete(vaultConfig, "") as { error: string };
    expect(result.error).toContain("empty");
  });

  it("handleDelete rejects path traversal", () => {
    const result = handleDelete(vaultConfig, "../../etc/passwd") as { error: string };
    expect(result.error).toContain("Access denied");
  });
});
