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
  briefFinalizationOpensProposal,
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
import type { WorkloadOverride } from "../../../../src/contract/configurationOverrides.ts";
import type { ConfigurationSelection } from "../../../../src/contract/configurationSelection.ts";
import { draftCreationSchema } from "../../../../src/contract/requests.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import {
  bootstrapConfigurationName,
  bootstrapConfigurationRevisionPrefix,
} from "../../../../src/contract/responses.ts";
import type {
  ConfigurationSummary,
  DraftInitializationResponse,
  DraftResponse,
  ProjectRepositoryListedResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import type { z } from "zod";

import type { ApiFailure } from "./apiRequest.ts";
import { operationAbandonWords } from "./codeLabels.ts";
import {
  finalizationChoiceKey,
  finalizationChoiceOf,
  finalizationTargetOf,
  type FinalizationChoice,
} from "./finalizationChoice.ts";
import { operationStateSentence } from "./codeSentences.ts";
import {
  configurationCatalogInitialization,
  configurationCatalogOf,
  configurationCatalogSelected,
  type ConfigurationCatalog,
} from "./configurationCatalog.ts";
import { configurationCommitShort, configurationLabel } from "./labels.ts";
import type { OperationStep } from "./operationFollow.ts";
import { projectAbilityRefused } from "./projectAbilities.ts";
import type {
  ProjectAbilities,
  ProjectAbilityRead,
} from "./projectAbilities.ts";
import { programPlanned, programShort } from "./programPlan.ts";
import { repositoryLabel } from "./projectRepositories.ts";
import { repositoryConfigurations } from "./repositoryConfigurations.ts";
import { sessionRunnerShortWord } from "./sessionRunners.ts";
import { threadUploadRefused } from "./threads.ts";
import {
  overrideFieldKind,
  overrideFieldLabel,
  overrideFields,
  overridesNestedOf,
  overridesSame,
} from "./ticketOverrides.ts";
import type { CreationOverrides, OverrideField } from "./ticketOverrides.ts";
import { draftReleaseAction } from "./ticketActions.ts";
import type { WorkRunner } from "./workRunner.ts";
import type { Copy } from "./copy.ts";

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
  /** How this ticket is finalized, but for its target, seeded from the
   * repository's default and the reader's from the moment they move it. */
  readonly finalization: FinalizationChoice;
  /** What this ticket replaces of its configuration, drawn only once a
   * configuration is chosen and kept when another is; sent only under a
   * configuration that is no catalog. */
  readonly overrides: CreationOverrides;
  /** What this ticket selects from a catalog, a field left out taking the
   * catalog's default; sent only under a catalog, and cleared when another
   * configuration is chosen, whose names are its own. */
  readonly selection: ConfigurationSelection;
  /** What this ticket replaces of each catalog workload, by the name the
   * catalog holds it under; sent only under a catalog, and cleared with the
   * selection. */
  readonly workloads: Readonly<Record<string, WorkloadOverride>>;
  /** The epic this ticket joins as it is made, by number, empty where it joins none. */
  readonly epic: string;
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
  | "finalization"
  | "repository"
  | "authoring"
  | "overrides"
  | "fence";

export interface CreationFault {
  readonly field: CreationField;
  /** The overridden field an `overrides` fault is stated at. */
  readonly override?: OverrideField;
  readonly reason: Copy;
}

export type CreationAssembly =
  | {
      readonly assembled: "Body";
      readonly body: z.infer<typeof draftCreationSchema>;
    }
  | { readonly assembled: "Faults"; readonly faults: readonly CreationFault[] };

/**
 * The newest revision this project has ready that is no bootstrap, which
 * releases only in the repository it was authored for. The list arrives newest
 * first, so the first such is the latest, and a project with none is a state
 * to draw rather than a choice to offer.
 */
export function latestReadyConfiguration(
  configurations: readonly ConfigurationSummary[],
): ConfigurationSummary | undefined {
  return configurations.find(
    (summary) =>
      summary.readiness === "Ready" && !creationBootstrapIs(summary.revision),
  );
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

/** One bootstrap a live binding is released under, beside the repository it is that binding's for. */
interface CreationBootstrap {
  readonly revision: string;
  readonly repository: string;
}

/**
 * What the project holds for its live bindings, as the listing of them says:
 * the ones whose repositories declared names into it, and the bootstrap
 * revisions the ones declaring none are released under, each once.
 */
function creationHeld(
  repositories: readonly ProjectRepositoryListedResponse[],
): {
  readonly imported: readonly ProjectRepositoryListedResponse[];
  readonly bootstraps: readonly CreationBootstrap[];
} {
  const live = creationRepositories(repositories);
  const bootstraps = live.flatMap(({ repository, configurationsHeld: held }) =>
    held?.result === "Bootstrapped"
      ? [{ revision: held.revision, repository }]
      : [],
  );
  return {
    imported: live.filter(
      (binding) => binding.configurationsHeld?.result === "Imported",
    ),
    bootstraps: bootstraps.filter(
      (bootstrap, index) =>
        bootstraps.findIndex((one) => one.revision === bootstrap.revision) ===
        index,
    ),
  };
}

/**
 * The name one bootstrap is offered by: the bootstrap's own where it is the
 * only one, and beside its repository where several are — short where that
 * tells them apart, whole where two shorten alike.
 */
function creationBootstrapName(
  bootstrap: CreationBootstrap,
  bootstraps: readonly CreationBootstrap[],
): string {
  if (bootstraps.length === 1) return bootstrapConfigurationName;
  const short = repositoryLabel(bootstrap.repository);
  const apart = bootstraps.every(
    (other) =>
      other === bootstrap || repositoryLabel(other.repository) !== short,
  );
  return `${bootstrapConfigurationName} · ${apart ? short : bootstrap.repository}`;
}

/**
 * The configurations a new ticket may be drawn under, by name and in name
 * order: what the newest commit of each live binding that declares has ready,
 * and the bootstrap of each that declares nothing. A project whose live
 * bindings hold neither has its newest ready revision that is no bootstrap
 * and nothing else, whichever binding that came from.
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
  const bootstrapsNamed = bootstraps.map((bootstrap) => ({
    name: creationBootstrapName(bootstrap, bootstraps),
    revision: bootstrap.revision,
    listed: undefined,
  }));
  const offered: readonly CreationOfferListed[] = [
    ...listed.map((one) => ({
      name: creationOfferName(
        one,
        listed,
        bootstrapsNamed.map(({ name }) => name),
      ),
      revision: one.revision,
      listed: one,
    })),
    ...bootstrapsNamed,
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

/** The catalog an offer is, none where it is a version 1 configuration. */
export function creationCatalogOf(
  offer: CreationOffer | undefined,
): ConfigurationCatalog | undefined {
  return offer === undefined
    ? undefined
    : configurationCatalogOf(offer.initialization.configuration.canonical);
}

/** The offer a form is drawn under, with its initialization as it reads under the form's selection. */
export function creationOfferDrawn(
  offers: readonly CreationOffer[],
  form: Pick<TicketCreationForm, "configuration" | "selection">,
): CreationOffer | undefined {
  const offer = creationOfferOf(offers, form.configuration);
  return offer === undefined
    ? undefined
    : {
        ...offer,
        initialization: configurationCatalogInitialization(
          offer.initialization,
          form.selection,
        ),
      };
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

/** A line a screen draws, and the value in full that hovering it reveals. */
export interface CreationLine {
  readonly text: Copy;
  readonly title: string;
}

/**
 * The line a screen draws for a configuration it did not ask about, with the
 * commit it was imported from where the listing says one, and the revision
 * itself on hover.
 */
export function creationConfigurationLabel(offer: CreationOffer): CreationLine {
  const held = offer.initialization.configuration;
  const version = offer.listed?.version ?? held.version;
  const label =
    version === undefined && offer.listed === undefined
      ? { text: offer.name, title: held.revision }
      : configurationLabel(held.revision, version);
  const commit =
    offer.listed === undefined
      ? undefined
      : configurationCommitShort(offer.listed.provenance);
  return {
    text:
      commit === undefined
        ? {
            id: "ticket-authoring-configuration-line",
            args: { name: label.text },
          }
        : {
            id: "ticket-authoring-configuration-line-commit",
            args: { name: label.text, commit },
          },
    title: label.title,
  };
}

/**
 * What a ticket on the bootstrap is for, which is the one thing it can do:
 * write the repository's own configuration. An authored bootstrap is known by
 * its revision, a repository's named for it and a project's from before each
 * repository had its own being the bootstrap's name, and an imported one by the
 * name it was declared under.
 */
export function creationBootstrapLine(offer: CreationOffer): Copy | undefined {
  const name =
    offer.listed === undefined
      ? offer.initialization.configuration.revision
      : creationConfigurationName(offer.listed);
  return creationBootstrapIs(name)
    ? { id: "ticket-authoring-bootstrap" }
    : undefined;
}

/** Whether a revision or a declared name is a bootstrap's. */
function creationBootstrapIs(name: string): boolean {
  return (
    name === bootstrapConfigurationName ||
    name.startsWith(bootstrapConfigurationRevisionPrefix)
  );
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

/** How this console finalizes work where no binding says otherwise, which is a
 * form in a project that binds nothing and a repository the listing no longer
 * holds. */
const creationFinalizationUnbound: FinalizationChoice = {
  kind: "GitMerge",
  mode: "Push",
  policy: "Direct",
};

/** The finalization the chosen repository defaults to, which is what an
 * untouched field shows and what a repository change re-seeds it with. */
export function creationFinalizationDefault(
  repositories: readonly ProjectRepositoryResponse[],
  repository: string,
): FinalizationChoice {
  const bound = repositories.find((row) => row.repository === repository);
  return bound?.finalization ?? creationFinalizationUnbound;
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
    repository,
    ...creationFinalizationSeed(offers, repositories, {
      configuration,
      selection: {},
      repository,
    }),
    overrides: {},
    selection: {},
    workloads: {},
    epic: "",
  };
}

/** A form's finalization as a reader sees it: its choice, and the text of its target box. */
type CreationFinalization = Pick<
  TicketCreationForm,
  "finalization" | "targetBranchName"
>;

/**
 * The finalization a form is seeded with: the one the finalizer its selection
 * lands with names, which the ticket takes where its brief names none, and
 * otherwise its repository's, with no target.
 */
function creationFinalizationSeed(
  offers: readonly CreationOffer[],
  repositories: readonly ProjectRepositoryResponse[],
  form: Pick<TicketCreationForm, "configuration" | "selection" | "repository">,
): CreationFinalization {
  const catalog = creationCatalogOf(
    creationOfferOf(offers, form.configuration),
  );
  const finalizer =
    catalog === undefined
      ? undefined
      : configurationCatalogSelected(catalog, form.selection).finalization;
  const finalization = catalog?.finalizers.find(
    (each) => each.name === finalizer,
  )?.finalization;
  if (finalization === undefined)
    return {
      finalization: creationFinalizationDefault(repositories, form.repository),
      targetBranchName: "",
    };
  const target = finalizationTargetOf(finalization) ?? "";
  return {
    finalization: finalizationChoiceOf(finalization),
    targetBranchName: target.startsWith(briefBranchPrefix)
      ? target.slice(briefBranchPrefix.length)
      : target,
  };
}

/**
 * A form with something its finalization is seeded from changed: a
 * finalization the reader has not moved from the seed takes the new one, and a
 * moved one stands, because the seed is a starting point and the choice is
 * theirs.
 */
function creationFinalizationReseeded(
  form: TicketCreationForm,
  changed: TicketCreationForm,
  offers: readonly CreationOffer[],
  repositories: readonly ProjectRepositoryResponse[],
): TicketCreationForm {
  const seeded = creationFinalizationSeed(offers, repositories, form);
  const unmoved =
    finalizationChoiceKey(form.finalization) ===
      finalizationChoiceKey(seeded.finalization) &&
    form.targetBranchName === seeded.targetBranchName;
  return unmoved
    ? {
        ...changed,
        ...creationFinalizationSeed(offers, repositories, changed),
      }
    : changed;
}

/** The form with another repository named, its finalization reseeded where unmoved. */
export function creationRepositoryChosen(
  form: TicketCreationForm,
  repositories: readonly ProjectRepositoryResponse[],
  repository: string,
  offers: readonly CreationOffer[],
): TicketCreationForm {
  return creationFinalizationReseeded(
    form,
    { ...form, repository },
    offers,
    repositories,
  );
}

/** A program as the widths of its stages, which is all one differs from
 * another by: every key in it is its position. */
function creationProgramWidths(program: readonly CreationStage[]): string {
  return program.map((stage) => String(stage.evaluators.length)).join(",");
}

/**
 * The form drawn under another configuration or selection. A program or a
 * finalization the reader has not moved takes the new default and a moved one
 * stands, as under another repository; everything typed is kept.
 */
function creationDrawnChosen(
  form: TicketCreationForm,
  offers: readonly CreationOffer[],
  drawn: Pick<TicketCreationForm, "configuration" | "selection">,
  repositories: readonly ProjectRepositoryResponse[],
): TicketCreationForm {
  const seeded =
    creationOfferDrawn(offers, form)?.initialization.defaults ??
    creationAuthoringUndrawn;
  const chosen =
    creationOfferDrawn(offers, drawn)?.initialization.defaults ??
    creationAuthoringUndrawn;
  const unmoved =
    creationProgramWidths(form.program) ===
    creationProgramWidths(seeded.program);
  return creationFinalizationReseeded(
    form,
    { ...form, ...drawn, program: unmoved ? chosen.program : form.program },
    offers,
    repositories,
  );
}

/** The form with another configuration named, and no selection, whose names were the last one's. */
export function creationConfigurationChosen(
  form: TicketCreationForm,
  offers: readonly CreationOffer[],
  name: string,
  repositories: readonly ProjectRepositoryResponse[],
): TicketCreationForm {
  return {
    ...creationDrawnChosen(
      form,
      offers,
      { configuration: name, selection: {} },
      repositories,
    ),
    workloads: {},
  };
}

/** The form with another selection from the catalog it is drawn under. */
export function creationSelectionChosen(
  form: TicketCreationForm,
  offers: readonly CreationOffer[],
  selection: ConfigurationSelection,
  repositories: readonly ProjectRepositoryResponse[],
): TicketCreationForm {
  return creationDrawnChosen(
    form,
    offers,
    { configuration: form.configuration, selection },
    repositories,
  );
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

/** The longest name a creation proposes, which is one a person reads in a
 * list of branches and far short of the longest the wire admits. */
export const creationBranchProposedCharsMax = 48;

/**
 * A branch name made of a title: its letters and digits in any script,
 * lowercased, each run of anything else one hyphen, and cut at the end of a
 * word where it would pass the bound. It is empty where the title holds none.
 */
export function creationBranchNameOf(title: string): string {
  const words =
    title
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const points = Array.from(words.join("-"));
  if (points.length <= creationBranchProposedCharsMax) return points.join("");
  const cut = points.slice(0, creationBranchProposedCharsMax).join("");
  const wordEnd =
    points[creationBranchProposedCharsMax] === "-"
      ? cut.length
      : cut.lastIndexOf("-");
  return wordEnd > 0 ? cut.slice(0, wordEnd) : cut;
}

/** The branch a creation proposes: under a finalization that opens a pull
 * request, for a box left empty, where the title has a name in it. */
export function creationBranchProposed(
  form: TicketCreationForm,
): string | undefined {
  if (!briefFinalizationOpensProposal(form.finalization)) return undefined;
  if (form.branchName !== "") return undefined;
  const name = creationBranchNameOf(form.title);
  return name === "" ? undefined : name;
}

/** The form a creation sends: the one it holds, with the branch it proposes
 * in the box left empty for it. */
export function creationFormProposed(
  form: TicketCreationForm,
): TicketCreationForm {
  const branchName = creationBranchProposed(form);
  return branchName === undefined ? form : { ...form, branchName };
}

/** What the branch key asks for and what naming it does, which the YAML editor explains the key with. */
export const creationBranchHint: Copy = {
  id: "ticket-authoring-branch-hint",
  args: { prefix: briefBranchPrefix },
};

/** Where the work lands when the target box is left empty, which each
 * finalization answers for itself. */
function creationTargetBranchUnnamed(finalization: FinalizationChoice): Copy {
  if (finalization.kind === "None")
    return { id: "ticket-authoring-target-unnamed-none" };
  return briefFinalizationOpensProposal(finalization)
    ? { id: "ticket-authoring-target-unnamed-default" }
    : { id: "ticket-authoring-target-unnamed-worked" };
}

/** The same, for the key that names where the work ends up instead. */
export function creationTargetBranchHint(
  finalization: FinalizationChoice,
): Copy {
  return {
    id: "ticket-authoring-target-hint",
    args: {
      prefix: briefBranchPrefix,
      unnamed: creationTargetBranchUnnamed(finalization),
    },
  };
}

/** The line under the form's branch box. */
export const creationBranchFieldHint: Copy = {
  id: "ticket-authoring-branch-field-hint",
};

/** The line under the form's target box: what leaving it empty lands on. */
export function creationTargetBranchFieldHint(
  finalization: FinalizationChoice,
): Copy {
  if (finalization.kind === "None")
    return { id: "ticket-authoring-target-field-none" };
  return briefFinalizationOpensProposal(finalization)
    ? { id: "ticket-authoring-target-field-default" }
    : { id: "ticket-authoring-target-field-above" };
}

/** The one input either branch field refuses, said as the edit that fixes it. */
export const creationBranchPrefixedSentence: Copy = {
  id: "ticket-authoring-branch-prefixed",
  args: { prefix: briefBranchPrefix },
};

/** The bound on a ticket's images, said where an attachment would pass it. */
export const creationImagesBoundSentence: Copy = {
  id: "ticket-authoring-images-bound",
  args: { count: String(briefImagesMax) },
};

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
): { readonly taken: readonly T[]; readonly refused?: Copy } {
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
      refused: {
        id: "ticket-authoring-images-types",
        args: { types: creationImageTypesLabel },
      },
    };
  return { taken };
}

/** What an upload that failed is said as: the upload's own refusal, and that
 * nothing was attached. */
export function creationImageUploadSentence(failure: ApiFailure): Copy {
  const cause = threadUploadRefused(failure).cause;
  return cause === undefined
    ? { id: "ticket-authoring-image-unattached" }
    : { id: "ticket-authoring-image-unattached-cause", args: { cause } };
}

/** What a proposal is opened from, which is the one box a push may leave empty. */
export const creationLandingBranchSentence: Copy = {
  id: "ticket-authoring-landing-branch",
};

/** What `briefLandingIsWhole` refuses, said as the two boxes that fix it. */
export const creationLandingWholeSentence: Copy = {
  id: "ticket-authoring-landing-whole",
};

/**
 * What this form checked and the reader has to satisfy, and no more than that.
 * The grammar a reference name obeys is not among them — the contract carries
 * no statement of it, so a name the server's grammar refuses is refused there.
 */
export function creationFaultSentence(field: CreationField): Copy {
  switch (field) {
    case "configuration":
      return { id: "ticket-authoring-fault-configuration" };
    case "title":
      return {
        id: "ticket-authoring-fault-title",
        args: { chars: String(briefTitleCharsMax) },
      };
    case "intent":
      return {
        id: "ticket-authoring-fault-intent",
        args: { chars: String(briefIntentCharsMax) },
      };
    case "links":
      return {
        id: "ticket-authoring-fault-links",
        args: {
          scheme: briefLinkScheme,
          chars: String(briefLineCharsMax),
          count: String(briefLinksMax),
        },
      };
    case "images":
      return creationImagesBoundSentence;
    case "checks":
      return {
        id: "ticket-authoring-fault-checks",
        args: {
          chars: String(briefLineCharsMax),
          count: String(briefChecksMax),
        },
      };
    case "branch":
    case "target":
      return {
        id: "ticket-authoring-fault-branch",
        args: {
          prefix: briefBranchPrefix,
          chars: String(briefBranchCharsMax),
        },
      };
    case "finalization":
      return { id: "ticket-authoring-fault-landing" };
    case "repository":
      return { id: "ticket-authoring-fault-repository" };
    case "authoring":
      return { id: "ticket-authoring-fault-authoring" };
    case "overrides":
      return { id: "ticket-authoring-fault-overrides" };
    case "fence":
      return { id: "ticket-authoring-fault-fence" };
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
  if (path[0] === "selection") return "configuration";
  if (path[0] !== "brief") return "fence";
  if (path[1] === "title") return "title";
  if (path[1] === "intent") return "intent";
  if (path[1] === "branch") return "branch";
  if (path[1] === "checks") return "checks";
  if (path[1] === "images") return "images";
  if (path[1] === "repository") return "repository";
  if (path[1] === "finalization")
    return path[2] === "target" ? "target" : "finalization";
  return path[1] === undefined ? undefined : "links";
}

/** What an overridden field the contract refuses is told, by how it is edited. */
export function creationOverrideFaultSentence(field: OverrideField): Copy {
  switch (overrideFieldKind(field)) {
    case "Mode":
      return { id: "ticket-authoring-fault-override-mode" };
    case "Lines":
      return { id: "ticket-authoring-fault-override-lines" };
    case "Files":
      return { id: "ticket-authoring-fault-override-files" };
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
          reason: {
            id: "ticket-authoring-fault-override",
            args: {
              field: overrideFieldLabel(override),
              reason: creationOverrideFaultSentence(override),
            },
          },
        },
  );
}

/**
 * The paths one issue is about, a union refused as a whole being the issues of
 * the option it came closest to matching, each under the union's own path, so
 * a target too long for a finalization is the target's and not the
 * finalization's. The recursion is bounded by the depth of the issue.
 */
function creationIssuePaths(
  issue: z.core.$ZodIssue,
  at: readonly PropertyKey[],
): readonly (readonly PropertyKey[])[] {
  const path = [...at, ...issue.path];
  if (issue.code !== "invalid_union") return [path];
  const closest = issue.errors.reduce<readonly z.core.$ZodIssue[] | undefined>(
    (best, option) =>
      best === undefined || option.length < best.length ? option : best,
    undefined,
  );
  return closest === undefined || closest.length === 0
    ? [path]
    : closest.flatMap((option) => creationIssuePaths(option, path));
}

/**
 * The faults a field earns, with the ones this form stated itself first: a
 * field the form already has a sentence for is not given the field's general
 * one a second time, and an issue belonging to no field is left to the sentence
 * the form states beside the box that fixes it.
 */
function creationFaultsOf(
  issues: readonly z.core.$ZodIssue[],
  stated: readonly CreationFault[],
): readonly CreationFault[] {
  const named = new Set(stated.map((fault) => fault.field));
  const fields = new Set(
    issues
      .flatMap((issue) => creationIssuePaths(issue, []))
      .map((path) => creationFieldOf(path))
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
  if (!briefFinalizationOpensProposal(form.finalization)) return undefined;
  if (branches.branch.named === "Prefixed") return undefined;
  if (branches.target.named === "Prefixed") return undefined;
  if (branches.branch.named !== "Ref")
    return { field: "branch", reason: creationLandingBranchSentence };
  if (branches.target.named !== "Ref") return undefined;
  return briefLandingIsWhole({
    branch: branches.branch.ref,
    finalization: { ...form.finalization, target: branches.target.ref },
  })
    ? undefined
    : { field: "target", reason: creationLandingWholeSentence };
}

/**
 * The faults this form decides for itself, the wire's parser deciding the rest.
 *
 * A FORM STATES NO FAULT IN A BOX IT DOES NOT DRAW: a ticket finalized by `None`
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
  if (form.finalization.kind === "None") return stated;
  if (branches.target.named === "Prefixed")
    stated.push({ field: "target", reason: creationBranchPrefixedSentence });
  const landing = creationLandingFault(form, branches);
  if (landing !== undefined) stated.push(landing);
  return stated;
}

/**
 * How this brief is finalized, sent explicitly on every submission — even
 * where it is the repository's own default — so the ticket records the
 * finalization it was released with. `None` names no reference at all, and
 * every other kind names one only where a target was typed, so a value left in
 * the box where the kind draws none is never sent.
 */
function creationFinalizationOf(
  form: TicketCreationForm,
  branches: CreationBranches,
): Record<string, unknown> {
  const finalization = form.finalization;
  if (finalization.kind === "None") return { finalization };
  return {
    finalization: {
      ...finalization,
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

/**
 * What a form sends of its configuration's own choices: the selection and the
 * workloads it overrides under a catalog, and the overrides under any other
 * configuration, each with no key at all where it holds none.
 */
function creationChoicesOf(
  form: TicketCreationForm,
  offer: CreationOffer | undefined,
): { readonly overrides?: unknown; readonly selection?: unknown } {
  if (creationCatalogOf(offer) !== undefined)
    return {
      ...(Object.keys(form.selection).length === 0
        ? {}
        : { selection: form.selection }),
      ...(Object.keys(form.workloads).length === 0
        ? {}
        : { overrides: { workloads: form.workloads } }),
    };
  const overrides = overridesNestedOf(form.overrides);
  return overrides === undefined ? {} : { overrides };
}

/**
 * What a reader's role lets a form send: overrides, beside what the draft
 * already holds of them, and a program that runs less than its plan.
 */
export interface AuthoringStanding {
  readonly mayOverride: boolean;
  /** The overrides the draft holds, none for a ticket not yet made. */
  readonly held?: unknown;
  /** Whether the reader may release a program that leaves out part of its
   * plan; absent, they may. */
  readonly maySkipPlanned?: boolean;
}

/** What the abilities read lets a form send: everything it has not said no to. */
export function creationStandingOf(
  abilities: ProjectAbilities,
): AuthoringStanding {
  return {
    mayOverride: !projectAbilityRefused(abilities, "overrideTicketConfig"),
    maySkipPlanned: !projectAbilityRefused(abilities, "skipPlannedEvaluations"),
  };
}

const overridesRefusedReason: Copy = {
  id: "ticket-authoring-overrides-refused",
};

/** The fault of overrides a reader who may not override is changing, if it is one. */
function creationOverridesFaults(
  overrides: unknown,
  standing: AuthoringStanding | undefined,
): readonly CreationFault[] {
  if (
    standing === undefined ||
    standing.mayOverride ||
    overrides === undefined ||
    overridesSame(overrides, standing.held)
  )
    return [];
  return [{ field: "overrides", reason: overridesRefusedReason }];
}

const programShortReason: Copy = { id: "ticket-authoring-program-short" };

/** The fault of a program running less than its plan, for a reader who may not release one. */
function creationProgramFaults(
  drawn: DraftInitializationResponse,
  program: TicketCreationForm["program"],
  standing: AuthoringStanding | undefined,
): readonly CreationFault[] {
  if (
    standing?.maySkipPlanned !== false ||
    !programShort(programPlanned(drawn), program)
  )
    return [];
  return [{ field: "authoring", reason: programShortReason }];
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
  standing?: AuthoringStanding,
): CreationAssembly {
  const offer = creationOfferDrawn(offers, form);
  const drawn = offer?.initialization;
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
    ...creationChoicesOf(form, offer),
    ...(form.epic === "" ? {} : { epic: Number(form.epic) }),
  };
  const parsed = draftCreationSchema.safeParse(candidate);
  const refused = [
    ...creationOverridesFaults(
      parsed.success ? parsed.data.overrides : undefined,
      standing,
    ),
    ...creationProgramFaults(drawn, form.program, standing),
  ];
  if (parsed.success && stated.length === 0 && refused.length === 0)
    return { assembled: "Body", body: parsed.data };
  const issues = parsed.success ? [] : parsed.error.issues;
  return {
    assembled: "Faults",
    faults: [...creationFaultsOf(issues, stated), ...refused],
  };
}

/** The mutation that turns the draft just created into a ticket the machine runs. */
export function creationReleaseMutation(draft: DraftResponse): PublicMutation {
  return draftReleaseAction(draft).mutation;
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

/** What a creation's press goes on to once its ticket is released: a start, no
 * more than the release, or no more because the work has no runner to go to. */
export type CreationStart = "Starts" | "Waits" | "NoRunner";

/**
 * What one press goes on to. It starts work only for a reader who may dispatch
 * in a project whose work has somewhere to run, and until both are read it
 * waits, as it does for a reader who may not.
 */
export function creationStart(
  dispatch: ProjectAbilityRead,
  runner: WorkRunner,
): CreationStart {
  if (dispatch !== "Asked" || runner === "Held") return "Waits";
  return runner === "NoRunner" ? "NoRunner" : "Starts";
}

/** What creating a ticket does beyond making it, for the reader pressing: work
 * starts, waits on someone who dispatches, or has no runner to start on. */
export function creationSubmitEffect(start: CreationStart): Copy {
  switch (start) {
    case "Starts":
      return { id: "ticket-authoring-effect-starts" };
    case "Waits":
      return { id: "ticket-authoring-effect-waits" };
    case "NoRunner":
      return sessionRunnerShortWord("NoRunner");
  }
}

/** What one submit does: releases a new ticket, releases one and goes on to
 * dispatch it, or releases a Pending one's next revision. */
export type CreationMotion = "Release" | "Start" | "Update";

/** The motion a creation's submit makes, which goes on to a dispatch only
 * where the press starts work. */
export function creationSubmitMotion(start: CreationStart): CreationMotion {
  return start === "Starts" ? "Start" : "Release";
}

/** The motion's own words: what a submit says while it sends its release,
 * while the actor decides it and while the project catches up with it, and
 * what the note reads once it has settled. A submit that goes on to dispatch
 * reads there that the ticket is starting. */
function creationMotionWords(motion: CreationMotion): {
  readonly submitting: Copy;
  readonly following: Copy;
  readonly confirming: Copy;
  readonly settled: Copy;
} {
  switch (motion) {
    case "Release":
      return {
        submitting: { id: "ticket-authoring-step-submitting-release" },
        following: { id: "ticket-authoring-step-following-release" },
        confirming: { id: "ticket-authoring-step-confirming-release" },
        settled: { id: "ticket-authoring-step-released" },
      };
    case "Start":
      return {
        ...creationMotionWords("Release"),
        settled: { id: "ticket-authoring-step-starting" },
      };
    case "Update":
      return {
        submitting: { id: "ticket-authoring-step-submitting-update" },
        following: { id: "ticket-authoring-step-following-update" },
        confirming: { id: "ticket-authoring-step-confirming-update" },
        settled: { id: "ticket-authoring-step-updated" },
      };
  }
}

/** Where one submit has got to, for a screen that draws a line and not a log. */
export function creationStepSentence(
  step: OperationStep,
  motion: CreationMotion = "Release",
): Copy {
  const words = creationMotionWords(motion);
  switch (step.step) {
    case "Submitting":
      return words.submitting;
    case "Backlogged":
      return {
        id: "ticket-authoring-step-backlogged",
        args: { seconds: String(step.retryAfterSeconds) },
      };
    case "Following":
      return words.following;
    case "Confirming":
      return words.confirming;
    case "Settled":
      return step.state === "Succeeded"
        ? words.settled
        : operationStateSentence(step.state);
    case "Abandoned":
      return operationAbandonWords(step.cause).word;
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
