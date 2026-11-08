/**
 * The motions a creation screen makes: reading what a ticket would be created
 * against, creating and releasing one in a single submit, and — for a Pending
 * ticket's edit — revising its draft and releasing the update in one.
 *
 * What a ticket may be drawn under is walked to here — the bindings first,
 * then the listing, newest first, until it decides the offer or a bounded
 * number of pages ends — and each offered revision's initialization is read in
 * the same motion, because a revision without its defaults is not something a
 * form can be drawn from, and a choice among them is then one no request
 * waits on. The release and the dispatch after it are each followed by
 * `followOperation` out of one attempts budget, the dispatch starting from the
 * attempts its release spent, so this module adds no budget of its own.
 *
 * A CREATION DISPATCHES THE TICKET IT RELEASED, FOR A READER WHO MAY. The
 * ticket exists from the moment its release settles, so nothing its dispatch
 * meets ends the submit any other way: a ticket that is no candidate, a
 * dispatch view that could not be read, a refusal, a deferral and a follow
 * that ran out of budget all hand back the ticket, as a release alone does,
 * and its page offers `Dispatch` wherever a press is still what starts it. A
 * deferral is the API saying not now, so the follow is ended where it meets
 * one rather than waited through: the ticket's page is where a deferred
 * dispatch is drawn and pressed again.
 *
 * A DRAFT THAT WAS CREATED AND NOT RELEASED IS HANDED BACK. The release is the
 * half that can be refused on its own, and a retry that created a second draft
 * would leave the first behind for a human to find. It comes back beside what
 * it was written from, so the next submit sends that release again where the
 * form says the same. Where it says anything else the draft is read before it
 * is written: a release nobody saw settle may have made the ticket, and a
 * revision whose answer was lost may have moved the version, so what a form
 * holds of its draft is never what a write to it is fenced by — unless the
 * form follows that draft, and names the version what it says stands on.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  DraftResponse,
  ProjectRepositoryResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type {
  draftCreationSchema,
  draftRevisionSchema,
} from "../../../../src/contract/requests.ts";
import type { z } from "zod";

import { epicDraftRefusal } from "./epics.ts";
import {
  apiCreateDraft,
  apiDraft,
  apiDraftInitialization,
  apiProjectRepositories,
  apiReviseDraft,
  apiTicketDispatchView,
} from "./apiRoutes.ts";
import type { ApiFailure, ApiPorts, ApiResult } from "./apiRequest.ts";
import { ConsoleWriteRefused } from "./consoleWrite.ts";
import { operationAbandonWords } from "./codeLabels.ts";
import {
  draftRevisionFailureSentence,
  draftRevisionRefusalSentence,
  operationFailureSentence,
  operationRefusalSentence,
  operationStateSentence,
} from "./codeSentences.ts";
import {
  followOperation,
  operationAbandonFailure,
  operationFinished,
} from "./operationFollow.ts";
import type { OperationStep } from "./operationFollow.ts";
import { projectListReread } from "./projectQueryKeys.ts";
import type { ProjectList } from "./projectQueryKeys.ts";
import { readProjectConfigurations } from "./repositoryConfigurations.ts";
import { manualDispatchActionOf } from "./ticketActions.ts";
import {
  creationConfigurationsDecided,
  creationConfigurationsOffered,
  creationReleaseMutation,
  creationRepositories,
} from "./ticketCreation.ts";
import type { CreationOffer, CreationOfferListed } from "./ticketCreation.ts";
import { ticketUpdateMutation } from "./ticketEdit.ts";
import type { Copy, CopyText } from "./copy.ts";

export type CreationContext =
  | {
      readonly context: "Ready";
      /** What a ticket here may be drawn under, by name and never none. */
      readonly offers: readonly CreationOffer[];
      /** Whether some offer may be missing: the page budget ended the walk
       * before the listing decided them, more are declared than one read
       * draws, or one's initialization could not be read. */
      readonly partial: boolean;
      /** What the project binds, which decides whether the form asks for one,
       * what it offers, and the finalization each one defaults to. Oldest first, as
       * the listing answers. */
      readonly repositories: readonly ProjectRepositoryResponse[];
    }
  | { readonly context: "NoRepository" }
  | { readonly context: "NoReadyConfiguration" }
  | { readonly context: "ReadyConfigurationUnknown" };

/** What a context with no configuration in it says: no repository to hold one,
 * no ready one in a repository, and not knowing, each apart. */
export function creationContextSentence(
  context: Exclude<CreationContext, { context: "Ready" }>,
): Copy {
  switch (context.context) {
    case "NoRepository":
      return { id: "ticket-authoring-context-no-repository" };
    case "NoReadyConfiguration":
      return { id: "ticket-authoring-context-no-configuration" };
    case "ReadyConfigurationUnknown":
      return { id: "ticket-authoring-context-unknown" };
  }
}

type CreationBody = z.infer<typeof draftCreationSchema>;

/** A draft a submit wrote and did not release. */
export interface DraftHeld {
  readonly draft: DraftResponse;
}

/**
 * The same as a creation's next submit finds it: beside the body the draft
 * was last written from, and the operation its release went under. The API
 * keys a submission by that identity, so the same release sent again under it
 * asks about the one already made, where a fresh one would make a second.
 */
export interface CreationDraftHeld extends DraftHeld {
  /** Whether a submit of this form created the draft, or the form follows one
   * written elsewhere, which its endings say nothing of this form doing. */
  readonly origin: "Created" | "Followed";
  /** Absent once something else is known to have written the draft since. */
  readonly body: CreationBody | undefined;
  readonly operation: string;
  /** Whether a release of the draft was sent that nobody saw settle. */
  readonly unsettled: boolean;
}

/** Every form's held draft, by the form's own key, kept until a ticket is
 * made of it or a submit hands on none. */
export type CreationDraftsHeld = Readonly<Record<string, CreationDraftHeld>>;

export function creationDraftHeldOf(
  helds: CreationDraftsHeld,
  storeKey: string,
): CreationDraftHeld | undefined {
  return helds[storeKey];
}

/** What a submit's ending hands on to the next, and none dropping the one
 * held before it. */
export function creationDraftsHeldWith(
  helds: CreationDraftsHeld,
  storeKey: string,
  held: CreationDraftHeld | undefined,
): CreationDraftsHeld {
  const written: Record<string, CreationDraftHeld> = { ...helds };
  if (held === undefined) delete written[storeKey];
  else written[storeKey] = held;
  return written;
}

export interface TicketCreationRequest {
  readonly body: CreationBody;
  /** What a release nothing has sent yet goes under. */
  readonly operation: string;
  readonly held?: CreationDraftHeld | undefined;
  /** What the dispatch of the ticket this makes goes under, absent for a
   * reader who may not dispatch, whose submit sends none. */
  readonly dispatchOperation?: string | undefined;
  /** The draft version the form stands on, where it follows its held draft;
   * absent, the held draft is revised at whatever version it is read at. */
  readonly expectedVersion?: number | undefined;
}

export type TicketCreated<Held extends DraftHeld = DraftHeld> =
  | { readonly created: "Created"; readonly ticket: number }
  | { readonly created: "Stale"; readonly reason: string }
  | {
      readonly created: "Refused";
      readonly reason: string;
      readonly held: Held | undefined;
      /** The held draft's read, where its failing is why nothing was written. */
      readonly unread?: ApiFailure | undefined;
      /** What the API answered the release, where it answered a failure. */
      readonly released?: ApiFailure | undefined;
    };

/**
 * How a creation's submit ends: as any submit does, or at the ticket an
 * earlier release of its draft had made, to which this one wrote nothing.
 */
export type TicketCreationEnded =
  | TicketCreated<CreationDraftHeld>
  | {
      readonly created: "Exists";
      readonly ticket: number;
      readonly held: CreationDraftHeld;
    };

/** A creation's submit that made no ticket. */
export type TicketCreationUnmade = Exclude<
  TicketCreationEnded,
  { readonly created: "Created" }
>;

/** An edit's submit that released no update. */
export type TicketUpdateUnmade = Exclude<
  TicketCreated,
  { readonly created: "Created" }
>;

/** A creation's submit thrown as its refusal: the sentence its screen draws,
 * beside how it ended, which holds the draft the next submit goes back to,
 * and the failure that ended it, the held draft's read or its release. */
export class TicketCreationRefused extends ConsoleWriteRefused {
  readonly ended: TicketCreationUnmade;

  constructor(sentence: string, ended: TicketCreationUnmade) {
    super(
      sentence,
      ended.created === "Refused"
        ? (ended.unread ?? ended.released)
        : undefined,
    );
    this.ended = ended;
  }
}

/** An edit's submit thrown as its refusal, beside how it ended and the
 * failure its release was answered with. */
export class TicketUpdateRefused extends ConsoleWriteRefused {
  readonly ended: TicketUpdateUnmade;

  constructor(sentence: string, ended: TicketUpdateUnmade) {
    super(sentence, ended.created === "Refused" ? ended.released : undefined);
    this.ended = ended;
  }
}

/** The conflict a creation route answers where the fence this body carries moved. */
export const creationStaleSentence: Copy = { id: "ticket-authoring-stale" };

/** The same conflict where the project could not be read again after it, so the
 * form still stands on what it was opened over. */
export const creationStaleUnreadSentence: Copy = {
  id: "ticket-authoring-stale-unread",
};

/** The conflict it answers instead where the project takes no new ticket at any fence. */
export const creationProjectNotActiveSentence: Copy = {
  id: "ticket-authoring-project-inactive",
};

/** The version fence of a held draft, which it is read for just before it is
 * written, so only a writer in between meets it. */
export const creationDraftChangedSentence: Copy = {
  id: "ticket-authoring-draft-changed",
};

/** Where a held draft stands as far as its form knows, which every later
 * submit goes back to whatever the form then says. */
export function creationDraftHeldSentence(held: CreationDraftHeld): Copy {
  const args = { ticket: String(held.draft.ticket) };
  if (held.origin === "Followed")
    return held.unsettled
      ? { id: "ticket-authoring-draft-followed-unsettled", args }
      : { id: "ticket-authoring-draft-followed-unreleased", args };
  return held.unsettled
    ? { id: "ticket-authoring-draft-kept-unsettled", args }
    : { id: "ticket-authoring-draft-kept-unreleased", args };
}

/** What a submit did to a held draft it could not read, which it reads before
 * it writes. */
export const creationDraftUnreadSentence: Copy = {
  id: "ticket-authoring-draft-unread",
};

/** A held draft read as deleted: one this form created is let go of, and one
 * it follows is still all it could release. */
export function creationDraftDeletedSentence(held: CreationDraftHeld): Copy {
  const args = { ticket: String(held.draft.ticket) };
  return held.origin === "Followed"
    ? { id: "ticket-authoring-draft-deleted-followed", args }
    : { id: "ticket-authoring-draft-deleted-created", args };
}

/** What a submit says of a ticket it found already made of its draft,
 * whether this form released it earlier or it was released elsewhere: what
 * was typed after that release is not in it. */
export function creationTicketExistsSentence(held: CreationDraftHeld): Copy {
  return {
    id: "ticket-authoring-ticket-exists",
    args: { ticket: String(held.draft.ticket) },
  };
}

/** How many offers one read draws, each being a request of its own. */
export const creationOffersMax = 32;

/**
 * Each offered revision beside its own initialization, read together. One
 * that cannot be read is left out and said to be, the rest being as drawable
 * without it; where none can be read, the first failure is the read's outcome.
 */
async function creationOffersRead(
  ports: ApiPorts,
  partition: PartitionIdentity,
  offered: readonly CreationOfferListed[],
): Promise<
  ApiResult<{
    readonly offers: readonly CreationOffer[];
    readonly unread: boolean;
  }>
> {
  const read = await Promise.all(
    offered.map(async (one) => ({
      one,
      initialized: await apiDraftInitialization(ports, partition, one.revision),
    })),
  );
  const offers: CreationOffer[] = [];
  let failed: ApiFailure | undefined;
  for (const { one, initialized } of read) {
    if (initialized.outcome === "Ok")
      offers.push({
        name: one.name,
        listed: one.listed,
        initialization: initialized.value,
      });
    else failed ??= initialized;
  }
  if (failed !== undefined && offers.length === 0) return failed;
  return { outcome: "Ok", value: { offers, unread: failed !== undefined } };
}

/**
 * What a project offering nothing is, with the ways of finding nothing kept
 * apart: the budget ran out, no live binding is there to declare one, or
 * nothing declared is ready.
 */
function creationContextUnoffered(
  repositories: readonly ProjectRepositoryResponse[],
  partial: boolean,
): CreationContext {
  if (partial) return { context: "ReadyConfigurationUnknown" };
  return {
    context:
      creationRepositories(repositories).length === 0
        ? "NoRepository"
        : "NoReadyConfiguration",
  };
}

/** The one list the creation screen reads under, the context being the
 * project's rather than any one revision's. */
export const creationContextName = "creation";

/**
 * Where the creation context is held, and what makes it stale.
 *
 * Every `Configuration` frame does, because the context is whichever revisions
 * are offered and the frame's own revision does not say which those now are —
 * a newer commit's import changes the answer without ever appearing in the
 * entry the screen holds.
 */
export function creationContextList(
  partition: PartitionIdentity,
): ProjectList<CreationContext> {
  return projectListReread<CreationContext>(
    partition,
    "Configuration",
    creationContextName,
  );
}

/** The configurations a ticket may be drawn under, each with the defaults it
 * is fenced with, and what the project binds. */
export async function readCreationContext(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<CreationContext>> {
  const bound = await apiProjectRepositories(ports, partition, {
    reach: false,
  });
  if (bound.outcome !== "Ok") return bound;
  const repositories = bound.value.repositories;
  const walked = await readProjectConfigurations(
    ports,
    partition,
    true,
    (held) => creationConfigurationsDecided(held, repositories),
  );
  if (walked.outcome !== "Ok") return walked;
  const { configurations, partial } = walked.value;
  const offered = creationConfigurationsOffered(configurations, repositories);
  if (offered.length === 0)
    return {
      outcome: "Ok",
      value: creationContextUnoffered(repositories, partial),
    };
  const read = await creationOffersRead(
    ports,
    partition,
    offered.slice(0, creationOffersMax),
  );
  if (read.outcome !== "Ok") return read;
  return {
    outcome: "Ok",
    value: {
      context: "Ready",
      offers: read.value.offers,
      partial:
        partial || read.value.unread || offered.length > creationOffersMax,
      repositories,
    },
  };
}

async function creationDraftCreated(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: TicketCreationRequest,
  text: CopyText,
): Promise<CreationDraftHeld | TicketCreationEnded> {
  const { body, operation } = request;
  const answered = await apiCreateDraft(ports, partition, body);
  if (answered.outcome === "Ok")
    return {
      draft: answered.value,
      origin: "Created",
      body,
      operation,
      unsettled: false,
    };
  const epicRefusal =
    body.epic === undefined ? undefined : epicDraftRefusal(answered);
  if (epicRefusal !== undefined)
    return { created: "Refused", reason: epicRefusal, held: undefined };
  if (answered.outcome === "Conflict" && answered.code !== "ProjectNotActive")
    return { created: "Stale", reason: text(creationStaleSentence) };
  return {
    created: "Refused",
    reason:
      answered.outcome === "Conflict"
        ? text(creationProjectNotActiveSentence)
        : text(operationFailureSentence(answered)),
    held: undefined,
  };
}

/** What a revision writes of a body, which is all of it but the fence. A
 * revision replaces the whole draft, so overrides or a selection left out
 * here would be cleared by it and a form changed in them alone would read as
 * unchanged. */
function creationRevisionOf(
  body: CreationBody,
): Omit<z.infer<typeof draftRevisionSchema>, "expectedVersion"> {
  return {
    configurationRevision: body.configurationRevision,
    authoring: body.authoring,
    brief: body.brief,
    ...(body.overrides === undefined ? {} : { overrides: body.overrides }),
    ...(body.selection === undefined ? {} : { selection: body.selection }),
  };
}

/** What a form following a draft revises it to, fenced at the version what
 * is typed stands on. */
export function creationRevisionAt(
  body: CreationBody,
  expectedVersion: number,
): z.infer<typeof draftRevisionSchema> {
  return { expectedVersion, ...creationRevisionOf(body) };
}

/** How saving a following form's edits to its draft ended: the revision it
 * wrote, or why it wrote none. */
export type DraftSaveEnded =
  | { readonly saved: "Saved"; readonly draft: DraftResponse }
  | { readonly saved: "Refused"; readonly reason: string };

/**
 * A following form's edits written to its draft and nothing more: no release,
 * and a draft revised past the version the revision is fenced at refused
 * rather than written over.
 */
export async function draftRevisionSaved(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
  revision: z.infer<typeof draftRevisionSchema>,
  text: CopyText,
): Promise<DraftSaveEnded> {
  const revised = await apiReviseDraft(ports, partition, ticket, revision);
  if (revised.outcome === "Ok") return { saved: "Saved", draft: revised.value };
  return {
    saved: "Refused",
    reason:
      revised.outcome === "Conflict" && revised.code === "DraftChanged"
        ? text(creationDraftChangedSentence)
        : text(draftRevisionFailureSentence(revised)),
  };
}

/** Whether a held draft was written from what this body would write to it. */
function creationDraftHolds(
  held: CreationDraftHeld,
  body: CreationBody,
): boolean {
  if (held.body === undefined) return false;
  return (
    JSON.stringify(creationRevisionOf(held.body)) ===
    JSON.stringify(creationRevisionOf(body))
  );
}

/** A submit that made no ticket and still holds a draft, saying where it stands. */
function creationRefused(
  reason: string,
  held: CreationDraftHeld,
  text: CopyText,
  failed: { readonly unread?: ApiFailure; readonly released?: ApiFailure } = {},
): TicketCreationEnded {
  return {
    created: "Refused",
    reason: text({
      id: "ticket-authoring-joined",
      args: { first: reason, second: creationDraftHeldSentence(held) },
    }),
    held,
    ...failed,
  };
}

/**
 * What a draft read as no longer one ends its submit in: released, it is the
 * ticket this form set out to make, and deleted, it is nothing a later submit
 * can go back to.
 */
function creationDraftClosed(
  draft: DraftResponse,
  held: CreationDraftHeld,
  text: CopyText,
): TicketCreationEnded | undefined {
  switch (draft.state) {
    case "Draft":
      return undefined;
    case "Released":
      return { created: "Exists", ticket: draft.ticket, held };
    case "Deleted":
      return {
        created: "Refused",
        reason: text(creationDraftDeletedSentence(held)),
        held: undefined,
      };
  }
}

/**
 * A held draft revised to what the form now says, at the version the form
 * stands on or else the one its door has it at now, and only while it is
 * still a draft. A revision that does not get through leaves what is held as
 * it was, the next one reading the draft again; a door that calls the draft
 * closed has said it is one no longer.
 */
async function creationDraftRevised(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: TicketCreationRequest,
  held: CreationDraftHeld,
  text: CopyText,
): Promise<CreationDraftHeld | TicketCreationEnded> {
  const { body, operation } = request;
  const ticket = held.draft.ticket;
  const read = await apiDraft(ports, partition, ticket);
  if (read.outcome !== "Ok")
    return creationRefused(text(creationDraftUnreadSentence), held, text, {
      unread: read,
    });
  const closed = creationDraftClosed(read.value, held, text);
  if (closed !== undefined) return closed;
  const revised = await apiReviseDraft(ports, partition, ticket, {
    expectedVersion: request.expectedVersion ?? read.value.authoringVersion,
    ...creationRevisionOf(body),
  });
  if (revised.outcome === "Ok")
    return { ...held, draft: revised.value, body, operation };
  if (revised.outcome !== "Conflict")
    return creationRefused(
      text(draftRevisionFailureSentence(revised)),
      held,
      text,
    );
  return revised.code === "DraftChanged"
    ? creationRefused(text(creationDraftChangedSentence), held, text)
    : creationRefused(
        text(draftRevisionFailureSentence(revised)),
        { ...held, unsettled: true },
        text,
      );
}

/**
 * The draft one submit releases, written to what the form now says: created
 * where none is held, the held one as it stands where it already says so, and
 * otherwise the held one revised, whose release is another mutation and so
 * goes under the operation this submit drew.
 */
async function creationDraftWritten(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: TicketCreationRequest,
  text: CopyText,
): Promise<CreationDraftHeld | TicketCreationEnded> {
  const { body, held } = request;
  if (held === undefined)
    return creationDraftCreated(ports, partition, request, text);
  if (creationDraftHolds(held, body)) return held;
  return creationDraftRevised(ports, partition, request, held, text);
}

function releasedTicket<Held extends DraftHeld>(
  step: OperationStep,
  held: Held,
  text: CopyText,
): TicketCreated<Held> {
  if (step.step === "Abandoned") {
    const released = operationAbandonFailure(step);
    return {
      created: "Refused",
      reason: text(operationAbandonWords(step.cause).word),
      held,
      ...(released === undefined ? {} : { released }),
    };
  }
  if (step.step !== "Settled")
    return {
      created: "Refused",
      reason: text({ id: "ticket-authoring-release-unfinished" }),
      held,
    };
  if (step.state === "Succeeded")
    return { created: "Created", ticket: held.draft.ticket };
  return {
    created: "Refused",
    reason: text(
      step.refusal === undefined
        ? operationStateSentence(step.state)
        : operationRefusalSentence(step.refusal),
    ),
    held,
  };
}

/**
 * Whether a release that made no ticket leaves one unseen: a refusal the
 * actor settled was decided over a draft still unreleased, and a settlement
 * that decided nothing, or a submission the API declined before it accepted
 * one, leaves what was known before it. Every other ending is the console
 * giving up on finding out.
 */
function creationReleaseUnsettled(
  step: OperationStep,
  accepted: boolean,
  written: CreationDraftHeld,
): boolean {
  if (step.step === "Settled")
    return step.state === "Refused" ? false : written.unsettled;
  const declined = step.step === "Abandoned" && step.refused && !accepted;
  return declined ? written.unsettled : true;
}

/**
 * A release refused because its draft is not as it was released from, which
 * the draft is read once to explain: released, an earlier release made the
 * ticket; still a draft, something else wrote it, and it holds this form no
 * longer.
 */
async function creationDraftFencedOut(
  ports: ApiPorts,
  partition: PartitionIdentity,
  reason: string,
  written: CreationDraftHeld,
  text: CopyText,
): Promise<TicketCreationEnded> {
  const read = await apiDraft(ports, partition, written.draft.ticket);
  if (read.outcome !== "Ok")
    return creationRefused(reason, { ...written, unsettled: true }, text);
  return (
    creationDraftClosed(read.value, written, text) ??
    creationRefused(
      reason,
      { ...written, body: undefined, unsettled: false },
      text,
    )
  );
}

/**
 * The ticket a release made, dispatched where the dispatch view lists it as a
 * candidate, at the version that view gives it, and followed from the
 * `attempts` its release had spent until it settles or the API defers it. It
 * answers nothing, the ticket being there whatever this meets.
 */
async function creationTicketDispatched(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
  operation: string,
  attempts: number,
): Promise<void> {
  const view = await apiTicketDispatchView(ports, partition, ticket);
  if (view.outcome !== "Ok") return;
  const dispatch = manualDispatchActionOf(ticket, view.value);
  if (dispatch === undefined) return;
  const deferred = new AbortController();
  await followOperation(
    ports,
    partition,
    { operation, mutation: dispatch.mutation },
    ticket,
    (step) => {
      if (step.step === "Backlogged") deferred.abort();
    },
    deferred.signal,
    { step: "Submitting", attempts },
  );
}

/**
 * One submit: the draft is written to what the form says, released and
 * followed to settlement, and the ticket that makes dispatched where the
 * request names what its dispatch goes under. Only a settled release is a
 * ticket to navigate to, and it is one whatever its dispatch came to.
 */
export async function createAndReleaseTicket(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: TicketCreationRequest,
  onStep: (step: OperationStep) => void,
  text: CopyText,
): Promise<TicketCreationEnded> {
  const written = await creationDraftWritten(ports, partition, request, text);
  if ("created" in written) return written;
  const seen = { accepted: false, attempts: 0 };
  const followed = await followOperation(
    ports,
    partition,
    {
      operation: written.operation,
      mutation: creationReleaseMutation(written.draft),
    },
    written.draft.ticket,
    (step) => {
      if (step.step === "Following") seen.accepted = true;
      if (!operationFinished(step)) seen.attempts = step.attempts;
      onStep(step);
    },
  );
  const step = followed.step;
  const released = releasedTicket(step, written, text);
  const dispatchOperation = request.dispatchOperation;
  if (released.created === "Created" && dispatchOperation !== undefined)
    await creationTicketDispatched(
      ports,
      partition,
      released.ticket,
      dispatchOperation,
      seen.attempts,
    );
  if (released.created !== "Refused") return released;
  if (step.step === "Settled" && step.refusal?.type === "AuthoringChanged")
    return creationDraftFencedOut(
      ports,
      partition,
      released.reason,
      written,
      text,
    );
  return creationRefused(
    released.reason,
    {
      ...written,
      unsettled: creationReleaseUnsettled(step, seen.accepted, written),
    },
    text,
    released.released === undefined ? {} : { released: released.released },
  );
}

export interface TicketUpdateRequest {
  /** The ticket as read, whose revision is the one the update is written against. */
  readonly ticket: TicketResponse;
  readonly body: z.infer<typeof draftRevisionSchema>;
  readonly operation: string;
}

/**
 * One edit: the draft revised, and the revision released as the ticket's update
 * and followed to settlement, a refusal handing back the draft that holds it.
 * Each submit revises again under a fresh operation, which `TicketRevisionStale`
 * makes safe against a ticket an earlier one already moved.
 */
export async function reviseAndUpdateTicket(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: TicketUpdateRequest,
  onStep: (step: OperationStep) => void,
  text: CopyText,
): Promise<TicketCreated> {
  const ticket = request.ticket.ticket;
  const revised = await apiReviseDraft(ports, partition, ticket, request.body);
  if (revised.outcome !== "Ok")
    return revised.outcome === "Conflict" && revised.code === "DraftChanged"
      ? {
          created: "Stale",
          reason: text(draftRevisionRefusalSentence("DraftChanged")),
        }
      : {
          created: "Refused",
          reason: text(draftRevisionFailureSentence(revised)),
          held: undefined,
        };
  const followed = await followOperation(
    ports,
    partition,
    {
      operation: request.operation,
      mutation: ticketUpdateMutation(request.ticket, revised.value),
    },
    ticket,
    onStep,
  );
  return releasedTicket(followed.step, { draft: revised.value }, text);
}
