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
  briefChecksMax,
  briefIntentCharsMax,
  briefIntentLinesMax,
  briefLandingIsWhole,
  briefLineCharsMax,
  briefLinkScheme,
  briefLinksMax,
  briefTitleCharsMax,
} from "../../../../src/contract/brief.ts";
import { draftCreationSchema } from "../../../../src/contract/requests.ts";
import type { BriefFinalizationMode } from "../../../../src/contract/rosters.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import type {
  ConfigurationSummary,
  DraftInitializationResponse,
  DraftResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import type { z } from "zod";

import { operationStateSentence } from "./codeSentences.ts";
import { configurationCommitShort, configurationLabel } from "./labels.ts";
import type { Label } from "./labels.ts";
import type { OperationStep } from "./operationFollow.ts";

/** The authoring half of the form, which is exactly what an initialization defaults. */
export type CreationAuthoring = DraftInitializationResponse["defaults"];

export type CreationStage = CreationAuthoring["program"][number];

/**
 * One screen's whole contents: the authoring an initialization prefilled, and
 * the values only a human states. Both branches are held as the names a person
 * types rather than the references they become.
 */
export interface TicketCreationForm extends CreationAuthoring {
  readonly title: string;
  readonly intent: string;
  readonly links: readonly string[];
  readonly checks: readonly string[];
  readonly branchName: string;
  readonly targetBranchName: string;
  /** The bound repository the work happens in, empty where none is chosen. */
  readonly repository: string;
  /** How this ticket lands, seeded from the repository's default and the
   * reader's from the moment they move it. */
  readonly landingMode: BriefFinalizationMode;
}

export type CreationField =
  | "title"
  | "intent"
  | "links"
  | "checks"
  | "branch"
  | "target"
  | "landing"
  | "repository"
  | "authoring"
  | "fence";

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

/**
 * The one sentence a screen says about the configuration it did not ask about,
 * with the commit it was imported from where it came from one, and the revision
 * itself on hover.
 */
export function creationConfigurationSentence(
  configuration: ConfigurationSummary,
): Label {
  const label = configurationLabel(
    configuration.revision,
    configuration.version,
  );
  const commit = configurationCommitShort(configuration.provenance);
  const named = commit === undefined ? label.text : `${label.text} · ${commit}`;
  return {
    text: `shaped by configuration ${named}, the latest revision this project has ready`,
    title: label.title,
  };
}

/**
 * Whether this form must name a repository. The server refuses a release that
 * names none once the project binds one, so the form asks before rather than
 * after; a project binding none neither asks nor sends.
 */
export function creationRepositoryRequired(
  repositories: readonly ProjectRepositoryResponse[],
): boolean {
  return repositories.length > 0;
}

/** The sole binding, where there is exactly one and so no choice to make. */
export function creationRepositoryDefault(
  repositories: readonly ProjectRepositoryResponse[],
): string {
  const sole = repositories.length === 1 ? repositories[0] : undefined;
  return sole?.repository ?? "";
}

/** How this console lands work where no binding says otherwise, which is a form
 * in a project that binds nothing and a repository the listing no longer holds. */
const creationLandingUnbound: BriefFinalizationMode = "Push";

/** The landing the chosen repository defaults to, which is what an untouched
 * field shows and what a repository change re-seeds it with. */
export function creationLandingDefault(
  repositories: readonly ProjectRepositoryResponse[],
  repository: string,
): BriefFinalizationMode {
  const bound = repositories.find((row) => row.repository === repository);
  return bound?.landing.mode ?? creationLandingUnbound;
}

export function creationFormFrom(
  initialization: DraftInitializationResponse,
  repositories: readonly ProjectRepositoryResponse[],
): TicketCreationForm {
  const repository = creationRepositoryDefault(repositories);
  return {
    ...initialization.defaults,
    title: "",
    intent: "",
    links: [],
    checks: [],
    branchName: "",
    targetBranchName: "",
    repository,
    landingMode: creationLandingDefault(repositories, repository),
  };
}

/**
 * The form with another repository named. A landing the reader has not moved
 * takes the new repository's default and a moved one stands, because the seed
 * is a starting point and the choice is theirs.
 */
export function creationRepositoryChosen(
  form: TicketCreationForm,
  repositories: readonly ProjectRepositoryResponse[],
  repository: string,
): TicketCreationForm {
  const seeded = creationLandingDefault(repositories, form.repository);
  return {
    ...form,
    repository,
    landingMode:
      form.landingMode === seeded
        ? creationLandingDefault(repositories, repository)
        : form.landingMode,
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
 * What a branch field holds — either of them, so a name means the same thing
 * wherever the screen asks for one: nothing, the reference a typed name
 * becomes, or an input the field will not read. A reference pasted where a name
 * is asked for would otherwise be prefixed a second time, and nothing
 * downstream refuses the doubled value — it is a well-formed reference name,
 * and one the machine would create.
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

/** What the branch field asks for and what naming it does, said beside it rather than only when refused. */
export const creationBranchHint = `the branch this work starts from, and lands on unless a target names another, created if it does not exist yet: a name, not a reference, which this console sends as ${briefBranchPrefix}<name>`;

/** The same, for the field that names where the work ends up instead. */
export const creationTargetBranchHint = `where the finished work lands, created if it does not exist yet: a name, not a reference, which this console sends as ${briefBranchPrefix}<name>`;

/** The one input either branch field refuses, said as the edit that fixes it. */
export const creationBranchPrefixedSentence = `enter the branch name, not the ref: this console adds ${briefBranchPrefix} itself`;

/** What a proposal names that a push may leave out. */
export const creationLandingTargetSentence =
  "a pull request names the branch it opens into";

/** What `briefLandingIsWhole` refuses, said as the two boxes that fix it. */
export const creationLandingWholeSentence =
  "a pull request opens from the branch above into a different target branch";

/**
 * What this form checked and the reader has to satisfy, and no more than that.
 * The grammar a reference name obeys is not among them — the contract carries
 * no statement of it, so a name the server's grammar refuses is refused there.
 */
export function creationFaultSentence(field: CreationField): string {
  switch (field) {
    case "title":
      return `name this ticket in one line of at most ${String(briefTitleCharsMax)} characters`;
    case "intent":
      return `state what this ticket is for on at least one line, at most ${String(briefLineCharsMax)} characters a line — break the sentence across lines rather than shorten it — and at most ${String(briefIntentLinesMax)} printed lines and ${String(briefIntentCharsMax)} characters in all`;
    case "links":
      return `each link is an ${briefLinkScheme} URL of at most ${String(briefLineCharsMax)} characters, and one ticket carries at most ${String(briefLinksMax)}`;
    case "checks":
      return `each check is one command line of at most ${String(briefLineCharsMax)} characters, and one ticket adds at most ${String(briefChecksMax)}`;
    case "branch":
    case "target":
      return `a branch is named here without its ${briefBranchPrefix} prefix, and the whole reference is at most ${String(briefBranchCharsMax)} characters`;
    case "landing":
      return "a ticket with no finalizer lands nothing";
    case "repository":
      return "this project binds a repository, so a ticket in it names which one";
    case "authoring":
      return "one advanced setting is not one this project offers";
    case "fence":
      return "this form no longer describes a configuration the API will accept";
  }
}

/**
 * The field an issue belongs to. The brief's own pairing refine names no field
 * at all, and the pair it refuses is the finalization's target against the
 * branch, so a bare brief issue is the target's.
 */
function creationFieldOf(path: readonly PropertyKey[]): CreationField {
  if (path[0] === "authoring") return "authoring";
  if (path[0] !== "brief") return "fence";
  if (path[1] === "title") return "title";
  if (path[1] === "intent") return "intent";
  if (path[1] === "branch") return "branch";
  if (path[1] === "checks") return "checks";
  if (path[1] === "repository") return "repository";
  if (path[1] === "finalization")
    return path[2] === "target" ? "target" : "landing";
  return path[1] === undefined ? "target" : "links";
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

/** The two references one form names: the one work starts from, and the one it lands on. */
interface CreationBranches {
  readonly branch: CreationBranch;
  readonly target: CreationBranch;
}

function creationBranchesOf(form: TicketCreationForm): CreationBranches {
  return {
    branch: creationBranchOf(form.branchName),
    target: creationBranchOf(form.targetBranchName),
  };
}

/**
 * What a proposal needs that a push does not: a reference to open into, and a
 * branch of its own that is not it. A branch box the form already refuses for
 * its prefix earns no second fault, because the prefix is the edit to make
 * first and the pairing is decided on what the fixed box would name.
 */
function creationLandingFault(
  form: TicketCreationForm,
  branches: CreationBranches,
): CreationFault | undefined {
  if (form.landingMode !== "PullRequest") return undefined;
  if (branches.branch.named === "Prefixed") return undefined;
  if (branches.target.named === "Prefixed") return undefined;
  if (branches.target.named !== "Ref")
    return { field: "target", reason: creationLandingTargetSentence };
  return briefLandingIsWhole({
    ...(branches.branch.named === "Ref" ? { branch: branches.branch.ref } : {}),
    finalization: { mode: form.landingMode, target: branches.target.ref },
  })
    ? undefined
    : { field: "target", reason: creationLandingWholeSentence };
}

/**
 * The faults this form decides for itself, the wire's parser deciding the rest.
 *
 * A FORM STATES NO FAULT IN A BOX IT DOES NOT DRAW: a ticket running no
 * finalizer is asked for neither a landing nor a target and sends neither, so a
 * value left in the target box from before that choice would stop a submission
 * with no field on screen to read the reason beside.
 */
function creationStatedFaults(
  form: TicketCreationForm,
  branches: CreationBranches,
  repositories: readonly ProjectRepositoryResponse[],
): readonly CreationFault[] {
  const stated: CreationFault[] = [];
  if (creationIntentLines(form.intent).length > briefIntentLinesMax)
    stated.push({ field: "intent", reason: creationFaultSentence("intent") });
  if (creationRepositoryRequired(repositories) && form.repository.trim() === "")
    stated.push({
      field: "repository",
      reason: creationFaultSentence("repository"),
    });
  if (branches.branch.named === "Prefixed")
    stated.push({ field: "branch", reason: creationBranchPrefixedSentence });
  if (form.finalizer !== "ManagedFinalizer") return stated;
  if (branches.target.named === "Prefixed")
    stated.push({ field: "target", reason: creationBranchPrefixedSentence });
  const landing = creationLandingFault(form, branches);
  if (landing !== undefined) stated.push(landing);
  return stated;
}

/**
 * How this brief lands, which is the finalizer's parameter and so is sent
 * whenever one runs — explicitly, even where it is the repository's own
 * default, so the ticket records the landing it was released with. A ticket
 * authored to run no finalizer lands nothing and names nothing.
 */
function creationFinalizationOf(
  form: TicketCreationForm,
  branches: CreationBranches,
): Record<string, unknown> {
  if (form.finalizer !== "ManagedFinalizer") return {};
  return {
    finalization: {
      mode: form.landingMode,
      ...(branches.target.named === "Ref"
        ? { target: branches.target.ref }
        : {}),
    },
  };
}

/**
 * The brief a form becomes. A form adding no check lines sends none rather than
 * an empty list, and a form naming no title sends none rather than an empty one.
 */
function creationBriefOf(
  form: TicketCreationForm,
  branches: CreationBranches,
): unknown {
  const checks = form.checks
    .map((check) => check.trim())
    .filter((check) => check !== "");
  const title = form.title.trim();
  const repository = form.repository.trim();
  return {
    ...(title === "" ? {} : { title }),
    ...(repository === "" ? {} : { repository }),
    intent: creationIntentNormalized(form.intent).trim(),
    links: form.links.map((link) => link.trim()).filter((link) => link !== ""),
    ...(checks.length === 0 ? {} : { checks }),
    ...(branches.branch.named === "Ref" ? { branch: branches.branch.ref } : {}),
    ...creationFinalizationOf(form, branches),
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
  repositories: readonly ProjectRepositoryResponse[],
): CreationAssembly {
  const branches = creationBranchesOf(form);
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
    brief: creationBriefOf(form, branches),
  };
  const stated = creationStatedFaults(form, branches, repositories);
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
