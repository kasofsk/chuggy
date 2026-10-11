/**
 * Editing a Pending ticket: the creation form, prefilled from the ticket's
 * draft, with its dependencies drawn and not offered. It opens on the
 * configuration the draft names, so a ticket is moved to another only by a
 * reader who chooses one.
 *
 * One submit revises the draft and releases it as the ticket's update, written
 * against the revision the ticket read carries, and the navigation back to the
 * ticket happens on a settled success alone. A ticket that has left Pending is
 * not offered the form, because the update it would send is refused.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  DraftResponse,
  ProjectRepositoryResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiDraft,
  apiDraftInitialization,
  apiTicket,
} from "../core/apiRoutes.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  operationIdBytesCount,
  operationSubmitting,
} from "../core/operationFollow.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import { ticketRevisable } from "../core/ticketActions.ts";
import { creationRepositories } from "../core/ticketCreation.ts";
import type {
  CreationFault,
  CreationOffer,
  TicketCreationForm,
} from "../core/ticketCreation.ts";
import {
  creationContextList,
  readCreationContext,
  reviseAndUpdateTicket,
} from "../core/ticketCreationRun.ts";
import type { CreationContext } from "../core/ticketCreationRun.ts";
import {
  editFormFrom,
  editOfferListed,
  editOffersFrom,
  editRevisionFrom,
} from "../core/ticketEdit.ts";
import type { EditOffers } from "../core/ticketEdit.ts";
import { useApiPorts, usePanelList, usePanelResource } from "./api.ts";
import { DataPanel, PanelUnready } from "./DataPanel.tsx";
import {
  ticketYamlForgotten,
  ticketYamlStoreKey,
  useAuthoringGuards,
} from "./editor/authoringGuards.tsx";
import { TicketAuthoring } from "./editor/TicketAuthoring.tsx";
import { drawBytes } from "./ports.ts";
import { DraftScreen } from "./ticket/DraftScreen.tsx";
import {
  AttemptNote,
  CreationContextAbsent,
  CreationFields,
  useMounted,
} from "./TicketCreation.tsx";
import type { Attempt } from "./TicketCreation.tsx";

/** What the edit is written against: the ticket as read, and its draft. */
interface EditSubject {
  readonly ticket: TicketResponse;
  readonly draft: DraftResponse;
}

/**
 * One submit, from the revision it assembles to the state it leaves behind.
 * Whatever it ends in, the ticket and its draft are read again: a revision
 * the update did not land has moved the draft's version, and a refusal for a
 * stale revision is answered by the one the ticket is at now.
 */
function useEditSubmit(props: {
  readonly ports: ApiPorts;
  readonly partition: PartitionIdentity;
  readonly subject: EditSubject;
  readonly offers: readonly CreationOffer[];
  readonly repositories: readonly ProjectRepositoryResponse[];
  readonly onFaults: (faults: readonly CreationFault[]) => void;
  readonly onUpdated: () => void;
}): {
  readonly attempt: Attempt;
  readonly submit: (form: TicketCreationForm) => Promise<void>;
} {
  const client = useQueryClient();
  const mounted = useMounted();
  const [attempt, setAttempt] = useState<Attempt>({ attempt: "Idle" });
  const { partition, subject } = props;

  const reread = async (): Promise<void> => {
    const ticket = String(subject.ticket.ticket);
    await Promise.all([
      client.invalidateQueries({
        queryKey: projectResourceKey(partition, "Ticket", ticket),
      }),
      client.invalidateQueries({
        queryKey: projectResourceKey(partition, "Draft", ticket),
      }),
    ]);
  };

  const submit = async (form: TicketCreationForm): Promise<void> => {
    const assembled = editRevisionFrom(
      subject.draft,
      props.offers,
      form,
      props.repositories,
    );
    if (assembled.assembled === "Faults") {
      props.onFaults(assembled.faults);
      return;
    }
    props.onFaults([]);
    setAttempt({ attempt: "Running", step: operationSubmitting() });
    const operation = base64urlFromBytes(drawBytes(operationIdBytesCount));
    const updated = await reviseAndUpdateTicket(
      props.ports,
      partition,
      { ticket: subject.ticket, body: assembled.body, operation },
      (step) => {
        if (mounted.current) setAttempt({ attempt: "Running", step });
      },
    );
    await reread();
    if (!mounted.current) return;
    if (updated.created === "Created") {
      props.onUpdated();
      return;
    }
    setAttempt(
      updated.created === "Stale"
        ? { attempt: "Stale", reason: updated.reason }
        : { attempt: "Failed", reason: updated.reason, held: updated.held },
    );
  };

  return { attempt, submit };
}

/**
 * The form over one draft. What was typed is held from the first keystroke, so
 * a draft read again after a refusal re-seeds only a form nobody has touched.
 */
export function EditForm(props: {
  readonly ports: ApiPorts;
  readonly partition: PartitionIdentity;
  readonly subject: EditSubject;
  readonly edit: EditOffers;
  /** What the project binds, retired bindings among them. */
  readonly bound: readonly ProjectRepositoryResponse[];
  readonly partial?: boolean;
  readonly onUpdated: () => void;
  readonly onDirty?: (dirty: boolean) => void;
}): ReactNode {
  const [edited, setEdited] = useState<TicketCreationForm | undefined>(
    undefined,
  );
  const [faults, setFaults] = useState<readonly CreationFault[]>([]);
  const bound = props.bound;
  const repositories = useMemo(() => creationRepositories(bound), [bound]);
  const draft = props.subject.draft;
  const { offers, configuration } = props.edit;
  const storeKey = ticketYamlStoreKey(props.partition, draft.ticket);
  const running = useEditSubmit({
    ports: props.ports,
    partition: props.partition,
    subject: props.subject,
    offers,
    repositories,
    onFaults: setFaults,
    onUpdated: () => {
      ticketYamlForgotten(storeKey);
      props.onUpdated();
    },
  });
  const initial = useMemo(
    () => editFormFrom(draft, repositories, configuration),
    [draft, repositories, configuration],
  );
  const form = edited ?? initial;
  return (
    <div className="creation">
      <TicketAuthoring
        initial={initial}
        form={form}
        onForm={setEdited}
        offers={offers}
        repositories={repositories}
        dependenciesLocked
        assemble={(held) => editRevisionFrom(draft, offers, held, repositories)}
        storeKey={storeKey}
        submitLabel="revise and release"
        busy={running.attempt.attempt === "Running"}
        onSubmit={(held) => {
          void running.submit(held);
        }}
        onDirty={props.onDirty}
        fields={
          <CreationFields
            form={form}
            onChange={setEdited}
            faults={faults}
            offers={offers}
            partial={props.partial === true}
            repositories={repositories}
            dependenciesLocked
            api={props}
          />
        }
      />
      <AttemptNote attempt={running.attempt} motion="Update" />
    </div>
  );
}

interface EditOffersReadProps {
  readonly partition: PartitionIdentity;
  readonly draft: DraftResponse;
  readonly offers: readonly CreationOffer[];
  readonly children: (edit: EditOffers) => ReactNode;
}

/**
 * A revision the project no longer offers, read for the initialization that
 * lets an edit of a draft holding it keep it. One that cannot be read says so
 * above a form that starts on no configuration.
 */
function EditOwnOfferRead(
  props: EditOffersReadProps & { readonly revision: string },
): ReactNode {
  const { draft, offers, partition, revision } = props;
  const state = usePanelResource(
    partition,
    "Configuration",
    `${revision}/draft-initialization`,
    (readPorts) => apiDraftInitialization(readPorts, partition, revision),
  );
  const own = state.state === "Ready" ? state.value : undefined;
  const edit = useMemo(
    () => editOffersFrom(draft, offers, own),
    [draft, offers, own],
  );
  if (state.state === "Pending") return <PanelUnready state={state} />;
  return (
    <>
      <PanelUnready state={state} />
      {props.children(edit)}
    </>
  );
}

/**
 * The offers an edit is drawn over, the draft's own revision read only where
 * the project's offers do not already hold its configuration. Which revision
 * that is, is decided as the screen opens: a submit revises the draft before
 * its update is released and the draft is read again after, so a decision
 * taken from the draft each time would redraw the form under the submit still
 * reporting to it.
 */
function EditOffersRead(props: EditOffersReadProps): ReactNode {
  const { draft, offers } = props;
  const [unoffered] = useState(() =>
    editOfferListed(draft, offers) ? undefined : draft.configurationRevision,
  );
  return unoffered === undefined ? (
    props.children(editOffersFrom(draft, offers, undefined))
  ) : (
    <EditOwnOfferRead {...props} revision={unoffered} />
  );
}

/** The form over one read subject, among the offers its draft is edited under. */
function EditOffered(props: {
  readonly ports: ApiPorts;
  readonly partition: PartitionIdentity;
  readonly subject: EditSubject;
  readonly context: Extract<CreationContext, { context: "Ready" }>;
  readonly onUpdated: () => void;
  readonly onDirty: (dirty: boolean) => void;
}): ReactNode {
  const { context, partition, subject } = props;
  return (
    <EditOffersRead
      partition={partition}
      draft={subject.draft}
      offers={context.offers}
    >
      {(edit) => (
        <EditForm
          ports={props.ports}
          partition={partition}
          subject={subject}
          edit={edit}
          bound={context.repositories}
          partial={context.partial}
          onDirty={props.onDirty}
          onUpdated={props.onUpdated}
        />
      )}
    </EditOffersRead>
  );
}

/** The ticket and its draft, each drawn as its own state until both are read,
 * and a ticket past Pending as the reason there is no form. */
function EditSubjectRead(props: {
  readonly ticketState: PanelState<TicketResponse>;
  readonly draftState: PanelState<DraftResponse>;
  readonly children: (subject: EditSubject) => ReactNode;
}): ReactNode {
  const { ticketState, draftState } = props;
  if (ticketState.state !== "Ready")
    return <PanelUnready state={ticketState} />;
  if (!ticketRevisable(ticketState.value.phase))
    return (
      <p className="panel-absent">
        this ticket is no longer pending, so it cannot be edited
      </p>
    );
  if (draftState.state !== "Ready") return <PanelUnready state={draftState} />;
  return props.children({
    ticket: ticketState.value,
    draft: draftState.value,
  });
}

/** The edit screen's reads, and the form they prefill. */
function TicketEditRead(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  const { partition, ticket } = props;
  const ports = useApiPorts();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const guard = useAuthoringGuards(dirty);
  const ticketState = usePanelResource(
    partition,
    "Ticket",
    String(ticket),
    (readPorts) => apiTicket(readPorts, partition, ticket),
  );
  const draftState = usePanelResource(
    partition,
    "Draft",
    String(ticket),
    (readPorts) => apiDraft(readPorts, partition, ticket),
  );
  const contextState = usePanelList(
    creationContextList(partition),
    (readPorts) => readCreationContext(readPorts, partition),
  );
  return (
    <DataPanel title="Draft" state={contextState}>
      {(context) =>
        context.context === "Ready" ? (
          <EditSubjectRead ticketState={ticketState} draftState={draftState}>
            {(subject) => (
              <EditOffered
                ports={ports}
                partition={partition}
                subject={subject}
                context={context}
                onDirty={setDirty}
                onUpdated={() => {
                  guard.release();
                  void navigate({
                    to: "/$tenant/$project/tickets/$ticket",
                    params: { ...partition, ticket: String(ticket) },
                  });
                }}
              />
            )}
          </EditSubjectRead>
        ) : (
          <CreationContextAbsent partition={partition} context={context} />
        )
      }
    </DataPanel>
  );
}

export function TicketEdit(): ReactNode {
  const params = useParams({ from: "/$tenant/$project/tickets/$ticket/edit" });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  return (
    <DraftScreen
      partition={partition}
      heading={<>Edit ticket {params.ticket}</>}
    >
      <TicketEditRead partition={partition} ticket={Number(params.ticket)} />
    </DraftScreen>
  );
}
