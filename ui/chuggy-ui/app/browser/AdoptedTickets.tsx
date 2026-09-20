import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import type { ReactNode } from "react";
import type {
  AdoptedTicket,
  AdoptedTicketDefinition,
} from "../../../../src/contract/adoptedTickets.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ApiFailure } from "../core/apiRequest.ts";
import {
  adoptedExecutions,
  adoptedExecutionsShort,
} from "../core/adoptedExecutions.ts";
import type { AdoptedExecutions } from "../core/adoptedExecutions.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  projectListRereadNamed,
  projectPartitionKey,
} from "../core/projectQueryKeys.ts";
import { ticketLedgerOf } from "../core/ticketLedger.ts";
import { ticketTaskKeyNamesTicket } from "../core/ticketTaskKey.ts";
import { ticketUsageOf } from "../core/ticketUsage.ts";
import { envelopeMessage } from "../../../../src/contract/outcomes.ts";
import {
  adoptedOperation,
  assertAdoptedOperationSucceeded,
  adoptedTicketAction,
  adoptedTicketCreate,
  adoptedTicketDefinition,
  adoptedTicketUpdate,
  type CatalogPin,
} from "../core/adoptedTickets.ts";
import { useApiPorts, usePanelList, usePanelResource } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import {
  TicketFacts,
  TicketSituation,
} from "./ticket/TicketSituation.tsx";
import {
  TicketLedgerPanel,
  ticketLedgerSummary,
} from "./ticket/TicketLedgerPanel.tsx";
import { TicketProvenance } from "./ticket/TicketProvenance.tsx";
import { TicketUsage } from "./ticket/TicketUsage.tsx";
import {
  useTicketCatalog,
  useTicketValidation,
} from "./editor/useTicketAuthoring.ts";
import type { EditorFinding } from "./editor/chugEditor.ts";
import type { FragmentCatalog } from "./editor/fragments.ts";
import { Button } from "./ui/Button.tsx";
import { Dialog } from "./ui/Dialog.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Panel } from "./ui/Panel.tsx";
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
title:
instructions:
work: workloads/work.yaml
evaluation: evaluation-plans/review.yaml
finalization: finalizers/pull-request.yaml
`;

function failureSentence(failure: ApiFailure): string {
  if ("reason" in failure) return failure.reason;
  if (failure.outcome === "Conflict")
    return "This project uses an unsupported ticket model or the request conflicted.";
  const named = "status" in failure ? ` ${String(failure.status)}` : "";
  if ("body" in failure) {
    const said = envelopeMessage(failure.body);
    if (said !== undefined) return `${said} (${failure.code}${named})`;
  }
  if ("code" in failure)
    return `The request ended with ${failure.outcome}: ${failure.code}${named}.`;
  return `The request ended with ${failure.outcome}.`;
}

function newIdentity(): string {
  return crypto.randomUUID();
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
/**
 * A filling document claims the pane it sits in rather than a fixed band. The
 * shell stretches a page that holds a region, so that is what the mark is for.
 */
function AuthoringDocument(props: {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly findings: readonly EditorFinding[];
  readonly files: readonly string[];
  readonly catalog: FragmentCatalog | undefined;
  readonly fill?: boolean;
}): ReactNode {
  const filling = props.fill === true;
  return (
    <div
      className={
        filling
          ? "authoring-document authoring-document-fill"
          : "authoring-document"
      }
      {...(filling ? { role: "region", "aria-label": "Ticket YAML" } : {})}
    >
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
  readonly fill?: boolean;
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
    <div
      className={
        props.fill === true
          ? "authoring-form authoring-form-fill"
          : "authoring-form"
      }
    >
      <AuthoringPin fields={fields} setFields={setFields} />
      <AuthoringDocument
        value={fields.source}
        onChange={(source) => {
          setFields({ ...fields, source });
        }}
        findings={findings}
        files={files}
        catalog={catalog}
        {...(props.fill === true ? { fill: true } : {})}
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
    <main className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <h1>New ticket</h1>
      {failure === undefined ? null : (
        <p className="text-tone-fail">{failure}</p>
      )}
      <AuthoringForm
        fill
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


/**
 * The ticket's own definition, which is the read that carries its state, its
 * revision, the limit it is metered against and the document it was authored
 * as. It is a resource rather than a list, so the change frame naming this
 * ticket stales it and the page re-reads on the machine's own move.
 */
function useTicketDefinition(
  partition: PartitionIdentity,
  ticket: number,
): PanelState<AdoptedTicketDefinition> {
  return usePanelResource(partition, "Ticket", String(ticket), (ports) =>
    adoptedTicketDefinition(ports, partition, ticket),
  );
}

/** One entry per ticket, so two ticket pages open at once do not share one. */
function ticketExecutionsListName(ticket: number): string {
  return `executions:${String(ticket)}`;
}

/**
 * This ticket's runs. An `Execution` frame carries the task key as its
 * resource, so the key itself is what says whether a frame belongs to this
 * ticket — which is why the entry is re-read on the frames that name it and
 * left alone by every other ticket's.
 */
function useTicketExecutions(
  partition: PartitionIdentity,
  ticket: number,
): PanelState<AdoptedExecutions> {
  return usePanelList(
    projectListRereadNamed<AdoptedExecutions>(
      partition,
      "Execution",
      ticketExecutionsListName(ticket),
      (change) => ticketTaskKeyNamesTicket(change.resource, ticket),
    ),
    (ports, signal) => adoptedExecutions(ports, partition, ticket, signal),
  );
}

/** What a settled write does to the cache: the partition is re-asked, because
 * an operation moves more than the one row the caller named. */
function useSettled(partition: PartitionIdentity): () => Promise<void> {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries({
      queryKey: projectPartitionKey(partition),
    });
  };
}

export function AdoptedTicketPage(): ReactNode {
  const params = useParams({ from: "/$tenant/$project/tickets/$ticket" });
  const ticket = Number(params.ticket);
  if (!Number.isSafeInteger(ticket) || ticket <= 0)
    return <EmptyState label="No such ticket" variant="page" />;
  return (
    <TicketScreen
      partition={{ tenant: params.tenant, project: params.project }}
      ticket={ticket}
    />
  );
}

function TicketScreen(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  const definition = useTicketDefinition(props.partition, props.ticket);
  const executions = useTicketExecutions(props.partition, props.ticket);
  if (definition.state !== "Ready")
    return (
      <main className="grid gap-5 p-4">
        <h1>Ticket {props.ticket}</h1>
        <PanelUnready state={definition} />
      </main>
    );
  return (
    <TicketBody
      partition={props.partition}
      definition={definition.value}
      executions={executions}
    />
  );
}

/** Every mutation this page offers, and what each does to the cache after it
 * settles. The controls are unchanged: dispatch, resume, revoke, and the form
 * that writes a new definition. */
function useTicketWrites(
  partition: PartitionIdentity,
  definition: AdoptedTicketDefinition,
  dispatch: { readonly repository: string; readonly commit: string },
): {
  readonly act: (action: "dispatch" | "revoke" | "resume") => Promise<void>;
  readonly update: (submission: AuthoringSubmission) => Promise<void>;
} {
  const ports = useApiPorts();
  const settled = useSettled(partition);
  return {
    act: async (action) => {
      const result = await adoptedTicketAction(
        ports,
        partition,
        definition.ticket,
        action,
        newIdentity(),
        action === "dispatch" ? dispatch : undefined,
      );
      if (result.outcome !== "Ok") throw new Error(failureSentence(result));
      await waitForOperation(ports, partition, result.value.identity);
      await settled();
    },
    update: async (submission) => {
      await runTicketUpdate({
        ports,
        partition,
        ticket: definition,
        submission,
      });
      await settled();
    },
  };
}

/** The runs this page read, and what the ledger and the usage make of them. */
function TicketRuns(props: {
  readonly ticket: number;
  readonly executions: PanelState<AdoptedExecutions>;
  readonly nowMs: number;
}): ReactNode {
  const page =
    props.executions.state === "Ready" ? props.executions.value : undefined;
  if (page === undefined)
    return (
      <>
        <Panel title="Cycles" level={2}>
          <PanelUnready state={props.executions} />
        </Panel>
        <Panel title="Usage" level={2} meta="list price">
          <PanelUnready state={props.executions} />
        </Panel>
      </>
    );
  const short = adoptedExecutionsShort(page);
  const ledger = ticketLedgerOf(props.ticket, page.executions);
  return (
    <>
      <Panel
        title="Cycles"
        level={2}
        about="Each work cycle, and the runs that judged what it produced."
        meta={ticketLedgerSummary(ledger)}
      >
        <TicketLedgerPanel ledger={ledger} short={short} nowMs={props.nowMs} />
      </Panel>
      <Panel
        title="Usage"
        level={2}
        about="What this ticket has spent. There is no budget to draw it against."
        meta="list price"
      >
        <TicketUsage usage={ticketUsageOf(ledger)} />
      </Panel>
    </>
  );
}

function TicketBody(props: {
  readonly partition: PartitionIdentity;
  readonly definition: AdoptedTicketDefinition;
  readonly executions: PanelState<AdoptedExecutions>;
}): ReactNode {
  const definition = props.definition;
  const nowMs = useNowMs();
  const [dispatch, setDispatch] = useState({ repository: "", commit: "" });
  const [documentOpen, setDocumentOpen] = useState(false);
  const writes = useTicketWrites(props.partition, definition, dispatch);
  const page =
    props.executions.state === "Ready" ? props.executions.value : undefined;
  const short = page !== undefined && adoptedExecutionsShort(page);
  return (
    <main className="grid gap-5 p-4">
      <h1>Ticket {definition.ticket}</h1>
      <TicketSituation
        ticket={definition}
        executions={page?.executions}
        short={short}
        nowMs={nowMs}
      />
      <TicketFacts
        ticket={definition}
        executions={page?.executions}
        short={short}
      />
      <TicketRuns
        ticket={definition.ticket}
        executions={props.executions}
        nowMs={nowMs}
      />
      <Panel
        title="Provenance"
        level={2}
        about="What this ticket was authored as."
      >
        <TicketProvenance
          ticket={definition}
          source={definition.source}
          open={documentOpen}
          setOpen={setDocumentOpen}
        />
      </Panel>
      <TicketDispatch
        dispatch={dispatch}
        setDispatch={setDispatch}
        act={writes.act}
      />
      <TicketUpdate source={definition.source} submit={writes.update} />
    </main>
  );
}
