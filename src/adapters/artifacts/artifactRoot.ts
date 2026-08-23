/**
 * The one thing project-owned artifact storage must be before it is asked for
 * an artifact: a directory this process may write into.
 *
 * IT IS A VERDICT AND NOT A REPAIR. Nothing here makes the root or changes its
 * mode, because a root that is not there is storage a deployment has not
 * mounted, and making an empty directory in its place would hide that instead
 * of reporting it.
 */

import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

import type { RuntimePrecondition } from "../../interpreter/serviceRuntime.ts";

/** Requires the artifact root to be a directory this process may write into. */
export function artifactRootPrecondition(root: string): RuntimePrecondition {
  return {
    name: "artifact-root-writable",
    check: async (signal) => {
      signal.throwIfAborted();
      const found = await stat(root);
      if (!found.isDirectory()) return false;
      signal.throwIfAborted();
      await access(root, constants.W_OK | constants.X_OK);
      return true;
    },
  };
}
