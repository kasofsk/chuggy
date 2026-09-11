/**
 * The git credential a pod is answered with, minted for the one repository that
 * pod's own durable row names.
 *
 * THE POD NAMES NOTHING THE PLANE THEN TRUSTS. An attempt's repository is the
 * one its input bundle pinned and its permission set follows from the task kind
 * the scheduler recorded, so a pod cannot obtain a push by asking for one. A
 * session names its repository because its placement bound one, and the plane
 * holds that name to the project's own bindings before anything is minted.
 *
 * LEAST PRIVILEGE PER MINT. A work attempt pushes its branch, so it is minted
 * `write`; an evaluation attempt and a session read, so they are minted `read`.
 *
 * A REFUSAL IS NOT AN OUTAGE. A repository no claim of this tenant's covers, a
 * session naming a repository its project does not bind, and a forge that
 * refused this app are all `NotFound` — the answer a pod falls back from, and
 * settled for as long as the claim is absent. A forge or a store that could not
 * be reached is `Unavailable`, and may be asked again.
 */

import { assertNever } from "../domain/assertNever.ts";
import type { ExecutionTaskKind } from "./executionRequirement.ts";
import { asRepositoryId, type RepositoryId } from "./finalizer.ts";
import type {
  ForgeInstallationToken,
  ForgePermissionSet,
  ForgeRepositoryTokens,
} from "./forgeInstallation.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";
import type { WorkerAttemptAuthority } from "./workerPlane.ts";

/**
 * The username a minted installation token is presented to git under, which is
 * the forge's own spelling and the one a mounted credential is configured with.
 */
export const forgeCredentialUsername = "x-access-token";

/** The input reference kind that names the repository an attempt works against. */
const repositoryReferenceKind = "Repository";

/** What each task kind's pod does to its repository, which is what it is minted for. */
const workerPlaneCredentialPermissions: Readonly<
  Record<ExecutionTaskKind, ForgePermissionSet>
> = { Work: "write", Evaluation: "read" };

/** One git credential as a pod presents it: a username, a token, and when it stops working. */
export interface WorkerPlaneCredential {
  readonly username: string;
  readonly password: ForgeInstallationToken;
  readonly expiresAtMs: number;
}

/** What minting for a pod came to, a refusal kept apart from an outage. */
export type WorkerPlaneCredentialMinted =
  | { readonly minted: "Credential"; readonly value: WorkerPlaneCredential }
  | { readonly minted: "NotFound" }
  | { readonly minted: "Unavailable" };

/** Mints the credential one pod needs, each half answering only its own bearer. */
export interface WorkerPlaneCredentialMinting {
  attempt(
    authority: WorkerAttemptAuthority,
  ): Promise<WorkerPlaneCredentialMinted>;
  session(
    partition: Partition,
    repository: RepositoryId,
  ): Promise<WorkerPlaneCredentialMinted>;
}

/** Everything the minting is composed with, all of it read under the caller's own tenant. */
export interface WorkerPlaneCredentialOptions {
  readonly tokens: ForgeRepositoryTokens;
  readonly bindings: ProjectRepositoryBindingRead;
}

/**
 * The repository an attempt's input bundle pinned, or nothing where the bundle
 * does not pin exactly one: a bundle naming none has no repository to mint for,
 * and one naming several leaves the choice to the pod.
 */
function workerPlaneCredentialRepository(
  authority: WorkerAttemptAuthority,
): RepositoryId | undefined {
  const named = authority.inputs.filter(
    (input) => input.kind === repositoryReferenceKind,
  );
  const only = named[0];
  return named.length === 1 && only !== undefined
    ? asRepositoryId(only.reference)
    : undefined;
}

/** One mint, a store or a forge that raised being an outage rather than an answer. */
async function workerPlaneCredentialMinted(
  tokens: ForgeRepositoryTokens,
  repository: RepositoryId,
  partition: Partition,
  permissions: ForgePermissionSet,
): Promise<WorkerPlaneCredentialMinted> {
  const minted = await tokens
    .token(repository, partition.tenant, permissions)
    .catch(() => ({ minted: "Unavailable" }) as const);
  switch (minted.minted) {
    case "Token":
      return {
        minted: "Credential",
        value: {
          username: forgeCredentialUsername,
          password: minted.token,
          expiresAtMs: minted.expiresAtMs,
        },
      };
    case "Denied":
      return { minted: "NotFound" };
    case "Unavailable":
      return { minted: "Unavailable" };
    default:
      return assertNever(minted);
  }
}

/**
 * The repository a session's project binds under the name the session gave, a
 * read that raised being kept apart from a project that binds no such thing.
 */
async function workerPlaneCredentialBound(
  bindings: ProjectRepositoryBindingRead,
  partition: Partition,
  repository: RepositoryId,
): Promise<
  | { readonly read: "Binding"; readonly repository: RepositoryId }
  | { readonly read: "Absent" }
  | { readonly read: "Unavailable" }
> {
  return bindings.binding(partition, repository).then(
    (bound) =>
      bound === undefined
        ? ({ read: "Absent" } as const)
        : ({ read: "Binding", repository: bound.repository } as const),
    () => ({ read: "Unavailable" }) as const,
  );
}

/** Mints for the repository a pod's own row names, and for no other. */
export function workerPlaneCredentialMinting(
  options: WorkerPlaneCredentialOptions,
): WorkerPlaneCredentialMinting {
  return {
    attempt: async (authority) => {
      const repository = workerPlaneCredentialRepository(authority);
      return repository === undefined
        ? { minted: "NotFound" }
        : workerPlaneCredentialMinted(
            options.tokens,
            repository,
            authority.partition,
            workerPlaneCredentialPermissions[authority.taskKind],
          );
    },
    session: async (partition, repository) => {
      const bound = await workerPlaneCredentialBound(
        options.bindings,
        partition,
        repository,
      );
      if (bound.read === "Unavailable") return { minted: "Unavailable" };
      return bound.read === "Absent"
        ? { minted: "NotFound" }
        : workerPlaneCredentialMinted(
            options.tokens,
            bound.repository,
            partition,
            "read",
          );
    },
  };
}
