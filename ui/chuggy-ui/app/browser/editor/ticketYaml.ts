/**
 * A ticket form written as YAML, and YAML read back as one.
 *
 * THE YAML IS A VIEW OF THE FORM AND NOT A SECOND BRIEF. It carries the fields
 * the form draws and no others, so what one release sends is decided by the
 * same `creationBodyFrom` whichever way it was typed, and every fault a form
 * states is stated here at the key it belongs to rather than restated. A key
 * the form does not draw — checks where no stage is commanded, a repository in
 * a project that binds none — is refused rather than carried, because the form
 * would never send it and the reader could not see it there.
 *
 * THE CONFIGURATION IS READ FIRST, wherever its key is written, because it
 * decides which of the other keys the form draws: the checks, the dependencies
 * and the program are a configuration's. Under a text that names none they are
 * left unjudged, the one thing wrong with it being that it names none — and a
 * text writing one of them under none reads as no form, because the form it
 * would read as has nowhere to hold what they say.
 *
 * AN IMAGE IS WRITTEN AS THE IDENTITY ITS UPLOAD ANSWERED, never as bytes: the
 * form attaches, and the text may only keep or drop what the screen knows the
 * project holds, so an identity it does not know is refused at its key. The
 * key is the author's and no configuration's, so it is read under whichever
 * one the text names and under none.
 *
 * A KEY LEFT OUT IS EMPTY, except the three a form never leaves empty: the
 * landing and the dependencies keep what the form held, and so does a program
 * the reader moved, an unmoved one being the named configuration's default.
 *
 * This lives under `browser/` rather than `core/` because the parser is a
 * package the decision layer may not reach; everything here is still pure.
 */

import { Document, isMap, isScalar, isSeq, parseDocument, Scalar } from "yaml";
import type { Node, Pair, YAMLMap } from "yaml";

import type {
  DraftInitializationResponse,
  ProjectRepositoryResponse,
} from "../../../../../src/contract/responses.ts";
import { briefImagesMax } from "../../../../../src/contract/brief.ts";
import { briefFinalizationModes } from "../../../../../src/contract/rosters.ts";
import type { BriefFinalizationMode } from "../../../../../src/contract/rosters.ts";
import { landingEffect } from "../../core/codeLabels.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import {
  creationBranchHint,
  creationConfigurationAsked,
  creationConfigurationChosen,
  creationFaultSentence,
  creationOfferOf,
  creationStageOf,
  creationTargetBranchHint,
} from "../../core/ticketCreation.ts";
import type {
  CreationFault,
  CreationField,
  CreationOffer,
  CreationStage,
  TicketCreationForm,
} from "../../core/ticketCreation.ts";

/** What a document is read and written against: the project's offer, and the
 * form a key left out keeps its value from. */
export interface TicketYamlContext {
  readonly base: TicketCreationForm;
  readonly offers: readonly CreationOffer[];
  readonly repositories: readonly ProjectRepositoryResponse[];
  readonly dependenciesLocked: boolean;
  /** The project images this screen knows exist, which are the only ones the
   * text may name. */
  readonly images: readonly string[];
}

/** One thing wrong with the text, over the characters it is about. */
export interface TicketYamlProblem {
  readonly from: number;
  readonly to: number;
  readonly message: string;
}

export interface TicketYamlSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * What one text reads as: a form exactly where nothing is wrong with the
 * text, and where each top-level key sits, so a fault the form earns is drawn
 * at the key it names.
 */
export interface TicketYamlReading {
  readonly form: TicketCreationForm | undefined;
  readonly problems: readonly TicketYamlProblem[];
  readonly keys: ReadonlyMap<string, TicketYamlSpan>;
}

const ticketYamlLockedNote = " fixed once the ticket was released";

/** What the named configuration draws the form under, a name nothing offers
 * drawing it under nothing. */
function ticketYamlDrawn(
  context: TicketYamlContext,
  configuration: string,
): DraftInitializationResponse | undefined {
  return creationOfferOf(context.offers, configuration)?.initialization;
}

/** Whether the form asks which configuration, decided by the form the screen
 * opened on so the key does not come and go as the text is typed. */
function ticketYamlConfigurationOffered(context: TicketYamlContext): boolean {
  return creationConfigurationAsked(context.offers, context.base.configuration);
}

function ticketYamlRepositoryOffered(context: TicketYamlContext): boolean {
  return context.repositories.length > 0;
}

/** The keys a configuration decides whether the form draws at all. */
const ticketYamlConfigured: ReadonlySet<string> = new Set([
  "checks",
  "dependencies",
  "program",
]);

/** The keys this project's form draws under one configuration, in the order
 * it draws them. */
function ticketYamlKeys(
  context: TicketYamlContext,
  configuration: string,
  landing: BriefFinalizationMode,
): readonly string[] {
  const drawn = ticketYamlDrawn(context, configuration);
  return [
    ...(ticketYamlConfigurationOffered(context) ? ["configuration"] : []),
    "title",
    "intent",
    "links",
    "images",
    ...(drawn?.commandedCheckStage === undefined ? [] : ["checks"]),
    "branch",
    ...(ticketYamlRepositoryOffered(context) ? ["repository"] : []),
    "landing",
    ...(landing === "None" ? [] : ["target"]),
    ...(drawn === undefined ? [] : ["dependencies", "program"]),
  ];
}

/** The text a form reads as. */
export function ticketYamlOf(
  form: TicketCreationForm,
  context: TicketYamlContext,
): string {
  const values: Record<string, unknown> = {
    configuration: form.configuration,
    title: form.title,
    intent: form.intent,
    links: [...form.links],
    images: [...form.images],
    checks: [...form.checks],
    branch: form.branchName,
    repository: form.repository,
    landing: form.landingMode,
    target: form.targetBranchName,
    dependencies: [...form.dependencies],
    program: form.program.map((stage) => ({
      evaluators: stage.evaluators.length,
    })),
  };
  const shown = Object.fromEntries(
    ticketYamlKeys(context, form.configuration, form.landingMode).map((key) => [
      key,
      values[key],
    ]),
  );
  const document = new Document(shown);
  const intent = document.get("intent", true);
  if (isScalar(intent) && form.intent !== "")
    intent.type = Scalar.BLOCK_LITERAL;
  const dependencies = document.get("dependencies", true);
  if (isSeq(dependencies)) dependencies.flow = true;
  if (context.dependenciesLocked && isMap(document.contents)) {
    const pair = document.contents.items.find(
      (item) => isScalar(item.key) && item.key.value === "dependencies",
    );
    if (pair !== undefined && isScalar(pair.key))
      pair.key.commentBefore = ticketYamlLockedNote;
  }
  return document.toString({ lineWidth: 0 });
}

function ticketYamlSpanOf(node: Node | null | undefined): TicketYamlSpan {
  const range = node?.range;
  return range === undefined || range === null
    ? { from: 0, to: 0 }
    : { from: range[0], to: range[1] };
}

type TicketYamlTook<T> =
  | { readonly took: "Value"; readonly value: T }
  | { readonly took: "Problem"; readonly message: string };

function ticketYamlTook<T>(value: T): TicketYamlTook<T> {
  return { took: "Value", value };
}

function ticketYamlRefused<T>(message: string): TicketYamlTook<T> {
  return { took: "Problem", message };
}

/** A scalar as the text the form holds, nothing written reading as empty. */
function ticketYamlTextOf(node: unknown): TicketYamlTook<string> {
  if (node === null || node === undefined) return ticketYamlTook("");
  if (!isScalar(node))
    return ticketYamlRefused("write this as one line of text");
  const value = node.value;
  if (value === null) return ticketYamlTook("");
  if (typeof value === "object")
    return ticketYamlRefused("write this as one line of text");
  return ticketYamlTook(String(value as string | number | boolean));
}

function ticketYamlTextsOf(node: unknown): TicketYamlTook<readonly string[]> {
  if (node === null || node === undefined) return ticketYamlTook([]);
  if (isScalar(node) && node.value === null) return ticketYamlTook([]);
  if (!isSeq(node))
    return ticketYamlRefused("write this as a list, one entry a line");
  const texts: string[] = [];
  for (const item of node.items) {
    const text = ticketYamlTextOf(item);
    if (text.took === "Problem") return text;
    texts.push(text.value);
  }
  return ticketYamlTook(texts);
}

function ticketYamlWholeOf(node: unknown): number | undefined {
  if (!isScalar(node)) return undefined;
  const value = node.value;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function ticketYamlLandingOf(
  node: unknown,
): TicketYamlTook<BriefFinalizationMode> {
  const text = ticketYamlTextOf(node);
  if (text.took === "Problem") return text;
  const mode = briefFinalizationModes.find((held) => held === text.value);
  return mode === undefined
    ? ticketYamlRefused(`land as one of ${briefFinalizationModes.join(", ")}`)
    : ticketYamlTook(mode);
}

/** The configuration a text names: one of the offers, or none yet. */
function ticketYamlConfigurationOf(
  node: unknown,
  context: TicketYamlContext,
): TicketYamlTook<string> {
  const text = ticketYamlTextOf(node);
  if (text.took === "Problem" || text.value === "") return text;
  return creationOfferOf(context.offers, text.value) === undefined
    ? ticketYamlRefused(
        `name one of ${context.offers.map((offer) => offer.name).join(", ")}`,
      )
    : text;
}

function ticketYamlDependenciesOf(node: unknown): TicketYamlTook<number[]> {
  if (isScalar(node) && node.value === null) return ticketYamlTook([]);
  if (!isSeq(node))
    return ticketYamlRefused(
      "write the tickets this one waits for as a list of ticket numbers",
    );
  const numbers: number[] = [];
  for (const item of node.items) {
    const number = ticketYamlWholeOf(item);
    if (number === undefined)
      return ticketYamlRefused("a dependency is a ticket number");
    if (numbers.includes(number))
      return ticketYamlRefused(`ticket ${String(number)} is named twice`);
    numbers.push(number);
  }
  return ticketYamlTook(numbers);
}

function ticketYamlProgramOf(
  node: unknown,
  choices: DraftInitializationResponse["choices"],
): TicketYamlTook<CreationStage[]> {
  if (isScalar(node) && node.value === null) return ticketYamlTook([]);
  const shape = "write each stage as `- evaluators: <count>`";
  if (!isSeq(node)) return ticketYamlRefused(shape);
  if (node.items.length > choices.programStagesMax)
    return ticketYamlRefused(
      `a program has at most ${String(choices.programStagesMax)} stages here`,
    );
  const { evaluatorsMax } = choices;
  const stages: CreationStage[] = [];
  for (const item of node.items) {
    if (!isMap(item) || item.items.length !== 1)
      return ticketYamlRefused(shape);
    const count = ticketYamlWholeOf(item.get("evaluators", true));
    if (count === undefined) return ticketYamlRefused(shape);
    if (count > evaluatorsMax)
      return ticketYamlRefused(
        `a stage takes at most ${String(evaluatorsMax)} evaluators here`,
      );
    stages.push(creationStageOf(count, stages.length + 1));
  }
  return ticketYamlTook(stages);
}

function ticketYamlImagesOf(
  node: unknown,
  context: TicketYamlContext,
): TicketYamlTook<readonly string[]> {
  const read = ticketYamlTextsOf(node);
  if (read.took === "Problem") return read;
  if (read.value.length > briefImagesMax)
    return ticketYamlRefused(creationFaultSentence("images"));
  const unknown = read.value.find((image) => !context.images.includes(image));
  return unknown === undefined
    ? read
    : ticketYamlRefused(
        `\`${unknown}\` names no image attached to this ticket; attach images in the form`,
      );
}

function ticketYamlSameNumbers(
  a: readonly number[],
  b: readonly number[],
): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

type TicketYamlApplied = TicketYamlTook<TicketCreationForm>;

function ticketYamlInto<T>(
  reading: TicketYamlTook<T>,
  apply: (value: T) => TicketCreationForm,
): TicketYamlApplied {
  return reading.took === "Problem"
    ? reading
    : ticketYamlTook(apply(reading.value));
}

function ticketYamlNoKey(key: string): TicketYamlApplied {
  return ticketYamlRefused(`this form has no \`${key}\``);
}

/** The keys a configuration decides, each read against the one the form names. */
function ticketYamlConfiguredApplied(
  key: string,
  value: unknown,
  form: TicketCreationForm,
  context: TicketYamlContext,
): TicketYamlApplied {
  const drawn = ticketYamlDrawn(context, form.configuration);
  if (drawn === undefined) return ticketYamlNoKey(key);
  if (key === "checks")
    return ticketYamlInto(ticketYamlTextsOf(value), (checks) => ({
      ...form,
      checks,
    }));
  if (key === "program")
    return ticketYamlInto(
      ticketYamlProgramOf(value, drawn.choices),
      (program) => ({ ...form, program }),
    );
  const read = ticketYamlDependenciesOf(value);
  if (
    read.took === "Value" &&
    context.dependenciesLocked &&
    !ticketYamlSameNumbers(read.value, context.base.dependencies)
  )
    return ticketYamlRefused(
      "a released ticket's dependencies cannot change; put back what it had",
    );
  return ticketYamlInto(read, (dependencies) => ({ ...form, dependencies }));
}

/** Each key's reading, applied to the form it is building. The configuration
 * is already in that form, so its key is only judged here. */
function ticketYamlKeyApplied(
  key: string,
  value: unknown,
  form: TicketCreationForm,
  context: TicketYamlContext,
): TicketYamlApplied {
  const into = ticketYamlInto;
  switch (key) {
    case "configuration":
      return into(ticketYamlConfigurationOf(value, context), () => form);
    case "title":
      return into(ticketYamlTextOf(value), (title) => ({ ...form, title }));
    case "intent":
      return into(ticketYamlTextOf(value), (intent) => ({ ...form, intent }));
    case "links":
      return into(ticketYamlTextsOf(value), (links) => ({ ...form, links }));
    case "images":
      return into(ticketYamlImagesOf(value, context), (images) => ({
        ...form,
        images,
      }));
    case "branch":
      return into(ticketYamlTextOf(value), (branchName) => ({
        ...form,
        branchName,
      }));
    case "target":
      return into(ticketYamlTextOf(value), (targetBranchName) => ({
        ...form,
        targetBranchName,
      }));
    case "repository":
      return into(ticketYamlTextOf(value), (repository) => ({
        ...form,
        repository,
      }));
    case "landing":
      return into(ticketYamlLandingOf(value), (landingMode) => ({
        ...form,
        landingMode,
      }));
    case "checks":
    case "dependencies":
    case "program":
      return ticketYamlConfiguredApplied(key, value, form, context);
    default:
      return ticketYamlNoKey(key);
  }
}

/** The form every key left out reads as. */
function ticketYamlEmpty(base: TicketCreationForm): TicketCreationForm {
  return {
    ...base,
    title: "",
    intent: "",
    links: [],
    images: [],
    checks: [],
    branchName: "",
    targetBranchName: "",
    repository: "",
  };
}

function ticketYamlKeyNameOf(pair: Pair): string | undefined {
  return isScalar(pair.key) && typeof pair.key.value === "string"
    ? pair.key.value
    : undefined;
}

type TicketYamlPair = YAMLMap.Parsed["items"][number];

/** A text as its top-level pairs, or what is wrong with one that is not a map
 * of them. */
type TicketYamlParsed =
  | { readonly parsed: "Pairs"; readonly pairs: readonly TicketYamlPair[] }
  | {
      readonly parsed: "Problems";
      readonly problems: readonly TicketYamlProblem[];
    };

function ticketYamlParsed(text: string): TicketYamlParsed {
  const document = parseDocument(text, { prettyErrors: false });
  if (document.errors.length > 0)
    return {
      parsed: "Problems",
      problems: document.errors.map((error) => ({
        from: error.pos[0],
        to: error.pos[1],
        message: error.message,
      })),
    };
  const contents = document.contents;
  if (contents === null) return { parsed: "Pairs", pairs: [] };
  if (isMap(contents)) return { parsed: "Pairs", pairs: contents.items };
  return {
    parsed: "Problems",
    problems: [
      {
        ...ticketYamlSpanOf(contents),
        message: "write the ticket as keys, one `key: value` a line",
      },
    ],
  };
}

/** Whether a text names a configuration: one, none, or a name its own key
 * is refused for. */
type TicketYamlNaming = "Named" | "Unnamed" | "Refused";

/**
 * The form a text starts from before its other keys are read: every key left
 * out, under the configuration the text names, and whether it names one.
 */
function ticketYamlStart(
  pairs: readonly TicketYamlPair[],
  context: TicketYamlContext,
): { readonly form: TicketCreationForm; readonly naming: TicketYamlNaming } {
  const empty = ticketYamlEmpty(context.base);
  if (!ticketYamlConfigurationOffered(context))
    return { form: empty, naming: "Named" };
  const written = pairs.find(
    (pair) => ticketYamlKeyNameOf(pair) === "configuration",
  );
  const read = ticketYamlConfigurationOf(written?.value, context);
  if (read.took === "Problem") return { form: empty, naming: "Refused" };
  return {
    form: creationConfigurationChosen(empty, context.offers, read.value),
    naming: read.value === "" ? "Unnamed" : "Named",
  };
}

/** What a text naming no configuration is told where it writes a key one
 * decides, which is what the form says of naming none. */
const ticketYamlUnnamedFault: CreationFault = {
  field: "configuration",
  reason: creationFaultSentence("configuration"),
};

export function ticketYamlRead(
  text: string,
  context: TicketYamlContext,
): TicketYamlReading {
  const keys = new Map<string, TicketYamlSpan>();
  const parsed = ticketYamlParsed(text);
  if (parsed.parsed === "Problems")
    return { form: undefined, keys, problems: parsed.problems };
  const pairs = parsed.pairs;
  const start = ticketYamlStart(pairs, context);
  const offered = new Set(
    ticketYamlKeys(context, start.form.configuration, "Push"),
  );
  const problems: TicketYamlProblem[] = [];
  let form = start.form;
  let undrawn = false;
  for (const pair of pairs) {
    const key = ticketYamlKeyNameOf(pair);
    const at = ticketYamlSpanOf(pair.key);
    if (key === undefined) {
      problems.push({ ...at, message: "a key is a plain word" });
      continue;
    }
    keys.set(key, at);
    if (start.naming !== "Named" && ticketYamlConfigured.has(key)) {
      undrawn ||= start.naming === "Unnamed";
      continue;
    }
    const applied = offered.has(key)
      ? ticketYamlKeyApplied(key, pair.value, form, context)
      : ticketYamlNoKey(key);
    if (applied.took === "Problem")
      problems.push({
        ...(pair.value === null ? at : ticketYamlSpanOf(pair.value)),
        message: applied.message,
      });
    else form = applied.value;
  }
  if (undrawn)
    problems.push(...ticketYamlFaultProblems([ticketYamlUnnamedFault], keys));
  return { form: problems.length === 0 ? form : undefined, keys, problems };
}

/** The key each field's fault is drawn at; the fence belongs to no key. */
function ticketYamlKeyOf(field: CreationField): string | undefined {
  switch (field) {
    case "configuration":
    case "title":
    case "intent":
    case "links":
    case "images":
    case "checks":
    case "landing":
    case "repository":
    case "target":
    case "branch":
      return field;
    case "authoring":
      return "program";
    case "fence":
      return undefined;
  }
}

/** The faults a form earned, each over the key it names, or the document's
 * first character where the key is not written. */
export function ticketYamlFaultProblems(
  faults: readonly CreationFault[],
  keys: ReadonlyMap<string, TicketYamlSpan>,
): readonly TicketYamlProblem[] {
  return faults.map((fault) => {
    const key = ticketYamlKeyOf(fault.field);
    const at = key === undefined ? undefined : keys.get(key);
    return { ...(at ?? { from: 0, to: 0 }), message: fault.reason };
  });
}

/** One value a key offers, with what choosing it does. */
export interface TicketYamlValue {
  readonly label: string;
  readonly detail?: string;
}

/** What the editor completes and explains: every key this project's form
 * draws, what it means, and the values it takes where they are a closed set. */
export interface TicketYamlKey {
  readonly key: string;
  readonly hint: string;
  readonly values: readonly TicketYamlValue[];
  /** Written inside a program's stage rather than at the top. */
  readonly nested?: true;
}

type TicketYamlDescribed = Omit<TicketYamlKey, "key">;

/** What the keys a configuration decides mean under the one the form names. */
function ticketYamlConfiguredDescribed(
  context: TicketYamlContext,
  drawn: DraftInitializationResponse | undefined,
): Readonly<Record<string, TicketYamlDescribed>> {
  if (drawn === undefined) return {};
  return {
    checks: { hint: creationFaultSentence("checks"), values: [] },
    dependencies: {
      hint: context.dependenciesLocked
        ? `the tickets this one waits for,${ticketYamlLockedNote}`
        : "the tickets this one waits for, by number",
      values: context.dependenciesLocked
        ? []
        : drawn.dependencyCandidates.map((candidate) => ({
            label: String(candidate),
            detail: `ticket ${String(candidate)}`,
          })),
    },
    program: {
      hint: `the evaluation program: at most ${String(drawn.choices.programStagesMax)} stages, each judged by the evaluators it counts`,
      values: [],
    },
  };
}

function ticketYamlDescribed(
  form: TicketCreationForm,
  context: TicketYamlContext,
  drawn: DraftInitializationResponse | undefined,
): Readonly<Record<string, TicketYamlDescribed>> {
  return {
    configuration: {
      hint: creationFaultSentence("configuration"),
      values: context.offers.map((offer) => ({
        label: offer.name,
        detail: offer.initialization.configuration.revision,
      })),
    },
    title: { hint: creationFaultSentence("title"), values: [] },
    intent: { hint: creationFaultSentence("intent"), values: [] },
    links: { hint: creationFaultSentence("links"), values: [] },
    images: {
      hint: `the images attached in the form, by identity: ${creationFaultSentence("images")}`,
      values: context.images.map((image) => ({ label: image })),
    },
    branch: { hint: creationBranchHint, values: [] },
    repository: {
      hint: creationFaultSentence("repository"),
      values: context.repositories.map((binding) => ({
        label: binding.repository,
        detail: repositoryLabel(binding.repository),
      })),
    },
    landing: {
      hint: "how the finished work lands",
      values: briefFinalizationModes.map((mode) => ({
        label: mode,
        detail: landingEffect(mode),
      })),
    },
    target: { hint: creationTargetBranchHint(form.landingMode), values: [] },
    ...ticketYamlConfiguredDescribed(context, drawn),
  };
}

/** The one key written inside a stage, which only a drawn program has. */
function ticketYamlNestedKeys(
  drawn: DraftInitializationResponse | undefined,
): readonly TicketYamlKey[] {
  if (drawn === undefined) return [];
  const evaluatorsMax = drawn.choices.evaluatorsMax;
  return [
    {
      key: "evaluators",
      hint: `how many evaluators judge this stage, from one to ${String(evaluatorsMax)}`,
      values: Array.from({ length: evaluatorsMax }, (_, index) => ({
        label: String(index + 1),
      })),
      nested: true,
    },
  ];
}

export function ticketYamlVocabulary(
  form: TicketCreationForm,
  context: TicketYamlContext,
): readonly TicketYamlKey[] {
  const drawn = ticketYamlDrawn(context, form.configuration);
  const described = ticketYamlDescribed(form, context, drawn);
  return [
    ...ticketYamlKeys(context, form.configuration, form.landingMode).map(
      (key) => ({ key, ...(described[key] ?? { hint: "", values: [] }) }),
    ),
    ...ticketYamlNestedKeys(drawn),
  ];
}
