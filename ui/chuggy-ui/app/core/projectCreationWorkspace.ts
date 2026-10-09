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
 * Either read failing leaves the field the free text it is without them, so a
 * failure costs nobody the form.
 *
 * The first read lists a bounded number of workspaces and says where it was
 * cut short. The choice holds the ones listed and says nothing of the rest.
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
 * starting on `name`, a choice starting on `start`, or the empty state that
 * replaces the whole form.
 */
export type ProjectCreationWorkspaceOffer =
  | { readonly offer: "Pending" }
  | { readonly offer: "Typed"; readonly name: string }
  | {
      readonly offer: "Choice";
      readonly entries: readonly ProjectCreationWorkspaceEntry[];
      readonly start: ProjectCreationWorkspaceEntry;
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

function projectCreationWorkspaceEntries(
  held: AccessCallerTenants,
  creation: boolean,
): readonly ProjectCreationWorkspaceEntry[] {
  return [
    ...held.tenants
      .filter((listed) => listed.administer)
      .map((listed) => ({ entry: "Held" as const, tenant: listed.tenant })),
    ...(creation ? [{ entry: "New" as const }] : []),
  ];
}

/**
 * The offer under the two reads and the workspace the address names. The
 * choice starts on the named workspace where it holds it and on its first
 * entry otherwise, which is the making of one for a reader who holds none.
 */
export function projectCreationWorkspaceOffer(
  held: PanelState<AccessCallerTenants>,
  abilities: PanelState<AccessSiteAbilities>,
  named: string | undefined,
): ProjectCreationWorkspaceOffer {
  if (
    held.state === "Failed" ||
    held.state === "Absent" ||
    abilities.state === "Failed"
  )
    return { offer: "Typed", name: named ?? "" };
  if (held.state === "Pending" || abilities.state === "Pending")
    return { offer: "Pending" };
  const entries = projectCreationWorkspaceEntries(
    held.value,
    siteWorkspaceOffered(
      abilities.state === "Ready" ? abilities.value : undefined,
    ),
  );
  const first = entries[0];
  if (first === undefined)
    return {
      offer: "Withheld",
      ...(held.value.tenants.length === 0
        ? projectCreationWithheldUnheld
        : projectCreationWithheldUnadministered),
    };
  const start = entries.find(
    (entry) => entry.entry === "Held" && entry.tenant === named,
  );
  return { offer: "Choice", entries, start: start ?? first };
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

/** The entry the form stands on: the reader's own pick while the choice holds
 * it, and where the choice starts otherwise. */
export function projectCreationWorkspaceChosen(
  offer: Extract<ProjectCreationWorkspaceOffer, { readonly offer: "Choice" }>,
  picked: ProjectCreationWorkspaceEntry | undefined,
): ProjectCreationWorkspaceEntry {
  if (picked === undefined) return offer.start;
  return (
    offer.entries.find((entry) =>
      projectCreationWorkspaceSame(entry, picked),
    ) ?? offer.start
  );
}

/**
 * The workspace name the form sends, and the name its typed field holds where
 * one is drawn. It is empty where nothing is offered yet, which no form sends.
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
      return chosen.entry === "Held" ? chosen.tenant : (edits.typed ?? "");
    }
  }
}
