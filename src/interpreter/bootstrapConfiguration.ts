/**
 * The configuration a repository declaring none starts on.
 *
 * IT IS A CATALOG OF TWO WORKLOADS, the work and the one reviewer its one plan
 * runs, so a repository starts on the version it is told to declare.
 *
 * IT COMMANDS NO CHECK, BECAUSE NOTHING IN THE REPOSITORY YET SAYS WHAT ONE IS.
 * A plan with no commands evaluator is what makes a ticket carrying check lines
 * unreleasable against it — the right refusal while the repository has
 * declared no checks to append them to.
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
 * a repository holding this document under it would still be declaring a
 * bootstrap. Nor may the document be left under another name, which an import
 * takes like any other and which briefs every later ticket to write the
 * declarations again.
 *
 * BOTH ITS WORKLOADS TAKE CHUGGY'S FRAMING AND THE ONE BRIEF, since what the
 * brief says of the request's limit binds the worker and the reviewer alike.
 *
 * IT TELLS ITS WORKER THE SHAPE OF WHAT IT ASKS FOR. The worker is handed a
 * rendered briefing and never a configuration document, so without the shape
 * the one thing it must write is a guess the import refuses after it lands.
 *
 * ITS WORKLOADS RUN AS THE AGENT IT TELLS ITS WORKER TO DECLARE, so the
 * configuration a bootstrap ticket hands over runs on the worker it ran on.
 *
 * IT TELLS ITS WORKER WHAT AN IMAGE NEEDS. The image a deployment names is one
 * the repository may replace by any it builds or chooses, and the worker
 * choosing one has nothing else to learn chuggy's runtime's needs from.
 *
 * EVERY LINE IT WRITES IS BOUNDED BY WHAT IS PUT INTO IT. A repository
 * identity and a reference name are bounded where each is branded, the image
 * and the public origin by `bootstrapImageFault` and `bootstrapPublicOriginFault`
 * where a deployment names each, and the rest of every line is this file's own,
 * so no input composes a line, of its brief or of a prompt, past the bound a
 * brief's line is held to — which the generated document is checked against
 * before it is returned, rather than at the authoring door that would already
 * have taken it.
 */

import {
  canonicalConfigurationOf,
  releaseConfigurationReadiness,
  type CanonicalConfiguration,
} from "./authoring.ts";
import {
  configurationDocumentVersion,
  configurationImageGlibcVersionMin,
  configurationImageSchema,
  workloadConfigurationVersion,
} from "../contract/configurationDocument.ts";
import { nativeHttpRoutes, textCodePointsCount } from "../contract/http.ts";
import { bootstrapConfigurationName } from "../contract/responses.ts";
import { chuggyDocsIndex } from "../contract/sessionTools.ts";
import {
  briefingLineCharsMax,
  commandLinesMax,
} from "../contract/workerTask.ts";
import type { GitRefName, RepositoryId } from "./finalizer.ts";
import { workerRuntimeDirectory } from "../contract/workerEnvironment.ts";
import { repositoryConfigurationRoot } from "./repositoryConfigurationIdentity.ts";
import {
  taskConfigurationLineFault,
  type TicketBrief,
} from "./taskConfiguration.ts";

/** What one bootstrap configuration is generated from. */
export interface BootstrapConfigurationInput {
  readonly repository: RepositoryId;
  readonly defaultBranch: GitRefName;
  readonly image: string;
  /** The origin this deployment's API is publicly reached at, where it names one. */
  readonly publicOrigin?: string;
}

/** The bootstrap's name, surfaced where the configuration it names is generated. */
export { bootstrapConfigurationName };

/** Where the bootstrap configuration sits in a repository that holds it as a file. */
export const bootstrapConfigurationPath = `${repositoryConfigurationRoot}${bootstrapConfigurationName}.json`;

/** The line naming the image, which is what bounds the image. */
function bootstrapImageLine(image: string): string {
  return `Name ${image} as I: it is the image this ticket runs on, and the checks you command run in it.`;
}

/** The longest image a bootstrap configuration can name. */
export const bootstrapImageCharsMax =
  briefingLineCharsMax - textCodePointsCount(bootstrapImageLine(""));

/**
 * Why a bootstrap configuration cannot name this image, if it cannot: its line
 * is past what a briefing holds, or it is no image reference a configuration
 * may name.
 */
export function bootstrapImageFault(
  image: string,
): ReturnType<typeof taskConfigurationLineFault> | "ImageReferenceInvalid" {
  return (
    taskConfigurationLineFault(bootstrapImageLine(image)) ??
    (configurationImageSchema.safeParse(image).success
      ? undefined
      : "ImageReferenceInvalid")
  );
}

/**
 * The line naming where every key chuggy reads is published, which is what
 * bounds the origin. A job is told no origin of its own, so the line names the
 * whole URL where the deployment names its public origin, and only the route
 * where it names none.
 */
function bootstrapSchemaLine(publicOrigin: string | undefined): string {
  const published =
    publicOrigin === undefined
      ? `GET ${nativeHttpRoutes.configurationSchema} on the chuggy API`
      : `${publicOrigin}${nativeHttpRoutes.configurationSchema}`;
  return `The JSON Schema at ${published} names every key chuggy reads, among them a catalog's finalizers and outputs, a workload's authority, framing, brief, practices, image, executionRequirement and resources, the model and effort of a Codex mode, and agent workloads of the Check purpose. A key it does not name is kept and ignored at the top level of C, and refused or dropped inside C as the schema describes.`;
}

/** The longest public origin a bootstrap configuration can name. */
export const bootstrapPublicOriginCharsMax =
  briefingLineCharsMax - textCodePointsCount(bootstrapSchemaLine(""));

/**
 * Whether this is an http or https origin written as a URL serializes one, so
 * that a route appended to it is the route's URL.
 */
function bootstrapPublicOriginWritten(publicOrigin: string): boolean {
  const url = URL.parse(publicOrigin);
  return (
    url !== null &&
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.origin === publicOrigin
  );
}

/**
 * Why a bootstrap configuration cannot name this public origin, if it cannot:
 * it is no origin as a URL writes one, or its line is past what a briefing
 * holds.
 */
export function bootstrapPublicOriginFault(
  publicOrigin: string,
): ReturnType<typeof taskConfigurationLineFault> | "OriginInvalid" {
  return bootstrapPublicOriginWritten(publicOrigin)
    ? taskConfigurationLineFault(bootstrapSchemaLine(publicOrigin))
    : "OriginInvalid";
}

/**
 * The agent every workload runs as, with no arguments: a job runs its
 * agent with permissions bypassed, where a list of allowed tools restricts
 * nothing.
 */
const bootstrapWorkerMode = {
  type: "SingleAgent",
  agent: "Claude",
  arguments: [],
} as const;

/** One agent workload's skeleton, its prompt the file the letter `prompt` stands for. */
function bootstrapAgentSkeleton(purpose: string, prompt: string): string {
  return `{"runner":"Agent",${purpose}"prompt":{"path":${prompt}},"worker":{"mode":${JSON.stringify(bootstrapWorkerMode)},"setup":[L],"files":[]}}`;
}

/**
 * What a worker is asked to do, then one simple catalog, in the letters `N`,
 * `C`, `I`, `W`, `K`, `R`, `P`, `Q` and `L` stand for, the bounds its import
 * refuses past, where every key chuggy reads is published, and what an image
 * needs.
 */
function bootstrapWorkLines(input: BootstrapConfigurationInput): string[] {
  return [
    `Read the repository before changing anything in it. Do what this ticket asks for and, in the same change, write the repository's own configuration in ${repositoryConfigurationRoot}, with the prompt files under .chug/ it names; a limit the request sets on what may change does not stop you writing them.`,
    `Each file in ${repositoryConfigurationRoot} is one JSON object and nothing more: {"version":${String(configurationDocumentVersion)},"name":N,"configuration":C}, N a name no other file there uses, of letters and digits with ".", "_" or "-" only between them; what follows is one simple file.`,
    `C is {"version":${String(workloadConfigurationVersion)},"image":I,"workloads":{"work":W,"checks":K,"review":R},"plans":{"standard":[{"name":"checks","evaluators":["checks"]},{"name":"review","evaluators":["review"]}]},"defaults":{"work":"work","evaluation":"standard"}}: the workloads a ticket may run, the plan its change is held to, and the work and plan a ticket selecting none runs.`,
    `W is ${bootstrapAgentSkeleton("", "P")}, P the path of a file under .chug/ holding the prompt the worker is handed, as written; R is ${bootstrapAgentSkeleton('"purpose":"Review",', "Q")}, Q the path of one telling a reviewer what to hold a change to.`,
    `K is {"runner":"Commands","commands":[L],"worker":{"setup":[L],"files":[]}}, which runs from 1 to ${String(commandLinesMax)} shell lines L at the repository root and fails the change on a nonzero exit. A plan's stages run in the order listed and a failed stage ends evaluation, so the cheap checks stage goes before the review.`,
    `Each line L is one line of 1 to ${String(briefingLineCharsMax)} characters, with no tab or line break in it. Each L runs under sh -eu with CHUG_CHANGE_BASE set to the commit the change started from where that is known, and unset otherwise, so a check of only what changed reads it as \${CHUG_CHANGE_BASE-} and runs everything where that is empty. CHUG_TENANT, CHUG_PROJECT, CHUG_REPOSITORY (its clone URL), CHUG_TICKET, CHUG_ATTEMPT and CHUG_STAGE (Work, or Evaluation:N counted from one) name the job each L runs in, and are always set.`,
    bootstrapSchemaLine(input.publicOrigin),
    bootstrapImageLine(input.image),
    `I may instead be any image the repository builds or chooses, best one it already builds for its CI with what its checks need added. chuggy mounts its runtime read-only at ${workerRuntimeDirectory} and replaces the image's ENTRYPOINT and CMD, so the image needs /bin/sh, git on PATH, glibc ${configurationImageGlibcVersionMin} or later with libstdc++ (a current Debian or Ubuntu, not Alpine or musl), and a $HOME, workspace and temporary directory uid 1000 can write; a ticket on an image lacking one stops with a reason naming it.`,
    "chuggy's node runs under an init the runtime ships, so I needs none, and a process a job orphans is reaped when it exits.",
    "Do not assume I has a docker client: a check or setup that runs docker needs an image whose build installs the client, and it reaches an engine only where the runner's owner has handed jobs one.",
    `chuggy's docs on a job's container, its image, docker in a job, build caches and sizing a stage start at ${chuggyDocsIndex}, which links each page's Markdown; read the ones a choice here turns on.`,
    "Command the checks the repository already runs, and put in each workload's setup the lines L, if any, that install what it needs, such as npm ci or uv sync; setup runs at the repository root before its workload does, so commit with this change any lockfile it writes that the repository does not yet track, or every later change will carry that file. A service the checks need, such as a database, is the image's own, started by a check, or the runner owner's, passed in by environment, and never chuggy's.",
    'A setup line L passes a variable on to the setup lines after it, the agent\'s shells and the commands of its own job by appending NAME=value to the file CHUG_ENV names, as echo "PATH=$HOME/.tool/bin:$PATH" >> "$CHUG_ENV" does; each workload\'s job runs only its own setup, so every workload that needs the variable sets it in its own. A NAME starting CHUG_ or CHUGGY_ is chuggy\'s, and setting one fails the setup.',
  ];
}

/**
 * What a reviewer is told. It repeats what the brief says of the request's
 * limit and of what follows a landing, as the two things a review could
 * otherwise fail a sound change for.
 */
const bootstrapReviewLines: readonly string[] = [
  "Review the change against what the repository itself asks of one and against the ticket's acceptance criteria.",
  `The change is two things together: what this ticket asks for, and the repository's own configuration in ${repositoryConfigurationRoot} with the prompt files under .chug/ it names. Hold those files to the criteria above, and do not fail the change for writing them.`,
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
      `Every file under ${repositoryConfigurationRoot} whose name ends in .json sits directly in that directory and is one JSON object with exactly the keys "version", "name" and "configuration", whose "version" is the number ${String(configurationDocumentVersion)}, and the change leaves at least one such file.`,
      `No file the change leaves under ${repositoryConfigurationRoot} has the "name" "${bootstrapConfigurationName}". That name is this configuration's own, and ${bootstrapConfigurationPath}, in a repository that has it, is this configuration: the change deletes that file. Nor does the change leave this configuration there under another name: no file it leaves holds a configuration that, like this one, asks every ticket to write the repository's configuration.`,
    ],
    constraints: [
      `The repository's default branch is ${input.defaultBranch}.`,
      `Where what this ticket asks for limits what may change, as "change nothing else" does, the limit does not reach the files under ${repositoryConfigurationRoot}, nor the prompt files under .chug/ they name: they are written whatever the request says, and writing them does not go against it.`,
      "The same holds for a lockfile that the setup declared in those files needs or writes and this change commits.",
    ],
  };
}

/** One framed agent workload whose prompt is these lines, a paragraph each. */
function bootstrapWorkload(
  input: BootstrapConfigurationInput,
  lines: readonly string[],
  purpose: { readonly purpose?: "Review" },
): unknown {
  return {
    runner: "Agent",
    ...purpose,
    prompt: { text: lines.join("\n\n") },
    worker: { mode: bootstrapWorkerMode, setup: [], files: [] },
    framing: "Chuggy",
    brief: bootstrapBrief(input),
  };
}

/** The authored document, before it is canonically encoded. */
function bootstrapConfigurationValue(
  input: BootstrapConfigurationInput,
): unknown {
  return {
    version: workloadConfigurationVersion,
    image: input.image,
    workloads: {
      work: bootstrapWorkload(input, bootstrapWorkLines(input), {}),
      review: bootstrapWorkload(input, bootstrapReviewLines, {
        purpose: "Review",
      }),
    },
    plans: { review: [{ name: "review", evaluators: ["review"] }] },
    defaults: { work: "work", evaluation: "review" },
  };
}

/** Why the prompts' lines are not each one a brief could hold, if they are not. */
function bootstrapPromptFault(
  input: BootstrapConfigurationInput,
): ReturnType<typeof taskConfigurationLineFault> {
  return [...bootstrapWorkLines(input), ...bootstrapReviewLines]
    .map(taskConfigurationLineFault)
    .find((fault) => fault !== undefined);
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
  const fault = bootstrapPromptFault(input);
  if (fault !== undefined)
    throw new RangeError(`bootstrap configuration: ${fault}`);
  return canonical;
}

/**
 * The same configuration as the file a repository declares it in, which an
 * import of that repository reads back as a declaration under its name. The
 * bytes inside the envelope are the checked ones, so the file and an authored
 * revision cannot say different things.
 */
export function bootstrapConfigurationFile(
  input: BootstrapConfigurationInput,
): string {
  const configuration: unknown = JSON.parse(bootstrapConfiguration(input));
  return `${JSON.stringify(
    {
      version: configurationDocumentVersion,
      name: bootstrapConfigurationName,
      configuration,
    },
    undefined,
    2,
  )}\n`;
}
