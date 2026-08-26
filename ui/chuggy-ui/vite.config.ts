/**
 * The console's build, its dev server and its suite runner.
 *
 * The dev server is the setting with a reason outside this file: `src/contract/`
 * is imported from outside this root, so the root above has to be readable or
 * the console will not start. The rest is the shape of the console — React, a
 * suite runner with a document, and suites that live in one directory. What the
 * production build emits is held to the policy the web image serves it under by
 * `scripts/check-console-policy.ts`, which the `build` script runs.
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ["../.."] } },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
