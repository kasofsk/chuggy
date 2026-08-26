/**
 * Creating a ticket: one screen, one submit, and a configuration nobody is
 * asked about.
 *
 * What is visible is what only a person can state — the intent, what to read
 * first, and the branch the work happens on; the rest is prefilled behind the
 * disclosure. Submit creates the draft and releases it in one motion, and the
 * navigation happens on a settled success alone, so a screen never hands a
 * reader a ticket the projection has not got to yet. Every other ending is
 * drawn here with its reason and the form still holding what was typed.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { briefLinksMax } from "../../../../src/contract/brief.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  DraftInitializationResponse,
  DraftResponse,
} from "../../../../src/contract/responses.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import { projectListKey } from "../core/projectQueryKeys.ts";
import type { ProjectQueryKey } from "../core/projectQueryKeys.ts";
import {
  creationBodyFrom,
  creationBranchHint,
  creationConfigurationSentence,
  creationFormFrom,
  creationStepSentence,
} from "../core/ticketCreation.ts";
import type {
  CreationFault,
  CreationField,
  TicketCreationForm,
} from "../core/ticketCreation.ts";
import {
  createAndReleaseTicket,
  creationContextSentence,
  readCreationContext,
} from "../core/ticketCreationRun.ts";
import type { CreationContext } from "../core/ticketCreationRun.ts";
import { operationSubmitting } from "../core/operationFollow.ts";
import type { OperationStep } from "../core/operationFollow.ts";
import { usePanelQuery, useApiPorts } from "./api.ts";
import { Panel } from "./Panel.tsx";
import { drawBytes } from "./ports.ts";
import { operationIdBytesCount } from "../core/operationFollow.ts";
import { TicketCreationAdvanced } from "./TicketCreationAdvanced.tsx";

/** The one list key this screen reads under, the context being the project's. */
export const creationContextName = "creation";

type Attempt =
  | { readonly attempt: "Idle" }
  | { readonly attempt: "Running"; readonly step: OperationStep }
  | {
      readonly attempt: "Failed";
      readonly reason: string;
      readonly draft: DraftResponse | undefined;
      readonly operation: string;
    }
  | { readonly attempt: "Stale"; readonly reason: string };

interface FormEdit {
  readonly form: TicketCreationForm;
  readonly onChange: (form: TicketCreationForm) => void;
}

function Fault(props: {
  readonly field: CreationField;
  readonly faults: readonly CreationFault[];
}): ReactNode {
  const found = props.faults.find((fault) => fault.field === props.field);
  return found === undefined ? null : (
    <p className="creation-fault">{found.reason}</p>
  );
}

function Intent(props: FormEdit): ReactNode {
  const { form, onChange } = props;
  return (
    <label className="creation-row creation-intent">
      <span>intent</span>
      <textarea
        rows={8}
        value={form.intent}
        placeholder="what this ticket is for"
        onChange={(event) => {
          onChange({ ...form, intent: event.target.value });
        }}
      />
    </label>
  );
}

function Links(props: FormEdit): ReactNode {
  const { form, onChange } = props;
  return (
    <fieldset className="creation-set">
      <legend>links</legend>
      {form.links.map((link, index) => (
        <div key={index} className="creation-row">
          <input
            type="url"
            value={link}
            placeholder="https://"
            onChange={(event) => {
              onChange({
                ...form,
                links: form.links.map((held, at) =>
                  at === index ? event.target.value : held,
                ),
              });
            }}
          />
          <button
            type="button"
            onClick={() => {
              onChange({
                ...form,
                links: form.links.filter((_, at) => at !== index),
              });
            }}
          >
            remove
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={form.links.length >= briefLinksMax}
        onClick={() => {
          onChange({ ...form, links: [...form.links, ""] });
        }}
      >
        add link
      </button>
    </fieldset>
  );
}

function Branch(props: FormEdit): ReactNode {
  const { form, onChange } = props;
  return (
    <label className="creation-row">
      <span>branch</span>
      <input
        type="text"
        value={form.branchName}
        placeholder="the branch name"
        onChange={(event) => {
          onChange({ ...form, branchName: event.target.value });
        }}
      />
      <span className="creation-hint">{creationBranchHint}</span>
    </label>
  );
}

function AttemptNote(props: { readonly attempt: Attempt }): ReactNode {
  const attempt = props.attempt;
  switch (attempt.attempt) {
    case "Idle":
      return null;
    case "Running":
      return <p className="panel-note">{creationStepSentence(attempt.step)}</p>;
    case "Stale":
      return <p className="panel-absent">{attempt.reason}</p>;
    case "Failed":
      return (
        <p className="panel-failed">
          {attempt.reason}
          {attempt.draft === undefined
            ? ""
            : ` — draft ${String(attempt.draft.ticket)} was created and not released; submitting again releases that draft`}
        </p>
      );
  }
}

/** A submit that outlived its screen has nowhere to report, so it stops there. */
function useMounted(): { readonly current: boolean } {
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  return mounted;
}

function CreationFields(
  props: FormEdit & {
    readonly faults: readonly CreationFault[];
    readonly initialization: DraftInitializationResponse;
  },
): ReactNode {
  const { faults, form, initialization, onChange } = props;
  return (
    <>
      <p className="creation-configuration">
        {creationConfigurationSentence(initialization.configuration)}
      </p>
      <Intent form={form} onChange={onChange} />
      <Fault field="intent" faults={faults} />
      <Links form={form} onChange={onChange} />
      <Fault field="links" faults={faults} />
      <Branch form={form} onChange={onChange} />
      <Fault field="branch" faults={faults} />
      <TicketCreationAdvanced
        form={form}
        onChange={onChange}
        initialization={initialization}
      />
      <Fault field="authoring" faults={faults} />
      <Fault field="fence" faults={faults} />
    </>
  );
}

interface CreationSubmit {
  readonly attempt: Attempt;
  readonly submit: (form: TicketCreationForm) => Promise<void>;
}

/**
 * What a resubmission reuses, a draft that was never created reusing neither.
 * The operation identity is what the API keys a submission by, so a fresh one
 * would ask about a release nobody made rather than the one still in flight.
 */
function creationResubmission(attempt: Attempt): {
  readonly operation: string;
  readonly draft: DraftResponse | undefined;
} {
  const held =
    attempt.attempt === "Failed" && attempt.draft !== undefined
      ? attempt
      : undefined;
  return {
    operation:
      held?.operation ?? base64urlFromBytes(drawBytes(operationIdBytesCount)),
    draft: held?.draft,
  };
}

/**
 * One submit, from the body it assembles to the state it leaves behind. The
 * form's faults are set by the caller's own setter, so nothing but this hook
 * knows how far the attempt got.
 */
function useCreationSubmit(props: {
  readonly ports: ApiPorts;
  readonly partition: PartitionIdentity;
  readonly queryKey: ProjectQueryKey;
  readonly initialization: DraftInitializationResponse;
  readonly onFaults: (faults: readonly CreationFault[]) => void;
  readonly onCreated: (ticket: number) => void;
}): CreationSubmit {
  const client = useQueryClient();
  const mounted = useMounted();
  const [attempt, setAttempt] = useState<Attempt>({ attempt: "Idle" });
  const { initialization, onCreated, onFaults, ports, partition, queryKey } =
    props;

  const submit = async (form: TicketCreationForm): Promise<void> => {
    const assembled = creationBodyFrom(initialization, form);
    if (assembled.assembled === "Faults") {
      onFaults(assembled.faults);
      return;
    }
    onFaults([]);
    const resubmitted = creationResubmission(attempt);
    setAttempt({ attempt: "Running", step: operationSubmitting() });
    const created = await createAndReleaseTicket(
      ports,
      partition,
      { body: assembled.body, ...resubmitted },
      (step) => {
        if (mounted.current) setAttempt({ attempt: "Running", step });
      },
    );
    if (!mounted.current) return;
    if (created.created === "Created") {
      onCreated(created.ticket);
      return;
    }
    if (created.created === "Stale") {
      setAttempt({ attempt: "Stale", reason: created.reason });
      await client.invalidateQueries({ queryKey });
      return;
    }
    setAttempt({
      attempt: "Failed",
      reason: created.reason,
      draft: created.draft,
      operation: resubmitted.operation,
    });
  };

  return { attempt, submit };
}

/**
 * The form itself, which reaches the network and the address bar through its
 * caller: the route component below owns the session and the router, and this
 * owns what one screenful of typing becomes.
 */
export function CreationForm(props: {
  readonly ports: ApiPorts;
  readonly partition: PartitionIdentity;
  readonly queryKey: ProjectQueryKey;
  readonly context: Extract<CreationContext, { context: "Ready" }>;
  readonly onCreated: (ticket: number) => void;
}): ReactNode {
  const [edited, setEdited] = useState<TicketCreationForm | undefined>(
    undefined,
  );
  const [faults, setFaults] = useState<readonly CreationFault[]>([]);
  const initialization = props.context.initialization;
  const running = useCreationSubmit({
    ports: props.ports,
    partition: props.partition,
    queryKey: props.queryKey,
    initialization,
    onFaults: setFaults,
    onCreated: props.onCreated,
  });
  const form = edited ?? creationFormFrom(initialization);
  return (
    <div className="creation">
      <CreationFields
        form={form}
        onChange={setEdited}
        faults={faults}
        initialization={initialization}
      />
      <button
        type="button"
        disabled={running.attempt.attempt === "Running"}
        onClick={() => {
          void running.submit(form);
        }}
      >
        create and release
      </button>
      <AttemptNote attempt={running.attempt} />
    </div>
  );
}

export function TicketCreation(): ReactNode {
  const params = useParams({ from: "/$tenant/$project" });
  const ports = useApiPorts();
  const navigate = useNavigate();
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const queryKey = projectListKey(
    partition,
    "Configuration",
    creationContextName,
  );
  const state = usePanelQuery(queryKey, (readPorts) =>
    readCreationContext(readPorts, partition),
  );
  return (
    <Panel title="new ticket" state={state}>
      {(context) =>
        context.context === "Ready" ? (
          <CreationForm
            ports={ports}
            partition={partition}
            queryKey={queryKey}
            context={context}
            onCreated={(ticket) => {
              void navigate({
                to: "/$tenant/$project/tickets/$ticket",
                params: { ...partition, ticket: String(ticket) },
              });
            }}
          />
        ) : (
          <p className="panel-absent">{creationContextSentence(context)}</p>
        )
      }
    </Panel>
  );
}
