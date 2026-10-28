/**
 * Whether the worker App can reach a bound repository: the installation of it
 * this tenant claimed on the repository's owner, and whether that installation
 * selects the repository.
 *
 * IT ASKS WHAT THE PLANE'S MINT WOULD. The claim is looked up by the owner and
 * the tenant, as the mint looks it up, and the selection is the installation's
 * own listing, read under the same unheld token the onboarding routes read it
 * under. A listed repository is the bound one where the forge addresses both
 * by the same owner and name, as the mint addresses it by them, and not by the
 * text either was written in. Nothing is held between questions: a selection
 * changes on the forge while a deployment runs, and a held answer would go on
 * saying a repository is reachable after its owner deselected it.
 *
 * A READ THAT SETTLED NOTHING IS `Unknown`, NEVER `Covered`. An outage, a
 * refusal of the app's own read, a port that raised, and a listing truncated
 * before it named the repository each leave the question open, and a
 * repository whose owner this forge does not address is not asked at all.
 */

import type { RepositoryId } from "./finalizer.ts";
import type {
  ForgeInstallationDirectory,
  ForgeInstallationRepositories,
  ForgeRepositoriesRead,
} from "./forgeDirectory.ts";
import type {
  ForgeAccount,
  ForgeApp,
  ForgeId,
  ForgeInstallationId,
  ForgeInstallationStore,
} from "./forgeInstallation.ts";
import type { TenantId } from "./projectStore.ts";

/** One repository as a forge addresses it: the account owning it and its name there. */
export interface ForgeRepositoryAddress {
  readonly account: ForgeAccount;
  readonly name: string;
}

/**
 * What the worker App reaches of one repository. `Unselected` is an
 * installation on the owner that does not select it, beside the forge's page
 * where an owner changes the selection; `Unclaimed` is no installation of the
 * app this tenant claims on the owner.
 */
export type RepositoryWorkerReach =
  | { readonly reach: "Covered" }
  | {
      readonly reach: "Unselected";
      readonly installationId: ForgeInstallationId;
      readonly settingsUrl: string;
    }
  | { readonly reach: "Unclaimed"; readonly account: ForgeAccount }
  | { readonly reach: "Unknown" };

/** What the reach of one repository is read through: one app on one forge. */
export interface RepositoryWorkerReachPorts {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  /** A repository as this forge addresses it, nothing where the forge addresses no such repository. */
  readonly addressOf: (
    repository: string,
  ) => ForgeRepositoryAddress | undefined;
  readonly installations: ForgeInstallationStore;
  readonly installationRepositories: ForgeInstallationRepositories;
  readonly directory: Pick<
    ForgeInstallationDirectory,
    "installationPermissions"
  >;
}

/** The reads one question shares across the repositories it names, so one installation is listed once. */
type RepositoryWorkerReachReads = Map<
  ForgeInstallationId,
  Promise<ForgeRepositoriesRead>
>;

/** Whether two addresses name one repository, which a forge does without regard to case. */
function sameForgeRepository(
  one: ForgeRepositoryAddress,
  other: ForgeRepositoryAddress,
): boolean {
  return (
    one.account.toLowerCase() === other.account.toLowerCase() &&
    one.name.toLowerCase() === other.name.toLowerCase()
  );
}

/** Where an owner changes what the installation selects, `Unknown` where the forge did not say. */
async function repositoryWorkerReachUnselected(
  ports: RepositoryWorkerReachPorts,
  installationId: ForgeInstallationId,
): Promise<RepositoryWorkerReach> {
  const read = await ports.directory.installationPermissions(installationId);
  return read.read === "Permissions"
    ? { reach: "Unselected", installationId, settingsUrl: read.settingsUrl }
    : { reach: "Unknown" };
}

/** One repository's reach, a port that raised being as open as one that could not answer. */
async function repositoryWorkerReachOf(
  ports: RepositoryWorkerReachPorts,
  tenant: TenantId,
  address: ForgeRepositoryAddress,
  reads: RepositoryWorkerReachReads,
): Promise<RepositoryWorkerReach> {
  const installation = await ports.installations.installation({
    forge: ports.forge,
    app: ports.app,
    account: address.account,
    tenant,
  });
  if (installation === undefined)
    return { reach: "Unclaimed", account: address.account };
  let listing = reads.get(installation.installationId);
  if (listing === undefined) {
    listing = ports.installationRepositories.repositories(installation);
    reads.set(installation.installationId, listing);
  }
  const listed = await listing;
  if (listed.read !== "Repositories") return { reach: "Unknown" };
  if (
    listed.repositories.some((granted) => {
      const listedAddress = ports.addressOf(granted.url);
      return (
        listedAddress !== undefined &&
        sameForgeRepository(listedAddress, address)
      );
    })
  )
    return { reach: "Covered" };
  if (listed.truncated) return { reach: "Unknown" };
  return repositoryWorkerReachUnselected(ports, installation.installationId);
}

/**
 * The reach of each repository named that this forge addresses, read under the
 * tenant asking; a repository it does not address is absent.
 */
export async function repositoryWorkerReaches(
  ports: RepositoryWorkerReachPorts,
  tenant: TenantId,
  repositories: readonly RepositoryId[],
): Promise<ReadonlyMap<RepositoryId, RepositoryWorkerReach>> {
  const reads: RepositoryWorkerReachReads = new Map();
  const reaches = new Map<RepositoryId, RepositoryWorkerReach>();
  for (const repository of repositories) {
    const address = ports.addressOf(repository);
    if (address === undefined) continue;
    reaches.set(
      repository,
      await repositoryWorkerReachOf(ports, tenant, address, reads).catch(
        (): RepositoryWorkerReach => ({ reach: "Unknown" }),
      ),
    );
  }
  return reaches;
}
