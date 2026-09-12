/**
 * The configuration a repository declaring none starts on, and the file a
 * repository this tree creates is seeded with.
 *
 * IT COMMANDS NO CHECK, BECAUSE NOTHING IN THE REPOSITORY YET SAYS WHAT ONE IS.
 * An evaluation stage that briefs an agent is a configuration on its own, and
 * one commanding no check lines is what makes a ticket carrying them
 * unreleasable against it — the right refusal while the repository has declared
 * no checks to append them to.
 *
 * IT NAMES THE REPOSITORY AND THE BRANCH IT STANDS AT, so the worker briefed by
 * it is told where it is before it is told what to do, and what it is told to do
 * is to write the repository's own declarations and stop running on this one.
 *
 * EVERY BRIEFING LINE IS BOUNDED BY WHAT IS PUT INTO IT. A repository identity
 * and a reference name are bounded where each is branded and the rest of every
 * line is this file's own, so no input composes a line past the bound release
 * refuses one at — which the generated document is checked against before it is
 * returned, rather than at the authoring door that would already have taken it.
 */

import {
  canonicalConfigurationOf,
  releaseConfigurationReadiness,
  type CanonicalConfiguration,
} from "./authoring.ts";
import type { GitRefName, RepositoryId } from "./finalizer.ts";
import { repositoryConfigurationRoot } from "./repositoryConfigurationIdentity.ts";

/** What one bootstrap configuration is generated from. */
export interface BootstrapConfigurationInput {
  readonly repository: RepositoryId;
  readonly defaultBranch: GitRefName;
  readonly image: string;
}

/**
 * The name a bootstrap configuration is declared under. It is also the revision
 * an authored one is created at: a project authors one bootstrap per revision
 * identity, and a second repository that needs one is authored under a revision
 * its author chooses.
 */
export const bootstrapConfigurationName = "bootstrap";

/** Where a seeded bootstrap configuration is written in the repository it configures. */
export const bootstrapConfigurationPath = `${repositoryConfigurationRoot}${bootstrapConfigurationName}.json`;

/** What the commit that writes that file says it is. */
export const bootstrapConfigurationCommitMessage =
  "Add the bootstrap chuggy configuration";

/** What the worker and the reviewer are each told, which is the same sentence. */
const bootstrapReviewInstructions: readonly string[] = [
  "Review the change against what the repository itself asks of one and against the ticket's acceptance criteria.",
];

/** The authored document, before it is canonically encoded. */
function bootstrapConfigurationValue(
  input: BootstrapConfigurationInput,
): unknown {
  return {
    version: 1,
    image: input.image,
    brief: {
      motivation: [`Bring ${input.repository} under chuggy.`],
      acceptanceCriteria: [
        `${input.repository} declares its own ${repositoryConfigurationRoot} and no longer runs on this configuration.`,
      ],
      constraints: [
        `The repository's default branch is ${input.defaultBranch}.`,
      ],
    },
    practices: [],
    work: {
      instructions: [
        "Read the repository before changing anything in it.",
        `Write ${repositoryConfigurationRoot}, so that what later tickets run under is the repository's own.`,
      ],
    },
    review: { instructions: bootstrapReviewInstructions },
    evaluations: [
      {
        purpose: "Review",
        practices: [],
        instructions: bootstrapReviewInstructions,
      },
    ],
  };
}

/** One bootstrap configuration, canonically encoded and releasable as it stands. */
export function bootstrapConfiguration(
  input: BootstrapConfigurationInput,
): CanonicalConfiguration {
  const canonical = canonicalConfigurationOf(
    bootstrapConfigurationValue(input),
  );
  const readiness = releaseConfigurationReadiness(canonical);
  if (readiness.readiness === "Incomplete")
    throw new RangeError(`bootstrap configuration: ${readiness.fault}`);
  return canonical;
}

/**
 * The same configuration as the file a repository declares it in, which an
 * import of that repository reads back as a declaration under its name. The
 * bytes inside the envelope are the checked ones, so a seeded file and an
 * authored revision cannot say different things.
 */
export function bootstrapConfigurationFile(
  input: BootstrapConfigurationInput,
): string {
  const configuration: unknown = JSON.parse(bootstrapConfiguration(input));
  return `${JSON.stringify(
    { version: 1, name: bootstrapConfigurationName, configuration },
    undefined,
    2,
  )}\n`;
}
