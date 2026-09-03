/**
 * The repository a session pod reads, cloned once before its runtime opens so
 * the SDK's `cwd` is a working tree and `settingSources: ["project"]` has a
 * `CLAUDE.md` to load.
 *
 * IT IS THE DEFAULT-BRANCH HEAD AND IT IS NOT PINNED. A work attempt clones
 * `--no-checkout` and detaches onto the `TargetCommit` its decision froze
 * (`./entrypoint.mjs`); a session has no ticket, so it has no decision and no
 * commit to freeze. A standing reader wants the tree as it is rather than as it
 * was, so the clone takes the remote's own default branch and a new pod is a
 * new read of the tree. The commit it landed on is logged, because a lead that
 * reasons about the tree leaves a record of which tree it was.
 *
 * THE SITE'S MAP AND ITS GRANT CHECK ARE THE WORKER'S, REUSED RATHER THAN
 * COPIED. `workerRepository()` resolves the reference against
 * `CHUG_WORKER_REPOSITORIES`, refuses a repository with no URL, credential or
 * username, and builds the `GIT_ASKPASS` environment; the grant check beside it
 * is `./entrypoint.mjs`'s own. A second resolver would be a second set of rules
 * for the same site data.
 *
 * A MISCONFIGURED SITE IS LOUD AND A FAILED CLONE IS NOT. A reference the map
 * does not carry, or a credential the attempt's authority does not grant, is a
 * launcher that placed a pod it never gave a tree to: it raises, and the
 * session fails to start. A clone that reached git and did not finish is the
 * other case — the network, the remote, the disk — and it returns nothing: a
 * lead that cannot read the tree can still read the project through the API and
 * decide, and refusing to start would trade a degraded lead for none.
 *
 * NOTHING WRITES TO THE CHECKOUT, AND THAT IS A POD-SIDE CONTROL. The lead's
 * roster does not carry `RepositoryWrite`, so `./chuggyTools.mjs` puts `Write`,
 * `Edit` and `NotebookEdit` in `disallowedTools` — which the runtime inside the
 * pod is what reads. The filesystem grants the pod write on its own workspace,
 * so this is a roster the controlled thing enforces and not a permission; the
 * ceiling that is not the pod's is the session's membership at the API.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { workerRepository } from "./repository.mjs";

const executeFile = promisify(execFile);

/** The directory under the workspace a session's tree is cloned into, which is the worker's own name. */
const sessionCheckoutDirectory = "repository";

/** What one git call may print back, matching the worker's own ceiling. */
const sessionCheckoutBufferBytesMax = 16 * 1024 * 1024;

/**
 * A hard wall-clock bound on one git call. `execFile` has none by default, so a
 * remote that accepts the connection and then stalls would hang the pod before
 * its first turn with nothing but the pod's `activeDeadlineSeconds` beneath it,
 * and a hang before the first turn is a session that never reports why.
 *
 * IT IS THE IMAGE'S RATHER THAN THE LAUNCHER'S, which is the shape
 * `chuggyToolTimeoutMs` already has: a ceiling on one call the pod makes, not a
 * loop a deployment chose the size of, and the bounds `checkedSessionBounds`
 * refuses to invent are the latter. Exceeding it is the degraded arm below, so
 * a stalled remote is a lead with no tree rather than a pod nobody can settle.
 */
export const sessionCheckoutTimeoutMs = 300_000;

async function git(args, options) {
  return executeFile("git", args, {
    maxBuffer: sessionCheckoutBufferBytesMax,
    ...options,
  });
}

/**
 * The tree one session reads, or nothing where it has none: a project that
 * binds no repository, or a clone that did not finish.
 *
 * `run` and `log` are seams so a suite can drive a real clone and still say
 * where its output went; the defaults are `git` itself and the pod's stderr.
 */
export async function sessionCheckout(
  task,
  repositories,
  credentialFiles,
  workspace,
  services = {},
) {
  const {
    run = git,
    log = (text) => process.stderr.write(text),
    scrub = (text) => text,
  } = services;
  if (task.repository === undefined) return undefined;
  const reference = task.repository.reference;
  const { repository, credential, environment } = workerRepository(
    repositories,
    credentialFiles,
    reference,
  );
  if (!task.authority.credentials.includes(credential))
    throw new Error(`session authority does not grant ${credential}`);
  const directory = join(workspace, sessionCheckoutDirectory);
  try {
    await run(["clone", repository, directory], {
      env: environment,
      timeout: sessionCheckoutTimeoutMs,
    });
    const { stdout } = await run(["rev-parse", "HEAD"], {
      cwd: directory,
      env: environment,
      timeout: sessionCheckoutTimeoutMs,
    });
    const commit = stdout.trim();
    log(`session checkout ${reference} at ${commit}\n`);
    return { directory, commit };
  } catch (failure) {
    log(
      scrub(
        `session checkout ${reference} failed: ${
          failure instanceof Error ? failure.message : String(failure)
        }\n`,
      ),
    );
    return undefined;
  }
}
