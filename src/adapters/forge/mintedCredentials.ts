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
 * that raised, because a read that failed established nothing. A denial past
 * the address names the installation it went through, or that this tenant
 * claims none on the owner, so a caller can say which one to change.
 *
 * A TOKEN IS SCOPED TO ONE REPOSITORY AND TO ONE PERMISSION SET, and the set is
 * the composition's rather than the caller's: a source composed for reading a
 * snapshot cannot be asked for something that pushes.
 *
 * THE BINDING ALLOWS THE PIPELINE DEFINITIONS. A set naming `pipelines` asks
 * the forge for them only where the project the act runs for binds the
 * repository live and allows them, which is read here for every such set
 * rather than trusted to each caller; a binding that is absent or retired
 * allows none, and a read that raised is an outage.
 */

import {
  asRepositoryCredential,
  type CredentialResolved,
  type RepositoryCredentialPort,
  type RepositoryId,
} from "../../interpreter/finalizer.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  asForgeAccount,
  asForgeRepositoryName,
  forgePermissionSets,
  type ForgeApp,
  type ForgeId,
  type ForgeInstallationStore,
  type ForgeInstallationTokens,
  type ForgePermissionSet,
  type ForgeRepositoryTokens,
  type ForgeTokenMinted,
} from "../../interpreter/forgeInstallation.ts";
import type { ProjectRepositoryLandingStore } from "../../interpreter/repositoryBinding.ts";
import type { CredentialMintCause } from "../../interpreter/repositoryReadEvidence.ts";
import { githubAddressOf } from "./githubAddress.ts";

/** Which step of a mint raised, keyed by what it raised with, so a raise reaches every caller unchanged. */
const mintedRaisedBy = new WeakMap<object, CredentialMintCause>();

/** Raises what a step raised with again, marked with the step where it can be. */
function mintedRaisedMarked(
  cause: CredentialMintCause,
): (raised: unknown) => never {
  return (raised) => {
    if (typeof raised === "object" && raised !== null)
      mintedRaisedBy.set(raised, cause);
    throw raised;
  };
}

/** Everything the per-repository source is composed with, all of it one forge's. */
export interface MintedRepositoryTokensOptions {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  readonly repositoryHost: string;
  readonly installations: ForgeInstallationStore;
  readonly tokens: ForgeInstallationTokens;
  /** The project's own binding of the repository, read where the set names `pipelines`. */
  readonly bindings: Pick<ProjectRepositoryLandingStore, "landing">;
}

/**
 * Whether the project the act runs for allows this mint the pipeline
 * definitions: only for a set that names them, and only where it binds the
 * repository live with them allowed.
 */
async function mintedRepositoryTokensPipelinesAllowed(
  options: MintedRepositoryTokensOptions,
  repository: RepositoryId,
  partition: Partition,
  permissions: ForgePermissionSet,
): Promise<boolean> {
  if (forgePermissionSets[permissions].pipelines === undefined) return false;
  const bound = await options.bindings
    .landing(partition, repository)
    .catch(mintedRaisedMarked("StoreRaised"));
  return (
    bound !== undefined &&
    bound.retiredAt === undefined &&
    bound.pipelinesWritable
  );
}

/**
 * The token for one repository: its owner selects the installation, the mint
 * is scoped to that repository alone, and its binding is what allows a set the
 * pipeline definitions it names.
 */
export function mintedRepositoryTokens(
  options: MintedRepositoryTokensOptions,
): ForgeRepositoryTokens {
  return {
    token: async (repository, partition, permissions) => {
      const address = githubAddressOf(repository, options.repositoryHost);
      if (address === undefined)
        return { minted: "Denied", evidence: { mint: "Address" } };
      const installation = await options.installations
        .installation({
          forge: options.forge,
          app: options.app,
          account: asForgeAccount(address.owner),
          tenant: partition.tenant,
        })
        .catch(mintedRaisedMarked("StoreRaised"));
      if (installation === undefined)
        return {
          minted: "Denied",
          evidence: { mint: "NoInstallation" },
          installation: { app: options.app },
        };
      const pipelinesAllowed = await mintedRepositoryTokensPipelinesAllowed(
        options,
        repository,
        partition,
        permissions,
      );
      const minted = await options.tokens
        .mint({
          installation,
          repositories: [asForgeRepositoryName(address.name)],
          permissions,
          ...(pipelinesAllowed ? { pipelinesAllowed: true } : {}),
        })
        .catch(mintedRaisedMarked("MintRaised"));
      return minted.minted === "Denied"
        ? {
            ...minted,
            installation: {
              app: options.app,
              installationId: installation.installationId,
            },
          }
        : minted;
    },
  };
}

/** What a mint came to, in the shape the credential port answers with. */
function mintedCredentialResolved(
  minted: ForgeTokenMinted,
): CredentialResolved {
  if (minted.minted !== "Token")
    return {
      resolved: minted.minted,
      ...(minted.evidence === undefined ? {} : { evidence: minted.evidence }),
    };
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
          repository.partition,
        ),
      ),
  };
}

/** One mint, a store or a forge that raised being an outage rather than an answer. */
function mintedCredentialToken(
  options: MintedCredentialsOptions,
  repository: RepositoryId,
  partition: Partition,
): Promise<ForgeTokenMinted> {
  return options.tokens
    .token(repository, partition, options.permissions)
    .catch((raised: unknown): ForgeTokenMinted => {
      const cause =
        typeof raised === "object" && raised !== null
          ? mintedRaisedBy.get(raised)
          : undefined;
      return cause === undefined
        ? { minted: "Unavailable" }
        : { minted: "Unavailable", evidence: { mint: cause } };
    });
}
