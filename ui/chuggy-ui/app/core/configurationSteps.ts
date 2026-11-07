/**
 * A configuration as the steps a ticket runs under it, grouped by the phase
 * each runs in: the work, each evaluation stage in plan order, and the
 * landing.
 *
 * A ROW IS WHAT RUNS AT ONE STEP: who runs it and from what, its model, the
 * details it opens onto, and the values the ticket overrode of it. A catalog
 * stage of several evaluators is a row holding a row per evaluator.
 *
 * AN OVERRIDE IS MARKED ON THE VALUE IT CHANGED, compared with the pinned
 * document's, so an override that writes the value already there marks
 * nothing. Where the selection took its catalog's default, the group says so
 * once.
 */

import { configurationWithOverrides } from "../../../../src/contract/configurationOverrides.ts";
import type { ConfigurationOverrides } from "../../../../src/contract/configurationOverrides.ts";
import type { BriefFinalizationOf } from "../../../../src/contract/brief.ts";
import type { ConfigurationFollowing } from "../../../../src/contract/configurationDocument.ts";
import type { ConfigurationSelection } from "../../../../src/contract/configurationSelection.ts";
import { configurationFollowingOf } from "../../../../src/contract/configurationSelection.ts";

import { finalizationLine, gitMergePolicyLabel } from "./codeLabels.ts";
import {
  configurationCatalogOf,
  configurationCatalogSelected,
  configurationCatalogWorkload,
} from "./configurationCatalog.ts";
import type {
  CatalogFinalizer,
  CatalogPlanStage,
  ConfigurationCatalog,
} from "./configurationCatalog.ts";
import {
  configurationModelLabelOf,
  practiceLabel,
} from "./configurationView.ts";
import type { ConfigurationView } from "./configurationView.ts";
import {
  overrideDocumentOf,
  overrideFieldLabel,
  overrideFieldOf,
  overriddenViewOf,
  overridesSame,
} from "./ticketOverrides.ts";
import type { OverrideField } from "./ticketOverrides.ts";
import { workloadsEffectiveCanonicalOf } from "./workloadOverrides.ts";

export type ConfigurationStepPhase = "Work" | "Evaluation" | "Finalization";

/** One value a step opens onto, one line per entry. */
export interface ConfigurationStepDetail {
  readonly name: string;
  readonly lines: readonly string[];
  readonly code: boolean;
  readonly overridden: boolean;
}

/** One part of a step's prompt, under the heading it is briefed with. */
export interface ConfigurationStepPrompt {
  readonly heading: string | undefined;
  readonly lines: readonly string[];
  readonly overridden: boolean;
}

/** Who runs a step, and the file or first line it runs from. */
export interface ConfigurationStepRuns {
  readonly by: string;
  readonly from: string | undefined;
  /** How many more lines follow the first. */
  readonly more: number;
}

export interface ConfigurationStepRow {
  readonly step: string;
  /** The workload it runs, where its name is not the step's. */
  readonly workload: string | undefined;
  readonly runs: ConfigurationStepRuns | undefined;
  readonly model: string | undefined;
  /** Each value the ticket changed, as its column names it. */
  readonly overrides: readonly string[];
  readonly details: readonly ConfigurationStepDetail[];
  readonly prompt: readonly ConfigurationStepPrompt[];
  /** What the YAML view writes out; absent where there is none. */
  readonly definition: unknown;
  /** A stage's evaluators, where it runs several side by side. */
  readonly evaluators: readonly ConfigurationStepRow[];
}

export interface ConfigurationStepGroup {
  readonly phase: ConfigurationStepPhase;
  /** What the selection took here, and whether it was the default. */
  readonly note: string | undefined;
  readonly rows: readonly ConfigurationStepRow[];
}

export interface ConfigurationSteps {
  readonly following: ConfigurationFollowing;
  readonly groups: readonly ConfigurationStepGroup[];
}

/** The finalization a ticket's brief or its finalizer names. */
type StepsFinalization = BriefFinalizationOf<string | undefined>;

type StepsRecord = Readonly<Record<string, unknown>>;

function stepsRecord(value: unknown): StepsRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as StepsRecord)
    : {};
}

function stepsStrings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stepsString(value: unknown): readonly string[] {
  return typeof value === "string" ? [value] : [];
}

/** A list read as one line, none where it holds nothing. */
function stepsJoined(items: readonly string[] | undefined): readonly string[] {
  return items === undefined || items.length === 0 ? [] : [items.join(" · ")];
}

/** Practice identities as the one line of words they name. */
function stepsPractices(practices: readonly string[] | undefined) {
  return stepsJoined(practices?.map(practiceLabel));
}

/** A count in whole units, the noun singular for one. */
function stepsCounted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

const stepsEmpty: readonly ConfigurationStepRow[] = [];

function stepsRow(
  row: Partial<ConfigurationStepRow> & { readonly step: string },
): ConfigurationStepRow {
  return {
    workload: undefined,
    runs: undefined,
    model: undefined,
    overrides: [],
    details: [],
    prompt: [],
    definition: undefined,
    evaluators: stepsEmpty,
    ...row,
  };
}

/** Who runs commands: the first of them, and how many follow it. */
function stepsCommandsRuns(commands: readonly string[]): ConfigurationStepRuns {
  return {
    by: "Commands",
    from: commands[0],
    more: Math.max(0, commands.length - 1),
  };
}

/** One value a workload is read for, the field of it that holds the value,
 * and what its override is named in the Overrides column. */
interface CatalogDetailRead {
  readonly name: string;
  readonly field: string;
  readonly code: boolean;
  readonly read: (workload: StepsRecord) => readonly string[];
  readonly word?: (workload: StepsRecord) => string;
  /** What an override is compared on, where it holds more than is drawn. */
  readonly compared?: (workload: StepsRecord) => unknown;
}

function catalogMode(workload: StepsRecord): StepsRecord {
  return stepsRecord(stepsRecord(workload["worker"])["mode"]);
}

/** A mode's arguments as the one line the agent is started with. */
function catalogArguments(workload: StepsRecord): readonly string[] {
  const held = stepsStrings(catalogMode(workload)["arguments"]);
  return held.length === 0 ? [] : [held.join(" ")];
}

function catalogResource(workload: StepsRecord, key: string): unknown {
  return stepsRecord(workload["resources"])[key];
}

function catalogCpus(workload: StepsRecord): readonly string[] {
  const cpus = catalogResource(workload, "cpus");
  return typeof cpus === "number" ? [String(cpus)] : [];
}

function catalogMemory(workload: StepsRecord): readonly string[] {
  const memory = catalogResource(workload, "memoryMib");
  return typeof memory === "number" ? [`${String(memory)} MiB`] : [];
}

function catalogFiles(workload: StepsRecord): readonly unknown[] {
  const files = stepsRecord(workload["worker"])["files"];
  return Array.isArray(files) ? files : [];
}

/** The values a catalog workload opens onto, in the order they are drawn. */
const catalogDetailReads: readonly CatalogDetailRead[] = [
  {
    name: "Arguments",
    field: "worker",
    code: true,
    read: catalogArguments,
  },
  {
    name: "Effort",
    field: "worker",
    code: false,
    read: (workload) => stepsString(catalogMode(workload)["effort"]),
  },
  {
    name: "Commands",
    field: "commands",
    code: true,
    read: (workload) => stepsStrings(workload["commands"]),
  },
  {
    name: "CPUs",
    field: "resources",
    code: false,
    read: catalogCpus,
    word: (workload) => {
      const cpus = catalogResource(workload, "cpus");
      return typeof cpus === "number" ? stepsCounted(cpus, "CPU") : "CPUs";
    },
  },
  {
    name: "Memory",
    field: "resources",
    code: false,
    read: catalogMemory,
    word: (workload) => catalogMemory(workload)[0] ?? "Memory",
  },
  {
    name: "Setup",
    field: "worker",
    code: true,
    read: (workload) => stepsStrings(stepsRecord(workload["worker"])["setup"]),
  },
  {
    name: "Files",
    field: "worker",
    code: true,
    read: (workload) =>
      catalogFiles(workload).flatMap((file) =>
        stepsString(stepsRecord(file)["path"]),
      ),
    compared: catalogFiles,
  },
  {
    name: "Practices",
    field: "practices",
    code: false,
    read: (workload) => stepsPractices(stepsStrings(workload["practices"])),
  },
  {
    name: "Image",
    field: "image",
    code: true,
    read: (workload) => stepsString(workload["image"]),
  },
];

/** The fields of a workload an override may name that no detail above
 * reads, each by the name it is drawn under. */
const catalogFieldNames: Readonly<Record<string, string>> = {
  runner: "Runner",
  purpose: "Purpose",
  authority: "Authority",
  framing: "Framing",
  brief: "Brief",
  executionRequirement: "Execution requirement",
};

/** One workload as the ticket runs it beside the catalog's own, with what
 * the ticket wrote over it. */
interface CatalogHeld {
  readonly effective: StepsRecord;
  readonly pinned: StepsRecord;
  readonly override: StepsRecord | undefined;
}

/** Whether the ticket's override of a field left it other than the pinned
 * workload holds it. */
function catalogFieldChanged(held: CatalogHeld, field: string): boolean {
  return (
    held.override?.[field] !== undefined &&
    !overridesSame(held.effective[field], held.pinned[field])
  );
}

/** Whether a workload runs a model other than the pinned one. */
function stepsModelChanged(
  effective: StepsRecord,
  pinned: StepsRecord,
): boolean {
  return (
    configurationModelLabelOf(catalogMode(effective)).label !==
    configurationModelLabelOf(catalogMode(pinned)).label
  );
}

/** The agent and the model it runs, each drawn as a detail of its own
 * only where it differs from the pinned, since its cell already holds it.
 * A model its changed arguments carry is marked on those arguments. */
function stepsModeDetailsOf(
  effective: StepsRecord,
  pinned: StepsRecord,
): readonly ConfigurationStepDetail[] {
  const agent = catalogMode(effective)["agent"];
  const detail = (name: string, line: unknown) => [
    { name, lines: stepsString(line), code: false, overridden: true },
  ];
  const modelOwn =
    stepsModelChanged(effective, pinned) &&
    overridesSame(catalogArguments(effective), catalogArguments(pinned));
  return [
    ...(agent === catalogMode(pinned)["agent"] ? [] : detail("Agent", agent)),
    ...(modelOwn
      ? detail("Model", configurationModelLabelOf(catalogMode(effective)).label)
      : []),
  ];
}

/** The details a catalog workload opens onto, each it overrode marked, and
 * an override no detail reads drawn as one of its own. */
function catalogDetailsOf(
  held: CatalogHeld,
): readonly ConfigurationStepDetail[] {
  const { effective, pinned, override } = held;
  const read = catalogDetailReads.flatMap((detail) => {
    const lines = detail.read(effective);
    const compared = detail.compared ?? detail.read;
    const overridden =
      override?.[detail.field] !== undefined &&
      !overridesSame(compared(effective), compared(pinned));
    return lines.length === 0 && !overridden
      ? []
      : [{ name: detail.name, lines, code: detail.code, overridden }];
  });
  const unread = Object.keys(override ?? {}).flatMap((field) => {
    const name = catalogFieldNames[field];
    const value = effective[field];
    return name === undefined || !catalogFieldChanged(held, field)
      ? []
      : [
          {
            name,
            lines: [typeof value === "string" ? value : JSON.stringify(value)],
            code: typeof value !== "string",
            overridden: true,
          },
        ];
  });
  return [...stepsModeDetailsOf(effective, pinned), ...read, ...unread];
}

/** What the Overrides column names of one catalog workload. */
function catalogOverridesOf(
  held: CatalogHeld,
  details: readonly ConfigurationStepDetail[],
): readonly string[] {
  const modelChanged = stepsModelChanged(held.effective, held.pinned);
  const words = details
    .filter((detail) => detail.overridden)
    .map((detail) => {
      const word = catalogDetailReads.find(
        (read) => read.name === detail.name,
      )?.word;
      if (detail.name === "Arguments" && modelChanged) return "Model";
      return word === undefined ? detail.name : word(held.effective);
    });
  return [
    ...new Set([
      ...(catalogFieldChanged(held, "prompt") ? ["Prompt"] : []),
      ...words,
    ]),
  ];
}

/** The pinned and the effective raw workloads, by name. */
interface CatalogDocuments {
  readonly catalog: ConfigurationCatalog;
  readonly effective: StepsRecord;
  readonly pinned: StepsRecord;
  readonly overrides: StepsRecord;
}

function catalogDocumentsOf(
  canonical: string,
  overrides: ConfigurationOverrides | undefined,
): CatalogDocuments | undefined {
  const effective = workloadsEffectiveCanonicalOf(
    canonical,
    overrides?.workloads,
  );
  const catalog = configurationCatalogOf(effective);
  if (catalog === undefined) return undefined;
  return {
    catalog,
    effective: stepsRecord(
      stepsRecord(overrideDocumentOf(effective))["workloads"],
    ),
    pinned: stepsRecord(
      stepsRecord(overrideDocumentOf(canonical))["workloads"],
    ),
    overrides: stepsRecord(overrides?.workloads),
  };
}

/** One catalog workload run as one step. */
function catalogRowOf(
  documents: CatalogDocuments,
  step: string,
  name: string,
): ConfigurationStepRow {
  const workload = configurationCatalogWorkload(documents.catalog, name);
  const overriding = documents.overrides[name];
  const held: CatalogHeld = {
    effective: stepsRecord(documents.effective[name]),
    pinned: stepsRecord(documents.pinned[name]),
    override: overriding === undefined ? undefined : stepsRecord(overriding),
  };
  const details = catalogDetailsOf(held);
  const commands = workload?.runner === "Commands";
  return stepsRow({
    step,
    workload: name === step ? undefined : name,
    runs:
      workload?.runner === undefined
        ? undefined
        : commands
          ? stepsCommandsRuns(workload.commands)
          : {
              by: workload.agent ?? "Agent",
              from: workload.promptPath,
              more: 0,
            },
    model: workload?.model,
    overrides: catalogOverridesOf(held, details),
    details,
    prompt:
      workload?.prompt === undefined
        ? []
        : [
            {
              heading: workload.promptPath,
              lines: [workload.prompt],
              overridden: catalogFieldChanged(held, "prompt"),
            },
          ],
    definition: workload?.definition,
  });
}

/** A plan stage: its evaluator's row under the stage's name, or a row
 * holding one per evaluator where it runs several. */
function catalogStageRowOf(
  documents: CatalogDocuments,
  stage: CatalogPlanStage,
): ConfigurationStepRow {
  const [only] = stage.evaluators;
  if (stage.evaluators.length === 1 && only !== undefined)
    return catalogRowOf(documents, stage.name, only);
  return stepsRow({
    step: stage.name,
    runs: {
      by: `${String(stage.evaluators.length)} side by side`,
      from: undefined,
      more: 0,
    },
    evaluators: stage.evaluators.map((name) =>
      catalogRowOf(documents, name, name),
    ),
  });
}

/** The landing: how the work is finalized, its policy, and whether a person
 * approves it first. */
function stepsLandingOf(
  finalization: StepsFinalization | undefined,
  finalizer: CatalogFinalizer | undefined,
): ConfigurationStepRow {
  const detail = (name: string, line: string): ConfigurationStepDetail => ({
    name,
    lines: [line],
    code: false,
    overridden: false,
  });
  return stepsRow({
    step: "Landing",
    runs:
      finalization === undefined
        ? undefined
        : { by: finalizationLine(finalization), from: undefined, more: 0 },
    details: [
      ...(finalization?.kind === "GitMerge"
        ? [detail("Policy", gitMergePolicyLabel(finalization.policy))]
        : []),
      ...(finalizer?.approvalRequired === true
        ? [detail("Approval", "Required")]
        : []),
    ],
  });
}

/** What a selection took, and that it is the default where it is. */
function stepsChosen(name: string, defaulted: string | undefined): string {
  return name === defaulted ? `${name} · default` : name;
}

function catalogStepsOf(
  documents: CatalogDocuments,
  selection: ConfigurationSelection | undefined,
  finalization: StepsFinalization | undefined,
): ConfigurationSteps {
  const { catalog } = documents;
  const selected = configurationCatalogSelected(catalog, selection);
  const finalizer = catalog.finalizers.find(
    (held) => held.name === selected.finalization,
  );
  return {
    following: configurationFollowingOf(selection, catalog.defaults),
    groups: [
      {
        phase: "Work",
        note: selected.work === catalog.defaults.work ? "default" : undefined,
        rows: [catalogRowOf(documents, "Work", selected.work)],
      },
      {
        phase: "Evaluation",
        note: `plan ${stepsChosen(selected.evaluation, catalog.defaults.evaluation)}`,
        rows: (catalog.plans.get(selected.evaluation) ?? []).map((stage) =>
          catalogStageRowOf(documents, stage),
        ),
      },
      {
        phase: "Finalization",
        note:
          selected.finalization === undefined
            ? undefined
            : `finalizer ${stepsChosen(selected.finalization, catalog.defaults.finalization)}`,
        rows: [
          stepsLandingOf(finalization ?? finalizer?.finalization, finalizer),
        ],
      },
    ],
  };
}

/** A version 1 document as the ticket runs it, and which fields it overrode. */
interface LegacyHeld {
  readonly view: ConfigurationView;
  readonly document: StepsRecord;
  readonly pinned: StepsRecord;
  readonly overridden: ReadonlySet<OverrideField>;
}

function legacyHeldOf(
  canonical: string,
  overrides: ConfigurationOverrides | undefined,
): LegacyHeld {
  const { view, overridden } = overriddenViewOf(canonical, overrides);
  const document = overrideDocumentOf(canonical);
  return {
    view,
    document: stepsRecord(
      overrides === undefined || document === undefined
        ? document
        : configurationWithOverrides(document, overrides),
    ),
    pinned: stepsRecord(document),
    overridden: new Set(
      overridden.filter(
        (field) =>
          !overridesSame(
            overrideFieldOf(overrides, field),
            overrideFieldOf(document, field),
          ),
      ),
    ),
  };
}

function legacyDetail(
  name: string,
  lines: readonly string[] | undefined,
  code: boolean,
  overridden = false,
): readonly ConfigurationStepDetail[] {
  const held = lines ?? [];
  return held.length === 0 && !overridden
    ? []
    : [{ name, lines: held, code, overridden }];
}

/** The agent a version 1 document's worker names, as its mode writes it. */
function legacyAgentOf(document: StepsRecord): string {
  const agent = catalogMode(document)["agent"];
  return typeof agent === "string" ? agent : "Agent";
}

function legacyWorkDetailsOf(
  held: LegacyHeld,
): readonly ConfigurationStepDetail[] {
  const { view, document, pinned, overridden } = held;
  const settings = view.settings;
  const worker = stepsRecord(document["worker"]);
  const files = Array.isArray(worker["files"]) ? worker["files"] : [];
  return [
    ...stepsModeDetailsOf(document, pinned),
    ...legacyDetail(
      "Arguments",
      catalogArguments(document),
      true,
      !overridesSame(catalogArguments(document), catalogArguments(pinned)),
    ),
    ...legacyDetail("Tools", stepsJoined(settings.tools), false),
    ...legacyDetail("Credentials", stepsJoined(settings.credentials), false),
    ...legacyDetail(
      "Access",
      settings.access === undefined ? [] : [settings.access],
      false,
    ),
    ...legacyDetail(
      "Image",
      settings.worker === undefined ? [] : [settings.worker.short],
      true,
    ),
    ...legacyDetail(
      "Setup",
      settings.setup,
      true,
      overridden.has("worker.setup"),
    ),
    ...legacyDetail(
      "Files",
      files.flatMap((file) => stepsString(stepsRecord(file)["path"])),
      true,
      overridden.has("worker.files"),
    ),
    ...legacyDetail(
      "Practices",
      stepsPractices(view.work.practices),
      false,
      overridden.has("practices"),
    ),
    ...legacyDetail(
      "Completes task",
      settings.completesTask === undefined
        ? []
        : [settings.completesTask ? "Yes" : "No"],
      false,
    ),
  ];
}

/** The work's prompt: the shared brief, then its own instructions. */
function legacyWorkPromptOf(
  held: LegacyHeld,
): readonly ConfigurationStepPrompt[] {
  const { view, overridden } = held;
  const parts: readonly (readonly [
    string,
    readonly string[] | undefined,
    OverrideField,
  ])[] = [
    ["Motivation", view.brief.motivation, "brief.motivation"],
    [
      "Acceptance criteria",
      view.brief.acceptanceCriteria,
      "brief.acceptanceCriteria",
    ],
    ["Constraints", view.brief.constraints, "brief.constraints"],
    ["Instructions", view.work.instructions, "work.instructions"],
  ];
  return parts.flatMap(([heading, lines, field]) =>
    lines === undefined || lines.length === 0
      ? []
      : [{ heading, lines, overridden: overridden.has(field) }],
  );
}

function legacyWorkRowOf(held: LegacyHeld): ConfigurationStepRow {
  const { view, document, overridden } = held;
  const commands = view.work.commands;
  return stepsRow({
    step: "Work",
    runs:
      commands === undefined
        ? { by: legacyAgentOf(document), from: undefined, more: 0 }
        : stepsCommandsRuns(commands),
    model: commands === undefined ? view.settings.model.label : undefined,
    overrides: [...overridden].map(overrideFieldLabel),
    details: [
      ...legacyWorkDetailsOf(held),
      ...legacyDetail("Commands", commands, true),
    ],
    prompt: legacyWorkPromptOf(held),
    definition: Object.fromEntries(
      ["worker", "authority", "brief", "practices", "work"].flatMap((key) =>
        document[key] === undefined ? [] : [[key, document[key]]],
      ),
    ),
  });
}

/** A reviewer's instructions as its prompt, which no ticket overrides. */
function legacyPromptOf(
  instructions: readonly string[] | undefined,
): readonly ConfigurationStepPrompt[] {
  return instructions === undefined || instructions.length === 0
    ? []
    : [{ heading: undefined, lines: instructions, overridden: false }];
}

/** A version 1 document's evaluation: its stages, each by its place, or the
 * review block where it declares none. */
function legacyEvaluationRowsOf(
  held: LegacyHeld,
): readonly ConfigurationStepRow[] {
  const { view, document } = held;
  const agent = legacyAgentOf(document);
  const model = view.settings.model.label;
  if (view.evaluations.length === 0)
    return view.review === undefined
      ? []
      : [
          stepsRow({
            step: "Review",
            runs: { by: agent, from: undefined, more: 0 },
            model,
            details: legacyDetail(
              "Practices",
              stepsPractices(view.review.practices),
              false,
            ),
            prompt: legacyPromptOf(view.review.instructions),
            definition: document["review"],
          }),
        ];
  const declared = Array.isArray(document["evaluations"])
    ? document["evaluations"]
    : [];
  return view.evaluations.map((evaluation, index) =>
    stepsRow({
      step: `Stage ${String(index + 1)}`,
      runs:
        evaluation.checks === undefined
          ? { by: agent, from: undefined, more: 0 }
          : stepsCommandsRuns(evaluation.checks),
      model: evaluation.checks === undefined ? model : undefined,
      details: [
        ...legacyDetail("Commands", evaluation.checks, true),
        ...legacyDetail(
          "Practices",
          stepsPractices(evaluation.practices),
          false,
        ),
      ],
      prompt: legacyPromptOf(evaluation.instructions),
      definition: declared[index],
    }),
  );
}

function legacyStepsOf(
  canonical: string,
  overrides: ConfigurationOverrides | undefined,
  selection: ConfigurationSelection | undefined,
  finalization: StepsFinalization | undefined,
): ConfigurationSteps {
  const held = legacyHeldOf(canonical, overrides);
  const evaluation = legacyEvaluationRowsOf(held);
  const groups: readonly ConfigurationStepGroup[] = [
    { phase: "Work", note: undefined, rows: [legacyWorkRowOf(held)] },
    ...(evaluation.length === 0
      ? []
      : [{ phase: "Evaluation" as const, note: undefined, rows: evaluation }]),
    ...(finalization === undefined
      ? []
      : [
          {
            phase: "Finalization" as const,
            note: undefined,
            rows: [stepsLandingOf(finalization, undefined)],
          },
        ]),
  ];
  return { following: configurationFollowingOf(selection, undefined), groups };
}

/**
 * The steps a configuration runs, as a ticket with these overrides and this
 * selection runs them. The finalization is the brief's, which a catalog
 * ticket takes before its finalizer's.
 */
export function configurationStepsOf(props: {
  readonly canonical: string;
  readonly overrides: ConfigurationOverrides | undefined;
  readonly selection: ConfigurationSelection | undefined;
  readonly finalization: StepsFinalization | undefined;
}): ConfigurationSteps {
  const documents = catalogDocumentsOf(props.canonical, props.overrides);
  return documents === undefined
    ? legacyStepsOf(
        props.canonical,
        props.overrides,
        props.selection,
        props.finalization,
      )
    : catalogStepsOf(documents, props.selection, props.finalization);
}
