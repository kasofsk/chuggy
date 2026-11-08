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
 *
 * A draft never released is drawn from the draft: the steps it would run, its
 * instructions marked Draft, and a sidebar with no author and no runs, which
 * the draft's read does not carry.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  DraftResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import type { TicketPhase } from "../../../../../src/contract/rosters.ts";
import { agoFigure, costFigure } from "../../core/figures.ts";
import { configurationLabel, creatorLabel } from "../../core/labels.ts";
import {
  repositoryLabel,
  repositoryPage,
} from "../../core/projectRepositories.ts";
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
import type { TicketOverviewBranch } from "../../core/ticketOverview.ts";
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
import { useCopyText } from "../../copy/CopyProvider.tsx";

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

/** Each dependency as a link to its ticket, with its state beside it where
 * the read says it. */
function TicketDependencies(props: {
  readonly partition: PartitionIdentity;
  readonly dependencies: readonly {
    readonly ticket: number;
    readonly phase?: TicketPhase;
  }[];
}): ReactNode {
  const text = useCopyText();
  if (props.dependencies.length === 0) return text({ id: "ticket-value-none" });
  return (
    <ul className="ticket-sidebar-dependencies">
      {props.dependencies.map((dependency) => (
        <li key={dependency.ticket}>
          <Link
            to="/$tenant/$project/tickets/$ticket"
            params={{ ...props.partition, ticket: String(dependency.ticket) }}
          >
            {`#${String(dependency.ticket)}`}
          </Link>
          {dependency.phase === undefined ? null : (
            <TicketStateLabel
              standing={dependencyStandingOf(dependency.phase)}
              size="small"
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** The Repository field: a link to the repository's own page where its
 * address names one, text otherwise. */
function TicketSidebarRepository(props: {
  readonly repository: string;
}): ReactNode {
  const { repository } = props;
  const label = repositoryLabel(repository);
  const page = repositoryPage(repository);
  return page === undefined ? (
    <span title={repository}>{label}</span>
  ) : (
    <a href={page} rel="noopener noreferrer" target="_blank" title={repository}>
      {label}
    </a>
  );
}

/** A figure that is still growing while a run is live. */
function TicketSoFar(props: { readonly running: boolean }): ReactNode {
  const text = useCopyText();
  return props.running ? (
    <span className="ticket-sidebar-so-far">
      {" "}
      {text({ id: "ticket-overview-so-far" })}
    </span>
  ) : null;
}

function TicketSidebarRuns(props: {
  readonly held: TicketPageHeld;
  readonly ticket: TicketResponse;
  readonly params: TicketOverviewParams;
}): ReactNode {
  const executions = readValue(props.held.reads.pageState)?.executions ?? [];
  const runTime = ticketOverviewRunTime(executions, props.held.nowMs);
  const text = useCopyText();
  if (runTime === undefined) return null;
  const running = ticketOverviewRunning(executions);
  const totals = props.ticket.runTotals;
  return (
    <>
      <Field name={text({ id: "ticket-field-cost" })}>
        <Link
          to="/$tenant/$project/tickets/$ticket/usage"
          params={props.params}
        >
          <Figure
            figure={
              totals === undefined
                ? { kind: "Absent", why: { id: "figures-absent-run" } }
                : costFigure(totals.costUsdMicros, totals.costBasis)
            }
          />
        </Link>
        <TicketSoFar running={running} />
      </Field>
      <Field name={text({ id: "ticket-field-run-time" })}>
        <Figure figure={runTime.ran} />
        <TicketSoFar running={running} />
      </Field>
      <Field name={text({ id: "ticket-field-waited" })}>
        <Figure figure={runTime.waited} />
        <TicketSoFar running={running} />
      </Field>
    </>
  );
}

/** What the sidebar says of a ticket or a draft beside its runs. */
interface TicketSidebarFacts {
  readonly repository: string | undefined;
  readonly branch: TicketOverviewBranch | undefined;
  readonly creator: string | undefined;
  readonly dependencies: readonly {
    readonly ticket: number;
    readonly phase?: TicketPhase;
  }[];
  readonly revision: string | undefined;
  readonly version: TicketResponse["configurationVersion"];
}

/** The Branch field: the branch name, and its target where the wire names one. */
function TicketSidebarBranch(props: {
  readonly branch: TicketOverviewBranch;
}): ReactNode {
  const { branch } = props;
  const text = useCopyText();
  return (
    <Field name={text({ id: "ticket-overview-branch" })}>
      <code className="ticket-sidebar-branch">
        {branch.branch}
        {branch.target === undefined ? null : (
          <span className="ticket-sidebar-target">
            {" "}
            {text({
              id: "ticket-overview-branch-target",
              args: { target: branch.target },
            })}
          </span>
        )}
      </code>
    </Field>
  );
}

/** What the ticket is, and under it whatever the caller adds of its runs. */
function TicketSidebarDrawn(props: {
  readonly held: TicketPageHeld;
  readonly facts: TicketSidebarFacts;
  readonly children?: ReactNode;
}): ReactNode {
  const { held, facts } = props;
  const { repository, branch, creator, revision } = facts;
  const params = { ...held.partition, ticket: String(held.ticket) };
  const text = useCopyText();
  const configuration =
    revision === undefined
      ? undefined
      : configurationLabel(revision, facts.version);
  return (
    <aside
      className="ticket-sidebar"
      aria-label={text({ id: "ticket-overview-properties" })}
    >
      <Fields>
        <Field
          name={text({ id: "ticket-overview-repository" })}
          absent={repository === undefined}
        >
          {repository === undefined ? (
            text({ id: "ticket-value-none" })
          ) : (
            <TicketSidebarRepository repository={repository} />
          )}
        </Field>
        {branch === undefined ? null : <TicketSidebarBranch branch={branch} />}
        {creator === undefined ? null : (
          <Field name={text({ id: "ticket-overview-filed-by" })}>
            <TicketFiledBy partition={held.partition} creator={creator} />
          </Field>
        )}
        <Field name={text({ id: "ticket-overview-depends-on" })}>
          <TicketDependencies
            partition={held.partition}
            dependencies={facts.dependencies}
          />
        </Field>
        {configuration === undefined ? null : (
          <Field name={text({ id: "ticket-overview-configuration" })}>
            <Link
              to="/$tenant/$project/tickets/$ticket/configuration"
              params={params}
            >
              <span title={configuration.title}>{configuration.text}</span>
            </Link>
          </Field>
        )}
        {props.children}
      </Fields>
    </aside>
  );
}

/** What the ticket is, and what its runs have cost and taken. */
function TicketSidebar(props: {
  readonly held: TicketPageHeld;
  readonly ticket: TicketResponse;
}): ReactNode {
  const { held, ticket } = props;
  const params = { ...held.partition, ticket: String(held.ticket) };
  return (
    <TicketSidebarDrawn
      held={held}
      facts={{
        repository: ticket.repository ?? ticket.brief?.repository,
        branch: ticketOverviewBranchOf(
          ticket,
          ticketLandingsHeld(held.reads.landingsState),
        ),
        creator: ticket.creator,
        dependencies: ticketOverviewDependenciesOf(ticket),
        revision: ticket.configurationRevision,
        version: ticket.configurationVersion,
      }}
    >
      <TicketSidebarRuns held={held} ticket={ticket} params={params} />
    </TicketSidebarDrawn>
  );
}

/** The live revision and how long ago it was released. */
function TicketRevisionLine(props: {
  readonly ticket: TicketResponse;
  readonly nowMs: number;
}): ReactNode {
  const { ticket } = props;
  const text = useCopyText();
  return (
    <span className="ticket-revision">
      {text({
        id: "ticket-overview-revision",
        args: { revision: ticket.revision },
      })}
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
  const text = useCopyText();
  if (line === undefined) return null;
  return (
    <section
      className="ticket-unreleased"
      aria-label={text({ id: "ticket-overview-unreleased-changes" })}
    >
      <strong>{line}</strong>
      <Link
        to="/$tenant/$project/tickets/$ticket/edit"
        params={props.params}
        className="ticket-unreleased-open"
      >
        {text({ id: "ticket-overview-open-draft" })}
      </Link>
    </section>
  );
}

function TicketOverviewSteps(props: {
  readonly held: TicketPageHeld;
  readonly ticket: TicketResponse;
}): ReactNode {
  const { held, ticket } = props;
  const text = useCopyText();
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
      steps={ticketStepsOf(
        {
          ledger,
          plan: held.facts.plan,
          landings: landings.byCycle,
          settled: ticket.phase !== "Pending" && !phaseIsRunning(ticket.phase),
          nowMs: held.nowMs,
        },
        text,
      )}
      nowMs={held.nowMs}
    />
  );
}

/** A draft never released: the steps it would run, none run yet, its
 * instructions as they stand, and what it is. */
function TicketDraftOverview(props: {
  readonly held: TicketPageHeld;
  readonly draft: DraftResponse;
}): ReactNode {
  const { held, draft } = props;
  const text = useCopyText();
  return (
    <div className="ticket-overview">
      <div className="ticket-overview-main">
        <TicketStepsDrawn
          partition={held.partition}
          ticket={held.ticket}
          steps={ticketStepsOf(
            {
              ledger: undefined,
              plan: held.facts.plan,
              landings: new Map(),
              settled: false,
              nowMs: held.nowMs,
            },
            text,
          )}
          nowMs={held.nowMs}
        />
        <TicketInstructions
          partition={held.partition}
          brief={draft.brief}
          aside={
            <span className="ticket-revision">
              {text({ id: "ticket-overview-draft-badge" })}
            </span>
          }
        />
      </div>
      <TicketSidebarDrawn
        held={held}
        facts={{
          repository: draft.brief?.repository,
          branch: ticketOverviewBranchOf(draft, []),
          creator: undefined,
          dependencies: draft.authoring.dependencies.map((ticket) => ({
            ticket,
          })),
          revision: draft.configurationRevision,
          version: draft.configurationVersion,
        }}
      />
    </div>
  );
}

export function TicketOverviewTab(): ReactNode {
  const held = useTicketPageHeld();
  if (held.draft !== undefined)
    return <TicketDraftOverview held={held} draft={held.draft} />;
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
          brief={ticket.brief}
          aside={<TicketRevisionLine ticket={ticket} nowMs={held.nowMs} />}
        />
      </div>
      <TicketSidebar held={held} ticket={ticket} />
    </div>
  );
}
