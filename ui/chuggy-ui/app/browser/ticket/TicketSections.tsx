/**
 * The detail under the ledger — the brief, what the ticket has cost, where it
 * came from — as rows closed until asked for, each with its one-line summary.
 *
 * Which rows are open is the page's rather than the rows', so an anchor in the
 * details pane can open the row it points at; each row keeps the id the anchor
 * names.
 */

import { Accordion } from "radix-ui";
import type { MouseEvent, ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  DraftResponse,
  ExecutionsResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { costFigure } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import type { TicketPageFacts } from "../../core/ticketPageFacts.ts";
import { useShellDetailsShow } from "../shell/slots.tsx";
import { useViewportAtLeastEm, viewportDeskEm } from "../shell/viewport.ts";
import { TicketBrief, TicketProvenance } from "../TicketProvenance.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Panel } from "../ui/Panel.tsx";
import { SectionList } from "../ui/SectionList.tsx";
import type { SectionEntry } from "../ui/SectionList.tsx";
import { TicketUsage } from "./TicketUsage.tsx";

import "./ticket.css";

/** The rows that open, in the order the page draws them. */
export const ticketSectionRows = ["brief", "usage", "provenance"] as const;

/** The rows open once `id` is followed: that one added where it is a row. */
export function ticketSectionsOpened(
  open: readonly string[],
  id: string,
): readonly string[] {
  const row = ticketSectionRows.find((known) => known === id);
  if (row === undefined || open.includes(row)) return open;
  return [...open, row];
}

/** What the ticket has cost, which is what the Usage row and its anchor say. */
function usageFigure(ticket: TicketResponse | undefined): ReactNode {
  const totals = ticket?.runTotals;
  if (totals === undefined) return "No run figures yet";
  return <Figure figure={costFigure(totals.costUsdMicros, totals.costBasis)} />;
}

/** One anchor per region of the page, each with the one figure it is about. */
export function ticketSections(
  ticket: TicketResponse,
  facts: TicketPageFacts,
): readonly SectionEntry[] {
  const ledger = facts.ledger;
  const totals = ticket.runTotals;
  return [
    {
      id: "cycles",
      label: "Cycles",
      note:
        ledger === undefined
          ? "Not read"
          : `${String(ledger.cycles.length)} · ${String(ledger.spend.executions)} runs`,
    },
    {
      id: "usage",
      label: "Usage",
      figure:
        totals === undefined
          ? { kind: "Absent", why: "No run figures yet" }
          : costFigure(totals.costUsdMicros, totals.costBasis),
    },
    { id: "brief", label: "Brief" },
    { id: "provenance", label: "Provenance" },
  ];
}

function SectionChevron(): ReactNode {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="ticket-section-chevron size-3 shrink-0"
    >
      <path
        d="M4 2 L8 6 L4 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SectionRow(props: {
  readonly id: (typeof ticketSectionRows)[number];
  readonly label: string;
  readonly summary: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Accordion.Item value={props.id} asChild>
      <section id={props.id} className="ticket-section scroll-mt-4">
        <Accordion.Header asChild>
          <h2>
            <Accordion.Trigger className="ticket-section-trigger">
              <span className="grow">{props.label}</span>
              <span className="ticket-section-summary">{props.summary}</span>
              <SectionChevron />
            </Accordion.Trigger>
          </h2>
        </Accordion.Header>
        <Accordion.Content className="ticket-section-body">
          {props.children}
        </Accordion.Content>
      </section>
    </Accordion.Item>
  );
}

export function TicketSections(props: {
  readonly partition: PartitionIdentity;
  readonly ticketState: PanelState<TicketResponse>;
  readonly draftState: PanelState<DraftResponse>;
  readonly page: ExecutionsResponse | undefined;
  readonly open: readonly string[];
  readonly onOpenChange: (open: readonly string[]) => void;
  readonly nowMs: number;
}): ReactNode {
  const ticket =
    props.ticketState.state === "Ready" ? props.ticketState.value : undefined;
  return (
    <Accordion.Root
      type="multiple"
      value={[...props.open]}
      onValueChange={props.onOpenChange}
      className="ticket-sections bg-surface-1 border-edge rounded-3 border"
    >
      <SectionRow id="brief" label="Brief" summary={null}>
        <TicketBrief state={props.ticketState} />
      </SectionRow>
      <SectionRow id="usage" label="Usage" summary={usageFigure(ticket)}>
        <TicketUsage totals={ticket?.runTotals} page={props.page} />
      </SectionRow>
      <SectionRow
        id="provenance"
        label="Provenance"
        summary={
          ticket === undefined ? null : `Revision ${String(ticket.revision)}`
        }
      >
        <TicketProvenance
          partition={props.partition}
          state={props.draftState}
          ticket={ticket}
          nowMs={props.nowMs}
        />
      </SectionRow>
    </Accordion.Root>
  );
}

/**
 * The page's table of contents, drawn in the shell's details pane. A click
 * opens the row it points at, and closes the pane first where the pane and the
 * page share the middle row so the target is not left behind it; at the desk
 * width the page stays beside the pane and nothing closes.
 */
export function TicketPageDetails(props: {
  readonly sections: readonly SectionEntry[];
  readonly onChoose: (id: string) => void;
}): ReactNode {
  const detailsShow = useShellDetailsShow();
  const desk = useViewportAtLeastEm(viewportDeskEm);
  const onNavigate = (event: MouseEvent<HTMLDivElement>): void => {
    if (!desk && (event.target as HTMLElement).closest("a") !== null)
      detailsShow(false);
  };
  return (
    <div onClick={onNavigate}>
      <Panel title="On this page" level={2}>
        <SectionList entries={props.sections} onChoose={props.onChoose} />
      </Panel>
    </div>
  );
}
