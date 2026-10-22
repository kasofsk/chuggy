/**
 * The git credential a pod is answered with: for the repository its own
 * durable row names, or a read of another its project binds.
 *
 * A POD MAY ASK FOR A READ OF ANY REPOSITORY ITS PROJECT BINDS, AND NEVER FOR
 * MORE. An attempt's own repository is the one its input bundle pinned. Asked
 * for with no name, it is minted what the task kind the scheduler recorded
 * needs, so a pod cannot obtain a push by asking for one; asked for by name, it
 * is minted `read`. Every other repository an attempt names, and every one a
 * session names, is held to the project's live bindings before anything is
 * minted, and is minted `read`: a ticket delivers to its one repository, and
 * reads whichever of the others its work needs.
 *
 * LEAST PRIVILEGE PER MINT. A work attempt pushes its branch, so its own
 * repository asked for with no name is minted `write`; an evaluation attempt
 * reads it, so it is minted `read`. Asked for by name, it is a read whatever
 * the kind, so a pod that only reads it need hold no more.
 *
 * A REFUSAL IS NOT AN OUTAGE. A repository no claim of this tenant's covers, a
 * repository the project does not bind or has retired, and a forge that refused
 * this app are all `NotFound`, settled for as long as the claim is absent: a
 * pod falls back from it to its launcher's mount for the repository it works
 * in, and holds no credential for any other it named. A forge or a store that
 * could not be reached is `Unavailable`, and may be asked again.
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
import type { ProjectRepositoryLandingStore } from "./repositoryBinding.ts";
import type { WorkerAttemptAuthority } from "./workerPlane.ts";

/**
 * The username a minted installation token is presented to git under, which is
 * the forge's own spelling and the one a mounted credential is configured with.
 */
export const forgeCredentialUsername = "x-access-token";

/** The input reference kind that names the repository an attempt works against. */
const repositoryReferenceKind = "Repository";

/** What each task kind's pod does to its own repository, which is what it is minted for. */
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
  /** The attempt's own repository, minted for its task kind where `repository` names none and `read` where it names it, and otherwise a read of the one it names. */
  attempt(
    authority: WorkerAttemptAuthority,
    repository?: RepositoryId,
  ): Promise<WorkerPlaneCredentialMinted>;
  session(
    partition: Partition,
    repository: RepositoryId,
  ): Promise<WorkerPlaneCredentialMinted>;
}

/**
 * Everything the minting is composed with, all of it read under the caller's
 * own tenant. A binding is read through the door that answers its retirement,
 * because the read in-flight work names its repository through answers a
 * retired binding as though it stood.
 */
export interface WorkerPlaneCredentialOptions {
  readonly tokens: ForgeRepositoryTokens;
  readonly bindings: Pick<ProjectRepositoryLandingStore, "landing">;
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
 * The repository a project binds live under the name a pod gave, a read that
 * raised being kept apart from a project that binds no such thing or retired
 * it, which another project may since have bound.
 */
async function workerPlaneCredentialBound(
  bindings: Pick<ProjectRepositoryLandingStore, "landing">,
  partition: Partition,
  repository: RepositoryId,
): Promise<
  | { readonly read: "Binding"; readonly repository: RepositoryId }
  | { readonly read: "Absent" }
  | { readonly read: "Unavailable" }
> {
  return bindings.landing(partition, repository).then(
    (bound) =>
      bound === undefined || bound.retiredAt !== undefined
        ? ({ read: "Absent" } as const)
        : ({ read: "Binding", repository: bound.repository } as const),
    () => ({ read: "Unavailable" }) as const,
  );
}

/** A read of a repository a pod named, minted only where its project binds it live. */
async function workerPlaneCredentialRead(
  options: WorkerPlaneCredentialOptions,
  partition: Partition,
  repository: RepositoryId,
): Promise<WorkerPlaneCredentialMinted> {
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
}

/** Mints for the repository a pod's own row names, and a read of any other its project binds live. */
export function workerPlaneCredentialMinting(
  options: WorkerPlaneCredentialOptions,
): WorkerPlaneCredentialMinting {
  return {
    attempt: async (authority, named) => {
      const own = workerPlaneCredentialRepository(authority);
      if (named === undefined)
        return own === undefined
          ? { minted: "NotFound" }
          : workerPlaneCredentialMinted(
              options.tokens,
              own,
              authority.partition,
              workerPlaneCredentialPermissions[authority.taskKind],
            );
      return named === own
        ? workerPlaneCredentialMinted(
            options.tokens,
            own,
            authority.partition,
            "read",
          )
        : workerPlaneCredentialRead(options, authority.partition, named);
    },
    session: (partition, repository) =>
      workerPlaneCredentialRead(options, partition, repository),
  };
}
