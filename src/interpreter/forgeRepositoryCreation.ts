/**
 * Making a repository on a forge: the three acts this tree asks for when it
 * creates one, each under the installation whose tenant asked.
 *
 * WHICH COLLECTION A REPOSITORY IS MADE IN IS DECIDED HERE AND SPELLED THERE.
 * What kind of account it is made under is a claim row's answer rather than a
 * forge's, so the mode arrives already chosen and an adapter only spells it; an
 * adapter that chose would be a second place the kind of account a tenant holds
 * decides anything.
 *
 * A BRANCH IS A FULLY QUALIFIED REFERENCE EVERYWHERE ABOVE AN ADAPTER, and each
 * forge spells its own short form of one. Nothing here interprets a reference;
 * an adapter that cannot spell the one it was handed refuses rather than
 * guessing which branch was meant.
 *
 * A REFUSAL CARRIES THE FORGE'S OWN MESSAGE AND AN OUTAGE CARRIES NOTHING, as
 * at every other forge edge. A name already taken is neither: it is the one
 * refusal the caller has a different route for, so it is its own answer and
 * never a message to read.
 *
 * RESERVING THE DEFAULT BRANCH IS ITS OWN ACT AND ITS OWN ANSWER. A repository
 * whose default branch is unreserved is usable and only unprotected, so the
 * step that failed is reported beside a repository that stands rather than
 * undoing one that does.
 */

import type { RepositoryId, GitRefName } from "./finalizer.ts";
import type {
  ForgeAccount,
  ForgeInstallation,
  ForgeRepositoryName,
} from "./forgeInstallation.ts";

/** Whether a made repository is the account's alone to read. */
export const allForgeRepositoryVisibilities = ["private", "public"] as const;

export type ForgeRepositoryVisibility =
  (typeof allForgeRepositoryVisibilities)[number];

/** The repository a template mode copies, which is nobody's account but its own. */
export interface ForgeTemplateRepository {
  readonly account: ForgeAccount;
  readonly name: ForgeRepositoryName;
}

/**
 * Which of a forge's collections a repository is made in. An organization makes
 * one of its own; an account that is a person is served by copying a template
 * into it, which is the only shape a forge admits from an app.
 */
export type ForgeRepositoryCreationMode =
  | { readonly mode: "Organization" }
  | { readonly mode: "Template"; readonly template: ForgeTemplateRepository };

/** One repository to make, under the installation that may make it. */
export interface ForgeRepositoryCreationRequest {
  readonly installation: ForgeInstallation;
  readonly name: ForgeRepositoryName;
  readonly visibility: ForgeRepositoryVisibility;
  readonly creation: ForgeRepositoryCreationMode;
}

/** The repository a forge made, addressed the way a binding names one. */
export interface ForgeRepositoryMade {
  readonly url: RepositoryId;
  readonly defaultBranch: GitRefName;
}

/** What making one repository came to. */
export type ForgeRepositoryCreated =
  | {
      readonly created: "Repository";
      readonly repository: ForgeRepositoryMade;
    }
  | { readonly created: "Exists" }
  | { readonly created: "Refused"; readonly message: string }
  | { readonly created: "Unavailable" };

/** One file written as a repository's first commit, which is what puts a branch under it. */
export interface ForgeRepositorySeedRequest {
  readonly installation: ForgeInstallation;
  readonly name: ForgeRepositoryName;
  readonly branch: GitRefName;
  readonly path: string;
  readonly message: string;
  readonly content: string;
}

/** What seeding one repository came to. */
export type ForgeRepositorySeeded =
  | { readonly seeded: "Seeded" }
  | { readonly seeded: "Refused"; readonly message: string }
  | { readonly seeded: "Unavailable" };

/** One repository whose default branch is to be reserved. */
export interface ForgeRepositoryRulesetRequest {
  readonly installation: ForgeInstallation;
  readonly name: ForgeRepositoryName;
}

/** What reserving one repository's default branch came to. */
export type ForgeRepositoryRulesetCreated =
  | { readonly created: "Ruleset" }
  | { readonly created: "Refused"; readonly message: string }
  | { readonly created: "Unavailable" };

/** The three acts making a repository is, against one forge. */
export interface ForgeRepositoryCreation {
  create(
    request: ForgeRepositoryCreationRequest,
  ): Promise<ForgeRepositoryCreated>;

  seed(request: ForgeRepositorySeedRequest): Promise<ForgeRepositorySeeded>;

  reserveDefaultBranch(
    request: ForgeRepositoryRulesetRequest,
  ): Promise<ForgeRepositoryRulesetCreated>;
}
