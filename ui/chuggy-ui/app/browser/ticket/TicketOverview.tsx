/**
 * The Overview tab: the content, and beside it the ticket's properties, as an
 * issue tracker draws an issue. The content is the one card the slot holds,
 * the draft's unreleased edits, the steps of the current cycle, and the
 * instructions under the live revision; the sidebar is what the ticket is —
 * its repository, branch, author, dependencies and configuration — and what
 * its runs have cost and taken.
 *
 * Every fact is drawn once on the page: what the header says is not said
 * again here, and below the narrow breakpoint the sidebar follows the content.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  DraftResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { agoFigure, costFigure } from "../../core/figures.ts";
import { configurationLabel, creatorLabel } from "../../core/labels.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import {
  ticketLandingsHeld,
  ticketLandingsJoined,
} from "../../core/ticketLandings.ts";
import {
  ticketOverviewBranchOf,
  ticketOverviewDependenciesOf,
  ticketOverviewRunning,
  ticketOverviewRunTime,
  ticketOverviewUnreleased,
} from "../../core/ticketOverview.ts";
import { ticketLedger } from "../../core/ticketLedger.ts";
import { phaseIsRunning } from "../../core/ticketPageFacts.ts";
import { ticketStepsOf } from "../../core/ticketSteps.ts";
import { useCreatorEmails } from "../creatorEmails.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { TicketInstructions } from "./TicketInstructions.tsx";
import { readValue, useTicketPageHeld } from "./TicketPageHeld.tsx";
import type { TicketPageHeld } from "./TicketPageHeld.tsx";
import { TicketSlot } from "./TicketSlot.tsx";
import { dependencyStandingOf } from "./TicketStateChip.tsx";
import { TicketStateLabel } from "./TicketStateLabel.tsx";
import { TicketStepsDrawn } from "./TicketSteps.tsx";

import "./ticket.css";

type TicketOverviewParams = PartitionIdentity & { readonly ticket: string };

/** The member who filed the ticket, drawn only where the wire names one. */
function TicketFiledBy(props: {
  readonly partition: PartitionIdentity;
  readonly creator: string;
}): ReactNode {
  const emails = useCreatorEmails(props.partition);
  return <Identity label={creatorLabel(props.creator, emails)} />;
}

/** Each dependency as a link to its ticket with its state beside it. */
function TicketDependencies(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse;
}): ReactNode {
  const dependencies = ticketOverviewDependenciesOf(props.ticket);
  if (dependencies.length === 0) return "None";
  return (
    <ul className="ticket-sidebar-dependencies">
      {dependencies.map((dependency) => (
        <li key={dependency.ticket}>
          <Link
            to="/$tenant/$project/tickets/$ticket"
            params={{ ...props.partition, ticket: String(dependency.ticket) }}
          >
            {`#${String(dependency.ticket)}`}
          </Link>
          <TicketStateLabel
            standing={dependencyStandingOf(dependency.phase)}
            size="small"
          />
        </li>
      ))}
    </ul>
  );
}

/** A figure that is still growing while a run is live. */
function TicketSoFar(props: { readonly running: boolean }): ReactNode {
  return props.running ? (
    <span className="ticket-sidebar-so-far"> so far</span>
  ) : null;
}

function TicketSidebarRuns(props: {
  readonly held: TicketPageHeld;
  readonly ticket: TicketResponse;
  readonly params: TicketOverviewParams;
}): ReactNode {
  const executions = readValue(props.held.reads.pageState)?.executions ?? [];
  const runTime = ticketOverviewRunTime(executions, props.held.nowMs);
  if (runTime === undefined) return null;
  const running = ticketOverviewRunning(executions);
  const totals = props.ticket.runTotals;
  return (
    <>
      <Field name="Cost">
        <Link
          to="/$tenant/$project/tickets/$ticket/usage"
          params={props.params}
        >
          <Figure
            figure={
              totals === undefined
                ? { kind: "Absent", why: "No run figures yet" }
                : costFigure(totals.costUsdMicros, totals.costBasis)
            }
          />
        </Link>
        <TicketSoFar running={running} />
      </Field>
      <Field name="Run time">
        <Figure figure={runTime} />
        <TicketSoFar running={running} />
      </Field>
    </>
  );
}

/** What the ticket is, and what its runs have cost and taken. */
function TicketSidebar(props: {
  readonly held: TicketPageHeld;
  readonly ticket: TicketResponse;
}): ReactNode {
  const { held, ticket } = props;
  const params = { ...held.partition, ticket: String(held.ticket) };
  const repository = ticket.repository ?? ticket.brief?.repository;
  const branch = ticketOverviewBranchOf(
    ticket,
    ticketLandingsHeld(held.reads.landingsState),
  );
  const revision = ticket.configurationRevision;
  const configuration =
    revision === undefined
      ? undefined
      : configurationLabel(revision, ticket.configurationVersion);
  return (
    <aside className="ticket-sidebar" aria-label="Properties">
      <Fields>
        <Field name="Repository" absent={repository === undefined}>
          {repository === undefined ? (
            "None"
          ) : (
            <span title={repository}>{repositoryLabel(repository)}</span>
          )}
        </Field>
        {branch === undefined ? null : (
          <Field name="Branch">
            <code className="ticket-sidebar-branch">
              {branch.branch}
              {branch.target === undefined ? null : (
                <span className="ticket-sidebar-target">{` → ${branch.target}`}</span>
              )}
            </code>
          </Field>
        )}
        {ticket.creator === undefined ? null : (
          <Field name="Filed by">
            <TicketFiledBy
              partition={held.partition}
              creator={ticket.creator}
            />
          </Field>
        )}
        <Field name="Depends on">
          <TicketDependencies partition={held.partition} ticket={ticket} />
        </Field>
        {configuration === undefined ? null : (
          <Field name="Configuration">
            <Link
              to="/$tenant/$project/tickets/$ticket/configuration"
              params={params}
            >
              <span title={configuration.title}>{configuration.text}</span>
            </Link>
          </Field>
        )}
        <TicketSidebarRuns held={held} ticket={ticket} params={params} />
      </Fields>
    </aside>
  );
}

/** The live revision and how long ago it was released. */
function TicketRevisionLine(props: {
  readonly ticket: TicketResponse;
  readonly nowMs: number;
}): ReactNode {
  const { ticket } = props;
  return (
    <span className="ticket-revision">
      {`Revision ${String(ticket.revision)}`}
      {ticket.releasedAt === undefined ? null : (
        <>
          {" · "}
          <Figure figure={agoFigure(ticket.releasedAt, props.nowMs)} />
        </>
      )}
    </span>
  );
}

/** The draft's edits no update has released, and the way to its form. */
function TicketUnreleased(props: {
  readonly draft: DraftResponse | undefined;
  readonly params: TicketOverviewParams;
}): ReactNode {
  const line =
    props.draft === undefined
      ? undefined
      : ticketOverviewUnreleased(props.draft);
  if (line === undefined) return null;
  return (
    <section className="ticket-unreleased" aria-label="Unreleased changes">
      <strong>{line}</strong>
      <Link
        to="/$tenant/$project/tickets/$ticket/edit"
        params={props.params}
        className="ticket-unreleased-open"
      >
        Open draft
      </Link>
    </section>
  );
}

function TicketOverviewSteps(props: {
  readonly held: TicketPageHeld;
  readonly ticket: TicketResponse;
}): ReactNode {
  const { held, ticket } = props;
  const page = readValue(held.reads.pageState);
  const ledger =
    held.facts.ledger ??
    (page === undefined ? undefined : ticketLedger(page, []));
  const landings = ticketLandingsJoined(
    ticketLandingsHeld(held.reads.landingsState),
    (ledger?.cycles ?? []).map((cycle) => cycle.ordinal),
  );
  return (
    <TicketStepsDrawn
      partition={held.partition}
      ticket={held.ticket}
      steps={ticketStepsOf({
        ledger,
        plan: held.facts.plan,
        landings: landings.byCycle,
        settled: ticket.phase !== "Pending" && !phaseIsRunning(ticket.phase),
        nowMs: held.nowMs,
      })}
      nowMs={held.nowMs}
    />
  );
}

export function TicketOverviewTab(): ReactNode {
  const held = useTicketPageHeld();
  const ticket = readValue(held.reads.ticketState);
  if (ticket === undefined)
    return <PanelUnready state={held.reads.ticketState} />;
  const params = { ...held.partition, ticket: String(held.ticket) };
  return (
    <div className="ticket-overview">
      <div className="ticket-overview-main">
        <TicketSlot
          partition={held.partition}
          ticket={held.ticket}
          slot={held.slot}
          nowMs={held.nowMs}
          overrides={held.overrides}
        />
        <TicketUnreleased
          draft={readValue(held.reads.draftState)}
          params={params}
        />
        <TicketOverviewSteps held={held} ticket={ticket} />
        <TicketInstructions
          partition={held.partition}
          state={held.reads.ticketState}
          aside={<TicketRevisionLine ticket={ticket} nowMs={held.nowMs} />}
        />
      </div>
      <TicketSidebar held={held} ticket={ticket} />
    </div>
  );
}
