/**
 * What a forge tells the app about itself: the app's own identity, one
 * installation of it, and the repositories an installation grants.
 *
 * IT IS READ AS THE APP AND NEVER AS A TENANT. Every question here is asked
 * under the app's own key, so nothing a caller sends selects whose credential
 * is used; what a caller may see is decided above this, against the claim rows,
 * and a directory that took a tenant would be a second place that decision
 * could be made differently.
 *
 * A REFUSAL AND AN OUTAGE STAY APART, as they do at every other forge edge. A
 * forge that refused this app has settled the question for as long as the
 * composition stands; a forge that could not be reached, would not answer, or
 * answered something this side cannot read has settled nothing and may be asked
 * again. Nothing falls open.
 *
 * AN UNKNOWN INSTALLATION IS NOT A REFUSAL. An installation identity a caller
 * supplies may simply not exist, and one that exists may belong to a different
 * app entirely; both are `Unknown`, because the claim they would be recorded
 * under is one this deployment could never mint through.
 */

import type {
  ForgeAccount,
  ForgeAccountKind,
  ForgeInstallation,
  ForgeInstallationId,
  ForgeRepositoryName,
} from "./forgeInstallation.ts";

/** The app as its forge describes it, and the address a tenant installs it from. */
export interface ForgeAppDescription {
  readonly id: string;
  readonly slug: string;
  readonly installUrl: string;
}

/** What describing the app came to, an outage being the only thing that is not one. */
export type ForgeAppDescribed =
  | { readonly described: "App"; readonly app: ForgeAppDescription }
  | { readonly described: "Unavailable" };

/** The app's own account of itself, which every caller reads and nobody writes. */
export interface ForgeApps {
  app(): Promise<ForgeAppDescribed>;
}

/** The account one installation stands on, which is what a claim records. */
export interface ForgeInstallationAccount {
  readonly account: ForgeAccount;
  readonly accountKind: ForgeAccountKind;
}

/** What reading one installation came to. */
export type ForgeInstallationRead =
  | {
      readonly read: "Installation";
      readonly installation: ForgeInstallationAccount;
    }
  | { readonly read: "Unknown" }
  | { readonly read: "Unavailable" };

/** Reads one installation of this app by the identity the forge gave it. */
export interface ForgeInstallationDirectory {
  installation(
    installationId: ForgeInstallationId,
  ): Promise<ForgeInstallationRead>;
}

/** One repository an installation grants, in the terms a reader chooses between them by. */
export interface ForgeRepositorySummary {
  readonly name: ForgeRepositoryName;
  readonly fullName: string;
  readonly url: string;
  readonly defaultBranch: string;
  readonly private: boolean;
}

/**
 * What enumerating an installation's repositories came to. `truncated` says the
 * installation grants more than this deployment will page for, so a reader that
 * cannot find what it wants knows to narrow rather than to conclude the
 * repository is absent.
 */
export type ForgeRepositoriesRead =
  | {
      readonly read: "Repositories";
      readonly repositories: readonly ForgeRepositorySummary[];
      readonly truncated: boolean;
    }
  | { readonly read: "Denied" }
  | { readonly read: "Unavailable" };

/** Enumerates what one installation grants, under a bound the composition sets. */
export interface ForgeInstallationRepositories {
  repositories(installation: ForgeInstallation): Promise<ForgeRepositoriesRead>;
}
