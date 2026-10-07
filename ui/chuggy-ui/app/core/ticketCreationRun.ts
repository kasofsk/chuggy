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
 * waits on. Release reuses `followOperation`, whose one budget spans the whole
 * follow, so this module adds no second wait.
 *
 * A DRAFT THAT WAS CREATED AND NOT RELEASED IS HANDED BACK. The release is the
 * half that can be refused on its own, and a retry that created a second draft
 * would leave the first behind for a human to find. It comes back beside what
 * it was written from, so the next submit sends that release again where the
 * form says the same. Where it says anything else the draft is read before it
 * is written: a release nobody saw settle may have made the ticket, and a
 * revision whose answer was lost may have moved the version, so what a form
 * holds of its draft is never what a write to it is fenced by.
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

import {
  apiCreateDraft,
  apiDraft,
  apiDraftInitialization,
  apiProjectRepositories,
  apiReviseDraft,
  configurationPagesMax,
} from "./apiRoutes.ts";
import type { ApiFailure, ApiPorts, ApiResult } from "./apiRequest.ts";
import { panelReason } from "./freshness.ts";
import {
  draftRevisionFailureSentence,
  draftRevisionRefusalSentence,
  operationFailureSentence,
  operationRefusalSentence,
  operationStateSentence,
} from "./codeSentences.ts";
import { followOperation } from "./operationFollow.ts";
import type { OperationStep } from "./operationFollow.ts";
import { projectListReread } from "./projectQueryKeys.ts";
import type { ProjectList } from "./projectQueryKeys.ts";
import { readProjectConfigurations } from "./repositoryConfigurations.ts";
import {
  creationConfigurationsDecided,
  creationConfigurationsOffered,
  creationReleaseMutation,
} from "./ticketCreation.ts";
import type { CreationOffer, CreationOfferListed } from "./ticketCreation.ts";
import { ticketUpdateMutation } from "./ticketEdit.ts";

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
       * what it offers, and the landing each one defaults to. Oldest first, as
       * the listing answers. */
      readonly repositories: readonly ProjectRepositoryResponse[];
    }
  | { readonly context: "NoRepository" }
  | { readonly context: "NoReadyConfiguration" }
  | {
      readonly context: "ReadyConfigurationUnknown";
      readonly pagesRead: number;
    };

/** What a context with no configuration in it says: no repository to hold one,
 * no ready one in a repository, and not knowing, each apart. */
export function creationContextSentence(
  context: Exclude<CreationContext, { context: "Ready" }>,
): string {
  switch (context.context) {
    case "NoRepository":
      return "No repository bound";
    case "NoReadyConfiguration":
      return "No configuration";
    case "ReadyConfigurationUnknown":
      return `the newest ${String(context.pagesRead)} pages of this project's revisions offer no ready configuration, so this console could not find one to shape a ticket with`;
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
  /** Absent once something else is known to have written the draft since. */
  readonly body: CreationBody | undefined;
  readonly operation: string;
  /** Whether a release of the draft was sent that nobody saw settle. */
  readonly unsettled: boolean;
}

export interface TicketCreationRequest {
  readonly body: CreationBody;
  /** What a release nothing has sent yet goes under. */
  readonly operation: string;
  readonly held?: CreationDraftHeld | undefined;
}

export type TicketCreated<Held extends DraftHeld = DraftHeld> =
  | { readonly created: "Created"; readonly ticket: number }
  | { readonly created: "Stale"; readonly reason: string }
  | {
      readonly created: "Refused";
      readonly reason: string;
      readonly held: Held | undefined;
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

/** The one conflict a creation route answers: the fence this body carries moved. */
export const creationStaleSentence =
  "the project moved while this form was open — it has been read again, so submitting now uses the current one";

/** The version fence of a held draft, which it is read for just before it is
 * written, so only a writer in between meets it. */
export const creationDraftChangedSentence =
  "the draft was revised somewhere else while this was being written to it, so this was not written";

/** Where a held draft stands as far as its form knows, and what every later
 * submit does with it whatever the form then says. */
export function creationDraftHeldSentence(held: CreationDraftHeld): string {
  const draft = `draft ${String(held.draft.ticket)}`;
  const standing = held.unsettled
    ? `${draft} was created, and whether it was released is not known`
    : `${draft} was created and not released`;
  return `${standing}; submitting again goes back to that draft rather than creating another`;
}

/** A held draft that could not be read, which is read before it is written. */
export function creationDraftUnreadSentence(failure: ApiFailure): string {
  return `the draft could not be read, so nothing was written to it: ${panelReason(failure)}`;
}

/** A held draft read as deleted, which no later submit goes back to. */
export function creationDraftDeletedSentence(ticket: number): string {
  return `draft ${String(ticket)} was deleted, so there is nothing of it left to release; submitting again creates another`;
}

/** What a submit says of a ticket it found already made of its draft. */
export function creationTicketExistsSentence(ticket: number): string {
  return `#${String(ticket)} already exists: an earlier release of this draft went through, and what has been changed here since is not in it`;
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
 * apart: the budget ran out, nothing is bound to declare one, or nothing
 * declared is ready.
 */
function creationContextUnoffered(
  repositories: readonly ProjectRepositoryResponse[],
  partial: boolean,
): CreationContext {
  if (partial)
    return {
      context: "ReadyConfigurationUnknown",
      pagesRead: configurationPagesMax,
    };
  return {
    context:
      repositories.length === 0 ? "NoRepository" : "NoReadyConfiguration",
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
  const bound = await apiProjectRepositories(ports, partition);
  if (bound.outcome !== "Ok") return bound;
  const repositories = bound.value.repositories;
  const walked = await readProjectConfigurations(ports, partition, (held) =>
    creationConfigurationsDecided(held, repositories),
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
): Promise<CreationDraftHeld | TicketCreationEnded> {
  const { body, operation } = request;
  const answered = await apiCreateDraft(ports, partition, body);
  if (answered.outcome === "Ok")
    return { draft: answered.value, body, operation, unsettled: false };
  return answered.outcome === "Conflict"
    ? { created: "Stale", reason: creationStaleSentence }
    : {
        created: "Refused",
        reason: operationFailureSentence(answered),
        held: undefined,
      };
}

/** What a revision writes of a body, which is all of it but the fence. A
 * revision replaces the whole draft, so overrides left out here would be
 * cleared by it and a form changed in them alone would read as unchanged. */
function creationRevisionOf(
  body: CreationBody,
): Omit<z.infer<typeof draftRevisionSchema>, "expectedVersion"> {
  return {
    configurationRevision: body.configurationRevision,
    authoring: body.authoring,
    brief: body.brief,
    ...(body.overrides === undefined ? {} : { overrides: body.overrides }),
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
): TicketCreationEnded {
  return {
    created: "Refused",
    reason: `${reason} — ${creationDraftHeldSentence(held)}`,
    held,
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
): TicketCreationEnded | undefined {
  switch (draft.state) {
    case "Draft":
      return undefined;
    case "Released":
      return { created: "Exists", ticket: draft.ticket, held };
    case "Deleted":
      return {
        created: "Refused",
        reason: creationDraftDeletedSentence(draft.ticket),
        held: undefined,
      };
  }
}

/**
 * A held draft revised to what the form now says, at the version its door
 * has it at now and only while it is still a draft. A revision that does not
 * get through leaves what is held as it was, the next one reading the draft
 * again; a door that calls the draft closed has said it is one no longer.
 */
async function creationDraftRevised(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: TicketCreationRequest,
  held: CreationDraftHeld,
): Promise<CreationDraftHeld | TicketCreationEnded> {
  const { body, operation } = request;
  const ticket = held.draft.ticket;
  const read = await apiDraft(ports, partition, ticket);
  if (read.outcome !== "Ok")
    return creationRefused(creationDraftUnreadSentence(read), held);
  const closed = creationDraftClosed(read.value, held);
  if (closed !== undefined) return closed;
  const revised = await apiReviseDraft(ports, partition, ticket, {
    expectedVersion: read.value.authoringVersion,
    ...creationRevisionOf(body),
  });
  if (revised.outcome === "Ok")
    return {
      draft: revised.value,
      body,
      operation,
      unsettled: held.unsettled,
    };
  if (revised.outcome !== "Conflict")
    return creationRefused(draftRevisionFailureSentence(revised), held);
  return revised.code === "DraftChanged"
    ? creationRefused(creationDraftChangedSentence, held)
    : creationRefused(draftRevisionFailureSentence(revised), {
        ...held,
        unsettled: true,
      });
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
): Promise<CreationDraftHeld | TicketCreationEnded> {
  const { body, held } = request;
  if (held === undefined)
    return creationDraftCreated(ports, partition, request);
  if (creationDraftHolds(held, body)) return held;
  return creationDraftRevised(ports, partition, request, held);
}

function releasedTicket<Held extends DraftHeld>(
  step: OperationStep,
  held: Held,
): TicketCreated<Held> {
  if (step.step === "Abandoned")
    return { created: "Refused", reason: step.reason, held };
  if (step.step !== "Settled")
    return {
      created: "Refused",
      reason: "the release stopped before it settled",
      held,
    };
  if (step.state === "Succeeded")
    return { created: "Created", ticket: held.draft.ticket };
  return {
    created: "Refused",
    reason:
      step.refusal === undefined
        ? operationStateSentence(step.state)
        : operationRefusalSentence(step.refusal),
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
): Promise<TicketCreationEnded> {
  const read = await apiDraft(ports, partition, written.draft.ticket);
  if (read.outcome !== "Ok")
    return creationRefused(reason, { ...written, unsettled: true });
  return (
    creationDraftClosed(read.value, written) ??
    creationRefused(reason, { ...written, body: undefined, unsettled: false })
  );
}

/**
 * One submit: the draft is written to what the form says, and released and
 * followed to settlement. Only a settled success is a ticket to navigate to.
 */
export async function createAndReleaseTicket(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: TicketCreationRequest,
  onStep: (step: OperationStep) => void,
): Promise<TicketCreationEnded> {
  const written = await creationDraftWritten(ports, partition, request);
  if ("created" in written) return written;
  const seen = { accepted: false };
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
      onStep(step);
    },
  );
  const step = followed.step;
  const released = releasedTicket(step, written);
  if (released.created !== "Refused") return released;
  if (step.step === "Settled" && step.refusal?.type === "AuthoringChanged")
    return creationDraftFencedOut(ports, partition, released.reason, written);
  return creationRefused(released.reason, {
    ...written,
    unsettled: creationReleaseUnsettled(step, seen.accepted, written),
  });
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
): Promise<TicketCreated> {
  const ticket = request.ticket.ticket;
  const revised = await apiReviseDraft(ports, partition, ticket, request.body);
  if (revised.outcome !== "Ok")
    return revised.outcome === "Conflict" && revised.code === "DraftChanged"
      ? {
          created: "Stale",
          reason: draftRevisionRefusalSentence("DraftChanged"),
        }
      : {
          created: "Refused",
          reason: draftRevisionFailureSentence(revised),
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
  return releasedTicket(followed.step, { draft: revised.value });
}
