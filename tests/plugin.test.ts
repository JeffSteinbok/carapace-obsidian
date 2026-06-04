import { describe, it, expect } from "vitest";
import { createEntry } from "../src/plugin/entry.js";

describe("plugin entry", () => {
  it("creates a plugin with correct name", () => {
    const plugin = createEntry();
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("obsidian");
  });
});
