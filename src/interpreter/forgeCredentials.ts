/**
 * Where a repository's credential comes from when some hosts mint and the rest
 * are read from files, and the authorized service that mints one for a caller.
 *
 * THE HOST IS WHAT SELECTS THE SOURCE. A repository identity is its remote's
 * URL, so the host in it says which forge holds it; a deployment that composes
 * a minting source for that host mints, and every other repository is answered
 * by the files exactly as before. A deployment composing no minting source is
 * therefore the deployment this tree already had.
 *
 * A REPOSITORY THIS PROJECT DOES NOT BIND IS NOT FOUND. The service authorizes
 * `Execute` on the project and then asks the binding read for the repository the
 * caller named, so a member of one project cannot mint for another's
 * repository, and a bound repository whose owner no installation covers is
 * `NotFound` rather than an outage.
 *
 * AN OUTAGE IS ITS OWN ANSWER. A forge that could not be reached is
 * `Unavailable`, which the boundary answers 503 with; a refusal is `NotFound`
 * like every other, so no caller is told to replace a credential the forge
 * never objected to.
 */

import { assertNever } from "../domain/assertNever.ts";
import type {
  RepositoryBinding,
  RepositoryCredentialPort,
  RepositoryId,
} from "./finalizer.ts";
import type {
  ForgeInstallationToken,
  ForgePermissionSet,
  ForgeRepositoryTokens,
} from "./forgeInstallation.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";

/** One host's minting source, which answers for the repositories that host holds. */
export interface MintedCredentialHost {
  readonly repositoryHost: string;
  readonly credentials: RepositoryCredentialPort;
}

/** The host a repository's own address names, and nothing where it names no URL. */
function repositoryCredentialHost(
  repository: RepositoryId,
): string | undefined {
  try {
    return new URL(repository).host;
  } catch {
    return undefined;
  }
}

/**
 * The credential source a deployment composes when some of its hosts mint: the
 * minting source for a host it was given one for, and the files for everything
 * else.
 */
export function repositoryCredentialsByHost(
  minted: readonly MintedCredentialHost[],
  files: RepositoryCredentialPort,
): RepositoryCredentialPort {
  const sources = new Map(
    minted.map((source) => [source.repositoryHost, source.credentials]),
  );
  if (sources.size !== minted.length)
    throw new RangeError("repository credentials: a host names two sources");
  return {
    credential: (repository: RepositoryBinding) => {
      const host = repositoryCredentialHost(repository.repository);
      const source = host === undefined ? undefined : sources.get(host);
      return (source ?? files).credential(repository);
    },
  };
}

/** What one minted credential is: the value, and when the forge stops honouring it. */
export interface ForgeCredentialGrant {
  readonly token: ForgeInstallationToken;
  readonly expiresAtMs: number;
}

/** What minting for a caller came to, an outage kept apart from a refusal. */
export type ForgeCredentialMinted =
  | { readonly result: "NotFound" }
  | { readonly result: "Unavailable" }
  | { readonly result: "Authorized"; readonly value: ForgeCredentialGrant };

/** What one caller asks for: a repository their project binds, and what they need to do to it. */
export interface ForgeCredentialRequest {
  readonly repository: RepositoryId;
  readonly permissions: ForgePermissionSet;
}

/** Mints a repository credential for an authorized caller, and for nobody else. */
export interface ForgeCredentialMinting {
  mint(
    principal: Principal,
    partition: Partition,
    request: ForgeCredentialRequest,
  ): Promise<ForgeCredentialMinted>;
}

/** Exposes minting only through current `Execute` access to a project that binds the repository. */
export function forgeCredentialMinting(
  access: ProjectAccess,
  bindings: ProjectRepositoryBindingRead,
  tokens: ForgeRepositoryTokens,
): ForgeCredentialMinting {
  return {
    mint: async (principal, partition, request) => {
      if (
        (await access.authorize(principal, partition, "Execute")) === undefined
      )
        return { result: "NotFound" };
      const bound = await bindings.binding(partition, request.repository);
      if (bound === undefined) return { result: "NotFound" };
      const minted = await tokens.token(bound.repository, request.permissions);
      switch (minted.minted) {
        case "Token":
          return {
            result: "Authorized",
            value: { token: minted.token, expiresAtMs: minted.expiresAtMs },
          };
        case "Denied":
          return { result: "NotFound" };
        case "Unavailable":
          return { result: "Unavailable" };
        default:
          return assertNever(minted);
      }
    },
  };
}
