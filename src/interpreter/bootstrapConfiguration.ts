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
 * it is told where it is before it is told what to do.
 *
 * IT ASKS ONE CHANGE FOR TWO THINGS: what the ticket asks for, and the
 * repository's own declarations. The request is its author's and this brief is
 * not, so the brief says that a limit the request puts on what may change stops
 * short of the files the brief itself asks for, and says it to the worker and
 * the reviewer alike; unsaid, an ordinary "only this" reads as forbidding the
 * declarations.
 *
 * EVERY ACCEPTANCE CRITERION IS SETTLED BY READING THE CHANGE. That later
 * tickets run on what it declares is an import's doing once the change is on
 * the default branch, which no change can show, so it is said as motivation and
 * held against nothing. No file may be left declaring the bootstrap's own name:
 * a seeded repository holds this document under it, and a repository that kept
 * the name would still be declaring a bootstrap. Nor may the document be left
 * under another name, which an import takes like any other and which briefs
 * every later ticket to write the declarations again.
 *
 * IT TELLS ITS WORKER THE SHAPE OF WHAT IT ASKS FOR. The worker is handed a
 * rendered briefing and never a configuration document, so without the shape
 * the one thing it must write is a guess the import refuses after it lands.
 *
 * ITS STAGES RUN AS THE AGENT IT TELLS ITS WORKER TO DECLARE, so the
 * configuration a bootstrap ticket hands over runs on the worker it ran on.
 *
 * EVERY BRIEFING LINE IS BOUNDED BY WHAT IS PUT INTO IT. A repository identity
 * and a reference name are bounded where each is branded, the image by
 * `bootstrapImageFault` where a deployment names it, and the rest of every
 * line is this file's own, so no input composes a line past the bound release
 * refuses one at — which the generated document is checked against before it is
 * returned, rather than at the authoring door that would already have taken it.
 */

import {
  canonicalConfigurationOf,
  releaseConfigurationReadiness,
  type CanonicalConfiguration,
} from "./authoring.ts";
import { textCodePointsCount } from "../contract/http.ts";
import { bootstrapConfigurationName } from "../contract/responses.ts";
import {
  briefingLineCharsMax,
  commandLinesMax,
} from "../contract/workerTask.ts";
import type { GitRefName, RepositoryId } from "./finalizer.ts";
import { repositoryConfigurationRoot } from "./repositoryConfigurationIdentity.ts";
import {
  briefingLinesMax,
  taskConfigurationLineFault,
  type TicketBrief,
} from "./taskConfiguration.ts";

/** What one bootstrap configuration is generated from. */
export interface BootstrapConfigurationInput {
  readonly repository: RepositoryId;
  readonly defaultBranch: GitRefName;
  readonly image: string;
}

/** The bootstrap's name, surfaced where the configuration it names is generated. */
export { bootstrapConfigurationName };

/** Where a seeded bootstrap configuration is written in the repository it configures. */
export const bootstrapConfigurationPath = `${repositoryConfigurationRoot}${bootstrapConfigurationName}.json`;

/** What the commit that writes that file says it is. */
export const bootstrapConfigurationCommitMessage =
  "Add the bootstrap chuggy configuration";

/** The line naming the image, which is what bounds the image. */
function bootstrapImageLine(image: string): string {
  return `Name ${image} as I: it is the image this ticket runs on, and the checks you command run in it.`;
}

/** The longest image a bootstrap configuration can name. */
export const bootstrapImageCharsMax =
  briefingLineCharsMax - textCodePointsCount(bootstrapImageLine(""));

/** Why a bootstrap configuration cannot name this image, if it cannot. */
export function bootstrapImageFault(
  image: string,
): ReturnType<typeof taskConfigurationLineFault> {
  return taskConfigurationLineFault(bootstrapImageLine(image));
}

/** The agent every briefed stage runs as. */
const bootstrapWorkerMode = {
  type: "SingleAgent",
  agent: "Claude",
  arguments: ["--allowedTools=Bash,Edit,Read,Write,Glob,Grep"],
} as const;

/**
 * The shape of a declaration, in the letters `N`, `C`, `I`, `S`, `E` and `L`
 * stand for, and the bounds its import refuses past.
 */
function bootstrapFormatInstructions(image: string): readonly string[] {
  return [
    `Each file there is one JSON object and nothing more: {"version":1,"name":N,"configuration":C}, N a name no other file there uses, of letters and digits with ".", "_" or "-" only between them; every object here takes exactly the keys shown and no others.`,
    `C is {"version":1,"image":I,"worker":{"mode":${JSON.stringify(bootstrapWorkerMode)},"setup":[L],"files":[]},"brief":{"motivation":S,"acceptanceCriteria":S,"constraints":S},"practices":[],"work":{"instructions":S},"review":{"instructions":S},"evaluations":[E]}, each S a list of at most ${String(briefingLinesMax)} sentences and motivation or acceptanceCriteria not empty.`,
    `Each E is a stage every change is held to: {"purpose":"Check","checks":[L]} runs from 1 to ${String(commandLinesMax)} shell lines L at the repository root and fails the change on a nonzero exit; {"purpose":"Review","practices":[],"instructions":S} briefs a reviewer.`,
    `Each sentence and each line L is one line of 1 to ${String(briefingLineCharsMax)} characters, with no tab or line break in it.`,
    "Command the checks the repository already runs, and put in setup the lines L, if any, that install what they need, such as npm ci or uv sync; setup runs at the repository root before every stage, so commit with this change any lockfile it writes that the repository does not yet track, or every later change will carry that file.",
    bootstrapImageLine(image),
  ];
}

/**
 * What a reviewer is told, held once for the review block the shape requires
 * and for the stage that briefs one. It repeats what the brief says of the
 * request's limit and of what follows a landing, as the two things a review
 * could otherwise fail a sound change for.
 */
const bootstrapReviewInstructions: readonly string[] = [
  "Review the change against what the repository itself asks of one and against the ticket's acceptance criteria.",
  `The change is two things together: what this ticket asks for, and the repository's own configuration in ${repositoryConfigurationRoot}. Hold those files to the criteria above, and do not fail the change for writing them.`,
  "Do not fail it for changing more than the request allowed either, where the more is those files or a lockfile their setup needs or writes.",
  "Whether later tickets run on what the change declares is settled after it lands, by chuggy and outside the change: it is no criterion, and nothing missing from the change on that account is a finding.",
];

/**
 * What the change is for, what it is held to and what binds it. What follows a
 * landing is said as motivation and never as a criterion, and each criterion is
 * one a reader of the change can settle from its files.
 */
function bootstrapBrief(input: BootstrapConfigurationInput): TicketBrief {
  return {
    motivation: [
      `Bring ${input.repository} under chuggy.`,
      `The configuration this ticket runs on is one chuggy supplies to start a repository on, and is not the repository's own. The files this change writes in ${repositoryConfigurationRoot} are the repository's own, and are what its later tickets run on.`,
      "They take effect once the change is on the default branch, when chuggy reads that directory there. That reading is chuggy's and comes after the change, so nothing in the change shows it and no review of the change looks for it.",
    ],
    acceptanceCriteria: [
      "The change does what this ticket asks for.",
      `Every file under ${repositoryConfigurationRoot} whose name ends in .json sits directly in that directory and is one JSON object with exactly the keys "version", "name" and "configuration", whose "version" is the number 1, and the change leaves at least one such file.`,
      `No file the change leaves under ${repositoryConfigurationRoot} has the "name" "${bootstrapConfigurationName}". That name is this configuration's own, and ${bootstrapConfigurationPath}, in a repository that has it, is this configuration: the change deletes that file. Nor does the change leave this configuration there under another name: no file it leaves holds a configuration that, like this one, asks every ticket to write the repository's configuration.`,
    ],
    constraints: [
      `The repository's default branch is ${input.defaultBranch}.`,
      `Where what this ticket asks for limits what may change, as "change nothing else" does, the limit does not reach the files under ${repositoryConfigurationRoot}: they are written whatever the request says, and writing them does not go against it.`,
      "The same holds for a lockfile that the setup declared in those files needs or writes and this change commits.",
    ],
  };
}

/** The authored document, before it is canonically encoded. */
function bootstrapConfigurationValue(
  input: BootstrapConfigurationInput,
): unknown {
  return {
    version: 1,
    image: input.image,
    worker: { mode: bootstrapWorkerMode, setup: [], files: [] },
    brief: bootstrapBrief(input),
    practices: [],
    work: {
      instructions: [
        "Read the repository before changing anything in it.",
        `Do what this ticket asks for and, in the same change, write the repository's own configuration in ${repositoryConfigurationRoot}; a limit the request sets on what may change does not stop you writing there.`,
        ...bootstrapFormatInstructions(input.image),
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
