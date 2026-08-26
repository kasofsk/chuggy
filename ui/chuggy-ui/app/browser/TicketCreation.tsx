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
import { base64urlFromBytes } from "../core/base64url.ts";
import { projectListKey } from "../core/projectQueryKeys.ts";
import type { ProjectQueryKey } from "../core/projectQueryKeys.ts";
import {
  creationBodyFrom,
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
  readCreationContext,
} from "../core/ticketCreationRun.ts";
import type { CreationContext } from "../core/ticketCreationRun.ts";
import { operationSubmitting } from "../core/operationFollow.ts";
import type { OperationStep } from "../core/operationFollow.ts";
import { usePanelQuery, useApiPorts } from "./api.ts";
import { Panel } from "./Panel.tsx";
import { drawBytes } from "./ports.ts";
import { operationIdBytesCount } from "./TicketActions.tsx";
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
      <span className="creation-hint">
        a name, which this console sends as a full reference under refs/heads/
      </span>
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
 * One submit, from the body it assembles to the state it leaves behind. The
 * form's faults are set by the caller's own setter, so nothing but this hook
 * knows how far the attempt got.
 */
function useCreationSubmit(props: {
  readonly partition: PartitionIdentity;
  readonly queryKey: ProjectQueryKey;
  readonly initialization: DraftInitializationResponse;
  readonly onFaults: (faults: readonly CreationFault[]) => void;
}): CreationSubmit {
  const ports = useApiPorts();
  const client = useQueryClient();
  const navigate = useNavigate();
  const mounted = useMounted();
  const [attempt, setAttempt] = useState<Attempt>({ attempt: "Idle" });
  const { initialization, onFaults, partition, queryKey } = props;

  const submit = async (form: TicketCreationForm): Promise<void> => {
    const assembled = creationBodyFrom(initialization, form);
    if (assembled.assembled === "Faults") {
      onFaults(assembled.faults);
      return;
    }
    onFaults([]);
    setAttempt({ attempt: "Running", step: operationSubmitting() });
    const created = await createAndReleaseTicket(
      ports,
      partition,
      {
        body: assembled.body,
        operation: base64urlFromBytes(drawBytes(operationIdBytesCount)),
        draft: attempt.attempt === "Failed" ? attempt.draft : undefined,
      },
      (step) => {
        if (mounted.current) setAttempt({ attempt: "Running", step });
      },
    );
    if (!mounted.current) return;
    if (created.created === "Created") {
      await navigate({
        to: "/$tenant/$project/tickets/$ticket",
        params: { ...partition, ticket: String(created.ticket) },
      });
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
    });
  };

  return { attempt, submit };
}

function CreationForm(props: {
  readonly partition: PartitionIdentity;
  readonly queryKey: ProjectQueryKey;
  readonly context: Extract<CreationContext, { context: "Ready" }>;
}): ReactNode {
  const [edited, setEdited] = useState<TicketCreationForm | undefined>(
    undefined,
  );
  const [faults, setFaults] = useState<readonly CreationFault[]>([]);
  const initialization = props.context.initialization;
  const running = useCreationSubmit({
    partition: props.partition,
    queryKey: props.queryKey,
    initialization,
    onFaults: setFaults,
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
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const queryKey = projectListKey(
    partition,
    "Configuration",
    creationContextName,
  );
  const state = usePanelQuery(queryKey, (ports) =>
    readCreationContext(ports, partition),
  );
  return (
    <Panel title="new ticket" state={state}>
      {(context) =>
        context.context === "NoReadyConfiguration" ? (
          <p className="panel-absent">
            this project has no ready configuration, so there is nothing to
            shape a ticket with yet
          </p>
        ) : (
          <CreationForm
            partition={partition}
            queryKey={queryKey}
            context={context}
          />
        )
      }
    </Panel>
  );
}
