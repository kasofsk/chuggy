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
 * A START IS ONLY FOR A READER WHO HAS SAID NOTHING. Once they pick an entry
 * or type a name the field holds what they said, or nothing where the offer
 * cannot hold it, whatever a later answer of either read makes the offer. A
 * start put where the reader had spoken would be a workspace they did not
 * choose, in a form they can send.
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

type ProjectCreationWorkspaceChoice = Extract<
  ProjectCreationWorkspaceOffer,
  { readonly offer: "Choice" }
>;

/**
 * What the reader last said of the workspace, nothing until they touch the
 * field: the workspace they picked, the making of one and the name typed for
 * it, or a name typed into the free text.
 */
export type ProjectCreationWorkspaceSaid =
  | { readonly said: "Picked"; readonly tenant: string }
  | { readonly said: "Making"; readonly name: string }
  | { readonly said: "Typed"; readonly name: string }
  | undefined;

/** The name what the reader said carries, which a pick's is its workspace's. */
function projectCreationWorkspaceSaidName(
  said: ProjectCreationWorkspaceSaid,
): string | undefined {
  if (said === undefined) return undefined;
  return said.said === "Picked" ? said.tenant : said.name;
}

function projectCreationWorkspaceEntryHeld(
  offer: ProjectCreationWorkspaceChoice,
  tenant: string,
): ProjectCreationWorkspaceEntry | undefined {
  return offer.entries.find(
    (entry) => entry.entry === "Held" && entry.tenant === tenant,
  );
}

function projectCreationWorkspaceEntryNew(
  offer: ProjectCreationWorkspaceChoice,
): ProjectCreationWorkspaceEntry | undefined {
  return offer.entries.find((entry) => entry.entry === "New");
}

/**
 * The entry the form stands on, or none. It is where the choice starts only
 * for a reader who has said nothing, and after that the entry that holds what
 * they said: the workspace picked or typed, or the making of one for a name
 * no entry is called.
 */
export function projectCreationWorkspaceChosen(
  offer: ProjectCreationWorkspaceChoice,
  said: ProjectCreationWorkspaceSaid,
): ProjectCreationWorkspaceEntry | undefined {
  if (said === undefined) return offer.start;
  switch (said.said) {
    case "Picked":
      return projectCreationWorkspaceEntryHeld(offer, said.tenant);
    case "Making":
      return projectCreationWorkspaceEntryNew(offer);
    case "Typed":
      return (
        projectCreationWorkspaceEntryHeld(offer, said.name) ??
        (said.name === "" ? undefined : projectCreationWorkspaceEntryNew(offer))
      );
  }
}

/**
 * The workspace name the form sends, and the name its typed field holds where
 * one is drawn. It is empty where nothing is offered yet or no entry is
 * chosen, which no form sends, and free text holds its start only until the
 * reader has said something.
 */
export function projectCreationWorkspaceTenant(
  offer: ProjectCreationWorkspaceOffer,
  said: ProjectCreationWorkspaceSaid,
): string {
  switch (offer.offer) {
    case "Pending":
    case "Withheld":
      return "";
    case "Typed":
      return projectCreationWorkspaceSaidName(said) ?? offer.name;
    case "Choice": {
      const chosen = projectCreationWorkspaceChosen(offer, said);
      if (chosen === undefined) return "";
      return chosen.entry === "Held"
        ? chosen.tenant
        : (projectCreationWorkspaceSaidName(said) ?? "");
    }
  }
}

/** What the reader says by picking an entry. The making of a workspace keeps
 * the name the form already holds for it, and has none otherwise. */
export function projectCreationWorkspacePicked(
  offer: ProjectCreationWorkspaceChoice,
  said: ProjectCreationWorkspaceSaid,
  picked: ProjectCreationWorkspaceEntry,
): ProjectCreationWorkspaceSaid {
  if (picked.entry === "Held") return { said: "Picked", tenant: picked.tenant };
  const making = projectCreationWorkspaceChosen(offer, said)?.entry === "New";
  return {
    said: "Making",
    name: making ? projectCreationWorkspaceTenant(offer, said) : "",
  };
}

/** What the reader says by typing into the box an offer draws: under a choice
 * the name of the workspace being made, and in free text the workspace. */
export function projectCreationWorkspaceNamed(
  offer: ProjectCreationWorkspaceOffer,
  name: string,
): ProjectCreationWorkspaceSaid {
  return offer.offer === "Choice"
    ? { said: "Making", name }
    : { said: "Typed", name };
}
