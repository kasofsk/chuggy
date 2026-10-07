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
 * would leave the first behind for a human to find.
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
  apiDraftInitialization,
  apiProjectRepositories,
  apiReviseDraft,
  configurationPagesMax,
} from "./apiRoutes.ts";
import type { ApiFailure, ApiPorts, ApiResult } from "./apiRequest.ts";
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

export interface TicketCreationRequest {
  readonly body: z.infer<typeof draftCreationSchema>;
  readonly operation: string;
  readonly draft?: DraftResponse | undefined;
}

export type TicketCreated =
  | { readonly created: "Created"; readonly ticket: number }
  | { readonly created: "Stale"; readonly reason: string }
  | {
      readonly created: "Refused";
      readonly reason: string;
      readonly draft: DraftResponse | undefined;
    };

/** The one conflict a creation route answers: the fence this body carries moved. */
export const creationStaleSentence =
  "the project moved while this form was open — it has been read again, so submitting now uses the current one";

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
      initialized: await apiDraftInitialization(
        ports,
        partition,
        one.listed.revision,
      ),
    })),
  );
  const offers: CreationOffer[] = [];
  let failed: ApiFailure | undefined;
  for (const { one, initialized } of read) {
    if (initialized.outcome === "Ok")
      offers.push({ ...one, initialization: initialized.value });
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

async function createdDraft(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: TicketCreationRequest,
): Promise<DraftResponse | TicketCreated> {
  if (request.draft !== undefined) return request.draft;
  const answered = await apiCreateDraft(ports, partition, request.body);
  if (answered.outcome === "Ok") return answered.value;
  return answered.outcome === "Conflict"
    ? { created: "Stale", reason: creationStaleSentence }
    : {
        created: "Refused",
        reason: operationFailureSentence(answered),
        draft: undefined,
      };
}

function releasedTicket(
  step: OperationStep,
  draft: DraftResponse,
): TicketCreated {
  if (step.step === "Abandoned")
    return { created: "Refused", reason: step.reason, draft };
  if (step.step !== "Settled")
    return {
      created: "Refused",
      reason: "the release stopped before it settled",
      draft,
    };
  if (step.state === "Succeeded")
    return { created: "Created", ticket: draft.ticket };
  return {
    created: "Refused",
    reason:
      step.refusal === undefined
        ? operationStateSentence(step.state)
        : operationRefusalSentence(step.refusal),
    draft,
  };
}

/**
 * One submit: the draft is created if it does not exist yet, and released and
 * followed to settlement. Only a settled success is a ticket to navigate to.
 */
export async function createAndReleaseTicket(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: TicketCreationRequest,
  onStep: (step: OperationStep) => void,
): Promise<TicketCreated> {
  const created = await createdDraft(ports, partition, request);
  if ("created" in created) return created;
  const followed = await followOperation(
    ports,
    partition,
    {
      operation: request.operation,
      mutation: creationReleaseMutation(created),
    },
    created.ticket,
    onStep,
  );
  return releasedTicket(followed.step, created);
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
          draft: undefined,
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
  return releasedTicket(followed.step, revised.value);
}
