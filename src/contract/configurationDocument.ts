/**
 * The document a repository declares one configuration in: a file directly in
 * `.chug/configurations/` holding a configuration and the name it is declared
 * under.
 *
 * THE IMPORTER READS A FILE THROUGH THESE SCHEMAS, and what the API publishes
 * is the JSON Schema zod induces from them, so the format an author is shown
 * and the one a file is held to are one statement rather than two that drift.
 *
 * A RULE JSON SCHEMA CANNOT STATE IS STILL HELD, and the description of the
 * part it constrains says so. A rule of one value that zod can check but not
 * emit is a refinement here; a rule across a configuration's parts, its
 * encoding or the directory's files is the importer's. Either way the
 * published schema accepts more than an import does and never less.
 *
 * A LINE, A LIST AND A PRACTICE ARE REFUSED HERE AND NAMED BY THE IMPORTER:
 * the message of the check that refuses one is the fault an import reports,
 * which it reports only once every part of the document has its shape.
 *
 * AN OBJECT DROPS A FIELD IT HAS NO PLACE FOR, except the configuration, which
 * keeps one as written, and the envelope, a stage that runs commands, the
 * execution requirements and the resources, which refuse one.
 *
 * THE OUTPUTS AND THE APPROVAL POLICY ARE READ AFTER IMPORT AND NOT BY IT, so
 * the importer takes any value for either. Each is stated here as its reader
 * takes it, beside anything at all, which is what lets an editor offer the
 * shape while the schema still takes every file an import does.
 */

import { z } from "zod";

import { briefFinalizationSchema } from "./brief.ts";
import {
  configurationCanonicalCharsMax,
  nativeHttpDraftEvaluatorsMax,
  repositoryConfigurationNameCharsMax,
} from "./http.ts";
import { outputRenderers } from "./rosters.ts";
import { artifactPathCharsMax } from "./workerDocuments.ts";
import { workerRuntimeDirectory } from "./workerEnvironment.ts";
import { workerPoolCapabilitySchema } from "./workerPool.ts";
import { workerImageCharsMax } from "./workerPool.ts";
import {
  briefingLineCharsMax,
  commandLinesMax,
  filesystemAccesses,
} from "./workerTask.ts";

/** The one envelope version this tree reads. */
export const configurationDocumentVersion = 1;

/** The configuration version whose stages are blocks of one document. */
export const releaseConfigurationVersion = 1;

/** The configuration version that is a catalog of independent workloads. */
export const workloadConfigurationVersion = 2;

/** The directory an import reads, from the repository root. */
export const repositoryConfigurationRoot = ".chug/configurations/";

/** The most lines one authored list may carry. */
export const briefingLinesMax = 8;

/** The most evaluation stages one configuration lists. */
export const evaluationBlocksMax = 64;

/** The most entries a worker's arguments, its setup or its files hold. */
const workerEntriesMax = 64;

/** The longest content one worker file holds. */
const workerContentCharsMax = 65_536;

/** The longest model a Codex worker names, in UTF-16 code units. */
const workerModelCodeUnitsMax = 128;

/** The longest name an output is shown under, in UTF-16 code units. */
const outputNameCodeUnitsMax = 64;

/** The longest media type an output declares, in UTF-16 code units. */
const outputMediaTypeCodeUnitsMax = 128;

/**
 * The media types an `Image` output may declare. Each is a raster format no
 * browser executes on load, which is what a reader of the stored bytes can
 * trust: `image/svg+xml` is a document a browser parses as markup and may run
 * as script, and does not belong here.
 */
const imageOutputMediaTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** Every accepted practice identity in stable rendering order. */
export const allPracticeIds = [
  "RegressionCoverage",
  "ChangedCallPaths",
  "AcceptanceCriteria",
] as const;
export type PracticeId = (typeof allPracticeIds)[number];

/** Every operating system a platform names, so a suite iterates rather than restates. */
export const allOperatingSystems = ["Linux", "MacOS"] as const;

/** Every architecture a platform names, so a suite iterates rather than restates. */
export const allArchitectures = ["Amd64", "Arm64"] as const;

/** The faults a check in this document names by its message, which an import reports once every shape holds. */
export const configurationContentFaults = [
  "EmptyBrief",
  "UnknownPractice",
  "DuplicatePractice",
  "EmptyLine",
  "TextTooLong",
  "TextUnreadable",
  "TooManyLines",
] as const;
export type ConfigurationContentFault =
  (typeof configurationContentFaults)[number];

/**
 * A line a briefing can print: no control character and no half of a pair.
 * Under a `u` pattern the surrogate range matches a lone surrogate only, as it
 * does in a validator that reads code points.
 */
export const configurationLinePattern =
  // eslint-disable-next-line no-control-regex
  /^[^\u0000-\u001f\u007f-\u009f\ud800-\udfff]*$/u;

/**
 * A text of at least one character and at most `codeUnitsMax` UTF-16 code
 * units, which `holder` holds it to; the bound the schema shows is on code
 * points, which the one on code units implies.
 */
function configurationCodeUnitsText(
  codeUnitsMax: number,
  holder: "importer" | "reader",
) {
  return z
    .string()
    .min(1)
    .max(codeUnitsMax)
    .refine((text) => text.length <= codeUnitsMax)
    .describe(
      `The ${holder} also holds that it is at most ${String(codeUnitsMax)} UTF-16 code units.`,
    );
}

/** One line of an authored list: one criterion, constraint, instruction or command. */
export const configurationLineSchema = z
  .string()
  .min(1, { error: "EmptyLine" })
  .max(briefingLineCharsMax, { error: "TextTooLong" })
  .regex(configurationLinePattern, { error: "TextUnreadable" });

/** One authored list of lines. */
const configurationLinesSchema = z
  .array(configurationLineSchema)
  .max(briefingLinesMax, { error: "TooManyLines" });

/** The lines a stage that runs commands names. */
const configurationCommandLinesSchema = z
  .array(configurationLineSchema)
  .min(1)
  .max(commandLinesMax)
  .describe(
    'Each line runs under /bin/sh -eu at the repository root, with CHUG_CHANGE_BASE set to the full hash of the commit the ticket\'s change started from where the worker knows it, and unset otherwise. Since -u refuses an unset variable, a line that runs only what changed reads it as ${CHUG_CHANGE_BASE-} and runs everything where that is empty, e.g. if [ -n "${CHUG_CHANGE_BASE-}" ]; then git diff --name-only --diff-filter=d "$CHUG_CHANGE_BASE" HEAD; else git ls-files; fi.',
  );

/** A practice a stage is held to, named by its identity. */
const configurationPracticeSchema = z.enum(allPracticeIds, {
  error: (issue) =>
    typeof issue.input === "string" ? "UnknownPractice" : undefined,
});

/** The practices one stage is held to, each at most once. */
export const configurationPracticesSchema = z
  .array(configurationPracticeSchema)
  .max(allPracticeIds.length, { error: "TooManyLines" })
  .superRefine(
    (practices, context) => {
      practices.forEach((practice, index) => {
        if (practices.indexOf(practice) !== index)
          context.addIssue({
            code: "custom",
            message: "DuplicatePractice",
            path: [index],
          });
      });
    },
    { when: (payload) => Array.isArray(payload.value) },
  )
  .describe("The importer also holds that each is named at most once.");

type ConfigurationDocumentDefined<Value> = {
  [
    Key in keyof Value as undefined extends Value[Key] ? never : Key
  ]: Value[Key];
} & {
  [Key in keyof Value as undefined extends Value[Key] ? Key : never]?: Exclude<
    Value[Key],
    undefined
  >;
};

/** Strips unknown keys and omits optional fields whose supplied value is undefined. */
function configurationDocumentObject<Shape extends z.ZodRawShape>(
  shape: Shape,
) {
  return z
    .object(shape)
    .transform(
      (value) =>
        Object.fromEntries(
          Object.entries(value).filter(([, field]) => field !== undefined),
        ) as ConfigurationDocumentDefined<typeof value>,
    );
}

/** What a stage asks to narrow of what its worker may reach. */
export const configurationAuthoritySchema = configurationDocumentObject({
  tools: configurationLinesSchema.optional(),
  credentials: configurationLinesSchema.optional(),
  network: z.boolean().optional(),
  filesystem: z.enum(filesystemAccesses).optional(),
  mayCompleteTask: z.boolean().optional(),
});

const configurationPurposeShape = {
  instructions: configurationLinesSchema,
  authority: configurationAuthoritySchema.optional(),
};

/** What one role is told beyond the shared brief, and what its stage asks to narrow. */
export const configurationPurposeSchema = configurationDocumentObject(
  configurationPurposeShape,
);

/** A work stage that briefs an agent. */
export const configurationBriefedWorkSchema = configurationDocumentObject({
  ...configurationPurposeShape,
  commands: z.never().exactOptional(),
});

/** A work stage the worker runs itself, at the repository root. */
export const configurationCommandedWorkSchema = z.strictObject({
  commands: configurationCommandLinesSchema,
});

/** An evaluation stage that briefs an agent, a reviewer unless it says Check. */
export const configurationAgentEvaluationSchema = configurationDocumentObject({
  ...configurationPurposeShape,
  practices: configurationPracticesSchema,
  purpose: z.enum(["Review", "Check"]).default("Review"),
  checks: z.never().exactOptional(),
});

/** A check stage the worker runs itself, at the repository root, failing on a nonzero exit. */
export const configurationCommandedEvaluationSchema = z.strictObject({
  purpose: z.literal("Check"),
  checks: configurationCommandLinesSchema,
});

/** The evaluation stages, in the order they run. */
export const configurationEvaluationsSchema = z
  .array(
    z.union([
      configurationAgentEvaluationSchema,
      configurationCommandedEvaluationSchema,
    ]),
  )
  .min(1)
  .max(evaluationBlocksMax)
  .describe(
    "The stages a change is held to, run in the order listed; a stage that fails ends evaluation.",
  );

const configurationWorkerArgumentsSchema = z
  .array(z.string())
  .max(workerEntriesMax);

/** The one agent a worker runs a briefed stage as. */
export const configurationWorkerModeSchema = z.discriminatedUnion("agent", [
  z
    .object({
      type: z.literal("SingleAgent"),
      agent: z.literal("Claude"),
      arguments: configurationWorkerArgumentsSchema,
      model: z.never().optional(),
    })
    .transform(({ type, agent, arguments: options }) => ({
      type,
      agent,
      arguments: options,
    })),
  z.object({
    type: z.literal("SingleAgent"),
    agent: z.literal("Codex"),
    arguments: configurationWorkerArgumentsSchema,
    model: configurationCodeUnitsText(workerModelCodeUnitsMax, "importer"),
  }),
]);

const configurationWorkerFields = {
  setup: z.array(z.string()).max(workerEntriesMax),
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string().max(workerContentCharsMax),
      }),
    )
    .max(workerEntriesMax),
};

/** Whether a value is a list of strings, which is what `arguments` beside a mode may not be. */
function configurationWorkerArgumentsListed(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/** The worker a configuration predating modes names: its agent's arguments and no mode. */
export const configurationLegacyWorkerSchema = z.object({
  arguments: configurationWorkerArgumentsSchema,
  ...configurationWorkerFields,
  mode: z.never().exactOptional(),
});

/** The worker a configuration names by its mode. */
export const configurationModeWorkerSchema = z
  .object({
    mode: configurationWorkerModeSchema,
    arguments: z
      .unknown()
      .refine((value) => !configurationWorkerArgumentsListed(value))
      .optional()
      .describe(
        "Ignored beside mode. The importer also holds that it is not a list of strings.",
      ),
    ...configurationWorkerFields,
  })
  .transform(({ mode, setup, files }) => ({ mode, setup, files }));

/** How the worker runs a briefed stage, and what it installs before every stage. */
export const configurationWorkerSchema = z
  .union([configurationLegacyWorkerSchema, configurationModeWorkerSchema])
  .describe(
    "The importer also holds that it is present unless work names commands and evaluations is listed with every stage in it naming checks: without evaluations, the review block briefs an agent.",
  );

/** The claim a ticket makes about itself, which every role is briefed with unchanged. */
export const configurationBriefSchema = z
  .object({
    motivation: configurationLinesSchema,
    acceptanceCriteria: configurationLinesSchema,
    constraints: configurationLinesSchema,
  })
  .refine(
    (brief) =>
      brief.motivation.length > 0 || brief.acceptanceCriteria.length > 0,
    { error: "EmptyBrief" },
  )
  .describe(
    "The importer also holds that motivation and acceptanceCriteria are not both empty.",
  );

/** Every field of the task configuration, in the order an import names the first fault in. */
const configurationTaskShape = {
  brief: configurationBriefSchema,
  practices: configurationPracticesSchema,
  work: z.union([
    configurationBriefedWorkSchema,
    configurationCommandedWorkSchema,
  ]),
  review: configurationPurposeSchema,
  evaluations: configurationEvaluationsSchema.optional(),
  authority: configurationAuthoritySchema.optional(),
  worker: configurationWorkerSchema.optional(),
};

/** The authored part of a configuration, which briefs every task a revision runs. */
export const configurationTaskSchema = configurationDocumentObject(
  configurationTaskShape,
);

/**
 * The oldest glibc an image may hold for chuggy's runtime to load in it, as the
 * runtime's build states its floor in `images/worker/Dockerfile`, which
 * `test/deploy/workerImage.test.ts` holds this to.
 */
export const configurationImageGlibcVersionMin = "2.28";

/** A registry host as a reference names one: domain components joined by dots, with an optional port. */
const configurationImageHost =
  "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::[0-9]+)?";

/** One path component: lowercase letters and digits, separated within by `.`, `_`, `__` or dashes. */
const configurationImageComponent = "[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*";

/**
 * A container image reference as the distribution grammar spells one: an
 * optional registry host, lowercase path components joined by `/`, an optional
 * tag and an optional sha256 digest. The bound is checked first and stops the
 * pattern being tried on a text past it.
 */
export const configurationImageSchema = z
  .string()
  .max(workerImageCharsMax, { abort: true })
  .regex(
    new RegExp(
      `^(?:${configurationImageHost}/)?${configurationImageComponent}(?:/${configurationImageComponent})*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[0-9a-f]{64})?$`,
      "u",
    ),
  )
  .describe(
    `A container image reference: an optional registry host and port, lowercase path components, an optional tag and an optional @sha256: digest. Any image works that holds what chuggy's runtime needs of it, since chuggy mounts the runtime read-only at ${workerRuntimeDirectory} and replaces the image's ENTRYPOINT and CMD: /bin/sh, git on PATH (2.31 or later to read the project's other repositories), glibc ${configurationImageGlibcVersionMin} or later with libstdc++, and a HOME, workspace and temporary directory that uid 1000 can write. A digest is recommended and not required. chuggy holds none of the project's registry logins.`,
  );

const configurationPlatformShape = {
  operatingSystem: z.enum(allOperatingSystems),
  architecture: z.enum(allArchitectures),
};

/** Where one task runs, in the shape and key order every reader compares it in. */
export const executionRequirementSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("Container"),
    ...configurationPlatformShape,
    image: configurationImageSchema,
  }),
  z.strictObject({
    mode: z
      .enum(["Capability", "ContainerCapability"])
      .transform(() => "Capability" as const)
      .describe(
        "ContainerCapability is this mode's former name, read as Capability.",
      ),
    ...configurationPlatformShape,
    capabilities: z
      .array(workerPoolCapabilitySchema)
      .min(1)
      .refine(
        (capabilities) => new Set(capabilities).size === capabilities.length,
      )
      .describe(
        "Tokens the project and its runners agree on, an agent among them as Agent:<name>. The importer also holds that each is named at most once.",
      ),
  }),
]);

/** A key of `taskKindDefaults`: the work, the evaluations of a configuration listing none, or one listed stage by its position from one. */
export const executionTaskKindKeyPattern =
  /^(?:Work|Evaluation|Evaluation:[1-9][0-9]*)$/u;

/** The requirements a configuration's tasks run under, each default refining the platform's. */
export const executionRequirementsSchema = z
  .strictObject({
    platformDefault: executionRequirementSchema,
    platformDefaultVersion: z.number().int().min(1),
    ticketDefault: executionRequirementSchema.optional(),
    taskKindDefaults: z
      .record(
        z.string().regex(executionTaskKindKeyPattern),
        executionRequirementSchema,
      )
      .describe(
        "The requirement a task runs under in place of ticketDefault, or of platformDefault without one, by the kind of task. Work is the work task's. Where evaluations is absent, Evaluation is every evaluation stage's and an Evaluation:N key is unused; where evaluations is listed, Evaluation:N is the Nth stage's, counting from one, and Evaluation is unused.",
      )
      .optional(),
  })
  .describe(
    'The importer also holds two rules here. platformDefault is {"mode":"Container","operatingSystem":"Linux","architecture":"Amd64","image":image} with the configuration\'s own image, or, where worker.mode names an agent, a Capability requirement on Linux and Amd64. ticketDefault and every taskKindDefaults entry refine platformDefault: the same mode, operating system and architecture, and every capability platformDefault names.',
  );

/** The most CPUs one task asks for. */
export const configurationCpusMax = 64;

/** The least memory one task asks for, in MiB. */
export const configurationMemoryMibMin = 512;

/** The most memory one task asks for, in MiB. */
export const configurationMemoryMibMax = 262_144;

/** The CPUs and memory one task runs with, each field the deployment's own where it is absent. */
export const configurationResourceSizeSchema = z.strictObject({
  cpus: z
    .number()
    .int()
    .min(1)
    .max(configurationCpusMax)
    .optional()
    .describe("Whole CPUs."),
  memoryMib: z
    .number()
    .int()
    .min(configurationMemoryMibMin)
    .max(configurationMemoryMibMax)
    .optional()
    .describe("Memory in MiB."),
});

/** The size a configuration's tasks run with: one for every task, and one per kind of task in place of it. */
export const configurationResourcesSchema = z
  .strictObject({
    ticketDefault: configurationResourceSizeSchema.optional(),
    taskKindDefaults: z
      .record(
        z.string().regex(executionTaskKindKeyPattern),
        configurationResourceSizeSchema,
      )
      .describe(
        "The size a task runs with in place of ticketDefault, by the kind of task, keyed as executionRequirements.taskKindDefaults is.",
      )
      .optional(),
  })
  .describe(
    "The CPUs and memory each job of a ticket runs with, as its request and its limit. A field a task kind's size leaves out is ticketDefault's, and one neither names is the deployment's own. A ticket keeps the size it was released with. A runner whose whole machine is smaller than a job's size refuses the job, which blocks it and escalates its ticket, and the runner's reason is shown on the job. Sessions are not sized here.",
  );

/** What a release reads before any task field: the version, the image, where tasks run and what they run with. */
export const releaseConfigurationHeaderSchema = z.object({
  version: z.literal(releaseConfigurationVersion),
  image: configurationImageSchema,
  executionRequirements: executionRequirementsSchema.optional(),
  resources: configurationResourcesSchema.optional(),
});

const configurationOutputFields = {
  name: configurationCodeUnitsText(outputNameCodeUnitsMax, "reader"),
  path: z
    .string()
    .min(1)
    .max(artifactPathCharsMax)
    .describe(
      "Where a result holds the artifact. The reader also holds it to the rules of an artifact path: well formed, with no lone surrogate; relative; no segment empty, . or .., and none with whitespace at either edge; no backslash or control character; in NFC; and bounded in depth and in each segment's length.",
    ),
  schema: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Served beside the artifact's content, such as a JSON Schema of a Json output.",
    ),
};

/** One result artifact a configuration declares, and how it is shown. */
export const configurationOutputSchema = z.discriminatedUnion("renderer", [
  z.object({
    ...configurationOutputFields,
    renderer: z.literal("Image"),
    mediaType: z.enum(imageOutputMediaTypes),
  }),
  z.object({
    ...configurationOutputFields,
    renderer: z.enum(outputRenderers).exclude(["Image"]),
    mediaType: configurationCodeUnitsText(
      outputMediaTypeCodeUnitsMax,
      "reader",
    ),
  }),
]);

/** The result artifacts a configuration declares, as its reader takes them beside any value the importer takes. */
const configurationOutputsSchema = z
  .union([z.array(configurationOutputSchema), z.unknown()])
  .describe(
    "Result artifacts shown as outputs: an artifact a result holds at an output's path is shown under its name, as its media type, by its renderer. The built-in outputs come first, and one declared at a built-in output's path is not used. The importer takes any value here; its reader takes a list and skips an entry it cannot read, so only an entry of the shape shown is an output.",
  );

/** Whether a person approves a candidate before it lands, as its reader takes it beside any value the importer takes. */
const configurationApprovalRequiredSchema = z
  .union([z.boolean(), z.unknown()])
  .describe(
    "Whether a person approves each candidate before it lands; absent is false. The importer takes any value here, but one that is not a boolean is an approval policy finalization cannot read, so no candidate made under it lands.",
  );

/** The configuration a release reads, which keeps a field it does not name as written. */
export const releaseConfigurationSchema = z
  .looseObject({
    ...releaseConfigurationHeaderSchema.shape,
    ...configurationTaskShape,
    outputs: configurationOutputsSchema.optional(),
    finalizationApprovalRequired:
      configurationApprovalRequiredSchema.optional(),
  })
  .describe(
    `What a ticket runs on. A key not named here is kept as written and ignored. The importer also holds that no key at any depth contains password, secret or token, or credential other than as the credentials that ends it, in any letter case, and that the configuration as JSON with its keys sorted and no whitespace is at most ${String(configurationCanonicalCharsMax)} UTF-16 code units.`,
  );

/** The longest path a catalog names another repository file by, in code points. */
export const configurationReferencePathCharsMax = 256;

/** The most entries one catalog map holds. */
export const configurationCatalogEntriesMax = 64;

/** The longest name a catalog entry or a plan stage is held under. */
const configurationCatalogNameCharsMax = 64;

/**
 * A repository file a catalog names: relative to the repository root, under
 * `.chug/`, with no empty, `.` or `..` segment and no backslash or control
 * character.
 */
export const configurationReferencePathPattern =
  // eslint-disable-next-line no-control-regex
  /^\.chug(?:\/(?!\.\.?(?:\/|$))[^/\\\u0000-\u001f\u007f-\u009f]+)+$/u;

/** A path naming one repository file, read at the commit a configuration is imported from. */
export const configurationReferencePathSchema = z
  .string()
  .max(configurationReferencePathCharsMax)
  .regex(configurationReferencePathPattern)
  .describe(
    "A file in the repository, relative to its root and under .chug/, read at the commit the configuration is imported from. The importer also holds that it is a regular file and not a symbolic link.",
  );

/** Text a prompt may hold: lines broken by newlines, tabs, and no other control character or lone surrogate. */
export const configurationPromptTextPattern =
  // eslint-disable-next-line no-control-regex
  /^[^\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff]*$/u;

/** The words an agent workload is briefed with, as written. */
const configurationPromptTextSchema = z
  .string()
  .min(1)
  .max(configurationCanonicalCharsMax)
  .regex(configurationPromptTextPattern);

/** A prompt by its text, by the file holding it, or both once an import has read that file. */
export const configurationPromptSchema = z
  .strictObject({
    path: configurationReferencePathSchema.optional(),
    text: configurationPromptTextSchema.optional(),
  })
  .refine((prompt) => prompt.path !== undefined || prompt.text !== undefined)
  .describe(
    "The prompt rendered first and verbatim in the workload's briefing. A repository file names its path, and the import stores the text it read beside that path; a configuration authored through the API names its text.",
  );

/** A name one catalog entry is held under and referred to by. */
export const configurationCatalogNameSchema = z
  .string()
  .max(configurationCatalogNameCharsMax)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u);

/** What a workload installs before it runs. */
const configurationPreparationSchema = z.strictObject(
  configurationWorkerFields,
);

/** Where one workload runs and what it runs with, each in place of the catalog's default. */
const workloadPlacementShape = {
  image: configurationImageSchema.optional(),
  executionRequirement: executionRequirementSchema.optional(),
  resources: configurationResourceSizeSchema.optional(),
};

/** A workload an agent carries out: its own prompt, worker and authority, with every framing opt-in. */
export const agentWorkloadSchema = z.strictObject({
  runner: z.literal("Agent"),
  purpose: z
    .enum(["Review", "Check"])
    .optional()
    .describe(
      "What the workload is as an evaluator; absent is Review. A workload run as the work is the work whatever it says here.",
    ),
  prompt: configurationPromptSchema,
  worker: configurationModeWorkerSchema,
  authority: configurationAuthoritySchema.optional(),
  framing: z
    .enum(["Chuggy"])
    .optional()
    .describe(
      "Chuggy adds the standing role and result wording of chuggy's own briefing template around the prompt; absent adds none.",
    ),
  practices: configurationPracticesSchema.optional(),
  brief: configurationBriefSchema.optional(),
  ...workloadPlacementShape,
});

/** A workload the worker runs itself: command lines at the repository root, and no agent to brief. */
export const commandsWorkloadSchema = z.strictObject({
  runner: z.literal("Commands"),
  commands: configurationCommandLinesSchema,
  worker: configurationPreparationSchema.optional(),
  authority: configurationAuthoritySchema.optional(),
  ...workloadPlacementShape,
});

/** One workload, which is one of the two runners. */
export const workloadSchema = z.discriminatedUnion("runner", [
  agentWorkloadSchema,
  commandsWorkloadSchema,
]);

/** Whether a map holds no more entries than a catalog map may. */
function configurationCatalogBounded(map: Readonly<Record<string, unknown>>) {
  return Object.keys(map).length <= configurationCatalogEntriesMax;
}

/** A catalog map: entries by name, bounded. */
function configurationCatalogMap<Entry extends z.ZodType>(entry: Entry) {
  return z
    .record(configurationCatalogNameSchema, entry)
    .refine(configurationCatalogBounded)
    .describe(
      `The importer also holds that it has at most ${String(configurationCatalogEntriesMax)} entries.`,
    );
}

/** One stage of an evaluation plan: the workloads its evaluators run, by name. */
export const evaluationPlanStageSchema = z.strictObject({
  name: configurationCatalogNameSchema,
  evaluators: z
    .array(configurationCatalogNameSchema)
    .min(1)
    .max(nativeHttpDraftEvaluatorsMax),
});

/** The stages a change is held to, run in the order listed; a stage that fails ends evaluation. */
export const evaluationPlanSchema = z
  .array(evaluationPlanStageSchema)
  .min(1)
  .max(evaluationBlocksMax);

/** How a ticket's passed work lands, and whether a person approves it first. */
export const finalizerSchema = z.strictObject({
  landing: briefFinalizationSchema
    .optional()
    .describe(
      "The landing a ticket whose brief names none takes, in place of its repository's.",
    ),
  approvalRequired: z.boolean().optional(),
});

/** The catalog entries a ticket runs on where it selects none. */
export const workloadDefaultsSchema = z.strictObject({
  work: configurationCatalogNameSchema,
  evaluation: configurationCatalogNameSchema,
  finalization: configurationCatalogNameSchema.optional(),
});

/** The configuration that is a catalog: workloads, the plans that run them, finalizers, and the defaults. */
export const workloadConfigurationSchema = z
  .looseObject({
    version: z.literal(workloadConfigurationVersion),
    image: configurationImageSchema.describe(
      "The image a workload naming none runs in.",
    ),
    workloads: configurationCatalogMap(
      z.union([configurationReferencePathSchema, workloadSchema]),
    ).describe(
      "Each workload inline, or the path of a JSON file holding one, which the import reads and stores inline.",
    ),
    plans: configurationCatalogMap(evaluationPlanSchema),
    finalizers: configurationCatalogMap(finalizerSchema).optional(),
    defaults: workloadDefaultsSchema,
    outputs: configurationOutputsSchema.optional(),
  })
  .describe(
    `A catalog a ticket selects its work, its evaluation plan and its finalizer from. The importer also holds that every name a plan or the defaults use is in the catalog, and the size and key rules of a version 1 configuration: at most ${String(configurationCanonicalCharsMax)} UTF-16 code units once every referenced file is stored inline.`,
  );

/** The configuration one file declares, told apart by its version. */
export const declaredConfigurationSchema = z.discriminatedUnion("version", [
  releaseConfigurationSchema,
  workloadConfigurationSchema,
]);

/** The name a configuration is declared under, which is one URL path segment exactly as written. */
export const repositoryConfigurationNameSchema = z
  .string()
  .max(repositoryConfigurationNameCharsMax)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u)
  .describe(
    `The importer also holds that no other file in ${repositoryConfigurationRoot} declares it.`,
  );

/** One file in the directory an import reads, which refuses a field it has no place for. */
export const configurationDocumentSchema = z
  .strictObject({
    version: z.literal(configurationDocumentVersion),
    name: repositoryConfigurationNameSchema,
    configuration: declaredConfigurationSchema,
  })
  .meta({
    title: "chuggy repository configuration",
    description: `One file directly in ${repositoryConfigurationRoot} whose name ends in .json. An object here that does not refuse a key it does not name drops it, except the configuration, which keeps it as written and ignores it. The importer also holds the directory to a bound on how many files it holds and each file to one on its size.`,
  });

/** The media type the JSON Schema of one file is served as. */
export const configurationDocumentSchemaMediaType = "application/schema+json";

/** The JSON Schema of one file, as `GET /api/v1/configuration-schema` answers with it. */
export function configurationDocumentJsonSchema(): z.core.JSONSchema.BaseSchema {
  return z.toJSONSchema(configurationDocumentSchema, { io: "input" });
}
