/**
 * What creating a ticket decides: which configuration shapes it, and the body
 * one form's contents become.
 *
 * Every function here is pure, so the agent this screen is built towards drives
 * the same decisions a browser does by filling the same form value. The
 * assembled body is handed to the wire's own `draftCreationSchema` rather than
 * measured against a second spelling of its bounds, which is why a fault names
 * the field it belongs to instead of restating a limit.
 *
 * THE LINE COUNT IS THE ONE BOUND THE WIRE'S PARSER DOES NOT CARRY. A brief is
 * stored as the lines a briefing prints, and that count is bounded where it is
 * stored; `test/ui/ticketBriefLines.test.ts` holds the counter below against
 * the one the interpreter stores by, the arrangement `no-console-sees-another`
 * names for a rule two trees both need.
 */

import {
  briefBranchCharsMax,
  briefBranchPrefix,
  briefIntentCharsMax,
  briefIntentLinesMax,
  briefLineCharsMax,
  briefLinkScheme,
  briefLinksMax,
} from "../../../../src/contract/brief.ts";
import { draftCreationSchema } from "../../../../src/contract/requests.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import type {
  ConfigurationResponse,
  ConfigurationSummary,
  DraftInitializationResponse,
  DraftResponse,
} from "../../../../src/contract/responses.ts";
import type { z } from "zod";

import { operationStateSentence } from "./codeSentences.ts";
import type { OperationStep } from "./operationFollow.ts";

/** The authoring half of the form, which is exactly what an initialization defaults. */
export type CreationAuthoring = DraftInitializationResponse["defaults"];

export type CreationStage = CreationAuthoring["program"][number];

/**
 * One screen's whole contents: the authoring an initialization prefilled, and
 * the three values only a human states. The branch is held as the name a
 * person types rather than the reference it becomes.
 */
export interface TicketCreationForm extends CreationAuthoring {
  readonly intent: string;
  readonly links: readonly string[];
  readonly branchName: string;
}

export type CreationField =
  "intent" | "links" | "branch" | "authoring" | "fence";

export interface CreationFault {
  readonly field: CreationField;
  readonly reason: string;
}

export type CreationAssembly =
  | {
      readonly assembled: "Body";
      readonly body: z.infer<typeof draftCreationSchema>;
    }
  | { readonly assembled: "Faults"; readonly faults: readonly CreationFault[] };

/**
 * The newest revision this project has ready. The list arrives newest first, so
 * the first ready one is the latest, and a project with none is a state to draw
 * rather than a choice to offer.
 */
export function latestReadyConfiguration(
  configurations: readonly ConfigurationSummary[],
): ConfigurationSummary | undefined {
  return configurations.find((summary) => summary.readiness === "Ready");
}

/** The one sentence a screen says about the configuration it did not ask about. */
export function creationConfigurationSentence(
  configuration: ConfigurationResponse,
): string {
  return `shaped by configuration ${configuration.revision}, the latest revision this project has ready`;
}

export function creationFormFrom(
  initialization: DraftInitializationResponse,
): TicketCreationForm {
  return {
    ...initialization.defaults,
    intent: "",
    links: [],
    branchName: "",
  };
}

/** A browser's newline, as the one newline this tree bounds an intent by. */
function creationIntentNormalized(intent: string): string {
  return intent.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/** The lines an intent renders as: a line with nothing on it prints nothing. */
export function creationIntentLines(intent: string): readonly string[] {
  return creationIntentNormalized(intent)
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

/**
 * What one branch field holds: nothing, the reference a typed name becomes, or
 * an input this field will not read. A reference pasted where a name is asked
 * for would otherwise be prefixed a second time and name a branch that does not
 * exist, and nothing downstream refuses that — the doubled value is a
 * well-formed reference name.
 */
export type CreationBranch =
  | { readonly named: "None" }
  | { readonly named: "Ref"; readonly ref: string }
  | { readonly named: "Prefixed" };

export function creationBranchOf(branchName: string): CreationBranch {
  const named = branchName.trim();
  if (named === "") return { named: "None" };
  if (named.startsWith(briefBranchPrefix)) return { named: "Prefixed" };
  return { named: "Ref", ref: `${briefBranchPrefix}${named}` };
}

/** What the branch field asks for, said beside it rather than only when refused. */
export const creationBranchHint = `a branch name, not a reference: this console sends it as ${briefBranchPrefix}<name>`;

/** The one input the branch field refuses, said as the edit that fixes it. */
export const creationBranchPrefixedSentence = `enter the branch name, not the ref: this console adds ${briefBranchPrefix} itself`;

/**
 * What this form checked and the reader has to satisfy, and no more than that.
 * The grammar a reference name obeys is not among them — the contract carries
 * no statement of it, so a name the server's grammar refuses is refused there.
 */
export function creationFaultSentence(field: CreationField): string {
  switch (field) {
    case "intent":
      return `state what this ticket is for: at least one line, at most ${String(briefIntentLinesMax)} printed lines and ${String(briefIntentCharsMax)} characters`;
    case "links":
      return `each link is an ${briefLinkScheme} URL of at most ${String(briefLineCharsMax)} characters, and one ticket carries at most ${String(briefLinksMax)}`;
    case "branch":
      return `a branch is named here without its ${briefBranchPrefix} prefix, and the whole reference is at most ${String(briefBranchCharsMax)} characters`;
    case "authoring":
      return "one advanced setting is not one this project offers";
    case "fence":
      return "this form no longer describes a configuration the API will accept";
  }
}

function creationFieldOf(path: readonly PropertyKey[]): CreationField {
  if (path[0] === "authoring") return "authoring";
  if (path[0] !== "brief") return "fence";
  if (path[1] === "intent") return "intent";
  return path[1] === "branch" ? "branch" : "links";
}

/**
 * The faults a field earns, with the ones this form stated itself first: a
 * field the form already has a sentence for is not given the field's general
 * one a second time.
 */
function creationFaultsOf(
  issues: readonly { readonly path: readonly PropertyKey[] }[],
  stated: readonly CreationFault[],
): readonly CreationFault[] {
  const named = new Set(stated.map((fault) => fault.field));
  const fields = new Set(issues.map((issue) => creationFieldOf(issue.path)));
  return [
    ...stated,
    ...[...fields]
      .filter((field) => !named.has(field))
      .map((field) => ({ field, reason: creationFaultSentence(field) })),
  ];
}

/** The faults this form decides for itself, the wire's parser deciding the rest. */
function creationStatedFaults(
  form: TicketCreationForm,
  branch: CreationBranch,
): readonly CreationFault[] {
  const stated: CreationFault[] = [];
  if (creationIntentLines(form.intent).length > briefIntentLinesMax)
    stated.push({ field: "intent", reason: creationFaultSentence("intent") });
  if (branch.named === "Prefixed")
    stated.push({ field: "branch", reason: creationBranchPrefixedSentence });
  return stated;
}

function creationBriefOf(
  form: TicketCreationForm,
  branch: CreationBranch,
): unknown {
  return {
    intent: creationIntentNormalized(form.intent).trim(),
    links: form.links.map((link) => link.trim()).filter((link) => link !== ""),
    ...(branch.named === "Ref" ? { branch: branch.ref } : {}),
  };
}

/**
 * The whole creation body, fence and all, or every field a reader has to
 * revisit. The fence is the initialization's own, so a body assembled from a
 * stale one is refused by the API rather than silently retargeted.
 */
export function creationBodyFrom(
  initialization: DraftInitializationResponse,
  form: TicketCreationForm,
): CreationAssembly {
  const branch = creationBranchOf(form.branchName);
  const candidate = {
    configurationRevision: initialization.configuration.revision,
    configurationDigest: initialization.fence.configurationDigest,
    expectedProjectSequence: initialization.fence.projectSequence,
    authoring: {
      dependencies: [...form.dependencies],
      program: [...form.program],
      workFanout: form.workFanout,
      reworkPolicy: form.reworkPolicy,
      finalizationPricing: form.finalizationPricing,
      resumePricing: form.resumePricing,
      finalizer: form.finalizer,
    },
    brief: creationBriefOf(form, branch),
  };
  const stated = creationStatedFaults(form, branch);
  const parsed = draftCreationSchema.safeParse(candidate);
  if (parsed.success && stated.length === 0)
    return { assembled: "Body", body: parsed.data };
  const issues = parsed.success ? [] : parsed.error.issues;
  return { assembled: "Faults", faults: creationFaultsOf(issues, stated) };
}

/** The mutation that turns the draft just created into a ticket the machine runs. */
export function creationReleaseMutation(draft: DraftResponse): PublicMutation {
  return {
    mutation: "ReleaseDraft",
    ticket: draft.ticket,
    authoringVersion: draft.authoringVersion,
    configurationRevision: draft.configurationRevision,
  };
}

/**
 * The options a field offers, with the value it currently holds among them: a
 * default outside the offered set is still what the form would submit, so
 * hiding it would show a choice nobody made.
 */
export function creationOffered<T>(
  offered: readonly T[],
  chosen: T,
  label: (value: T) => string,
): readonly T[] {
  const held = label(chosen);
  return offered.some((value) => label(value) === held)
    ? offered
    : [chosen, ...offered];
}

/** Where one submit has got to, for a screen that draws a line and not a log. */
export function creationStepSentence(step: OperationStep): string {
  switch (step.step) {
    case "Submitting":
      return "creating the draft and releasing it…";
    case "Backlogged":
      return `the API is deferring this; trying again in ${String(step.retryAfterSeconds)}s`;
    case "Following":
      return "waiting for the actor to decide the release…";
    case "Confirming":
      return "waiting for the project to catch up with the release…";
    case "Settled":
      return step.state === "Succeeded"
        ? "released"
        : operationStateSentence(step.state);
    case "Abandoned":
      return step.reason;
  }
}

export function creationStageLabel(stage: CreationStage): string {
  return `${String(stage.fanout)} × ${stage.combinator}`;
}

export function creationFanoutLabel(fanout: number): string {
  return String(fanout);
}

export function creationReworkLabel(
  policy: CreationAuthoring["reworkPolicy"],
): string {
  return `${policy.type} ${String(policy.value)}`;
}

export function creationFinalizationLabel(
  pricing: CreationAuthoring["finalizationPricing"],
): string {
  return pricing === "DeadlineOnly"
    ? pricing
    : `${pricing.type} ${String(pricing.value)}`;
}
