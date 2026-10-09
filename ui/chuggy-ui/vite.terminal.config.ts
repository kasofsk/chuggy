/**
 * Builds the setup program: `terminal/main.ts` and everything it reaches, as
 * one ES module a person's Node runs with nothing installed beside it.
 *
 * It is emitted at the root of `dist/` under the name the console serves it
 * at, after the console's own build, which empties that directory. Every
 * package is inlined and only Node's own modules stay as imports; which of
 * those the program may name is the boundary gate's roster, not this file's.
 * The syntax is held to what an older Node parses, so the program reaches its
 * own version check there rather than dying on a token.
 */

import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { setupProgramPath } from "./app/core/setupProgram.ts";

const builtinPrefix = "node:";

/**
 * Fails the build where the program is not one file or names an import a bare
 * Node cannot resolve, which no later step would notice before a person ran it.
 */
function selfContained(): Plugin {
  return {
    name: "chuggy-setup-self-contained",
    generateBundle(_options, bundle) {
      const files = Object.values(bundle);
      if (files.length !== 1) this.error("the setup program is not one file");
      for (const file of files) {
        if (file.type !== "chunk") continue;
        const foreign = [...file.imports, ...file.dynamicImports].filter(
          (name) => !name.startsWith(builtinPrefix),
        );
        if (foreign.length > 0)
          this.error(
            `the setup program imports what is not Node's: ${foreign.join(", ")}`,
          );
      }
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [selfContained()],
  build: {
    target: "es2020",
    emptyOutDir: false,
    minify: false,
    copyPublicDir: false,
    lib: {
      entry: "terminal/main.ts",
      formats: ["es"],
      fileName: () => setupProgramPath.slice(1),
    },
    rollupOptions: { external: [new RegExp(`^${builtinPrefix}`, "u")] },
  },
});
