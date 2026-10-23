/**
 * The catalog entries a ticket's YAML names, as references an author can look
 * through or take into the text.
 *
 * A NAME IS A REFERENCE, NOT A COPY. The ticket names the workload, plan and
 * finalizer it selects, and the catalog holds what each one is; the editor
 * shows that on request, a level at a time, and the text stays the names. A
 * plan's evaluators and a workload's prompt file are references in turn.
 *
 * MATERIALIZING IS HOW A TICKET OVERRIDES. A workload taken into the text is
 * written under `workloads` as its catalog holds it, and what the author then
 * changes there is what the ticket overrides; a prompt file taken into a
 * workload is written as its text. Plans and finalizers are only looked
 * through, since a ticket selects among them and overrides neither.
 *
 * This lives under `browser/` because the parser is a package the decision
 * layer may not reach; everything here is still pure.
 */

import { Document, isMap, isScalar, isSeq, parseDocument, Scalar } from "yaml";
import type { Node } from "yaml";

import { configurationCatalogOf } from "../../core/configurationCatalog.ts";
import {
  workloadShownOf,
  workloadWrittenOf,
} from "../../core/workloadOverrides.ts";
import { ticketYamlWorkloadUnset } from "./ticketYamlWorkloads.ts";

/** What a reference names in its catalog. */
export type TicketYamlFragmentKind =
  "Workload" | "Plan" | "Finalizer" | "Prompt";

/** Where a text a reference sits in is rooted: the ticket, or a fragment shown beneath one. */
export type TicketYamlFragmentRoot = "Ticket" | TicketYamlFragmentKind;

/** One name in a text that the catalog holds, and where it is written. */
export interface TicketYamlReference {
  readonly kind: TicketYamlFragmentKind;
  readonly name: string;
  readonly path: readonly (string | number)[];
  readonly from: number;
  readonly to: number;
  /** Which reference this is among a text's, stable while its path is. */
  readonly key: string;
}

/** One catalog, as the fragments its names resolve to. */
export interface TicketYamlCatalog {
  /** What a name shows when looked through: YAML for an entry, the text for a prompt. */
  fragment(kind: TicketYamlFragmentKind, name: string): string | undefined;
}

type FragmentRecord = Readonly<Record<string, unknown>>;

function fragmentIsRecord(value: unknown): value is FragmentRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fragmentEntries(value: unknown): FragmentRecord {
  return fragmentIsRecord(value) ? value : {};
}

/** The prompt texts a catalog's import stored, by the path each was read from. */
function fragmentPrompts(
  workloads: FragmentRecord,
): ReadonlyMap<string, string> {
  return new Map(
    Object.values(workloads).flatMap((workload) => {
      const prompt = fragmentEntries(workload)["prompt"];
      const held = fragmentEntries(prompt);
      return typeof held["path"] === "string" &&
        typeof held["text"] === "string"
        ? [[held["path"], held["text"]] as const]
        : [];
    }),
  );
}

function fragmentYaml(value: unknown): string {
  return new Document(value).toString({ lineWidth: 0, nullStr: "" });
}

/** The catalog these bytes are, none where they are any other configuration. */
export function ticketYamlCatalogOf(
  canonical: string,
): TicketYamlCatalog | undefined {
  if (configurationCatalogOf(canonical) === undefined) return undefined;
  const document = JSON.parse(canonical) as FragmentRecord;
  const workloads = fragmentEntries(document["workloads"]);
  const plans = fragmentEntries(document["plans"]);
  const finalizers = fragmentEntries(document["finalizers"]);
  const prompts = fragmentPrompts(workloads);
  return {
    fragment(kind, name) {
      switch (kind) {
        case "Workload":
          return Object.hasOwn(workloads, name)
            ? fragmentYaml(workloadWrittenOf(workloads[name]))
            : undefined;
        case "Plan":
          return Object.hasOwn(plans, name)
            ? fragmentYaml(plans[name])
            : undefined;
        case "Finalizer":
          return Object.hasOwn(finalizers, name)
            ? fragmentYaml(workloadShownOf(finalizers[name]))
            : undefined;
        case "Prompt":
          return prompts.get(name);
      }
    },
  };
}

/** What a scalar at a path below a root names, none where it names nothing. */
function ticketYamlReferenceKind(
  root: TicketYamlFragmentRoot,
  path: readonly (string | number)[],
): TicketYamlFragmentKind | undefined {
  const [first, second, third, fourth] = path;
  switch (root) {
    case "Ticket":
      if (first === "selection" && path.length === 2)
        return second === "work"
          ? "Workload"
          : second === "evaluation"
            ? "Plan"
            : second === "finalization"
              ? "Finalizer"
              : undefined;
      return first === "workloads" &&
        third === "prompt" &&
        fourth === "path" &&
        path.length === 4
        ? "Prompt"
        : undefined;
    case "Plan":
      return second === "evaluators" && path.length === 3
        ? "Workload"
        : undefined;
    case "Workload":
      return first === "prompt" && second === "path" && path.length === 2
        ? "Prompt"
        : undefined;
    case "Finalizer":
    case "Prompt":
      return undefined;
  }
}

/** Every name in a text that its catalog holds, in the order written. */
export function ticketYamlReferences(
  source: string,
  root: TicketYamlFragmentRoot,
  catalog: TicketYamlCatalog,
): readonly TicketYamlReference[] {
  if (root === "Prompt") return [];
  const found: TicketYamlReference[] = [];
  const walk = (node: unknown, path: readonly (string | number)[]): void => {
    if (isMap(node)) {
      for (const pair of node.items)
        if (isScalar(pair.key) && typeof pair.key.value === "string")
          walk(pair.value, [...path, pair.key.value]);
      return;
    }
    if (isSeq(node)) {
      node.items.forEach((item, index) => {
        walk(item, [...path, index]);
      });
      return;
    }
    if (!isScalar(node) || typeof node.value !== "string") return;
    const kind = ticketYamlReferenceKind(root, path);
    const range = (node as Node).range;
    if (
      kind === undefined ||
      range === undefined ||
      range === null ||
      catalog.fragment(kind, node.value) === undefined
    )
      return;
    found.push({
      kind,
      name: node.value,
      path,
      from: range[0],
      to: range[1],
      key: JSON.stringify(path),
    });
  };
  walk(parseDocument(source).contents, []);
  return found;
}

/** Whether a reference can be taken into a ticket's text: a workload, or a prompt file inside one taken already. */
export function ticketYamlMaterializable(
  root: TicketYamlFragmentRoot,
  reference: TicketYamlReference,
): boolean {
  if (reference.kind === "Workload") return true;
  return (
    reference.kind === "Prompt" &&
    root === "Ticket" &&
    reference.path[0] === "workloads"
  );
}

/**
 * A ticket's text with one reference taken into it: a workload written under
 * `workloads` as its catalog holds it, with the fields it does not set as
 * comments, unless the text already holds it; a prompt file written in place
 * as its text. None where the text no longer parses or no longer says what
 * the reference was read from.
 */
export function ticketYamlMaterialized(
  source: string,
  reference: TicketYamlReference,
  catalog: TicketYamlCatalog,
): string | undefined {
  const document = parseDocument(source);
  if (document.errors.length > 0 || !isMap(document.contents)) return undefined;
  const fragment = catalog.fragment(reference.kind, reference.name);
  if (fragment === undefined) return undefined;
  if (reference.kind === "Prompt") {
    if (document.getIn(reference.path) !== reference.name) return undefined;
    const text = new Scalar(fragment);
    text.type = Scalar.BLOCK_LITERAL;
    document.setIn(reference.path.slice(0, -1), document.createNode({}));
    document.setIn([...reference.path.slice(0, -1), "text"], text);
    return document.toString({ lineWidth: 0, nullStr: "" });
  }
  if (reference.kind !== "Workload") return undefined;
  const path = ["workloads", reference.name];
  if (document.hasIn(path)) return source;
  const parsed = parseDocument(fragment);
  if (!isMap(parsed.contents)) return undefined;
  parsed.contents.comment = ticketYamlWorkloadUnset(parsed.toJSON()) ?? null;
  if (!document.hasIn(["workloads"]))
    document.set("workloads", document.createNode({}));
  document.setIn(path, parsed.contents);
  return document.toString({ lineWidth: 0, nullStr: "" });
}
