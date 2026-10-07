/**
 * Creating a ticket: one screen, one submit, and a configuration asked about
 * unless the project is known to offer one alone.
 *
 * What is visible is what only a person can state — which configuration does
 * the work where there is a choice, the title, the intent, what to read first,
 * the check lines this ticket adds where its configuration commands a stage
 * for them, the branch the work happens on and the one it lands on; the rest
 * is prefilled behind the disclosure. Submit creates the draft and releases it
 * in one motion, and the navigation happens on a settled success alone, so a
 * screen never hands a reader a ticket the projection has not got to yet.
 * Every other ending is drawn here with its reason and the form still holding
 * what was typed.
 */

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  briefChecksMax,
  briefLinksMax,
} from "../../../../src/contract/brief.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  DraftResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import { briefFinalizationModes } from "../../../../src/contract/rosters.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import type { ProjectQueryKey } from "../core/projectQueryKeys.ts";
import { landingEffect, landingLabel } from "../core/codeLabels.ts";
import { repositoryLabel } from "../core/projectRepositories.ts";
import { configurationsPartialLabel } from "../core/repositoryConfigurations.ts";
import {
  creationBodyFrom,
  creationBootstrapLine,
  creationBranchFieldHint,
  creationConfigurationAsked,
  creationConfigurationChosen,
  creationConfigurationLabel,
  creationFormFrom,
  creationOfferOf,
  creationRepositories,
  creationRepositoryChosen,
  creationStepSentence,
  creationTargetBranchFieldHint,
} from "../core/ticketCreation.ts";
import type {
  CreationFault,
  CreationField,
  CreationMotion,
  CreationOffer,
  TicketCreationForm,
} from "../core/ticketCreation.ts";
import {
  createAndReleaseTicket,
  creationContextList,
  creationContextSentence,
  readCreationContext,
} from "../core/ticketCreationRun.ts";
import type { CreationContext } from "../core/ticketCreationRun.ts";
import { operationSubmitting } from "../core/operationFollow.ts";
import type { OperationStep } from "../core/operationFollow.ts";
import { usePanelList, useApiPorts } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import {
  ticketConfigurationKept,
  ticketConfigurationStored,
  ticketYamlForgotten,
  ticketYamlStoreKey,
  useAuthoringGuards,
} from "./editor/authoringGuards.tsx";
import { TicketAuthoring } from "./editor/TicketAuthoring.tsx";
import { drawBytes } from "./ports.ts";
import { operationIdBytesCount } from "../core/operationFollow.ts";
import { TopBarSlot } from "./shell/slots.tsx";
import { TicketCreationAdvanced } from "./TicketCreationAdvanced.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Picker } from "./ui/Picker.tsx";
import { RadioGroup } from "./ui/RadioGroup.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

import "./TicketCreation.css";

export type Attempt =
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
    <p className="text-tone-fail">{found.reason}</p>
  );
}

/** The line for the one configuration a project offers, its revision on hover. */
function ConfigurationLine(props: {
  readonly offer: CreationOffer;
}): ReactNode {
  const shaping = creationConfigurationLabel(props.offer);
  return (
    <Tooltip text={shaping.title}>
      <p className="text-ink-3">{shaping.text}</p>
    </Tooltip>
  );
}

/**
 * Which configuration the ticket runs under: a line where the project offers
 * one, and a choice among them by name where it offers several, starting on
 * none the reader did not choose.
 */
function Configuration(
  props: FormEdit & { readonly offers: readonly CreationOffer[] },
): ReactNode {
  const { form, onChange, offers } = props;
  const chosen = creationOfferOf(offers, form.configuration);
  const sole = creationConfigurationAsked(offers, form.configuration)
    ? undefined
    : chosen;
  const bootstrap =
    chosen === undefined ? undefined : creationBootstrapLine(chosen);
  return (
    <>
      {sole === undefined ? (
        <div className="creation-row">
          <span>Configuration</span>
          <Picker
            label="Configuration"
            value={form.configuration}
            placeholder="Choose"
            hint={chosen?.initialization.configuration.revision}
            options={offers.map((offer) => ({
              value: offer.name,
              text: offer.name,
            }))}
            onChoose={(name) => {
              onChange(creationConfigurationChosen(form, offers, name));
            }}
          />
        </div>
      ) : (
        <ConfigurationLine offer={sole} />
      )}
      {bootstrap === undefined ? null : (
        <Notice tone="info" detail={bootstrap} />
      )}
    </>
  );
}

function Title(props: FormEdit): ReactNode {
  const { form, onChange } = props;
  return (
    <label className="creation-row">
      <span>Title</span>
      <input
        type="text"
        value={form.title}
        placeholder="what this ticket is called"
        onChange={(event) => {
          onChange({ ...form, title: event.target.value });
        }}
      />
    </label>
  );
}

function Intent(props: FormEdit): ReactNode {
  const { form, onChange } = props;
  return (
    <label className="creation-row creation-intent">
      <span>Intent</span>
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
      <legend>Links</legend>
      {form.links.map((link, index) => (
        <div key={index} className="creation-row creation-line">
          <input
            type="url"
            aria-label={`Link ${String(index + 1)}`}
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
          <Button
            size="sm"
            onClick={() => {
              onChange({
                ...form,
                links: form.links.filter((_, at) => at !== index),
              });
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        disabled={form.links.length >= briefLinksMax}
        onClick={() => {
          onChange({ ...form, links: [...form.links, ""] });
        }}
      >
        Add link
      </Button>
    </fieldset>
  );
}

/** The command lines this ticket adds to the stage its configuration runs. */
function Checks(props: FormEdit): ReactNode {
  const { form, onChange } = props;
  return (
    <fieldset className="creation-set">
      <legend>Checks</legend>
      {form.checks.map((check, index) => (
        <div key={index} className="creation-row creation-line">
          <input
            type="text"
            aria-label={`Check ${String(index + 1)}`}
            value={check}
            placeholder="a command line"
            onChange={(event) => {
              onChange({
                ...form,
                checks: form.checks.map((held, at) =>
                  at === index ? event.target.value : held,
                ),
              });
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              onChange({
                ...form,
                checks: form.checks.filter((_, at) => at !== index),
              });
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        disabled={form.checks.length >= briefChecksMax}
        onClick={() => {
          onChange({ ...form, checks: [...form.checks, ""] });
        }}
      >
        Add check
      </Button>
    </fieldset>
  );
}

/** A branch box, its hint the box's description rather than part of its name. */
function BranchRow(props: {
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}): ReactNode {
  const box = useId();
  const hint = useId();
  return (
    <div className="creation-row">
      <label htmlFor={box} className="text-ink-3">
        {props.label}
      </label>
      <input
        id={box}
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        aria-describedby={hint}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      <span id={hint} className="creation-hint text-ink-3 text-xs">
        {props.hint}
      </span>
    </div>
  );
}

function Branch(props: FormEdit): ReactNode {
  const { form, onChange } = props;
  return (
    <BranchRow
      label="Branch"
      hint={creationBranchFieldHint}
      value={form.branchName}
      placeholder="the branch name"
      onChange={(branchName) => {
        onChange({ ...form, branchName });
      }}
    />
  );
}

function TargetBranch(props: FormEdit): ReactNode {
  const { form, onChange } = props;
  return (
    <BranchRow
      label="Target branch"
      hint={creationTargetBranchFieldHint(form.landingMode)}
      value={form.targetBranchName}
      placeholder="the branch to land on"
      onChange={(targetBranchName) => {
        onChange({ ...form, targetBranchName });
      }}
    />
  );
}

/** The repository the work happens in, drawn only where the project holds a live
 * binding: holding none names none, and the form neither asks nor sends. */
function Repository(
  props: FormEdit & {
    readonly repositories: readonly ProjectRepositoryResponse[];
  },
): ReactNode {
  const { form, onChange, repositories } = props;
  if (repositories.length === 0) return null;
  return (
    <div className="creation-row">
      <span>Repository</span>
      <Picker
        label="Repository"
        value={form.repository}
        placeholder="Choose"
        hint={form.repository === "" ? undefined : form.repository}
        options={repositories.map((binding) => ({
          value: binding.repository,
          text: repositoryLabel(binding.repository),
        }))}
        onChoose={(repository) => {
          onChange(creationRepositoryChosen(form, repositories, repository));
        }}
      />
    </div>
  );
}

const landingOptions = briefFinalizationModes.map((mode) => ({
  value: mode,
  text: landingLabel(mode),
  description: landingEffect(mode),
}));

/** How this ticket lands, seeded from the repository's default. */
function Landing(props: FormEdit): ReactNode {
  const { form, onChange } = props;
  return (
    <div className="creation-row">
      <span>Landing</span>
      <RadioGroup
        label="Landing"
        value={form.landingMode}
        options={landingOptions}
        onChoose={(value) => {
          const chosen = briefFinalizationModes.find((mode) => mode === value);
          if (chosen !== undefined) onChange({ ...form, landingMode: chosen });
        }}
      />
    </div>
  );
}

/** What a failed submit left in the draft, which only a submit that got as far
 * as the draft has anything to say about. */
function attemptHeldDraft(
  draft: DraftResponse | undefined,
  motion: CreationMotion,
): string {
  if (draft === undefined) return "";
  switch (motion) {
    case "Release":
      return ` — draft ${String(draft.ticket)} was created and not released; submitting again releases that draft`;
    case "Update":
      return ` — the draft holds this revision at version ${String(draft.authoringVersion)}, not released`;
  }
}

export function AttemptNote(props: {
  readonly attempt: Attempt;
  readonly motion?: CreationMotion;
}): ReactNode {
  const attempt = props.attempt;
  const motion = props.motion ?? "Release";
  switch (attempt.attempt) {
    case "Idle":
      return null;
    case "Running":
      return (
        <p className="panel-note">
          {creationStepSentence(attempt.step, motion)}
        </p>
      );
    case "Stale":
      return <p className="panel-absent">{attempt.reason}</p>;
    case "Failed":
      return (
        <p className="panel-failed">
          {attempt.reason}
          {attemptHeldDraft(attempt.draft, motion)}
        </p>
      );
  }
}

/** A submit that outlived its screen has nowhere to report, so it stops there. */
export function useMounted(): { readonly current: boolean } {
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  return mounted;
}

/** A released ticket's dependencies, drawn and not offered, because an update
 * that moved them would be refused. */
function LockedDependencies(props: {
  readonly dependencies: readonly number[];
}): ReactNode {
  return (
    <div className="creation-row">
      <span>Dependencies</span>
      <p>
        {props.dependencies.length === 0
          ? "None"
          : props.dependencies.map((held) => `#${String(held)}`).join(", ")}
      </p>
      <span className="creation-hint text-ink-3 text-xs">
        Fixed once released
      </span>
    </div>
  );
}

export function CreationFields(
  props: FormEdit & {
    readonly faults: readonly CreationFault[];
    readonly offers: readonly CreationOffer[];
    /** Whether some offer may be missing from the ones given. */
    readonly partial?: boolean;
    readonly repositories: readonly ProjectRepositoryResponse[];
    readonly dependenciesLocked?: boolean;
  },
): ReactNode {
  const { faults, form, onChange } = props;
  const drawn = creationOfferOf(props.offers, form.configuration);
  return (
    <>
      <Configuration form={form} onChange={onChange} offers={props.offers} />
      <Fault field="configuration" faults={faults} />
      {props.partial === true ? (
        <p className="text-ink-3 text-sm">{configurationsPartialLabel}</p>
      ) : null}
      <Title form={form} onChange={onChange} />
      <Fault field="title" faults={faults} />
      <Intent form={form} onChange={onChange} />
      <Fault field="intent" faults={faults} />
      <Links form={form} onChange={onChange} />
      <Fault field="links" faults={faults} />
      {drawn?.initialization.commandedCheckStage === undefined ? null : (
        <>
          <Checks form={form} onChange={onChange} />
          <Fault field="checks" faults={faults} />
        </>
      )}
      <Branch form={form} onChange={onChange} />
      <Fault field="branch" faults={faults} />
      <Repository
        form={form}
        onChange={onChange}
        repositories={props.repositories}
      />
      <Fault field="repository" faults={faults} />
      <Landing form={form} onChange={onChange} />
      <Fault field="landing" faults={faults} />
      {form.landingMode === "None" ? null : (
        <>
          <TargetBranch form={form} onChange={onChange} />
          <Fault field="target" faults={faults} />
        </>
      )}
      {props.dependenciesLocked === true ? (
        <LockedDependencies dependencies={form.dependencies} />
      ) : null}
      {drawn === undefined ? null : (
        <TicketCreationAdvanced
          form={form}
          onChange={onChange}
          initialization={drawn.initialization}
          dependenciesLocked={props.dependenciesLocked === true}
        />
      )}
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
  readonly offers: readonly CreationOffer[];
  readonly repositories: readonly ProjectRepositoryResponse[];
  readonly onFaults: (faults: readonly CreationFault[]) => void;
  readonly onCreated: (ticket: number) => void;
}): CreationSubmit {
  const client = useQueryClient();
  const mounted = useMounted();
  const [attempt, setAttempt] = useState<Attempt>({ attempt: "Idle" });
  const {
    offers,
    onCreated,
    onFaults,
    ports,
    partition,
    queryKey,
    repositories,
  } = props;

  const submit = async (form: TicketCreationForm): Promise<void> => {
    const assembled = creationBodyFrom(offers, form, repositories);
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
 * What the form holds: what it started on, what was typed over that, and the
 * configuration the reader chose, remembered as they choose it so the next
 * new ticket here starts on it.
 */
function useCreationHeld(
  partition: PartitionIdentity,
  offers: readonly CreationOffer[],
  repositories: readonly ProjectRepositoryResponse[],
  partial: boolean,
): {
  readonly initial: TicketCreationForm;
  readonly form: TicketCreationForm;
  readonly changed: (form: TicketCreationForm) => void;
} {
  const [edited, setEdited] = useState<TicketCreationForm | undefined>(
    undefined,
  );
  const [preferred] = useState(() => ticketConfigurationStored(partition));
  const initial = useMemo(
    () => creationFormFrom(offers, repositories, preferred, partial),
    [offers, repositories, preferred, partial],
  );
  const form = edited ?? initial;
  const changed = (next: TicketCreationForm): void => {
    if (next.configuration !== "" && next.configuration !== form.configuration)
      ticketConfigurationKept(partition, next.configuration);
    setEdited(next);
  };
  return { initial, form, changed };
}

/**
 * The form itself, which reaches the network and the address bar through its
 * caller: the route component below owns the session and the router, and this
 * owns what one screenful of typing becomes, as fields or as YAML.
 */
export function CreationForm(props: {
  readonly ports: ApiPorts;
  readonly partition: PartitionIdentity;
  readonly queryKey: ProjectQueryKey;
  readonly context: Extract<CreationContext, { context: "Ready" }>;
  readonly onCreated: (ticket: number) => void;
  readonly onDirty?: (dirty: boolean) => void;
}): ReactNode {
  const [faults, setFaults] = useState<readonly CreationFault[]>([]);
  const { offers, partial, repositories: bound } = props.context;
  const repositories = useMemo(() => creationRepositories(bound), [bound]);
  const storeKey = ticketYamlStoreKey(props.partition, undefined);
  const onCreated = props.onCreated;
  const running = useCreationSubmit({
    ports: props.ports,
    partition: props.partition,
    queryKey: props.queryKey,
    offers,
    repositories,
    onFaults: setFaults,
    onCreated: (ticket) => {
      ticketYamlForgotten(storeKey);
      onCreated(ticket);
    },
  });
  const held = useCreationHeld(props.partition, offers, repositories, partial);
  return (
    <div className="creation">
      <TicketAuthoring
        initial={held.initial}
        form={held.form}
        onForm={held.changed}
        offers={offers}
        repositories={repositories}
        dependenciesLocked={false}
        assemble={(form) => creationBodyFrom(offers, form, repositories)}
        storeKey={storeKey}
        submitLabel="Create ticket"
        submitEffect="Releases the ticket to run"
        busy={running.attempt.attempt === "Running"}
        onSubmit={(form) => {
          void running.submit(form);
        }}
        onDirty={props.onDirty}
        fields={
          <CreationFields
            form={held.form}
            onChange={held.changed}
            faults={faults}
            offers={offers}
            partial={partial}
            repositories={repositories}
          />
        }
      />
      <AttemptNote attempt={running.attempt} />
    </div>
  );
}

/** What a project with nothing to shape a ticket with draws: the status, and
 * where the way out of it is where one exists to name. */
export function CreationContextAbsent(props: {
  readonly partition: PartitionIdentity;
  readonly context: Exclude<CreationContext, { context: "Ready" }>;
}): ReactNode {
  const { partition, context } = props;
  if (context.context === "ReadyConfigurationUnknown")
    return <p className="panel-absent">{creationContextSentence(context)}</p>;
  return (
    <EmptyState
      variant="page"
      label={creationContextSentence(context)}
      action={
        context.context === "NoRepository" ? (
          <Link to="/$tenant/$project/repositories" params={partition}>
            Repositories
          </Link>
        ) : undefined
      }
    />
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
  const [dirty, setDirty] = useState(false);
  const guard = useAuthoringGuards(dirty);
  const list = creationContextList(partition);
  const queryKey = list.key;
  const state = usePanelList(list, (readPorts) =>
    readCreationContext(readPorts, partition),
  );
  return (
    <>
      <TopBarSlot>
        <h1 className="text-md font-strong text-ink-1 truncate">New ticket</h1>
      </TopBarSlot>
      <DataPanel title="Draft" state={state}>
        {(context) =>
          context.context === "Ready" ? (
            <CreationForm
              ports={ports}
              partition={partition}
              queryKey={queryKey}
              context={context}
              onDirty={setDirty}
              onCreated={(ticket) => {
                guard.release();
                void navigate({
                  to: "/$tenant/$project/tickets/$ticket",
                  params: { ...partition, ticket: String(ticket) },
                });
              }}
            />
          ) : (
            <CreationContextAbsent partition={partition} context={context} />
          )
        }
      </DataPanel>
    </>
  );
}
