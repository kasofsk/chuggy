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
import type { Copy, CopyOrData } from "./copy.ts";

export type ConfigurationStepPhase = "Work" | "Evaluation" | "Finalization";

/** One value a step opens onto, one line per entry. */
export interface ConfigurationStepDetail {
  readonly name: Copy;
  readonly lines: readonly CopyOrData[];
  readonly code: boolean;
  readonly overridden: boolean;
}

/** One part of a step's prompt, under the heading it is briefed with. */
export interface ConfigurationStepPrompt {
  readonly heading: CopyOrData | undefined;
  readonly lines: readonly string[];
  readonly overridden: boolean;
}

/** Who runs a step, and the file or first line it runs from. */
export interface ConfigurationStepRuns {
  readonly by: CopyOrData;
  readonly from: string | undefined;
  /** How many more lines follow the first. */
  readonly more: number;
}

export interface ConfigurationStepRow {
  readonly step: CopyOrData;
  /** The workload it runs, where its name is not the step's. */
  readonly workload: string | undefined;
  readonly runs: ConfigurationStepRuns | undefined;
  readonly model: CopyOrData | undefined;
  /** Each value the ticket changed, as its column names it. */
  readonly overrides: readonly CopyOrData[];
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
  readonly note: Copy | undefined;
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

/** A model as its column draws it, and none named as its agent's default. */
function stepsModel(label: string | undefined): CopyOrData {
  return label ?? { id: "configuration-steps-model-default" };
}

/** A following as its chip draws it. */
export function configurationFollowingWord(
  following: ConfigurationFollowing,
): Copy {
  return following === "Pinned"
    ? { id: "configuration-steps-following-pinned" }
    : { id: "configuration-steps-following-latest" };
}

const stepsEmpty: readonly ConfigurationStepRow[] = [];

function stepsRow(
  row: Partial<ConfigurationStepRow> & { readonly step: CopyOrData },
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
    by: { id: "configuration-steps-commands" },
    from: commands[0],
    more: Math.max(0, commands.length - 1),
  };
}

/** One value a workload is read for, the field of it that holds the value,
 * and what its override is named in the Overrides column. */
interface CatalogDetailRead {
  readonly name: Copy;
  readonly field: string;
  readonly code: boolean;
  readonly read: (workload: StepsRecord) => readonly CopyOrData[];
  readonly word?: (workload: StepsRecord) => Copy;
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

function catalogMemory(workload: StepsRecord): readonly Copy[] {
  const memory = catalogResource(workload, "memoryMib");
  return typeof memory === "number"
    ? [{ id: "configuration-steps-memory-mib", args: { mib: String(memory) } }]
    : [];
}

function catalogFiles(workload: StepsRecord): readonly unknown[] {
  const files = stepsRecord(workload["worker"])["files"];
  return Array.isArray(files) ? files : [];
}

/** The values a catalog workload opens onto, in the order they are drawn. */
const catalogDetailReads: readonly CatalogDetailRead[] = [
  {
    name: { id: "configuration-steps-arguments" },
    field: "worker",
    code: true,
    read: catalogArguments,
  },
  {
    name: { id: "configuration-steps-effort" },
    field: "worker",
    code: false,
    read: (workload) => stepsString(catalogMode(workload)["effort"]),
  },
  {
    name: { id: "configuration-steps-commands" },
    field: "commands",
    code: true,
    read: (workload) => stepsStrings(workload["commands"]),
  },
  {
    name: { id: "configuration-steps-cpus" },
    field: "resources",
    code: false,
    read: catalogCpus,
    word: (workload) => {
      const cpus = catalogResource(workload, "cpus");
      return typeof cpus === "number"
        ? { id: "configuration-steps-cpu-count", args: { count: cpus } }
        : { id: "configuration-steps-cpus" };
    },
  },
  {
    name: { id: "configuration-steps-memory" },
    field: "resources",
    code: false,
    read: catalogMemory,
    word: (workload) =>
      catalogMemory(workload)[0] ?? { id: "configuration-steps-memory" },
  },
  {
    name: { id: "configuration-steps-setup" },
    field: "worker",
    code: true,
    read: (workload) => stepsStrings(stepsRecord(workload["worker"])["setup"]),
  },
  {
    name: { id: "configuration-steps-files" },
    field: "worker",
    code: true,
    read: (workload) =>
      catalogFiles(workload).flatMap((file) =>
        stepsString(stepsRecord(file)["path"]),
      ),
    compared: catalogFiles,
  },
  {
    name: { id: "configuration-steps-practices" },
    field: "practices",
    code: false,
    read: (workload) => stepsPractices(stepsStrings(workload["practices"])),
  },
  {
    name: { id: "configuration-steps-image" },
    field: "image",
    code: true,
    read: (workload) => stepsString(workload["image"]),
  },
];

/** The fields of a workload an override may name that no detail above
 * reads, each by the name it is drawn under. */
const catalogFieldNames: Readonly<Record<string, Copy>> = {
  runner: { id: "configuration-steps-runner" },
  purpose: { id: "configuration-steps-purpose" },
  authority: { id: "configuration-steps-authority" },
  framing: { id: "configuration-steps-framing" },
  brief: { id: "configuration-steps-brief" },
  executionRequirement: { id: "configuration-steps-run-requirement" },
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

/** What a workload's mode changed of the pinned one. The model is carried
 * by the arguments where either side names it there and the arguments
 * changed, and is then marked on those arguments rather than on its own. */
interface StepsModeChange {
  readonly agent: boolean;
  readonly model: boolean;
  readonly carried: boolean;
}

function stepsModeChangeOf(
  effective: StepsRecord,
  pinned: StepsRecord,
): StepsModeChange {
  const now = configurationModelLabelOf(catalogMode(effective));
  const was = configurationModelLabelOf(catalogMode(pinned));
  const model = now.label !== was.label;
  return {
    agent: catalogMode(effective)["agent"] !== catalogMode(pinned)["agent"],
    model,
    carried:
      model &&
      (now.argument !== undefined || was.argument !== undefined) &&
      !overridesSame(catalogArguments(effective), catalogArguments(pinned)),
  };
}

/** The agent and the model it runs, each drawn as a detail of its own
 * only where it differs from the pinned, since its cell already holds it. */
function stepsModeDetailsOf(
  effective: StepsRecord,
  change: StepsModeChange,
): readonly ConfigurationStepDetail[] {
  const detail = (name: Copy, line: unknown) => [
    { name, lines: stepsString(line), code: false, overridden: true },
  ];
  return [
    ...(change.agent
      ? detail(
          { id: "configuration-steps-agent" },
          catalogMode(effective)["agent"],
        )
      : []),
    ...(change.model && !change.carried
      ? [
          {
            name: { id: "configuration-steps-model" } as const,
            lines: [
              stepsModel(
                configurationModelLabelOf(catalogMode(effective)).label,
              ),
            ],
            code: false,
            overridden: true,
          },
        ]
      : []),
  ];
}

/** What the Overrides column names of each marked detail, arguments that
 * carry a changed model named as the model. */
function stepsOverrideWordsOf(
  effective: StepsRecord,
  change: StepsModeChange,
  details: readonly ConfigurationStepDetail[],
): readonly Copy[] {
  return details
    .filter((detail) => detail.overridden)
    .map((detail): Copy => {
      if (detail.name.id === "configuration-steps-arguments" && change.carried)
        return { id: "configuration-steps-model" };
      const word = catalogDetailReads.find(
        (read) => read.name.id === detail.name.id,
      )?.word;
      return word === undefined ? detail.name : word(effective);
    });
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
  return [
    ...stepsModeDetailsOf(effective, stepsModeChangeOf(effective, pinned)),
    ...read,
    ...unread,
  ];
}

/** What the Overrides column names of one catalog workload. */
function catalogOverridesOf(
  held: CatalogHeld,
  details: readonly ConfigurationStepDetail[],
): readonly Copy[] {
  const change = stepsModeChangeOf(held.effective, held.pinned);
  const words: readonly Copy[] = [
    ...(catalogFieldChanged(held, "prompt")
      ? [{ id: "configuration-steps-prompt" } as const]
      : []),
    ...stepsOverrideWordsOf(held.effective, change, details),
  ];
  return [
    ...new Map(words.map((word) => [JSON.stringify(word), word])).values(),
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
  step: CopyOrData,
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
              by: workload.agent ?? { id: "configuration-steps-agent" },
              from: workload.promptPath,
              more: 0,
            },
    model:
      workload?.runner === "Agent" ? stepsModel(workload.model) : undefined,
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
      by: {
        id: "configuration-steps-side-by-side",
        args: { count: String(stage.evaluators.length) },
      },
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
  const detail = (name: Copy, line: Copy): ConfigurationStepDetail => ({
    name,
    lines: [line],
    code: false,
    overridden: false,
  });
  return stepsRow({
    step: { id: "ticket-steps-phase-landing" },
    runs:
      finalization === undefined
        ? undefined
        : { by: finalizationLine(finalization), from: undefined, more: 0 },
    details: [
      ...(finalization?.kind === "GitMerge"
        ? [
            detail(
              { id: "configuration-steps-policy" },
              gitMergePolicyLabel(finalization.policy),
            ),
          ]
        : []),
      ...(finalizer?.approvalRequired === true
        ? [
            detail(
              { id: "configuration-steps-approval" },
              { id: "configuration-steps-required" },
            ),
          ]
        : []),
    ],
  });
}

/** What a selection took, and that it is the default where it is. */
function stepsChosen(name: string, defaulted: string | undefined): CopyOrData {
  return name === defaulted
    ? { id: "configuration-steps-chosen-default", args: { name } }
    : name;
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
        note:
          selected.work === catalog.defaults.work
            ? { id: "configuration-steps-default" }
            : undefined,
        rows: [
          catalogRowOf(
            documents,
            { id: "ticket-steps-phase-work" },
            selected.work,
          ),
        ],
      },
      {
        phase: "Evaluation",
        note: {
          id: "configuration-steps-plan",
          args: {
            name: stepsChosen(selected.evaluation, catalog.defaults.evaluation),
          },
        },
        rows: (catalog.plans.get(selected.evaluation) ?? []).map((stage) =>
          catalogStageRowOf(documents, stage),
        ),
      },
      {
        phase: "Finalization",
        note: undefined,
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
  name: Copy,
  lines: readonly CopyOrData[] | undefined,
  code: boolean,
  overridden = false,
): readonly ConfigurationStepDetail[] {
  const held = lines ?? [];
  return held.length === 0 && !overridden
    ? []
    : [{ name, lines: held, code, overridden }];
}

/** The agent a version 1 document's worker names, as its mode writes it. */
function legacyAgentOf(document: StepsRecord): CopyOrData {
  const agent = catalogMode(document)["agent"];
  return typeof agent === "string"
    ? agent
    : { id: "configuration-steps-agent" };
}

function legacyWorkDetailsOf(
  held: LegacyHeld,
): readonly ConfigurationStepDetail[] {
  const { view, document, pinned, overridden } = held;
  const settings = view.settings;
  const worker = stepsRecord(document["worker"]);
  const files = Array.isArray(worker["files"]) ? worker["files"] : [];
  return [
    ...stepsModeDetailsOf(document, stepsModeChangeOf(document, pinned)),
    ...legacyDetail(
      { id: "configuration-steps-arguments" },
      catalogArguments(document),
      true,
      !overridesSame(catalogArguments(document), catalogArguments(pinned)),
    ),
    ...legacyDetail(
      { id: "configuration-steps-effort" },
      stepsString(catalogMode(document)["effort"]),
      false,
      catalogMode(document)["effort"] !== catalogMode(pinned)["effort"],
    ),
    ...legacyDetail(
      { id: "configuration-steps-tools" },
      stepsJoined(settings.tools),
      false,
    ),
    ...legacyDetail(
      { id: "configuration-steps-credentials" },
      stepsJoined(settings.credentials),
      false,
    ),
    ...legacyDetail(
      { id: "configuration-steps-access" },
      settings.access === undefined ? [] : [settings.access],
      false,
    ),
    ...legacyDetail(
      { id: "configuration-steps-image" },
      settings.worker === undefined ? [] : [settings.worker.short],
      true,
    ),
    ...legacyDetail(
      { id: "configuration-steps-setup" },
      settings.setup,
      true,
      overridden.has("worker.setup"),
    ),
    ...legacyDetail(
      { id: "configuration-steps-files" },
      files.flatMap((file) => stepsString(stepsRecord(file)["path"])),
      true,
      overridden.has("worker.files"),
    ),
    ...legacyDetail(
      { id: "configuration-steps-practices" },
      stepsPractices(view.work.practices),
      false,
      overridden.has("practices"),
    ),
    ...legacyDetail(
      { id: "configuration-steps-completes-run" },
      stepsYesNo(settings.completesTask),
      false,
    ),
  ];
}

function stepsYesNo(value: boolean | undefined): readonly Copy[] {
  if (value === undefined) return [];
  return [
    value
      ? { id: "configuration-steps-yes" }
      : { id: "configuration-steps-no" },
  ];
}

/** The work's prompt: the shared brief, then its own instructions. */
function legacyWorkPromptOf(
  held: LegacyHeld,
): readonly ConfigurationStepPrompt[] {
  const { view, overridden } = held;
  const parts: readonly (readonly [
    Copy,
    readonly string[] | undefined,
    OverrideField,
  ])[] = [
    [
      { id: "configuration-steps-motivation" },
      view.brief.motivation,
      "brief.motivation",
    ],
    [
      { id: "configuration-steps-acceptance-criteria" },
      view.brief.acceptanceCriteria,
      "brief.acceptanceCriteria",
    ],
    [
      { id: "configuration-steps-constraints" },
      view.brief.constraints,
      "brief.constraints",
    ],
    [
      { id: "configuration-steps-instructions" },
      view.work.instructions,
      "work.instructions",
    ],
  ];
  return parts.flatMap(([heading, lines, field]) =>
    lines === undefined || lines.length === 0
      ? []
      : [{ heading, lines, overridden: overridden.has(field) }],
  );
}

/** The fields of a version 1 document its work's details mark. */
const legacyDetailFields: ReadonlySet<OverrideField> = new Set([
  "worker.mode",
  "worker.setup",
  "worker.files",
  "practices",
]);

/** What the Overrides column names of the work: each marked detail as the
 * catalog's steps name it, then each prompt part by its field. */
function legacyOverridesOf(
  held: LegacyHeld,
  details: readonly ConfigurationStepDetail[],
): readonly CopyOrData[] {
  const { document, pinned, overridden } = held;
  return [
    ...stepsOverrideWordsOf(
      document,
      stepsModeChangeOf(document, pinned),
      details,
    ),
    ...[...overridden]
      .filter((field) => !legacyDetailFields.has(field))
      .map(overrideFieldLabel),
  ];
}

function legacyWorkRowOf(held: LegacyHeld): ConfigurationStepRow {
  const { view, document } = held;
  const commands = view.work.commands;
  const details = [
    ...legacyWorkDetailsOf(held),
    ...legacyDetail({ id: "configuration-steps-commands" }, commands, true),
  ];
  return stepsRow({
    step: { id: "ticket-steps-phase-work" },
    runs:
      commands === undefined
        ? { by: legacyAgentOf(document), from: undefined, more: 0 }
        : stepsCommandsRuns(commands),
    model:
      commands === undefined
        ? stepsModel(view.settings.model.label)
        : undefined,
    overrides: legacyOverridesOf(held, details),
    details,
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
  const model = stepsModel(view.settings.model.label);
  if (view.evaluations.length === 0)
    return view.review === undefined
      ? []
      : [
          stepsRow({
            step: { id: "configuration-steps-review" },
            runs: { by: agent, from: undefined, more: 0 },
            model,
            details: legacyDetail(
              { id: "configuration-steps-practices" },
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
      step: { id: "ticket-stage-number", args: { stage: String(index + 1) } },
      runs:
        evaluation.checks === undefined
          ? { by: agent, from: undefined, more: 0 }
          : stepsCommandsRuns(evaluation.checks),
      model: evaluation.checks === undefined ? model : undefined,
      details: [
        ...legacyDetail(
          { id: "configuration-steps-commands" },
          evaluation.checks,
          true,
        ),
        ...legacyDetail(
          { id: "configuration-steps-practices" },
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
