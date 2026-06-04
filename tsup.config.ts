import { defineConfig } from "tsup";
import { definePluginConfig } from "carapace-plugin-sdk/tsup";

export default defineConfig([
  definePluginConfig({
    entry: [
      "src/plugin.ts",
      "src/index.ts",
      "src/plugin/reader.ts",
      "src/plugin/handlers.ts",
      "src/plugin/entry.ts",
      "src/lib/index.ts",
      "src/lib/parser.ts",
      "src/lib/security.ts",
      "src/lib/schema.ts",
      "src/lib/types.ts",
      "src/service/index.ts",
      "src/service/indexer.ts",
      "src/service/log.ts",
    ],
    dts: true,
  }),
]);
