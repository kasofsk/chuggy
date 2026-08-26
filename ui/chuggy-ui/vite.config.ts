/**
 * The console's build, its dev server and its suite runner.
 *
 * The one setting that is not a default is the dev server's: `src/contract/`
 * is imported from outside this root, so the root above has to be readable or
 * the console will not start. What the production build emits is held to the
 * policy the web image serves it under by `tools/checkPolicy.ts`.
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
