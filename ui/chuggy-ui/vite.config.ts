/**
 * The console's build, its dev server and its suite runner.
 *
 * The dev server is the setting with a reason outside this file: `src/contract/`
 * is imported from outside this root, so the root above has to be readable or
 * the console will not start. The rest is the shape of the console — React, a
 * suite runner with a document, and suites that live in one directory. What the
 * production build emits is held to the policy the web image serves it under by
 * `scripts/check-console-policy.ts`, which the `build` script runs.
 *
 * `execArgv` is the other setting with a reason outside this file. Node now
 * defines `localStorage` on its own global, as a getter that yields undefined
 * unless a storage file was named, and the suite runner only copies a document
 * property onto the global when the global lacks it.
 * A suite would then read Node's undefined where it expects the document's
 * storage. Leaving Node's web storage off is what keeps the runner on the
 * document's, on every Node line the suites run under.
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ["../.."] } },
  test: {
    environment: "jsdom",
    execArgv: ["--no-experimental-webstorage"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
