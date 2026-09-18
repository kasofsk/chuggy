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
  type CatalogPin,
} from "../core/adoptedTickets.ts";
import { useApiPorts } from "./api.ts";
import {
  useTicketCatalog,
  useTicketValidation,
} from "./editor/useTicketAuthoring.ts";
import type { EditorFinding } from "./editor/chugEditor.ts";
import type { FragmentCatalog } from "./editor/fragments.ts";
import { Button, ButtonLink } from "./ui/Button.tsx";
import { Dialog } from "./ui/Dialog.tsx";
import { Notice } from "./ui/Notice.tsx";
import {
  EditorBoundary,
  useLeaveGuard,
  useUnloadGuard,
} from "./editor/authoringGuards.tsx";

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
  readonly repository: string;
}

/** What the write is guarded on: the commit the last validation resolved against. */
interface AuthoringSubmission {
  readonly fields: AuthoringFields;
  readonly expectedCommit: string | undefined;
}

/** An unnamed binding and an unresolved commit are absent fields, not empty ones. */
function authoringPin(submission: AuthoringSubmission): CatalogPin {
  return {
    ...(submission.fields.repository === ""
      ? {}
      : { repository: submission.fields.repository }),
    ...(submission.expectedCommit === undefined
      ? {}
      : { expectedCommit: submission.expectedCommit }),
  };
}

function AuthoringPin(props: {
  readonly fields: AuthoringFields;
  readonly setFields: (fields: AuthoringFields) => void;
}): ReactNode {
  return (
    <>
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

/** The text as last written out, so "changed" means changed since then. */
function useDirtyText(source: string): {
  readonly dirty: boolean;
  readonly settle: (text: string) => void;
} {
  const [saved, setSaved] = useState(source);
  return { dirty: source !== saved, settle: setSaved };
}

function AuthoringFallback(props: {
  readonly value: string;
  readonly onChange: (text: string) => void;
}): ReactNode {
  return (
    <div className="grid gap-2">
      <Notice
        inline
        tone="danger"
        role="alert"
        detail="The editor could not load. The YAML is still editable here."
      />
      <textarea
        aria-label="Ticket YAML"
        className="ticket-editor-fallback"
        spellCheck={false}
        rows={16}
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
    </div>
  );
}

/** The document as it will be written, shown before anything is. */
function AuthoringConfirm(props: {
  readonly label: string;
  readonly source: string;
  readonly openFindings: number;
  readonly busy: boolean;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly onConfirm: () => void;
}): ReactNode {
  return (
    <Dialog
      title="Create this ticket?"
      trigger={props.label}
      triggerVariant="primary"
      triggerDisabled={props.busy}
      open={props.open}
      onOpenChange={(open) => {
        if (!open && props.busy) return;
        props.setOpen(open);
      }}
    >
      <p className="panel-note">
        This is the document that will be written. Creating it does not dispatch
        it or start a run.
      </p>
      <pre className="authoring-confirm-source">{props.source}</pre>
      {props.openFindings === 0 ? null : (
        <Notice
          inline
          tone="danger"
          role="status"
          detail={`${String(props.openFindings)} finding(s) are still open on this document.`}
        />
      )}
      <Button
        variant="primary"
        busy={props.busy}
        disabled={props.busy}
        onClick={props.onConfirm}
      >
        {props.label}
      </Button>
    </Dialog>
  );
}

/** The editor, or the textarea that stands in when its chunk will not load. */
function AuthoringDocument(props: {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly findings: readonly EditorFinding[];
  readonly files: readonly string[];
  readonly catalog: FragmentCatalog | undefined;
}): ReactNode {
  return (
    <div className="grid gap-1">
      <span>Ticket YAML</span>
      <EditorBoundary
        fallback={
          <AuthoringFallback value={props.value} onChange={props.onChange} />
        }
      >
        <Suspense fallback={<p className="panel-note">Loading the editor…</p>}>
          <TicketEditor
            value={props.value}
            onChange={props.onChange}
            findings={props.findings}
            files={props.files}
            catalog={props.catalog}
          />
        </Suspense>
      </EditorBoundary>
    </div>
  );
}

/** Everything the form holds that is not a field: what failed, and what is in flight. */
function useAuthoringTurn(
  fields: AuthoringFields,
  commit: string | undefined,
  onSubmit: (submission: AuthoringSubmission) => Promise<void>,
  settle: (text: string) => void,
): {
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly confirming: boolean;
  readonly setConfirming: (open: boolean) => void;
  readonly submit: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const submit = (): void => {
    setBusy(true);
    void onSubmit({ fields, expectedCommit: commit })
      .then(() => {
        settle(fields.source);
        setConfirming(false);
      })
      .catch((error: unknown) => {
        setFailure(
          error instanceof Error ? error.message : "The request failed.",
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return { busy, failure, confirming, setConfirming, submit };
}

/** What went wrong around the document, as distinct from what is wrong in it. */
function AuthoringTrouble(props: {
  readonly unanswered: ApiFailure | undefined;
  readonly catalog: string | undefined;
}): ReactNode {
  return (
    <>
      {props.unanswered === undefined ? null : (
        <Notice
          inline
          tone="danger"
          role="status"
          detail={`The document has not been checked: ${failureSentence(props.unanswered)}`}
        />
      )}
      {props.catalog === undefined ? null : (
        <Notice inline tone="danger" role="status" detail={props.catalog} />
      )}
    </>
  );
}

function AuthoringForm(props: {
  readonly submitLabel: string;
  readonly initial?: AuthoringFields;
  readonly onSubmit: (submission: AuthoringSubmission) => Promise<void>;
}): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  const [fields, setFields] = useState<AuthoringFields>(
    props.initial ?? { source: ticketDocumentExample, repository: "" },
  );
  const [catalogFailure, setCatalogFailure] = useState<string>();
  const { findings, commit, unanswered } = useTicketValidation(
    partition,
    fields,
  );
  const { dirty, settle } = useDirtyText(fields.source);
  const turn = useAuthoringTurn(fields, commit, props.onSubmit, settle);
  useUnloadGuard(dirty);
  useLeaveGuard(dirty);
  const { files, catalog } = useTicketCatalog(
    partition,
    fields.repository === "" ? {} : { repository: fields.repository },
    (error: unknown) => {
      setCatalogFailure(
        error instanceof Error ? error.message : "The catalog failed.",
      );
    },
  );
  return (
    <div className="grid gap-3">
      <AuthoringPin fields={fields} setFields={setFields} />
      <AuthoringDocument
        value={fields.source}
        onChange={(source) => {
          setFields({ ...fields, source });
        }}
        findings={findings}
        files={files}
        catalog={catalog}
      />
      <AuthoringTrouble unanswered={unanswered} catalog={catalogFailure} />
      <div className="authoring-actions">
        <span className="panel-note">
          {dirty
            ? "Unsaved changes · nothing is written until you confirm"
            : ""}
        </span>
        <AuthoringConfirm
          label={props.submitLabel}
          source={fields.source}
          openFindings={findings.length}
          busy={turn.busy}
          open={turn.confirming}
          setOpen={turn.setConfirming}
          onConfirm={turn.submit}
        />
      </div>
      {turn.failure === undefined ? null : (
        <p className="text-tone-fail">{turn.failure}</p>
      )}
    </div>
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
        onSubmit={async (submission) => {
          const key = newIdentity();
          const result = await adoptedTicketCreate(ports, partition, {
            source: submission.fields.source,
            ...authoringPin(submission),
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
  readonly submit: (submission: AuthoringSubmission) => Promise<void>;
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
            : { initial: { source: props.source, repository: "" } })}
        />
      )}
    </section>
  );
}

async function runTicketUpdate(input: {
  readonly ports: ReturnType<typeof useApiPorts>;
  readonly partition: { readonly tenant: string; readonly project: string };
  readonly ticket: AdoptedTicket;
  readonly submission: AuthoringSubmission;
}): Promise<void> {
  const key = newIdentity();
  const result = await adoptedTicketUpdate(
    input.ports,
    input.partition,
    input.ticket.ticket,
    input.ticket.revision,
    {
      source: input.submission.fields.source,
      ...authoringPin(input.submission),
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
  const update = async (submission: AuthoringSubmission): Promise<void> => {
    if (ticket === undefined) return;
    await runTicketUpdate({ ports, partition, ticket, submission });
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
  readonly update: (submission: AuthoringSubmission) => Promise<void>;
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
