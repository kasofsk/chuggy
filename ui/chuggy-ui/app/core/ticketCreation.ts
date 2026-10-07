/**
 * What creating a ticket decides: which configuration shapes it, and the body
 * one form's contents become.
 *
 * WHICH CONFIGURATION IS THE READER'S TO SAY. A configuration is who does the
 * work, so a project offering several is asked which, and a form naming none
 * sends nothing; only a sole offer of a read that missed none is taken unasked.
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
  briefIntentCharsMax,
  briefLandingIsWhole,
  briefLineCharsMax,
  briefLinkScheme,
  briefLinksMax,
  briefTitleCharsMax,
} from "../../../../src/contract/brief.ts";
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
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import type { z } from "zod";

import { operationStateSentence } from "./codeSentences.ts";
import { configurationCommitShort, configurationLabel } from "./labels.ts";
import type { Label } from "./labels.ts";
import type { OperationStep } from "./operationFollow.ts";
import { repositoryLabel } from "./projectRepositories.ts";
import { repositoryConfigurations } from "./repositoryConfigurations.ts";

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
  | "configuration"
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

/** An offer before its initialization is read: a listed revision, and the name
 * a reader chooses it by. */
export interface CreationOfferListed {
  readonly name: string;
  readonly listed: ConfigurationSummary;
}

/**
 * One configuration a ticket may be drawn under, and the initialization that
 * defaults and fences a form drawn under it.
 */
export interface CreationOffer {
  /** What a reader chooses it by, which is what the form holds once they have. */
  readonly name: string;
  /** Its row in the listing, which a revision only a draft still holds has not. */
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
 * them apart, whole where the two shorten alike.
 */
function creationOfferName(
  configuration: ConfigurationSummary,
  offered: readonly ConfigurationSummary[],
): string {
  const apart = creationNameSpellings.find((spelling) =>
    offered.every(
      (other) =>
        other === configuration || spelling(other) !== spelling(configuration),
    ),
  );
  return (apart ?? creationConfigurationName)(configuration);
}

/**
 * The project's own bootstrap where it stands ready, which is the revision its
 * name itself is. No repository declared it, so it is what a ticket for a
 * repository declaring nothing is released under, a declared revision
 * releasing for its own repository alone.
 */
function creationBootstrapAuthored(
  configurations: readonly ConfigurationSummary[],
): ConfigurationSummary | undefined {
  return configurations.find(
    (summary) =>
      summary.revision === bootstrapConfigurationName &&
      summary.readiness === "Ready",
  );
}

/**
 * The revisions a ticket may be drawn under, before they are named: what each
 * live binding's newest commit declares ready, and the project's bootstrap
 * beside them while one of those bindings declares nothing. A project where no
 * live binding declares one has its newest ready revision and nothing else,
 * whichever binding or author that came from.
 */
function creationConfigurationsDeclared(
  configurations: readonly ConfigurationSummary[],
  repositories: readonly ProjectRepositoryResponse[],
): readonly ConfigurationSummary[] {
  const held = creationRepositories(repositories).map((binding) =>
    repositoryConfigurations(configurations, binding.repository),
  );
  const declared = held.flat();
  if (declared.length === 0) {
    const newest = latestReadyConfiguration(configurations);
    return newest === undefined ? [] : [newest];
  }
  const ready = declared.filter((summary) => summary.readiness === "Ready");
  const bootstrap = held.some((rows) => rows.length === 0)
    ? creationBootstrapAuthored(configurations)
    : undefined;
  return bootstrap === undefined ? ready : [...ready, bootstrap];
}

/**
 * The configurations a new ticket may be drawn under, by name and in name
 * order. A name a repository's newest commit dropped is not among them, and
 * neither is what a retired binding declared while a live one declares any.
 */
export function creationConfigurationsOffered(
  configurations: readonly ConfigurationSummary[],
  repositories: readonly ProjectRepositoryResponse[],
): readonly CreationOfferListed[] {
  const offered = creationConfigurationsDeclared(configurations, repositories);
  return offered
    .map((listed) => ({ name: creationOfferName(listed, offered), listed }))
    .sort((left, right) => {
      if (left.name === right.name) return 0;
      return left.name < right.name ? -1 : 1;
    });
}

/**
 * Whether the listing read so far says all one binding declares now. Its
 * newest commit is whole once a row that is not its own follows it; a binding
 * with no row yet declares nothing once a row older than its bind is read,
 * since a repository is imported only after it is bound.
 */
function creationBindingDecided(
  configurations: readonly ConfigurationSummary[],
  binding: ProjectRepositoryResponse,
  newest: readonly ConfigurationSummary[],
): boolean {
  const last = configurations.at(-1);
  if (newest.length > 0) return newest.at(-1) !== last;
  return (
    last !== undefined &&
    Date.parse(last.createdAt) < Date.parse(binding.boundAt)
  );
}

/**
 * Whether the listing read so far already decides what is offered, so a walk
 * of it may stop: every live binding is decided, and where none of them
 * declares anything the project's first ready revision has been read.
 */
export function creationConfigurationsDecided(
  configurations: readonly ConfigurationSummary[],
  repositories: readonly ProjectRepositoryResponse[],
): boolean {
  const held = creationRepositories(repositories).map((binding) => ({
    binding,
    newest: repositoryConfigurations(configurations, binding.repository),
  }));
  const decided = held.every(({ binding, newest }) =>
    creationBindingDecided(configurations, binding, newest),
  );
  if (!decided) return false;
  return (
    held.some(({ newest }) => newest.length > 0) ||
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
export function creationRepositories(
  bound: readonly ProjectRepositoryResponse[],
): readonly ProjectRepositoryResponse[] {
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
  if (path[0] !== "brief") return "fence";
  if (path[1] === "title") return "title";
  if (path[1] === "intent") return "intent";
  if (path[1] === "branch") return "branch";
  if (path[1] === "checks") return "checks";
  if (path[1] === "repository") return "repository";
  if (path[1] === "finalization")
    return path[2] === "target" ? "target" : "landing";
  return path[1] === undefined ? undefined : "links";
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
 * The brief a form becomes: no check lines rather than an empty list, and no
 * title rather than an empty one. Check lines typed under a configuration that
 * commands a stage for them are not sent under one that commands none, which
 * draws no box to read them in.
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

/** What one submit releases: a new ticket, or a Pending one's next revision. */
export type CreationMotion = "Release" | "Update";

/** The motion's own words: what it is called, and what it is once settled. */
function creationMotionWords(motion: CreationMotion): {
  readonly noun: string;
  readonly done: string;
  readonly submitting: string;
} {
  switch (motion) {
    case "Release":
      return {
        noun: "release",
        done: "released",
        submitting: "creating the draft and releasing it…",
      };
    case "Update":
      return {
        noun: "update",
        done: "updated",
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
        ? words.done
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
