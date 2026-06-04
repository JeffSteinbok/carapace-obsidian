/**
 * Obsidian plugin entry — creates the plugin registration for OpenClaw.
 */
import { definePlugin } from "carapace-plugin-sdk";

export function createEntry() {
  return definePlugin({
    name: "obsidian",
    description: "Obsidian plugin and indexer service for OpenClaw",
    tools: [],
  });
}
