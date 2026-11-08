/**
 * What an offer's card says of its subject once the card has read it: the
 * draft a release would release, or the ticket a revocation would end.
 *
 * A release names the draft by its title, linked to the ticket's page, then
 * its intent folded and the settings a release runs under: the configuration,
 * the catalog's work and plan where it is a catalog, whether the program runs
 * all of that plan, the dependencies, where the work lands, the brief's checks,
 * and a mark where the draft overrides its configuration. A revocation names
 * the ticket, its phase and its intent.
 *
 * What is drawn is the subject as the card last read it, which is the version
 * offered only while the card stands open.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  DraftResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { phaseLabel } from "../../core/codeLabels.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  configurationCatalogOf,
  configurationCatalogSelected,
} from "../../core/configurationCatalog.ts";
import { configurationQuery } from "../../core/configurationQueries.ts";
import { programPlannedUnder, programShort } from "../../core/programPlan.ts";
import { phaseTone } from "../../core/tones.ts";
import { usePanelState } from "../api.ts";
import { IntentFolded } from "../ticket/TicketInstructions.tsx";
import {
  ConfigurationChips,
  ConfigurationHeaderLabel,
  FinalizationMethod,
  SummaryCell,
} from "../TicketProvenance.tsx";
import { Pill } from "../ui/Pill.tsx";
import { TicketReference } from "../ui/TicketReference.tsx";

import "./threadOffer.css";

/** The subject's title as the card's heading, followed to its ticket. */
function ThreadOfferSubjectTitle(props: {
  readonly ticket: number;
  readonly title: string | undefined;
  readonly aside?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-md font-strong text-ink-1 min-w-0">
        <TicketReference ticket={props.ticket} title={props.title} />
      </h3>
      {props.aside}
    </div>
  );
}

function ThreadOfferSubjectIntent(props: {
  readonly intent: string | undefined;
}): ReactNode {
  const bodyId = useId();
  return props.intent === undefined || props.intent === "" ? null : (
    <IntentFolded text={props.intent} bodyId={bodyId} />
  );
}

/** The canonical text of the draft's configuration, once it is read. */
function useDraftCanonical(
  partition: PartitionIdentity,
  draft: DraftResponse,
): string | undefined {
  const state = usePanelState(
    configurationQuery(partition, draft.configurationRevision, "Streamed"),
  );
  return state.state === "Ready" ? state.value.canonical : undefined;
}

/** The catalog's work and plan the draft selects, and whether its program
 * runs all of that plan, once its configuration is read. */
function ThreadOfferDraftPlan(props: {
  readonly partition: PartitionIdentity;
  readonly draft: DraftResponse;
}): ReactNode {
  const text = useCopyText();
  const { draft } = props;
  const canonical = useDraftCanonical(props.partition, draft);
  if (canonical === undefined) return null;
  const catalog = configurationCatalogOf(canonical);
  const selected =
    catalog === undefined
      ? undefined
      : configurationCatalogSelected(catalog, draft.selection);
  const short = programShort(
    programPlannedUnder(canonical, draft.selection),
    draft.authoring.program,
  );
  return (
    <>
      {selected === undefined ? null : (
        <>
          <SummaryCell
            name={text({ id: "chat-offer-work" })}
            value={<code>{selected.work}</code>}
          />
          <SummaryCell
            name={text({ id: "chat-offer-plan" })}
            value={<code>{selected.evaluation}</code>}
          />
        </>
      )}
      <SummaryCell
        name={text({ id: "chat-offer-program" })}
        value={text(
          short
            ? { id: "chat-offer-plan-partial" }
            : { id: "chat-offer-plan-whole" },
        )}
      />
    </>
  );
}

/** Where the work lands: the brief's finalization, or where it names none, the
 * finalization of the finalizer the draft selects from its catalog. */
function ThreadOfferDraftLanding(props: {
  readonly partition: PartitionIdentity;
  readonly draft: DraftResponse;
}): ReactNode {
  const { draft } = props;
  const canonical = useDraftCanonical(props.partition, draft);
  const catalog =
    canonical === undefined ? undefined : configurationCatalogOf(canonical);
  const finalization =
    catalog === undefined
      ? undefined
      : configurationCatalogSelected(catalog, draft.selection).finalization;
  const finalizing =
    draft.brief?.finalization ??
    catalog?.finalizers.find((held) => held.name === finalization)
      ?.finalization;
  return finalizing === undefined ? null : (
    <FinalizationMethod finalization={finalizing} />
  );
}

function ThreadOfferDraftSettings(props: {
  readonly partition: PartitionIdentity;
  readonly draft: DraftResponse;
}): ReactNode {
  const text = useCopyText();
  const { draft } = props;
  const brief = draft.brief;
  const dependencies = draft.authoring.dependencies;
  const checks = brief?.checks ?? [];
  return (
    <div className="thread-offer-settings">
      <SummaryCell
        name={text({ id: "chat-offer-configuration" })}
        overridden={draft.overrides !== undefined}
        value={
          <ConfigurationHeaderLabel
            revision={draft.configurationRevision}
            version={draft.configurationVersion}
          />
        }
      />
      <ThreadOfferDraftPlan partition={props.partition} draft={draft} />
      {dependencies.length === 0 ? null : (
        <SummaryCell
          name={text({ id: "chat-offer-depends-on" })}
          value={
            <span className="flex flex-wrap gap-1">
              {dependencies.map((ticket) => (
                <TicketReference key={ticket} ticket={ticket} />
              ))}
            </span>
          }
        />
      )}
      {brief?.repository === undefined ? null : (
        <SummaryCell
          name={text({ id: "chat-offer-repository" })}
          value={<code>{brief.repository}</code>}
        />
      )}
      {brief?.branch === undefined ? null : (
        <SummaryCell
          name={text({ id: "chat-offer-branch" })}
          value={<code>{brief.branch}</code>}
        />
      )}
      <ThreadOfferDraftLanding partition={props.partition} draft={draft} />
      {checks.length === 0 ? null : (
        <SummaryCell
          name={text({ id: "chat-offer-checks" })}
          value={<ConfigurationChips items={checks} />}
        />
      )}
    </div>
  );
}

export function ThreadOfferDraftSubject(props: {
  readonly partition: PartitionIdentity;
  readonly draft: DraftResponse;
}): ReactNode {
  const { draft } = props;
  return (
    <div className="thread-offer-subject">
      <ThreadOfferSubjectTitle
        ticket={draft.ticket}
        title={draft.brief?.title}
      />
      <ThreadOfferSubjectIntent intent={draft.brief?.intent} />
      <ThreadOfferDraftSettings partition={props.partition} draft={draft} />
    </div>
  );
}

export function ThreadOfferTicketSubject(props: {
  readonly ticket: TicketResponse;
}): ReactNode {
  const { ticket } = props;
  const text = useCopyText();
  return (
    <div className="thread-offer-subject">
      <ThreadOfferSubjectTitle
        ticket={ticket.ticket}
        title={ticket.title}
        aside={
          <Pill tone={phaseTone(ticket.phase)}>
            {text(phaseLabel(ticket.phase))}
          </Pill>
        }
      />
      <ThreadOfferSubjectIntent intent={ticket.brief?.intent} />
    </div>
  );
}
