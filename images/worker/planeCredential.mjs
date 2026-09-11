/**
 * The git credential this pod asks the worker plane for, minted for its one
 * repository at the moment it is needed.
 *
 * THE PLANE DECIDES AND THE POD ASKS. An attempt names nothing at all: the
 * plane reads the repository off the attempt's own row and mints the least the
 * recorded task kind needs, so a pod cannot widen what it is given by asking. A
 * session names its repository, because a site may have placed it against a
 * mirror of the binding, and the plane holds that name to the project's own
 * bindings.
 *
 * NOT FOUND IS THE LAUNCHER'S CREDENTIAL AND EVERYTHING ELSE IS A FAILURE. A
 * deployment holding no app key, and a repository no claim of this tenant's
 * covers, both answer not found; the pod then resolves what its launcher
 * mounted, which is what it did before this plane minted anything. Any other
 * refusal or outage reaches the caller as the transport reports one, because a
 * credential the plane meant to mint and could not is no reason to reach a
 * remote with something else.
 *
 * THE PASSWORD IS WRITTEN AND NEVER PASSED. git reads it through the askpass
 * script, which reads a file, so the value reaches no argument list and no
 * child's environment. The file is rewritten in place when an attempt that has
 * outlived its token asks again.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { workerCredentialEnvironment } from "./repository.mjs";
import { workerRequest } from "./transport.mjs";

/** The route an attempt bearer asks its own credential through. */
export const workerCredentialPath = "/v1/credential";

/** The route a session bearer asks a repository's credential through. */
export const sessionCredentialPath = "/v1/session/credential";

/** What the plane answers for a repository it mints nothing for. */
const notMintedStatus = 404;

/** The file the minted password stands in, which only this pod can read. */
const planeCredentialFileName = "chuggy-git-credential";

/** What the file is created with, so nothing outside this pod's user reads it. */
const planeCredentialFileMode = 0o600;

/** @param {unknown} minted */
function planeCredentialChecked(minted) {
  const answered = /** @type {{username?: unknown, password?: unknown}} */ (
    minted
  );
  if (
    typeof answered?.username !== "string" ||
    answered.username.length === 0 ||
    typeof answered.password !== "string" ||
    answered.password.length === 0
  )
    throw new Error("the worker plane answered a credential it did not mint");
  return { username: answered.username, password: answered.password };
}

/**
 * The credential the plane minted for this pod, or nothing where it mints none
 * for this repository and the pod falls back to what its launcher mounted.
 *
 * `request` is the seam each mode reaches the plane through, and `write` is the
 * one a suite reads the password back from.
 */
export async function planeCredential({
  task,
  bearer,
  path,
  repository,
  request = workerRequest,
  environment = process.env,
  write = writeFile,
}) {
  const response = await request(
    task,
    bearer,
    path,
    repository === undefined
      ? { method: "POST" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repository }),
        },
    { settled: [notMintedStatus] },
  );
  if (response.status === notMintedStatus) return undefined;
  if (!response.ok)
    throw new Error(
      `the worker plane answered ${String(response.status)} for a credential`,
    );
  const minted = planeCredentialChecked(await response.json());
  const file = join(environment.TMPDIR ?? "/tmp", planeCredentialFileName);
  await write(file, minted.password, { mode: planeCredentialFileMode });
  return {
    file,
    password: minted.password,
    environment: workerCredentialEnvironment(file, minted.username),
  };
}
