/**
 * The git credential a pod is answered with, for the one repository that pod's
 * own durable row names.
 *
 * THE POD NAMES NOTHING THE PLANE THEN TRUSTS. An attempt's repository is the
 * one its input bundle pinned and its permission set follows from the task kind
 * the scheduler recorded, so a pod cannot obtain a push by asking for one. A
 * session names its repository because its placement bound one, and the plane
 * holds that name to the project's own bindings before anything is minted or
 * read.
 *
 * LEAST PRIVILEGE PER MINT, AND A MOUNT ONLY WHERE THERE IS NO MINT. A work
 * attempt pushes its branch, so it is minted `write`; an evaluation attempt and
 * a session read, so they are minted `read`. A deployment whose git is not a
 * forge has no such thing to mint against, so the plane also composes the
 * mounted sources its launcher holds — consulted only after minting answered
 * `NotFound`, which is the settled answer for a repository no installation
 * covers. A mounted credential is one secret with whatever scope the operator
 * gave it and is not narrowed per attempt, which is why the mint is asked
 * first and the mount is what a non-forge remote falls back to.
 *
 * A FORGE THAT COULD NOT BE REACHED IS NOT A REASON TO WIDEN. An outage from
 * the mint stays an outage rather than falling through to the mount, because
 * falling through would hand out the wider credential exactly when the narrower
 * one could not be obtained.
 *
 * A REFUSAL IS NOT AN OUTAGE. A repository no claim of this tenant's covers, a
 * session naming a repository its project does not bind, a forge that refused
 * this app and a repository this deployment mounts no file for are all
 * `NotFound` — the answer a pod falls back from, and settled for as long as the
 * claim is absent. A forge, a store or a mount that could not be read is
 * `Unavailable`, and may be asked again.
 */

import { assertNever } from "../domain/assertNever.ts";
import type {
  CredentialResolved,
  RepositoryBinding,
  RepositoryCredential,
  RepositoryCredentialPort,
  RepositoryId,
} from "./finalizer.ts";
import type {
  ForgeInstallationToken,
  ForgePermissionSet,
  ForgeRepositoryTokens,
} from "./forgeInstallation.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";
import type { TicketExecutionAccess } from "./ticketExecutionOutcome.ts";

/**
 * The username a minted installation token is presented to git under, which is
 * the forge's own spelling and the one a mounted credential is configured with.
 */
export const forgeCredentialUsername = "x-access-token";

/**
 * How long a pod may present a mounted credential before reading it again. A
 * file does not expire, so the expiry it is answered with is a re-read interval
 * rather than a grant's end: a rotated mount reaches a long-running attempt
 * within it, and it is wider than the harness's own re-mint margin so no pod is
 * handed a credential it must immediately replace.
 */
export const mountedCredentialLifetimeMs = 900_000;

/** One git credential as a pod presents it: a username, a secret, and when it stops working. */
export interface WorkerPlaneCredential {
  readonly username: string;
  readonly password: ForgeInstallationToken | RepositoryCredential;
  readonly expiresAtMs: number;
}

/** What minting for a pod came to, a refusal kept apart from an outage. */
export type WorkerPlaneCredentialMinted =
  | { readonly minted: "Credential"; readonly value: WorkerPlaneCredential }
  | { readonly minted: "NotFound" }
  | { readonly minted: "Unavailable" };

/** Mints the credential one pod needs, each half answering only its own bearer. */
export interface WorkerPlaneCredentialMinting {
  session(
    partition: Partition,
    repository: RepositoryId,
  ): Promise<WorkerPlaneCredentialMinted>;
  attempt(
    partition: Partition,
    repository: RepositoryId,
    access: TicketExecutionAccess,
  ): Promise<WorkerPlaneCredentialMinted>;
}

/**
 * The mounted half: the files this deployment holds, the username the secret in
 * them is presented under, and the clock the re-read interval is measured from.
 */
export interface WorkerPlaneMountedCredentials {
  readonly credentials: RepositoryCredentialPort;
  readonly username: string;
  readonly now: () => number;
}

/**
 * Everything the minting is composed with, the binding read being what carries
 * the caller's tenant and what gates both sources: a mint goes out under the
 * tenant beside the repository, and a mount is keyed on the repository alone,
 * so which file a pod can reach is decided by whose binding named it rather
 * than by the map. A deployment holding no forge app names no `tokens` and
 * answers from its mounts alone; one mounting nothing names no `mounted` and is
 * the deployment this tree already had.
 */
export interface WorkerPlaneCredentialOptions {
  readonly tokens?: ForgeRepositoryTokens;
  readonly bindings: ProjectRepositoryBindingRead;
  readonly mounted?: WorkerPlaneMountedCredentials;
}

/** One mint, a store or a forge that raised being an outage rather than an answer. */
async function workerPlaneCredentialMinted(
  tokens: ForgeRepositoryTokens | undefined,
  repository: RepositoryId,
  partition: Partition,
  permissions: ForgePermissionSet,
): Promise<WorkerPlaneCredentialMinted> {
  if (tokens === undefined) return { minted: "NotFound" };
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
 * One read of the mount this deployment holds for the binding, under the whole
 * binding rather than its name alone, so that a deployment naming one file per
 * credential rather than one per repository is selected from the way it is
 * everywhere else this port is composed.
 */
async function workerPlaneCredentialMounted(
  mounted: WorkerPlaneMountedCredentials,
  binding: RepositoryBinding,
): Promise<WorkerPlaneCredentialMinted> {
  const resolved = await mounted.credentials
    .credential(binding)
    .catch((): CredentialResolved => ({ resolved: "Unavailable" }));
  switch (resolved.resolved) {
    case "Credential":
      return {
        minted: "Credential",
        value: {
          username: mounted.username,
          password: resolved.credential,
          expiresAtMs: mounted.now() + mountedCredentialLifetimeMs,
        },
      };
    case "Denied":
      return { minted: "NotFound" };
    case "Unavailable":
      return { minted: "Unavailable" };
    default:
      return assertNever(resolved);
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
  | { readonly read: "Binding"; readonly binding: RepositoryBinding }
  | { readonly read: "Absent" }
  | { readonly read: "Unavailable" }
> {
  return bindings.binding(partition, repository).then(
    (bound) =>
      bound === undefined
        ? ({ read: "Absent" } as const)
        : ({ read: "Binding", binding: bound } as const),
    () => ({ read: "Unavailable" }) as const,
  );
}

/** One credential on the binding a pod's own project holds, under the permissions its caller derived. */
async function workerPlaneCredentialFor(
  options: WorkerPlaneCredentialOptions,
  partition: Partition,
  repository: RepositoryId,
  permissions: ForgePermissionSet,
): Promise<WorkerPlaneCredentialMinted> {
  const bound = await workerPlaneCredentialBound(
    options.bindings,
    partition,
    repository,
  );
  if (bound.read === "Unavailable") return { minted: "Unavailable" };
  if (bound.read === "Absent") return { minted: "NotFound" };
  const minted = await workerPlaneCredentialMinted(
    options.tokens,
    bound.binding.repository,
    partition,
    permissions,
  );
  const mounted = options.mounted;
  return minted.minted === "NotFound" && mounted !== undefined
    ? workerPlaneCredentialMounted(mounted, bound.binding)
    : minted;
}

/**
 * The permission set one attempt's recorded access comes to. The access is the
 * scheduler's own reading of the workload and is on the attempt's row before a
 * harness exists, so nothing a caller says reaches this.
 */
function workerPlaneCredentialPermissions(
  access: TicketExecutionAccess,
): ForgePermissionSet {
  return access === "PublishRepositoryResult" ? "write" : "read";
}

/** Answers for the repository a pod's own row names, and for no other. */
export function workerPlaneCredentialMinting(
  options: WorkerPlaneCredentialOptions,
): WorkerPlaneCredentialMinting {
  return {
    session: (partition, repository) =>
      workerPlaneCredentialFor(options, partition, repository, "read"),
    attempt: (partition, repository, access) =>
      workerPlaneCredentialFor(
        options,
        partition,
        repository,
        workerPlaneCredentialPermissions(access),
      ),
  };
}
