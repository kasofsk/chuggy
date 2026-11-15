/**
 * The rendered cases: one headless Chromium, no retries, and nothing written
 * into the tree. `run.ts` is what starts this, once its preconditions hold.
 */

import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: join(tmpdir(), "chuggy-ui-rendered"),
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  use: { browserName: "chromium", headless: true },
});
