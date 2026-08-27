/**
 * How the drills are run: one Chromium, one worker, no retries.
 *
 * The drills share one rig and two of them break it on purpose, so running two
 * at once would have each of them observing the other's damage. A retry would be
 * worse than a failure for the same reason — the second attempt starts from
 * whatever the first left behind.
 *
 * The JSON report is not decoration: `test/rig/verdict.ts` reads it back, and it
 * is the only place a skipped drill states why it did not run.
 */

import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const evidenceDir =
  process.env["CHUG_RIG_EVIDENCE_DIR"] ??
  join(tmpdir(), "chuggy-rig-acceptance");

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: join(evidenceDir, "runs"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 600_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: join(evidenceDir, "report.json") }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    ignoreHTTPSErrors: false,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
