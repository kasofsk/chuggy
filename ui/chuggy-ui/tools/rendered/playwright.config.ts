/**
 * The rendered cases: one headless Chromium, no retries, and nothing written
 * into the tree. `run.ts` is what starts this, once its preconditions hold.
 *
 * The pool is half the CPUs this process may use, which is Playwright's own
 * default taken from `availableParallelism` rather than `cpus`, so a CPU quota
 * narrower than the host sizes it.
 */

import { defineConfig } from "@playwright/test";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: join(tmpdir(), "chuggy-ui-rendered"),
  retries: 0,
  workers: Math.max(1, Math.floor(availableParallelism() / 2)),
  forbidOnly: true,
  reporter: [["list"]],
  use: { browserName: "chromium", headless: true },
});
