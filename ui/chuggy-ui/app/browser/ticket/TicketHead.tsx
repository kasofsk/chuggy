/**
 * The ticket's title and standing chip, drawn in the shell's top bar.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { TicketResponse } from "../../../../../src/contract/responses.ts";
import { phaseLabel } from "../../core/codeLabels.ts";
import { navRoutes } from "../../core/shellNav.ts";
import { phaseTone } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import { Breadcrumb, BreadcrumbLink } from "../ui/Breadcrumb.tsx";

/** The fill a standing dot draws in, total over `Tone` so a hue the wire grows
 * stops compiling rather than drawing nothing. */
export function standingDotFill(tone: Tone): string {
  switch (tone) {
    case "pass":
      return "bg-tone-pass";
    case "fail":
      return "bg-tone-fail";
    case "live":
      return "bg-tone-live";
    case "queued":
      return "bg-tone-queued";
    case "parked":
      return "bg-tone-parked";
    case "retired":
      return "bg-tone-retired";
    case "neutral":
      return "bg-ink-3";
  }
}

/** The title and standing chip the top bar draws for a ticket page, the ticket's
 * own title where the read carries one, reached from the overview it links back
 * to. */
export function TicketTopBar(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse;
}): ReactNode {
  const ticket = props.ticket;
  return (
    <>
      <Breadcrumb>
        <BreadcrumbLink to={navRoutes.overview} params={props.partition}>
          Overview
        </BreadcrumbLink>
      </Breadcrumb>
      <h1 className="text-md font-strong text-ink-1 truncate">
        {ticket.title ?? "Ticket"}
      </h1>
      <span className="text-ink-3 text-sm tabular-nums">{ticket.ticket}</span>
      <span className="text-ink-2 flex items-center gap-2 text-sm">
        <i
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-circle block ${standingDotFill(phaseTone(ticket.phase))}`}
        />
        {phaseLabel(ticket.phase)}
      </span>
    </>
  );
}
