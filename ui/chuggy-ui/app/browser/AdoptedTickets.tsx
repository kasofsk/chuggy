import { useNavigate, useParams } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AdoptedTicket } from "../../../../src/contract/adoptedTickets.ts";
import type { ApiFailure } from "../core/apiRequest.ts";
import {
  adoptedOperation,
  assertAdoptedOperationSucceeded,
  adoptedTicketAction,
  adoptedTicketCreate,
  adoptedTicketDefinition,
  adoptedTicketUpdate,
  adoptedTickets,
} from "../core/adoptedTickets.ts";
import { useApiPorts } from "./api.ts";
import {
  useTicketCatalog,
  useTicketValidation,
} from "./editor/useTicketAuthoring.ts";
import { Button, ButtonLink } from "./ui/Button.tsx";

/** CodeMirror is the largest thing the console bundles and only authoring wants it. */
const TicketEditor = lazy(async () => ({
  default: (await import("./editor/TicketEditor.tsx")).TicketEditor,
}));

const operationPollAttemptsMax = 60;
const operationPollDelayMs = 1_000;
const ticketDocumentExample = `version: 2
title: Describe the change
instructions: |
  Explain the intended result and how to verify it.
work: workloads/work.yaml
evaluation: evaluation-plans/review.yaml
finalization: finalizers/pull-request.yaml
`;

function failureSentence(failure: ApiFailure): string {
  if ("reason" in failure) return failure.reason;
  if (failure.outcome === "Conflict")
    return "This project uses an unsupported ticket model or the request conflicted.";
  return `The request ended with ${failure.outcome}.`;
}

function newIdentity(): string {
  return crypto.randomUUID();
}

export function AdoptedTickets(): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  const ports = useApiPorts();
  const [tickets, setTickets] = useState<readonly AdoptedTicket[]>();
  const [failure, setFailure] = useState<string>();
  useEffect(() => {
    let active = true;
    void adoptedTickets(ports, {
      tenant: partition.tenant,
      project: partition.project,
    }).then((result) => {
      if (!active) return;
      if (result.outcome === "Ok") setTickets(result.value.tickets);
      else setFailure(failureSentence(result));
    });
    return () => {
      active = false;
    };
  }, [ports, partition.tenant, partition.project]);
  return (
    <main className="grid gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1>Tickets</h1>
        <ButtonLink to="/$tenant/$project/tickets/new" params={partition}>
          New ticket
        </ButtonLink>
      </div>
      {failure === undefined ? null : (
        <p className="text-tone-fail">{failure}</p>
      )}
      {tickets === undefined ? (
        <p className="panel-note">Loading tickets…</p>
      ) : (
        <div className="grid gap-2">
          {tickets.length === 0 ? (
            <p className="panel-absent">No tickets have been authored.</p>
          ) : (
            tickets.map((ticket) => (
              <ButtonLink
                key={ticket.ticket}
                to="/$tenant/$project/tickets/$ticket"
                params={{ ...partition, ticket: String(ticket.ticket) }}
              >
                Ticket {ticket.ticket} · {ticket.state} · revision{" "}
                {ticket.revision}
              </ButtonLink>
            ))
          )}
        </div>
      )}
    </main>
  );
}

interface AuthoringFields {
  readonly source: string;
  readonly catalogCommit: string;
  readonly repository: string;
}

function AuthoringSubmit(props: {
  readonly busy: boolean;
  readonly label: string;
}): ReactNode {
  return (
    <Button
      type="submit"
      busy={props.busy}
      disabled={props.busy}
      onClick={() => undefined}
    >
      {props.label}
    </Button>
  );
}

function AuthoringPin(props: {
  readonly fields: AuthoringFields;
  readonly setFields: (fields: AuthoringFields) => void;
}): ReactNode {
  return (
    <>
      <label className="grid gap-1">
        <span>Catalog commit</span>
        <input
          required
          value={props.fields.catalogCommit}
          onChange={(event) => {
            props.setFields({
              ...props.fields,
              catalogCommit: event.target.value,
            });
          }}
        />
      </label>
      <label className="grid gap-1">
        <span>Repository binding (optional)</span>
        <input
          value={props.fields.repository}
          onChange={(event) => {
            props.setFields({
              ...props.fields,
              repository: event.target.value,
            });
          }}
        />
      </label>
    </>
  );
}

function AuthoringForm(props: {
  readonly submitLabel: string;
  readonly initial?: AuthoringFields;
  readonly onSubmit: (fields: AuthoringFields) => Promise<void>;
}): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  const [fields, setFields] = useState<AuthoringFields>(
    props.initial ?? {
      source: ticketDocumentExample,
      catalogCommit: "",
      repository: "",
    },
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const findings = useTicketValidation(partition, fields);
  const { files, catalog } = useTicketCatalog(
    partition,
    { catalogCommit: fields.catalogCommit, repository: fields.repository },
    (error: unknown) => {
      setFailure(
        error instanceof Error ? error.message : "The catalog failed.",
      );
    },
  );
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void props
          .onSubmit(fields)
          .catch((error: unknown) => {
            setFailure(
              error instanceof Error ? error.message : "The request failed.",
            );
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <AuthoringPin fields={fields} setFields={setFields} />
      <div className="grid gap-1">
        <span>Ticket YAML</span>
        <Suspense fallback={<p className="panel-note">Loading the editor…</p>}>
          <TicketEditor
            value={fields.source}
            onChange={(source) => {
              setFields({ ...fields, source });
            }}
            findings={findings}
            files={files}
            catalog={catalog}
          />
        </Suspense>
      </div>
      <AuthoringSubmit busy={busy} label={props.submitLabel} />
      {failure === undefined ? null : (
        <p className="text-tone-fail">{failure}</p>
      )}
    </form>
  );
}

async function waitForOperation(
  ports: ReturnType<typeof useApiPorts>,
  partition: { readonly tenant: string; readonly project: string },
  identity: string,
): Promise<void> {
  for (let attempt = 0; attempt < operationPollAttemptsMax; attempt += 1) {
    const result = await adoptedOperation(ports, partition, identity);
    if (result.outcome === "Ok") {
      assertAdoptedOperationSucceeded(result.value);
      return;
    }
    if (result.outcome !== "Absent") throw new Error(failureSentence(result));
    await new Promise<void>((resolve) =>
      setTimeout(resolve, operationPollDelayMs),
    );
  }
  throw new Error("The operation did not settle within one minute.");
}

export function AdoptedTicketCreation(): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  const ports = useApiPorts();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string>();
  return (
    <main className="grid gap-4 p-4">
      <h1>New ticket</h1>
      {failure === undefined ? null : (
        <p className="text-tone-fail">{failure}</p>
      )}
      <AuthoringForm
        submitLabel="Create ticket"
        onSubmit={async (fields) => {
          const key = newIdentity();
          const result = await adoptedTicketCreate(ports, partition, {
            source: fields.source,
            catalogCommit: fields.catalogCommit,
            ...(fields.repository === ""
              ? {}
              : { repository: fields.repository }),
            idempotencyKey: key,
          });
          if (result.outcome !== "Ok") {
            setFailure(failureSentence(result));
            return;
          }
          await waitForOperation(ports, partition, result.value.identity);
          await navigate({ to: "/$tenant/$project", params: partition });
        }}
      />
    </main>
  );
}

function Action(props: {
  readonly label: string;
  readonly run: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  return (
    <>
      <Button
        busy={busy}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void props
            .run()
            .catch((error: unknown) => {
              setFailure(
                error instanceof Error ? error.message : "The action failed.",
              );
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {props.label}
      </Button>
      {failure === undefined ? null : (
        <span className="text-tone-fail">{failure}</span>
      )}
    </>
  );
}

function TicketFacts(props: { readonly ticket: AdoptedTicket }): ReactNode {
  const ticket = props.ticket;
  return (
    <dl className="grid gap-2">
      <div>
        <dt>State</dt>
        <dd>{ticket.state}</dd>
      </div>
      <div>
        <dt>Revision</dt>
        <dd>{ticket.revision}</dd>
      </div>
      <div>
        <dt>Work cycles</dt>
        <dd>{ticket.workCyclesStarted}</dd>
      </div>
      <div>
        <dt>Dependencies</dt>
        <dd>{ticket.dependencies.join(", ") || "none"}</dd>
      </div>
    </dl>
  );
}

function TicketDispatch(props: {
  readonly dispatch: { readonly repository: string; readonly commit: string };
  readonly setDispatch: (value: { repository: string; commit: string }) => void;
  readonly act: (action: "dispatch" | "revoke" | "resume") => Promise<void>;
}): ReactNode {
  return (
    <section className="grid gap-3">
      <h2>Dispatch exact commit</h2>
      <input
        placeholder="repository"
        value={props.dispatch.repository}
        onChange={(event) => {
          props.setDispatch({
            ...props.dispatch,
            repository: event.target.value,
          });
        }}
      />
      <input
        placeholder="40 or 64 character commit"
        value={props.dispatch.commit}
        onChange={(event) => {
          props.setDispatch({ ...props.dispatch, commit: event.target.value });
        }}
      />
      <Action label="Dispatch" run={() => props.act("dispatch")} />
      <div className="flex gap-2">
        <Action label="Resume" run={() => props.act("resume")} />
        <Action label="Revoke" run={() => props.act("revoke")} />
      </div>
    </section>
  );
}

/** The form opens on the authored text, so an update starts where the last one ended. */
function TicketUpdate(props: {
  readonly source: string | null | undefined;
  readonly submit: (fields: AuthoringFields) => Promise<void>;
}): ReactNode {
  return (
    <section className="grid gap-3">
      <h2>Update definition</h2>
      {props.source === undefined ? (
        <p className="panel-note">Loading the authored definition…</p>
      ) : (
        <AuthoringForm
          submitLabel="Update ticket"
          onSubmit={props.submit}
          {...(props.source === null
            ? {}
            : {
                initial: {
                  source: props.source,
                  catalogCommit: "",
                  repository: "",
                },
              })}
        />
      )}
    </section>
  );
}

async function runTicketUpdate(input: {
  readonly ports: ReturnType<typeof useApiPorts>;
  readonly partition: { readonly tenant: string; readonly project: string };
  readonly ticket: AdoptedTicket;
  readonly fields: AuthoringFields;
}): Promise<void> {
  const key = newIdentity();
  const result = await adoptedTicketUpdate(
    input.ports,
    input.partition,
    input.ticket.ticket,
    input.ticket.revision,
    {
      source: input.fields.source,
      catalogCommit: input.fields.catalogCommit,
      ...(input.fields.repository === ""
        ? {}
        : { repository: input.fields.repository }),
      idempotencyKey: key,
    },
  );
  if (result.outcome !== "Ok") throw new Error(failureSentence(result));
  await waitForOperation(input.ports, input.partition, result.value.identity);
}

/** Undefined while the read is in flight, null when the release retained no source. */
function useTicketSource(
  tenant: string,
  project: string,
  ticket: number,
): string | null | undefined {
  const ports = useApiPorts();
  const [source, setSource] = useState<string | null>();
  useEffect(() => {
    let active = true;
    void adoptedTicketDefinition(ports, { tenant, project }, ticket).then(
      (result) => {
        if (active)
          setSource(result.outcome === "Ok" ? result.value.source : null);
      },
    );
    return () => {
      active = false;
    };
  }, [ports, tenant, project, ticket]);
  return source;
}

export function AdoptedTicketPage(): ReactNode {
  const params = useParams({ from: "/$tenant/$project/tickets/$ticket" });
  const partition = { tenant: params.tenant, project: params.project };
  const ticketNumber = Number(params.ticket);
  const ports = useApiPorts();
  const [ticket, setTicket] = useState<AdoptedTicket>();
  const [failure, setFailure] = useState<string>();
  const [dispatch, setDispatch] = useState({ repository: "", commit: "" });
  const source = useTicketSource(params.tenant, params.project, ticketNumber);
  const refresh = async (): Promise<void> => {
    const result = await adoptedTickets(ports, partition);
    if (result.outcome !== "Ok") {
      setFailure(failureSentence(result));
      return;
    }
    setTicket(
      result.value.tickets.find((item) => item.ticket === ticketNumber),
    );
  };
  useEffect(() => {
    let active = true;
    void adoptedTickets(ports, {
      tenant: params.tenant,
      project: params.project,
    }).then((result) => {
      if (!active) return;
      if (result.outcome !== "Ok") setFailure(failureSentence(result));
      else
        setTicket(
          result.value.tickets.find((item) => item.ticket === ticketNumber),
        );
    });
    return () => {
      active = false;
    };
  }, [ports, params.tenant, params.project, ticketNumber]);
  const act = async (
    action: "dispatch" | "revoke" | "resume",
  ): Promise<void> => {
    const key = newIdentity();
    const result = await adoptedTicketAction(
      ports,
      partition,
      ticketNumber,
      action,
      key,
      action === "dispatch" ? dispatch : undefined,
    );
    if (result.outcome !== "Ok") throw new Error(failureSentence(result));
    await waitForOperation(ports, partition, result.value.identity);
    await refresh();
  };
  const update = async (fields: AuthoringFields): Promise<void> => {
    if (ticket === undefined) return;
    await runTicketUpdate({ ports, partition, ticket, fields });
    await refresh();
  };
  if (ticket === undefined)
    return <main className="p-4">{failure ?? "Loading ticket…"}</main>;
  return (
    <TicketBody
      {...{ ticket, failure, dispatch, setDispatch, act, source, update }}
    />
  );
}

function TicketBody(props: {
  readonly ticket: AdoptedTicket;
  readonly failure: string | undefined;
  readonly dispatch: { readonly repository: string; readonly commit: string };
  readonly setDispatch: (value: { repository: string; commit: string }) => void;
  readonly act: (action: "dispatch" | "revoke" | "resume") => Promise<void>;
  readonly source: string | null | undefined;
  readonly update: (fields: AuthoringFields) => Promise<void>;
}): ReactNode {
  return (
    <main className="grid gap-5 p-4">
      <h1>Ticket {props.ticket.ticket}</h1>
      <TicketFacts ticket={props.ticket} />
      {props.failure === undefined ? null : (
        <p className="text-tone-fail">{props.failure}</p>
      )}
      <TicketDispatch
        dispatch={props.dispatch}
        setDispatch={props.setDispatch}
        act={props.act}
      />
      <TicketUpdate source={props.source} submit={props.update} />
    </main>
  );
}
