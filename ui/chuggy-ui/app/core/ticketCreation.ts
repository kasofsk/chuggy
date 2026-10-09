/**
 * What creating a ticket decides: which configuration shapes it, and the body
 * one form's contents become.
 *
 * WHICH CONFIGURATION IS THE READER'S TO SAY. A configuration is who does the
 * work, so a project offering several is asked which, and a form naming none
 * sends nothing. A form starts unasked on a name the reader has not chosen only
 * where it is the sole offer of a read that missed none, or the one a
 * duplicated ticket was authored under while the project still offers it.
 *
 * Every function here is pure, so the agent this screen is built towards drives
 * the same decisions a browser does by filling the same form value. The
 * assembled body is handed to the wire's own `draftCreationSchema` rather than
 * measured against a second spelling of its bounds, which is why a fault names
 * the field it belongs to instead of restating a limit.
 */

import {
  briefBranchCharsMax,
  briefBranchPrefix,
  briefChecksMax,
  briefImagesMax,
  briefIntentCharsMax,
  briefLandingIsWhole,
  briefLineCharsMax,
  briefLinkScheme,
  briefLinksMax,
  briefTitleCharsMax,
} from "../../../../src/contract/brief.ts";
import { imageMediaTypes } from "../../../../src/contract/http.ts";
import type { ImageMediaType } from "../../../../src/contract/http.ts";
import { draftCreationSchema } from "../../../../src/contract/requests.ts";
import {
  briefFinalizationProposes,
  type BriefFinalizationMode,
} from "../../../../src/contract/rosters.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import { bootstrapConfigurationName } from "../../../../src/contract/responses.ts";
import type {
  ConfigurationSummary,
  DraftInitializationResponse,
  DraftResponse,
  ProjectRepositoryListedResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import type { z } from "zod";

import type { ApiFailure } from "./apiRequest.ts";
import { operationStateSentence } from "./codeSentences.ts";
import { configurationCommitShort, configurationLabel } from "./labels.ts";
import type { Label } from "./labels.ts";
import type { OperationStep } from "./operationFollow.ts";
import { repositoryLabel } from "./projectRepositories.ts";
import { repositoryConfigurations } from "./repositoryConfigurations.ts";
import { threadUploadRefused } from "./threads.ts";
import {
  overrideFieldKind,
  overrideFieldLabel,
  overrideFields,
  overridesNestedOf,
} from "./ticketOverrides.ts";
import type { CreationOverrides, OverrideField } from "./ticketOverrides.ts";

/** The authoring half of the form, which is exactly what an initialization defaults. */
export type CreationAuthoring = DraftInitializationResponse["defaults"];

export type CreationStage = CreationAuthoring["program"][number];

/**
 * One screen's whole contents: the authoring an initialization prefilled, and
 * the values only a human states. Both branches are held as the names a person
 * types rather than the references they become.
 */
export interface TicketCreationForm extends CreationAuthoring {
  /** The offer this ticket is drawn under, by name, empty where none is chosen. */
  readonly configuration: string;
  readonly title: string;
  readonly intent: string;
  readonly links: readonly string[];
  /** The project images this ticket carries, by the identity each upload
   * answered: the bytes are the project's, and never the form's. */
  readonly images: readonly string[];
  readonly checks: readonly string[];
  readonly branchName: string;
  readonly targetBranchName: string;
  /** The bound repository the work happens in, empty where none is chosen. */
  readonly repository: string;
  /** How this ticket lands, seeded from the repository's default and the
   * reader's from the moment they move it. */
  readonly landingMode: BriefFinalizationMode;
  /** What this ticket replaces of its configuration, drawn only once a
   * configuration is chosen and kept when another is. */
  readonly overrides: CreationOverrides;
}

export type CreationField =
  | "configuration"
  | "title"
  | "intent"
  | "links"
  | "images"
  | "checks"
  | "branch"
  | "target"
  | "landing"
  | "repository"
  | "authoring"
  | "overrides"
  | "fence";

export interface CreationFault {
  readonly field: CreationField;
  /** The overridden field an `overrides` fault is stated at. */
  readonly override?: OverrideField;
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
 * An offer before its initialization is read: the name a reader chooses it
 * by, the revision that read asks for, and its row in the listing. A bootstrap
 * is offered on a binding's word and not looked for there, so it has no row.
 */
export interface CreationOfferListed {
  readonly name: string;
  readonly revision: string;
  readonly listed: ConfigurationSummary | undefined;
}

/**
 * One configuration a ticket may be drawn under, and the initialization that
 * defaults and fences a form drawn under it.
 */
export interface CreationOffer {
  /** What a reader chooses it by, which is what the form holds once they have. */
  readonly name: string;
  /** Its row in the listing, which neither a bootstrap nor a revision only a
   * draft still holds has. */
  readonly listed: ConfigurationSummary | undefined;
  readonly initialization: DraftInitializationResponse;
}

/** The name a revision goes by: the one its repository declared it under, and
 * itself where nothing declared it. */
export function creationConfigurationName(
  configuration: ConfigurationSummary,
): string {
  const provenance = configuration.provenance;
  return provenance.source === "Repository"
    ? provenance.name
    : configuration.revision;
}

type CreationNameSpelling = (configuration: ConfigurationSummary) => string;

/** A declared name beside the repository that declares it, however that
 * repository is spelled. */
function creationNameQualified(
  spelled: (repository: string) => string,
): CreationNameSpelling {
  return (configuration) => {
    const provenance = configuration.provenance;
    return provenance.source === "Repository"
      ? `${provenance.name} · ${spelled(provenance.repository)}`
      : configuration.revision;
  };
}

/** The spellings a name is tried in, plainest first. */
const creationNameSpellings: readonly CreationNameSpelling[] = [
  creationConfigurationName,
  creationNameQualified(repositoryLabel),
  creationNameQualified((repository) => repository),
];

/**
 * The name one offered revision is chosen by: its own, and beside its
 * repository where two repositories declare one name — short where that tells
 * them apart, whole where the two shorten alike. A name in `taken` is a
 * bootstrap's, which no declared revision is offered under.
 */
function creationOfferName(
  configuration: ConfigurationSummary,
  offered: readonly ConfigurationSummary[],
  taken: readonly string[],
): string {
  const apart = creationNameSpellings.find(
    (spelling) =>
      !taken.includes(spelling(configuration)) &&
      offered.every(
        (other) =>
          other === configuration ||
          spelling(other) !== spelling(configuration),
      ),
  );
  return (apart ?? creationConfigurationName)(configuration);
}

/**
 * What the project holds for its live bindings, as the listing of them says:
 * the ones whose repositories declared names into it, and the bootstrap
 * revisions the ones declaring none are released under.
 */
function creationHeld(
  repositories: readonly ProjectRepositoryListedResponse[],
): {
  readonly imported: readonly ProjectRepositoryListedResponse[];
  readonly bootstraps: readonly string[];
} {
  const live = creationRepositories(repositories);
  const bootstraps = live.flatMap(({ configurationsHeld: held }) =>
    held?.result === "Bootstrapped" ? [held.revision] : [],
  );
  return {
    imported: live.filter(
      (binding) => binding.configurationsHeld?.result === "Imported",
    ),
    bootstraps: [...new Set(bootstraps)],
  };
}

/**
 * The configurations a new ticket may be drawn under, by name and in name
 * order: what the newest commit of each live binding that declares has ready,
 * and the bootstrap of each that declares nothing. A project whose live
 * bindings hold neither has its newest ready revision and nothing else,
 * whichever binding or author that came from.
 */
export function creationConfigurationsOffered(
  configurations: readonly ConfigurationSummary[],
  repositories: readonly ProjectRepositoryListedResponse[],
): readonly CreationOfferListed[] {
  const { imported, bootstraps } = creationHeld(repositories);
  const newest = latestReadyConfiguration(configurations);
  const fallback = newest === undefined ? [] : [newest];
  const declared = imported
    .flatMap((binding) =>
      repositoryConfigurations(configurations, binding.repository),
    )
    .filter((summary) => summary.readiness === "Ready");
  const listed =
    imported.length === 0 && bootstraps.length === 0 ? fallback : declared;
  const offered: readonly CreationOfferListed[] = [
    ...listed.map((one) => ({
      name: creationOfferName(one, listed, bootstraps),
      revision: one.revision,
      listed: one,
    })),
    ...bootstraps.map((revision) => ({
      name: revision,
      revision,
      listed: undefined,
    })),
  ];
  return offered.toSorted((left, right) => {
    if (left.name === right.name) return 0;
    return left.name < right.name ? -1 : 1;
  });
}

/**
 * Whether the listing read so far already decides what is offered, so a walk
 * of it may stop. A live binding that declares holds it open until the rows
 * of its newest commit are read, which they are once a row not its own
 * follows them; with none declaring, one that holds a bootstrap needs no row,
 * and otherwise the project's first ready revision is what the walk is for.
 */
export function creationConfigurationsDecided(
  configurations: readonly ConfigurationSummary[],
  repositories: readonly ProjectRepositoryListedResponse[],
): boolean {
  const { imported, bootstraps } = creationHeld(repositories);
  if (imported.length > 0)
    return imported.every((binding) => {
      const newest = repositoryConfigurations(
        configurations,
        binding.repository,
      );
      return newest.length > 0 && newest.at(-1) !== configurations.at(-1);
    });
  return (
    bootstraps.length > 0 ||
    latestReadyConfiguration(configurations) !== undefined
  );
}

/** The offer a name stands for, a name nothing offers standing for none. */
export function creationOfferOf(
  offers: readonly CreationOffer[],
  name: string,
): CreationOffer | undefined {
  return offers.find((offer) => offer.name === name);
}

/**
 * The name a form starts on: the sole offer of a read that missed none, where
 * there is no choice to make, and otherwise the one this reader chose last
 * where it is still offered. Among several, or under one that may not be all
 * there are, with none remembered it starts on nothing, never on a guess.
 */
export function creationConfigurationStart(
  offers: readonly CreationOffer[],
  preferred: string | undefined,
  partial = false,
): string {
  const sole = offers.length === 1 && !partial ? offers[0] : undefined;
  if (sole !== undefined) return sole.name;
  return creationOfferOf(offers, preferred ?? "")?.name ?? "";
}

/** Whether the form asks which configuration, which is everywhere but where
 * the one offer is the one it already names. */
export function creationConfigurationAsked(
  offers: readonly CreationOffer[],
  configuration: string,
): boolean {
  const sole = offers.length === 1 ? offers[0] : undefined;
  return sole?.name !== configuration;
}

/**
 * The line a screen draws for a configuration it did not ask about, with the
 * commit it was imported from where the listing says one, and the revision
 * itself on hover.
 */
export function creationConfigurationLabel(offer: CreationOffer): Label {
  const held = offer.initialization.configuration;
  const label = configurationLabel(
    held.revision,
    offer.listed?.version ?? held.version,
  );
  const commit =
    offer.listed === undefined
      ? undefined
      : configurationCommitShort(offer.listed.provenance);
  const named = commit === undefined ? label.text : `${label.text} · ${commit}`;
  return { text: `Configuration · ${named}`, title: label.title };
}

/**
 * What a ticket on the bootstrap is for, which is the one thing it can do:
 * write the repository's own configuration. An authored bootstrap's revision
 * is its name, and an imported one is known by the name it was declared under.
 */
export function creationBootstrapLine(
  offer: CreationOffer,
): string | undefined {
  const name =
    offer.listed === undefined
      ? offer.name
      : creationConfigurationName(offer.listed);
  return name === bootstrapConfigurationName
    ? "First ticket · writes this repository's configuration"
    : undefined;
}

/**
 * The bindings a new ticket may name. A retired binding is one the project has
 * stopped reading and the authority refuses a brief against, so the form neither
 * offers it nor seeds itself with it.
 */
export function creationRepositories<Binding extends ProjectRepositoryResponse>(
  bound: readonly Binding[],
): readonly Binding[] {
  return bound.filter((binding) => binding.retiredAt === undefined);
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

/** The authoring a form holds while no configuration has defaulted it. */
const creationAuthoringUndrawn: CreationAuthoring = {
  dependencies: [],
  program: [],
};

export function creationFormFrom(
  offers: readonly CreationOffer[],
  repositories: readonly ProjectRepositoryResponse[],
  preferred?: string,
  partial = false,
): TicketCreationForm {
  const configuration = creationConfigurationStart(offers, preferred, partial);
  const drawn = creationOfferOf(offers, configuration);
  const repository = creationRepositoryDefault(repositories);
  return {
    ...(drawn?.initialization.defaults ?? creationAuthoringUndrawn),
    configuration,
    title: "",
    intent: "",
    links: [],
    images: [],
    checks: [],
    branchName: "",
    targetBranchName: "",
    repository,
    landingMode: creationLandingDefault(repositories, repository),
    overrides: {},
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

/** A program as the widths of its stages, which is all one differs from
 * another by: every key in it is its position. */
function creationProgramWidths(program: readonly CreationStage[]): string {
  return program.map((stage) => String(stage.evaluators.length)).join(",");
}

/**
 * The form with another configuration named. A program the reader has not
 * moved takes the new configuration's default and a moved one stands, as a
 * landing does under another repository; everything typed is kept.
 */
export function creationConfigurationChosen(
  form: TicketCreationForm,
  offers: readonly CreationOffer[],
  name: string,
): TicketCreationForm {
  const seeded =
    creationOfferOf(offers, form.configuration)?.initialization.defaults ??
    creationAuthoringUndrawn;
  const chosen =
    creationOfferOf(offers, name)?.initialization.defaults ??
    creationAuthoringUndrawn;
  const unmoved =
    creationProgramWidths(form.program) ===
    creationProgramWidths(seeded.program);
  return {
    ...form,
    configuration: name,
    program: unmoved ? chosen.program : form.program,
  };
}

/** A browser's newline, as the one newline this tree stores an intent under. */
function creationIntentNormalized(intent: string): string {
  return intent.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
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

/** What the branch key asks for and what naming it does, which the YAML editor explains the key with. */
export const creationBranchHint = `the branch this work starts from, and lands on unless a target names another, created if it does not exist yet: a name, not a reference, which this console sends as ${briefBranchPrefix}<name>`;

/** Where the work lands when the target box is left empty, which each landing answers for itself. */
function creationTargetBranchUnnamed(mode: BriefFinalizationMode): string {
  switch (mode) {
    case "Push":
      return "the branch the work happened on";
    case "PullRequest":
    case "PullRequestMerge":
      return "the repository's default branch";
    case "None":
      return "nowhere; a landing that lands nothing names no reference";
  }
}

/** The same, for the key that names where the work ends up instead. */
export function creationTargetBranchHint(mode: BriefFinalizationMode): string {
  return `where the finished work lands, created if it does not exist yet: a name, not a reference, which this console sends as ${briefBranchPrefix}<name>, and ${creationTargetBranchUnnamed(mode)} where it is left empty`;
}

/** The line under the form's branch box. */
export const creationBranchFieldHint =
  "Where the work happens · created if missing";

/** The line under the form's target box: what leaving it empty lands on. */
export function creationTargetBranchFieldHint(
  mode: BriefFinalizationMode,
): string {
  switch (mode) {
    case "Push":
      return "Empty means the branch above";
    case "PullRequest":
    case "PullRequestMerge":
      return "Empty means the repository's default branch";
    case "None":
      return "Lands nothing";
  }
}

/** The one input either branch field refuses, said as the edit that fixes it. */
export const creationBranchPrefixedSentence = `enter the branch name, not the ref: this console adds ${briefBranchPrefix} itself`;

/** The bound on a ticket's images, said where an attachment would pass it. */
export const creationImagesBoundSentence = `one ticket carries at most ${String(briefImagesMax)} images`;

/** The types an image is attached in, as a reader names them. */
export const creationImageTypesLabel = imageMediaTypes
  .map((type) => type.replace(/^image\//u, "").toUpperCase())
  .join(", ");

/** The type an offered file is uploaded as, where it is one the upload admits. */
export function creationImageMediaType(
  type: string,
): ImageMediaType | undefined {
  return imageMediaTypes.find((admitted) => admitted === type);
}

/**
 * What one attaching takes of the files it was offered: each of a type the
 * upload admits, up to the room the bound leaves beside the images held, and
 * why it took fewer than it was offered, where it did.
 */
export function creationImagesTaken<T extends { readonly type: string }>(
  heldCount: number,
  offered: readonly T[],
): { readonly taken: readonly T[]; readonly refused?: string } {
  const admitted = offered.filter(
    (file) => creationImageMediaType(file.type) !== undefined,
  );
  const room = Math.max(0, briefImagesMax - heldCount);
  const taken = admitted.slice(0, room);
  if (admitted.length > room)
    return { taken, refused: creationImagesBoundSentence };
  if (admitted.length < offered.length)
    return {
      taken,
      refused: `only ${creationImageTypesLabel} images attach`,
    };
  return { taken };
}

/** What an upload that failed is said as: the upload's own refusal, and that
 * nothing was attached. */
export function creationImageUploadSentence(failure: ApiFailure): string {
  const cause = threadUploadRefused(failure).cause;
  return cause === undefined ? "Not attached" : `Not attached · ${cause}`;
}

/** What a proposal is opened from, which is the one box a push may leave empty. */
export const creationLandingBranchSentence =
  "a pull request is opened from a branch of its own, so name one above";

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
    case "configuration":
      return "a configuration is who does the work, so a ticket names which one it runs under";
    case "title":
      return `name this ticket in one line of at most ${String(briefTitleCharsMax)} characters`;
    case "intent":
      return `state what this ticket is for, in at most ${String(briefIntentCharsMax)} characters`;
    case "links":
      return `each link is an ${briefLinkScheme} URL of at most ${String(briefLineCharsMax)} characters, and one ticket carries at most ${String(briefLinksMax)}`;
    case "images":
      return creationImagesBoundSentence;
    case "checks":
      return `each check is one command line of at most ${String(briefLineCharsMax)} characters, and one ticket adds at most ${String(briefChecksMax)}`;
    case "branch":
    case "target":
      return `a branch is named here without its ${briefBranchPrefix} prefix, and the whole reference is at most ${String(briefBranchCharsMax)} characters`;
    case "landing":
      return "this landing is not one the API will accept";
    case "repository":
      return "this project binds a repository, so a ticket in it names which one";
    case "authoring":
      return "one advanced setting is not one this project offers";
    case "overrides":
      return "an override is not one a ticket may write";
    case "fence":
      return "this form no longer describes a configuration the API will accept";
  }
}

/**
 * The field an issue belongs to, the brief's own pairing naming none: it is
 * refused for a branch or for a target depending on which of them the reader
 * wrote, which is what the form's own sentence already says beside the box.
 */
function creationFieldOf(
  path: readonly PropertyKey[],
): CreationField | undefined {
  if (path[0] === "authoring") return "authoring";
  if (path[0] === "overrides") return undefined;
  if (path[0] !== "brief") return "fence";
  if (path[1] === "title") return "title";
  if (path[1] === "intent") return "intent";
  if (path[1] === "branch") return "branch";
  if (path[1] === "checks") return "checks";
  if (path[1] === "images") return "images";
  if (path[1] === "repository") return "repository";
  if (path[1] === "finalization")
    return path[2] === "target" ? "target" : "landing";
  return path[1] === undefined ? undefined : "links";
}

/** What an overridden field the contract refuses is told, by how it is edited. */
export function creationOverrideFaultSentence(field: OverrideField): string {
  switch (overrideFieldKind(field)) {
    case "Mode":
      return "this model is written into a mode a ticket may not override with";
    case "Lines":
      return "write this as lines of text, one a line";
    case "Files":
      return "each file is a path and its content";
  }
}

/** The overridden field an issue is about, by its path under `overrides`. */
function creationOverrideOf(
  path: readonly PropertyKey[],
): OverrideField | undefined {
  return overrideFields.find((field) =>
    field.split(".").every((part, at) => path[at + 1] === part),
  );
}

/** One fault for each overridden field the contract refuses, and the general
 * one for an issue that names none. */
function creationOverrideFaultsOf(
  issues: readonly { readonly path: readonly PropertyKey[] }[],
): readonly CreationFault[] {
  const about = issues.filter((issue) => issue.path[0] === "overrides");
  const fields = new Set(about.map((issue) => creationOverrideOf(issue.path)));
  return [...fields].map((override) =>
    override === undefined
      ? { field: "overrides", reason: creationFaultSentence("overrides") }
      : {
          field: "overrides",
          override,
          reason: `${overrideFieldLabel(override)}: ${creationOverrideFaultSentence(override)}`,
        },
  );
}

/**
 * The faults a field earns, with the ones this form stated itself first: a
 * field the form already has a sentence for is not given the field's general
 * one a second time, and an issue belonging to no field is left to the sentence
 * the form states beside the box that fixes it.
 */
function creationFaultsOf(
  issues: readonly { readonly path: readonly PropertyKey[] }[],
  stated: readonly CreationFault[],
): readonly CreationFault[] {
  const named = new Set(stated.map((fault) => fault.field));
  const fields = new Set(
    issues
      .map((issue) => creationFieldOf(issue.path))
      .filter((field) => field !== undefined),
  );
  return [
    ...stated,
    ...[...fields]
      .filter((field) => !named.has(field))
      .map((field) => ({ field, reason: creationFaultSentence(field) })),
    ...creationOverrideFaultsOf(issues),
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
 * What a proposal needs that a push does not: a branch of its own, and a target
 * that is not it where it names one. A branch box the form already refuses for
 * its prefix earns no second fault, because the prefix is the edit to make
 * first and the pairing is decided on what the fixed box would name.
 */
function creationLandingFault(
  form: TicketCreationForm,
  branches: CreationBranches,
): CreationFault | undefined {
  if (!briefFinalizationProposes(form.landingMode)) return undefined;
  if (branches.branch.named === "Prefixed") return undefined;
  if (branches.target.named === "Prefixed") return undefined;
  if (branches.branch.named !== "Ref")
    return { field: "branch", reason: creationLandingBranchSentence };
  if (branches.target.named !== "Ref") return undefined;
  return briefLandingIsWhole({
    branch: branches.branch.ref,
    finalization: { mode: form.landingMode, target: branches.target.ref },
  })
    ? undefined
    : { field: "target", reason: creationLandingWholeSentence };
}

/**
 * The faults this form decides for itself, the wire's parser deciding the rest.
 *
 * A FORM STATES NO FAULT IN A BOX IT DOES NOT DRAW: a ticket landing nothing
 * is asked for no target and sends none, so a value left in the target box
 * from before that choice would stop a submission with no field on screen to
 * read the reason beside.
 */
function creationStatedFaults(
  form: TicketCreationForm,
  branches: CreationBranches,
  repositories: readonly ProjectRepositoryResponse[],
): readonly CreationFault[] {
  const stated: CreationFault[] = [];
  if (creationRepositoryRequired(repositories) && form.repository.trim() === "")
    stated.push({
      field: "repository",
      reason: creationFaultSentence("repository"),
    });
  if (branches.branch.named === "Prefixed")
    stated.push({ field: "branch", reason: creationBranchPrefixedSentence });
  if (form.landingMode === "None") return stated;
  if (branches.target.named === "Prefixed")
    stated.push({ field: "target", reason: creationBranchPrefixedSentence });
  const landing = creationLandingFault(form, branches);
  if (landing !== undefined) stated.push(landing);
  return stated;
}

/**
 * How this brief lands, sent explicitly on every submission — even where the
 * mode is the repository's own default — so the ticket records the landing it
 * was released with. `None` names no reference at all; every other mode names
 * one only where a target was typed, and a value left in the box `None` draws
 * none for is never sent.
 */
function creationFinalizationOf(
  form: TicketCreationForm,
  branches: CreationBranches,
): Record<string, unknown> {
  const mode = form.landingMode;
  if (mode === "None") return { finalization: { mode } };
  return {
    finalization: {
      mode,
      ...(branches.target.named === "Ref"
        ? { target: branches.target.ref }
        : {}),
    },
  };
}

/**
 * The brief a form becomes: no check lines or images rather than an empty
 * list, and no title rather than an empty one. Check lines typed under a
 * configuration that commands a stage for them are not sent under one that
 * commands none, which draws no box to read them in.
 */
function creationBriefOf(
  form: TicketCreationForm,
  branches: CreationBranches,
  checksCommanded: boolean,
): unknown {
  const checks = checksCommanded
    ? form.checks.map((check) => check.trim()).filter((check) => check !== "")
    : [];
  const title = form.title.trim();
  const repository = form.repository.trim();
  return {
    ...(title === "" ? {} : { title }),
    ...(repository === "" ? {} : { repository }),
    intent: creationIntentNormalized(form.intent).trim(),
    links: form.links.map((link) => link.trim()).filter((link) => link !== ""),
    ...(form.images.length === 0 ? {} : { images: [...form.images] }),
    ...(checks.length === 0 ? {} : { checks }),
    ...(branches.branch.named === "Ref" ? { branch: branches.branch.ref } : {}),
    ...creationFinalizationOf(form, branches),
  };
}

/**
 * What a form naming no offered configuration is told: that it names one, and
 * every fault its brief earns besides. Nothing is said of the authoring or the
 * fence, which are a configuration's and are not drawn without one.
 */
function creationUndrawnFaults(
  brief: unknown,
  stated: readonly CreationFault[],
): CreationAssembly {
  const parsed = draftCreationSchema.pick({ brief: true }).safeParse({ brief });
  const unnamed: CreationFault = {
    field: "configuration",
    reason: creationFaultSentence("configuration"),
  };
  return {
    assembled: "Faults",
    faults: creationFaultsOf(parsed.success ? [] : parsed.error.issues, [
      unnamed,
      ...stated,
    ]),
  };
}

/** The overrides a form sends, and no key at all where it holds none. */
function creationOverridesOf(form: TicketCreationForm): {
  readonly overrides?: unknown;
} {
  const overrides = overridesNestedOf(form.overrides);
  return overrides === undefined ? {} : { overrides };
}

/**
 * The whole creation body, fence and all, or every field a reader has to
 * revisit. The revision and the fence are those of the offer the form names,
 * so a body assembled from a stale one is refused by the API rather than
 * silently retargeted.
 */
export function creationBodyFrom(
  offers: readonly CreationOffer[],
  form: TicketCreationForm,
  repositories: readonly ProjectRepositoryResponse[],
): CreationAssembly {
  const drawn = creationOfferOf(offers, form.configuration)?.initialization;
  const branches = creationBranchesOf(form);
  const brief = creationBriefOf(
    form,
    branches,
    drawn?.commandedCheckStage !== undefined,
  );
  const stated = creationStatedFaults(form, branches, repositories);
  if (drawn === undefined) return creationUndrawnFaults(brief, stated);
  const candidate = {
    configurationRevision: drawn.configuration.revision,
    configurationDigest: drawn.fence.configurationDigest,
    expectedProjectSequence: drawn.fence.projectSequence,
    authoring: {
      dependencies: [...form.dependencies],
      program: [...form.program],
    },
    brief,
    ...creationOverridesOf(form),
  };
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

/** What creating a ticket does beyond making it, for the reader pressing: work
 * starts for one who dispatches, and waits on someone who does for one who may not. */
export function creationSubmitEffect(dispatches: boolean): string {
  return dispatches ? "Starts work" : "Released for a dispatcher to start";
}

/** What one submit does: releases a new ticket, releases one and goes on to
 * dispatch it, or releases a Pending one's next revision. */
export type CreationMotion = "Release" | "Start" | "Update";

/** The motion a creation's submit makes, which goes on to a dispatch for a
 * reader who may make one. */
export function creationSubmitMotion(dispatches: boolean): CreationMotion {
  return dispatches ? "Start" : "Release";
}

/** The motion's own words: what its release is called, what a submit says
 * while it sends it, and what the note reads once the release has settled. A
 * submit that goes on to dispatch reads there that the ticket is starting. */
function creationMotionWords(motion: CreationMotion): {
  readonly noun: string;
  readonly settled: string;
  readonly submitting: string;
} {
  switch (motion) {
    case "Release":
      return {
        noun: "release",
        settled: "released",
        submitting: "creating the draft and releasing it…",
      };
    case "Start":
      return { ...creationMotionWords("Release"), settled: "starting…" };
    case "Update":
      return {
        noun: "update",
        settled: "updated",
        submitting: "revising the draft and releasing the update…",
      };
  }
}

/** Where one submit has got to, for a screen that draws a line and not a log. */
export function creationStepSentence(
  step: OperationStep,
  motion: CreationMotion = "Release",
): string {
  const words = creationMotionWords(motion);
  switch (step.step) {
    case "Submitting":
      return words.submitting;
    case "Backlogged":
      return `the API is deferring this; trying again in ${String(step.retryAfterSeconds)}s`;
    case "Following":
      return `waiting for the actor to decide the ${words.noun}…`;
    case "Confirming":
      return `waiting for the project to catch up with the ${words.noun}…`;
    case "Settled":
      return step.state === "Succeeded"
        ? words.settled
        : operationStateSentence(step.state);
    case "Abandoned":
      return step.reason;
  }
}

/** A stage of the given width, its evaluators keyed densely from one, under
 * the key its position in the program gives it. */
export function creationStageOf(count: number, key: number): CreationStage {
  return {
    key,
    evaluators: Array.from({ length: count }, (_, index) => ({
      key: index + 1,
    })),
  };
}

export function creationStageLabel(stage: CreationStage): string {
  return String(stage.evaluators.length);
}
