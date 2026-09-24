/**
 * Editing a Pending ticket: the creation form, prefilled from the ticket's
 * draft, with its dependencies drawn and not offered.
 *
 * One submit revises the draft and releases it as the ticket's update, written
 * against the revision the ticket read carries, and the navigation back to the
 * ticket happens on a settled success alone. A ticket that has left Pending is
 * not offered the form, because the update it would send is refused.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  DraftResponse,
  ProjectRepositoryResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import { apiDraft, apiTicket } from "../core/apiRoutes.ts";
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
  TicketCreationForm,
} from "../core/ticketCreation.ts";
import {
  creationContextList,
  creationContextSentence,
  readCreationContext,
  reviseAndUpdateTicket,
} from "../core/ticketCreationRun.ts";
import type { CreationContext } from "../core/ticketCreationRun.ts";
import { editFormFrom, editRevisionFrom } from "../core/ticketEdit.ts";
import { useApiPorts, usePanelList, usePanelResource } from "./api.ts";
import { DataPanel, PanelUnready } from "./DataPanel.tsx";
import { drawBytes } from "./ports.ts";
import { TopBarSlot } from "./shell/slots.tsx";
import { AttemptNote, CreationFields, useMounted } from "./TicketCreation.tsx";
import type { Attempt } from "./TicketCreation.tsx";
import { Button } from "./ui/Button.tsx";

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
  readonly context: Extract<CreationContext, { context: "Ready" }>;
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
      props.context.initialization,
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
        : {
            attempt: "Failed",
            reason: updated.reason,
            draft: updated.draft,
            operation,
          },
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
  readonly context: Extract<CreationContext, { context: "Ready" }>;
  readonly onUpdated: () => void;
}): ReactNode {
  const [edited, setEdited] = useState<TicketCreationForm | undefined>(
    undefined,
  );
  const [faults, setFaults] = useState<readonly CreationFault[]>([]);
  const repositories = creationRepositories(props.context.repositories);
  const running = useEditSubmit({
    ports: props.ports,
    partition: props.partition,
    subject: props.subject,
    context: props.context,
    repositories,
    onFaults: setFaults,
    onUpdated: props.onUpdated,
  });
  const form = edited ?? editFormFrom(props.subject.draft, repositories);
  return (
    <div className="creation">
      <CreationFields
        form={form}
        onChange={setEdited}
        faults={faults}
        configuration={props.context.configuration}
        initialization={props.context.initialization}
        repositories={repositories}
        dependenciesLocked
      />
      <Button
        variant="primary"
        disabled={running.attempt.attempt === "Running"}
        onClick={() => {
          void running.submit(form);
        }}
      >
        revise and release
      </Button>
      <AttemptNote attempt={running.attempt} motion="Update" />
    </div>
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

export function TicketEdit(): ReactNode {
  const params = useParams({ from: "/$tenant/$project/tickets/$ticket/edit" });
  const ports = useApiPorts();
  const navigate = useNavigate();
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const ticket = Number(params.ticket);
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
    <>
      <TopBarSlot>
        <h1 className="text-md font-strong text-ink-1 truncate">
          Edit ticket {params.ticket}
        </h1>
      </TopBarSlot>
      <DataPanel title="Draft" state={contextState}>
        {(context) =>
          context.context === "Ready" ? (
            <EditSubjectRead ticketState={ticketState} draftState={draftState}>
              {(subject) => (
                <EditForm
                  ports={ports}
                  partition={partition}
                  subject={subject}
                  context={context}
                  onUpdated={() => {
                    void navigate({
                      to: "/$tenant/$project/tickets/$ticket",
                      params: { ...partition, ticket: String(ticket) },
                    });
                  }}
                />
              )}
            </EditSubjectRead>
          ) : (
            <p className="panel-absent">{creationContextSentence(context)}</p>
          )
        }
      </DataPanel>
    </>
  );
}
