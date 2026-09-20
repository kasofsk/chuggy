/**
 * What this ticket was authored as: the revision the release fixed, and the
 * document it was released from.
 *
 * THIS WIRE ANSWERS THE TICKET'S OWN DEFINITION AND NOTHING AROUND IT. The
 * definition read carries the authored `source` and the revision it belongs to.
 * It carries no repository, no commit and no catalog pin, so this draws no
 * origin for the document: naming one would be this console guessing which tree
 * a ticket was read from, and the answer would be wrong for every ticket
 * authored before the binding last moved.
 *
 * A RELEASE THAT RETAINED NO SOURCE IS A FACT, NOT AN EMPTY PANEL. `source` is
 * null for a ticket released before the document was kept, and that is said in
 * words rather than drawn as a document of no lines.
 */

import type { ReactNode } from "react";

import type { AdoptedTicket } from "../../../../../src/contract/adoptedTickets.ts";
import { countFigure } from "../../core/figures.ts";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";

export const provenanceUnretained =
  "This ticket was released before its document was kept, so there is nothing to show.";

function AuthoredDocument(props: {
  readonly source: string;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}): ReactNode {
  return (
    <Disclosure
      open={props.open}
      onOpenChange={props.setOpen}
      look={{ variant: "quiet", size: "sm" }}
      label={props.open ? "Hide document" : "Show document"}
    >
      <pre className="authoring-confirm-source">{props.source}</pre>
    </Disclosure>
  );
}

export function TicketProvenance(props: {
  readonly ticket: AdoptedTicket;
  readonly source: string | null | undefined;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}): ReactNode {
  return (
    <div className="grid gap-3">
      <Fields variant="inline">
        <Field name="Revision">
          <Figure figure={countFigure(props.ticket.revision, "rev")} />
        </Field>
      </Fields>
      {props.source === undefined ? (
        <Notice tone="info" inline detail="Loading the authored document…" />
      ) : props.source === null ? (
        <Notice tone="parked" inline detail={provenanceUnretained} />
      ) : (
        <AuthoredDocument
          source={props.source}
          open={props.open}
          setOpen={props.setOpen}
        />
      )}
    </div>
  );
}
