/**
 * The main column of the ticket page: the ledger, what it cost, and the detail
 * the situation column points at.
 *
 * Each region is a section with the id its anchor names, so a link from the
 * sidebar is a scroll rather than a tab, and find-in-page still reaches every
 * word on the page. Brief and provenance sit under the ledger because the
 * question a reader arrives with is about what has run, not about how the
 * ticket was authored.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  DraftResponse,
  ExecutionsResponse,
  RunTotals,
} from "../../../../../src/contract/responses.ts";
import type { PanelState } from "../../core/freshness.ts";
import { TicketBrief, TicketProvenance } from "../TicketProvenance.tsx";
import { Panel } from "../ui/Panel.tsx";
import { TicketUsage } from "./TicketUsage.tsx";

export function TicketMain(props: {
  readonly partition: PartitionIdentity;
  readonly draftState: PanelState<DraftResponse>;
  readonly ledger: ReactNode;
  readonly totals: RunTotals | undefined;
  readonly page: ExecutionsResponse | undefined;
}): ReactNode {
  return (
    <div className="ticket-main">
      <section id="cycles">{props.ledger}</section>
      <section id="usage">
        <Panel title="Usage" meta="list price">
          <TicketUsage totals={props.totals} page={props.page} />
        </Panel>
      </section>
      <section id="brief">
        <TicketBrief state={props.draftState} />
      </section>
      <section id="provenance">
        <TicketProvenance
          partition={props.partition}
          state={props.draftState}
        />
      </section>
    </div>
  );
}
