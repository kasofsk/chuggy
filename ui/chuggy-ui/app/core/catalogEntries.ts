/**
 * A catalog as the Catalog page draws it: every entry in a group by what it
 * is, what each one says in a line and in fields, and which entries it names
 * and is named by.
 *
 * A PROMPT IS AN ENTRY OF ITS OWN, though the catalog stores none: it is a
 * file a workload names, kept beside the workload with the text its import
 * read, and two workloads naming one file name one entry. A prompt written
 * inline is the workload's own and no entry.
 *
 * A WORKLOAD'S FILE IS SAID ONLY WHERE THE IMPORT KEPT IT. An import before
 * imports kept the file a workload was read from says nothing of where it
 * was written, so a workload with no file is not drawn as written inline.
 *
 * A DEFAULT IS A BADGE, NOT A USE. A ticket may select any workload, plan or
 * finalizer, so the defaults say only what a ticket selecting none runs, and
 * an entry nothing names is still one a ticket can choose.
 */

import {
  finalizationLine,
  finalizationMethodLabel,
  gitMergePolicyLabel,
} from "./codeLabels.ts";
import {
  catalogFinalizerApproval,
  catalogWorkloadModel,
} from "./configurationCatalog.ts";
import type {
  CatalogFinalizer,
  CatalogPlanStage,
  CatalogWorkload,
  ConfigurationCatalog,
} from "./configurationCatalog.ts";
import type { Copy, CopyOrData, CopyText } from "./copy.ts";
import { copyOrDataText } from "./copy.ts";

export type CatalogEntryKind = "Workload" | "Plan" | "Finalizer" | "Prompt";

/** The field of a ticket's selection an entry is the catalog's default for. */
export type CatalogDefaultRole = "work" | "evaluation" | "finalization";

export type CatalogEntryDetail =
  | {
      readonly kind: "Workload";
      readonly workload: CatalogWorkload;
      /** The repository file the import read the workload from, where it kept one. */
      readonly path: string | undefined;
    }
  | {
      readonly kind: "Plan";
      readonly stages: readonly CatalogPlanStage[];
    }
  | { readonly kind: "Finalizer"; readonly finalizer: CatalogFinalizer }
  | { readonly kind: "Prompt"; readonly path: string; readonly text: string };

export interface CatalogEntry {
  /** Which entry this is among the catalog's, and what the page's address names it by. */
  readonly key: string;
  readonly name: string;
  readonly detail: CatalogEntryDetail;
  readonly defaults: readonly CatalogDefaultRole[];
}

/** One entry naming another, and the field of the naming one it is named in. */
export interface CatalogReference {
  readonly key: string;
  readonly name: string;
  /** The field's name as the document writes it, or the stage it is named in. */
  readonly field: CopyOrData;
}

/** Which reference this is among an entry's, by what it names and where. */
export function catalogReferenceAt(reference: CatalogReference): string {
  return `${reference.key}\u0000${JSON.stringify(reference.field)}`;
}

export interface CatalogGroup {
  readonly kind: CatalogEntryKind;
  readonly title: Copy;
  readonly entries: readonly CatalogEntry[];
}

export interface CatalogEntries {
  /** The groups holding any entry, in the order the page lists them. */
  readonly groups: readonly CatalogGroup[];
  readonly byKey: ReadonlyMap<string, CatalogEntry>;
  readonly uses: ReadonlyMap<string, readonly CatalogReference[]>;
  readonly usedBy: ReadonlyMap<string, readonly CatalogReference[]>;
}

const catalogGroupTitles: Readonly<Record<CatalogEntryKind, Copy>> = {
  Workload: { id: "configuration-catalog-group-workloads" },
  Plan: { id: "configuration-catalog-group-plans" },
  Finalizer: { id: "configuration-catalog-group-landings" },
  Prompt: { id: "configuration-catalog-group-prompts" },
};

const catalogKindLabels: Readonly<Record<CatalogEntryKind, Copy>> = {
  Workload: { id: "configuration-catalog-kind-workload" },
  Plan: { id: "configuration-catalog-kind-plan" },
  Finalizer: { id: "configuration-catalog-kind-landing" },
  Prompt: { id: "configuration-catalog-kind-prompt" },
};

/** What an entry is, as the word beside its name. */
export function catalogKindLabel(kind: CatalogEntryKind): Copy {
  return catalogKindLabels[kind];
}

const catalogKeyPrefixes: Readonly<Record<CatalogEntryKind, string>> = {
  Workload: "workloads",
  Plan: "plans",
  Finalizer: "finalizers",
  Prompt: "prompts",
};

export function catalogEntryKey(kind: CatalogEntryKind, name: string): string {
  return `${catalogKeyPrefixes[kind]}/${name}`;
}

/** The prompt files the catalog's workloads name, each with the text its import read. */
function catalogPrompts(
  catalog: ConfigurationCatalog,
): readonly (readonly [path: string, text: string])[] {
  const held = new Map<string, string>();
  for (const workload of catalog.workloads)
    if (workload.promptPath !== undefined && !held.has(workload.promptPath))
      held.set(workload.promptPath, workload.prompt ?? "");
  return [...held];
}

function catalogEntryOf(
  detail: CatalogEntryDetail,
  name: string,
  defaults: readonly CatalogDefaultRole[],
): CatalogEntry {
  return {
    key: catalogEntryKey(detail.kind, name),
    name,
    detail,
    defaults,
  };
}

function catalogDefaultsOf(
  catalog: ConfigurationCatalog,
  role: CatalogDefaultRole,
  name: string,
): readonly CatalogDefaultRole[] {
  return catalog.defaults[role] === name ? [role] : [];
}

/** Every reference one entry makes, each to the entry it names. */
function catalogUsesOf(entry: CatalogEntry): readonly CatalogReference[] {
  const { detail } = entry;
  switch (detail.kind) {
    case "Workload":
      return detail.workload.promptPath === undefined
        ? []
        : [
            {
              key: catalogEntryKey("Prompt", detail.workload.promptPath),
              name: detail.workload.promptPath,
              field: "prompt.path",
            },
          ];
    case "Plan":
      return detail.stages.flatMap((stage, index) =>
        stage.evaluators.map((evaluator) => ({
          key: catalogEntryKey("Workload", evaluator),
          name: evaluator,
          field: {
            id: "configuration-catalog-stage-field",
            args: { number: index + 1, name: stage.name },
          },
        })),
      );
    case "Finalizer":
    case "Prompt":
      return [];
  }
}

/** The same reference made twice, as a stage running one evaluator twice makes it, drawn once. */
function catalogReferencesDistinct(
  references: readonly CatalogReference[],
): readonly CatalogReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const at = catalogReferenceAt(reference);
    if (seen.has(at)) return false;
    seen.add(at);
    return true;
  });
}

/** Every entry of the catalog, in its group, in the order the page lists them. */
function catalogEntriesGroups(
  catalog: ConfigurationCatalog,
  workloadPaths: Readonly<Record<string, string>>,
): readonly CatalogGroup[] {
  return [
    {
      kind: "Workload",
      title: catalogGroupTitles.Workload,
      entries: catalog.workloads.map((workload) =>
        catalogEntryOf(
          {
            kind: "Workload",
            workload,
            path: Object.hasOwn(workloadPaths, workload.name)
              ? workloadPaths[workload.name]
              : undefined,
          },
          workload.name,
          catalogDefaultsOf(catalog, "work", workload.name),
        ),
      ),
    },
    {
      kind: "Plan",
      title: catalogGroupTitles.Plan,
      entries: [...catalog.plans].map(([name, stages]) =>
        catalogEntryOf(
          { kind: "Plan", stages },
          name,
          catalogDefaultsOf(catalog, "evaluation", name),
        ),
      ),
    },
    {
      kind: "Finalizer",
      title: catalogGroupTitles.Finalizer,
      entries: catalog.finalizers.map((finalizer) =>
        catalogEntryOf(
          { kind: "Finalizer", finalizer },
          finalizer.name,
          catalogDefaultsOf(catalog, "finalization", finalizer.name),
        ),
      ),
    },
    {
      kind: "Prompt",
      title: catalogGroupTitles.Prompt,
      entries: catalogPrompts(catalog).map(([path, text]) =>
        catalogEntryOf({ kind: "Prompt", path, text }, path, []),
      ),
    },
  ];
}

export function catalogEntriesOf(
  catalog: ConfigurationCatalog,
  workloadPaths: Readonly<Record<string, string>> = {},
): CatalogEntries {
  const groups = catalogEntriesGroups(catalog, workloadPaths);
  const entries = groups.flatMap((group) => group.entries);
  const uses = new Map(
    entries.map((entry) => [
      entry.key,
      catalogReferencesDistinct(catalogUsesOf(entry)),
    ]),
  );
  const usedBy = new Map<string, CatalogReference[]>();
  for (const entry of entries)
    for (const use of uses.get(entry.key) ?? []) {
      const by = usedBy.get(use.key) ?? [];
      by.push({ key: entry.key, name: entry.name, field: use.field });
      usedBy.set(use.key, by);
    }
  return {
    groups: groups.filter((group) => group.entries.length > 0),
    byKey: new Map(entries.map((entry) => [entry.key, entry])),
    uses,
    usedBy: new Map(
      [...usedBy].map(([key, by]) => [key, catalogReferencesDistinct(by)]),
    ),
  };
}

const catalogDefaultLabels: Readonly<Record<CatalogDefaultRole, Copy>> = {
  work: { id: "configuration-catalog-default-work" },
  evaluation: { id: "configuration-catalog-default-evaluation" },
  finalization: { id: "configuration-catalog-default-landing" },
};

export function catalogDefaultLabel(role: CatalogDefaultRole): Copy {
  return catalogDefaultLabels[role];
}

/** A workload's model, or what it runs where it names none. */
function catalogEntryRuns(workload: CatalogWorkload): CopyOrData {
  return (
    catalogWorkloadModel(workload) ??
    workload.runner ?? { id: "configuration-catalog-unread" }
  );
}

/** The first line of a prompt that says anything, its heading marks dropped. */
function catalogPromptOpening(text: string): string {
  const line = text
    .split("\n")
    .map((held) => held.replace(/^#+\s*/u, "").trim())
    .find((held) => held !== "");
  return line ?? "";
}

/** What an entry is, in the one line under its name in the list. */
export function catalogEntrySummary(
  entry: CatalogEntry,
  text: CopyText,
): string {
  const { detail } = entry;
  switch (detail.kind) {
    case "Workload": {
      const { workload } = detail;
      if (workload.runner === "Commands")
        return [
          text({ id: "configuration-catalog-commands" }),
          ...workload.commands,
        ].join(" · ");
      return [
        copyOrDataText(text, catalogEntryRuns(workload)),
        workload.promptPath ??
          text({ id: "configuration-catalog-prompt-inline" }),
      ].join(" · ");
    }
    case "Plan":
      return detail.stages.map((stage) => stage.name).join(" → ");
    case "Finalizer":
      return [
        text(catalogFinalizerApproval(detail.finalizer)),
        detail.finalizer.finalization === undefined
          ? undefined
          : text(finalizationMethodLabel(detail.finalizer.finalization)),
      ]
        .filter((part) => part !== undefined)
        .join(" · ");
    case "Prompt":
      return catalogPromptOpening(detail.text);
  }
}

/** What a workload says, field by field: a command list where it runs
 * commands, and its model and prompt where an agent runs it. */
function catalogWorkloadFields<Field>(
  detail: Extract<CatalogEntry["detail"], { kind: "Workload" }>,
  field: (label: Copy, value: CopyOrData) => Field,
): readonly Field[] {
  const { workload } = detail;
  const unread: Copy = { id: "configuration-catalog-unread" };
  const commanded = workload.runner === "Commands";
  return [
    ...(detail.path === undefined
      ? []
      : [field({ id: "configuration-catalog-field-file" }, detail.path)]),
    field(
      { id: "configuration-catalog-field-runner" },
      workload.runner ?? unread,
    ),
    field({ id: "configuration-catalog-field-evaluator" }, workload.purpose),
    ...(commanded
      ? [
          field(
            { id: "configuration-catalog-commands" },
            workload.commands.join("\n"),
          ),
        ]
      : [
          field(
            { id: "configuration-catalog-field-model" },
            catalogWorkloadModel(workload) ?? unread,
          ),
          field(
            { id: "configuration-catalog-field-prompt" },
            workload.promptPath ?? {
              id: "configuration-catalog-prompt-written-inline",
            },
          ),
        ]),
  ];
}

/** What an entry says, field by field, as its detail lists it. */
export function catalogEntryFields(
  entry: CatalogEntry,
  text: CopyText,
): readonly (readonly [label: string, value: string])[] {
  const { detail } = entry;
  const field = (label: Copy, value: CopyOrData) =>
    [text(label), copyOrDataText(text, value)] as const;
  switch (detail.kind) {
    case "Workload":
      return catalogWorkloadFields(detail, field);
    case "Plan":
      return detail.stages.map((stage, index) =>
        field(
          {
            id: "configuration-catalog-stage",
            args: { number: index + 1, name: stage.name },
          },
          stage.evaluators.join(", "),
        ),
      );
    case "Finalizer": {
      const { finalizer } = detail;
      const finalization = finalizer.finalization;
      return [
        field(
          { id: "configuration-catalog-field-approval" },
          catalogFinalizerApproval(finalizer),
        ),
        ...(finalization === undefined
          ? []
          : [
              field(
                { id: "configuration-catalog-field-landing" },
                finalizationLine(finalization),
              ),
            ]),
        ...(finalization?.kind === "GitMerge"
          ? [
              field(
                { id: "configuration-catalog-field-policy" },
                gitMergePolicyLabel(finalization.policy),
              ),
            ]
          : []),
      ];
    }
    case "Prompt":
      return [field({ id: "configuration-catalog-field-path" }, detail.path)];
  }
}
