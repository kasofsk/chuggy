/**
 * The two motions a creation screen makes: reading what a ticket would be
 * created against, and creating and releasing one in a single submit.
 *
 * The configuration is not asked for, so it is walked to here — newest first,
 * for a bounded number of pages, until one is ready — and the initialization it
 * fences is read in the same motion, because a revision without its defaults is
 * not something a form can be drawn from. Release reuses `followOperation`,
 * whose one budget spans the whole follow, so this module adds no second wait.
 *
 * A DRAFT THAT WAS CREATED AND NOT RELEASED IS HANDED BACK. The release is the
 * half that can be refused on its own, and a retry that created a second draft
 * would leave the first behind for a human to find.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ConfigurationSummary,
  DraftInitializationResponse,
  DraftResponse,
} from "../../../../src/contract/responses.ts";
import type { draftCreationSchema } from "../../../../src/contract/requests.ts";
import type { z } from "zod";

import {
  apiConfigurations,
  apiCreateDraft,
  apiDraftInitialization,
} from "./apiRoutes.ts";
import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import {
  operationFailureSentence,
  operationRefusalSentence,
  operationStateSentence,
} from "./codeSentences.ts";
import { followOperation } from "./operationFollow.ts";
import type { OperationStep } from "./operationFollow.ts";
import {
  creationReleaseMutation,
  latestReadyConfiguration,
} from "./ticketCreation.ts";

/**
 * How far back through a project's revisions a ready one is looked for. A walk
 * that ends here has established nothing about the project, so it answers
 * `ReadyConfigurationUnknown` and the reader is told how far it looked.
 */
export const configurationPagesMax = 8;

export type CreationContext =
  | {
      readonly context: "Ready";
      readonly configuration: ConfigurationSummary;
      readonly initialization: DraftInitializationResponse;
    }
  | { readonly context: "NoReadyConfiguration" }
  | {
      readonly context: "ReadyConfigurationUnknown";
      readonly pagesRead: number;
    };

/** What a context with no configuration in it says, absence and not-knowing apart. */
export function creationContextSentence(
  context: Exclude<CreationContext, { context: "Ready" }>,
): string {
  return context.context === "NoReadyConfiguration"
    ? "this project has no ready configuration, so there is nothing to shape a ticket with yet"
    : `the newest ${String(context.pagesRead)} pages of this project's revisions are all incomplete, so this console could not find a ready configuration to shape a ticket with`;
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

/**
 * What the walk found, with the two ways of finding nothing kept apart: the
 * revisions ran out, or the budget did.
 */
type ReadyConfiguration =
  | {
      readonly found: "Configuration";
      readonly configuration: ConfigurationSummary;
    }
  | { readonly found: "None" }
  | { readonly found: "Unknown"; readonly pagesRead: number };

async function readyConfiguration(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<ReadyConfiguration>> {
  let cursor: string | undefined;
  for (let page = 0; page < configurationPagesMax; page += 1) {
    const answered = await apiConfigurations(ports, partition, { cursor });
    if (answered.outcome !== "Ok") return answered;
    const ready = latestReadyConfiguration(answered.value.configurations);
    if (ready !== undefined)
      return {
        outcome: "Ok",
        value: { found: "Configuration", configuration: ready },
      };
    cursor = answered.value.nextCursor;
    if (cursor === undefined)
      return { outcome: "Ok", value: { found: "None" } };
  }
  return {
    outcome: "Ok",
    value: { found: "Unknown", pagesRead: configurationPagesMax },
  };
}

/** The revision a ticket would be shaped by, and the defaults it is fenced with. */
export async function readCreationContext(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<CreationContext>> {
  const found = await readyConfiguration(ports, partition);
  if (found.outcome !== "Ok") return found;
  if (found.value.found === "None")
    return { outcome: "Ok", value: { context: "NoReadyConfiguration" } };
  if (found.value.found === "Unknown")
    return {
      outcome: "Ok",
      value: {
        context: "ReadyConfigurationUnknown",
        pagesRead: found.value.pagesRead,
      },
    };
  const configuration = found.value.configuration;
  const initialized = await apiDraftInitialization(
    ports,
    partition,
    configuration.revision,
  );
  return initialized.outcome === "Ok"
    ? {
        outcome: "Ok",
        value: {
          context: "Ready",
          configuration,
          initialization: initialized.value,
        },
      }
    : initialized;
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
      step.refusalCode === undefined
        ? operationStateSentence(step.state)
        : operationRefusalSentence(step.refusalCode),
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
