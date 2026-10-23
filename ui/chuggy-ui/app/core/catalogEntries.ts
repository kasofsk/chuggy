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

import type {
  CatalogFinalizer,
  CatalogPlanStage,
  CatalogWorkload,
  ConfigurationCatalog,
} from "./configurationCatalog.ts";

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
  readonly field: string;
}

export interface CatalogGroup {
  readonly kind: CatalogEntryKind;
  readonly title: string;
  readonly entries: readonly CatalogEntry[];
}

export interface CatalogEntries {
  /** The groups holding any entry, in the order the page lists them. */
  readonly groups: readonly CatalogGroup[];
  readonly byKey: ReadonlyMap<string, CatalogEntry>;
  readonly uses: ReadonlyMap<string, readonly CatalogReference[]>;
  readonly usedBy: ReadonlyMap<string, readonly CatalogReference[]>;
}

const catalogGroupTitles: Readonly<Record<CatalogEntryKind, string>> = {
  Workload: "Workloads",
  Plan: "Evaluation plans",
  Finalizer: "Finalizers",
  Prompt: "Prompts",
};

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
          field: `stage ${String(index + 1)} · ${stage.name}`,
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
    const at = `${reference.key}\u0000${reference.field}`;
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

const catalogDefaultLabels: Readonly<Record<CatalogDefaultRole, string>> = {
  work: "Default work",
  evaluation: "Default evaluation",
  finalization: "Default finalizer",
};

export function catalogDefaultLabel(role: CatalogDefaultRole): string {
  return catalogDefaultLabels[role];
}

function catalogFinalizerApproval(finalizer: CatalogFinalizer): string {
  return finalizer.approvalRequired ? "Approved first" : "Lands unapproved";
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
export function catalogEntrySummary(entry: CatalogEntry): string {
  const { detail } = entry;
  switch (detail.kind) {
    case "Workload": {
      const { workload } = detail;
      if (workload.runner === "Commands")
        return ["Commands", ...workload.commands].join(" · ");
      return [
        workload.model ?? workload.runner ?? "Unread",
        workload.promptPath ?? "inline prompt",
      ].join(" · ");
    }
    case "Plan":
      return detail.stages.map((stage) => stage.name).join(" → ");
    case "Finalizer":
      return [
        catalogFinalizerApproval(detail.finalizer),
        detail.finalizer.landing?.mode,
      ]
        .filter((part) => part !== undefined)
        .join(" · ");
    case "Prompt":
      return catalogPromptOpening(detail.text);
  }
}

/** What an entry says, field by field, as its detail lists it. */
export function catalogEntryFields(
  entry: CatalogEntry,
): readonly (readonly [label: string, value: string])[] {
  const { detail } = entry;
  switch (detail.kind) {
    case "Workload": {
      const { workload } = detail;
      const commanded = workload.runner === "Commands";
      return [
        ...(detail.path === undefined ? [] : [["File", detail.path] as const]),
        ["Runner", workload.runner ?? "Unread"],
        ["As an evaluator", workload.purpose],
        ...(commanded
          ? [["Commands", workload.commands.join("\n")] as const]
          : [
              ["Model", workload.model ?? "Unread"] as const,
              ["Prompt", workload.promptPath ?? "Written inline"] as const,
            ]),
      ];
    }
    case "Plan":
      return detail.stages.map(
        (stage, index) =>
          [
            `Stage ${String(index + 1)} · ${stage.name}`,
            stage.evaluators.join(", "),
          ] as const,
      );
    case "Finalizer": {
      const { finalizer } = detail;
      return [
        ["Approval", catalogFinalizerApproval(finalizer)],
        ...(finalizer.landing === undefined
          ? []
          : [
              [
                "Landing",
                [finalizer.landing.mode, finalizer.landing.target]
                  .filter((part) => part !== undefined)
                  .join(" → "),
              ] as const,
            ]),
      ];
    }
    case "Prompt":
      return [["Path", detail.path]];
  }
}
