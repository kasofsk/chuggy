/**
 * An editor open on a server draft that something else may revise: the
 * revision what is on screen stands on, what a newer one does to it, and what
 * the editor says about it.
 *
 * A FORM NOBODY HAS TOUCHED HOLDS NOTHING OF ITS OWN, so it is drawn again from
 * each revision that arrives. A touched one — typed into as a form, or holding
 * YAML of its author's, which may say what no form does — is never redrawn
 * under its author: a revision past the one it stands on leaves it behind, and
 * its author either takes theirs, dropping what was typed, or keeps theirs,
 * which then stands on that revision and replaces it whole, every field as
 * the editor holds it, rather than being refused for being behind it. A
 * revision this editor wrote itself moves what it stands on without asking,
 * being what it sent.
 *
 * A DRAFT THAT CLOSES UNDER THE EDITOR IS SAID. Deleted, it is nothing a submit
 * could write to; released where it opened unreleased, it is the ticket a
 * submit would have made. Nothing is judged while the editor's own submit
 * runs, its own writes being what arrives then.
 */

import type { DraftResponse } from "../../../../src/contract/responses.ts";

import type { CreationDraftHeld } from "./ticketCreationRun.ts";
import type { Copy } from "./copy.ts";

export interface DraftFollowHeld<Form> {
  /** The revision the form is drawn from and judged touched against. */
  readonly base: DraftResponse;
  /** The version what is typed stands on: the base's, or an older one that a
   * copy this browser kept was typed over. */
  readonly version: number;
  /** What was typed over the base, absent until something is. */
  readonly edited: Form | undefined;
  /** Whether YAML of the author's is on screen. */
  readonly authored: boolean;
  /** How many times the form has been drawn afresh from a revision, which
   * the YAML is written again from each time. */
  readonly seeding: number;
}

/** What this browser kept of a YAML typed on this draft: the version it was
 * typed over, where one was kept beside it. */
export interface DraftFollowKept {
  readonly version: number | undefined;
}

/** What the editor sees each time it is drawn. */
export interface DraftFollowObserved {
  /** The draft as the project's cache holds it now. */
  readonly current: DraftResponse;
  /** The draft as this editor's own last write left it, where one did. */
  readonly own: DraftResponse | undefined;
  /** Whether this editor's own submit is running. */
  readonly busy: boolean;
}

export type DraftFollowClosed =
  | { readonly standing: "Released"; readonly ticket: number }
  | { readonly standing: "Deleted"; readonly ticket: number };

export type DraftFollowStanding =
  | { readonly standing: "Current" }
  | { readonly standing: "Behind"; readonly current: DraftResponse }
  | DraftFollowClosed;

/**
 * The editor as it opens on a draft. A YAML copy this browser kept stands on
 * the version kept beside it, and one kept with none on the draft as it is
 * now, there being nothing to say it is older.
 */
export function draftFollowOpened<Form>(
  current: DraftResponse,
  kept: DraftFollowKept | undefined,
): DraftFollowHeld<Form> {
  const now = current.authoringVersion;
  return {
    base: current,
    version: Math.min(kept?.version ?? now, now),
    edited: undefined,
    authored: kept !== undefined,
    seeding: 0,
  };
}

function draftFollowAgrees<Form>(a: Form, b: Form): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether the editor holds anything its base does not say. */
export function draftFollowTouched<Form>(
  held: DraftFollowHeld<Form>,
  formOf: (draft: DraftResponse) => Form,
): boolean {
  if (held.authored) return true;
  return (
    held.edited !== undefined &&
    !draftFollowAgrees(held.edited, formOf(held.base))
  );
}

/** Whether what the form holds says anything its base does not, which is
 * what a save of it would write. */
export function draftFollowEdited<Form>(form: Form, initial: Form): boolean {
  return !draftFollowAgrees(form, initial);
}

/** Whether an editor standing here may save what it holds to its draft:
 * not one that closed under it, there being nothing left to write to. */
export function draftFollowSaveable(standing: DraftFollowStanding): boolean {
  return standing.standing === "Current" || standing.standing === "Behind";
}

/** The newer of two revisions of one draft, either of which may be absent:
 * what an editor's own writes left it at. */
export function draftFollowNewest(
  a: DraftResponse | undefined,
  b: DraftResponse | undefined,
): DraftResponse | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a.authoringVersion >= b.authoringVersion ? a : b;
}

/** A draft that is nothing left to release, read as a screen that would
 * release it opens. */
export function draftFollowClosedOf(
  draft: DraftResponse,
): DraftFollowClosed | undefined {
  switch (draft.state) {
    case "Draft":
      return undefined;
    case "Released":
      return { standing: "Released", ticket: draft.ticket };
    case "Deleted":
      return { standing: "Deleted", ticket: draft.ticket };
  }
}

/** A draft closed under the editor: deleted, or released where its base was
 * not, a released ticket's own draft staying released as it is revised. */
function draftFollowClosedUnder<Form>(
  held: DraftFollowHeld<Form>,
  current: DraftResponse,
): DraftFollowClosed | undefined {
  if (current.state === "Released" && held.base.state !== "Draft")
    return undefined;
  return draftFollowClosedOf(current);
}

/** Where the editor stands against the draft it observes. */
export function draftFollowStandingOf<Form>(
  held: DraftFollowHeld<Form>,
  observed: DraftFollowObserved,
  formOf: (draft: DraftResponse) => Form,
): DraftFollowStanding {
  if (observed.busy) return { standing: "Current" };
  const closed = draftFollowClosedUnder(held, observed.current);
  if (closed !== undefined) return closed;
  const behind =
    observed.current.authoringVersion > held.version &&
    draftFollowTouched(held, formOf);
  return behind
    ? { standing: "Behind", current: observed.current }
    : { standing: "Current" };
}

/** What is typed, now standing on another revision. */
function draftFollowOnto<Form>(
  held: DraftFollowHeld<Form>,
  draft: DraftResponse,
): DraftFollowHeld<Form> {
  return { ...held, base: draft, version: draft.authoringVersion };
}

/** Taking theirs: the form drawn afresh from the draft, and nothing typed kept. */
export function draftFollowTaken<Form>(
  held: DraftFollowHeld<Form>,
  current: DraftResponse,
): DraftFollowHeld<Form> {
  return {
    base: current,
    version: current.authoringVersion,
    edited: undefined,
    authored: false,
    seeding: held.seeding + 1,
  };
}

/** Keeping one's own: what is typed, standing on the draft as it is now. */
export function draftFollowKept<Form>(
  held: DraftFollowHeld<Form>,
  current: DraftResponse,
): DraftFollowHeld<Form> {
  return draftFollowOnto(held, current);
}

/**
 * The editor after what it observes, the same value where nothing moves it: an
 * own write newer than its base stands it there, and a newer revision redraws
 * it only where nothing is touched.
 */
export function draftFollowed<Form>(
  held: DraftFollowHeld<Form>,
  observed: DraftFollowObserved,
  formOf: (draft: DraftResponse) => Form,
): DraftFollowHeld<Form> {
  const { current, own } = observed;
  if (observed.busy || draftFollowClosedUnder(held, current) !== undefined)
    return held;
  if (
    own !== undefined &&
    own.authoringVersion > held.version &&
    own.authoringVersion >= current.authoringVersion
  )
    return draftFollowOnto(held, own);
  if (current.authoringVersion <= held.version) return held;
  return draftFollowTouched(held, formOf)
    ? held
    : draftFollowTaken(held, current);
}

/**
 * The draft a creation following it goes back to: the one its last submit
 * wrote, or its base where none has. Once the version stood on has moved past
 * what that submit wrote, the body it was written from is no longer known to
 * be what the draft holds.
 */
export function draftFollowCreationHeld(
  attempted: CreationDraftHeld | undefined,
  onto: { readonly base: DraftResponse; readonly version: number },
  operation: string,
): CreationDraftHeld {
  if (attempted === undefined)
    return {
      draft: onto.base,
      origin: "Followed",
      body: undefined,
      operation,
      unsettled: false,
    };
  return attempted.draft.authoringVersion < onto.version
    ? { ...attempted, body: undefined }
    : attempted;
}

export function draftFollowBehindSentence(ticket: number): Copy {
  return { id: "drafts-behind", args: { ticket: String(ticket) } };
}

export const draftFollowBehindChoice: Copy = { id: "drafts-behind-choice" };

export function draftFollowClosedSentence(closed: DraftFollowClosed): Copy {
  const args = { ticket: String(closed.ticket) };
  switch (closed.standing) {
    case "Released":
      return { id: "drafts-closed-released", args };
    case "Deleted":
      return { id: "drafts-closed-deleted", args };
  }
}
