/**
 * The workspace a new project goes in, as the form's `Workspace` field offers
 * it: a choice among the workspaces the reader may add a project to, the
 * making of one at its end for a reader the site lets make one, where the
 * choice starts, and what stands in for the form where it would hold nothing.
 *
 * Two reads decide it: the reader's own workspaces, and what they may do on
 * the site, which answers nothing to a reader who may do none of it and is
 * read as that. A workspace is an entry where its read says the reader
 * administers it, which is what the api asks of whoever adds a project there.
 *
 * THE CHOICE NEVER STARTS ON A GUESS. Nothing moves or removes a project, so
 * one made in the wrong workspace stays there. The choice starts on the
 * workspace the address names where that is an entry, else on the only
 * workspace there is to choose, else on the making of one where there is none,
 * and among several it starts on nothing and the form sends nothing until the
 * reader says which.
 *
 * Either read failing leaves the field the free text it is without them, so a
 * failure costs nobody the form. The first read lists a bounded number of
 * workspaces and says where it was cut short, and an answer cut short leaves
 * free text as well: a choice among part of them would keep the reader out of
 * the rest.
 */

import type {
  AccessCallerTenants,
  AccessSiteAbilities,
} from "../../../../src/contract/accessPlane.ts";

import type { PanelState } from "./freshness.ts";
import { siteWorkspaceOffered } from "./siteWorkspaces.ts";

/** One entry of the choice: a workspace the reader may add a project to, or
 * the making of one. */
export type ProjectCreationWorkspaceEntry =
  | { readonly entry: "Held"; readonly tenant: string }
  | { readonly entry: "New" };

/** What the entry that makes a workspace is called. */
const projectCreationWorkspaceNewText = "New workspace";

export function projectCreationWorkspaceEntryText(
  entry: ProjectCreationWorkspaceEntry,
): string {
  switch (entry.entry) {
    case "Held":
      return entry.tenant;
    case "New":
      return projectCreationWorkspaceNewText;
  }
}

/** The empty state of a reader no workspace holds, who may make none. */
const projectCreationWithheldUnheld = {
  label: "No workspace",
  detail: "A new workspace needs an invite link",
} as const;

/** The empty state of a reader some workspace holds and none as its admin. */
const projectCreationWithheldUnadministered = {
  label: "No workspace to add to",
  detail: "A workspace admin adds projects",
} as const;

/**
 * What stands where the form says its workspace: nothing yet, free text
 * starting on `name`, a choice starting on `start` or on no entry, or the
 * empty state that replaces the whole form.
 */
export type ProjectCreationWorkspaceOffer =
  | { readonly offer: "Pending" }
  | { readonly offer: "Typed"; readonly name: string }
  | {
      readonly offer: "Choice";
      readonly entries: readonly ProjectCreationWorkspaceEntry[];
      readonly start: ProjectCreationWorkspaceEntry | undefined;
    }
  | {
      readonly offer: "Withheld";
      readonly label: string;
      readonly detail: string;
    };

/** The offers a form is drawn under, which the one that replaces it is not. */
export type ProjectCreationWorkspaceDrawn = Exclude<
  ProjectCreationWorkspaceOffer,
  { readonly offer: "Withheld" }
>;

type ProjectCreationWorkspaceHeld = Extract<
  ProjectCreationWorkspaceEntry,
  { readonly entry: "Held" }
>;

function projectCreationWorkspaceAdministered(
  held: AccessCallerTenants,
): readonly ProjectCreationWorkspaceHeld[] {
  return held.tenants
    .filter((listed) => listed.administer)
    .map((listed) => ({ entry: "Held", tenant: listed.tenant }));
}

/** The offer under the two reads and the workspace the address names. */
export function projectCreationWorkspaceOffer(
  held: PanelState<AccessCallerTenants>,
  abilities: PanelState<AccessSiteAbilities>,
  named: string | undefined,
): ProjectCreationWorkspaceOffer {
  const typed = { offer: "Typed", name: named ?? "" } as const;
  if (held.state === "Failed" || held.state === "Absent") return typed;
  if (held.state === "Pending") return { offer: "Pending" };
  if (held.value.truncated) return typed;
  const administered = projectCreationWorkspaceAdministered(held.value);
  const sole = administered.length === 1 ? administered[0] : undefined;
  if (abilities.state === "Failed")
    return { offer: "Typed", name: named ?? sole?.tenant ?? "" };
  if (abilities.state === "Pending") return { offer: "Pending" };
  const entries: readonly ProjectCreationWorkspaceEntry[] = [
    ...administered,
    ...(siteWorkspaceOffered(
      abilities.state === "Ready" ? abilities.value : undefined,
    )
      ? [{ entry: "New" as const }]
      : []),
  ];
  const first = entries[0];
  if (first === undefined)
    return {
      offer: "Withheld",
      ...(held.value.tenants.length === 0
        ? projectCreationWithheldUnheld
        : projectCreationWithheldUnadministered),
    };
  return {
    offer: "Choice",
    entries,
    start:
      administered.find((entry) => entry.tenant === named) ??
      sole ??
      (administered.length === 0 ? first : undefined),
  };
}

function projectCreationWorkspaceSame(
  one: ProjectCreationWorkspaceEntry,
  other: ProjectCreationWorkspaceEntry,
): boolean {
  return one.entry === "Held"
    ? other.entry === "Held" && other.tenant === one.tenant
    : other.entry === "New";
}

/** What the reader did to the field: the entry they picked and the name they
 * typed, each nothing until they do. */
export interface ProjectCreationWorkspaceEdits {
  readonly picked: ProjectCreationWorkspaceEntry | undefined;
  readonly typed: string | undefined;
}

/** The edits after a pick. Picking a workspace drops a name typed for a new
 * one, so no later state of the field sends a name its reader left. */
export function projectCreationWorkspacePicked(
  edits: ProjectCreationWorkspaceEdits,
  picked: ProjectCreationWorkspaceEntry,
): ProjectCreationWorkspaceEdits {
  return { picked, typed: picked.entry === "New" ? edits.typed : undefined };
}

/** The entry the form stands on, or none: the reader's own pick while the
 * choice holds it, and where the choice starts otherwise. */
export function projectCreationWorkspaceChosen(
  offer: Extract<ProjectCreationWorkspaceOffer, { readonly offer: "Choice" }>,
  picked: ProjectCreationWorkspaceEntry | undefined,
): ProjectCreationWorkspaceEntry | undefined {
  if (picked === undefined) return offer.start;
  return (
    offer.entries.find((entry) =>
      projectCreationWorkspaceSame(entry, picked),
    ) ?? offer.start
  );
}

/**
 * The workspace name the form sends, and the name its typed field holds where
 * one is drawn. It is empty where nothing is offered yet or no entry is
 * chosen, which no form sends.
 */
export function projectCreationWorkspaceTenant(
  offer: ProjectCreationWorkspaceOffer,
  edits: ProjectCreationWorkspaceEdits,
): string {
  switch (offer.offer) {
    case "Pending":
    case "Withheld":
      return "";
    case "Typed":
      return edits.typed ?? offer.name;
    case "Choice": {
      const chosen = projectCreationWorkspaceChosen(offer, edits.picked);
      if (chosen === undefined) return "";
      return chosen.entry === "Held" ? chosen.tenant : (edits.typed ?? "");
    }
  }
}
