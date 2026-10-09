/**
 * Creating a ticket: one screen, one submit, and a configuration asked about
 * unless the project is known to offer one alone.
 *
 * What is visible is what only a person can state — which configuration does
 * the work where there is a choice, the title, the intent, what to read first,
 * the images it carries, the check lines this ticket adds where its
 * configuration commands a stage for them, the branch the work happens on and
 * the one it lands on; the rest is prefilled behind the disclosure. Submit
 * creates the draft, releases it and, for a reader who may dispatch, starts
 * the ticket in one motion, and the navigation happens on a settled release
 * alone, so a screen never hands a reader a ticket the projection has not got
 * to yet. Every other ending of the release is drawn here with its reason and
 * the form still holding what was typed.
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
  creationSubmitEffect,
  creationSubmitMotion,
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
  creationTicketExistsSentence,
  readCreationContext,
} from "../core/ticketCreationRun.ts";
import type {
  CreationContext,
  CreationDraftHeld,
  DraftHeld,
  TicketCreationEnded,
} from "../core/ticketCreationRun.ts";
import { ticketDuplicateDroppedSentence } from "../core/ticketDuplicate.ts";
import type { TicketDuplicateSeed } from "../core/ticketDuplicate.ts";
import { operationSubmitting } from "../core/operationFollow.ts";
import type { OperationStep } from "../core/operationFollow.ts";
import { usePanelList, useApiPorts } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import {
  ticketConfigurationKept,
  ticketConfigurationStored,
  ticketYamlDuplicateStoreKey,
  ticketYamlForgotten,
  ticketYamlStoreKey,
  useAuthoringGuards,
} from "./editor/authoringGuards.tsx";
import { TicketAuthoring } from "./editor/TicketAuthoring.tsx";
import { drawBytes } from "./ports.ts";
import { useProjectAbilityRead } from "./projectAbilities.tsx";
import { operationIdBytesCount } from "../core/operationFollow.ts";
import { DraftScreen } from "./ticket/DraftScreen.tsx";
import { TicketCreationAdvanced } from "./TicketCreationAdvanced.tsx";
import { ConfigurationOverrides } from "./ConfigurationOverrides.tsx";
import { overrideDocumentOf, overrideFields } from "../core/ticketOverrides.ts";
import type { OverrideField } from "../core/ticketOverrides.ts";
import { Panel } from "./ui/Panel.tsx";
import { CreationImages } from "./TicketCreationImages.tsx";
import type { CreationImagesApi } from "./TicketCreationImages.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Picker } from "./ui/Picker.tsx";
import { RadioGroup } from "./ui/RadioGroup.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

import "./TicketCreation.css";

export type Attempt<Held extends DraftHeld = DraftHeld> =
  | { readonly attempt: "Idle" }
  | { readonly attempt: "Running"; readonly step: OperationStep }
  | {
      readonly attempt: "Failed";
      readonly reason: string;
      readonly held: Held | undefined;
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

/** What a failed update left in the draft, which only one that got as far as
 * the draft has anything to say about. A creation's reason says where its own
 * draft stands, that being more than one thing. */
function attemptHeldDraft(
  draft: DraftResponse | undefined,
  motion: CreationMotion,
): string {
  if (draft === undefined || motion !== "Update") return "";
  return ` — the draft holds this revision at version ${String(draft.authoringVersion)}, not released`;
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
          {attemptHeldDraft(attempt.held?.draft, motion)}
        </p>
      );
  }
}

/**
 * What the ticket replaces of the configuration it names, behind a disclosure
 * of its own: an override is free text, which the advanced settings, offering
 * only what the initialization offered, never are.
 */
function Overrides(
  props: FormEdit & {
    /** The chosen configuration, absent until one is chosen. */
    readonly offer: CreationOffer | undefined;
    readonly faults: readonly CreationFault[];
  },
): ReactNode {
  const { form, onChange } = props;
  const canonical = props.offer?.initialization.configuration.canonical;
  const document = useMemo(
    () => (canonical === undefined ? undefined : overrideDocumentOf(canonical)),
    [canonical],
  );
  const general = props.faults.filter(
    (fault) => fault.field === "overrides" && fault.override === undefined,
  );
  const faults = new Map<OverrideField, string>(
    props.faults.flatMap((fault) =>
      fault.override === undefined ? [] : [[fault.override, fault.reason]],
    ),
  );
  if (canonical === undefined) return null;
  return (
    <Panel title="Overrides" collapsible={{ open: false }}>
      <ConfigurationOverrides
        document={document}
        overrides={form.overrides}
        fields={overrideFields}
        faults={faults}
        onChange={(overrides) => {
          onChange({ ...form, overrides });
        }}
      />
      <Fault field="overrides" faults={general} />
    </Panel>
  );
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
    readonly api: CreationImagesApi;
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
      <CreationImages form={form} onChange={onChange} api={props.api} />
      <Fault field="images" faults={faults} />
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
      <Overrides {...props} offer={drawn} />
      <Fault field="fence" faults={faults} />
    </>
  );
}

/** A creation's attempt, which alone may end at a ticket it did not make. */
type CreationAttempt =
  | Attempt<CreationDraftHeld>
  | {
      readonly attempt: "Exists";
      readonly ticket: number;
      readonly held: CreationDraftHeld;
    };

/** What a submit that made no ticket leaves on the screen, and holds for the
 * next one. */
function creationAttemptOf(
  ended: Exclude<TicketCreationEnded, { readonly created: "Created" }>,
): CreationAttempt {
  switch (ended.created) {
    case "Stale":
      return { attempt: "Stale", reason: ended.reason };
    case "Exists":
      return { attempt: "Exists", ticket: ended.ticket, held: ended.held };
    case "Refused":
      return { attempt: "Failed", reason: ended.reason, held: ended.held };
  }
}

/** The draft the next submit goes back to, which every ending that wrote or
 * found one hands on. */
function creationAttemptHeld(
  attempt: CreationAttempt,
): CreationDraftHeld | undefined {
  return attempt.attempt === "Failed" || attempt.attempt === "Exists"
    ? attempt.held
    : undefined;
}

/**
 * What a creation's submit ended in. A ticket found already made is said with
 * the way to it, the form being left as it is: what it has changed since is
 * in no ticket, and a navigation nobody asked for would hide that.
 */
function CreationAttemptNote(props: {
  readonly attempt: CreationAttempt;
  readonly motion: CreationMotion;
  readonly existing: (ticket: number) => ReactNode;
}): ReactNode {
  const attempt = props.attempt;
  if (attempt.attempt !== "Exists")
    return <AttemptNote attempt={attempt} motion={props.motion} />;
  return (
    <p className="panel-failed">
      {creationTicketExistsSentence(attempt.ticket)} —{" "}
      {props.existing(attempt.ticket)}
    </p>
  );
}

interface CreationSubmit {
  readonly attempt: CreationAttempt;
  readonly submit: (form: TicketCreationForm) => Promise<void>;
}

/** An operation identity nothing has been sent under. */
function operationDrawn(): string {
  return base64urlFromBytes(drawBytes(operationIdBytesCount));
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
  readonly dispatches: boolean;
  readonly onFaults: (faults: readonly CreationFault[]) => void;
  readonly onCreated: (ticket: number) => void;
}): CreationSubmit {
  const client = useQueryClient();
  const mounted = useMounted();
  const [attempt, setAttempt] = useState<CreationAttempt>({ attempt: "Idle" });
  const {
    dispatches,
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
    const held = creationAttemptHeld(attempt);
    const operation = operationDrawn();
    const dispatchOperation = dispatches ? operationDrawn() : undefined;
    setAttempt({ attempt: "Running", step: operationSubmitting() });
    const created = await createAndReleaseTicket(
      ports,
      partition,
      { body: assembled.body, operation, held, dispatchOperation },
      (step) => {
        if (mounted.current) setAttempt({ attempt: "Running", step });
      },
    );
    if (!mounted.current) return;
    if (created.created === "Created") {
      onCreated(created.ticket);
      return;
    }
    setAttempt(creationAttemptOf(created));
    if (created.created === "Stale")
      await client.invalidateQueries({ queryKey });
  };

  return { attempt, submit };
}

/**
 * What the form holds: what it started on — a duplicate's seed, or a new
 * ticket's — what was typed over that, and the configuration the reader chose,
 * remembered as they choose it so the next new ticket here starts on it.
 */
function useCreationHeld(
  props: {
    readonly partition: PartitionIdentity;
    readonly context: Extract<CreationContext, { context: "Ready" }>;
    readonly duplicate?: CreationDuplicate | undefined;
  },
  repositories: readonly ProjectRepositoryResponse[],
): {
  readonly initial: TicketCreationForm;
  readonly form: TicketCreationForm;
  readonly changed: (form: TicketCreationForm) => void;
} {
  const [edited, setEdited] = useState<TicketCreationForm | undefined>(
    undefined,
  );
  const { partition, context } = props;
  const { offers, partial } = context;
  const seeded = props.duplicate?.seed.form;
  const [preferred] = useState(() => ticketConfigurationStored(partition));
  const initial = useMemo(
    () => seeded ?? creationFormFrom(offers, repositories, preferred, partial),
    [seeded, offers, repositories, preferred, partial],
  );
  const form = edited ?? initial;
  const changed = (next: TicketCreationForm): void => {
    if (next.configuration !== "" && next.configuration !== form.configuration)
      ticketConfigurationKept(partition, next.configuration);
    setEdited(next);
  };
  return { initial, form, changed };
}

/** A new ticket started from another: which, and what its draft seeded. */
export interface CreationDuplicate {
  readonly from: number;
  readonly seed: TicketDuplicateSeed;
}

/** Where a form keeps its YAML: a new ticket's, or the duplicate's own, which
 * neither replaces a new ticket's kept copy nor is replaced by it. */
function creationStoreKey(
  partition: PartitionIdentity,
  duplicate: CreationDuplicate | undefined,
): string {
  return duplicate === undefined
    ? ticketYamlStoreKey(partition, undefined)
    : ticketYamlDuplicateStoreKey(partition, duplicate.from);
}

/** The line at the head of a duplicate naming what it did not carry. */
function CreationDuplicateDropped(props: {
  readonly duplicate: CreationDuplicate | undefined;
}): ReactNode {
  const dropped =
    props.duplicate === undefined
      ? undefined
      : ticketDuplicateDroppedSentence(props.duplicate.seed.dropped);
  return dropped === undefined ? null : <Notice tone="info" detail={dropped} />;
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
  /** Whether a submit goes on to dispatch the ticket it makes. */
  readonly dispatches: boolean;
  readonly onCreated: (ticket: number) => void;
  /** The way to a ticket a submit found already made. */
  readonly existing: (ticket: number) => ReactNode;
  readonly onDirty?: (dirty: boolean) => void;
  readonly duplicate?: CreationDuplicate;
}): ReactNode {
  const [faults, setFaults] = useState<readonly CreationFault[]>([]);
  const { offers, partial, repositories: bound } = props.context;
  const repositories = useMemo(() => creationRepositories(bound), [bound]);
  const duplicate = props.duplicate;
  const storeKey = creationStoreKey(props.partition, duplicate);
  const onCreated = props.onCreated;
  const running = useCreationSubmit({
    ports: props.ports,
    partition: props.partition,
    queryKey: props.queryKey,
    offers,
    repositories,
    dispatches: props.dispatches,
    onFaults: setFaults,
    onCreated: (ticket) => {
      ticketYamlForgotten(storeKey);
      onCreated(ticket);
    },
  });
  const held = useCreationHeld(props, repositories);
  return (
    <div className="creation">
      <CreationDuplicateDropped duplicate={duplicate} />
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
        submitEffect={creationSubmitEffect(props.dispatches)}
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
            api={props}
          />
        }
      />
      <CreationAttemptNote
        attempt={running.attempt}
        motion={creationSubmitMotion(props.dispatches)}
        existing={props.existing}
      />
    </div>
  );
}

/**
 * The way to a ticket from a form that did not make it. It passes the guard
 * unasked, the note it is drawn in having said what is left behind, and
 * leaves the guard standing for every other way out.
 */
export function CreationTicketLink(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  return (
    <Link
      to="/$tenant/$project/tickets/$ticket"
      params={{ ...props.partition, ticket: String(props.ticket) }}
      ignoreBlocker
    >
      Ticket {props.ticket}
    </Link>
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

/** What a creation screen hands the form it draws once its project is read. */
export interface CreationScreenReady {
  readonly ports: ApiPorts;
  readonly partition: PartitionIdentity;
  readonly queryKey: ProjectQueryKey;
  readonly context: Extract<CreationContext, { context: "Ready" }>;
  /** Whether a submit dispatches its ticket, which it does once the abilities
   * read has come back without saying this reader may not. */
  readonly dispatches: boolean;
  readonly onDirty: (dirty: boolean) => void;
  readonly onCreated: (ticket: number) => void;
  readonly existing: (ticket: number) => ReactNode;
}

/** The project's read, and the guard and the navigation a settled submit
 * releases, around whatever form a new-ticket screen draws. */
function CreationScreenRead(props: {
  readonly partition: PartitionIdentity;
  readonly children: (ready: CreationScreenReady) => ReactNode;
}): ReactNode {
  const partition = props.partition;
  const ports = useApiPorts();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const guard = useAuthoringGuards(dirty);
  const dispatches = useProjectAbilityRead(partition, "dispatch") === "Asked";
  const list = creationContextList(partition);
  const queryKey = list.key;
  const state = usePanelList(list, (readPorts) =>
    readCreationContext(readPorts, partition),
  );
  return (
    <DataPanel title="Draft" state={state}>
      {(context) =>
        context.context === "Ready" ? (
          props.children({
            ports,
            partition,
            queryKey,
            context,
            dispatches,
            onDirty: setDirty,
            onCreated: (ticket) => {
              guard.release();
              void navigate({
                to: "/$tenant/$project/tickets/$ticket",
                params: { ...partition, ticket: String(ticket) },
              });
            },
            existing: (ticket) => (
              <CreationTicketLink partition={partition} ticket={ticket} />
            ),
          })
        ) : (
          <CreationContextAbsent partition={partition} context={context} />
        )
      }
    </DataPanel>
  );
}

/** A new-ticket screen: its title, and the form it draws for a reader who may
 * open a ticket. */
export function CreationScreen(props: {
  readonly heading: ReactNode;
  readonly children: (ready: CreationScreenReady) => ReactNode;
}): ReactNode {
  const params = useParams({ from: "/$tenant/$project" });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  return (
    <DraftScreen partition={partition} heading={props.heading}>
      <CreationScreenRead partition={partition}>
        {props.children}
      </CreationScreenRead>
    </DraftScreen>
  );
}

export function TicketCreation(): ReactNode {
  return (
    <CreationScreen heading="New ticket">
      {(ready) => <CreationForm {...ready} />}
    </CreationScreen>
  );
}
