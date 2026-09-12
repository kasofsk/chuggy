/**
 * Repository credentials minted per act, from the installation the repository's
 * own owner is claimed under.
 *
 * THE ADDRESS SELECTS AND THE ASKING TENANT PERMITS. A repository identity is
 * its remote's URL, so the owner in it names the account — which is why nothing
 * above this holds an installation identity, and why a repository on another
 * host is denied here rather than minted for by guess. The tenant the act runs
 * under is carried to the lookup beside that account, so a claim another tenant
 * made is a missing claim and a binding that crossed tenants mints nothing.
 *
 * A DENIAL IS THE COMPOSITION'S AND AN OUTAGE IS THE FORGE'S. A repository this
 * deployment's forge does not hold, or whose owner this tenant has not claimed,
 * is `Denied`, because that answer is settled for as long as the claim is
 * absent; a forge that could not be reached is `Unavailable`, and so is a store
 * that raised, because a read that failed established nothing.
 *
 * A TOKEN IS SCOPED TO ONE REPOSITORY AND TO ONE PERMISSION SET, and the set is
 * the composition's rather than the caller's: a source composed for reading a
 * snapshot cannot be asked for something that pushes.
 */

import {
  asRepositoryCredential,
  type CredentialResolved,
  type RepositoryCredentialPort,
  type RepositoryId,
} from "../../interpreter/finalizer.ts";
import type { TenantId } from "../../interpreter/projectStore.ts";
import {
  asForgeAccount,
  asForgeRepositoryName,
  type ForgeApp,
  type ForgeId,
  type ForgeInstallationStore,
  type ForgeInstallationTokens,
  type ForgePermissionSet,
  type ForgeRepositoryTokens,
  type ForgeTokenMinted,
} from "../../interpreter/forgeInstallation.ts";
import { githubAddressOf } from "./githubAddress.ts";

/** Everything the per-repository source is composed with, all of it one forge's. */
export interface MintedRepositoryTokensOptions {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  readonly repositoryHost: string;
  readonly installations: ForgeInstallationStore;
  readonly tokens: ForgeInstallationTokens;
}

/**
 * The token for one repository: its owner selects the installation, and the
 * mint is scoped to that repository alone.
 */
export function mintedRepositoryTokens(
  options: MintedRepositoryTokensOptions,
): ForgeRepositoryTokens {
  return {
    token: async (repository, tenant, permissions) => {
      const address = githubAddressOf(repository, options.repositoryHost);
      if (address === undefined) return { minted: "Denied" };
      const installation = await options.installations.installation({
        forge: options.forge,
        app: options.app,
        account: asForgeAccount(address.owner),
        tenant,
      });
      if (installation === undefined) return { minted: "Denied" };
      return options.tokens.mint({
        installation,
        repositories: [asForgeRepositoryName(address.name)],
        permissions,
      });
    },
  };
}

/** What a mint came to, in the shape the credential port answers with. */
function mintedCredentialResolved(
  minted: ForgeTokenMinted,
): CredentialResolved {
  if (minted.minted === "Denied") return { resolved: "Denied" };
  if (minted.minted === "Unavailable") return { resolved: "Unavailable" };
  return {
    resolved: "Credential",
    credential: asRepositoryCredential(minted.token),
  };
}

/** One minted source's own composition: what it mints for, and how much it may ask for. */
export interface MintedCredentialsOptions {
  readonly tokens: ForgeRepositoryTokens;
  readonly permissions: ForgePermissionSet;
}

/** A repository credential minted for the act that needs it, and held nowhere above the forge adapter. */
export function mintedRepositoryCredentials(
  options: MintedCredentialsOptions,
): RepositoryCredentialPort {
  return {
    credential: async (repository): Promise<CredentialResolved> =>
      mintedCredentialResolved(
        await mintedCredentialToken(
          options,
          repository.repository,
          repository.partition.tenant,
        ),
      ),
  };
}

/** One mint, a store or a forge that raised being an outage rather than an answer. */
function mintedCredentialToken(
  options: MintedCredentialsOptions,
  repository: RepositoryId,
  tenant: TenantId,
): Promise<ForgeTokenMinted> {
  return options.tokens
    .token(repository, tenant, options.permissions)
    .catch((): ForgeTokenMinted => ({ minted: "Unavailable" }));
}
