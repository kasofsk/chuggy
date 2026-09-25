/**
 * A configuration's canonical JSON, read into what the Configuration panel
 * draws: the settings a run is given, the brief and instructions each role is
 * briefed with, and the evaluation stages that judge it.
 *
 * The canonical document is authored bytes whose real schema belongs to
 * `src/interpreter/`, which this console may not import. So every field here
 * is read on its own — `.catch(undefined)` at each leaf — and a field this
 * reader does not recognise, or a document that is not even JSON, degrades to
 * an absent field rather than a failed panel.
 */

import { z } from "zod";

import { imageShortened } from "./labels.ts";

const modelArgumentPrefix = "--model=";
const toolsArgumentPrefix = "--allowedTools=";

const optionalStrings = () => z.array(z.string()).optional().catch(undefined);
const optionalString = () => z.string().optional().catch(undefined);
const optionalBoolean = () => z.boolean().optional().catch(undefined);

const authoritySchema = z
  .looseObject({
    tools: optionalStrings(),
    credentials: optionalStrings(),
    network: optionalBoolean(),
    filesystem: optionalString(),
    mayCompleteTask: optionalBoolean(),
  })
  .optional()
  .catch(undefined);

const workerModeSchema = z
  .looseObject({
    type: optionalString(),
    agent: optionalString(),
    arguments: optionalStrings(),
    model: optionalString(),
  })
  .optional()
  .catch(undefined);

const workerSchema = z
  .looseObject({
    mode: workerModeSchema,
    setup: optionalStrings(),
  })
  .optional()
  .catch(undefined);

const briefSchema = z
  .looseObject({
    motivation: optionalStrings(),
    acceptanceCriteria: optionalStrings(),
    constraints: optionalStrings(),
  })
  .optional()
  .catch(undefined);

const purposeSchema = z
  .looseObject({
    instructions: optionalStrings(),
    commands: optionalStrings(),
    practices: optionalStrings(),
  })
  .optional()
  .catch(undefined);

const evaluationSchema = z.looseObject({
  purpose: optionalString(),
  checks: optionalStrings(),
  instructions: optionalStrings(),
  practices: optionalStrings(),
});

const configurationDocumentSchema = z.looseObject({
  image: optionalString(),
  authority: authoritySchema,
  worker: workerSchema,
  brief: briefSchema,
  practices: optionalStrings(),
  work: purposeSchema,
  review: purposeSchema,
  evaluations: z.array(evaluationSchema).optional().catch(undefined),
});

type ConfigurationDocument = z.infer<typeof configurationDocumentSchema>;

/** The bytes as the loose document they hold, or an empty one where they are
 * not even JSON, an object, or where nothing here recognises them. */
function configurationDocumentOf(canonical: string): ConfigurationDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    parsed = undefined;
  }
  return configurationDocumentSchema.safeParse(parsed).data ?? {};
}

/** The model a run is given, read from its own flag rather than assumed. */
export interface ConfigurationModel {
  readonly label: string;
  readonly argument: string | undefined;
}

const modelDefaultLabel = "Default";

function capitalized(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** A Codex mode names its model as a field the worker passes itself; a Claude
 * mode names it, if at all, as a flag among its arguments. */
function configurationModelOf(
  mode: z.infer<typeof workerModeSchema> | undefined,
): ConfigurationModel {
  if (mode?.model !== undefined && mode.model.length > 0)
    return { label: mode.model, argument: undefined };
  const argument = mode?.arguments?.find((arg) =>
    arg.startsWith(modelArgumentPrefix),
  );
  if (argument === undefined)
    return { label: modelDefaultLabel, argument: undefined };
  return {
    label: capitalized(argument.slice(modelArgumentPrefix.length)),
    argument,
  };
}

/** `Claude` briefs an agent this console calls by its product name; every
 * other agent identity is drawn as the document names it. */
function configurationAgentLabel(
  agent: string | undefined,
): string | undefined {
  return agent === "Claude" ? "Claude Code" : agent;
}

function configurationAgentDetail(
  type: string | undefined,
): string | undefined {
  return type === "SingleAgent" ? "Single agent" : type;
}

function configurationFilesystemLabel(
  filesystem: string | undefined,
): string | undefined {
  switch (filesystem) {
    case "None":
      return "No filesystem access";
    case "ReadWorkspace":
      return "Workspace readable";
    case "WriteWorkspace":
      return "Workspace writable";
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

function configurationAccessLine(
  network: boolean | undefined,
  filesystem: string | undefined,
): string | undefined {
  const parts = [
    network === undefined ? undefined : network ? "Network" : "No network",
    configurationFilesystemLabel(filesystem),
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** The tools a run may reach: the flag a `SingleAgent` Claude run is launched
 * with where one is named, and the authority's own list otherwise. */
function configurationToolsOf(
  args: readonly string[] | undefined,
  authorityTools: readonly string[] | undefined,
): readonly string[] | undefined {
  const argument = args?.find((arg) => arg.startsWith(toolsArgumentPrefix));
  if (argument === undefined) return authorityTools;
  const named = argument
    .slice(toolsArgumentPrefix.length)
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  return named.length === 0 ? authorityTools : named;
}

/** The worker image, shortened for a cell and kept whole for the hover. */
export interface ConfigurationWorker {
  readonly short: string;
  readonly full: string;
}

function configurationWorkerOf(
  image: string | undefined,
): ConfigurationWorker | undefined {
  return image === undefined
    ? undefined
    : { short: imageShortened(image), full: image };
}

/** What one run under this configuration is given, before it is briefed with anything. */
export interface ConfigurationSettings {
  readonly model: ConfigurationModel;
  readonly agent: string | undefined;
  readonly agentDetail: string | undefined;
  readonly worker: ConfigurationWorker | undefined;
  readonly tools: readonly string[] | undefined;
  readonly credentials: readonly string[] | undefined;
  readonly access: string | undefined;
  readonly setup: readonly string[] | undefined;
  readonly completesTask: boolean | undefined;
}

function configurationSettingsOf(
  document: ConfigurationDocument,
): ConfigurationSettings {
  const mode = document.worker?.mode;
  const authority = document.authority;
  return {
    model: configurationModelOf(mode),
    agent: configurationAgentLabel(mode?.agent),
    agentDetail: configurationAgentDetail(mode?.type),
    worker: configurationWorkerOf(document.image),
    tools: configurationToolsOf(mode?.arguments, authority?.tools),
    credentials: authority?.credentials,
    access: configurationAccessLine(authority?.network, authority?.filesystem),
    setup: document.worker?.setup,
    completesTask: authority?.mayCompleteTask,
  };
}

/** The claim shared by every role briefed under this configuration. */
export interface ConfigurationBrief {
  readonly motivation: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
}

function configurationBriefOf(
  brief: ConfigurationDocument["brief"],
): ConfigurationBrief {
  return {
    motivation: brief?.motivation ?? [],
    acceptanceCriteria: brief?.acceptanceCriteria ?? [],
    constraints: brief?.constraints ?? [],
  };
}

/** What one role — work or review — is told beyond the shared brief. */
export interface ConfigurationRole {
  readonly instructions: readonly string[] | undefined;
  readonly commands: readonly string[] | undefined;
  readonly practices: readonly string[] | undefined;
}

/** The practices a role is briefed with, by the briefing's own rule: none for
 * a role that runs commands, its own where it names them, and otherwise the
 * configuration's. */
function configurationRoleOf(
  purpose: ConfigurationDocument["work"],
  practices: readonly string[] | undefined,
): ConfigurationRole {
  return {
    instructions: purpose?.instructions,
    commands: purpose?.commands,
    practices:
      purpose === undefined
        ? undefined
        : purpose.commands === undefined
          ? (purpose.practices ?? practices)
          : [],
  };
}

/** One evaluation stage: what it checks itself, or what it briefs a reviewer with. */
export interface ConfigurationEvaluation {
  readonly purpose: string | undefined;
  readonly checks: readonly string[] | undefined;
  readonly instructions: readonly string[] | undefined;
  readonly practices: readonly string[] | undefined;
}

function configurationEvaluationsOf(
  evaluations: ConfigurationDocument["evaluations"],
): readonly ConfigurationEvaluation[] {
  return (evaluations ?? []).map((evaluation) => ({
    purpose: evaluation.purpose,
    checks: evaluation.checks,
    instructions: evaluation.instructions,
    practices: evaluation.practices,
  }));
}

/** Everything the Configuration panel draws, over one canonical document. */
export interface ConfigurationView {
  readonly settings: ConfigurationSettings;
  readonly brief: ConfigurationBrief;
  readonly work: ConfigurationRole;
  readonly review: ConfigurationRole;
  readonly evaluations: readonly ConfigurationEvaluation[];
}

export function configurationViewOf(canonical: string): ConfigurationView {
  const document = configurationDocumentOf(canonical);
  return {
    settings: configurationSettingsOf(document),
    brief: configurationBriefOf(document.brief),
    work: configurationRoleOf(document.work, document.practices),
    review: configurationRoleOf(document.review, document.practices),
    evaluations: configurationEvaluationsOf(document.evaluations),
  };
}

/** A practice identity as the words it names: `RegressionCoverage` reads as
 * "Regression coverage". An identity this cannot split into words is drawn as
 * itself rather than as nothing. */
export function practiceLabel(id: string): string {
  const words = id.match(/[A-Z][a-z0-9]*/gu) ?? [id];
  return words
    .map((word, index) => (index === 0 ? word : word.toLowerCase()))
    .join(" ");
}
